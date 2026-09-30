// Point d'entrée du serveur : API REST (partage, upload, proxy iCal), fichiers statiques
// du client et synchronisation temps réel via WebSocket.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import {
  UPLOADS_DIR,
  authorizeWorkspace,
  claimInvite,
  cleanName,
  createInvite,
  createShare,
  deleteInvite,
  deleteShare,
  getShare,
  inviteInfo,
  isGuest,
  isValidId,
  listGuests,
  listInvites,
  listShares,
  registrationClosed,
  removeAllUploads,
  removeGuest,
  removeUploads,
  safeUploadName,
  uploadDirFor,
  uploadNameIn,
  workspaceExists,
} from './store.js';
import {
  authorizeRoom,
  createPageInWorkspace,
  deleteDoc,
  deleteWorkspaceDocs,
  flushAll,
  getDoc,
  isPageRoom,
  MIN_PAGE_SCHEMA,
  pageInShare,
  pdfRoom,
  setupWSConnection,
  shareTree,
  wsRoom,
} from './ws.js';
import { checkDevice, checkService, homelabStatus, parseConfig } from './homelab.js';
import { createAppUpdates } from './appUpdates.js';
import { claimPairing, startPairing } from './pairing.js';
import { callHome, cameraUrl, homeStates, isHomeConfigured, parseHomeConfig, proxyCamera, testHome, verifyCamera } from './smarthome.js';
import {
  cameraKind,
  cameraLink,
  hasFfmpeg,
  openVideo,
  parseCamera,
  parseCamerasConfig,
  stopCameras,
  streamImage,
  testCamera,
  verifyCameraLink,
} from './cameras.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 200;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

const publicBase = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

// ---------- Authentification ----------

function ownerAuth(req) {
  const wsId = req.get('x-ws-id') || req.body?.wsId || req.query.wsId;
  const key = req.get('x-ws-key') || req.body?.key || req.query.key;
  if (isValidId(wsId) && typeof key === 'string' && authorizeWorkspace(wsId, key)) return wsId;
  return null;
}

function requireOwner(req, res, next) {
  const wsId = ownerAuth(req);
  if (!wsId) return res.status(403).json({ error: 'Identifiants d’espace de travail invalides.' });
  req.wsId = wsId;
  next();
}

/**
 * Après requireOwner : réservé aux espaces du propriétaire du serveur. Un espace créé par une invitation (une autre
 * personne) n'accède pas au réseau du serveur (maison, caméras, homelab) et n'invite personne à son tour.
 */
function requireHost(req, res, next) {
  if (isGuest(req.wsId)) return res.status(403).json({ error: 'Réservé au propriétaire de ce serveur Melo.' });
  next();
}

/** Limite d'essais par adresse (codes, invitations) : `max` par minute. */
function rateLimiter(max) {
  const attempts = new Map(); // adresse IP -> { count, resetAt }
  return (req) => {
    const now = Date.now();
    for (const [ip, a] of attempts) if (a.resetAt <= now) attempts.delete(ip);
    const ip = req.ip || 'inconnue';
    const a = attempts.get(ip) ?? { count: 0, resetAt: now + 60_000 };
    a.count++;
    attempts.set(ip, a);
    return a.count <= max;
  };
}

/** Propriétaire, ou invité disposant d'un lien en mode modification. */
async function requireEditor(req, res, next) {
  const wsId = ownerAuth(req);
  if (wsId) {
    req.wsId = wsId;
    return next();
  }
  const token = req.get('x-share-token') || req.query.share;
  const share = token ? getShare(String(token)) : null;
  if (share && share.mode === 'edit' && (await pageInShare(share, share.pageId))) {
    req.wsId = share.wsId;
    req.share = share;
    return next();
  }
  return res.status(403).json({ error: 'Accès refusé.' });
}

// ---------- API ----------

app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

app.post('/api/workspaces/claim', (req, res) => {
  const { wsId, key } = req.body || {};
  if (!isValidId(wsId) || typeof key !== 'string') return res.status(400).json({ error: 'Requête invalide.' });
  if (!authorizeWorkspace(wsId, key)) {
    const closed = !workspaceExists(wsId) && registrationClosed();
    return res.status(403).json({
      error: closed
        ? 'Ce serveur n’accepte pas de nouvel espace. Pour retrouver vos pages, reliez cet appareil avec le code affiché dans les réglages d’un appareil déjà relié ; pour avoir votre propre espace, demandez une invitation au propriétaire du serveur.'
        : 'Cette clé ne correspond pas à cet espace de travail.',
    });
  }
  res.json({ ok: true, wsId, guest: isGuest(wsId) });
});

// ---------- Invitations (voir store.js) ----------

const inviteJson = (req, inv) => ({ token: inv.token, name: inv.name, createdAt: inv.createdAt, expiresAt: inv.expiresAt, url: `${publicBase(req)}/#/invite/${inv.token}` });

app.post('/api/invites', requireOwner, requireHost, (req, res) => {
  const inv = createInvite(req.wsId, req.body?.name);
  if (!inv) return res.status(429).json({ error: 'Trop d’invitations en attente : annulez-en une avant d’en créer une nouvelle.' });
  res.json(inviteJson(req, inv));
});

app.get('/api/invites', requireOwner, requireHost, (req, res) => {
  res.json({ invites: listInvites(req.wsId).map((i) => inviteJson(req, i)), guests: listGuests(req.wsId) });
});

app.delete('/api/invites/:token', requireOwner, requireHost, (req, res) => {
  if (!deleteInvite(req.wsId, req.params.token)) return res.status(404).json({ error: 'Invitation introuvable.' });
  res.json({ ok: true });
});

// Retirer une personne invitée : son accès, ses pages et ses fichiers sont supprimés du serveur.
app.delete('/api/guests/:wsId', requireOwner, requireHost, async (req, res) => {
  const wsId = req.params.wsId;
  if (!isValidId(wsId) || !removeGuest(req.wsId, wsId)) return res.status(404).json({ error: 'Personne introuvable.' });
  try {
    await deleteWorkspaceDocs(wsId);
    await removeAllUploads(wsId);
  } catch (err) {
    console.error('[invitations] suppression incomplète de', wsId, err);
  }
  res.json({ ok: true });
});

app.get('/api/invite/:token', (req, res) => {
  const info = inviteInfo(req.params.token);
  if (!info) return res.status(404).json({ error: 'Cette invitation n’est plus valable : elle a déjà servi, a été annulée ou a expiré. Demandez-en une nouvelle.' });
  res.json(info);
});

const inviteAttempts = rateLimiter(10);
app.post('/api/invite/:token/claim', (req, res) => {
  if (!inviteAttempts(req)) return res.status(429).json({ error: 'Trop d’essais : patientez une minute avant de réessayer.' });
  const { wsId, key, name } = req.body || {};
  const { status, body } = claimInvite(req.params.token, wsId, key, cleanName(name));
  res.status(status).json(body);
});

// Liaison d'un nouvel appareil par code à 6 chiffres (voir pairing.js).
app.post('/api/pair/start', requireOwner, (req, res) => {
  res.json(startPairing(req.wsId, req.get('x-ws-key') || req.body?.key));
});

app.post('/api/pair/claim', (req, res) => {
  const { status, body } = claimPairing(req.body?.code, req.ip || 'inconnue');
  res.status(status).json(body);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, uploadDirFor(req.wsId)),
    filename: (_req, file, cb) => cb(null, safeUploadName(file.originalname)),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

app.post('/api/upload', requireEditor, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `Fichier trop volumineux (max ${MAX_UPLOAD_MB} Mo).` : 'Téléversement impossible.',
      });
    }
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    res.json({
      url: `${publicBase(req)}/uploads/${req.wsId}/${req.file.filename}`,
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype,
    });
  });
});

app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    maxAge: '365d',
    immutable: true,
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  }),
);

// Atelier PDF : suppression définitive d'un PDF (son document) et des fichiers qu'il était seul à utiliser
// (le client, qui connaît les autres PDF de la bibliothèque, fournit cette liste).
app.post('/api/pdf/delete', requireOwner, async (req, res) => {
  const { id, files } = req.body || {};
  if (!isValidId(id)) return res.status(400).json({ error: 'PDF invalide.' });
  try {
    await deleteDoc(pdfRoom(req.wsId, id));
    const names = (Array.isArray(files) ? files : []).map((f) => uploadNameIn(req.wsId, f)).filter(Boolean);
    res.json({ ok: true, removed: await removeUploads(req.wsId, names) });
  } catch (err) {
    console.error('[pdf] suppression impossible:', err);
    res.status(500).json({ error: 'Suppression impossible.' });
  }
});

app.post('/api/shares', requireOwner, (req, res) => {
  const { pageId, mode } = req.body || {};
  if (!isValidId(pageId)) return res.status(400).json({ error: 'Page invalide.' });
  const share = createShare(req.wsId, pageId, mode);
  res.json({ ...share, url: `${publicBase(req)}/#/s/${share.token}` });
});

app.get('/api/shares', requireOwner, (req, res) => {
  const pageId = typeof req.query.pageId === 'string' ? req.query.pageId : undefined;
  res.json(listShares(req.wsId, pageId).map((s) => ({ ...s, url: `${publicBase(req)}/#/s/${s.token}` })));
});

app.delete('/api/shares/:token', requireOwner, (req, res) => {
  const share = getShare(req.params.token);
  if (!share || share.wsId !== req.wsId) return res.status(404).json({ error: 'Lien introuvable.' });
  deleteShare(share.token);
  res.json({ ok: true });
});

app.get('/api/share/:token', async (req, res) => {
  const share = getShare(req.params.token);
  if (!share) return res.status(404).json({ error: 'Ce lien de partage n’existe pas ou a été révoqué.' });
  const pages = await shareTree(share);
  if (!pages) return res.status(404).json({ error: 'La page partagée n’est plus disponible.' });
  res.json({ token: share.token, wsId: share.wsId, pageId: share.pageId, mode: share.mode, pages });
});

// Création d'une sous-page par un invité disposant d'un lien en mode modification.
app.post('/api/share/:token/pages', async (req, res) => {
  const share = getShare(req.params.token);
  if (!share || share.mode !== 'edit') return res.status(403).json({ error: 'Ce lien ne permet pas de créer des pages.' });
  const { parentId, title } = req.body || {};
  if (!isValidId(parentId) || !(await pageInShare(share, parentId))) {
    return res.status(403).json({ error: 'Page parente hors du partage.' });
  }
  const id = createPageInWorkspace(share.wsId, parentId, typeof title === 'string' ? title.slice(0, 200) : '');
  res.json({ id });
});

// ---------- Tableau de bord homelab ----------
// La configuration (applications, appareils, secrets) vit dans le document Yjs de l'espace ;
// le serveur interroge les services et renvoie uniquement les résultats.
async function readHomelabConfig(wsId) {
  const doc = getDoc(wsRoom(wsId));
  await doc.whenLoaded;
  return parseConfig(doc.getMap('homelab').get('config') || '');
}

app.get('/api/homelab/status', requireOwner, requireHost, async (req, res) => {
  try {
    const config = await readHomelabConfig(req.wsId);
    const data = await homelabStatus(req.wsId, config, { force: req.query.force === '1' });
    res.json(data);
  } catch (err) {
    console.error('[homelab]', err);
    res.status(500).json({ error: 'Impossible d’interroger le homelab.' });
  }
});

app.post('/api/homelab/test', requireOwner, requireHost, async (req, res) => {
  const { service, device } = req.body || {};
  try {
    if (service && typeof service === 'object') return res.json(await checkService({ id: 'test', ...service }));
    if (device && typeof device === 'object') return res.json(await checkDevice({ id: 'test', ...device }));
    res.status(400).json({ error: 'Rien à tester.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Test impossible.' });
  }
});

// ---------- Maison connectée (Home Assistant) ----------
// Adresse et jeton de Home Assistant vivent dans le document Yjs de l'espace ; le serveur relaie états et commandes.
async function readHomeConfig(wsId) {
  const doc = getDoc(wsRoom(wsId));
  await doc.whenLoaded;
  return parseHomeConfig(doc.getMap('smarthome').get('config') || '');
}

app.get('/api/home/states', requireOwner, requireHost, async (req, res) => {
  const cfg = await readHomeConfig(req.wsId);
  if (!isHomeConfigured(cfg)) return res.json({ configured: false, entities: [], fetchedAt: Date.now() });
  try {
    const entities = await homeStates(cfg);
    for (const e of entities) {
      if (e.domain !== 'camera') continue;
      e.snapshot = cameraUrl(req.wsId, e.id, 'snapshot');
      e.stream = cameraUrl(req.wsId, e.id, 'stream');
    }
    res.json({ configured: true, entities, fetchedAt: Date.now() });
  } catch (err) {
    res.json({ configured: true, entities: [], error: err.message, fetchedAt: Date.now() });
  }
});

app.post('/api/home/call', requireOwner, requireHost, async (req, res) => {
  const cfg = await readHomeConfig(req.wsId);
  if (!isHomeConfigured(cfg)) return res.status(400).json({ error: 'Home Assistant n’est pas configuré.' });
  try {
    res.json({ entities: await callHome(cfg, req.body || {}) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || 'Commande impossible.' });
  }
});

app.post('/api/home/test', requireOwner, requireHost, async (req, res) => {
  res.json(await testHome(parseHomeConfig(req.body || {})));
});

// Images et vidéos des caméras : adresses signées (balise <img>, sans en-têtes d'authentification).
app.get('/api/home/camera/:entityId/:kind', async (req, res) => {
  const { entityId, kind } = req.params;
  const ws = String(req.query.ws || '');
  if (!['snapshot', 'stream'].includes(kind) || !/^camera\.[a-z0-9_]+$/.test(entityId) || !isValidId(ws) || !verifyCamera(ws, entityId, req.query.exp, req.query.sig)) {
    return res.status(403).json({ error: 'Adresse de caméra expirée ou invalide.' });
  }
  const cfg = await readHomeConfig(ws);
  if (!isHomeConfigured(cfg)) return res.status(404).json({ error: 'Home Assistant n’est pas configuré.' });
  proxyCamera(cfg, entityId, kind, res);
});

// ---------- Caméras de surveillance (reliées directement, sans Home Assistant) ----------
// La liste des caméras (adresses, identifiants) vit dans le document Yjs de l'espace ; le serveur s'y connecte et ne
// renvoie aux navigateurs que la vidéo, par des adresses signées.
async function readCamerasConfig(wsId) {
  const doc = getDoc(wsRoom(wsId));
  await doc.whenLoaded;
  return parseCamerasConfig(doc.getMap('cameras').get('config') || '');
}

app.get('/api/cameras', requireOwner, requireHost, async (req, res) => {
  const cameras = await readCamerasConfig(req.wsId);
  res.json({
    ffmpeg: await hasFfmpeg(),
    cameras: cameras.map((c) => ({ id: c.id, name: c.name, kind: cameraKind(c), live: cameraLink(req.wsId, c.id) })),
  });
});

app.post('/api/cameras/test', requireOwner, requireHost, async (req, res) => {
  res.json(await testCamera(parseCamera(req.body?.camera)));
});

// Direct d'une caméra : ?q=hd (flux principal) ou sd ; ?accept=avc,hevc,vp9 : formats que l'appareil sait lire.
app.get('/api/cameras/:id/live', async (req, res) => {
  const ws = String(req.query.ws || '');
  const id = req.params.id;
  if (!isValidId(ws) || !verifyCameraLink(ws, id, req.query.exp, req.query.sig)) {
    return res.status(403).json({ error: 'Adresse de caméra expirée ou invalide.' });
  }
  const cam = (await readCamerasConfig(ws)).find((c) => c.id === id);
  if (!cam) return res.status(404).json({ error: 'Cette caméra n’existe plus.' });
  if (cameraKind(cam) === 'image') return streamImage(cam, res);
  const accept = String(req.query.accept || 'avc')
    .split(',')
    .filter((f) => ['avc', 'hevc', 'vp9'].includes(f));
  try {
    const hub = await openVideo(cam, req.query.q === 'hd' ? 'hd' : 'sd', accept);
    hub.addViewer(res);
  } catch (err) {
    if (!res.headersSent) res.status(err.status || 502).json({ error: err.message || 'Vidéo indisponible.' });
  }
});

// Récupération d'un flux iCal (Google Agenda "adresse secrète") côté serveur pour éviter CORS.
const BLOCKED_HOST_RE = /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local$)/i;
app.post('/api/ics/fetch', requireEditor, async (req, res) => {
  const { url } = req.body || {};
  let parsed;
  try {
    parsed = new URL(String(url).replace(/^webcal:\/\//i, 'https://'));
  } catch {
    return res.status(400).json({ error: 'URL invalide.' });
  }
  if (!/^https?:$/.test(parsed.protocol) || BLOCKED_HOST_RE.test(parsed.hostname)) {
    return res.status(400).json({ error: 'URL non autorisée.' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const r = await fetch(parsed, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'Melo/1.0' } });
    if (!r.ok) return res.status(502).json({ error: `Le serveur distant a répondu ${r.status}.` });
    const len = Number(r.headers.get('content-length') || 0);
    if (len > 10 * 1024 * 1024) return res.status(413).json({ error: 'Flux trop volumineux.' });
    const text = await r.text();
    if (text.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Flux trop volumineux.' });
    if (!/BEGIN:VCALENDAR/i.test(text)) return res.status(400).json({ error: 'Ce lien ne renvoie pas un calendrier iCal.' });
    res.json({ text });
  } catch (err) {
    res.status(502).json({ error: err.name === 'AbortError' ? 'Délai dépassé.' : 'Impossible de récupérer ce calendrier.' });
  } finally {
    clearTimeout(timer);
  }
});

// ---------- Client (build Vite) ----------

const clientDist = path.resolve(__dirname, '../../client/dist');

// Mises à jour de l'application (navigateurs ouverts et application Android).
const appUpdates = createAppUpdates(clientDist);
app.get('/api/app/version', (_req, res) => {
  const v = appUpdates.readVersion();
  res.set('Cache-Control', 'no-store');
  if (!v) return res.status(404).json({ error: 'Client non construit.' });
  res.json(v);
});
app.get('/api/app/manifest', (_req, res) => {
  const m = appUpdates.manifest();
  res.set('Cache-Control', 'no-store');
  if (!m) return res.status(404).json({ error: 'Client non construit.' });
  res.json(m);
});

if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(
    express.static(clientDist, {
      index: 'index.html',
      // Fichiers nommés d'après leur contenu : cache permanent ; le reste (index.html…) est revalidé à chaque visite.
      setHeaders(res, filePath) {
        const immutable = path.relative(clientDist, filePath).startsWith(`assets${path.sep}`);
        res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/ws')) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.type('text').send('Serveur Melo actif. Le client n’est pas construit (npm run build).'));
}

app.use((req, res) => res.status(404).json({ error: 'Introuvable.' }));

// ---------- WebSocket ----------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/ws/')) {
    socket.destroy();
    return;
  }
  const room = decodeURIComponent(url.pathname.slice('/ws/'.length));
  const key = url.searchParams.get('key') || undefined;
  const share = url.searchParams.get('share') || undefined;
  const schema = Number(url.searchParams.get('schema')) || 1;
  wss.handleUpgrade(req, socket, head, async (ws) => {
    try {
      const auth = await authorizeRoom(room, { key, share });
      if (!auth.ok) {
        ws.close(4401, auth.reason);
        return;
      }
      // Client trop ancien pour les pages (voir MIN_PAGE_SCHEMA) : 4426, il cesse de se reconnecter.
      if (isPageRoom(room) && schema < MIN_PAGE_SCHEMA) {
        ws.close(4426, 'update-required');
        return;
      }
      await setupWSConnection(ws, room, { readOnly: auth.readOnly });
    } catch (err) {
      console.error('[ws] erreur de connexion:', err);
      try {
        ws.close(1011, 'error');
      } catch {
        /* ignore */
      }
    }
  });
});

// `process.parentPort` : serveur lancé par l'application Melo pour ordinateur (desktop/main.cjs), prévenue quand il
// est prêt et qui demande son arrêt ; absent quand le serveur tourne seul.
server.on('error', (err) => {
  console.error(`Melo : démarrage impossible (${err.code === 'EADDRINUSE' ? `port ${PORT} déjà utilisé` : err.message}).`);
  process.parentPort?.postMessage({ type: 'error', code: err.code || 'ERROR' });
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Melo : serveur démarré sur http://${HOST}:${PORT}`);
  process.parentPort?.postMessage({ type: 'ready' });
});

async function shutdown() {
  console.log('Arrêt : sauvegarde des documents…');
  stopCameras();
  await flushAll();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.parentPort?.on('message', (e) => e.data === 'shutdown' && void shutdown());
