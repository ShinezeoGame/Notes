package com.shinezeo.notes;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Après un appui sur le widget « Allumer l'ordinateur » : état de l'ordinateur relu toutes les quelques secondes, jusqu'à
 * ce qu'il réponde (démarrage) ou ne réponde plus (extinction), au plus {@link WidgetActions#PHASE_MS}.
 */
public class WakeStatusJob extends JobService {

    private static final String TAG = "NotesWidgets";
    private static final int JOB_ID = 4205;
    private static final long EVERY_MS = 5000;

    private volatile Thread worker;

    @Override
    public boolean onStartJob(JobParameters params) {
        Context app = getApplicationContext();
        worker = new Thread(
            () -> {
                long end = System.currentTimeMillis() + WidgetActions.PHASE_MS + 30_000L;
                try {
                    while (System.currentTimeMillis() < end && !Thread.currentThread().isInterrupted()) {
                        if (!WidgetActions.checkPower(app)) break;
                        Thread.sleep(EVERY_MS);
                    }
                } catch (InterruptedException ignored) {
                    // Arrêté par Android : repris plus tard (onStopJob).
                    return;
                } catch (Exception e) {
                    Log.w(TAG, "Suivi de l'ordinateur interrompu", e);
                }
                jobFinished(params, false);
            },
            "notes-widget-power"
        );
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Thread t = worker;
        if (t != null) t.interrupt();
        // Démarrage ou extinction pas encore arrivé au bout : suivi repris.
        return true;
    }

    /** Lance le suivi (le relance s'il est déjà en cours). */
    static void start(Context context) {
        try {
            JobScheduler scheduler = context.getSystemService(JobScheduler.class);
            if (scheduler == null) return;
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, WakeStatusJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build();
            scheduler.schedule(job);
        } catch (Exception e) {
            Log.w(TAG, "Suivi de l'ordinateur non lancé", e);
        }
    }
}
