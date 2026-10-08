package com.shinezeo.notes;

import android.content.Context;
import android.text.format.DateFormat;
import android.util.Log;
import java.net.URLEncoder;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Ce que font les widgets quand on les touche (hors du fil principal) : cocher ou ajouter une tâche (affiché aussitôt,
 * envoyé au serveur ; sans serveur ou hors ligne, rejoué par l'application à sa prochaine ouverture), allumer ou
 * éteindre un ordinateur et suivre son état, relire les listes sur le serveur.
 */
final class WidgetActions {

    private static final String TAG = "NotesWidgets";
    /** Démarrage ou extinction suivis pendant ce délai au plus (comme le widget de l'accueil). */
    static final long PHASE_MS = 3 * 60_000L;
    /** État des ordinateurs : lu, modifié puis enregistré d'un bloc (suivi en arrière-plan et appuis en même temps). */
    private static final Object POWER = new Object();

    private WidgetActions() {}

    /** Relit listes de tâches et ordinateurs sur le serveur ; faux sans serveur ou serveur injoignable. */
    static boolean refresh(Context context) {
        if (!WidgetStore.hasServer(context)) return false;
        boolean ok = false;
        try {
            WidgetStore.replaceData(context, WidgetApi.request(context, "GET", "/api/widgets", null));
            ok = true;
        } catch (Exception e) {
            Log.w(TAG, "Widgets non relus", e);
        } finally {
            WidgetViews.updateTasks(context);
            WidgetViews.updateWake(context);
        }
        // Widget « Allumer l'ordinateur » posé : ordinateurs allumés ou éteints.
        if (WidgetViews.placed(context, WakeWidget.class).length > 0 && checkPower(context)) WakeStatusJob.start(context);
        return ok;
    }

    // ---------- Ordinateurs : allumer, éteindre, état ----------

    private static String mac(String raw) {
        return raw == null ? "" : raw.trim().replace('-', ':').toUpperCase(Locale.ROOT);
    }

    private static String time(Context context, long at) {
        return DateFormat.getTimeFormat(context).format(new Date(at));
    }

    /** Modifie l'état enregistré d'un ordinateur. */
    private interface PowerChange {
        void apply(JSONObject state) throws Exception;
    }

    private static JSONObject changePower(Context context, String computerId, PowerChange change) {
        synchronized (POWER) {
            JSONObject state = WidgetStore.power(context, computerId);
            try {
                change.apply(state);
            } catch (Exception ignored) {
                // Valeurs simples.
            }
            WidgetStore.savePower(context, computerId, state);
            return state;
        }
    }

    private static void message(JSONObject state, String text) throws Exception {
        state.put("msg", text).put("msgAt", System.currentTimeMillis());
    }

    /**
     * Relit l'état des ordinateurs : allumé ou éteint (ordinateurs réglés avec une adresse IP), extinction possible
     * (Ostal pour Windows y attend les ordres) ; termine les démarrages et extinctions arrivés au bout. Vrai si l'un
     * d'eux est encore en cours.
     */
    static boolean checkPower(Context context) {
        JSONArray computers = WidgetStore.data(context).optJSONArray("computers");
        if (computers == null || computers.length() == 0 || !WidgetStore.hasServer(context)) return false;
        Set<String> agents = null;
        try {
            JSONArray list = WidgetApi.request(context, "GET", "/api/power/agents", null).optJSONArray("agents");
            agents = new HashSet<>();
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject a = list.optJSONObject(i);
                if (a != null) agents.add(mac(a.optString("mac")));
            }
        } catch (Exception e) {
            // Serveur plus ancien ou injoignable : extinction possible inconnue.
            Log.w(TAG, "Ordinateurs à éteindre non relus", e);
        }
        boolean active = false;
        for (int i = 0; i < computers.length(); i++) {
            JSONObject pc = computers.optJSONObject(i);
            if (pc == null) continue;
            String id = pc.optString("id");
            String host = pc.optString("host");
            JSONObject status = null;
            if (!host.isEmpty()) {
                try {
                    status = WidgetApi.request(
                        context,
                        "GET",
                        "/api/wol/status?host=" + URLEncoder.encode(host, "UTF-8") + "&mac=" + URLEncoder.encode(pc.optString("mac"), "UTF-8"),
                        null
                    );
                } catch (Exception e) {
                    Log.w(TAG, "État de l'ordinateur non relu", e);
                }
            }
            final JSONObject s = status;
            final Set<String> canOff = agents;
            JSONObject state = changePower(context, id, (p) -> {
                long now = System.currentTimeMillis();
                if (canOff != null) p.put("canOff", canOff.contains(mac(pc.optString("mac"))));
                String phase = p.optString("phase");
                if (s != null) {
                    boolean online = s.optBoolean("online");
                    p.put("online", online).put("other", s.optBoolean("otherDevice")).put("checked", now);
                    // Arrivé : allumé après un démarrage, éteint après une extinction.
                    if (("booting".equals(phase) && online) || ("stopping".equals(phase) && !online)) p.put("phase", "");
                }
                phase = p.optString("phase");
                if (!phase.isEmpty() && now - p.optLong("since") > PHASE_MS) {
                    p.put("phase", "");
                    if ("booting".equals(phase) && p.has("online") && !p.optBoolean("online")) {
                        message(p, WidgetStore.tr(context, "Ne s’est pas allumé : voir les réglages du widget", "Did not turn on: see the widget’s settings"));
                    }
                }
            });
            if (!state.optString("phase").isEmpty()) active = true;
        }
        WidgetViews.updateWake(context);
        return active;
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

    /** Allume un ordinateur (signal Wake-on-LAN envoyé par le serveur) ; renvoie le message affiché. */
    static String wake(Context context, String computerId) {
        JSONObject pc = WidgetStore.computer(context, computerId);
        if (pc == null) return WidgetStore.tr(context, "Introuvable : ouvrez Ostal", "Not found: open Ostal");
        if (!WidgetStore.hasServer(context)) return WidgetStore.tr(context, "Un serveur Ostal est nécessaire", "An Ostal server is needed");
        changePower(context, computerId, (p) -> message(p, WidgetStore.tr(context, "Envoi du signal…", "Sending signal…")));
        WidgetViews.updateWake(context);
        String text;
        boolean booting = false;
        try {
            JSONObject req = new JSONObject().put("mac", pc.optString("mac"));
            if (!pc.optString("host").isEmpty()) req.put("host", pc.optString("host"));
            if (!pc.optString("broadcast").isEmpty()) req.put("broadcast", pc.optString("broadcast"));
            WidgetApi.request(context, "POST", "/api/wol/wake", req);
            String time = time(context, System.currentTimeMillis());
            text = WidgetStore.tr(context, "Signal envoyé à " + time, "Signal sent at " + time);
            // Adresse IP connue : démarrage suivi jusqu'à ce que l'ordinateur réponde.
            booting = !pc.optString("host").isEmpty();
        } catch (WidgetApi.HttpError e) {
            text = WidgetStore.isFrench(context) ? "Refusé : " + e.getMessage() : "Refused by the server (" + e.status + ")";
        } catch (Exception e) {
            Log.w(TAG, "Signal non envoyé", e);
            text = WidgetStore.tr(context, "Serveur injoignable", "Server unreachable");
        }
        final String shown = text;
        final boolean follow = booting;
        changePower(context, computerId, (p) -> {
            message(p, shown);
            if (follow) p.put("phase", "booting").put("since", System.currentTimeMillis());
        });
        WidgetViews.updateWake(context);
        if (booting) WakeStatusJob.start(context);
        return text;
    }

    /**
     * Éteint un ordinateur : ordre transmis par le serveur à Ostal pour Windows, qui y attend les ordres (option
     * « Pouvoir éteindre cet ordinateur depuis Ostal ») ; renvoie le message affiché.
     */
    static String powerOff(Context context, String computerId) {
        JSONObject pc = WidgetStore.computer(context, computerId);
        if (pc == null) return WidgetStore.tr(context, "Introuvable : ouvrez Ostal", "Not found: open Ostal");
        if (!WidgetStore.hasServer(context)) return WidgetStore.tr(context, "Un serveur Ostal est nécessaire", "An Ostal server is needed");
        String text;
        try {
            WidgetApi.request(context, "POST", "/api/power/off", new JSONObject().put("mac", pc.optString("mac")));
            text = WidgetStore.tr(context, "Extinction demandée", "Turning off requested");
            final String shown = text;
            // Adresse IP connue : extinction suivie jusqu'à ce que l'ordinateur ne réponde plus.
            final boolean follow = !pc.optString("host").isEmpty();
            changePower(context, computerId, (p) -> {
                message(p, shown);
                p.put("canOff", true);
                if (follow) p.put("phase", "stopping").put("since", System.currentTimeMillis());
            });
            WidgetViews.updateWake(context);
            if (follow) WakeStatusJob.start(context);
            return text;
        } catch (WidgetApi.HttpError e) {
            if (e.status == 409) {
                // Ostal pour Windows ne répond pas : ordinateur déjà éteint, ou application fermée sur cet ordinateur.
                changePower(context, computerId, (p) -> p.put("canOff", false));
                checkPower(context);
                JSONObject now = WidgetStore.power(context, computerId);
                text = now.has("online") && !now.optBoolean("online")
                    ? WidgetStore.tr(context, "Déjà éteint", "Already off")
                    : WidgetStore.tr(context, "Ostal pour Windows ne répond pas sur cet ordinateur", "Ostal for Windows does not respond on that computer");
            } else {
                text = WidgetStore.isFrench(context) ? "Refusé : " + e.getMessage() : "Refused by the server (" + e.status + ")";
            }
        } catch (Exception e) {
            Log.w(TAG, "Ordre d'extinction non envoyé", e);
            text = WidgetStore.tr(context, "Serveur injoignable", "Server unreachable");
        }
        final String shown = text;
        changePower(context, computerId, (p) -> message(p, shown));
        WidgetViews.updateWake(context);
        return text;
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
