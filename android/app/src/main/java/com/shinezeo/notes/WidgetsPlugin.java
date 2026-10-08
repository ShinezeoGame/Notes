package com.shinezeo.notes;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.content.res.ColorStateList;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widgets de l'écran d'accueil et raccourcis du lanceur (client web : lib/phoneWidgets.ts) : réglages et données
 * envoyés par l'application, actions faites hors ligne à rejouer, ajout d'un widget ou d'un raccourci à l'écran
 * d'accueil, et, pour les tests, mêmes actions que toucher un widget et contrôle de leur affichage.
 *
 * <p>Une exception qui sort d'une méthode de plugin ferme l'application : chaque méthode renvoie ses erreurs au
 * JavaScript.
 */
@CapacitorPlugin(name = "Widgets")
public class WidgetsPlugin extends Plugin {

    private static final String TAG = "NotesWidgets";
    /** Action des raccourcis du lanceur (une action est obligatoire) ; la page à ouvrir est dans EXTRA_OPEN. */
    static final String ACTION_OPEN = "com.shinezeo.notes.OPEN";
    private static final int MAX_LAUNCHER_SHORTCUTS = 4;
    private static final String KEY_LAUNCHER = "launcherShortcuts";

    /** Réglages et données : serveur, espace, langue, raccourcis, liste de tâches affichée, listes et ordinateurs. */
    @PluginMethod
    public void configure(PluginCall call) {
        try {
            Context ctx = getContext();
            WidgetStore.saveSettings(ctx, call.getString("serverUrl", ""), call.getString("wsId", ""), call.getString("key", ""), call.getString("lang", "fr"));
            JSArray shortcuts = call.getArray("shortcuts");
            if (shortcuts != null) WidgetStore.saveShortcuts(ctx, new JSONArray(shortcuts.toString()));
            String list = call.getString("taskList");
            if (list != null) WidgetStore.saveTaskList(ctx, list);
            JSObject data = call.getObject("data");
            if (data != null) WidgetStore.replaceData(ctx, new JSONObject(data.toString()));
            // Couleurs : thème d'Ostal ou couleurs choisies ; null : celles du téléphone (absent : application plus ancienne).
            if (call.getData().has("colors")) {
                JSObject colors = call.getObject("colors");
                WidgetStore.saveColors(ctx, colors == null ? null : new JSONObject(colors.toString()));
            }
            applyLauncherShortcuts(ctx, WidgetStore.shortcuts(ctx));
            WidgetViews.updateAll(ctx);
            // Widget « Films et séries » posé : dernières demandes relues (Seerr a pu être relié entre-temps).
            Context app = ctx.getApplicationContext();
            if (WidgetViews.placed(ctx, SeerrWidget.class).length > 0) {
                new Thread(() -> WidgetActions.refreshSeerr(app), "notes-widget-seerr").start();
            }
            // Widget « Allumer l'ordinateur » posé : ordinateurs allumés ou éteints.
            if (WidgetViews.placed(ctx, WakeWidget.class).length > 0) {
                new Thread(
                    () -> {
                        if (WidgetActions.checkPower(app)) WakeStatusJob.start(app);
                    },
                    "notes-widget-power"
                ).start();
            }
            call.resolve(info(ctx));
        } catch (Exception e) {
            fail(call, e, "Widgets non mis à jour.");
        }
    }

    /** Actions faites sur les widgets sans pouvoir joindre le serveur, à appliquer par l'application (une fois). */
    @PluginMethod
    public void takeActions(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("actions", new JSArray(WidgetStore.takePending(getContext()).toString()));
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Actions des widgets illisibles.");
        }
    }

    @PluginMethod
    public void info(PluginCall call) {
        try {
            call.resolve(info(getContext()));
        } catch (Exception e) {
            fail(call, e, "Widgets indisponibles.");
        }
    }

    /** Ajout d'un widget à l'écran d'accueil (fenêtre du lanceur, Android 8 et suivants). */
    @PluginMethod
    public void pin(PluginCall call) {
        try {
            Context ctx = getContext();
            JSObject ret = new JSObject();
            boolean requested = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
                if (manager.isRequestPinAppWidgetSupported()) {
                    requested = manager.requestPinAppWidget(new ComponentName(ctx, provider(call.getString("kind", ""))), null, null);
                }
            }
            ret.put("requested", requested);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Widget non ajouté.");
        }
    }

    /** Un raccourci seul (icône « Atelier PDF »…) posé sur l'écran d'accueil (Android 8 et suivants). */
    @PluginMethod
    public void pinShortcut(PluginCall call) {
        try {
            Context ctx = getContext();
            JSObject ret = new JSObject();
            boolean requested = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ShortcutManager manager = ctx.getSystemService(ShortcutManager.class);
                if (manager != null && manager.isRequestPinShortcutSupported()) {
                    JSONObject s = WidgetStore.shortcut(call.getString("id", "s"), call.getString("label", "Ostal"), call.getString("url", "#/"), call.getString("icon", ""));
                    requested = manager.requestPinShortcut(launcherShortcut(ctx, "pin_" + s.optString("id"), s), null);
                }
            }
            ret.put("requested", requested);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Raccourci non ajouté.");
        }
    }

    /**
     * Même action que toucher un widget (tests, aperçu) : cocher ou décocher (« done », « toggle »), ajouter (« add »),
     * allumer ou éteindre un ordinateur (« wake », « off »), relire (« refresh », « power » : état des ordinateurs,
     * « seerr » : demandes faites à Seerr), ouvrir la fenêtre « Nouvelle tâche » (« openAdd »), « Éteindre … ? »
     * (« openOff ») ou la recherche de films et séries (« openSearch »).
     */
    @PluginMethod
    public void act(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        String action = call.getString("action", "");
        String list = call.getString("list", "");
        if ("openSearch".equals(action)) {
            try {
                ctx.startActivity(
                    new Intent(ctx, SeerrSearchActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        .putExtra(SeerrSearchActivity.EXTRA_QUERY, call.getString("query", ""))
                );
                call.resolve();
            } catch (Exception e) {
                fail(call, e, "Fenêtre non ouverte.");
            }
            return;
        }
        if ("openOff".equals(action)) {
            try {
                ctx.startActivity(
                    new Intent(ctx, PowerActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(WidgetViews.EXTRA_COMPUTER, call.getString("computer", ""))
                );
                call.resolve();
            } catch (Exception e) {
                fail(call, e, "Fenêtre non ouverte.");
            }
            return;
        }
        if ("openAdd".equals(action)) {
            try {
                ctx.startActivity(new Intent(ctx, TaskAddActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(WidgetViews.EXTRA_LIST, list));
                call.resolve();
            } catch (Exception e) {
                fail(call, e, "Fenêtre non ouverte.");
            }
            return;
        }
        new Thread(
            () -> {
                try {
                    JSObject ret = new JSObject();
                    switch (action) {
                        case "done":
                            WidgetActions.setDone(ctx, list, call.getString("task", ""), Boolean.TRUE.equals(call.getBoolean("done", true)));
                            break;
                        case "toggle":
                            WidgetActions.toggle(ctx, list, call.getString("task", ""));
                            break;
                        case "add":
                            WidgetActions.add(ctx, list, call.getString("text", ""));
                            break;
                        case "wake":
                            ret.put("status", WidgetActions.wake(ctx, call.getString("computer", "")));
                            break;
                        case "off":
                            ret.put("status", WidgetActions.powerOff(ctx, call.getString("computer", "")));
                            break;
                        case "power": {
                            ret.put("active", WidgetActions.checkPower(ctx));
                            JSObject states = new JSObject();
                            JSONArray computers = WidgetStore.data(ctx).optJSONArray("computers");
                            for (int i = 0; computers != null && i < computers.length(); i++) {
                                String id = computers.optJSONObject(i) == null ? "" : computers.optJSONObject(i).optString("id");
                                if (!id.isEmpty()) states.put(id, new JSObject(WidgetStore.power(ctx, id).toString()));
                            }
                            ret.put("power", states);
                            break;
                        }
                        case "refresh":
                            ret.put("refreshed", WidgetActions.refresh(ctx));
                            break;
                        case "seerr":
                            WidgetActions.refreshSeerr(ctx);
                            ret.put("seerr", new JSObject(WidgetStore.seerr(ctx).toString()));
                            break;
                        default:
                            call.reject("Action inconnue.");
                            return;
                    }
                    ret.put("data", new JSObject(WidgetStore.data(ctx).toString()));
                    call.resolve(ret);
                } catch (Exception e) {
                    fail(call, e, "Action du widget impossible.");
                }
            },
            "notes-widget-act"
        ).start();
    }

    /** Données affichées par les widgets, raccourcis et actions en attente (tests, diagnostic). */
    @PluginMethod
    public void state(PluginCall call) {
        try {
            Context ctx = getContext();
            JSObject ret = new JSObject();
            ret.put("data", new JSObject(WidgetStore.data(ctx).toString()));
            ret.put("shortcuts", new JSArray(WidgetStore.shortcuts(ctx).toString()));
            ret.put("pending", WidgetStore.pending(ctx).length());
            ret.put("server", WidgetStore.hasServer(ctx));
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Widgets illisibles.");
        }
    }

    /**
     * Contrôle de l'affichage : chaque widget construit puis affiché ici comme le ferait l'écran d'accueil (une vue
     * interdite dans un widget, une ressource manquante échouent) ; renvoie les textes visibles de chacun.
     */
    @PluginMethod
    public void check(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Application en arrière-plan.");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                // Contexte de l'application, comme l'écran d'accueil : celui de l'activité (AppCompat) remplacerait les
                // vues du widget par les siennes (AppCompatImageView), que RemoteViews refuse.
                Context ctx = getContext().getApplicationContext();
                Bundle options = new Bundle();
                options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 320);
                options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 220);
                FrameLayout parent = new FrameLayout(ctx);
                JSObject ret = new JSObject();
                ret.put("shortcuts", texts(WidgetViews.shortcuts(ctx, options).apply(ctx, parent)));
                View tasks = WidgetViews.tasks(ctx, options).apply(ctx, parent);
                ret.put("tasks", texts(tasks));
                // Couleurs appliquées (thème d'Ostal ou choisies) : fond et titre du widget Tâches.
                JSObject colors = new JSObject();
                ColorStateList tint = tasks.getBackgroundTintList();
                colors.put("bg", tint == null ? "" : String.format("#%08X", tint.getDefaultColor()));
                TextView title = tasks.findViewById(R.id.tk_title);
                colors.put("title", title == null ? "" : String.format("#%08X", title.getCurrentTextColor()));
                ret.put("colors", colors);
                ret.put("wake", texts(WidgetViews.wake(ctx, options).apply(ctx, parent)));
                ret.put("seerr", texts(WidgetViews.seerr(ctx, options).apply(ctx, parent)));
                JSArray previews = new JSArray();
                for (int layout : new int[] { R.layout.widget_tasks_preview, R.layout.widget_wake_preview, R.layout.widget_seerr_preview }) {
                    previews.put(texts(new RemoteViews(ctx.getPackageName(), layout).apply(ctx, parent)));
                }
                ret.put("previews", previews);
                call.resolve(ret);
            } catch (Exception e) {
                fail(call, e, "Widgets illisibles.");
            }
        });
    }

    private static JSArray texts(View view) {
        JSArray out = new JSArray();
        collect(view, out);
        return out;
    }

    private static void collect(View view, JSArray out) {
        if (view.getVisibility() != View.VISIBLE) return;
        if (view instanceof TextView) {
            CharSequence text = ((TextView) view).getText();
            if (text != null && text.length() > 0) out.put(text.toString());
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) collect(group.getChildAt(i), out);
        }
    }

    private static Class<?> provider(String kind) {
        if ("tasks".equals(kind)) return TasksWidget.class;
        if ("wake".equals(kind)) return WakeWidget.class;
        if ("seerr".equals(kind)) return SeerrWidget.class;
        return ShortcutsWidget.class;
    }

    private static JSObject info(Context ctx) {
        JSObject placed = new JSObject();
        placed.put("shortcuts", WidgetViews.placed(ctx, ShortcutsWidget.class).length);
        placed.put("tasks", WidgetViews.placed(ctx, TasksWidget.class).length);
        placed.put("wake", WidgetViews.placed(ctx, WakeWidget.class).length);
        placed.put("seerr", WidgetViews.placed(ctx, SeerrWidget.class).length);
        boolean pinWidgets = false;
        boolean pinShortcuts = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            pinWidgets = AppWidgetManager.getInstance(ctx).isRequestPinAppWidgetSupported();
            ShortcutManager manager = ctx.getSystemService(ShortcutManager.class);
            pinShortcuts = manager != null && manager.isRequestPinShortcutSupported();
        }
        JSObject ret = new JSObject();
        ret.put("placed", placed);
        ret.put("pinWidgets", pinWidgets);
        ret.put("pinShortcuts", pinShortcuts);
        // Couleurs du thème d'Ostal ou choisies : Android 12 et suivants (WidgetTheme).
        ret.put("colors", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S);
        return ret;
    }

    // ---------- Raccourcis du lanceur (appui long sur l'icône d'Ostal) ----------

    /** Les premiers raccourcis choisis, mis à jour seulement s'ils ont changé (Android limite ces mises à jour). */
    private static void applyLauncherShortcuts(Context ctx, JSONArray list) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return;
        try {
            if (list.toString().equals(WidgetStore.prefs(ctx).getString(KEY_LAUNCHER, ""))) return;
            ShortcutManager manager = ctx.getSystemService(ShortcutManager.class);
            if (manager == null) return;
            List<ShortcutInfo> out = new ArrayList<>();
            int max = Math.min(MAX_LAUNCHER_SHORTCUTS, manager.getMaxShortcutCountPerActivity());
            for (int i = 0; i < list.length() && out.size() < max; i++) {
                JSONObject s = list.optJSONObject(i);
                if (s != null) out.add(launcherShortcut(ctx, "sc_" + s.optString("id", String.valueOf(i)), s));
            }
            if (manager.setDynamicShortcuts(out)) WidgetStore.prefs(ctx).edit().putString(KEY_LAUNCHER, list.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "Raccourcis du lanceur non mis à jour", e);
        }
    }

    private static ShortcutInfo launcherShortcut(Context ctx, String id, JSONObject s) {
        String label = s.optString("label", "").trim();
        if (label.isEmpty()) label = "Ostal";
        Intent intent = new Intent(ctx, MainActivity.class)
            .setAction(ACTION_OPEN)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(ReminderNotifier.EXTRA_OPEN, s.optString("url", "#/"));
        return new ShortcutInfo.Builder(ctx, id)
            .setShortLabel(label)
            .setLongLabel(label)
            .setIcon(Icon.createWithResource(ctx, launcherIcon(s.optString("icon", ""))))
            .setIntent(intent)
            .build();
    }

    private static int launcherIcon(String name) {
        switch (name) {
            case "new_page":
                return R.drawable.ic_sc_new_page;
            case "notes":
                return R.drawable.ic_sc_notes;
            case "agenda":
                return R.drawable.ic_sc_agenda;
            case "papers":
                return R.drawable.ic_sc_papers;
            case "camera":
                return R.drawable.ic_sc_camera;
            case "pdf":
                return R.drawable.ic_sc_pdf;
            case "home":
                return R.drawable.ic_sc_home;
            case "cameras":
                return R.drawable.ic_sc_cameras;
            case "homelab":
                return R.drawable.ic_sc_homelab;
            case "tasks":
                return R.drawable.ic_sc_tasks;
            case "computer":
                return R.drawable.ic_sc_computer;
            case "media":
                return R.drawable.ic_sc_media;
            default:
                return R.drawable.ic_sc_dashboard;
        }
    }

    private static void fail(PluginCall call, Exception e, String message) {
        Log.w(TAG, message, e);
        call.reject(message, e);
    }
}
