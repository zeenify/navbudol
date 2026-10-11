package io.ionic.starter;

import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Watches the system MediaStore for NEW camera photos while the app is in the
 * foreground — the hook behind the one-tap contribution flow ("you took a
 * photo at a mapped place, want to post it?").
 *
 * Android does not allow background listening, so the watch runs only while
 * the web layer keeps it started (i.e. the app is open and the user is
 * on-site at a community place). Polling every 4 s is deliberately simple and
 * robust; IS_PENDING rows are filtered so half-written captures are skipped.
 */
@CapacitorPlugin(name = "PhotoWatcher")
public class PhotoWatcherPlugin extends Plugin {
    private static final long POLL_MS = 4000;
    private static final int MAX_EDGE = 1280;

    private Handler handler;
    private Runnable pollRunnable;
    private long lastTimestamp;

    @PluginMethod
    public void startWatch(PluginCall call) {
        Double since = call.getDouble("since");
        lastTimestamp = since != null ? since.longValue() : System.currentTimeMillis() / 1000;
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

    private void stopPolling() {
        if (handler != null && pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
        pollRunnable = null;
    }

    private void poll() {
        Cursor cursor = null;
        try {
            String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DATE_ADDED,
                    MediaStore.Images.Media.MIME_TYPE
            };
            String selection;
            String[] args;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                selection = MediaStore.Images.Media.DATE_ADDED + " > ? AND " +
                        MediaStore.Images.Media.IS_PENDING + " = 0";
                args = new String[]{String.valueOf(lastTimestamp)};
            } else {
                selection = MediaStore.Images.Media.DATE_ADDED + " > ?";
                args = new String[]{String.valueOf(lastTimestamp)};
            }
            cursor = getContext().getContentResolver().query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    selection,
                    args,
                    MediaStore.Images.Media.DATE_ADDED + " ASC"
            );
            if (cursor == null) return;
            while (cursor.moveToNext()) {
                long id = cursor.getLong(0);
                long added = cursor.getLong(1);
                String mime = cursor.getString(2);
                Uri uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, String.valueOf(id));
                String base64 = readScaledBase64(uri);
                // Only advance the watermark once the photo is fully readable —
                // half-written captures retry on the next tick.
                if (base64 == null) continue;
                if (added > lastTimestamp) lastTimestamp = added;
                JSObject data = new JSObject();
                data.put("base64", base64);
                data.put("mimeType", mime != null ? mime : "image/jpeg");
                data.put("capturedAt", added);
                notifyListeners("photoCaptured", data);
            }
        } catch (Exception e) {
            // MediaStore can be briefly inconsistent right after a capture —
            // the next tick retries.
        } finally {
            if (cursor != null) cursor.close();
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
