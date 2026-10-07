// Persistance simple sur disque : documents Yjs, clés d'espaces de travail, liens de partage, invitations.
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
const INVITES_FILE = path.join(DATA_DIR, 'invites.json');
const SIGNING_FILE = path.join(DATA_DIR, 'signing.key');

for (const dir of [DATA_DIR, DOCS_DIR, UPLOADS_DIR]) fs.mkdirSync(dir, { recursive: true });

/**
 * Clé des adresses signées (caméras), gardée sur disque : les adresses déjà données restent valables quand le serveur
 * redémarre (mise à jour automatique), au lieu d'être refusées jusqu'à leur renouvellement.
 */
const signingMaster = (() => {
  try {
    const key = fs.readFileSync(SIGNING_FILE);
    if (key.length >= 32) return key;
  } catch {
    /* première fois */
  }
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(SIGNING_FILE, key, { mode: 0o600 });
  } catch {
    /* dossier en lecture seule : clé valable jusqu'au prochain démarrage */
  }
  return key;
})();

/** Clé de signature propre à un usage (dérivée de la clé gardée sur disque). */
export function signingKey(purpose) {
  return crypto.createHmac('sha256', signingMaster).update(purpose).digest();
}

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

/**
 * wsId -> { keyHash, createdAt, guest?, invitedBy?, name? }
 * `guest` : espace créé par une invitation (une autre personne) : sans accès au réseau du serveur (maison, caméras,
 * homelab) et sans pouvoir inviter à son tour.
 */
const workspaces = readJson(WS_FILE, {});
/** token -> { wsId, pageId, mode: 'edit' | 'view', createdAt } */
const shares = readJson(SHARES_FILE, {});
/** token -> { from, name, createdAt, expiresAt } : invitations en attente (supprimées une fois utilisées). */
const invites = readJson(INVITES_FILE, {});

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
 * Nombre maximal d'espaces de travail sur ce serveur (0 = illimité), sans compter ceux créés par une invitation.
 * Sur un serveur exposé à Internet, 1 empêche tout inconnu de créer son propre espace
 * (et donc d'utiliser l'upload ou le tableau de bord homelab) : les autres personnes passent par une invitation
 * ou par les liens de partage.
 */
const MAX_WORKSPACES = Math.max(0, Number(process.env.MAX_WORKSPACES) || 0);

export function registrationClosed() {
  return MAX_WORKSPACES > 0 && Object.values(workspaces).filter((w) => !w.guest).length >= MAX_WORKSPACES;
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
    if (registrationClosed()) return false;
    workspaces[wsId] = { keyHash: h, createdAt: Date.now() };
    writeJsonAtomic(WS_FILE, workspaces);
    return true;
  }
  // altKeyHashes : clés d'appareils qui ont rejoint cet espace en restaurant une sauvegarde (voir adoptWorkspace).
  return safeEqual(existing.keyHash, h) || (existing.altKeyHashes ?? []).some((a) => safeEqual(a, h));
}

/** Espace du propriétaire du serveur : le plus ancien qui ne vient pas d'une invitation. */
function hostWorkspace() {
  return Object.entries(workspaces)
    .filter(([, w]) => !w.guest)
    .sort((a, b) => a[1].createdAt - b[1].createdAt)[0]?.[0] ?? null;
}

/**
 * Gestion du serveur entier (sauvegardes, restauration) : propriétaire du serveur. Sur un serveur à un seul espace,
 * ou joignable de cette machine seulement (application pour ordinateur), tout espace qui n'est pas invité.
 */
export function canManageServer(wsId) {
  const w = workspaces[wsId];
  if (!w || w.guest) return false;
  if (MAX_WORKSPACES === 1 || /^(127\.0\.0\.1|::1|localhost)$/.test(process.env.HOST || '')) return true;
  return hostWorkspace() === wsId;
}

/**
 * Après une restauration : l'appareil qui l'a faite garde l'accès. Si son espace n'est pas dans la sauvegarde (serveur
 * réinstallé), sa clé ouvre désormais l'espace du propriétaire restauré. Renvoie l'espace à utiliser.
 */
export function adoptWorkspace(wsId, key) {
  if (workspaces[wsId]) return wsId;
  const host = hostWorkspace();
  if (!host || typeof key !== 'string' || key.length < 16) return null;
  const w = workspaces[host];
  const h = hashKey(key);
  w.altKeyHashes = [...new Set([...(w.altKeyHashes ?? []), h])].slice(-20);
  writeJsonAtomic(WS_FILE, workspaces);
  return host;
}

/** Relit espaces, liens de partage et invitations (après une restauration). */
export function reloadStore() {
  for (const [target, file] of [
    [workspaces, WS_FILE],
    [shares, SHARES_FILE],
    [invites, INVITES_FILE],
  ]) {
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, readJson(file, {}));
  }
}

export function workspaceExists(wsId) {
  return Boolean(workspaces[wsId]);
}

/** Espace créé par une invitation. */
export function isGuest(wsId) {
  return Boolean(workspaces[wsId]?.guest);
}

// ---------- Invitations ----------
// Le propriétaire du serveur crée un lien d'invitation (valable 7 jours, utilisable une fois) ; la personne invitée
// obtient son propre espace, privé, sur ce serveur, même quand MAX_WORKSPACES empêche d'en créer librement.

const INVITE_TTL = 7 * 24 * 3600_000;
const MAX_PENDING_INVITES = 20;
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** Prénom ou nom affiché : sans caractères de contrôle, 40 caractères au plus. */
export function cleanName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 40);
}

function pruneInvites(now = Date.now()) {
  let changed = false;
  for (const [token, inv] of Object.entries(invites)) {
    if (inv.expiresAt > now && workspaces[inv.from] && !workspaces[inv.from].guest) continue;
    delete invites[token];
    changed = true;
  }
  if (changed) writeJsonAtomic(INVITES_FILE, invites);
}

/** Nouvelle invitation de l'espace `from` ; null s'il y en a déjà trop en attente. */
export function createInvite(from, name) {
  pruneInvites();
  if (Object.values(invites).filter((i) => i.from === from).length >= MAX_PENDING_INVITES) return null;
  const token = crypto.randomBytes(18).toString('base64url');
  const now = Date.now();
  invites[token] = { from, name: cleanName(name), createdAt: now, expiresAt: now + INVITE_TTL };
  writeJsonAtomic(INVITES_FILE, invites);
  return { token, ...invites[token] };
}

export function listInvites(from) {
  pruneInvites();
  return Object.entries(invites)
    .filter(([, i]) => i.from === from)
    .map(([token, i]) => ({ token, ...i }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteInvite(from, token) {
  if (invites[token]?.from !== from) return false;
  delete invites[token];
  writeJsonAtomic(INVITES_FILE, invites);
  return true;
}

/** Invitation encore valable (pour la page d'accueil de la personne invitée), sinon null. */
export function inviteInfo(token) {
  if (typeof token !== 'string' || !INVITE_TOKEN_RE.test(token)) return null;
  pruneInvites();
  const inv = invites[token];
  return inv ? { name: inv.name, expiresAt: inv.expiresAt } : null;
}

/**
 * Utilise une invitation : enregistre l'espace `wsId` (clé `key`) de la personne invitée.
 * Renvoie { status, body } pour la réponse HTTP.
 */
export function claimInvite(token, wsId, key, name) {
  const info = inviteInfo(token);
  if (!info) return { status: 404, body: { error: 'Cette invitation n’est plus valable : elle a déjà servi, a été annulée ou a expiré. Demandez-en une nouvelle.' } };
  if (!isValidId(wsId) || typeof key !== 'string' || key.length < 16 || key.length > 200) {
    return { status: 400, body: { error: 'Requête invalide.' } };
  }
  const existing = workspaces[wsId];
  if (existing) {
    // Déjà enregistré (double clic, nouvelle tentative) : rien à faire si la clé est la bonne.
    if (safeEqual(existing.keyHash, hashKey(key))) return { status: 200, body: { ok: true, wsId, guest: Boolean(existing.guest), created: false } };
    return { status: 409, body: { error: 'Cet espace existe déjà sur ce serveur.' } };
  }
  const inv = invites[token];
  workspaces[wsId] = { keyHash: hashKey(key), createdAt: Date.now(), guest: true, invitedBy: inv.from, name: cleanName(name) };
  writeJsonAtomic(WS_FILE, workspaces);
  delete invites[token];
  writeJsonAtomic(INVITES_FILE, invites);
  return { status: 200, body: { ok: true, wsId, guest: true, created: true } };
}

/** Personnes invitées par l'espace `owner`. */
export function listGuests(owner) {
  return Object.entries(workspaces)
    .filter(([, w]) => w.guest && w.invitedBy === owner)
    .map(([wsId, w]) => ({ wsId, name: w.name || '', createdAt: w.createdAt }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Retire l'espace d'une personne invitée par `owner` (accès et liens de partage) ; faux s'il n'en fait pas partie. */
export function removeGuest(owner, wsId) {
  const w = workspaces[wsId];
  if (!w?.guest || w.invitedBy !== owner) return false;
  delete workspaces[wsId];
  writeJsonAtomic(WS_FILE, workspaces);
  let sharesChanged = false;
  for (const [token, sh] of Object.entries(shares)) {
    if (sh.wsId !== wsId) continue;
    delete shares[token];
    sharesChanged = true;
  }
  if (sharesChanged) writeJsonAtomic(SHARES_FILE, shares);
  return true;
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

export async function removeDocFile(room) {
  try {
    await fsp.unlink(docFile(room));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
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

const UPLOAD_NAME_RE = /^[a-z0-9]{1,16}-[a-f0-9]{16}(\.[a-z0-9]{1,8})?$/;

/**
 * Nom d'un fichier téléversé dans l'espace `wsId`, à partir de son adresse (…/uploads/<espace>/<nom>)
 * ou de son chemin (uploads/<espace>/<nom>) ; null pour un fichier d'un autre espace ou un nom inattendu.
 */
export function uploadNameIn(wsId, ref) {
  const m = /(?:^|\/)uploads\/([A-Za-z0-9_-]{6,80})\/([^/?#]+)$/.exec(String(ref || ''));
  if (!m || m[1] !== wsId || !UPLOAD_NAME_RE.test(m[2])) return null;
  return m[2];
}

/** Supprime tous les fichiers téléversés d'un espace. */
export async function removeAllUploads(wsId) {
  if (!isValidId(wsId)) return;
  await fsp.rm(path.join(UPLOADS_DIR, wsId), { recursive: true, force: true });
}

/** Supprime des fichiers téléversés de l'espace ; renvoie le nombre de fichiers effacés. */
export async function removeUploads(wsId, names) {
  let removed = 0;
  for (const name of new Set(names)) {
    try {
      await fsp.unlink(path.join(UPLOADS_DIR, wsId, name));
      removed++;
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[uploads] suppression impossible de ${name}:`, err);
    }
  }
  return removed;
}
