// Pilote l'application installée sur l'émulateur par le débogage de sa WebView (APK debug) et vérifie chaque
// étape sensible côté Android : liaison à un serveur, vérification en arrière-plan, notification, mise à jour.
// Lancé par run.sh (serveur Notes du runner joignable depuis l'émulateur en 10.0.2.2:3000).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const PKG = 'com.shinezeo.notes';
const JOB_ID = '4202';
const SERVER = 'http://10.0.2.2:3000';
const OUT = process.env.SMOKE_OUT || 'smoke-out';
const DIST_V2 = process.env.DIST_V2;
const DEVTOOLS_PORT = 9222;

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

async function assertAlive(when) {
  const crash = crashLog();
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
    if (!(await alivePid())) {
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
    await until('écran « Bienvenue dans Notes »', () => js("document.body?.innerText.includes('Bienvenue dans Notes')"), 120_000, 2000);
    await sleep(6000);
    await assertAlive('au premier lancement');
  });

  await step('Liaison au serveur : l’application reste ouverte et affiche les pages', async () => {
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
    await until('éditeur affiché', () => js("!!document.querySelector('.nb-editor .ProseMirror')"), 120_000, 2000);
    // Démarrage natif (1,5 s après le chargement) : vérification programmée, autorisations, nettoyage…
    await sleep(15_000);
    await assertAlive('après la liaison au serveur');
  });

  await step('Vérification des mises à jour programmée en arrière-plan', async () => {
    await until('tâche programmée', () => adb('shell', 'dumpsys', 'jobscheduler', PKG).includes(`${PKG}/.UpdateCheckJob`), 30_000, 2000);
  });

  let v2 = '';
  await step('Nouvelle version sur le serveur : notification « Mise à jour de Notes disponible »', async () => {
    fs.rmSync('client/dist', { recursive: true, force: true });
    fs.cpSync(DIST_V2, 'client/dist', { recursive: true });
    v2 = JSON.parse(fs.readFileSync('client/dist/version.json', 'utf8')).version;
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await sleep(3000);
    adb('shell', 'cmd', 'jobscheduler', 'run', '-f', PKG, JOB_ID);
    await until(
      'notification affichée',
      () => adb('shell', 'dumpsys', 'notification', '--noredact').includes('Mise à jour de Notes disponible'),
      60_000,
      2000,
    );
    await assertAlive('pendant la vérification en arrière-plan');
  });

  await step('Toucher la notification : mise à jour téléchargée puis installée, sans nouvel APK', async () => {
    // Même intention que la notification (application déjà ouverte : onNewIntent).
    adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`, '--ez', 'com.shinezeo.notes.UPDATE', 'true');
    await until(`version ${v2} chargée`, async () => (await loadedVersion()) === v2, 180_000, 2000);
    // La nouvelle version confirme son démarrage (message « Notes a été mis à jour »).
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
