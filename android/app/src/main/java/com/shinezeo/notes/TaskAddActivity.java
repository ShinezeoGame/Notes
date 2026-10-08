package com.shinezeo.notes;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.res.Configuration;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.ContextThemeWrapper;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * « + » du widget Tâches : petite fenêtre « Nouvelle tâche » par-dessus l'écran d'accueil, sans ouvrir Ostal. La tâche
 * apparaît tout de suite dans le widget, puis part au serveur ({@link WidgetActions#add}).
 */
public class TaskAddActivity extends Activity {

    private static final String TAG = "NotesWidgets";
    private boolean sent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String list = getIntent().getStringExtra(WidgetViews.EXTRA_LIST);
        if (list == null) {
            finish();
            return;
        }
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        Context themed = new ContextThemeWrapper(
            this,
            night ? android.R.style.Theme_DeviceDefault_Dialog_Alert : android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
        );
        EditText input = new EditText(themed);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        input.setHint(WidgetStore.tr(this, "Nouvelle tâche…", "New task…"));
        FrameLayout box = new FrameLayout(themed);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 3, pad, 0);
        box.addView(input);

        AlertDialog dialog = new AlertDialog.Builder(themed)
            .setTitle(title(list))
            .setView(box)
            .setPositiveButton(WidgetStore.tr(this, "Ajouter", "Add"), (d, which) -> submit(list, input))
            .setNegativeButton(WidgetStore.tr(this, "Annuler", "Cancel"), null)
            .setOnDismissListener((d) -> finish())
            .create();
        input.setOnEditorActionListener((v, actionId, event) -> {
            // « Terminé » du clavier, ou Entrée d'un clavier physique (appelé à l'appui puis au relâchement).
            boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER;
            if (actionId != EditorInfo.IME_ACTION_DONE && !enter) return false;
            if (enter && event.getAction() != KeyEvent.ACTION_DOWN) return true;
            submit(list, input);
            dialog.dismiss();
            return true;
        });
        if (dialog.getWindow() != null) dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        dialog.show();
        input.requestFocus();
    }

    /** « Ajouter à Courses » (titre de la liste), ou « Nouvelle tâche ». */
    private String title(String listId) {
        try {
            JSONArray lists = WidgetStore.data(this).optJSONArray("tasks");
            for (int i = 0; lists != null && i < lists.length(); i++) {
                JSONObject l = lists.optJSONObject(i);
                if (l != null && l.optString("id").equals(listId) && !l.optString("title", "").trim().isEmpty()) {
                    return WidgetStore.tr(this, "Ajouter à « ", "Add to “") + l.optString("title").trim() + WidgetStore.tr(this, " »", "”");
                }
            }
        } catch (Exception ignored) {
            // Titre par défaut.
        }
        return WidgetStore.tr(this, "Nouvelle tâche", "New task");
    }

    private void submit(String list, EditText input) {
        String text = input.getText().toString().trim();
        if (sent || text.isEmpty()) return;
        sent = true;
        Context app = getApplicationContext();
        new Thread(
            () -> {
                try {
                    WidgetActions.add(app, list, text);
                } catch (Exception e) {
                    Log.w(TAG, "Tâche non ajoutée", e);
                }
            },
            "notes-widget-add"
        ).start();
    }
}
