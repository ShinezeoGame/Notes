// Test de l'application Windows installée (lancé par .github/workflows/apps.yml, après l'installation silencieuse) :
// premier lancement (serveur intégré, écran de bienvenue), accueil, PDF ouvert avec Melo (deuxième lancement),
// fermeture puis réouverture, arrêt propre. Captures d'écran, rapport et journaux dans smoke-out/.
// Melo est lancé comme par un utilisateur, sans débogueur au démarrage : le test ne s'y connecte (protocole de
// débogage de Chromium) qu'une fois la page de l'application chargée.
// Usage : node check.mjs <chemin de Melo.exe>
import { chromium } from 'playwright-core';
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const EXE = process.argv[2];
const OUT = path.resolve(process.env.SMOKE_OUT || 'smoke-out');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-'));
/** Petit PDF d'une page. */
const TINY_PDF = 'JVBERi0xLjcKJYGBgYEKCjEgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgNSAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iagoKNSAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDEgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0hlbHZldGljYS03MDk4NDgwNzg5IDQgMCBSCj4+Ci9YT2JqZWN0IDw8Cj4+Ci9FeHRHU3RhdGUgPDwKPj4KPj4KL01lZGlhQm94IFsgMCAwIDMwMCAyMDAgXQovQW5ub3RzIFsgXQovQ29udGVudHMgWyA2IDAgUiBdCj4+CmVuZG9iagoKNiAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDEwOQo+PgpzdHJlYW0KeJwdyjsKAlEMRuH+X0VqQUxibnIviIUwYmEjZAMioyhaKDLrnwen+zhfHBJMc78HNqf+PfT/5+26Dm7VKkdtpEx5hxrlGbKsMpvw5B/sinrxbRTlYJdQZRPv3EL96M1tT/lCrtAlLhgBnekYZAplbmRzdHJlYW0KZW5kb2JqCgo3IDAgb2JqCjw8Ci9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9UeXBlIC9PYmpTdG0KL04gMgovRmlyc3QgMTAKL0xlbmd0aCAyMjQKPj4Kc3RyZWFtCnic1VFNi8IwEL3nV8xx9zRjGtPtUgqubdnLwsIuCN5qGyQgidQo+O+dKQpe9O7hMZn33nyRDAgMmLmBslT4O8bh2LsRyrZpW6KciKxhWCJdc1wyCobmnDX9wW9Gzp4JzOUZUbZgjesFlkmpEX3yzq/1DUf2WvFwb/Ea6Xc/V2aJjwnRn+5TVAp/4lB3ycFb/alJWyp0MTNkya7fFS5H16X4usdN+/sYHl5YVUp+8f+8d4BtDEnh33GTplTImcKv7uBEAfx2u5NLvu8UNqGPgw9bwJUPi3DwN0I6XgBwin6QCmVuZHN0cmVhbQplbmRvYmoKCjggMCBvYmoKPDwKL1NpemUgOQovUm9vdCAyIDAgUgovSW5mbyAzIDAgUgovRmlsdGVyIC9GbGF0ZURlY29kZQovVHlwZSAvWFJlZgovTGVuZ3RoIDQ0Ci9XIFsgMSAyIDIgXQovSW5kZXggWyAwIDkgXQo+PgpzdHJlYW0KeJxjYGD4/5+RQYCBgZHBh4GBiYEdQjAyMtQBxRgdQcR3IMFsy8AAAHYmBGwKZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjgyOQolJUVPRg==';
const LOCAL = 'http://127.0.0.1:47821';
const env = { ...process.env, MELO_USER_DATA: DATA, MELO_NO_UPDATES: '1' };
// Linux (essais locaux en administrateur) : Chromium exige alors --no-sandbox.
const EXTRA = process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [];
fs.mkdirSync(OUT, { recursive: true });

const report = [];
/** Melo en cours : { proc, exited, output, browser } ; win : sa page. */
let app;
let win;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Processus Melo encore présents (Windows : tous ceux de l'exécutable, y compris les processus enfants). */
function meloProcesses() {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${path.basename(EXE)}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return out.split(/\r?\n/).filter((l) => l.startsWith('"'));
  } catch {
    return [];
  }
}

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '(absent)';
  }
};

/** Lignes du journal de Melo (melo.log). */
const logLines = () => {
  try {
    return fs.readFileSync(path.join(DATA, 'melo.log'), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

/**
 * Lance Melo comme un utilisateur, attend que la page de l'application soit chargée (melo.log), puis s'y connecte
 * par le protocole de débogage de Chromium (port choisi par Melo, annoncé sur sa sortie d'erreur).
 */
async function launch() {
  const before = logLines().length;
  const proc = spawn(EXE, [...EXTRA, '--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  app = { proc, exited, output, browser: null };
  const endpoint = new Promise((resolve) => {
    for (const stream of [proc.stdout, proc.stderr]) {
      readline.createInterface({ input: stream }).on('line', (line) => {
        output.push(line);
        if (output.length > 200) output.shift();
        const m = line.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]);
      });
    }
  });
  const loaded = () => logLines().slice(before).some((line) => line.includes(`page chargée : ${LOCAL}/`));
  const running = () => proc.exitCode === null && proc.signalCode === null;
  const t = Date.now();
  while (!loaded() && running() && Date.now() - t < 90_000) await sleep(250);
  if (!running()) throw new Error(`Melo s’est arrêté au démarrage (code ${proc.exitCode ?? proc.signalCode})`);
  const ws = await Promise.race([endpoint, sleep(10_000).then(() => null)]);
  if (!ws) throw new Error('Melo n’annonce pas son port de débogage');
  if (!loaded()) {
    // Fenêtres, pages et service workers vus par Chromium (liste simple : rien ne s'y attache).
    const targets = await fetch(`http://${new URL(ws).host}/json/list`)
      .then((r) => r.json())
      .then((list) => list.map((t) => `${t.type} ${t.url}`))
      .catch((e) => e.message);
    throw new Error(`page de l’application non chargée au bout de 90 s ; cibles : ${JSON.stringify(targets)}`);
  }
  app.browser = await chromium.connectOverCDP(ws, { timeout: 30_000 });
  const pages = app.browser.contexts().flatMap((c) => c.pages());
  win = pages.find((p) => p.url().startsWith(`${LOCAL}/`));
  if (!win) throw new Error(`page de l’application introuvable : ${pages.map((p) => p.url()).join(', ')}`);
  report.push(`   page chargée en ${Date.now() - t} ms`);
  console.log(report.at(-1));
}

/** Ferme la fenêtre comme un utilisateur (bouton ✕), puis attend la fin de Melo et de ses processus. */
async function closeLikeUser() {
  const { proc, exited, browser } = app;
  await win.evaluate(() => window.close()).catch(() => {});
  await Promise.race([exited, sleep(20_000)]);
  if (proc.exitCode === null && proc.signalCode === null) throw new Error('Melo ne s’est pas fermé après la fermeture de sa fenêtre');
  await browser.close().catch(() => {});
  app = null;
  win = null;
  const t = Date.now();
  let left = meloProcesses();
  while (left.length && Date.now() - t < 20_000) {
    await sleep(250);
    left = meloProcesses();
  }
  report.push(`   fermé ; processus restants après ${Date.now() - t} ms : ${left.length}`);
  console.log(report.at(-1));
}
async function step(name, fn) {
  await fn();
  report.push(`✅ ${name}`);
  console.log(`✅ ${name}`);
}

let ok = false;
try {
  await step('Lancement : serveur intégré démarré, écran « Welcome to Melo » (anglais par défaut)', async () => {
    await launch();
    await win.getByText('Welcome to Melo').waitFor({ timeout: 90_000 });
    const info = await win.evaluate(() => ({ mode: window.meloDesktop?.mode, version: window.meloDesktop?.version, url: location.href }));
    if (info.mode !== 'local' || !info.url.startsWith(`${LOCAL}/`)) throw new Error(JSON.stringify(info));
    const health = await (await fetch(`${LOCAL}/api/health`)).json();
    if (!health.ok) throw new Error('le serveur intégré ne répond pas');
    report.push(`   application ${info.version}`);
    await win.screenshot({ path: path.join(OUT, '1-bienvenue.png') });
  });

  await step('Choix de la langue : « Français » relance Melo en français', async () => {
    await win.locator('.nb-onboarding-lang button[lang="fr"]').click();
    await win.getByText('Bienvenue dans Melo').waitFor({ timeout: 60_000 });
    const lang = await win.evaluate(() => document.documentElement.lang);
    if (lang !== 'fr') throw new Error(`langue de la page : ${lang}`);
  });

  await step('« Commencer » : présentation, puis l’accueil et ses widgets', async () => {
    await win.getByRole('button', { name: /Commencer/ }).click();
    await win.locator('.nb-modal', { hasText: 'Bienvenue !' }).waitFor({ timeout: 30_000 });
    await win.screenshot({ path: path.join(OUT, '2-premier-lancement.png') });
    await win.getByRole('button', { name: 'Passer la visite' }).click();
    await win.locator('.dash-grid .dash-widget').first().waitFor({ timeout: 30_000 });
    await win.screenshot({ path: path.join(OUT, '3-accueil.png') });
  });

  await step('PDF ouvert avec Melo (deuxième lancement) : importé dans l’atelier PDF', async () => {
    const pdf = path.join(DATA, 'Recu Windows.pdf');
    fs.writeFileSync(pdf, Buffer.from(TINY_PDF, 'base64'));
    // Deuxième instance : elle passe le fichier à la fenêtre ouverte, puis se ferme.
    await new Promise((resolve) => execFile(EXE, [...EXTRA, pdf], { env, timeout: 60_000 }, () => resolve()));
    // Import terminé : l'éditeur du nouveau PDF s'ouvre (#/pdf/<identifiant>).
    await win.waitForFunction(() => /^#\/pdf\/[A-Za-z0-9_-]+/.test(location.hash), null, { timeout: 90_000 });
    await win.screenshot({ path: path.join(OUT, '4-pdf.png') });
  });

  await step('Fermeture (bouton ✕) puis réouverture : accueil sans écran de bienvenue, PDF toujours là', async () => {
    // Service worker de l'application installé, comme après quelques secondes d'utilisation : la réouverture passe
    // alors par lui (ouverture sans réseau).
    const sw = await Promise.race([win.evaluate(() => navigator.serviceWorker.ready.then(() => true)), sleep(30_000).then(() => false)]);
    report.push(`   service worker installé : ${sw ? 'oui' : 'non'}`);
    await closeLikeUser();
    await launch();
    await win.locator('.nb-rail').waitFor({ timeout: 90_000 });
    const controlled = await win.evaluate(() => Boolean(navigator.serviceWorker?.controller));
    report.push(`   réouverture servie par le service worker : ${controlled ? 'oui' : 'non'}`);
    if (await win.getByText(/Bienvenue dans Melo|Welcome to Melo/).count()) throw new Error('écran de bienvenue réaffiché');
    if ((await win.evaluate(() => document.documentElement.lang)) !== 'fr') throw new Error('langue choisie perdue');
    await win.evaluate(() => {
      location.hash = '#/pdf';
    });
    await win.locator('.pdf-card-name', { hasText: 'Recu Windows' }).waitFor({ timeout: 60_000 });
    await win.screenshot({ path: path.join(OUT, '5-reouverture.png') });
  });

  await step('Fermeture : serveur intégré arrêté proprement, documents enregistrés', async () => {
    await closeLikeUser();
    const log = fs.readFileSync(path.join(DATA, 'serveur.log'), 'utf8');
    if (!log.includes('Documents enregistrés')) throw new Error(`arrêt non signalé :\n${log.slice(-800)}`);
  });
  ok = true;
} catch (err) {
  console.error('❌', err);
  report.push(`❌ ${String(err?.message ?? err).slice(0, 500)}`);
  await win?.screenshot({ path: path.join(OUT, 'echec.png'), timeout: 10_000 }).catch(() => {});
  // Diagnostic dans le journal du workflow (les artefacts ne sont pas toujours lisibles).
  if (win) {
    const state = await Promise.race([
      win.evaluate(() => ({ url: location.href, readyState: document.readyState, sw: Boolean(navigator.serviceWorker?.controller) })),
      sleep(5000).then(() => 'page sans réponse'),
    ]).catch((e) => e.message);
    console.log('--- page :\n' + JSON.stringify(state));
  }
  if (app) console.log('--- sortie de Melo :\n' + app.output.join('\n'));
  console.log('--- processus Melo :\n' + (meloProcesses().join('\n') || '(aucun)'));
  console.log('--- melo.log :\n' + readText(path.join(DATA, 'melo.log')));
  console.log('--- serveur.log :\n' + readText(path.join(DATA, 'serveur.log')));
} finally {
  // Melo encore ouvert (échec) : arrêté, pour que la désinstallation puisse suivre.
  await app?.browser?.close().catch(() => {});
  if (app && app.proc.exitCode === null && app.proc.signalCode === null) {
    app.proc.kill();
    await Promise.race([app.exited, sleep(10_000)]);
  }
  for (const name of ['serveur.log', 'melo.log']) {
    try {
      fs.copyFileSync(path.join(DATA, name), path.join(OUT, name));
    } catch {
      /* jamais lancé */
    }
  }
  fs.writeFileSync(path.join(OUT, 'rapport.txt'), `${report.join('\n')}\n`);
}
process.exit(ok ? 0 : 1);
