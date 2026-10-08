package com.shinezeo.notes;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** Widget « Raccourcis Ostal » : une section ou une nouvelle page d'un geste (raccourcis choisis dans l'application). */
public class ShortcutsWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetViews.updateShortcuts(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        // Taille changée : autant de raccourcis que la largeur en permet.
        WidgetViews.updateShortcuts(context);
    }
}
