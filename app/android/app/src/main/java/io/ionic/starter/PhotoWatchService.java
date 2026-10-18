package io.ionic.starter;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.provider.MediaStore;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

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
 * Responsibilities here are deliberately narrow: poll MediaStore, count new
 * DCIM captures, post the alert notification. Reading/scaling the image
 * and the in-app "post it?" card happen in the web layer on resume
 * (checkNow/rescan), so no heavy bitmap work ever runs in a service.
 */
public class PhotoWatchService extends Service {
    public static final String EXTRA_SINCE = "since";
    public static final String EXTRA_PLACE = "placeName";

    private static final long POLL_MS = 4000;
    private static final String ALERT_CHANNEL_ID = "navbudol-photos";
    private static final String WATCH_CHANNEL_ID = "navbudol-photos-watch";
    private static final int WATCH_NOTIF_ID = 42;

    private HandlerThread pollThread;
    private Handler pollHandler;
    private Runnable pollRunnable;
    private long lastTimestamp;
    private String placeName;
    /** Photos already announced this watch — the >= since query re-reads them. */
    private final java.util.Set<String> announced = new java.util.HashSet<>();

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        long since = intent != null ? intent.getLongExtra(EXTRA_SINCE, System.currentTimeMillis() / 1000) : System.currentTimeMillis() / 1000;
        String name = intent != null ? intent.getStringExtra(EXTRA_PLACE) : null;
        placeName = name != null && !name.isEmpty() ? name : null;
        lastTimestamp = since;
        announced.clear();

        ensureChannels();
        startForeground(WATCH_NOTIF_ID, buildWatchNotification());
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
        stopPolling();
        super.onDestroy();
    }

    /** New DCIM images since the watermark — ids and timestamps only. */
    private int poll() {
        Cursor cursor = null;
        int fresh = 0;
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
            if (cursor == null) return 0;
            while (cursor.moveToNext()) {
                long id = cursor.getLong(0);
                long added = cursor.getLong(1);
                String idKey = String.valueOf(id);
                if (announced.contains(idKey)) continue;
                announced.add(idKey);
                if (added > lastTimestamp && added <= System.currentTimeMillis() / 1000) {
                    lastTimestamp = added;
                }
                if (fresh == 0) {
                    postAlertNotification();
                }
                fresh += 1;
            }
        } catch (Exception e) {
            // MediaStore can be briefly inconsistent after a capture; the
            // next tick retries silently.
        } finally {
            if (cursor != null) cursor.close();
        }
        // Bound the announced set — a long shoot at one place stays small.
        if (announced.size() > 500) announced.clear();
        return fresh;
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

    /** The heads-up alert over the camera app. */
    private void postAlertNotification() {
        NotificationCompat.Builder b = baseBuilder(ALERT_CHANNEL_ID)
                .setContentTitle(placeName != null
                        ? "📸 Photo taken near " + placeName
                        : "📸 Photo taken near a mapped place")
                .setContentText("Tap to post it for your neighbors")
                .setAutoCancel(true);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify((int) System.currentTimeMillis(), b.build());
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
