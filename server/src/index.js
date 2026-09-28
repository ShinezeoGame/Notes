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
  createShare,
  deleteShare,
  getShare,
  isValidId,
  listShares,
  registrationClosed,
  safeUploadName,
  uploadDirFor,
  workspaceExists,
} from './store.js';
import { authorizeRoom, createPageInWorkspace, flushAll, getDoc, pageInShare, setupWSConnection, shareTree, wsRoom } from './ws.js';
import { checkDevice, checkService, homelabStatus, parseConfig } from './homelab.js';

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
        ? 'Ce serveur n’accepte pas de nouvel espace de travail. Utilisez le lien « Lier un appareil » copié depuis les réglages d’un appareil déjà connecté.'
        : 'Cette clé ne correspond pas à cet espace de travail.',
    });
  }
  res.json({ ok: true, wsId });
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

app.get('/api/homelab/status', requireOwner, async (req, res) => {
  try {
    const config = await readHomelabConfig(req.wsId);
    const data = await homelabStatus(req.wsId, config, { force: req.query.force === '1' });
    res.json(data);
  } catch (err) {
    console.error('[homelab]', err);
    res.status(500).json({ error: 'Impossible d’interroger le homelab.' });
  }
});

app.post('/api/homelab/test', requireOwner, async (req, res) => {
  const { service, device } = req.body || {};
  try {
    if (service && typeof service === 'object') return res.json(await checkService({ id: 'test', ...service }));
    if (device && typeof device === 'object') return res.json(await checkDevice({ id: 'test', ...device }));
    res.status(400).json({ error: 'Rien à tester.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Test impossible.' });
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
    const r = await fetch(parsed, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'Notes/1.0' } });
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
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: 'index.html', maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.type('text').send('Serveur Notes actif. Le client n’est pas construit (npm run build).'));
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
  wss.handleUpgrade(req, socket, head, async (ws) => {
    try {
      const auth = await authorizeRoom(room, { key, share });
      if (!auth.ok) {
        ws.close(4401, auth.reason);
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

server.listen(PORT, HOST, () => {
  console.log(`Notes : serveur démarré sur http://${HOST}:${PORT}`);
});

async function shutdown() {
  console.log('Arrêt : sauvegarde des documents…');
  await flushAll();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
