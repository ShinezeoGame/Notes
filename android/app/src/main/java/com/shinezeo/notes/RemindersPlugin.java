package com.shinezeo.notes;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Rappels (client web : lib/reminders.ts) : autorisation des notifications, réglages (serveur, espace, langue),
 * programmation par {@link ReminderScheduler}, notification d'essai, page à ouvrir quand on touche une notification
 * (évènement « open »).
 *
 * <p>Une exception qui sort d'une méthode de plugin ferme l'application : chaque méthode renvoie ses erreurs au
 * JavaScript.
 */
@CapacitorPlugin(
    name = "Reminders",
    permissions = { @Permission(alias = RemindersPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class RemindersPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";
    private static final String TAG = "NotesReminders";

    @PluginMethod
    public void requestPermission(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
                requestPermissionForAlias(NOTIFICATIONS, call, "permissionCallback");
            } else {
                call.resolve(granted());
            }
        } catch (Exception e) {
            fail(call, e, "Autorisation de notification non demandée.");
        }
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        try {
            call.resolve(granted());
        } catch (Exception e) {
            fail(call, e, "Autorisation de notification inconnue.");
        }
    }

    private JSObject granted() {
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", allowed && (nm == null || nm.areNotificationsEnabled()));
        return ret;
    }

    /** Réglages des rappels de cet appareil ; relecture immédiate de la liste (en arrière-plan). */
    @PluginMethod
    public void configure(PluginCall call) {
        try {
            ReminderScheduler.saveSettings(
                getContext(),
                call.getString("serverUrl", ""),
                call.getString("wsId", ""),
                call.getString("key", ""),
                call.getString("lang", "fr"),
                Boolean.TRUE.equals(call.getBoolean("enabled", false))
            );
            boolean scheduled = ReminderJob.schedule(getContext());
            refreshInBackground();
            JSObject ret = new JSObject();
            ret.put("scheduled", scheduled);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Rappels indisponibles.");
        }
    }

    /** Données changées (papier, rappel d'un agenda) : liste relue. */
    @PluginMethod
    public void refresh(PluginCall call) {
        refreshInBackground();
        call.resolve();
    }

    @PluginMethod
    public void test(PluginCall call) {
        try {
            boolean shown = ReminderNotifier.show(getContext(), "test", call.getString("title", "Ostal"), call.getString("body", ""), "#/");
            if (!shown) {
                call.reject("Les notifications d’Ostal sont bloquées : autorisez-les dans les réglages du téléphone (Applications → Ostal → Notifications).");
                return;
            }
            call.resolve();
        } catch (Exception e) {
            fail(call, e, "Notification d’essai impossible.");
        }
    }

    /** Application ouverte en touchant une notification de rappel : page à afficher (une seule fois). */
    @PluginMethod
    public void consumeLaunch(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            String url = getActivity() != null ? takeUrl(getActivity().getIntent()) : null;
            if (url != null) ret.put("url", url);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Lancement non lu.");
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String url = takeUrl(intent);
        if (url == null) return;
        JSObject data = new JSObject();
        data.put("url", url);
        // Gardé jusqu'à ce que la page écoute (application qui démarre).
        notifyListeners("open", data, true);
    }

    private static String takeUrl(Intent intent) {
        if (intent == null) return null;
        String url = intent.getStringExtra(ReminderNotifier.EXTRA_OPEN);
        if (url == null) return null;
        intent.removeExtra(ReminderNotifier.EXTRA_OPEN);
        return url.startsWith("#/") ? url : null;
    }

    private void refreshInBackground() {
        Context app = getContext().getApplicationContext();
        new Thread(
            () -> {
                try {
                    ReminderScheduler.refresh(app);
                } catch (Exception e) {
                    Log.w(TAG, "Rappels non relus", e);
                }
            },
            "notes-reminders"
        ).start();
    }

    private static void fail(PluginCall call, Exception e, String message) {
        Log.w(TAG, message, e);
        call.reject(message, e);
    }
}
