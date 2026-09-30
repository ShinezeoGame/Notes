// Test de l'application Windows installée (lancé par .github/workflows/apps.yml, après l'installation silencieuse) :
// premier lancement (serveur intégré, écran de bienvenue), accueil, PDF ouvert avec Melo (deuxième lancement),
// fermeture propre. Captures d'écran, rapport et journal du serveur dans smoke-out/.
// Usage : node check.mjs <chemin de Melo.exe>
import { _electron as electron } from 'playwright-core';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXE = process.argv[2];
const OUT = path.resolve(process.env.SMOKE_OUT || 'smoke-out');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-'));
/** Petit PDF d'une page. */
const TINY_PDF = 'JVBERi0xLjcKJYGBgYEKCjEgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgNSAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iagoKNSAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDEgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0hlbHZldGljYS03MDk4NDgwNzg5IDQgMCBSCj4+Ci9YT2JqZWN0IDw8Cj4+Ci9FeHRHU3RhdGUgPDwKPj4KPj4KL01lZGlhQm94IFsgMCAwIDMwMCAyMDAgXQovQW5ub3RzIFsgXQovQ29udGVudHMgWyA2IDAgUiBdCj4+CmVuZG9iagoKNiAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDEwOQo+PgpzdHJlYW0KeJwdyjsKAlEMRuH+X0VqQUxibnIviIUwYmEjZAMioyhaKDLrnwen+zhfHBJMc78HNqf+PfT/5+26Dm7VKkdtpEx5hxrlGbKsMpvw5B/sinrxbRTlYJdQZRPv3EL96M1tT/lCrtAlLhgBnekYZAplbmRzdHJlYW0KZW5kb2JqCgo3IDAgb2JqCjw8Ci9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9UeXBlIC9PYmpTdG0KL04gMgovRmlyc3QgMTAKL0xlbmd0aCAyMjQKPj4Kc3RyZWFtCnic1VFNi8IwEL3nV8xx9zRjGtPtUgqubdnLwsIuCN5qGyQgidQo+O+dKQpe9O7hMZn33nyRDAgMmLmBslT4O8bh2LsRyrZpW6KciKxhWCJdc1wyCobmnDX9wW9Gzp4JzOUZUbZgjesFlkmpEX3yzq/1DUf2WvFwb/Ea6Xc/V2aJjwnRn+5TVAp/4lB3ycFb/alJWyp0MTNkya7fFS5H16X4usdN+/sYHl5YVUp+8f+8d4BtDEnh33GTplTImcKv7uBEAfx2u5NLvu8UNqGPgw9bwJUPi3DwN0I6XgBwin6QCmVuZHN0cmVhbQplbmRvYmoKCjggMCBvYmoKPDwKL1NpemUgOQovUm9vdCAyIDAgUgovSW5mbyAzIDAgUgovRmlsdGVyIC9GbGF0ZURlY29kZQovVHlwZSAvWFJlZgovTGVuZ3RoIDQ0Ci9XIFsgMSAyIDIgXQovSW5kZXggWyAwIDkgXQo+PgpzdHJlYW0KeJxjYGD4/5+RQYCBgZHBh4GBiYEdQjAyMtQBxRgdQcR3IMFsy8AAAHYmBGwKZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjgyOQolJUVPRg==';
const env = { ...process.env, MELO_USER_DATA: DATA, MELO_NO_UPDATES: '1' };
fs.mkdirSync(OUT, { recursive: true });

const report = [];
let app;
let win;

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

/** Ferme la fenêtre comme un utilisateur (bouton ✕), puis attend la fin de Melo et de ses processus. */
async function closeLikeUser() {
  const proc = app.process();
  const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((resolve) => proc.once('exit', resolve));
  await win.close().catch(() => {});
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 20_000))]);
  if (proc.exitCode === null) throw new Error('Melo ne s’est pas fermé après la fermeture de sa fenêtre');
  app = null;
  const t = Date.now();
  let left = meloProcesses();
  while (left.length && Date.now() - t < 20_000) {
    await new Promise((resolve) => setTimeout(resolve, 250));
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
  await step('Lancement : serveur intégré démarré, écran « Bienvenue dans Melo »', async () => {
    app = await electron.launch({ executablePath: EXE, args: [], env, timeout: 90_000 });
    win = await app.firstWindow();
    await win.getByText('Bienvenue dans Melo').waitFor({ timeout: 90_000 });
    const info = await win.evaluate(() => ({ mode: window.meloDesktop?.mode, version: window.meloDesktop?.version, url: location.href }));
    if (info.mode !== 'local' || !info.url.startsWith('http://127.0.0.1:47821/')) throw new Error(JSON.stringify(info));
    const health = await (await fetch('http://127.0.0.1:47821/api/health')).json();
    if (!health.ok) throw new Error('le serveur intégré ne répond pas');
    report.push(`   application ${info.version}`);
    await win.screenshot({ path: path.join(OUT, '1-bienvenue.png') });
  });

  await step('« Commencer » : présentation, puis l’accueil et ses widgets', async () => {
    await win.getByRole('button', { name: /Commencer/ }).click();
    await win.locator('.nb-modal', { hasText: 'Bienvenue !' }).waitFor({ timeout: 30_000 });
    await win.screenshot({ path: path.join(OUT, '2-premier-lancement.png') });
    await win.getByRole('button', { name: 'Plus tard' }).click();
    await win.locator('.dash-grid .dash-widget').first().waitFor({ timeout: 30_000 });
    await win.screenshot({ path: path.join(OUT, '3-accueil.png') });
  });

  await step('PDF ouvert avec Melo (deuxième lancement) : importé dans l’atelier PDF', async () => {
    const pdf = path.join(DATA, 'Recu Windows.pdf');
    fs.writeFileSync(pdf, Buffer.from(TINY_PDF, 'base64'));
    // Deuxième instance : elle passe le fichier à la fenêtre ouverte, puis se ferme.
    // (Linux, essais locaux en administrateur : Chromium exige alors --no-sandbox.)
    const extra = process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [];
    await new Promise((resolve) => execFile(EXE, [...extra, pdf], { env, timeout: 60_000 }, () => resolve()));
    // Import terminé : l'éditeur du nouveau PDF s'ouvre (#/pdf/<identifiant>).
    await win.waitForFunction(() => /^#\/pdf\/[A-Za-z0-9_-]+/.test(location.hash), null, { timeout: 90_000 });
    await win.screenshot({ path: path.join(OUT, '4-pdf.png') });
  });

  await step('Fermeture (bouton ✕) puis réouverture : accueil sans écran de bienvenue, PDF toujours là', async () => {
    await closeLikeUser();
    app = await electron.launch({ executablePath: EXE, args: [], env, timeout: 90_000 });
    win = await app.firstWindow();
    await win.locator('.nb-rail').waitFor({ timeout: 90_000 });
    if (await win.getByText('Bienvenue dans Melo').count()) throw new Error('écran de bienvenue réaffiché');
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
  await win?.screenshot({ path: path.join(OUT, 'echec.png') }).catch(() => {});
  // Diagnostic dans le journal du workflow (les artefacts ne sont pas toujours lisibles).
  console.log('--- processus Melo :\n' + (meloProcesses().join('\n') || '(aucun)'));
  console.log('--- melo.log :\n' + readText(path.join(DATA, 'melo.log')));
  console.log('--- serveur.log :\n' + readText(path.join(DATA, 'serveur.log')));
} finally {
  await app?.close().catch(() => {});
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
