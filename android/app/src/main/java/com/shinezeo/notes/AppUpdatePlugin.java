package com.shinezeo.notes;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import org.json.JSONObject;

/**
 * Mise à jour de l'application sans réinstaller l'APK : le client web (HTML, JS, CSS) est téléchargé depuis le
 * serveur Ostal dans le stockage de l'application, puis le JavaScript bascule la WebView dessus (plugin WebView de
 * Capacitor). Une tâche périodique ({@link UpdateCheckJob}) prévient par une notification quand une version est
 * disponible.
 *
 * <p>Une exception qui sort d'une méthode de plugin ferme l'application (Capacitor la relance) : chaque méthode
 * renvoie donc ses erreurs au JavaScript ({@link #fail}) au lieu de les laisser remonter.
 */
@CapacitorPlugin(
    name = "AppUpdate",
    permissions = { @Permission(alias = AppUpdatePlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class AppUpdatePlugin extends Plugin {

    /** Fonctions natives offertes au client web ; à augmenter à chaque ajout (MIN_NATIVE_API côté client). */
    static final int NATIVE_API = 1;

    static final String NOTIFICATIONS = "notifications";
    private static final String BUNDLES_DIR = "bundles";
    private static final String TAG = "NotesUpdates";

    private static void fail(PluginCall call, Exception e, String message) {
        Log.w(TAG, message, e);
        call.reject(message, e);
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("nativeApi", NATIVE_API);
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            ret.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : (long) info.versionCode);
        } catch (Exception ignored) {
            // Informations facultatives.
        }
        call.resolve(ret);
    }

    /**
     * Adresse du serveur, version en cours, choix de l'utilisateur et langue de l'interface, lus par la vérification
     * en arrière-plan. Sans langue (client d'avant le choix de la langue, tout en français) : français.
     */
    @PluginMethod
    public void configure(PluginCall call) {
        try {
            UpdateCheckJob.saveSettings(
                getContext(),
                call.getString("serverUrl", ""),
                call.getString("currentVersion", ""),
                Boolean.TRUE.equals(call.getBoolean("notify", true)),
                call.getString("lang", "fr")
            );
            JSObject ret = new JSObject();
            ret.put("scheduled", UpdateCheckJob.schedule(getContext()));
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Vérification des mises à jour indisponible.");
        }
    }

    /** La mise à jour est affichée dans l'application : pas de notification pour cette version. */
    @PluginMethod
    public void markSeen(PluginCall call) {
        try {
            UpdateCheckJob.setLastNotified(getContext(), call.getString("version", ""));
            UpdateNotifier.cancel(getContext());
            call.resolve();
        } catch (Exception e) {
            fail(call, e, "Notification non mise à jour.");
        }
    }

    /** Vrai si l'application vient d'être ouverte depuis la notification de mise à jour (une seule fois). */
    @PluginMethod
    public void consumeLaunchRequest(PluginCall call) {
        try {
            boolean requested = false;
            if (getActivity() != null) {
                Intent intent = getActivity().getIntent();
                if (intent != null && intent.getBooleanExtra(UpdateNotifier.EXTRA_UPDATE, false)) {
                    intent.removeExtra(UpdateNotifier.EXTRA_UPDATE);
                    requested = true;
                }
            }
            JSObject ret = new JSObject();
            ret.put("update", requested);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Lancement non lu.");
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        try {
            if (intent != null && intent.getBooleanExtra(UpdateNotifier.EXTRA_UPDATE, false)) {
                intent.removeExtra(UpdateNotifier.EXTRA_UPDATE);
                // Conservé jusqu'à l'écoute par le JavaScript (WebView encore en chargement).
                notifyListeners("updateRequested", new JSObject(), true);
            }
        } catch (Exception e) {
            Log.w(TAG, "Ouverture depuis la notification non traitée", e);
        }
    }

    /**
     * Télécharge les fichiers de la version `version` (chemin, taille, SHA-256) depuis `baseUrl` dans
     * files/bundles/&lt;version&gt;, en vérifiant chaque empreinte. Résout avec le chemin du dossier.
     */
    @PluginMethod
    public void download(PluginCall call) {
        try {
            String baseUrl = call.getString("baseUrl", "").replaceAll("/+$", "");
            String version = call.getString("version", "");
            JSArray files = call.getArray("files");
            if (baseUrl.isEmpty() || !version.matches("[A-Za-z0-9._-]{1,64}") || files == null || files.length() == 0) {
                call.reject("Paramètres de mise à jour invalides.");
                return;
            }
            new Thread(
                () -> {
                    try {
                        File dir = downloadBundle(baseUrl, version, files);
                        JSObject ret = new JSObject();
                        ret.put("path", dir.getAbsolutePath());
                        call.resolve(ret);
                    } catch (Exception e) {
                        Log.w(TAG, "Téléchargement de la mise à jour impossible", e);
                        call.reject(e.getMessage() != null ? e.getMessage() : "Téléchargement impossible.");
                    }
                },
                "notes-update-download"
            ).start();
        } catch (Exception e) {
            fail(call, e, "Téléchargement impossible.");
        }
    }

    /** Supprime les versions téléchargées, sauf le dossier `keep` (version en cours). */
    @PluginMethod
    public void cleanup(PluginCall call) {
        try {
            String keep = call.getString("keep", "");
            File[] entries = new File(getContext().getFilesDir(), BUNDLES_DIR).listFiles();
            if (entries != null) {
                for (File entry : entries) {
                    if (!entry.getName().equals(keep)) deleteRecursive(entry);
                }
            }
            call.resolve();
        } catch (Exception e) {
            fail(call, e, "Nettoyage des anciennes versions impossible.");
        }
    }

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        try {
            call.resolve(notificationPermission());
        } catch (Exception e) {
            fail(call, e, "Autorisation de notification inconnue.");
        }
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
                requestPermissionForAlias(NOTIFICATIONS, call, "notificationPermissionCallback");
            } else {
                call.resolve(notificationPermission());
            }
        } catch (Exception e) {
            fail(call, e, "Autorisation de notification non demandée.");
        }
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        try {
            call.resolve(notificationPermission());
        } catch (Exception e) {
            fail(call, e, "Autorisation de notification inconnue.");
        }
    }

    private JSObject notificationPermission() {
        String state;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            PermissionState s = getPermissionState(NOTIFICATIONS);
            state = s != null ? s.toString() : "prompt";
        } else {
            // Avant Android 13, pas d'autorisation à demander : seulement le réglage système de l'application.
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            state = nm != null && nm.areNotificationsEnabled() ? "granted" : "denied";
        }
        JSObject ret = new JSObject();
        ret.put(NOTIFICATIONS, state);
        return ret;
    }

    private File downloadBundle(String baseUrl, String version, JSArray files) throws Exception {
        File root = new File(getContext().getFilesDir(), BUNDLES_DIR);
        File target = new File(root, version);
        File partial = new File(root, version + ".part");
        deleteRecursive(partial);
        if (!partial.mkdirs()) throw new IOException("Stockage de l'application indisponible.");

        long total = 0;
        for (int i = 0; i < files.length(); i++) total += Math.max(0, files.getJSONObject(i).optLong("size", 0));
        long done = 0;
        long lastEvent = 0;
        byte[] buffer = new byte[64 * 1024];

        for (int i = 0; i < files.length(); i++) {
            JSONObject file = files.getJSONObject(i);
            String rel = file.getString("path");
            String expected = file.getString("sha256");
            if (!isSafePath(rel)) throw new IOException("Chemin de fichier refusé : " + rel);
            File out = new File(partial, rel);
            File parent = out.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Écriture impossible : " + rel);

            HttpURLConnection conn = (HttpURLConnection) new URL(baseUrl + "/" + Uri.encode(rel, "/")).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setUseCaches(false);
            try {
                int status = conn.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) throw new IOException("Le serveur a répondu " + status + " pour " + rel + ".");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream in = conn.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    int n;
                    while ((n = in.read(buffer)) != -1) {
                        os.write(buffer, 0, n);
                        digest.update(buffer, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEvent > 150) {
                            lastEvent = now;
                            progress(done, total);
                        }
                    }
                }
                if (!toHex(digest.digest()).equalsIgnoreCase(expected)) {
                    throw new IOException("Fichier incomplet ou modifié pendant le téléchargement : " + rel + ".");
                }
            } finally {
                conn.disconnect();
            }
        }
        progress(total, total);
        deleteRecursive(target);
        if (!partial.renameTo(target)) throw new IOException("Installation de la mise à jour impossible.");
        return target;
    }

    private void progress(long done, long total) {
        JSObject data = new JSObject();
        data.put("done", done);
        data.put("total", total);
        notifyListeners("downloadProgress", data);
    }

    private static boolean isSafePath(String rel) {
        if (rel == null || rel.isEmpty() || rel.startsWith("/") || rel.contains("\\")) return false;
        for (String part : rel.split("/")) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
        }
        return true;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
        }
        return sb.toString();
    }

    static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursive(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
