package com.shinezeo.notes;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

/**
 * Widget « Tâches » : une liste de l'accueil d'Ostal. Toucher une tâche la coche ou la décoche, « + » en ajoute une
 * ({@link TaskAddActivity}), la flèche relit la liste ; relue aussi toutes les 30 minutes sur le serveur.
 */
public class TasksWidget extends AppWidgetProvider {

    static final String ACTION_TOGGLE = "com.shinezeo.notes.widget.TOGGLE";
    static final String ACTION_REFRESH = "com.shinezeo.notes.widget.REFRESH";
    private static final String TAG = "NotesWidgets";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Context app = context.getApplicationContext();
        if (ACTION_TOGGLE.equals(action)) {
            String list = intent.getStringExtra(WidgetViews.EXTRA_LIST);
            String task = intent.getStringExtra(WidgetViews.EXTRA_TASK);
            if (list != null && task != null) inBackground(this, () -> WidgetActions.toggle(app, list, task));
            return;
        }
        if (ACTION_REFRESH.equals(action)) {
            inBackground(this, () -> WidgetActions.refresh(app));
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetViews.updateTasks(context);
        Context app = context.getApplicationContext();
        inBackground(this, () -> WidgetActions.refresh(app));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        WidgetViews.updateTasks(context);
    }

    /** Travail réseau hors du fil principal ; Android garde l'application en vie jusqu'à sa fin (quelques secondes). */
    static void inBackground(BroadcastReceiver receiver, Runnable work) {
        BroadcastReceiver.PendingResult result = receiver.goAsync();
        new Thread(
            () -> {
                try {
                    work.run();
                } catch (Exception e) {
                    Log.w(TAG, "Action du widget impossible", e);
                } finally {
                    result.finish();
                }
            },
            "notes-widget"
        ).start();
    }
}
