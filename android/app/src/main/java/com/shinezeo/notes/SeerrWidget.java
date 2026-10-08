package com.shinezeo.notes;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/**
 * Widget « Films et séries » : une barre de recherche qui ouvre la fenêtre de recherche ({@link SeerrSearchActivity},
 * micro pour la dictée), et les dernières demandes faites à Seerr, relues toutes les 30 minutes sur le serveur Ostal.
 */
public class SeerrWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetViews.updateSeerr(context);
        Context app = context.getApplicationContext();
        TasksWidget.inBackground(this, () -> WidgetActions.refreshSeerr(app));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        WidgetViews.updateSeerr(context);
    }
}
