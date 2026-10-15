package io.ionic.starter;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Watches the system MediaStore for NEW camera photos — the hook behind the
 * one-tap contribution flow.
 *
 * The user takes the photo in their OWN camera app, so our app is usually in
 * the background at that moment. Detection therefore works in two layers:
 *  - a real system notification (heads-up, visible over the camera app) with
 *    a tap-action that opens the app, posted whenever the app is not focused;
 *  - the JS 'photoCaptured' event for the in-app card when the app IS focused;
 *  - a checkNow() call the web layer uses on resume to catch anything missed.
 *
 * The watch runs only while the web layer keeps it started (app open and the
 * user on-site at a community place) — Android forbids true background
 * listening, and the process must be alive for polling to run.
 */
@CapacitorPlugin(
    name = "PhotoWatcher",
    permissions = {
        @Permission(alias = "postNotifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class PhotoWatcherPlugin extends Plugin {
    private static final long POLL_MS = 4000;
    private static final int MAX_EDGE = 1280;
    private static final String CHANNEL_ID = "navbudol-photos";
    private static final String NOTIF_PERMISSION_ALIAS = "postNotifications";

    private Handler handler;
    private Runnable pollRunnable;
    private long lastTimestamp;
    /** Photos surfaced this session — ids let the >= since query rescan the
     * same second without re-reading or double-delivering anything. */
    private final Set<String> deliveredIds = new HashSet<>();
    /** Place name for the notification text (set by startWatch). */
    private String placeName;

    @PluginMethod
    public void startWatch(PluginCall call) {
        Double since = call.getDouble("since");
        lastTimestamp = since != null ? since.longValue() : System.currentTimeMillis() / 1000;
        String name = call.getString("placeName");
        placeName = name != null && !name.isEmpty() ? name : null;
        ensureChannel();
        stopPolling();
        handler = new Handler(Looper.getMainLooper());
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                poll();
                if (pollRunnable != null && handler != null) {
                    handler.postDelayed(this, POLL_MS);
                }
            }
        };
        handler.postDelayed(pollRunnable, POLL_MS);
        call.resolve();
    }

    @PluginMethod
    public void stopWatch(PluginCall call) {
        stopPolling();
        call.resolve();
    }

    /** One-shot sweep — the web layer calls this when the app is resumed.
     * By default it RESCANS (rescan=true): the background poll may have
     * handed a photo to a frozen WebView that never processed it, so the
     * sweep must re-offer everything since `since` and let the JS layer's
     * own id dedupe drop whatever it already handled. */
    @PluginMethod
    public void checkNow(PluginCall call) {
        Double since = call.getDouble("since");
        long sinceTs = since != null ? since.longValue() : lastTimestamp;
        Boolean rescanArg = call.getBoolean("rescan", true);
        boolean rescan = rescanArg == null || rescanArg;
        List<JSObject> photos = collectNew(sinceTs, rescan);
        JSObject result = new JSObject();
        try {
            result.put("photos", JSArray.from(photos.toArray()));
        } catch (Exception e) {
            result.put("photos", new JSArray());
        }
        call.resolve(result);
    }

    /** Android 13+ requires a runtime grant for posting notifications. */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED) {
                call.resolve(grantedResult(true));
            } else {
                requestPermissionForAlias(NOTIF_PERMISSION_ALIAS, call, "onNotificationPermissionResult");
            }
        } else {
            call.resolve(grantedResult(true));
        }
    }

    @Permission(alias = "postNotifications")
    public void onNotificationPermissionResult(PluginCall call, boolean granted) {
        call.resolve(grantedResult(granted));
    }

    private JSObject grantedResult(boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        return result;
    }

    private void stopPolling() {
        if (handler != null && pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
        pollRunnable = null;
    }

    private boolean isAppFocused() {
        Activity activity = bridge.getActivity();
        return activity != null
                && activity.getWindow() != null
                && activity.getWindow().getDecorView().hasWindowFocus();
    }

    private void poll() {
        List<JSObject> photos = collectNew(lastTimestamp, false);
        boolean focused = isAppFocused();
        for (JSObject photo : photos) {
            notifyListeners("photoCaptured", photo);
            if (!focused) {
                postNotification();
            }
        }
    }

    /**
     * Returns every NEW readable camera photo since `since` (inclusive, so
     * two captures within the same second are both seen — delivered ids
     * prevent the 4-second poll from re-reading or double-delivering).
     * With rescan=true the delivered-id skip is bypassed so a resume sweep
     * can re-offer photos the WebView may never have processed; the JS side
     * dedupes by id. Advancing the watermark only counts once a photo is
     * fully readable — half-written captures retry on the next tick.
     */
    private List<JSObject> collectNew(long since, boolean rescan) {
        List<JSObject> found = new ArrayList<>();
        Cursor cursor = null;
        try {
            String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DATE_ADDED,
                    MediaStore.Images.Media.MIME_TYPE
            };
            // Only real camera shots — screenshots and saved images live
            // outside DCIM and must never trigger "post this photo?".
            String cameraOnly = MediaStore.Images.Media.RELATIVE_PATH + " LIKE 'DCIM/%'";
            String selection;
            String[] args;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                selection = MediaStore.Images.Media.DATE_ADDED + " >= ? AND " +
                        MediaStore.Images.Media.IS_PENDING + " = 0 AND " + cameraOnly;
                args = new String[]{String.valueOf(since)};
            } else {
                selection = MediaStore.Images.Media.DATE_ADDED + " >= ?";
                args = new String[]{String.valueOf(since)};
            }
            cursor = getContext().getContentResolver().query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    selection,
                    args,
                    MediaStore.Images.Media.DATE_ADDED + " ASC"
            );
            if (cursor == null) return found;
            while (cursor.moveToNext()) {
                long id = cursor.getLong(0);
                long added = cursor.getLong(1);
                String mime = cursor.getString(2);
                String idKey = String.valueOf(id);
                if (!rescan && deliveredIds.contains(idKey)) continue;
                Uri uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, String.valueOf(id));
                String base64 = readScaledBase64(uri);
                if (base64 == null) continue; // still being written — retry next tick
                deliveredIds.add(idKey);
                if (added > lastTimestamp) lastTimestamp = added;
                JSObject data = new JSObject();
                data.put("id", idKey);
                data.put("base64", base64);
                data.put("mimeType", mime != null ? mime : "image/jpeg");
                data.put("capturedAt", added);
                found.add(data);
            }
        } catch (Exception e) {
            // MediaStore can be briefly inconsistent right after a capture —
            // the next tick retries.
        } finally {
            if (cursor != null) cursor.close();
        }
        return found;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Photo contributions", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Photos you took near community places");
            NotificationManager nm = (NotificationManager)
                    getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    /** Heads-up notification that opens the app (visible over the camera). */
    private void postNotification() {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ensureChannel();
        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
        if (launch == null) return;
        PendingIntent contentIntent = PendingIntent.getActivity(
                getContext(), 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setContentTitle(placeName != null
                        ? "📸 Photo taken near " + placeName
                        : "📸 Photo taken near a mapped place")
                .setContentText("Tap to post it for your neighbors")
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH);
        NotificationManager nm = (NotificationManager)
                getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify((int) System.currentTimeMillis(), builder.build());
    }

    /** Reads a content URI and returns a downscaled JPEG as base64 (no prefix). */
    private String readScaledBase64(Uri uri) {
        try {
            InputStream in = getContext().getContentResolver().openInputStream(uri);
            if (in == null) return null;
            Bitmap bitmap = BitmapFactory.decodeStream(in);
            in.close();
            if (bitmap == null) return null;
            int w = bitmap.getWidth();
            int h = bitmap.getHeight();
            if (Math.max(w, h) > MAX_EDGE) {
                float scale = MAX_EDGE / (float) Math.max(w, h);
                bitmap = Bitmap.createScaledBitmap(
                        bitmap, Math.round(w * scale), Math.round(h * scale), true
                );
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out);
            bitmap.recycle();
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }
}
