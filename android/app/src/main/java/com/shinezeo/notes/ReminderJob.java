package com.shinezeo.notes;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;
import java.util.concurrent.TimeUnit;

/**
 * Relecture des rappels toutes les heures (avec réseau), conservée après un redémarrage du téléphone : les alarmes
 * des deux prochains jours restent à jour même si l'application n'est pas ouverte.
 */
public class ReminderJob extends JobService {

    private static final String TAG = "NotesReminders";
    static final int JOB_ID = 4203;
    private static final long INTERVAL_MS = TimeUnit.HOURS.toMillis(1);

    private volatile Thread worker;

    @Override
    public boolean onStartJob(JobParameters params) {
        worker = new Thread(
            () -> {
                try {
                    ReminderScheduler.refresh(getApplicationContext());
                } catch (Exception e) {
                    // Serveur injoignable : les alarmes déjà en place restent ; nouvel essai à la prochaine échéance.
                    Log.w(TAG, "Rappels non relus", e);
                }
                jobFinished(params, false);
            },
            "notes-reminders-job"
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

    /** Programme (ou annule) la relecture selon les réglages ; faux si le système la refuse. */
    static boolean schedule(Context context) {
        try {
            JobScheduler scheduler = context.getSystemService(JobScheduler.class);
            if (scheduler == null) return false;
            if (!ReminderScheduler.isEnabled(context)) {
                scheduler.cancel(JOB_ID);
                return true;
            }
            JobInfo existing = scheduler.getPendingJob(JOB_ID);
            if (existing != null && existing.getIntervalMillis() == INTERVAL_MS) return true;
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, ReminderJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(INTERVAL_MS)
                .setPersisted(true)
                .build();
            return scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS;
        } catch (RuntimeException e) {
            Log.w(TAG, "Relecture des rappels non programmée", e);
            return false;
        }
    }
}
