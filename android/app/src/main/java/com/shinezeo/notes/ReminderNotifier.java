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

/** Notification d'un rappel (papier, événement d'agenda) ; la toucher ouvre Ostal sur la page du rappel. */
final class ReminderNotifier {

    /** Page à ouvrir (« #/papiers/… », « #/agenda ») : lue par {@link RemindersPlugin}. */
    static final String EXTRA_OPEN = "com.shinezeo.notes.OPEN_URL";
    private static final String CHANNEL_ID = "reminders";
    private static final int NOTIFICATION_ID = 4301;

    private ReminderNotifier() {}

    /** Affiche la notification ; faux si les notifications sont refusées ou désactivées. */
    static boolean show(Context context, String key, String title, String body, String url) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return false;
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false;
        }
        boolean fr = ReminderScheduler.isFrench(context);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, fr ? "Rappels" : "Reminders", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription(fr ? "Échéances des papiers et événements des agendas" : "Paper due dates and calendar events");
            nm.createNotificationChannel(channel);
            builder = new Notification.Builder(context, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(context);
        }
        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_OPEN, url);
        // Un code par rappel : chaque notification garde sa propre page.
        PendingIntent pending = PendingIntent.getActivity(context, key.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        builder
            .setSmallIcon(R.drawable.ic_stat_notes)
            .setColor(0xFF2383E2)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setShowWhen(true)
            .setContentIntent(pending)
            .setAutoCancel(true);
        try {
            nm.notify(key, NOTIFICATION_ID, builder.build());
            return true;
        } catch (SecurityException e) {
            return false;
        }
    }
}
