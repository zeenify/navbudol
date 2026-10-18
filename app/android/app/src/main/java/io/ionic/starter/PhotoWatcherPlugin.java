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
 * the background at that moment. Detection therefore works in three layers:
 *  - PhotoWatchService, a FOREGROUND service started whenever an on-site
 *    watch is armed: it stays alive while the camera app is foreground and
 *    posts the heads-up notification (background handler freezing kills any
 *    poll scheduled from the activity, which is why the service exists);
 *  - an in-focus poll here for the JS 'photoCaptured' event (in-app card
 *    when the user happens to shoot with the app itself open);
 *  - a checkNow() resume sweep that re-offers anything missed.
 *
 * Reading OTHER apps' camera photos requires READ_MEDIA_IMAGES (33+) /
 * READ_EXTERNAL_STORAGE (≤32) at runtime — without the grant the MediaStore
 * query silently returns zero rows, which is exactly the "no notification"
 * failure mode. The grant is requested when the watch starts.
 */
@CapacitorPlugin(
    name = "PhotoWatcher",
    permissions = {
        @Permission(alias = "postNotifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "readMedia", strings = {
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_EXTERNAL_STORAGE
        })
    }
)
public class PhotoWatcherPlugin extends Plugin {
    private static final long POLL_MS = 4000;
    private static final int MAX_EDGE = 1280;
    private static final String CHANNEL_ID = "navbudol-photos";
    private static final String NOTIF_PERMISSION_ALIAS = "postNotifications";
    private static final String READ_MEDIA_ALIAS = "readMedia";

    private Handler handler;
    private Runnable pollRunnable;
    private long lastTimestamp;
    /** Photos surfaced this session — ids let the >= since query rescan the
     * same second without re-reading or double-delivering anything. */
    private final Set<String> deliveredIds = new HashSet<>();
    /** Place name for the notification text (set by startWatch). */
    private String placeName;
    private PluginCall pendingStartCall;

    @PluginMethod
    public void startWatch(PluginCall call) {
        Double since = call.getDouble("since");
        lastTimestamp = since != null ? since.longValue() : System.currentTimeMillis() / 1000;
        String name = call.getString("placeName");
        placeName = name != null && !name.isEmpty() ? name : null;
        ensureChannel();
        stopPolling();
        // Storage grant first: without it the MediaStore query sees zero
        // camera photos. The poll + foreground service start after the
        // permission callback (or immediately when already granted).
        if (hasMediaRead()) {
            beginWatch(call);
        } else {
            pendingStartCall = call;
            requestPermissionForAlias(READ_MEDIA_ALIAS, call, "onMediaPermissionResult");
        }
    }

    private void beginWatch(PluginCall call) {
        handler = new Handler(Looper.getMainLooper());
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                pollFocused();
                if (pollRunnable != null && handler != null) {
                    handler.postDelayed(this, POLL_MS);
                }
            }
        };
        handler.postDelayed(pollRunnable, POLL_MS);
        // The FOREGROUND service owns background detection: it survives the
        // process freeze that would kill everything scheduled above.
        startBackgroundWatch();
        if (call != null) call.resolve();
    }

    private void startBackgroundWatch() {
        android.content.Intent intent = new android.content.Intent(getContext(), PhotoWatchService.class);
        intent.putExtra(PhotoWatchService.EXTRA_SINCE, lastTimestamp);
        if (placeName != null) intent.putExtra(PhotoWatchService.EXTRA_PLACE, placeName);
        ContextCompat.startForegroundService(getContext(), intent);
    }

    private void stopBackgroundWatch() {
        android.content.Intent intent = new android.content.Intent(getContext(), PhotoWatchService.class);
        getContext().stopService(intent);
    }

    private boolean hasMediaRead() {
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_MEDIA_IMAGES)
                    == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void stopWatch(PluginCall call) {
        stopPolling();
        stopBackgroundWatch();
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

    /** Continues the deferred startWatch once the storage grant is answered. */
    @Permission(alias = "readMedia")
    public void onMediaPermissionResult(PluginCall call, boolean granted) {
        if (granted) {
            beginWatch(pendingStartCall);
        } else if (pendingStartCall != null) {
            // Still start: the query just returns zero rows until granted, and
            // re-asking later happens on the next watch arm.
            beginWatch(pendingStartCall);
        }
        pendingStartCall = null;
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

    /** In-app delivery only — the FOREGROUND service owns notifications, so
     * background freezes can never drop or double-post an alert here. */
    private void pollFocused() {
        boolean focused = isAppFocused();
        if (!focused) return;
        List<JSObject> photos = collectNew(lastTimestamp, false);
        for (JSObject photo : photos) {
            notifyListeners("photoCaptured", photo);
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
