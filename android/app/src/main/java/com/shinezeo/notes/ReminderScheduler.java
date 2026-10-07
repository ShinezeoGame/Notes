package com.shinezeo.notes;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Rappels (échéances des papiers, événements des agendas) programmés par le téléphone lui-même : la liste des deux
 * prochains jours est lue sur le serveur Ostal (GET /api/reminders, avec la clé de l'espace), puis chaque rappel
 * devient une alarme qui affiche la notification à son heure, même application fermée ({@link ReminderReceiver}).
 * Liste relue à l'ouverture de l'application, après une modification et toutes les heures ({@link ReminderJob}).
 */
final class ReminderScheduler {

    static final String ACTION_REMINDER = "com.shinezeo.notes.REMINDER";
    private static final String TAG = "NotesReminders";
    private static final String PREFS = "NotesReminders";
    private static final String KEY_SERVER = "serverUrl";
    private static final String KEY_WS = "wsId";
    private static final String KEY_KEY = "key";
    private static final String KEY_LANG = "lang";
    private static final String KEY_ENABLED = "enabled";
    /** Alarmes en place : [{ key, at }]. */
    private static final String KEY_SCHEDULED = "scheduled";
    /** Rappels déjà affichés (clé → heure), gardés trois jours. */
    private static final String KEY_FIRED = "fired";
    private static final long KEEP_FIRED_MS = TimeUnit.DAYS.toMillis(3);

    private ReminderScheduler() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void saveSettings(Context context, String serverUrl, String wsId, String key, String lang, boolean enabled) {
        prefs(context)
            .edit()
            .putString(KEY_SERVER, serverUrl == null ? "" : serverUrl)
            .putString(KEY_WS, wsId == null ? "" : wsId)
            .putString(KEY_KEY, key == null ? "" : key)
            .putString(KEY_LANG, "en".equals(lang) ? "en" : "fr")
            .putBoolean(KEY_ENABLED, enabled)
            .apply();
    }

    static boolean isEnabled(Context context) {
        SharedPreferences p = prefs(context);
        return p.getBoolean(KEY_ENABLED, false) && !p.getString(KEY_SERVER, "").isEmpty() && !p.getString(KEY_WS, "").isEmpty();
    }

    static boolean isFrench(Context context) {
        return !"en".equals(prefs(context).getString(KEY_LANG, "fr"));
    }

    /** Relit la liste sur le serveur et met les alarmes à jour (rappels retirés : alarmes annulées). */
    static synchronized void refresh(Context context) throws Exception {
        SharedPreferences p = prefs(context);
        AlarmManager am = context.getSystemService(AlarmManager.class);
        if (am == null) return;
        JSONArray scheduled = new JSONArray(p.getString(KEY_SCHEDULED, "[]"));
        if (!isEnabled(context)) {
            for (int i = 0; i < scheduled.length(); i++) cancel(context, am, scheduled.getJSONObject(i).optString("key"));
            p.edit().putString(KEY_SCHEDULED, "[]").apply();
            return;
        }
        JSONArray list = fetch(p);
        long now = System.currentTimeMillis();
        JSONObject fired = firedSince(p, now);
        Set<String> wanted = new HashSet<>();
        JSONArray next = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject r = list.getJSONObject(i);
            String key = r.optString("key", "");
            long at = r.optLong("at", 0);
            if (key.isEmpty() || at <= 0 || fired.has(key) || at < now - TimeUnit.MINUTES.toMillis(1)) continue;
            schedule(context, am, key, at, r.optString("title", "Ostal"), r.optString("body", ""), r.optString("url", "#/"));
            wanted.add(key);
            next.put(new JSONObject().put("key", key).put("at", at));
        }
        for (int i = 0; i < scheduled.length(); i++) {
            String key = scheduled.getJSONObject(i).optString("key");
            if (!wanted.contains(key)) cancel(context, am, key);
        }
        p.edit().putString(KEY_SCHEDULED, next.toString()).putString(KEY_FIRED, fired.toString()).apply();
        Log.i(TAG, next.length() + " rappel(s) programmé(s)");
    }

    /** Rappel affiché : retenu pour ne pas le programmer de nouveau ; faux s'il l'était déjà. */
    static synchronized boolean markFired(Context context, String key) {
        SharedPreferences p = prefs(context);
        try {
            JSONObject fired = firedSince(p, System.currentTimeMillis());
            if (fired.has(key)) return false;
            fired.put(key, System.currentTimeMillis());
            p.edit().putString(KEY_FIRED, fired.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "Rappel non retenu", e);
        }
        return true;
    }

    private static JSONObject firedSince(SharedPreferences p, long now) {
        JSONObject out = new JSONObject();
        try {
            JSONObject all = new JSONObject(p.getString(KEY_FIRED, "{}"));
            Iterator<String> keys = all.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                long at = all.optLong(k, 0);
                if (now - at < KEEP_FIRED_MS) out.put(k, at);
            }
        } catch (Exception ignored) {
            // Liste illisible : repart de zéro.
        }
        return out;
    }

    private static JSONArray fetch(SharedPreferences p) throws Exception {
        String server = p.getString(KEY_SERVER, "").replaceAll("/+$", "");
        String lang = "en".equals(p.getString(KEY_LANG, "fr")) ? "en" : "fr";
        URL url = new URL(server + "/api/reminders?hours=48&lang=" + lang);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setUseCaches(false);
        conn.setRequestProperty("x-ws-id", p.getString(KEY_WS, ""));
        conn.setRequestProperty("x-ws-key", p.getString(KEY_KEY, ""));
        try {
            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) throw new IllegalStateException("Serveur : réponse " + code);
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int n;
                while ((n = in.read(buffer)) != -1 && body.size() < 2_000_000) body.write(buffer, 0, n);
                JSONArray list = new JSONObject(body.toString("UTF-8")).optJSONArray("reminders");
                return list != null ? list : new JSONArray();
            }
        } finally {
            conn.disconnect();
        }
    }

    /** Intention de l'alarme d'un rappel (une par rappel : adresse propre à sa clé). */
    private static PendingIntent alarmIntent(Context context, String key, Intent extras, int flags) {
        Intent intent = new Intent(context, ReminderReceiver.class)
            .setAction(ACTION_REMINDER)
            .setData(Uri.parse("ostal-reminder://" + Uri.encode(key)));
        if (extras != null) intent.putExtras(extras);
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void schedule(Context context, AlarmManager am, String key, long at, String title, String body, String url) {
        Intent extras = new Intent()
            .putExtra(ReminderReceiver.EXTRA_KEY, key)
            .putExtra(ReminderReceiver.EXTRA_TITLE, title)
            .putExtra(ReminderReceiver.EXTRA_BODY, body)
            .putExtra(ReminderReceiver.EXTRA_URL, url);
        PendingIntent pi = alarmIntent(context, key, extras, PendingIntent.FLAG_UPDATE_CURRENT);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setWindow(AlarmManager.RTC_WAKEUP, at, TimeUnit.MINUTES.toMillis(10), pi);
        } catch (SecurityException e) {
            // Alarmes exactes retirées entre-temps : à dix minutes près.
            am.setWindow(AlarmManager.RTC_WAKEUP, at, TimeUnit.MINUTES.toMillis(10), pi);
        }
    }

    private static void cancel(Context context, AlarmManager am, String key) {
        if (key == null || key.isEmpty()) return;
        PendingIntent pi = alarmIntent(context, key, null, PendingIntent.FLAG_NO_CREATE);
        if (pi != null) {
            am.cancel(pi);
            pi.cancel();
        }
    }
}
