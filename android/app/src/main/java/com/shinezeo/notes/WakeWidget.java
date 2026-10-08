package com.shinezeo.notes;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/**
 * Widget « Allumer l'ordinateur » : un bouton par ordinateur réglé sur l'accueil d'Ostal (widget « Allumer un PC »),
 * avec son état (allumé, éteint). Éteint : le serveur Ostal envoie le signal Wake-on-LAN sur le réseau de la maison ;
 * allumé : fenêtre « Éteindre … ? » ({@link PowerActivity}).
 */
public class WakeWidget extends AppWidgetProvider {

    static final String ACTION_WAKE = "com.shinezeo.notes.widget.WAKE";
    /** Démarrage ou extinction en cours : appui = état relu tout de suite. */
    static final String ACTION_CHECK = "com.shinezeo.notes.widget.CHECK_POWER";

    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        if (ACTION_WAKE.equals(intent.getAction())) {
            String id = intent.getStringExtra(WidgetViews.EXTRA_COMPUTER);
            if (id != null) TasksWidget.inBackground(this, () -> WidgetActions.wake(app, id));
            return;
        }
        if (ACTION_CHECK.equals(intent.getAction())) {
            TasksWidget.inBackground(this, () -> {
                if (WidgetActions.checkPower(app)) WakeStatusJob.start(app);
            });
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetViews.updateWake(context);
        // Widget posé, et toutes les 30 minutes : ordinateurs relus (réglés depuis la dernière ouverture d'Ostal), avec
        // leur état.
        Context app = context.getApplicationContext();
        TasksWidget.inBackground(this, () -> WidgetActions.refresh(app));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        WidgetViews.updateWake(context);
    }
}
