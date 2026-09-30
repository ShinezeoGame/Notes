package com.shinezeo.notes;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Vérification périodique (toutes les heures, avec réseau) de la version du client proposée par le serveur Melo :
 * une notification signale une nouvelle version, une seule fois par version.
 */
public class UpdateCheckJob extends JobService {

    private static final String TAG = "NotesUpdates";
    private static final int JOB_ID = 4202;
    private static final long INTERVAL_MS = TimeUnit.HOURS.toMillis(1);
    private static final String PREFS = "NotesUpdates";
    private static final String KEY_SERVER = "serverUrl";
    private static final String KEY_CURRENT = "currentVersion";
    private static final String KEY_NOTIFY = "notify";
    private static final String KEY_LAST_NOTIFIED = "lastNotified";

    private volatile Thread worker;

    @Override
    public boolean onStartJob(JobParameters params) {
        worker = new Thread(
            () -> {
                try {
                    check(getApplicationContext());
                } catch (Exception ignored) {
                    // Serveur injoignable : nouvelle tentative à la prochaine échéance.
                }
                jobFinished(params, false);
            },
            "notes-update-check"
        );
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Thread t = worker;
        if (t != null) t.interrupt();
        return true;
    }

    static void saveSettings(Context context, String serverUrl, String currentVersion, boolean notify) {
        prefs(context)
            .edit()
            .putString(KEY_SERVER, serverUrl == null ? "" : serverUrl)
            .putString(KEY_CURRENT, currentVersion == null ? "" : currentVersion)
            .putBoolean(KEY_NOTIFY, notify)
            .apply();
    }

    static void setLastNotified(Context context, String version) {
        prefs(context).edit().putString(KEY_LAST_NOTIFIED, version == null ? "" : version).apply();
    }

    /**
     * Programme (ou annule) la vérification selon les réglages ; sans effet si elle est déjà programmée.
     * Renvoie faux si le système refuse la programmation (l'application continue de fonctionner sans notification).
     */
    static boolean schedule(Context context) {
        try {
            JobScheduler scheduler = context.getSystemService(JobScheduler.class);
            if (scheduler == null) return false;
            SharedPreferences p = prefs(context);
            boolean wanted = p.getBoolean(KEY_NOTIFY, true) && !p.getString(KEY_SERVER, "").isEmpty();
            if (!wanted) {
                scheduler.cancel(JOB_ID);
                return true;
            }
            JobInfo existing = scheduler.getPendingJob(JOB_ID);
            if (existing != null && existing.getIntervalMillis() == INTERVAL_MS) return true;
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, UpdateCheckJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(INTERVAL_MS)
                .setPersisted(true)
                .build();
            return scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS;
        } catch (RuntimeException e) {
            Log.w(TAG, "Vérification des mises à jour non programmée", e);
            return false;
        }
    }

    static void check(Context context) throws Exception {
        SharedPreferences p = prefs(context);
        String server = p.getString(KEY_SERVER, "");
        if (!p.getBoolean(KEY_NOTIFY, true) || server.isEmpty()) return;
        String remote = fetchRemoteVersion(server);
        if (remote == null || remote.isEmpty()) return;
        if (remote.equals(p.getString(KEY_CURRENT, "")) || remote.equals(p.getString(KEY_LAST_NOTIFIED, ""))) return;
        if (UpdateNotifier.show(context)) setLastNotified(context, remote);
    }

    private static String fetchRemoteVersion(String serverUrl) throws Exception {
        URL url = new URL(serverUrl.replaceAll("/+$", "") + "/api/app/version");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setUseCaches(false);
        try {
            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int n;
                while ((n = in.read(buffer)) != -1 && body.size() < 65536) body.write(buffer, 0, n);
                return new JSONObject(body.toString("UTF-8")).optString("version", "");
            }
        } finally {
            conn.disconnect();
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
