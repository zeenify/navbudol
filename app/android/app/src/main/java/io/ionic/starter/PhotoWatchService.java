package io.ionic.starter;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

/**
 * Foreground service behind the photo watch — the piece that makes the
 * camera-event flow actually work.
 *
 * When the user leaves for their camera app, our activity goes to the
 * background and Android freezes cached-process handlers (aggressively on
 * modern OEM builds) — anything scheduled from the plugin's main-thread
 * handler simply stops. As a foreground service with a dataSync type, this
 * component keeps a dedicated polling thread alive while the user shoots,
 * so the heads-up "📸 Photo taken near …" notification lands WHILE they
 * are still in the camera.
 *
 * The notification carries an "Add" action: pressing it uploads the photo
 * to the community place IN THE BACKGROUND (the session token persisted
 * when the watch armed) — the user never has to reopen the app. Tapping
 * the notification body still opens the app at the post card.
 *
 * Responsibilities here are deliberately narrow: poll MediaStore, post the
 * notifications, and — only when explicitly asked — upload a capture. The
 * in-app "post it?" card happens in the web layer on resume.
 */
public class PhotoWatchService extends Service {
    public static final String EXTRA_SINCE = "since";
    public static final String EXTRA_PLACE = "placeName";
    public static final String ACTION_UPLOAD = "navbudolUpload";
    public static final String EXTRA_PHOTO_IDS = "photoIds";
    public static final String EXTRA_NOTIF_ID = "notifId";
    private static final String TAG = "PhotoWatch";
    private static final String PREFS = "navbudol_photo_watch";

    private static final long POLL_MS = 4000;
    private static final String ALERT_CHANNEL_ID = "navbudol-photos";
    private static final String WATCH_CHANNEL_ID = "navbudol-photos-watch";
    private static final int WATCH_NOTIF_ID = 42;
    private static final int MAX_EDGE = 1280;

    private HandlerThread pollThread;
    private Handler pollHandler;
    private Runnable pollRunnable;
    private long lastTimestamp;
    private String placeName;
    private String placeId;
    private String authToken;
    private String backendUrl;
    /** Photos already announced this watch — the >= since query re-reads them. */
    private final Set<String> announced = new HashSet<>();
    /** Photos already uploaded via the Add action — guards double-taps. */
    private final Set<String> posted = new HashSet<>();

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        placeName = p.getString("placeName", null);
        placeId = p.getString("placeId", null);
        authToken = p.getString("authToken", null);
        backendUrl = p.getString("backendUrl", null);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannels();
        startForeground(WATCH_NOTIF_ID, buildWatchNotification());

        if (intent != null && ACTION_UPLOAD.equals(intent.getAction())) {
            long[] ids = intent.getLongArrayExtra(EXTRA_PHOTO_IDS);
            int notifId = intent.getIntExtra(EXTRA_NOTIF_ID, (int) System.currentTimeMillis());
            Log.i(TAG, "Add pressed: uploading " + (ids == null ? 0 : ids.length) + " photo(s), notifId=" + notifId);
            uploadAll(ids, notifId);
            if (pollRunnable == null) {
                // Stale notification on a watch that already ended — done after upload.
                stopSelf();
            }
            return START_NOT_STICKY;
        }

        long since = intent != null ? intent.getLongExtra(EXTRA_SINCE, System.currentTimeMillis() / 1000) : System.currentTimeMillis() / 1000;
        String name = intent != null ? intent.getStringExtra(EXTRA_PLACE) : null;
        if (name != null && !name.isEmpty()) placeName = name;
        lastTimestamp = since;
        announced.clear();

        Log.i(TAG, "service start: since=" + since + " place=" + placeName
                + " mediaRead=" + canReadImages(this));
        startPolling();
        // Sticky-ish: restart if the system reclaims us mid-visit.
        return START_REDELIVER_INTENT;
    }

    private void startPolling() {
        stopPolling();
        pollThread = new HandlerThread("PhotoWatchPoll");
        pollThread.start();
        pollHandler = new Handler(pollThread.getLooper());
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                poll();
                if (pollHandler != null && pollRunnable != null) {
                    pollHandler.postDelayed(this, POLL_MS);
                }
            }
        };
        pollHandler.postDelayed(pollRunnable, POLL_MS);
    }

    private void stopPolling() {
        if (pollHandler != null && pollRunnable != null) {
            pollHandler.removeCallbacks(pollRunnable);
        }
        if (pollThread != null) {
            pollThread.quitSafely();
        }
        pollHandler = null;
        pollRunnable = null;
        pollThread = null;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "service destroyed");
        stopPolling();
        super.onDestroy();
    }

    /** New DCIM images since the watermark — posts one alert per poll tick. */
    private void poll() {
        Cursor cursor = null;
        ArrayList<Long> freshIds = new ArrayList<>();
        try {
            String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DATE_ADDED
            };
            String selection = MediaStore.Images.Media.DATE_ADDED + " >= ? AND " +
                    MediaStore.Images.Media.IS_PENDING + " = 0 AND " +
                    MediaStore.Images.Media.RELATIVE_PATH + " LIKE 'DCIM/%'";
            cursor = getContentResolver().query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    selection,
                    new String[]{String.valueOf(lastTimestamp)},
                    MediaStore.Images.Media.DATE_ADDED + " ASC"
            );
            if (cursor == null) {
                Log.w(TAG, "poll: MediaStore query returned null");
                return;
            }
            while (cursor.moveToNext()) {
                long id = cursor.getLong(0);
                long added = cursor.getLong(1);
                String idKey = String.valueOf(id);
                if (announced.contains(idKey)) continue;
                announced.add(idKey);
                Log.i(TAG, "poll: fresh photo id=" + idKey + " added=" + added);
                if (added > lastTimestamp && added <= System.currentTimeMillis() / 1000) {
                    lastTimestamp = added;
                }
                freshIds.add(id);
            }
        } catch (Exception e) {
            // MediaStore can be briefly inconsistent after a capture; the
            // next tick retries silently.
        } finally {
            if (cursor != null) cursor.close();
        }
        // Bound the announced set — a long shoot at one place stays small.
        if (announced.size() > 500) {
            // Keep the newest hundred so double-posting stays guarded.
            announced.clear();
            announced.addAll(posted);
        }
        if (!freshIds.isEmpty()) {
            postAlertNotification(freshIds.get(0), toLongArray(freshIds));
        }
    }

    private static long[] toLongArray(ArrayList<Long> list) {
        long[] out = new long[list.size()];
        for (int i = 0; i < list.size(); i++) out[i] = list.get(i);
        return out;
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel watch = new NotificationChannel(
                WATCH_CHANNEL_ID, "Photo watch", NotificationManager.IMPORTANCE_LOW);
        watch.setDescription("Persistent notice while NavBudol watches for photos near a place");
        nm.createNotificationChannel(watch);
        NotificationChannel alerts = new NotificationChannel(
                ALERT_CHANNEL_ID, "Photo contributions", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Photos you took near community places");
        nm.createNotificationChannel(alerts);
    }

    /** The quiet persistent "watch is armed" notification (required for fg). */
    private Notification buildWatchNotification() {
        NotificationCompat.Builder b = baseBuilder(WATCH_CHANNEL_ID)
                .setContentTitle(placeName != null ? "Watching for photos near " + placeName : "Watching for photos")
                .setContentText("Snap one in your camera app — you'll get a nudge to share it.")
                .setOngoing(true);
        return b.build();
    }

    /** The heads-up alert over the camera app, with the background-Add action. */
    private void postAlertNotification(long photoId, long[] photoIds) {
        Intent add = new Intent(this, PhotoActionReceiver.class);
        add.putExtra(EXTRA_PHOTO_IDS, photoIds);
        add.putExtra(EXTRA_NOTIF_ID, (int) photoId);
        add.putExtra(EXTRA_PLACE, placeName);
        PendingIntent addPi = PendingIntent.getBroadcast(
                this, (int) photoId, add,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = baseBuilder(ALERT_CHANNEL_ID)
                .setContentTitle(placeName != null
                        ? "📸 Photo taken near " + placeName
                        : "📸 Photo taken near a mapped place")
                .setContentText("Tap to post it for your neighbors")
                .setAutoCancel(true)
                .addAction(new NotificationCompat.Action.Builder(
                        android.R.drawable.ic_menu_upload, "Add", addPi).build());
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify((int) photoId, b.build());
            Log.i(TAG, "alert notification POSTED id=" + ((int) photoId) + " with Add action, photos=" + photoIds.length);
        } else {
            Log.w(TAG, "alert NOT posted: no NotificationManager");
        }
    }

    /** Upload every fresh capture as its own gallery comment, then confirm.
     *  The Add broadcast arrives on the MAIN thread — Android forbids network
     *  I/O there, so the whole upload runs on a worker thread. */
    private void uploadAll(long[] ids, int notifId) {
        if (ids == null || ids.length == 0) return;
        new Thread(() -> performUpload(ids, notifId), "PhotoAddUpload").start();
    }

    private void performUpload(long[] ids, int notifId) {
        boolean hasToken = authToken != null && !authToken.isEmpty();
        boolean canPost = hasToken && placeId != null && backendUrl != null && !backendUrl.isEmpty();
        if (!canPost) {
            Log.w(TAG, "background Add unavailable (signed out or no place) — notification tap still posts");
            return;
        }
        int ok = 0;
        for (long id : ids) {
            String key = String.valueOf(id);
            if (posted.contains(key)) continue;
            String base64 = readScaledBase64(
                    Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, key));
            if (base64 == null) {
                Log.w(TAG, "unreadable photo id=" + key);
                continue;
            }
            String body = "{\"imageBase64\":\"" + base64 + "\",\"mimeType\":\"image/jpeg\"}";
            boolean success = postJson(
                    backendUrl + "/api/places/" + placeId + "/comments",
                    "Bearer " + authToken,
                    body);
            if (success) {
                posted.add(key);
                ok++;
                Log.i(TAG, "background ADD OK id=" + key);
            } else {
                Log.w(TAG, "background ADD FAILED id=" + key);
            }
        }
        if (ok > 0) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(notifId);
            NotificationCompat.Builder b = baseBuilder(WATCH_CHANNEL_ID)
                    .setContentTitle("✓ Added " + (ok == 1 ? "1 photo" : ok + " photos") + (placeName != null ? " to " + placeName : ""))
                    .setContentText("Thanks for contributing!")
                    .setAutoCancel(true);
            if (nm != null) {
                nm.notify((int) System.currentTimeMillis(), b.build());
            }
        }
    }

    private boolean postJson(String urlStr, String auth, String json) {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", auth);
            OutputStream os = conn.getOutputStream();
            os.write(json.getBytes("UTF-8"));
            os.close();
            int code = conn.getResponseCode();
            conn.disconnect();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            Log.w(TAG, "postJson failed: " + e);
            return false;
        }
    }

    /** Reads a MediaStore image and returns a downscaled JPEG as base64. */
    private String readScaledBase64(Uri uri) {
        try {
            InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) return null;
            Bitmap bitmap = BitmapFactory.decodeStream(in);
            in.close();
            if (bitmap == null) return null;
            int w = bitmap.getWidth();
            int h = bitmap.getHeight();
            if (Math.max(w, h) > MAX_EDGE) {
                float scale = MAX_EDGE / (float) Math.max(w, h);
                bitmap = Bitmap.createScaledBitmap(
                        bitmap, Math.round(w * scale), Math.round(h * scale), true);
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out);
            bitmap.recycle();
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    private NotificationCompat.Builder baseBuilder(String channelId) {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = null;
        if (launch != null) {
            contentIntent = PendingIntent.getActivity(
                    this, 0, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setPriority(channelId.equals(ALERT_CHANNEL_ID)
                        ? NotificationCompat.PRIORITY_HIGH
                        : NotificationCompat.PRIORITY_MIN);
        if (contentIntent != null) builder.setContentIntent(contentIntent);
        return builder;
    }

    /** Guard used before touching MediaStore — mirrors the plugin's request. */
    public static boolean canReadImages(Context context) {
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_MEDIA_IMAGES)
                    == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }
}
