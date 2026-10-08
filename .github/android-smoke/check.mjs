// Pilote l'application installée sur l'émulateur par le débogage de sa WebView (APK debug) et vérifie chaque
// étape sensible côté Android : liaison à un serveur, vérification en arrière-plan, notification, mise à jour,
// fichiers de l'atelier PDF, rappels programmés par le téléphone, widgets de l'écran d'accueil et raccourcis.
// Lancé par run.sh (serveur Ostal du runner joignable depuis l'émulateur en 10.0.2.2:3000).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const PKG = 'com.shinezeo.notes';
const JOB_ID = '4202';
const SERVER = 'http://10.0.2.2:3000';
const OUT = process.env.SMOKE_OUT || 'smoke-out';
const DIST_V2 = process.env.DIST_V2;
const DEVTOOLS_PORT = 9222;
/** Petit PDF d'une page (« Recu par Android »). */
const TINY_PDF = 'JVBERi0xLjcKJYGBgYEKCjEgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgNSAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iagoKNSAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDEgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0hlbHZldGljYS03MDk4NDgwNzg5IDQgMCBSCj4+Ci9YT2JqZWN0IDw8Cj4+Ci9FeHRHU3RhdGUgPDwKPj4KPj4KL01lZGlhQm94IFsgMCAwIDMwMCAyMDAgXQovQW5ub3RzIFsgXQovQ29udGVudHMgWyA2IDAgUiBdCj4+CmVuZG9iagoKNiAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDEwOQo+PgpzdHJlYW0KeJwdyjsKAlEMRuH+X0VqQUxibnIviIUwYmEjZAMioyhaKDLrnwen+zhfHBJMc78HNqf+PfT/5+26Dm7VKkdtpEx5hxrlGbKsMpvw5B/sinrxbRTlYJdQZRPv3EL96M1tT/lCrtAlLhgBnekYZAplbmRzdHJlYW0KZW5kb2JqCgo3IDAgb2JqCjw8Ci9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9UeXBlIC9PYmpTdG0KL04gMgovRmlyc3QgMTAKL0xlbmd0aCAyMjQKPj4Kc3RyZWFtCnic1VFNi8IwEL3nV8xx9zRjGtPtUgqubdnLwsIuCN5qGyQgidQo+O+dKQpe9O7hMZn33nyRDAgMmLmBslT4O8bh2LsRyrZpW6KciKxhWCJdc1wyCobmnDX9wW9Gzp4JzOUZUbZgjesFlkmpEX3yzq/1DUf2WvFwb/Ea6Xc/V2aJjwnRn+5TVAp/4lB3ycFb/alJWyp0MTNkya7fFS5H16X4usdN+/sYHl5YVUp+8f+8d4BtDEnh33GTplTImcKv7uBEAfx2u5NLvu8UNqGPgw9bwJUPi3DwN0I6XgBwin6QCmVuZHN0cmVhbQplbmRvYmoKCjggMCBvYmoKPDwKL1NpemUgOQovUm9vdCAyIDAgUgovSW5mbyAzIDAgUgovRmlsdGVyIC9GbGF0ZURlY29kZQovVHlwZSAvWFJlZgovTGVuZ3RoIDQ0Ci9XIFsgMSAyIDIgXQovSW5kZXggWyAwIDkgXQo+PgpzdHJlYW0KeJxjYGD4/5+RQYCBgZHBh4GBiYEdQjAyMtQBxRgdQcR3IMFsy8AAAHYmBGwKZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjgyOQolJUVPRg==';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const consoleLog = [];

function adb(...args) {
  try {
    return execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
  } catch (e) {
    return String(e.stdout ?? '').trim();
  }
}

const pid = () => adb('shell', 'pidof', PKG).split(/\s+/)[0] || '';
const crashLog = () => {
  const log = adb('logcat', '-d', '-b', 'crash');
  return log.includes(PKG) ? log : '';
};

/** L'application s'est fermée : inutile d'attendre davantage. */
class Closed extends Error {}

/** Processus de l'application ; plusieurs essais (une commande adb peut échouer ponctuellement). */
async function alivePid() {
  for (let i = 0; i < 3; i++) {
    const p = pid();
    if (p) return p;
    await sleep(1000);
  }
  return '';
}

/**
 * Arrêt décidé par Android pour une cause extérieure à l'application : sur l'émulateur, Google Play Services
 * redémarre parfois, et Android arrête alors les applications qui utilisent l'un de ses services (polices de la
 * WebView) : « am_kill … depends on provider … in dying proc … ». Cherché pour le dernier processus de
 * l'application lancé par Android.
 */
function externalKill() {
  const events = adb('logcat', '-d', '-b', 'events', '-t', '2000').split('\n');
  const start = events.findLast((l) => l.includes('am_proc_start') && l.includes(`,${PKG},`));
  const p = start?.match(/am_proc_start\s*:\s*\[\d+,(\d+),/)?.[1];
  if (!p) return '';
  return events.find((l) => l.includes('am_kill') && l.includes(`,${p},${PKG},`) && l.includes('in dying proc')) ?? '';
}

/** Relances après un arrêt extérieur (limitées : un arrêt qui se répète n'est plus un hasard). */
let relaunches = 0;

/** Application arrêtée pour une cause extérieure : relancée (vrai), sinon faux. */
async function relaunchAfterExternalKill(when) {
  const kill = externalKill();
  if (!kill || relaunches >= 3) return false;
  relaunches++;
  // Rien à voir avec Ostal : relancée, puis vérifiée de nouveau.
  const note = `   ⚠️ arrêtée par Android ${when}, cause extérieure (${kill.replace(/^.*am_kill\s*:\s*/, '')}) : relancée`;
  report.push(note);
  console.log(note);
  client?.close();
  client = null;
  adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
  await sleep(8000);
  return true;
}

/** État du système au moment d'un échec : processus, arrêts décidés par Android, extrait du journal. */
function diagnostics() {
  const keep = (text, re, n) => text.split('\n').filter((l) => re.test(l)).slice(-n).join('\n');
  const report = [
    '--- processus ---',
    keep(adb('shell', 'ps', '-A'), /shinezeo|webview|sandboxed/i, 20),
    '--- événements système (application) ---',
    keep(adb('logcat', '-d', '-b', 'events', '-t', '2000'), /shinezeo|am_anr|am_crash|am_kill|am_low_memory/i, 40),
    '--- journal (extrait) ---',
    keep(adb('logcat', '-d', '-t', '5000'), /shinezeo|AndroidRuntime|lowmemorykiller|lmkd|chromium|cr_|Capacitor|DEBUG|libc|ActivityManager|ActivityTaskManager|Fatal|SIGSEGV|SIGABRT|WebView/i, 200),
  ].join('\n');
  console.log(report);
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'diagnostic.txt'), `${report}\n`);
  } catch {
    /* rapport facultatif */
  }
}

async function assertAlive(when, relaunched = false) {
  const crash = crashLog();
  if (!crash && !relaunched && !(await alivePid()) && (await relaunchAfterExternalKill(when))) return assertAlive(when, true);
  if (!(await alivePid()) || crash) {
    diagnostics();
    throw new Closed(`l’application s’est fermée ${when}${crash ? `\n${crash.split('\n').slice(0, 40).join('\n')}` : ''}`);
  }
}

async function until(what, fn, timeout = 60_000, every = 1000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      if (e instanceof Closed) throw e;
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`${what} : délai dépassé${last ? ` (${last.message})` : ''}`);
}

// ---------- Protocole de débogage (CDP) de la WebView ----------

let client = null;

function openCdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    const pending = new Map();
    let seq = 0;
    const api = {
      closed: false,
      send(method, params = {}, timeout = 30_000) {
        return new Promise((res, rej) => {
          if (api.closed) return rej(new Error('connexion fermée'));
          const id = ++seq;
          const timer = setTimeout(() => {
            pending.delete(id);
            rej(new Error(`délai dépassé (${method})`));
          }, timeout);
          pending.set(id, (msg) => {
            clearTimeout(timer);
            if (msg.error) rej(new Error(msg.error.message));
            else res(msg.result);
          });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      async evaluate(expression, timeout) {
        const r = await api.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      close() {
        api.closed = true;
        ws.close();
      },
    };
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.id) {
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        cb?.(msg);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        consoleLog.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        consoleLog.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      }
    });
    ws.on('close', () => {
      api.closed = true;
      for (const cb of pending.values()) cb({ error: { message: 'connexion fermée' } });
      pending.clear();
    });
    ws.once('error', reject);
    ws.once('open', () => {
      api.send('Runtime.enable').catch(() => {});
      resolve(api);
    });
  });
}

async function connect() {
  client?.close();
  client = null;
  const p = await until('processus de l’application', () => pid(), 30_000);
  const socket = `webview_devtools_remote_${p}`;
  await until('débogage de la WebView', () => adb('shell', 'cat', '/proc/net/unix').includes(socket), 60_000);
  adb('forward', `tcp:${DEVTOOLS_PORT}`, `localabstract:${socket}`);
  const target = await until(
    'page de l’application',
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)).json();
      return list.find((t) => t.type === 'page' && t.url.startsWith('https://localhost'));
    },
    60_000,
  );
  client = await openCdp(target.webSocketDebuggerUrl);
}

/** Évalue du JavaScript dans l'application (reconnexion si le processus a changé). */
async function js(expression, timeout = 30_000) {
  if (!client || client.closed) {
    if (!(await alivePid()) && !(crashLog() === '' && (await relaunchAfterExternalKill(`pendant « ${current} »`)))) {
      diagnostics();
      throw new Closed('l’application s’est fermée');
    }
    await connect();
  }
  return client.evaluate(expression, timeout);
}

const loadedVersion = () => js("fetch('/version.json', { cache: 'no-store' }).then((r) => r.json()).then((v) => v.version)");

// ---------- Scénario ----------

const report = [];
let current = '';
async function step(name, fn) {
  current = name;
  await fn();
  report.push(`✅ ${name}`);
  console.log(`✅ ${name}`);
}

let ok = false;
try {
  await step('Premier lancement : l’application s’ouvre et reste ouverte', async () => {
    adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
    await until('écran « Welcome to Ostal » (anglais par défaut)', () => js("document.body?.innerText.includes('Welcome to Ostal')"), 120_000, 2000);
    const ua = await js('navigator.userAgent');
    report.push(`   WebView : ${ua}`);
    console.log(`   WebView : ${ua}`);
    await sleep(6000);
    await assertAlive('au premier lancement');
  });

  // Français choisi : la notification de mise à jour (plus bas) doit aussi être en français.
  await step('Choix de la langue : « Français » relance l’application en français', async () => {
    // Clic différé : l'application se recharge aussitôt, après la réponse à cette évaluation.
    await js("setTimeout(() => document.querySelector('.nb-onboarding-lang button[lang=\"fr\"]').click(), 200); true");
    await sleep(2000);
    await until('écran « Bienvenue dans Ostal »', () => js("document.body?.innerText.includes('Bienvenue dans Ostal')"), 60_000, 1000);
    await assertAlive('après le choix de la langue');
  });

  await step('Liaison au serveur : l’application reste ouverte, affiche l’accueil puis les pages', async () => {
    await js(`(async () => {
      const KEY = 'notes.settings.v1';
      const s = JSON.parse(localStorage.getItem(KEY));
      const r = await fetch('${SERVER}/api/workspaces/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wsId: s.workspaceId, key: s.workspaceKey }),
      });
      if (!r.ok) throw new Error('espace refusé : ' + r.status);
      localStorage.setItem(KEY, JSON.stringify({ ...s, serverUrl: '${SERVER}', onboarded: true }));
      setTimeout(() => location.reload(), 200);
      return true;
    })()`);
    await sleep(2000);
    await until('accueil affiché', () => js("!!document.querySelector('.dash-grid .dash-widget')"), 120_000, 2000);
    // Section Notes (liste des pages sur téléphone), puis la page de bienvenue dans l'éditeur.
    await js("location.hash = '#/notes'; true");
    await until('liste des pages', () => js("!!document.querySelector('.nb-tree-row')"), 60_000, 1000);
    await js("document.querySelector('.nb-tree-row').click(); true");
    await until('éditeur affiché', () => js("!!document.querySelector('.nb-editor .ProseMirror')"), 60_000, 2000);
    // Démarrage natif (1,5 s après le chargement) : vérification programmée, autorisations, nettoyage…
    await sleep(15_000);
    await assertAlive('après la liaison au serveur');
  });

  await step('Vérification des mises à jour programmée en arrière-plan', async () => {
    await until('tâche programmée', () => adb('shell', 'dumpsys', 'jobscheduler', PKG).includes(`${PKG}/.UpdateCheckJob`), 30_000, 2000);
  });

  let v2 = '';
  await step('Nouvelle version sur le serveur : notification « Mise à jour d’Ostal disponible »', async () => {
    fs.rmSync('client/dist', { recursive: true, force: true });
    fs.cpSync(DIST_V2, 'client/dist', { recursive: true });
    v2 = JSON.parse(fs.readFileSync('client/dist/version.json', 'utf8')).version;
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await sleep(3000);
    adb('shell', 'cmd', 'jobscheduler', 'run', '-f', PKG, JOB_ID);
    await until(
      'notification affichée',
      () => adb('shell', 'dumpsys', 'notification', '--noredact').includes('Mise à jour d’Ostal disponible'),
      60_000,
      2000,
    );
    await assertAlive('pendant la vérification en arrière-plan');
  });

  await step('Toucher la notification : mise à jour téléchargée puis installée, sans nouvel APK', async () => {
    // Même intention que la notification (application déjà ouverte : onNewIntent).
    adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`, '--ez', 'com.shinezeo.notes.UPDATE', 'true');
    await until(`version ${v2} chargée`, async () => (await loadedVersion()) === v2, 180_000, 2000);
    // La nouvelle version confirme son démarrage (message « Ostal a été mis à jour »).
    await until('démarrage confirmé', () => js("localStorage.getItem('notes.update.pending') === null"), 30_000);
    await sleep(5000);
    await assertAlive('pendant la mise à jour');
  });

  await step('Redémarrage : la nouvelle version est conservée', async () => {
    client?.close();
    client = null;
    adb('shell', 'am', 'force-stop', PKG);
    await sleep(2000);
    adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
    await until(`version ${v2} après redémarrage`, async () => (await loadedVersion()) === v2, 120_000, 2000);
    await sleep(8000);
    await assertAlive('après le redémarrage');
  });

  // ---------- Atelier PDF : fichiers reçus, partage, enregistrement (plugin natif NotesFiles) ----------

  /** Crée un PDF dans le cache d'exports de l'application ; renvoie son identifiant. */
  const nativePdf = (name) =>
    js(`(async () => {
      const cap = window.Capacitor;
      const { id } = await cap.nativePromise('NotesFiles', 'begin', { name: '${name}', mime: 'application/pdf' });
      await cap.nativePromise('NotesFiles', 'append', { id, data: '${TINY_PDF}' });
      return id;
    })()`);

  /** État de l'atelier PDF au moment d'un échec : page, messages, journal natif, fichiers du cache. */
  async function pdfDiagnostics() {
    const lines = ['--- atelier PDF : page ---'];
    try {
      lines.push(
        await js(`JSON.stringify({
          hash: location.hash,
          notesFiles: (window.Capacitor?.PluginHeaders ?? []).some((h) => h.name === 'NotesFiles'),
          busy: document.querySelector('.pdf-busy')?.textContent ?? null,
          toasts: [...document.querySelectorAll('.nb-toast')].map((t) => t.textContent),
          text: document.body.innerText.slice(0, 300),
        }, null, 1)`),
      );
    } catch (e) {
      lines.push(`page illisible : ${e.message}`);
    }
    lines.push('--- erreurs de la page ---', ...consoleLog.slice(-30));
    lines.push(
      '--- journal natif (NotesFiles, console) ---',
      adb('logcat', '-d', '-v', 'time', '-s', 'NotesFiles:V', 'Capacitor/Console:V', 'Capacitor:V', 'Capacitor/Plugin:V')
        .split('\n')
        .filter((l) => !/Handling local request|Notifying listeners|callback ID|To native|from native/i.test(l))
        .slice(-60)
        .join('\n'),
    );
    lines.push('--- cache de l’application ---', adb('shell', 'run-as', PKG, 'ls', '-la', 'cache/incoming', 'cache/exports'));
    const text = lines.join('\n');
    console.log(text);
    try {
      fs.mkdirSync(OUT, { recursive: true });
      fs.appendFileSync(path.join(OUT, 'diagnostic.txt'), `${text}\n`);
    } catch {
      /* rapport facultatif */
    }
  }

  /** Étape de l'atelier PDF : diagnostic détaillé si elle échoue. */
  const pdfStep = (name, fn) =>
    step(name, async () => {
      try {
        await fn();
      } catch (e) {
        if (!(e instanceof Closed)) await pdfDiagnostics();
        throw e;
      }
    });

  await pdfStep('Atelier PDF : « Ouvrir avec Ostal » importe un PDF reçu d’une autre application', async () => {
    const id = await nativePdf('recu.pdf');
    // Adresse de notre propre FileProvider : l'application lit ce fichier comme un PDF envoyé par une autre.
    const uri = `content://${PKG}.fileprovider/my_cache_images/exports/${id}/recu.pdf`;
    console.log(adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', uri, '-t', 'application/pdf', '-n', `${PKG}/.MainActivity`));
    await until('fichier transmis à la page (atelier PDF ouvert)', () => js("location.hash.startsWith('#/pdf')"), 30_000, 1000);
    await until('PDF importé et ouvert', () => js("/^#\\/pdf\\/[A-Za-z0-9_-]+$/.test(location.hash) && document.querySelectorAll('.pdfa-page').length === 1"), 90_000, 2000);
    await until('page affichée', () => js("!!document.querySelector('.pdfa-page canvas.pdf-canvas:not(.pdf-canvas--loading)')"), 60_000, 2000);
    const name = await js("document.querySelector('.nb-crumb-current')?.textContent ?? ''");
    if (name !== 'recu') throw new Error(`nom du PDF importé : « ${name} »`);
    await assertAlive('après l’import d’un PDF reçu');
  });

  /** Fenêtre au premier plan (celle qui reçoit la touche Retour). */
  const focused = () => {
    const lines = adb('shell', 'dumpsys', 'window').split('\n');
    const current = lines.find((l) => l.includes('mCurrentFocus=')) ?? '';
    return /=null\b/.test(current) ? (lines.find((l) => l.includes('mFocusedApp=')) ?? '') : current;
  };
  const appInFront = () => focused().includes(`${PKG}/`);

  /**
   * Ferme une fenêtre d'Android ouverte par l'application (menu de partage, sélecteur de fichiers) avec Retour,
   * comme l'utilisateur qui renonce. On attend qu'elle ait le premier plan (la première ouverture peut prendre
   * plusieurs secondes sur l'émulateur), puis Retour jusqu'au retour de l'application (un premier appui peut
   * seulement fermer le clavier).
   */
  async function dismiss(what, re) {
    await until(what, () => re.test(focused()), 60_000, 1500);
    await sleep(1500);
    await until(
      `retour à l’application (${what} fermé)`,
      () => {
        if (appInFront()) return true;
        adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
        return false;
      },
      45_000,
      2500,
    );
  }

  await pdfStep('Atelier PDF : « Partager » ouvre le menu de partage d’Android', async () => {
    const id = await nativePdf('partage.pdf');
    await js(`window.Capacitor.nativePromise('NotesFiles', 'share', { id: '${id}', title: 'partage.pdf' }).then(() => true)`);
    await dismiss('menu de partage', /ChooserActivity|ResolverActivity|intentresolver/);
    await assertAlive('après le partage');
  });

  await pdfStep('Atelier PDF : « Enregistrer » ouvre le sélecteur de fichiers ; Retour = annulé', async () => {
    const id = await nativePdf('enregistre.pdf');
    await js(`(window.__pdfSave = null, window.Capacitor.nativePromise('NotesFiles', 'save', { id: '${id}' }).then((r) => (window.__pdfSave = r), (e) => (window.__pdfSave = { error: String(e) })), true)`);
    await dismiss('sélecteur de fichiers', /documentsui/i);
    const result = await until('réponse de l’enregistrement', () => js('window.__pdfSave'), 30_000, 1000);
    if (result.saved !== false) throw new Error('réponse inattendue : ' + JSON.stringify(result));
    await assertAlive('après l’annulation de l’enregistrement');
  });

  // ---------- Rappels : alarme programmée par le téléphone, notification à l'heure (plugin natif Reminders) ----------

  await step('Rappels : événement dans 75 s, notification Android à l’heure, application en arrière-plan', async () => {
    if (!(await js("(window.Capacitor?.PluginHeaders ?? []).some((h) => h.name === 'Reminders')"))) throw new Error('plugin Reminders absent');
    const s = await js("JSON.parse(localStorage.getItem('notes.settings.v1'))");
    // Agenda « Famille » avec rappel à l'heure de l'événement, écrit dans l'espace comme le ferait un autre appareil.
    const doc = new Y.Doc();
    const provider = new WebsocketProvider('ws://127.0.0.1:3000/ws', `ws_${s.workspaceId}`, doc, { WebSocketPolyfill: WebSocket, params: { key: s.workspaceKey } });
    await new Promise((resolve, reject) => {
      provider.once('sync', resolve);
      setTimeout(() => reject(new Error('espace non synchronisé')), 30_000);
    });
    const start = Date.now() + 75_000;
    doc.transact(() => {
      const agenda = doc.getMap('agenda');
      agenda.set('config', JSON.stringify({ calendars: [{ id: 'famille', name: 'Famille', color: '#2383e2', source: '', enabled: true, remind: '0' }] }));
      agenda.set(
        'events:famille',
        JSON.stringify({
          events: [{ id: 'ci', title: 'Rappel Ostal CI', start: new Date(start).toISOString(), end: new Date(start + 3_600_000).toISOString(), allDay: false, location: '', description: '', url: '' }],
          updatedAt: Date.now(),
        }),
      );
    });
    await sleep(2000);
    provider.destroy();
    // Activation comme la page (Réglages → Rappels) ; autorisation de notification accordée d'avance (run.sh).
    const res = await js(`(async () => {
      const cap = window.Capacitor;
      const perm = await cap.nativePromise('Reminders', 'requestPermission');
      const s = JSON.parse(localStorage.getItem('notes.settings.v1'));
      const conf = await cap.nativePromise('Reminders', 'configure', { serverUrl: '${SERVER}', wsId: s.workspaceId, key: s.workspaceKey, lang: 'fr', enabled: true });
      return { perm, conf };
    })()`);
    if (!res?.perm?.granted) throw new Error('notifications non autorisées : ' + JSON.stringify(res));
    await until('relecture des rappels programmée', () => adb('shell', 'dumpsys', 'jobscheduler', PKG).includes(`${PKG}/.ReminderJob`), 30_000, 2000);
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await until('notification du rappel', () => adb('shell', 'dumpsys', 'notification', '--noredact').includes('Rappel Ostal CI'), 180_000, 3000);
    await assertAlive('après le rappel');
  });

  await step('Toucher la notification d’un rappel : Ostal s’ouvre sur la page du rappel', async () => {
    // Même intention que la notification (extra « page à ouvrir ») ; l'application est en arrière-plan.
    adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`, '--es', 'com.shinezeo.notes.OPEN_URL', "'#/agenda'");
    await until('section Agenda affichée', () => js("location.hash === '#/agenda' && !!document.querySelector('.ag-grid, .ag-list')"), 60_000, 2000);
    await assertAlive('après l’ouverture depuis un rappel');
  });

  // ---------- Widgets de l'écran d'accueil et raccourcis du lanceur (plugin natif Widgets) ----------

  const widgets = (method, opts = {}) => js(`window.Capacitor.nativePromise('Widgets', '${method}', ${JSON.stringify(opts)})`, 60_000);
  const settings = () => js("JSON.parse(localStorage.getItem('notes.settings.v1'))");
  /** Espace de l'application modifié depuis le runner, comme le ferait un autre appareil. */
  async function editWorkspace(fn) {
    const s = await settings();
    const doc = new Y.Doc();
    const provider = new WebsocketProvider('ws://127.0.0.1:3000/ws', `ws_${s.workspaceId}`, doc, { WebSocketPolyfill: WebSocket, params: { key: s.workspaceKey } });
    try {
      await new Promise((resolve, reject) => {
        provider.once('sync', resolve);
        setTimeout(() => reject(new Error('espace non synchronisé')), 30_000);
      });
      doc.transact(() => fn(doc));
      await sleep(2000);
    } finally {
      provider.destroy();
    }
  }
  /** Ce que le serveur renvoie aux widgets (listes de tâches, ordinateurs). */
  const serverWidgets = async () => {
    const s = await settings();
    return (await fetch('http://127.0.0.1:3000/api/widgets', { headers: { 'x-ws-id': s.workspaceId, 'x-ws-key': s.workspaceKey } })).json();
  };
  const serverTasks = async (list) => (await serverWidgets()).tasks.find((l) => l.id === list)?.items ?? [];
  let listId = '';

  await step('Widgets : Tâches, Allumer l’ordinateur et Raccourcis proposés par Android, affichés avec les tâches de l’accueil', async () => {
    if (!(await js("(window.Capacitor?.PluginHeaders ?? []).some((h) => h.name === 'Widgets')"))) throw new Error('plugin Widgets absent');
    // Widget refusé par Android (description XML invalide) : absent de cette liste.
    const providers = adb('shell', 'dumpsys', 'appwidget');
    for (const w of ['ShortcutsWidget', 'TasksWidget', 'WakeWidget']) {
      if (!providers.includes(`${PKG}.${w}`) && !providers.includes(`/.${w}`)) throw new Error(`widget ${w} inconnu d’Android`);
    }
    listId = await until('listes de tâches transmises au téléphone', async () => (await widgets('state'))?.data?.tasks?.[0]?.id, 60_000, 2000);
    await editWorkspace((doc) => doc.getMap(`dash-tasks:${listId}`).set('ci-task', JSON.stringify({ text: 'Tâche Ostal CI', done: false, order: 99, doneAt: 0 })));
    await until('tâche transmise au widget', async () => (await widgets('state')).data.tasks[0].items.some((i) => i.id === 'ci-task'), 60_000, 2000);
    // Chaque widget construit et affiché comme par l'écran d'accueil (vue interdite, ressource manquante : échec).
    const views = await widgets('check');
    const expect = { tasks: ['Tâches', 'Tâche Ostal CI'], shortcuts: ['Nouvelle page', 'Agenda', 'Atelier PDF'], wake: ['Allumer l’ordinateur', 'Réglez « Allumer un PC » sur l’accueil d’Ostal.'] };
    for (const [kind, texts] of Object.entries(expect)) {
      const missing = texts.filter((t) => !views[kind].includes(t));
      if (missing.length) throw new Error(`widget ${kind} : ${missing.join(', ')} absent (${JSON.stringify(views[kind])})`);
    }
    if (views.previews.some((p) => !p.length)) throw new Error(`aperçus vides : ${JSON.stringify(views.previews)}`);
    // Raccourcis du lanceur (appui long sur l'icône) : les premiers choisis.
    await until('raccourcis du lanceur', () => ['sc_newPage', 'sc_agenda', 'sc_pdf'].every((id) => adb('shell', 'dumpsys', 'shortcut').includes(id)), 30_000, 2000);
    await assertAlive('après l’affichage des widgets');
  });

  await step('Widgets : tâche cochée puis tâche ajoutée depuis le widget, enregistrées sur le serveur', async () => {
    await widgets('act', { action: 'done', list: listId, task: 'ci-task', done: true });
    if ((await widgets('state')).pending) throw new Error('action gardée en attente : serveur non joint');
    await until('tâche cochée sur le serveur', async () => (await serverTasks(listId)).some((i) => i.id === 'ci-task' && i.done), 30_000, 1000);
    await widgets('act', { action: 'add', list: listId, text: 'Ajoutée par le widget CI' });
    await until('tâche ajoutée sur le serveur', async () => (await serverTasks(listId)).some((i) => i.text === 'Ajoutée par le widget CI'), 30_000, 1000);
    // L'application ouverte reçoit les deux changements par le serveur.
    await until('tâches à jour dans l’application', async () => {
      const items = (await widgets('state')).data.tasks[0].items;
      return items.some((i) => i.id === 'ci-task' && i.done) && items.some((i) => i.text === 'Ajoutée par le widget CI');
    }, 60_000, 2000);
  });

  await step('Widgets : « + » ouvre la fenêtre « Nouvelle tâche », tâche tapée au clavier enregistrée', async () => {
    // Ouverte par l'application au premier plan (Android interdit à une application en arrière-plan d'ouvrir une
    // fenêtre ; le widget, touché, en a le droit).
    await widgets('act', { action: 'openAdd', list: listId });
    await until('fenêtre « Nouvelle tâche »', () => focused().includes('TaskAddActivity'), 30_000, 1000);
    await sleep(1500);
    adb('shell', 'input', 'text', 'Courses%sau%sclavier');
    await sleep(1000);
    adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER');
    await until('tâche du clavier sur le serveur', async () => (await serverTasks(listId)).some((i) => i.text === 'Courses au clavier'), 30_000, 1000);
    await until('fenêtre fermée', () => !focused().includes('TaskAddActivity'), 15_000, 1000);
    await assertAlive('après la fenêtre « Nouvelle tâche »');
  });

  await step('Widgets : « Allumer l’ordinateur » envoie le signal par le serveur', async () => {
    adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
    await editWorkspace((doc) => {
      const dash = doc.getMap('dashboard');
      const d = JSON.parse(dash.get('config') ?? 'null');
      if (!d) throw new Error('accueil non enregistré');
      d.widgets.push({ id: 'ci-pc', type: 'wol', title: 'PC du bureau', config: { mac: '02:00:5e:10:00:01' } });
      for (const items of Object.values(d.layouts ?? {})) items.push({ i: 'ci-pc', x: 0, y: 99, w: 2, h: 3 });
      dash.set('config', JSON.stringify(d));
    });
    await until('ordinateur transmis au widget', async () => (await widgets('state')).data.computers?.some((c) => c.id === 'ci-pc'), 60_000, 2000);
    const { status } = await widgets('act', { action: 'wake', computer: 'ci-pc' });
    if (!/^Signal envoyé à /.test(status)) throw new Error(`état affiché : « ${status} »`);
    const wake = (await widgets('check')).wake;
    if (!wake.includes('PC du bureau') || !wake.includes(status)) throw new Error(`widget : ${JSON.stringify(wake)}`);
  });

  await step('Raccourci « Nouvelle page » (lanceur, widget) : une page créée et ouverte', async () => {
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await sleep(2000);
    // Même intention que les raccourcis du lanceur et les boutons du widget Raccourcis.
    adb('shell', 'am', 'start', '-a', 'com.shinezeo.notes.OPEN', '-n', `${PKG}/.MainActivity`, '--es', 'com.shinezeo.notes.OPEN_URL', "'#/nouvelle-page'");
    await until('nouvelle page ouverte', () => js("/^#\\/p\\/[A-Za-z0-9_-]+$/.test(location.hash) && !!document.querySelector('.nb-editor .ProseMirror')"), 60_000, 2000);
    await assertAlive('après le raccourci « Nouvelle page »');
  });
  ok = true;
} catch (e) {
  report.push(`❌ ${current} : ${e.message}`);
  console.log(`❌ ${current} : ${e.message}`);
  if (!(e instanceof Closed)) diagnostics();
} finally {
  client?.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'rapport.txt'), `${report.join('\n')}\n`);
  fs.writeFileSync(path.join(OUT, 'console.txt'), `${consoleLog.join('\n')}\n`);
}
process.exit(ok ? 0 : 1);
