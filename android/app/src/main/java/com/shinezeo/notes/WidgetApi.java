package com.shinezeo.notes;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Appels au serveur Ostal pour les widgets (clé de l'espace en en-têtes), délais courts : widget touché, réponse vite. */
final class WidgetApi {

    /** Réponse d'erreur du serveur (tâche supprimée, accès refusé…), différente d'un serveur injoignable. */
    static final class HttpError extends Exception {

        private static final long serialVersionUID = 1L;
        final int status;

        HttpError(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private WidgetApi() {}

    static JSONObject request(Context context, String method, String path, JSONObject body) throws Exception {
        URL url = new URL(WidgetStore.server(context) + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(10000);
        conn.setUseCaches(false);
        conn.setRequestMethod(method);
        conn.setRequestProperty("x-ws-id", WidgetStore.wsId(context));
        conn.setRequestProperty("x-ws-key", WidgetStore.key(context));
        conn.setRequestProperty("Accept", "application/json");
        try {
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int code = conn.getResponseCode();
            String text = read(code >= 400 ? conn.getErrorStream() : conn.getInputStream());
            if (code >= 400) {
                String message = "";
                try {
                    message = new JSONObject(text).optString("error", "");
                } catch (Exception ignored) {
                    // Réponse sans message.
                }
                throw new HttpError(code, message.isEmpty() ? "Serveur : réponse " + code : message);
            }
            return text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } finally {
            conn.disconnect();
        }
    }

    private static String read(InputStream in) throws Exception {
        if (in == null) return "";
        try (InputStream stream = in) {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = stream.read(buffer)) != -1 && body.size() < 2_000_000) body.write(buffer, 0, n);
            return body.toString("UTF-8");
        }
    }
}
