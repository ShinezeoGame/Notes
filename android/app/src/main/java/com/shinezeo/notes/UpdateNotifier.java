package com.shinezeo.notes;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * Notification « Mise à jour de Melo disponible » (dans la langue choisie dans l'application) ; la toucher ouvre
 * l'application et lance la mise à jour.
 */
final class UpdateNotifier {

    static final String EXTRA_UPDATE = "com.shinezeo.notes.UPDATE";
    private static final String CHANNEL_ID = "updates";
    private static final int NOTIFICATION_ID = 4201;

    private UpdateNotifier() {}

    /** Affiche la notification ; faux si les notifications sont refusées ou désactivées. */
    static boolean show(Context context) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return false;
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false;
        }

        boolean fr = UpdateCheckJob.isFrench(context);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, fr ? "Mises à jour" : "Updates", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription(fr ? "Nouvelle version de Melo disponible" : "New version of Melo available");
            nm.createNotificationChannel(channel);
            builder = new Notification.Builder(context, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(context);
        }

        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_UPDATE, true);
        PendingIntent pending = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        builder
            .setSmallIcon(R.drawable.ic_stat_notes)
            .setColor(0xFF2383E2)
            .setContentTitle(fr ? "Mise à jour de Melo disponible" : "Melo update available")
            .setContentText(fr ? "Touchez pour installer la nouvelle version." : "Tap to install the new version.")
            .setContentIntent(pending)
            .setAutoCancel(true);
        try {
            nm.notify(NOTIFICATION_ID, builder.build());
            return true;
        } catch (SecurityException e) {
            return false;
        }
    }

    static void cancel(Context context) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
    }
}
