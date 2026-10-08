package com.shinezeo.notes;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/**
 * Widget « Allumer l'ordinateur » : un bouton par ordinateur réglé sur l'accueil d'Ostal (widget « Allumer un PC ») ;
 * le serveur Ostal envoie le signal Wake-on-LAN sur le réseau de la maison.
 */
public class WakeWidget extends AppWidgetProvider {

    static final String ACTION_WAKE = "com.shinezeo.notes.widget.WAKE";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_WAKE.equals(intent.getAction())) {
            String id = intent.getStringExtra(WidgetViews.EXTRA_COMPUTER);
            Context app = context.getApplicationContext();
            if (id != null) TasksWidget.inBackground(this, () -> WidgetActions.wake(app, id));
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetViews.updateWake(context);
        // Widget posé : ordinateurs relus (réglés depuis la dernière ouverture d'Ostal).
        Context app = context.getApplicationContext();
        TasksWidget.inBackground(this, () -> WidgetActions.refresh(app));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        WidgetViews.updateWake(context);
    }
}
