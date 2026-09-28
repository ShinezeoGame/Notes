// Persistance simple sur disque : documents Yjs, clés d'espaces de travail, liens de partage.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
export const DOCS_DIR = path.join(DATA_DIR, 'docs');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const WS_FILE = path.join(DATA_DIR, 'workspaces.json');
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');

for (const dir of [DATA_DIR, DOCS_DIR, UPLOADS_DIR]) fs.mkdirSync(dir, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** wsId -> { keyHash, createdAt } */
const workspaces = readJson(WS_FILE, {});
/** token -> { wsId, pageId, mode: 'edit' | 'view', createdAt } */
const shares = readJson(SHARES_FILE, {});

const ID_RE = /^[A-Za-z0-9_-]{6,80}$/;
export const isValidId = (s) => typeof s === 'string' && ID_RE.test(s);

export function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Autorise (et enregistre à la première utilisation) un espace de travail.
 * Le premier client qui présente une clé pour un identifiant inconnu en devient propriétaire.
 */
export function authorizeWorkspace(wsId, key) {
  if (!isValidId(wsId) || typeof key !== 'string' || key.length < 16 || key.length > 200) return false;
  const h = hashKey(key);
  const existing = workspaces[wsId];
  if (!existing) {
    workspaces[wsId] = { keyHash: h, createdAt: Date.now() };
    writeJsonAtomic(WS_FILE, workspaces);
    return true;
  }
  return safeEqual(existing.keyHash, h);
}

export function workspaceExists(wsId) {
  return Boolean(workspaces[wsId]);
}

// ---------- Partage ----------

export function createShare(wsId, pageId, mode) {
  const token = crypto.randomBytes(18).toString('base64url');
  shares[token] = { wsId, pageId, mode: mode === 'edit' ? 'edit' : 'view', createdAt: Date.now() };
  writeJsonAtomic(SHARES_FILE, shares);
  return { token, ...shares[token] };
}

export function getShare(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const s = shares[token];
  return s ? { token, ...s } : null;
}

export function deleteShare(token) {
  if (!shares[token]) return false;
  delete shares[token];
  writeJsonAtomic(SHARES_FILE, shares);
  return true;
}

export function listShares(wsId, pageId) {
  return Object.entries(shares)
    .filter(([, s]) => s.wsId === wsId && (!pageId || s.pageId === pageId))
    .map(([token, s]) => ({ token, ...s }));
}

// ---------- Documents Yjs ----------

export function docFile(room) {
  return path.join(DOCS_DIR, `${encodeURIComponent(room)}.bin`);
}

export async function loadDocUpdate(room) {
  try {
    const buf = await fsp.readFile(docFile(room));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveDocUpdate(room, update) {
  const file = docFile(room);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, update);
  await fsp.rename(tmp, file);
}

// ---------- Uploads ----------

const SAFE_EXT = /^[a-z0-9]{1,8}$/i;

export function uploadDirFor(wsId) {
  const dir = path.join(UPLOADS_DIR, wsId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function safeUploadName(originalName) {
  const ext = path.extname(originalName || '').slice(1).toLowerCase();
  const suffix = SAFE_EXT.test(ext) ? `.${ext}` : '';
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${suffix}`;
}
