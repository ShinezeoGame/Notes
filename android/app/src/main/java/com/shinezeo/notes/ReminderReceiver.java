package com.shinezeo.notes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarme d'un rappel arrivée à son heure ({@link ReminderScheduler}) : notification affichée, une seule fois. */
public class ReminderReceiver extends BroadcastReceiver {

    static final String EXTRA_KEY = "com.shinezeo.notes.REMINDER_KEY";
    static final String EXTRA_TITLE = "com.shinezeo.notes.REMINDER_TITLE";
    static final String EXTRA_BODY = "com.shinezeo.notes.REMINDER_BODY";
    static final String EXTRA_URL = "com.shinezeo.notes.REMINDER_URL";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ReminderScheduler.ACTION_REMINDER.equals(intent.getAction())) return;
        String key = intent.getStringExtra(EXTRA_KEY);
        if (key == null || key.isEmpty() || !ReminderScheduler.isEnabled(context)) return;
        if (!ReminderScheduler.markFired(context, key)) return;
        ReminderNotifier.show(
            context,
            key,
            orDefault(intent.getStringExtra(EXTRA_TITLE), "Ostal"),
            orDefault(intent.getStringExtra(EXTRA_BODY), ""),
            orDefault(intent.getStringExtra(EXTRA_URL), "#/")
        );
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
