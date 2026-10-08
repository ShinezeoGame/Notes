// Ostal pour ordinateur (Windows) : une fenêtre qui affiche l'espace de cet ordinateur, servi par le serveur Ostal
// intégré (lancé en arrière-plan, joignable de cet ordinateur seulement), ou le serveur Ostal d'un proche ou le vôtre.
// Le pont `window.meloDesktop` (preload.cjs) permet à l'application de passer de l'un à l'autre, lui transmet les PDF
// ouverts avec Ostal et les mises à jour téléchargées.
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, session, shell, utilityProcess } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Port du serveur intégré : toujours le même, car l'adresse de la page décide où sont rangées les données. */
const PORT = 47821;
const LOCAL = `http://127.0.0.1:${PORT}`;
/** Fonctions offertes par le pont (voir client/src/lib/desktop.ts) : augmenter à chaque ajout. */
const BRIDGE_API = 5;
/** Taille maximale d'un PDF ouvert avec Ostal. */
const MAX_OPEN_BYTES = 200 * 1024 * 1024;
const ICON = path.join(__dirname, 'build', 'icon.png');

app.setAppUserModelId('com.shinezeo.melo');
// Tests : dossier de données à part.
if (process.env.MELO_USER_DATA) app.setPath('userData', process.env.MELO_USER_DATA);
else {
  // L'application s'appelait Melo jusqu'en octobre 2026 : ses données (espace de cet ordinateur, réglages) restent
  // dans %APPDATA%\Melo plutôt que d'apparaître perdues dans %APPDATA%\Ostal.
  const legacy = path.join(app.getPath('appData'), 'Melo');
  if (fs.existsSync(legacy)) app.setPath('userData', legacy);
}
const USER_DATA = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DATA, 'melo-ordinateur.json');
const LOG_FILE = path.join(USER_DATA, 'melo.log');

/** Journal de l'application (%APPDATA%\Ostal\melo.log, ou %APPDATA%\Melo\melo.log), pour comprendre un problème après coup. */
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`;
  console.log(line);
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) fs.truncateSync(LOG_FILE, 0);
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    /* journal indisponible */
  }
}

/**
 * { server: adresse du serveur distant affiché (null : espace de cet ordinateur), bounds, maximized, lang: langue
 * choisie dans Ostal ('en', 'fr' ; null : pas encore connue), power: extinction à distance ({ enabled, server, wsId,
 * key } : serveur et espace où attendre les ordres) }
 */
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
    return {
      server: typeof c.server === 'string' ? normalizeServer(c.server) : null,
      bounds: c.bounds ?? null,
      maximized: Boolean(c.maximized),
      lang: c.lang === 'en' || c.lang === 'fr' ? c.lang : null,
      power: cleanPower(c.power),
    };
  } catch {
    return { server: null, bounds: null, maximized: false, lang: null, power: cleanPower(null) };
  }
}

/** Réglage « Pouvoir éteindre cet ordinateur depuis Ostal » lu ou reçu de l'application. */
function cleanPower(p) {
  const c = p && typeof p === 'object' ? p : {};
  return {
    enabled: c.enabled === true,
    server: typeof c.server === 'string' ? normalizeServer(c.server) : null,
    wsId: typeof c.wsId === 'string' ? c.wsId.slice(0, 100) : '',
    key: typeof c.key === 'string' ? c.key.slice(0, 200) : '',
  };
}

/** Textes de l'application elle-même (menus, erreurs du serveur intégré), dans la langue choisie dans Ostal. */
const TEXTS = {
  en: {
    reload: 'Reload',
    devTools: 'Developer tools',
    quit: 'Quit Ostal',
    view: 'View',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetZoom: 'Actual size',
    fullScreen: 'Full screen',
    noAnswer: 'it does not respond',
    portUsed: (port) => `port ${port} is already used by another program`,
    stopped: (code) => `unexpected stop (code ${code})`,
    open: 'Open Ostal',
    trayTip: 'Ostal: this computer can be turned off from your phone',
    shutdown: 'Ostal: turning off requested from another device. To cancel: shutdown /a',
  },
  fr: {
    reload: 'Recharger',
    devTools: 'Outils de développement',
    quit: 'Quitter Ostal',
    view: 'Affichage',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    resetZoom: 'Taille réelle',
    fullScreen: 'Plein écran',
    noAnswer: 'il ne répond pas',
    portUsed: (port) => `le port ${port} est déjà utilisé par un autre programme`,
    stopped: (code) => `arrêt inattendu (code ${code})`,
    open: 'Ouvrir Ostal',
    trayTip: 'Ostal : cet ordinateur peut être éteint depuis le téléphone',
    shutdown: 'Ostal : extinction demandée depuis un autre appareil. Pour annuler : shutdown /a',
  },
};

/** Langue choisie dans Ostal (pont : setLanguage) ; avant qu'Ostal ne l'indique, celle de Windows. */
function uiLang() {
  return config.lang ?? (/^fr\b/i.test(app.getLocale()) ? 'fr' : 'en');
}

const text = () => TEXTS[uiLang()];

function saveConfig() {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Réglages de la fenêtre non enregistrés :', err);
  }
}

/** Adresse d'un serveur Ostal (http ou https, sans / final), sinon null. */
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
  const serverLog = fs.createWriteStream(logFile, { flags: 'a' });
  const child = utilityProcess.fork(path.join(__dirname, 'server', 'src', 'index.js'), [], {
    serviceName: 'Serveur Ostal',
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
      // Sauvegardes : dans Documents\Ostal\Sauvegardes, ou un autre dossier choisi dans l'application (OneDrive…) ;
      // l'ordinateur n'est pas forcément allumé la nuit, la sauvegarde du jour se fait à n'importe quelle heure.
      BACKUP_DIR: path.join(app.getPath('documents'), 'Ostal', 'Sauvegardes'),
      BACKUP_DIR_CHOICE: '1',
      BACKUP_ANYTIME: '1',
    },
  });
  child.stdout?.pipe(serverLog);
  child.stderr?.pipe(serverLog);
  const entry = { child, serverLog, ready: null, started: false };
  entry.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(text().noAnswer)), 30_000);
    child.on('message', (m) => {
      if (m?.type === 'ready') {
        clearTimeout(timer);
        entry.started = true;
        resolve();
      } else if (m?.type === 'error') {
        clearTimeout(timer);
        const err = new Error(m.code === 'EADDRINUSE' ? text().portUsed(PORT) : String(m.code));
        err.code = m.code;
        reject(err);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(text().stopped(code)));
      if (server !== entry) return;
      server = null;
      // Arrêt imprévu en cours d'utilisation : relancé (trois fois au plus), la page se reconnecte d'elle-même.
      if (entry.started && !quitting && !config.server && restarts++ < 3) setTimeout(() => void startServer().catch(() => {}), 1500);
    });
  });
  entry.ready.then(
    () => log('serveur intégré prêt'),
    (err) => log('serveur intégré :', err.message),
  );
  server = entry;
  log('démarrage du serveur intégré');
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
      // Dernières lignes du journal du serveur écrites avant de quitter.
      if (entry.serverLog.writableFinished) resolve();
      else {
        entry.serverLog.once('finish', resolve);
        setTimeout(resolve, 1000);
      }
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
    title: 'Ostal',
    backgroundColor: '#191919',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      // Widget « Site web » : un site du réseau local en http (Jellyfin, routeur…) s'affiche aussi quand Ostal vient
      // d'un serveur en https (le navigateur le bloquerait).
      allowRunningInsecureContent: true,
    },
  });
  if (config.maximized) win.maximize();
  // Lancé avec Windows pour l'extinction à distance : la fenêtre reste cachée (icône dans la zone de notification).
  win.once('ready-to-show', () => {
    if (!(START_HIDDEN && config.power.enabled)) win.show();
  });
  log('fenêtre créée');
  win.on('close', (e) => {
    config.maximized = win.isMaximized();
    if (!config.maximized && !win.isMinimized()) config.bounds = win.getBounds();
    saveConfig();
    // Extinction à distance active : Ostal reste ouvert dans la zone de notification (Quitter : menu de l'icône).
    if (config.power.enabled && !quitting && !sessionEnding) {
      e.preventDefault();
      win.hide();
    }
  });
  // Windows s'arrête ou la session se ferme (extinction demandée d'ici, entre autres) : la fenêtre ne retient rien.
  win.on('query-session-end', () => {
    sessionEnding = true;
  });
  win.on('session-end', () => {
    sessionEnding = true;
    app.quit();
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
    log('chargement impossible :', url, description);
    showProblem(config.server ? 'server' : 'local', description);
  });
  wc.on('did-finish-load', () => {
    log('page chargée :', wc.getURL());
    flushFiles();
  });
  wc.on('render-process-gone', (_e, details) => log('page arrêtée :', details.reason, String(details.exitCode)));
  win.on('unresponsive', () => log('la fenêtre ne répond plus'));
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F5') {
      e.preventDefault();
      wc.reload();
    }
  });
}

/**
 * Widget « Site web » et intégrations : les sites qui interdisent d'être affichés dans le cadre d'une autre page
 * (en-têtes X-Frame-Options et Content-Security-Policy frame-ancestors : Google, YouTube…) s'affichent quand même dans
 * la fenêtre d'Ostal. Seuls les cadres sont concernés, jamais les pages elles-mêmes.
 */
function allowAnyFrame() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'subFrame' || !details.responseHeaders) return callback({});
    const headers = {};
    for (const [name, values] of Object.entries(details.responseHeaders)) {
      const key = name.toLowerCase();
      if (key === 'x-frame-options') continue;
      headers[name] =
        key === 'content-security-policy'
          ? values.map((v) =>
              v
                .split(';')
                .filter((d) => !/^\s*frame-ancestors\b/i.test(d))
                .join(';'),
            )
          : values;
    }
    callback({ responseHeaders: headers });
  });
}

/** Liens : les pages d'Ostal restent dans l'application, le reste s'ouvre dans le navigateur. */
function secure(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    // Connexion à Google (agendas) : fenêtre de l'application, qui renvoie le résultat à Ostal.
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
  void win.loadFile(path.join(__dirname, 'offline.html'), { query: { kind, server: config.server ?? '', detail: String(detail ?? ''), lang: uiLang() } });
}

async function openLocal() {
  // Ostal rouvert aussitôt après sa fermeture : l'ancien serveur libère encore le port, quelques secondes d'attente.
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

// ---------- Fichiers ouverts avec Ostal ----------

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

/** Remet les fichiers en attente à l'application, une fois la page d'Ostal chargée. */
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

// ---------- Éteindre cet ordinateur depuis un autre appareil ----------
// Option de l'application (Réglages → Cet ordinateur) : Ostal démarre avec Windows, reste dans la zone de
// notification et attend les ordres du serveur (server/src/power.js) avec les adresses MAC de ses cartes réseau ;
// « éteindre » lance l'arrêt de Windows dans 30 secondes (annulable par shutdown /a).

const START_HIDDEN = process.argv.includes('--hidden');
let tray = null;
let agentRun = 0;
/** Requête longue en cours (abandonnée quand le réglage change). */
let agentAbort = null;
let sessionEnding = false;

/** Adresses MAC des cartes réseau de cet ordinateur (celle du réveil Wake-on-LAN en fait partie). */
function macAddresses() {
  return [
    ...new Set(
      Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
        .map((i) => i.mac.toLowerCase()),
    ),
  ];
}

function showWindow() {
  if (!win) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Démarrage avec Windows, icône de la zone de notification et attente des ordres, selon le réglage. */
function applyPower() {
  const p = config.power;
  if (app.isPackaged && process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: p.enabled, args: ['--hidden'] });
  if (p.enabled && !tray) {
    try {
      tray = new Tray(ICON);
      tray.setToolTip(text().trayTip);
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: text().open, click: showWindow },
          { type: 'separator' },
          { label: text().quit, click: () => app.quit() },
        ]),
      );
      tray.on('click', showWindow);
    } catch (err) {
      // Sans icône, la fenêtre se rouvre en relançant Ostal.
      log('icône de la zone de notification impossible :', err.message);
      tray = null;
    }
  } else if (!p.enabled && tray) {
    tray.destroy();
    tray = null;
  }
  const run = ++agentRun;
  agentAbort?.abort();
  agentAbort = null;
  if (p.enabled && p.server && p.wsId && p.key) void waitOrders(run);
}

/** Attend les ordres du serveur (requêtes longues), tant que le réglage n'a pas changé. */
async function waitOrders(run) {
  const p = config.power;
  log('extinction à distance : en attente des ordres de', p.server);
  while (run === agentRun && !quitting) {
    try {
      const query = new URLSearchParams({ macs: macAddresses().join(','), name: os.hostname() });
      agentAbort = new AbortController();
      const res = await fetch(`${p.server}/api/power/wait?${query}`, {
        headers: { 'x-ws-id': p.wsId, 'x-ws-key': p.key },
        signal: AbortSignal.any([agentAbort.signal, AbortSignal.timeout(45_000)]),
      });
      if (run !== agentRun) return;
      if (!res.ok) {
        log('extinction à distance : réponse', res.status);
        await delay(res.status === 401 || res.status === 403 ? 300_000 : 30_000);
        continue;
      }
      const order = await res.json();
      if (order?.action === 'off') powerOff();
    } catch (err) {
      if (run !== agentRun) return;
      log('extinction à distance : serveur injoignable,', err.message);
      await delay(15_000);
    }
  }
}

function powerOff() {
  log('extinction demandée depuis un autre appareil');
  if (process.platform !== 'win32') return;
  execFile('shutdown', ['/s', '/t', '30', '/c', text().shutdown], { windowsHide: true }, (err) => {
    if (err) log('extinction impossible :', err.message);
  });
}

/** Seules les pages d'Ostal (serveur intégré, serveur choisi, page d'erreur) utilisent le pont. */
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
  embedsAnySite: true,
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

// Niveau 4 : choix d'un dossier (sauvegardes).
ipcMain.handle('melo:choose-folder', async (e, title) => {
  if (!trusted(e)) return null;
  const r = await dialog.showOpenDialog(win, { title: String(title || ''), properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

// Niveau 5 : extinction de cet ordinateur depuis un autre appareil (réglage et serveur où attendre les ordres).
ipcMain.handle('melo:power', (e) => (trusted(e) ? { enabled: config.power.enabled, macs: macAddresses(), name: os.hostname() } : null));

ipcMain.handle('melo:set-power', (e, enabled, where) => {
  if (!trusted(e)) return null;
  const w = where && typeof where === 'object' ? where : {};
  const next = cleanPower({ enabled: enabled === true, server: w.server, wsId: w.wsId, key: w.key });
  const changed = JSON.stringify(next) !== JSON.stringify(config.power);
  config.power = next;
  if (changed) {
    saveConfig();
    log('extinction à distance :', next.enabled ? 'activée' : 'désactivée');
    applyPower();
  }
  return { enabled: next.enabled, macs: macAddresses(), name: os.hostname() };
});

ipcMain.on('melo:install-update', (e) => {
  if (trusted(e) && updater && updateReady) updater.quitAndInstall(true, true);
});

// Niveau 3 : langue de l'interface, indiquée par Ostal à chaque ouverture (menus, page d'erreur).
ipcMain.on('melo:lang', (e, lang) => {
  if (!trusted(e) || (lang !== 'en' && lang !== 'fr') || config.lang === lang) return;
  config.lang = lang;
  saveConfig();
  Menu.setApplicationMenu(buildMenu());
});

// ---------- Démarrage ----------

function buildMenu() {
  // Barre de menus cachée (touche Alt) : raccourcis de rechargement, de zoom et de plein écran.
  const tx = text();
  return Menu.buildFromTemplate([
    {
      label: 'Ostal',
      submenu: [
        { label: tx.reload, accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
        { role: 'toggleDevTools', label: tx.devTools },
        { type: 'separator' },
        { role: 'quit', label: tx.quit },
      ],
    },
    {
      label: tx.view,
      submenu: [
        { role: 'zoomIn', label: tx.zoomIn },
        { role: 'zoomOut', label: tx.zoomOut },
        { role: 'resetZoom', label: tx.resetZoom },
        { type: 'separator' },
        { role: 'togglefullscreen', label: tx.fullScreen },
      ],
    },
  ]);
}

log(`Ostal ${app.getVersion()} : lancement (${process.argv.slice(1).join(' ') || 'sans argument'})`);
if (!app.requestSingleInstanceLock()) {
  // Ostal est déjà ouvert : cette deuxième instance lui passe ses fichiers (voir « second-instance ») et s'arrête.
  log('déjà ouvert : fichiers transmis à la fenêtre existante');
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    log('deuxième lancement reçu');
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    openFiles(filesFromArgv(argv));
  });

  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'window') secure(contents);
  });

  app.whenReady().then(async () => {
    log('prêt ;', config.server ? `serveur ${config.server}` : 'espace de cet ordinateur');
    Menu.setApplicationMenu(buildMenu());
    allowAnyFrame();
    openFiles(filesFromArgv(process.argv));
    createWindow();
    applyPower();
    await openCurrent();
    setupUpdates();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    log('fermeture');
    // Ostal rouvert pendant sa fermeture : la nouvelle fenêtre s'ouvre (et attend que le port se libère).
    app.releaseSingleInstanceLock();
    if (!server) return;
    // Laisse au serveur intégré le temps d'enregistrer les documents.
    e.preventDefault();
    void stopServer().finally(() => {
      log('serveur intégré arrêté');
      app.quit();
    });
  });
}
