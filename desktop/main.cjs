// Melo pour ordinateur (Windows) : une fenêtre qui affiche l'espace de cet ordinateur, servi par le serveur Melo
// intégré (lancé en arrière-plan, joignable de cet ordinateur seulement), ou le serveur Melo d'un proche ou le vôtre.
// Le pont `window.meloDesktop` (preload.cjs) permet à l'application de passer de l'un à l'autre, lui transmet les PDF
// ouverts avec Melo et les mises à jour téléchargées.
const { app, BrowserWindow, Menu, ipcMain, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/** Port du serveur intégré : toujours le même, car l'adresse de la page décide où sont rangées les données. */
const PORT = 47821;
const LOCAL = `http://127.0.0.1:${PORT}`;
/** Fonctions offertes par le pont (voir client/src/lib/desktop.ts) : augmenter à chaque ajout. */
const BRIDGE_API = 1;
/** Taille maximale d'un PDF ouvert avec Melo. */
const MAX_OPEN_BYTES = 200 * 1024 * 1024;
const ICON = path.join(__dirname, 'build', 'icon.png');

app.setAppUserModelId('com.shinezeo.melo');
// Tests : dossier de données à part.
if (process.env.MELO_USER_DATA) app.setPath('userData', process.env.MELO_USER_DATA);
const USER_DATA = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DATA, 'melo-ordinateur.json');

/** { server: adresse du serveur distant affiché (null : espace de cet ordinateur), bounds, maximized } */
let config = readConfig();
let win = null;
/** Serveur intégré : { child, ready } pendant qu'il tourne. */
let server = null;
let quitting = false;
let restarts = 0;
let pendingFiles = [];
let updater = null;
let updateReady = null;

function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { server: typeof c.server === 'string' ? normalizeServer(c.server) : null, bounds: c.bounds ?? null, maximized: Boolean(c.maximized) };
  } catch {
    return { server: null, bounds: null, maximized: false };
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Réglages de la fenêtre non enregistrés :', err);
  }
}

/** Adresse d'un serveur Melo (http ou https, sans / final), sinon null. */
function normalizeServer(input) {
  try {
    const u = new URL(String(input));
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};
const appOrigin = () => originOf(config.server ?? LOCAL);

// ---------- Serveur intégré ----------

function startServer() {
  if (server) return server.ready;
  const dataDir = path.join(USER_DATA, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const logFile = path.join(USER_DATA, 'serveur.log');
  try {
    if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.truncateSync(logFile, 0);
  } catch {
    /* premier lancement */
  }
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const child = utilityProcess.fork(path.join(__dirname, 'server', 'src', 'index.js'), [], {
    serviceName: 'Serveur Melo',
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      PUBLIC_URL: LOCAL,
      // Joignable de cet ordinateur seulement : pas de limite d'espaces (« Réinitialiser cet appareil » en crée un neuf).
      MAX_WORKSPACES: '0',
    },
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const entry = { child, ready: null, started: false };
  entry.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('il ne répond pas')), 30_000);
    child.on('message', (m) => {
      if (m?.type === 'ready') {
        clearTimeout(timer);
        entry.started = true;
        resolve();
      } else if (m?.type === 'error') {
        clearTimeout(timer);
        const err = new Error(m.code === 'EADDRINUSE' ? `le port ${PORT} est déjà utilisé par un autre programme` : String(m.code));
        err.code = m.code;
        reject(err);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`arrêt inattendu (code ${code})`));
      if (server !== entry) return;
      server = null;
      // Arrêt imprévu en cours d'utilisation : relancé (trois fois au plus), la page se reconnecte d'elle-même.
      if (entry.started && !quitting && !config.server && restarts++ < 3) setTimeout(() => void startServer().catch(() => {}), 1500);
    });
  });
  entry.ready.catch(() => {});
  server = entry;
  return entry.ready;
}

/** Arrêt propre (documents enregistrés), forcé au bout de 5 secondes. */
function stopServer() {
  const entry = server;
  if (!entry) return Promise.resolve();
  server = null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      entry.child.kill();
      resolve();
    }, 5000);
    entry.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    entry.child.postMessage('shutdown');
  });
}

// ---------- Fenêtre ----------

function createWindow() {
  const b = config.bounds ?? {};
  win = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 820,
    x: b.x,
    y: b.y,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'Melo',
    backgroundColor: '#191919',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (config.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    config.maximized = win.isMaximized();
    if (!config.maximized && !win.isMinimized()) config.bounds = win.getBounds();
    saveConfig();
  });
  win.on('closed', () => {
    win = null;
  });

  // Liens et fenêtres surgissantes : voir secure(), appliqué à chaque fenêtre (« web-contents-created »).
  const wc = win.webContents;
  wc.session.setSpellCheckerLanguages(['fr', 'en-US']);
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // -3 : chargement interrompu par un autre (changement de serveur).
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return;
    showProblem(config.server ? 'server' : 'local', description);
  });
  wc.on('did-finish-load', flushFiles);
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F5') {
      e.preventDefault();
      wc.reload();
    }
  });
}

/** Liens : les pages de Melo restent dans l'application, le reste s'ouvre dans le navigateur. */
function secure(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    // Connexion à Google (agendas) : fenêtre de l'application, qui renvoie le résultat à Melo.
    if (/^https:\/\/accounts\.google\.com\//.test(url)) return { action: 'allow' };
    if (originOf(url) === appOrigin() || url.startsWith('blob:')) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON } };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (originOf(url) === appOrigin() || url.startsWith('file:') || /^https:\/\/accounts\.google\.com\//.test(url)) return;
    e.preventDefault();
    openExternal(url);
  });
}

function openExternal(url) {
  if (/^(https?|mailto|tel):/i.test(url)) void shell.openExternal(url);
}

function loadApp(url) {
  if (!win) return Promise.resolve();
  // Un échec est signalé par « did-fail-load » (page « serveur injoignable »).
  return win.loadURL(url).catch(() => {});
}

/** Page d'erreur : serveur distant injoignable, ou serveur intégré qui ne démarre pas. */
function showProblem(kind, detail) {
  if (!win) return;
  void win.loadFile(path.join(__dirname, 'offline.html'), { query: { kind, server: config.server ?? '', detail: String(detail ?? '') } });
}

async function openLocal() {
  // Melo rouvert aussitôt après sa fermeture : l'ancien serveur libère encore le port, quelques secondes d'attente.
  for (let attempt = 1; ; attempt++) {
    try {
      await startServer();
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' || attempt >= 10) {
        showProblem('local', err.message);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  await loadApp(`${LOCAL}/`);
}

/** Affiche l'espace choisi (serveur distant ou cet ordinateur), à une adresse précise (#/invite/…) si besoin. */
async function openCurrent(route = '') {
  if (config.server) {
    await stopServer();
    await loadApp(`${config.server}/${route}`);
  } else {
    await openLocal();
  }
}

// ---------- Fichiers ouverts avec Melo ----------

function filesFromArgv(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => /\.pdf$/i.test(a) && fs.existsSync(a));
}

function openFiles(paths) {
  for (const p of paths) {
    try {
      const { size } = fs.statSync(p);
      if (size > MAX_OPEN_BYTES) continue;
      pendingFiles.push({ name: path.basename(p), type: 'application/pdf', data: new Uint8Array(fs.readFileSync(p)) });
    } catch (err) {
      console.error('Fichier illisible :', p, err);
    }
  }
  flushFiles();
}

/** Remet les fichiers en attente à l'application, une fois la page de Melo chargée. */
function flushFiles() {
  if (!win || !pendingFiles.length || win.webContents.isLoading()) return;
  if (originOf(win.webContents.getURL()) !== appOrigin()) return;
  win.webContents.send('melo:open-files', pendingFiles);
  pendingFiles = [];
}

// ---------- Mises à jour de l'application ----------
// Nouvelle version publiée dans la release « latest » du dépôt GitHub (lisible seulement si le dépôt est public) :
// téléchargée en arrière-plan, installée à la fermeture ou tout de suite depuis le bandeau de l'application.

function setupUpdates() {
  if (!app.isPackaged || process.env.MELO_NO_UPDATES) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let latest = '';
  autoUpdater.on('update-available', (i) => {
    latest = i.version;
  });
  autoUpdater.on('download-progress', (p) => send('melo:update', { status: 'downloading', version: latest, progress: p.percent / 100 }));
  autoUpdater.on('update-downloaded', (i) => {
    updateReady = i.version;
    send('melo:update', { status: 'ready', version: i.version });
  });
  // Hors ligne, ou dépôt privé : nouvel essai plus tard, sans message.
  autoUpdater.on('error', () => {});
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 20_000);
  setInterval(check, 6 * 3600_000);
  updater = autoUpdater;
}

function send(channel, payload) {
  if (win && !win.webContents.isLoading()) win.webContents.send(channel, payload);
}

// ---------- Pont avec l'application (preload.cjs) ----------

/** Seules les pages de Melo (serveur intégré, serveur choisi, page d'erreur) utilisent le pont. */
function trusted(e) {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith('file:') || [originOf(LOCAL), config.server ? originOf(config.server) : ''].includes(originOf(url));
}

const info = () => ({
  version: app.getVersion(),
  api: BRIDGE_API,
  mode: config.server ? 'server' : 'local',
  localUrl: LOCAL,
  serverUrl: config.server,
  update: updateReady ? { status: 'ready', version: updateReady } : null,
});

ipcMain.on('melo:info', (e) => {
  e.returnValue = trusted(e) ? info() : null;
});

ipcMain.handle('melo:use-server', async (e, url, route) => {
  if (!trusted(e)) return;
  const server = normalizeServer(url);
  if (!server) throw new Error('Adresse de serveur invalide.');
  config.server = server;
  saveConfig();
  await openCurrent(/^#\/[A-Za-z0-9/_-]*$/.test(String(route)) ? String(route) : '');
});

ipcMain.handle('melo:use-local', async (e) => {
  if (!trusted(e)) return;
  config.server = null;
  saveConfig();
  await openLocal();
});

ipcMain.handle('melo:retry', async (e) => {
  if (trusted(e)) await openCurrent();
});

ipcMain.on('melo:install-update', (e) => {
  if (trusted(e) && updater && updateReady) updater.quitAndInstall(true, true);
});

// ---------- Démarrage ----------

function buildMenu() {
  // Barre de menus cachée (touche Alt) : raccourcis de rechargement, de zoom et de plein écran.
  return Menu.buildFromTemplate([
    {
      label: 'Melo',
      submenu: [
        { label: 'Recharger', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
        { role: 'toggleDevTools', label: 'Outils de développement' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter Melo' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'zoomIn', label: 'Zoom avant' },
        { role: 'zoomOut', label: 'Zoom arrière' },
        { role: 'resetZoom', label: 'Taille réelle' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
      ],
    },
  ]);
}

if (!app.requestSingleInstanceLock()) {
  // Melo est déjà ouvert : cette deuxième instance lui passe ses fichiers (voir « second-instance ») et s'arrête.
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    openFiles(filesFromArgv(argv));
  });

  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'window') secure(contents);
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu());
    openFiles(filesFromArgv(process.argv));
    createWindow();
    await openCurrent();
    setupUpdates();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    // Melo rouvert pendant sa fermeture : la nouvelle fenêtre s'ouvre (et attend que le port se libère).
    app.releaseSingleInstanceLock();
    if (!server) return;
    // Laisse au serveur intégré le temps d'enregistrer les documents.
    e.preventDefault();
    void stopServer().finally(() => app.quit());
  });
}
