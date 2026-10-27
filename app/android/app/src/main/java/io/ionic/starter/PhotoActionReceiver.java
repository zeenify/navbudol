package io.ionic.starter;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

/**
 * The notification's "Add" button lands here. It simply relays the request
 * to the foreground service, which does the actual MediaStore read + POST
 * on its own thread. Receiver code must never block or touch the network.
 */
public class PhotoActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Intent svc = new Intent(context, PhotoWatchService.class);
        svc.setAction(PhotoWatchService.ACTION_UPLOAD);
        svc.putExtra(PhotoWatchService.EXTRA_PHOTO_IDS, intent.getLongArrayExtra(PhotoWatchService.EXTRA_PHOTO_IDS));
        svc.putExtra(PhotoWatchService.EXTRA_NOTIF_ID, intent.getIntExtra(PhotoWatchService.EXTRA_NOTIF_ID, 0));
        svc.putExtra(PhotoWatchService.EXTRA_PLACE, intent.getStringExtra(PhotoWatchService.EXTRA_PLACE));
        ContextCompat.startForegroundService(context, svc);
    }
}
