package com.shinezeo.notes;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** Contenu des widgets de l'écran d'accueil (raccourcis, tâches, ordinateurs), refait après chaque changement. */
final class WidgetViews {

    static final String EXTRA_LIST = "com.shinezeo.notes.widget.LIST";
    static final String EXTRA_TASK = "com.shinezeo.notes.widget.TASK";
    static final String EXTRA_COMPUTER = "com.shinezeo.notes.widget.COMPUTER";
    private static final int MAX_TASKS = 12;
    private static final int MAX_COMPUTERS = 4;
    /** Largeur d'un raccourci (dp) : au-delà de la largeur du widget, les derniers sont masqués. */
    private static final int SHORTCUT_WIDTH = 64;
    private static final int[] SLOTS = { R.id.sc_slot1, R.id.sc_slot2, R.id.sc_slot3, R.id.sc_slot4, R.id.sc_slot5, R.id.sc_slot6 };
    private static final int[] ICONS = { R.id.sc_icon1, R.id.sc_icon2, R.id.sc_icon3, R.id.sc_icon4, R.id.sc_icon5, R.id.sc_icon6 };
    private static final int[] LABELS = { R.id.sc_label1, R.id.sc_label2, R.id.sc_label3, R.id.sc_label4, R.id.sc_label5, R.id.sc_label6 };

    private interface Builder {
        RemoteViews build(Context context, Bundle options);
    }

    private WidgetViews() {}

    static void updateAll(Context context) {
        updateShortcuts(context);
        updateTasks(context);
        updateWake(context);
    }

    static void updateShortcuts(Context context) {
        update(context, ShortcutsWidget.class, WidgetViews::shortcuts);
    }

    static void updateTasks(Context context) {
        update(context, TasksWidget.class, WidgetViews::tasks);
    }

    static void updateWake(Context context) {
        update(context, WakeWidget.class, WidgetViews::wake);
    }

    /** Widgets de ce type posés sur l'écran d'accueil. */
    static int[] placed(Context context, Class<?> provider) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, provider));
    }

    private static void update(Context context, Class<?> provider, Builder builder) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : placed(context, provider)) manager.updateAppWidget(id, builder.build(context, manager.getAppWidgetOptions(id)));
    }

    // ---------- Raccourcis ----------

    static RemoteViews shortcuts(Context context, Bundle options) {
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_shortcuts);
        JSONArray list = WidgetStore.shortcuts(context);
        int width = options != null ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) : 0;
        int fit = width > 0 ? Math.max(1, width / SHORTCUT_WIDTH) : SLOTS.length;
        int count = Math.min(Math.min(list.length(), fit), SLOTS.length);
        for (int i = 0; i < SLOTS.length; i++) {
            JSONObject s = i < count ? list.optJSONObject(i) : null;
            if (s == null) {
                rv.setViewVisibility(SLOTS[i], View.GONE);
                continue;
            }
            String label = s.optString("label", "");
            rv.setViewVisibility(SLOTS[i], View.VISIBLE);
            rv.setImageViewResource(ICONS[i], icon(s.optString("icon", "")));
            rv.setTextViewText(LABELS[i], label);
            rv.setContentDescription(SLOTS[i], label);
            rv.setOnClickPendingIntent(SLOTS[i], open(context, s.optString("url", "#/"), 100 + i));
        }
        return rv;
    }

    /** Icône d'un raccourci (nom envoyé par l'application). */
    static int icon(String name) {
        switch (name) {
            case "new_page":
                return R.drawable.ic_w_new_page;
            case "notes":
                return R.drawable.ic_w_notes;
            case "agenda":
                return R.drawable.ic_w_agenda;
            case "papers":
                return R.drawable.ic_w_papers;
            case "camera":
                return R.drawable.ic_w_camera;
            case "pdf":
                return R.drawable.ic_w_pdf;
            case "home":
                return R.drawable.ic_w_home;
            case "cameras":
                return R.drawable.ic_w_cameras;
            case "homelab":
                return R.drawable.ic_w_homelab;
            case "tasks":
                return R.drawable.ic_w_tasks;
            case "computer":
                return R.drawable.ic_w_computer;
            default:
                return R.drawable.ic_w_dashboard;
        }
    }

    // ---------- Tâches ----------

    static RemoteViews tasks(Context context, Bundle options) {
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);
        rv.removeAllViews(R.id.tk_list);
        rv.setOnClickPendingIntent(R.id.tk_title_bar, open(context, "#/", 200));
        rv.setOnClickPendingIntent(R.id.tk_refresh, broadcast(context, TasksWidget.class, TasksWidget.ACTION_REFRESH, "refresh"));
        rv.setContentDescription(R.id.tk_refresh, WidgetStore.tr(context, "Actualiser", "Refresh"));
        JSONObject list = WidgetStore.currentList(context);
        if (list == null) {
            rv.setTextViewText(R.id.tk_title, WidgetStore.tr(context, "Tâches", "Tasks"));
            rv.setViewVisibility(R.id.tk_add, View.GONE);
            String text = WidgetStore.hasData(context)
                ? WidgetStore.tr(context, "Ajoutez une liste « Tâches » à l’accueil d’Ostal.", "Add a “Tasks” list to Ostal’s home.")
                : WidgetStore.tr(context, "Ouvrez Ostal une fois pour afficher vos tâches.", "Open Ostal once to show your tasks.");
            showMessage(rv, R.id.tk_list, R.id.tk_empty, text);
            rv.setOnClickPendingIntent(R.id.tk_empty, open(context, "#/", 201));
            return rv;
        }
        String listId = list.optString("id");
        String title = list.optString("title", "").trim();
        rv.setTextViewText(R.id.tk_title, title.isEmpty() ? WidgetStore.tr(context, "Tâches", "Tasks") : title);
        rv.setViewVisibility(R.id.tk_add, View.VISIBLE);
        rv.setContentDescription(R.id.tk_add, WidgetStore.tr(context, "Ajouter une tâche", "Add a task"));
        Intent add = new Intent(context, TaskAddActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK)
            .putExtra(EXTRA_LIST, listId);
        rv.setOnClickPendingIntent(
            R.id.tk_add,
            PendingIntent.getActivity(context, 202, add, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
        );
        JSONArray items = list.optJSONArray("items");
        boolean hideDone = list.optBoolean("hideDone");
        int shown = 0;
        for (int i = 0; items != null && i < items.length() && shown < MAX_TASKS; i++) {
            JSONObject t = items.optJSONObject(i);
            if (t == null) continue;
            boolean done = t.optBoolean("done");
            if (done && hideDone) continue;
            String text = t.optString("text", "");
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_task);
            row.setImageViewResource(R.id.tk_check, done ? R.drawable.widget_check_on : R.drawable.widget_check_off);
            if (done) {
                SpannableString struck = new SpannableString(text);
                struck.setSpan(new StrikethroughSpan(), 0, struck.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                row.setTextViewText(R.id.tk_text_done, struck);
                row.setViewVisibility(R.id.tk_text_done, View.VISIBLE);
                row.setViewVisibility(R.id.tk_text, View.GONE);
            } else {
                row.setTextViewText(R.id.tk_text, text);
                row.setViewVisibility(R.id.tk_text, View.VISIBLE);
                row.setViewVisibility(R.id.tk_text_done, View.GONE);
            }
            row.setContentDescription(R.id.tk_row, (done ? WidgetStore.tr(context, "Faite : ", "Done: ") : WidgetStore.tr(context, "À faire : ", "To do: ")) + text);
            Intent toggle = new Intent(context, TasksWidget.class)
                .setAction(TasksWidget.ACTION_TOGGLE)
                // Adresse propre à chaque tâche : sinon Android confondrait les intentions de deux lignes.
                .setData(Uri.parse("ostal-widget://task/" + Uri.encode(listId) + "/" + Uri.encode(t.optString("id"))))
                .putExtra(EXTRA_LIST, listId)
                .putExtra(EXTRA_TASK, t.optString("id"));
            row.setOnClickPendingIntent(R.id.tk_row, PendingIntent.getBroadcast(context, 0, toggle, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            rv.addView(R.id.tk_list, row);
            shown++;
        }
        if (shown == 0) showMessage(rv, R.id.tk_list, R.id.tk_empty, WidgetStore.tr(context, "Rien à faire pour l’instant.", "Nothing to do for now."));
        else showList(rv, R.id.tk_list, R.id.tk_empty);
        return rv;
    }

    // ---------- Ordinateurs ----------

    static RemoteViews wake(Context context, Bundle options) {
        RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.widget_wake);
        rv.removeAllViews(R.id.wk_list);
        rv.setTextViewText(R.id.wk_title, WidgetStore.tr(context, "Allumer l’ordinateur", "Turn on computer"));
        rv.setOnClickPendingIntent(R.id.wk_title_bar, open(context, "#/", 300));
        JSONArray computers = WidgetStore.data(context).optJSONArray("computers");
        String message = null;
        if (!WidgetStore.hasServer(context)) message = WidgetStore.tr(context, "Un serveur Ostal est nécessaire pour allumer un ordinateur.", "An Ostal server is needed to turn on a computer.");
        else if (computers == null || computers.length() == 0) message = WidgetStore.tr(context, "Réglez « Allumer un PC » sur l’accueil d’Ostal.", "Set up “Wake a PC” on Ostal’s home.");
        if (message != null) {
            showMessage(rv, R.id.wk_list, R.id.wk_empty, message);
            rv.setOnClickPendingIntent(R.id.wk_empty, open(context, "#/", 301));
            return rv;
        }
        for (int i = 0; i < computers.length() && i < MAX_COMPUTERS; i++) {
            JSONObject pc = computers.optJSONObject(i);
            if (pc == null) continue;
            String id = pc.optString("id");
            String name = pc.optString("name", "").trim();
            if (name.isEmpty()) name = WidgetStore.tr(context, "Ordinateur", "Computer");
            String status = WidgetStore.status(context, id);
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_wake_row);
            row.setTextViewText(R.id.wk_name, name);
            row.setTextViewText(R.id.wk_status, status.isEmpty() ? WidgetStore.tr(context, "Toucher pour allumer", "Tap to turn on") : status);
            row.setContentDescription(R.id.wk_row, WidgetStore.tr(context, "Allumer ", "Turn on ") + name);
            Intent wake = new Intent(context, WakeWidget.class)
                .setAction(WakeWidget.ACTION_WAKE)
                .setData(Uri.parse("ostal-widget://wake/" + Uri.encode(id)))
                .putExtra(EXTRA_COMPUTER, id);
            row.setOnClickPendingIntent(R.id.wk_row, PendingIntent.getBroadcast(context, 0, wake, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            rv.addView(R.id.wk_list, row);
        }
        showList(rv, R.id.wk_list, R.id.wk_empty);
        return rv;
    }

    // ---------- Outils ----------

    private static void showMessage(RemoteViews rv, int list, int empty, String text) {
        rv.setTextViewText(empty, text);
        rv.setViewVisibility(empty, View.VISIBLE);
        rv.setViewVisibility(list, View.GONE);
    }

    private static void showList(RemoteViews rv, int list, int empty) {
        rv.setViewVisibility(list, View.VISIBLE);
        rv.setViewVisibility(empty, View.GONE);
    }

    /** Ouvre Ostal sur une page (« #/agenda »…), comme une notification de rappel (voir RemindersPlugin). */
    static PendingIntent open(Context context, String url, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(ReminderNotifier.EXTRA_OPEN, url);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent broadcast(Context context, Class<?> provider, String action, String what) {
        Intent intent = new Intent(context, provider).setAction(action).setData(Uri.parse("ostal-widget://" + what));
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
