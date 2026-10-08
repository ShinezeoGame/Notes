package com.shinezeo.notes;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Données des widgets de l'écran d'accueil : réglages envoyés par l'application (serveur, espace, langue, raccourcis,
 * liste de tâches affichée), dernières données lues (listes de tâches et ordinateurs de l'accueil d'Ostal), actions
 * faites sans pouvoir joindre le serveur (rejouées par l'application à sa prochaine ouverture) et état de chaque
 * ordinateur (allumé ou éteint, démarrage ou extinction en cours, dernier message).
 */
final class WidgetStore {

    static final int MAX_SHORTCUTS = 6;
    private static final String PREFS = "NotesWidgets";
    private static final String KEY_SERVER = "serverUrl";
    private static final String KEY_WS = "wsId";
    private static final String KEY_KEY = "key";
    private static final String KEY_LANG = "lang";
    private static final String KEY_SHORTCUTS = "shortcuts";
    private static final String KEY_LIST = "taskList";
    /** Listes de tâches et ordinateurs : { tasks: [{ id, title, hideDone, items: [{ id, text, done }] }], computers: [...] }. */
    private static final String KEY_DATA = "data";
    /** Actions à rejouer par l'application : [{ type: "done" | "add", list, task, done, text, at }]. */
    private static final String KEY_PENDING = "pending";
    /**
     * État d'un ordinateur : { online (absent : inconnu), other (adresse IP prise par un autre appareil), checked (heure de
     * la vérification), canOff (Ostal pour Windows attend les ordres ; absent : inconnu), phase ("booting", "stopping" ou
     * ""), since (début de la phase), msg, msgAt (dernier message : signal envoyé, refus…) }.
     */
    private static final String KEY_POWER = "power:";
    /** Widget « Films et séries » : { state: "ok" | "notConfigured" | "noServer" | "error" | "offline", requests: [...] }. */
    private static final String KEY_SEERR = "seerr";
    /** Couleurs des widgets choisies dans l'application (thème d'Ostal ou couleurs personnalisées) ; absentes : téléphone. */
    private static final String KEY_COLORS = "colors";

    private WidgetStore() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Langue de l'application ; avant son premier réglage, celle du téléphone. */
    static boolean isFrench(Context context) {
        String lang = prefs(context).getString(KEY_LANG, "");
        if (lang.isEmpty()) return "fr".equals(Locale.getDefault().getLanguage());
        return !"en".equals(lang);
    }

    static String tr(Context context, String fr, String en) {
        return isFrench(context) ? fr : en;
    }

    // ---------- Réglages ----------

    static void saveSettings(Context context, String serverUrl, String wsId, String key, String lang) {
        prefs(context)
            .edit()
            .putString(KEY_SERVER, serverUrl == null ? "" : serverUrl.replaceAll("/+$", ""))
            .putString(KEY_WS, wsId == null ? "" : wsId)
            .putString(KEY_KEY, key == null ? "" : key)
            .putString(KEY_LANG, "en".equals(lang) ? "en" : "fr")
            .apply();
    }

    static String server(Context context) {
        return prefs(context).getString(KEY_SERVER, "");
    }

    static String wsId(Context context) {
        return prefs(context).getString(KEY_WS, "");
    }

    static String key(Context context) {
        return prefs(context).getString(KEY_KEY, "");
    }

    static boolean hasServer(Context context) {
        return !server(context).isEmpty() && !wsId(context).isEmpty() && !key(context).isEmpty();
    }

    // ---------- Raccourcis ----------

    static JSONObject shortcut(String id, String label, String url, String icon) {
        JSONObject s = new JSONObject();
        try {
            s.put("id", id).put("label", label).put("url", url).put("icon", icon);
        } catch (Exception ignored) {
            // Valeurs simples : pas d'erreur possible.
        }
        return s;
    }

    /** Raccourcis choisis dans l'application ; avant son premier réglage : nouvelle page, agenda, papiers, PDF. */
    static JSONArray shortcuts(Context context) {
        try {
            JSONArray list = new JSONArray(prefs(context).getString(KEY_SHORTCUTS, "[]"));
            if (list.length() > 0) return list;
        } catch (Exception ignored) {
            // Réglage illisible : raccourcis par défaut.
        }
        JSONArray list = new JSONArray();
        list.put(shortcut("newPage", tr(context, "Nouvelle page", "New page"), "#/nouvelle-page", "new_page"));
        list.put(shortcut("agenda", tr(context, "Agenda", "Calendar"), "#/agenda", "agenda"));
        list.put(shortcut("papers", tr(context, "Papiers", "Papers"), "#/papiers", "papers"));
        list.put(shortcut("pdf", tr(context, "Atelier PDF", "PDF"), "#/pdf", "pdf"));
        return list;
    }

    static void saveShortcuts(Context context, JSONArray list) {
        JSONArray clean = new JSONArray();
        for (int i = 0; i < list.length() && clean.length() < MAX_SHORTCUTS; i++) {
            JSONObject s = list.optJSONObject(i);
            if (s == null) continue;
            String url = s.optString("url", "");
            if (!url.startsWith("#/")) continue;
            clean.put(shortcut(s.optString("id", "s" + i), s.optString("label", ""), url, s.optString("icon", "")));
        }
        prefs(context).edit().putString(KEY_SHORTCUTS, clean.toString()).apply();
    }

    // ---------- Listes de tâches et ordinateurs ----------

    static void saveTaskList(Context context, String listId) {
        prefs(context).edit().putString(KEY_LIST, listId == null ? "" : listId).apply();
    }

    static synchronized boolean hasData(Context context) {
        return prefs(context).contains(KEY_DATA);
    }

    static synchronized JSONObject data(Context context) {
        try {
            return new JSONObject(prefs(context).getString(KEY_DATA, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void saveData(Context context, JSONObject data) {
        prefs(context).edit().putString(KEY_DATA, data.toString()).apply();
    }

    /**
     * Données lues sur le serveur ou envoyées par l'application. Les actions pas encore rejouées par l'application
     * restent affichées (sinon une tâche cochée hors ligne réapparaîtrait décochée jusqu'à l'ouverture d'Ostal).
     */
    static synchronized void replaceData(Context context, JSONObject data) {
        JSONObject next = new JSONObject();
        try {
            next.put("tasks", data.optJSONArray("tasks") != null ? data.optJSONArray("tasks") : new JSONArray());
            next.put("computers", data.optJSONArray("computers") != null ? data.optJSONArray("computers") : new JSONArray());
            JSONArray pending = pending(context);
            for (int i = 0; i < pending.length(); i++) {
                JSONObject a = pending.optJSONObject(i);
                if (a == null) continue;
                if ("done".equals(a.optString("type"))) applyDone(next, a.optString("list"), a.optString("task"), a.optBoolean("done"));
                else if ("add".equals(a.optString("type"))) applyAdd(next, a.optString("list"), a.optString("task"), a.optString("text"));
            }
        } catch (Exception ignored) {
            // Données partielles : affichées telles quelles.
        }
        saveData(context, next);
    }

    /** Liste affichée par le widget Tâches : celle choisie dans l'application, sinon la première de l'accueil. */
    static synchronized JSONObject currentList(Context context) {
        JSONArray lists = data(context).optJSONArray("tasks");
        if (lists == null || lists.length() == 0) return null;
        String wanted = prefs(context).getString(KEY_LIST, "");
        for (int i = 0; i < lists.length(); i++) {
            JSONObject l = lists.optJSONObject(i);
            if (l != null && l.optString("id").equals(wanted)) return l;
        }
        return lists.optJSONObject(0);
    }

    static synchronized JSONObject task(Context context, String listId, String taskId) {
        JSONObject list = findList(data(context), listId);
        JSONArray items = list != null ? list.optJSONArray("items") : null;
        if (items == null) return null;
        for (int i = 0; i < items.length(); i++) {
            JSONObject t = items.optJSONObject(i);
            if (t != null && t.optString("id").equals(taskId)) return t;
        }
        return null;
    }

    static synchronized JSONObject computer(Context context, String id) {
        JSONArray list = data(context).optJSONArray("computers");
        if (list == null) return null;
        for (int i = 0; i < list.length(); i++) {
            JSONObject c = list.optJSONObject(i);
            if (c != null && c.optString("id").equals(id)) return c;
        }
        return null;
    }

    /** Tâche cochée ou décochée sur le téléphone, affichée aussitôt ; faux si elle n'existe plus. */
    static synchronized boolean setDone(Context context, String listId, String taskId, boolean done) {
        JSONObject data = data(context);
        boolean found = applyDone(data, listId, taskId, done);
        if (found) saveData(context, data);
        return found;
    }

    static synchronized void addLocal(Context context, String listId, String taskId, String text) {
        JSONObject data = data(context);
        if (applyAdd(data, listId, taskId, text)) saveData(context, data);
    }

    /** Tâches d'une liste renvoyées par le serveur après une action. */
    static synchronized void replaceItems(Context context, String listId, JSONArray items) {
        if (items == null) return;
        JSONObject data = data(context);
        JSONObject list = findList(data, listId);
        if (list == null) return;
        try {
            list.put("items", items);
        } catch (Exception ignored) {
            return;
        }
        saveData(context, data);
    }

    private static JSONObject findList(JSONObject data, String listId) {
        JSONArray lists = data.optJSONArray("tasks");
        if (lists == null) return null;
        for (int i = 0; i < lists.length(); i++) {
            JSONObject l = lists.optJSONObject(i);
            if (l != null && l.optString("id").equals(listId)) return l;
        }
        return null;
    }

    /** Ordre de l'application : à faire, puis faites (la dernière cochée en premier). */
    private static boolean applyDone(JSONObject data, String listId, String taskId, boolean done) {
        JSONObject list = findList(data, listId);
        JSONArray items = list != null ? list.optJSONArray("items") : null;
        if (items == null) return false;
        JSONObject task = null;
        JSONArray todo = new JSONArray();
        JSONArray finished = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject t = items.optJSONObject(i);
            if (t == null) continue;
            if (t.optString("id").equals(taskId)) task = t;
            else (t.optBoolean("done") ? finished : todo).put(t);
        }
        if (task == null) return false;
        try {
            task.put("done", done);
            // Entre les deux : dernière des tâches à faire si décochée, première des faites si cochée.
            JSONArray next = new JSONArray();
            for (int i = 0; i < todo.length(); i++) next.put(todo.get(i));
            next.put(task);
            for (int i = 0; i < finished.length(); i++) next.put(finished.get(i));
            list.put("items", next);
        } catch (Exception e) {
            return false;
        }
        return true;
    }

    /** Nouvelle tâche à la fin des tâches à faire (une seule fois par identifiant). */
    private static boolean applyAdd(JSONObject data, String listId, String taskId, String text) {
        JSONObject list = findList(data, listId);
        if (list == null) return false;
        JSONArray items = list.optJSONArray("items");
        if (items == null) items = new JSONArray();
        JSONArray next = new JSONArray();
        boolean placed = false;
        try {
            for (int i = 0; i < items.length(); i++) {
                JSONObject t = items.optJSONObject(i);
                if (t == null) continue;
                if (t.optString("id").equals(taskId)) return false;
                if (!placed && t.optBoolean("done")) {
                    next.put(new JSONObject().put("id", taskId).put("text", text).put("done", false));
                    placed = true;
                }
                next.put(t);
            }
            if (!placed) next.put(new JSONObject().put("id", taskId).put("text", text).put("done", false));
            list.put("items", next);
        } catch (Exception e) {
            return false;
        }
        return true;
    }

    // ---------- Actions à rejouer par l'application ----------

    static synchronized JSONArray pending(Context context) {
        try {
            return new JSONArray(prefs(context).getString(KEY_PENDING, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static synchronized void addPending(Context context, JSONObject action) {
        JSONArray list = pending(context);
        list.put(action);
        prefs(context).edit().putString(KEY_PENDING, list.toString()).apply();
    }

    static synchronized JSONArray takePending(Context context) {
        JSONArray list = pending(context);
        prefs(context).edit().remove(KEY_PENDING).apply();
        return list;
    }

    // ---------- État des ordinateurs ----------

    static synchronized JSONObject power(Context context, String computerId) {
        try {
            return new JSONObject(prefs(context).getString(KEY_POWER + computerId, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void savePower(Context context, String computerId, JSONObject state) {
        prefs(context).edit().putString(KEY_POWER + computerId, state.toString()).apply();
    }

    // ---------- Couleurs ----------

    /** { bg, tile, text, muted, icon, accent, onAccent, check } en « #AARRGGBB », ou null (couleurs du téléphone). */
    static JSONObject colors(Context context) {
        String raw = prefs(context).getString(KEY_COLORS, "");
        if (raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    static void saveColors(Context context, JSONObject colors) {
        if (colors == null) prefs(context).edit().remove(KEY_COLORS).apply();
        else prefs(context).edit().putString(KEY_COLORS, colors.toString()).apply();
    }

    // ---------- Films et séries (Seerr) : dernières demandes ----------

    static synchronized JSONObject seerr(Context context) {
        try {
            return new JSONObject(prefs(context).getString(KEY_SEERR, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void saveSeerr(Context context, JSONObject data) {
        prefs(context).edit().putString(KEY_SEERR, data.toString()).apply();
    }
}
