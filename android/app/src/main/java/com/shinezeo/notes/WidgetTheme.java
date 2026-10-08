package com.shinezeo.notes;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.os.Build;
import android.widget.RemoteViews;
import org.json.JSONObject;

/**
 * Couleurs des widgets de l'écran d'accueil : celles du thème d'Ostal, ou des couleurs choisies (Réglages → Widgets du
 * téléphone), envoyées par l'application. Sans elles, ou avant Android 12 (qui ne permet pas de recolorer un fond
 * arrondi), les couleurs claires ou sombres du téléphone (res/values/widget_colors.xml).
 */
final class WidgetTheme {

    final int bg;
    final int tile;
    final int text;
    final int muted;
    final int icon;
    final int accent;
    final int onAccent;
    final int check;

    private WidgetTheme(JSONObject c) {
        bg = Color.parseColor(c.optString("bg"));
        tile = Color.parseColor(c.optString("tile"));
        text = Color.parseColor(c.optString("text"));
        muted = Color.parseColor(c.optString("muted"));
        icon = Color.parseColor(c.optString("icon"));
        accent = Color.parseColor(c.optString("accent"));
        onAccent = Color.parseColor(c.optString("onAccent"));
        check = Color.parseColor(c.optString("check"));
    }

    /** Couleurs choisies dans l'application, ou null : celles du téléphone. */
    static WidgetTheme of(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null;
        JSONObject colors = WidgetStore.colors(context);
        if (colors == null) return null;
        try {
            return new WidgetTheme(colors);
        } catch (Exception e) {
            return null;
        }
    }

    /** Fond d'une vue (forme arrondie gardée : seule sa couleur change). */
    static void background(RemoteViews rv, int viewId, int color) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) rv.setColorStateList(viewId, "setBackgroundTintList", ColorStateList.valueOf(color));
    }

    /** Icône d'une couleur (dessins d'un seul trait). */
    static void icon(RemoteViews rv, int viewId, int color) {
        rv.setInt(viewId, "setColorFilter", color);
    }
}
