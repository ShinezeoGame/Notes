package com.shinezeo.notes;

import android.content.Context;
import android.text.format.DateFormat;
import android.util.Log;
import java.net.URLEncoder;
import java.util.Date;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Ce que font les widgets quand on les touche (hors du fil principal) : cocher ou ajouter une tâche (affiché aussitôt,
 * envoyé au serveur ; sans serveur ou hors ligne, rejoué par l'application à sa prochaine ouverture), allumer un
 * ordinateur, relire les listes sur le serveur.
 */
final class WidgetActions {

    private static final String TAG = "NotesWidgets";

    private WidgetActions() {}

    /** Relit listes de tâches et ordinateurs sur le serveur ; faux sans serveur ou serveur injoignable. */
    static boolean refresh(Context context) {
        if (!WidgetStore.hasServer(context)) return false;
        try {
            WidgetStore.replaceData(context, WidgetApi.request(context, "GET", "/api/widgets", null));
            return true;
        } catch (Exception e) {
            Log.w(TAG, "Widgets non relus", e);
            return false;
        } finally {
            WidgetViews.updateTasks(context);
            WidgetViews.updateWake(context);
        }
    }

    // ---------- Films et séries (Seerr) ----------

    private static String lang(Context context) {
        return WidgetStore.isFrench(context) ? "fr" : "en";
    }

    /** Relit les dernières demandes faites à Seerr (widget « Films et séries ») ; garde les précédentes en cas d'échec. */
    static void refreshSeerr(Context context) {
        JSONObject before = WidgetStore.seerr(context);
        JSONObject out = new JSONObject();
        try {
            try {
                if (!WidgetStore.hasServer(context)) {
                    out.put("state", "noServer");
                } else {
                    JSONObject r = WidgetApi.request(context, "GET", "/api/seerr/requests?take=6&lang=" + lang(context), null);
                    JSONArray requests = r.optJSONArray("requests");
                    out.put("state", "ok").put("requests", requests == null ? new JSONArray() : requests);
                }
            } catch (WidgetApi.HttpError e) {
                // 404 : Seerr pas encore relié (section Films et séries d'Ostal).
                out.put("state", e.status == 404 ? "notConfigured" : "error");
                if (e.status != 404 && before.optJSONArray("requests") != null) out.put("requests", before.optJSONArray("requests"));
            } catch (Exception e) {
                Log.w(TAG, "Demandes non relues", e);
                out.put("state", "offline");
                if (before.optJSONArray("requests") != null) out.put("requests", before.optJSONArray("requests"));
            }
        } catch (Exception ignored) {
            // Valeurs simples.
        }
        WidgetStore.saveSeerr(context, out);
        WidgetViews.updateSeerr(context);
    }

    /** Recherche d'un film ou d'une série (fenêtre de recherche du widget). */
    static JSONArray seerrSearch(Context context, String query) throws Exception {
        JSONObject r = WidgetApi.request(context, "GET", "/api/seerr/search?q=" + URLEncoder.encode(query, "UTF-8") + "&lang=" + lang(context), null);
        JSONArray results = r.optJSONArray("results");
        return results == null ? new JSONArray() : results;
    }

    /** Demande d'un film, ou de toutes les saisons restantes d'une série ; renvoie l'état de la demande. */
    static String seerrRequest(Context context, String mediaType, int mediaId) throws Exception {
        JSONObject body = new JSONObject().put("mediaType", mediaType).put("mediaId", mediaId);
        String state = WidgetApi.request(context, "POST", "/api/seerr/request", body).optString("state", "processing");
        refreshSeerr(context);
        return state;
    }

    static void toggle(Context context, String listId, String taskId) {
        JSONObject task = WidgetStore.task(context, listId, taskId);
        if (task != null) setDone(context, listId, taskId, !task.optBoolean("done"));
    }

    static void setDone(Context context, String listId, String taskId, boolean done) {
        if (!WidgetStore.setDone(context, listId, taskId, done)) return;
        WidgetViews.updateTasks(context);
        JSONObject action = action("done", listId, taskId);
        try {
            action.put("done", done);
        } catch (Exception ignored) {
            // Valeur simple.
        }
        send(context, listId, action, "/api/widgets/tasks/done", body(listId, taskId).put("done", done));
    }

    static void add(Context context, String listId, String text) {
        String clean = text == null ? "" : text.replaceAll("\\s+", " ").trim();
        if (clean.isEmpty()) return;
        if (clean.length() > 500) clean = clean.substring(0, 500);
        // Identifiant choisi ici : la tâche affichée tout de suite est la même que celle du serveur.
        String taskId = UUID.randomUUID().toString();
        WidgetStore.addLocal(context, listId, taskId, clean);
        WidgetViews.updateTasks(context);
        JSONObject action = action("add", listId, taskId);
        try {
            action.put("text", clean);
        } catch (Exception ignored) {
            // Valeur simple.
        }
        send(context, listId, action, "/api/widgets/tasks/add", body(listId, taskId).put("text", clean));
    }

    /** Allume un ordinateur (signal Wake-on-LAN envoyé par le serveur) ; renvoie l'état affiché. */
    static String wake(Context context, String computerId) {
        JSONObject pc = WidgetStore.computer(context, computerId);
        String status;
        if (pc == null) {
            status = WidgetStore.tr(context, "Introuvable : ouvrez Ostal", "Not found: open Ostal");
        } else if (!WidgetStore.hasServer(context)) {
            status = WidgetStore.tr(context, "Un serveur Ostal est nécessaire", "An Ostal server is needed");
        } else {
            WidgetStore.saveStatus(context, computerId, WidgetStore.tr(context, "Envoi du signal…", "Sending signal…"));
            WidgetViews.updateWake(context);
            try {
                JSONObject req = new JSONObject().put("mac", pc.optString("mac"));
                if (!pc.optString("host").isEmpty()) req.put("host", pc.optString("host"));
                if (!pc.optString("broadcast").isEmpty()) req.put("broadcast", pc.optString("broadcast"));
                WidgetApi.request(context, "POST", "/api/wol/wake", req);
                String time = DateFormat.getTimeFormat(context).format(new Date());
                status = WidgetStore.tr(context, "Signal envoyé à " + time, "Signal sent at " + time);
            } catch (WidgetApi.HttpError e) {
                status = WidgetStore.isFrench(context) ? "Refusé : " + e.getMessage() : "Refused by the server (" + e.status + ")";
            } catch (Exception e) {
                Log.w(TAG, "Signal non envoyé", e);
                status = WidgetStore.tr(context, "Serveur injoignable", "Server unreachable");
            }
        }
        if (pc != null) WidgetStore.saveStatus(context, computerId, status);
        WidgetViews.updateWake(context);
        return status;
    }

    private static JSONObject action(String type, String listId, String taskId) {
        JSONObject a = new JSONObject();
        try {
            a.put("type", type).put("list", listId).put("task", taskId).put("at", System.currentTimeMillis());
        } catch (Exception ignored) {
            // Valeurs simples.
        }
        return a;
    }

    private static Body body(String listId, String taskId) {
        return new Body().put("list", listId).put("task", taskId).put("id", taskId);
    }

    /** Corps JSON d'une requête (sans exception à gérer à chaque valeur). */
    private static final class Body {

        final JSONObject json = new JSONObject();

        Body put(String key, Object value) {
            try {
                json.put(key, value);
            } catch (Exception ignored) {
                // Valeurs simples.
            }
            return this;
        }
    }

    /**
     * Action envoyée au serveur ; liste renvoyée affichée. Serveur injoignable ou absent : action gardée pour
     * l'application. Refus du serveur (tâche ou liste supprimée entre-temps) : listes relues.
     */
    private static void send(Context context, String listId, JSONObject action, String path, Body body) {
        if (!WidgetStore.hasServer(context)) {
            WidgetStore.addPending(context, action);
            return;
        }
        try {
            JSONObject res = WidgetApi.request(context, "POST", path, body.json);
            WidgetStore.replaceItems(context, listId, res.optJSONArray("items"));
            WidgetViews.updateTasks(context);
        } catch (WidgetApi.HttpError e) {
            Log.w(TAG, "Action refusée : " + e.getMessage());
            refresh(context);
        } catch (Exception e) {
            Log.w(TAG, "Serveur injoignable : action gardée pour l'application", e);
            WidgetStore.addPending(context, action);
        }
    }
}
