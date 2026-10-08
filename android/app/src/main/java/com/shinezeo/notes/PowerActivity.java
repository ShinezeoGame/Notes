package com.shinezeo.notes;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Log;
import android.view.ContextThemeWrapper;
import org.json.JSONObject;

/**
 * Widget « Allumer l'ordinateur », ordinateur allumé : petite fenêtre « Éteindre … ? » par-dessus l'écran d'accueil.
 * L'ordre part au serveur, qui le transmet à Ostal pour Windows sur cet ordinateur ({@link WidgetActions#powerOff}) ;
 * sans lui, la fenêtre explique comment le permettre.
 */
public class PowerActivity extends Activity {

    private static final String TAG = "NotesWidgets";
    private boolean sent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String id = getIntent().getStringExtra(WidgetViews.EXTRA_COMPUTER);
        JSONObject pc = id == null ? null : WidgetStore.computer(this, id);
        if (pc == null) {
            finish();
            return;
        }
        String name = pc.optString("name", "").trim();
        if (name.isEmpty()) name = WidgetStore.tr(this, "Ordinateur", "Computer");
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        Context themed = new ContextThemeWrapper(
            this,
            night ? android.R.style.Theme_DeviceDefault_Dialog_Alert : android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
        );
        JSONObject state = WidgetStore.power(this, id);
        AlertDialog.Builder dialog = new AlertDialog.Builder(themed).setOnDismissListener((d) -> finish());
        if (state.has("canOff") && !state.optBoolean("canOff")) {
            // Ostal pour Windows n'attend pas d'ordres sur cet ordinateur (application absente, fermée ou option décochée).
            dialog
                .setTitle(name)
                .setMessage(
                    WidgetStore.tr(
                        this,
                        "Pour l’éteindre d’ici : sur cet ordinateur, ouvrez Ostal pour Windows et cochez « Pouvoir éteindre cet ordinateur depuis Ostal » (Réglages).",
                        "To turn it off from here: on that computer, open Ostal for Windows and check “Allow turning off this computer from Ostal” (Settings)."
                    )
                )
                .setPositiveButton(WidgetStore.tr(this, "Compris", "Got it"), null);
        } else {
            dialog
                .setTitle(WidgetStore.tr(this, "Éteindre " + name + " ?", "Turn off " + name + "?"))
                .setMessage(
                    WidgetStore.tr(
                        this,
                        "Windows s’arrêtera 30 secondes plus tard : le travail non enregistré sur cet ordinateur serait perdu.",
                        "Windows will shut down 30 seconds later: unsaved work on that computer would be lost."
                    )
                )
                .setPositiveButton(WidgetStore.tr(this, "Éteindre", "Turn off"), (d, which) -> submit(id))
                .setNegativeButton(WidgetStore.tr(this, "Annuler", "Cancel"), null);
        }
        dialog.show();
    }

    private void submit(String id) {
        if (sent) return;
        sent = true;
        Context app = getApplicationContext();
        new Thread(
            () -> {
                try {
                    WidgetActions.powerOff(app, id);
                } catch (Exception e) {
                    Log.w(TAG, "Ordinateur non éteint", e);
                }
            },
            "notes-widget-off"
        ).start();
    }
}
