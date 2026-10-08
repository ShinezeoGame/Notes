package com.shinezeo.notes;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.Log;
import android.util.LruCache;
import android.util.TypedValue;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Barre de recherche du widget « Films et séries » : petite fenêtre par-dessus l'écran d'accueil, clavier (ou dictée)
 * tout de suite. Résultats de Seerr (par le serveur Ostal) avec leur affiche ; « Demander » envoie la demande sans
 * ouvrir Ostal (une série : toutes ses saisons, ou le choix des saisons dans Ostal).
 */
public class SeerrSearchActivity extends Activity {

    /** Ouverte par le micro du widget : dictée lancée tout de suite. */
    static final String EXTRA_VOICE = "com.shinezeo.notes.seerr.VOICE";
    /** Recherche à lancer dès l'ouverture (tests). */
    static final String EXTRA_QUERY = "com.shinezeo.notes.seerr.QUERY";
    private static final String TAG = "NotesWidgets";
    private static final int VOICE = 1;
    private static final String POSTER_BASE = "https://image.tmdb.org/t/p/w92";
    /** Affiches déjà chargées, gardées le temps de l'application. */
    private static final LruCache<String, Bitmap> POSTERS = new LruCache<>(80);

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final List<JSONObject> results = new ArrayList<>();
    private final Runnable later = () -> search(false);
    private Context themed;
    private EditText input;
    private TextView status;
    private ListView list;
    private ResultsAdapter adapter;
    private AlertDialog dialog;
    private int seq;
    private String busy = "";
    private String shown = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        themed = new ContextThemeWrapper(
            this,
            night ? android.R.style.Theme_DeviceDefault_Dialog_Alert : android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
        );
        int pad = dp(18);
        LinearLayout box = new LinearLayout(themed);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad / 2, pad, 0);

        input = new EditText(themed);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        input.setHint(WidgetStore.tr(this, "Rechercher un film ou une série…", "Search for a movie or a show…"));
        box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        status = new TextView(themed);
        status.setAlpha(0.75f);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        status.setPadding(dp(4), dp(8), dp(4), dp(4));
        status.setVisibility(View.GONE);
        box.addView(status);

        list = new ListView(themed);
        list.setDivider(null);
        adapter = new ResultsAdapter();
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, position, id) -> openApp(detailUrl(results.get(position))));
        box.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));

        dialog = new AlertDialog.Builder(themed)
            .setView(box)
            .setNegativeButton(WidgetStore.tr(this, "Fermer", "Close"), null)
            .setNeutralButton(WidgetStore.tr(this, "Ouvrir Ostal", "Open Ostal"), (d, which) -> openApp(listUrl()))
            .setOnDismissListener((d) -> finish())
            .create();
        input.addTextChangedListener(
            new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {}

                @Override
                public void afterTextChanged(Editable s) {
                    ui.removeCallbacks(later);
                    ui.postDelayed(later, 450);
                }
            }
        );
        input.setOnEditorActionListener((v, actionId, event) -> {
            // « Rechercher » du clavier, ou Entrée d'un clavier physique (appelé à l'appui puis au relâchement).
            boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER;
            if (actionId != EditorInfo.IME_ACTION_SEARCH && !enter) return false;
            if (enter && event.getAction() != KeyEvent.ACTION_DOWN) return true;
            ui.removeCallbacks(later);
            search(true);
            return true;
        });
        Window window = dialog.getWindow();
        if (window != null) {
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            window.setGravity(Gravity.TOP);
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.y = dp(40);
            window.setAttributes(attrs);
        }
        dialog.show();

        if (!WidgetStore.hasServer(this)) {
            showStatus(WidgetStore.tr(this, "Un serveur Ostal est nécessaire : ouvrez Ostal et rejoignez votre serveur.", "An Ostal server is needed: open Ostal and join your server."));
        }
        String query = getIntent().getStringExtra(EXTRA_QUERY);
        if (query != null && !query.trim().isEmpty()) {
            input.setText(query);
            input.setSelection(input.length());
            ui.removeCallbacks(later);
            search(true);
        } else if (getIntent().getBooleanExtra(EXTRA_VOICE, false)) {
            startVoice();
        }
        input.requestFocus();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        pool.shutdownNow();
        super.onDestroy();
    }

    // ---------- Recherche ----------

    private void search(boolean force) {
        String q = input.getText().toString().trim();
        if (q.length() < 2) {
            seq++;
            results.clear();
            adapter.notifyDataSetChanged();
            resize();
            if (force && !q.isEmpty()) showStatus(WidgetStore.tr(this, "Tapez au moins deux lettres.", "Type at least two letters."));
            else showStatus("");
            return;
        }
        if (!force && q.equals(shown)) return;
        if (!WidgetStore.hasServer(this)) return;
        int mine = ++seq;
        showStatus(WidgetStore.tr(this, "Recherche…", "Searching…"));
        Context app = getApplicationContext();
        pool.execute(() -> {
            try {
                JSONArray found = WidgetActions.seerrSearch(app, q);
                List<JSONObject> out = new ArrayList<>();
                for (int i = 0; i < found.length(); i++) {
                    JSONObject item = found.optJSONObject(i);
                    if (item != null) out.add(item);
                }
                ui.post(() -> {
                    if (mine != seq) return;
                    shown = q;
                    results.clear();
                    results.addAll(out);
                    adapter.notifyDataSetChanged();
                    resize();
                    showStatus(out.isEmpty() ? WidgetStore.tr(this, "Aucun film ni série trouvé pour « " + q + " ».", "No movie or show found for “" + q + "”.") : "");
                });
            } catch (WidgetApi.HttpError e) {
                ui.post(() -> {
                    if (mine == seq) showStatus(errorText(e));
                });
            } catch (Exception e) {
                Log.w(TAG, "Recherche impossible", e);
                ui.post(() -> {
                    if (mine == seq) showStatus(WidgetStore.tr(this, "Serveur Ostal injoignable.", "Ostal server unreachable."));
                });
            }
        });
    }

    private String errorText(WidgetApi.HttpError e) {
        if (e.status == 404) return WidgetStore.tr(this, "Seerr n’est pas encore relié : ouvrez Ostal, section Films et séries.", "Seerr isn’t connected yet: open Ostal, Movies & shows section.");
        if (e.status == 409) return WidgetStore.tr(this, "Déjà demandé.", "Already requested.");
        // Messages du serveur, écrits en français.
        return WidgetStore.isFrench(this) ? e.getMessage() : "Seerr refused or isn’t responding (" + e.status + ").";
    }

    private void showStatus(String text) {
        status.setText(text);
        status.setVisibility(text.isEmpty() ? View.GONE : View.VISIBLE);
    }

    /** Liste à la hauteur des résultats, sans dépasser la moitié de l'écran (le clavier prend le reste). */
    private void resize() {
        int max = getResources().getDisplayMetrics().heightPixels / 2;
        ViewGroup.LayoutParams params = list.getLayoutParams();
        params.height = Math.min(max, results.size() * dp(76));
        list.setLayoutParams(params);
    }

    // ---------- Demandes ----------

    private void ask(JSONObject item) {
        if ("tv".equals(item.optString("mediaType"))) {
            new AlertDialog.Builder(themed)
                .setTitle(item.optString("title"))
                .setItems(
                    new String[] {
                        WidgetStore.tr(this, "Demander toutes les saisons", "Request all seasons"),
                        WidgetStore.tr(this, "Choisir les saisons dans Ostal", "Choose seasons in Ostal"),
                    },
                    (d, which) -> {
                        if (which == 0) request(item);
                        else openApp(detailUrl(item));
                    }
                )
                .show();
            return;
        }
        request(item);
    }

    private void request(JSONObject item) {
        String key = key(item);
        if (!busy.isEmpty()) return;
        busy = key;
        adapter.notifyDataSetChanged();
        Context app = getApplicationContext();
        pool.execute(() -> {
            String error = null;
            String state = "";
            try {
                state = WidgetActions.seerrRequest(app, item.optString("mediaType"), item.optInt("id"));
            } catch (WidgetApi.HttpError e) {
                error = errorText(e);
            } catch (Exception e) {
                Log.w(TAG, "Demande impossible", e);
                error = WidgetStore.tr(this, "Serveur Ostal injoignable.", "Ostal server unreachable.");
            }
            String message = error;
            String done = state;
            ui.post(() -> {
                busy = "";
                if (message == null) {
                    try {
                        item.put("state", "waiting".equals(done) ? "pending" : "processing");
                    } catch (Exception ignored) {
                        // Valeur simple.
                    }
                    Toast.makeText(this, WidgetStore.tr(this, "Demande envoyée : ", "Request sent: ") + item.optString("title"), Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                }
                adapter.notifyDataSetChanged();
            });
        });
    }

    // ---------- Dictée ----------

    private void startVoice() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, WidgetStore.isFrench(this) ? "fr-FR" : "en-US")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, WidgetStore.tr(this, "Quel film ou quelle série ?", "Which movie or show?"))
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(intent, VOICE);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, WidgetStore.tr(this, "Dictée indisponible sur ce téléphone : tapez le titre.", "Voice input isn’t available on this phone: type the title."), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != VOICE || resultCode != RESULT_OK || data == null) return;
        ArrayList<String> heard = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (heard == null || heard.isEmpty()) return;
        input.setText(heard.get(0));
        input.setSelection(input.length());
        ui.removeCallbacks(later);
        search(true);
    }

    // ---------- Ouvrir Ostal ----------

    private String listUrl() {
        String q = input.getText().toString().trim();
        return q.isEmpty() ? "#/films" : "#/films/chercher/" + android.net.Uri.encode(q);
    }

    private static String detailUrl(JSONObject item) {
        return WidgetViews.mediaUrl(item.optString("mediaType"), item.optInt("id"));
    }

    private void openApp(String url) {
        startActivity(
            new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(ReminderNotifier.EXTRA_OPEN, url)
        );
        dialog.dismiss();
    }

    // ---------- Résultats ----------

    private static String key(JSONObject item) {
        return item.optString("mediaType") + ":" + item.optInt("id");
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class Row {

        ImageView poster;
        TextView title;
        TextView sub;
        Button ask;
    }

    private final class ResultsAdapter extends BaseAdapter {

        @Override
        public int getCount() {
            return results.size();
        }

        @Override
        public Object getItem(int position) {
            return results.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            Row row;
            View view = convertView;
            if (view == null) {
                LinearLayout line = new LinearLayout(themed);
                line.setOrientation(LinearLayout.HORIZONTAL);
                line.setGravity(Gravity.CENTER_VERTICAL);
                line.setPadding(0, dp(6), 0, dp(6));
                row = new Row();
                row.poster = new ImageView(themed);
                row.poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
                row.poster.setBackgroundColor(0x22888888);
                line.addView(row.poster, new LinearLayout.LayoutParams(dp(42), dp(63)));
                LinearLayout texts = new LinearLayout(themed);
                texts.setOrientation(LinearLayout.VERTICAL);
                LinearLayout.LayoutParams textsParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                textsParams.setMarginStart(dp(12));
                line.addView(texts, textsParams);
                row.title = new TextView(themed);
                row.title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
                row.title.setTypeface(Typeface.DEFAULT_BOLD);
                row.title.setMaxLines(2);
                row.title.setEllipsize(TextUtils.TruncateAt.END);
                texts.addView(row.title);
                row.sub = new TextView(themed);
                row.sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
                row.sub.setAlpha(0.7f);
                row.sub.setMaxLines(1);
                row.sub.setEllipsize(TextUtils.TruncateAt.END);
                texts.addView(row.sub);
                row.ask = new Button(themed, null, android.R.attr.borderlessButtonStyle);
                row.ask.setAllCaps(false);
                // Le bouton ne doit pas empêcher de toucher la ligne (ouvrir la fiche dans Ostal).
                row.ask.setFocusable(false);
                line.addView(row.ask, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                line.setTag(row);
                view = line;
            } else {
                row = (Row) view.getTag();
            }
            JSONObject item = results.get(position);
            boolean tv = "tv".equals(item.optString("mediaType"));
            String state = item.optString("state", "");
            row.title.setText(item.optString("title"));
            List<String> parts = new ArrayList<>();
            if (item.optInt("year") > 0) parts.add(String.valueOf(item.optInt("year")));
            parts.add(tv ? WidgetStore.tr(SeerrSearchActivity.this, "Série", "Show") : WidgetStore.tr(SeerrSearchActivity.this, "Film", "Movie"));
            String label = WidgetViews.mediaState(SeerrSearchActivity.this, state);
            if (!label.isEmpty()) parts.add(label);
            row.sub.setText(TextUtils.join(" · ", parts));
            boolean canAsk = state.isEmpty() || (tv && !"available".equals(state));
            row.ask.setVisibility(canAsk ? View.VISIBLE : View.GONE);
            boolean sending = busy.equals(key(item));
            row.ask.setEnabled(busy.isEmpty());
            row.ask.setText(
                sending
                    ? WidgetStore.tr(SeerrSearchActivity.this, "Envoi…", "Sending…")
                    : tv && !state.isEmpty()
                        ? WidgetStore.tr(SeerrSearchActivity.this, "Saisons…", "Seasons…")
                        : WidgetStore.tr(SeerrSearchActivity.this, "Demander", "Request")
            );
            row.ask.setOnClickListener((v) -> {
                if (tv && !state.isEmpty()) openApp(detailUrl(item));
                else ask(item);
            });
            String path = item.optString("poster", "");
            row.poster.setTag(path);
            Bitmap cached = path.isEmpty() ? null : POSTERS.get(path);
            row.poster.setImageBitmap(cached);
            if (cached == null && !path.isEmpty()) {
                ImageView target = row.poster;
                pool.execute(() -> {
                    Bitmap bitmap = loadPoster(path);
                    if (bitmap != null) ui.post(() -> {
                        if (path.equals(target.getTag())) target.setImageBitmap(bitmap);
                    });
                });
            }
            return view;
        }
    }

    /** Petite affiche du film (images de TMDB, la base de films de Seerr). */
    private static Bitmap loadPoster(String path) {
        Bitmap hit = POSTERS.get(path);
        if (hit != null) return hit;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(POSTER_BASE + path).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(10000);
            if (conn.getResponseCode() != 200) return null;
            try (InputStream in = conn.getInputStream()) {
                Bitmap bitmap = BitmapFactory.decodeStream(in);
                if (bitmap != null) POSTERS.put(path, bitmap);
                return bitmap;
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
