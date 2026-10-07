package com.shinezeo.notes;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Fichiers de l'atelier PDF.
 *
 * <p>Export : le PDF fabriqué par la page est transmis par morceaux ({@link #begin}, {@link #append}), puis enregistré
 * à l'endroit choisi dans le sélecteur de fichiers d'Android ({@link #save}) ou envoyé à une autre application
 * ({@link #share}).
 *
 * <p>Import : les PDF et photos reçus d'autres applications (« Ouvrir avec Ostal », « Partager ») sont copiés dans le
 * cache de l'application ; la page les lit ({@link #takeIncoming}) puis les libère ({@link #releaseIncoming}).
 *
 * <p>Comme pour {@link AppUpdatePlugin}, aucune exception ne doit sortir d'une méthode (elle fermerait l'application) :
 * les erreurs sont renvoyées au JavaScript.
 */
@CapacitorPlugin(name = "NotesFiles")
public class NotesFilesPlugin extends Plugin {

    private static final String TAG = "NotesFiles";
    private static final String EXPORTS_DIR = "exports";
    private static final String INCOMING_DIR = "incoming";
    /** Intention déjà traitée (activité recréée après une rotation, par exemple). */
    private static final String EXTRA_HANDLED = "com.shinezeo.notes.FILES_HANDLED";
    private static final long MAX_INCOMING_BYTES = 300L * 1024 * 1024;
    private static final long EXPORT_MAX_AGE_MS = 60L * 60 * 1000;

    private final List<JSObject> incoming = new ArrayList<>();

    private static void fail(PluginCall call, Exception e, String message) {
        Log.w(TAG, message, e);
        call.reject(message, e);
    }

    @Override
    public void load() {
        try {
            deleteOlderThan(new File(getContext().getCacheDir(), EXPORTS_DIR), 0);
            Activity activity = getActivity();
            if (activity != null) receive(activity.getIntent());
        } catch (Exception e) {
            Log.w(TAG, "Démarrage des fichiers non terminé", e);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        try {
            receive(intent);
        } catch (Exception e) {
            Log.w(TAG, "Fichier reçu non traité", e);
        }
    }

    // ---------- Import : fichiers reçus d'autres applications ----------

    private void receive(Intent intent) {
        if (intent == null || intent.getBooleanExtra(EXTRA_HANDLED, false)) return;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (list != null) uris.addAll(list);
        } else {
            return;
        }
        ClipData clip = intent.getClipData();
        if (uris.isEmpty() && clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
        }
        intent.putExtra(EXTRA_HANDLED, true);
        if (uris.isEmpty()) return;
        final String type = intent.getType();
        // Copie hors du fil principal (fichiers volumineux) ; l'autorisation de lecture dure tant que l'activité vit.
        new Thread(() -> copyIncoming(uris, type), "notes-incoming").start();
    }

    private void copyIncoming(List<Uri> uris, String intentType) {
        Context context = getContext();
        File dir = new File(context.getCacheDir(), INCOMING_DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) {
            Log.w(TAG, "Dossier des fichiers reçus indisponible");
            return;
        }
        ContentResolver resolver = context.getContentResolver();
        int count = 0;
        for (Uri uri : uris) {
            try {
                String mime = resolver.getType(uri);
                if (mime == null) mime = intentType;
                String name = displayName(resolver, uri, mime);
                if (mime == null || mime.equals("*/*")) mime = name.toLowerCase(Locale.ROOT).endsWith(".pdf") ? "application/pdf" : "image/*";
                if (!mime.equals("application/pdf") && !mime.startsWith("image/")) continue;
                File out = new File(dir, System.currentTimeMillis() + "-" + count + "-" + safeName(name));
                long size = copy(resolver, uri, out);
                JSObject file = new JSObject();
                file.put("name", name);
                file.put("mime", mime);
                file.put("path", out.getAbsolutePath());
                file.put("size", size);
                synchronized (incoming) {
                    incoming.add(file);
                }
                count++;
            } catch (Exception e) {
                Log.w(TAG, "Fichier reçu illisible : " + uri, e);
            }
        }
        if (count > 0) {
            JSObject data = new JSObject();
            data.put("count", count);
            // Gardé jusqu'à l'écoute par la page (encore en chargement au lancement de l'application).
            notifyListeners("incoming", data, true);
        }
    }

    private static String displayName(ContentResolver resolver, Uri uri, String mime) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int index = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index >= 0) name = c.getString(index);
                }
            } catch (Exception e) {
                Log.w(TAG, "Nom du fichier reçu inconnu", e);
            }
        }
        if (name == null || name.trim().isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.trim().isEmpty()) name = "document";
        name = name.trim();
        if ("application/pdf".equals(mime) && !name.toLowerCase(Locale.ROOT).endsWith(".pdf")) name += ".pdf";
        return name;
    }

    private static String safeName(String name) {
        String clean = name.replaceAll("[^A-Za-z0-9._ -]", "_");
        if (clean.length() > 80) clean = clean.substring(clean.length() - 80);
        return clean.isEmpty() ? "fichier" : clean;
    }

    private static long copy(ContentResolver resolver, Uri uri, File out) throws IOException {
        long total = 0;
        byte[] buffer = new byte[64 * 1024];
        try (InputStream in = resolver.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new IOException("Lecture impossible");
            int n;
            while ((n = in.read(buffer)) != -1) {
                total += n;
                if (total > MAX_INCOMING_BYTES) throw new IOException("Fichier trop volumineux");
                os.write(buffer, 0, n);
            }
        } catch (IOException e) {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
            throw e;
        }
        return total;
    }

    /** Fichiers reçus pas encore lus par la page (la liste est vidée). */
    @PluginMethod
    public void takeIncoming(PluginCall call) {
        try {
            JSArray files = new JSArray();
            synchronized (incoming) {
                for (JSObject f : incoming) files.put(f);
                incoming.clear();
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Fichiers reçus illisibles.");
        }
    }

    /** Supprime les copies des fichiers reçus, une fois importés. */
    @PluginMethod
    public void releaseIncoming(PluginCall call) {
        try {
            File dir = new File(getContext().getCacheDir(), INCOMING_DIR).getCanonicalFile();
            JSArray paths = call.getArray("paths", new JSArray());
            for (int i = 0; i < paths.length(); i++) {
                File f = new File(paths.getString(i)).getCanonicalFile();
                if (dir.equals(f.getParentFile())) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
            call.resolve();
        } catch (Exception e) {
            fail(call, e, "Nettoyage des fichiers reçus impossible.");
        }
    }

    // ---------- Export : enregistrer ou partager le fichier fabriqué par la page (PDF, tableur) ----------

    private File exportFile(String id) throws IOException {
        if (id == null || !id.matches("[0-9a-f-]{36}")) throw new IOException("Export inconnu.");
        File dir = new File(new File(getContext().getCacheDir(), EXPORTS_DIR), id);
        File[] files = dir.listFiles();
        if (files == null || files.length != 1) throw new IOException("Export introuvable.");
        return files[0];
    }

    /** Nouveau fichier d'export (vide) ; renvoie son identifiant. */
    @PluginMethod
    public void begin(PluginCall call) {
        try {
            File root = new File(getContext().getCacheDir(), EXPORTS_DIR);
            deleteOlderThan(root, EXPORT_MAX_AGE_MS);
            String id = UUID.randomUUID().toString();
            File dir = new File(root, id);
            if (!dir.mkdirs()) throw new IOException("Stockage de l'application indisponible.");
            String name = call.getString("name", "document.pdf");
            File file = new File(dir, safeName(name == null ? "document.pdf" : name));
            if (!file.createNewFile()) throw new IOException("Fichier d'export impossible.");
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Préparation du fichier impossible.");
        }
    }

    /** Ajoute un morceau (base64) au fichier d'export. */
    @PluginMethod
    public void append(PluginCall call) {
        try {
            File file = exportFile(call.getString("id"));
            String data = call.getString("data", "");
            byte[] bytes = Base64.decode(data == null ? "" : data, Base64.DEFAULT);
            try (OutputStream os = new FileOutputStream(file, true)) {
                os.write(bytes);
            }
            call.resolve();
        } catch (Exception e) {
            fail(call, e, "Écriture du fichier impossible.");
        }
    }

    /** Sélecteur de fichiers d'Android (« Enregistrer sous ») ; résout { saved }. */
    @PluginMethod
    public void save(PluginCall call) {
        try {
            File file = exportFile(call.getString("id"));
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mimeOf(file));
            intent.putExtra(Intent.EXTRA_TITLE, file.getName());
            startActivityForResult(call, intent, "saveResult");
        } catch (Exception e) {
            fail(call, e, "Enregistrement impossible.");
        }
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            Intent data = result.getData();
            Uri target = data != null ? data.getData() : null;
            JSObject ret = new JSObject();
            if (result.getResultCode() != Activity.RESULT_OK || target == null) {
                ret.put("saved", false);
                call.resolve(ret);
                getBridge().releaseCall(call);
                return;
            }
            File file = exportFile(call.getString("id"));
            new Thread(
                () -> {
                    try {
                        byte[] buffer = new byte[64 * 1024];
                        try (InputStream in = new FileInputStream(file); OutputStream os = getContext().getContentResolver().openOutputStream(target, "wt")) {
                            if (os == null) throw new IOException("Destination inaccessible.");
                            int n;
                            while ((n = in.read(buffer)) != -1) os.write(buffer, 0, n);
                        }
                        JSObject ok = new JSObject();
                        ok.put("saved", true);
                        ok.put("uri", target.toString());
                        call.resolve(ok);
                    } catch (Exception e) {
                        fail(call, e, "Enregistrement impossible à cet endroit.");
                    } finally {
                        getBridge().releaseCall(call);
                    }
                },
                "notes-save"
            ).start();
        } catch (Exception e) {
            fail(call, e, "Enregistrement impossible.");
            getBridge().releaseCall(call);
        }
    }

    /** Envoie le fichier à une autre application (messagerie, e-mail, Drive…). */
    @PluginMethod
    public void share(PluginCall call) {
        try {
            File file = exportFile(call.getString("id"));
            Context context = getContext();
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mimeOf(file));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri(file.getName(), uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            String title = call.getString("title", file.getName());
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Activity activity = getActivity();
            if (activity == null) throw new IOException("Application en arrière-plan.");
            activity.startActivity(chooser);
            JSObject ret = new JSObject();
            ret.put("shared", true);
            call.resolve(ret);
        } catch (Exception e) {
            fail(call, e, "Partage impossible.");
        }
    }

    private static String mimeOf(File file) {
        String name = file.getName().toLowerCase(Locale.ROOT);
        if (name.endsWith(".pdf")) return "application/pdf";
        // Tableur exporté (bloc « Tableur » des notes).
        if (name.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (name.endsWith(".csv")) return "text/csv";
        return "application/octet-stream";
    }

    /** Supprime les exports plus anciens que `maxAge` (0 : tous). */
    private static void deleteOlderThan(File root, long maxAge) {
        File[] dirs = root.listFiles();
        if (dirs == null) return;
        long now = System.currentTimeMillis();
        for (File dir : dirs) {
            if (maxAge == 0 || now - dir.lastModified() > maxAge) deleteRecursive(dir);
        }
    }

    private static void deleteRecursive(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursive(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
