// Sauvegardes du serveur : archive .tar.gz de tout le dossier de données (documents, fichiers envoyés, espaces,
// liens de partage), faite chaque nuit (si quelque chose a changé) et à la demande, gardée dans le dossier des
// sauvegardes (les plus récentes seulement). Mot de passe facultatif : archive chiffrée (AES-256-GCM, clé tirée du
// mot de passe par scrypt), extension .ostal. Restauration : l'état actuel est d'abord sauvegardé, puis remplacé ;
// la « génération » des données change, ce qui fait oublier aux appareils leur copie locale (voir ws.js).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR } from './store.js';

const MAGIC = Buffer.from('OSTALBK1');
const SETTINGS_FILE = path.join(DATA_DIR, 'sauvegarde.json');
const GEN_FILE = path.join(DATA_DIR, 'generation.txt');
/** Dossier des sauvegardes par défaut ; l'application pour ordinateur laisse en choisir un autre (BACKUP_DIR_CHOICE). */
const DEFAULT_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, 'sauvegardes'));
const DIR_CHOICE = process.env.BACKUP_DIR_CHOICE === '1';
/** Application pour ordinateur : pas forcément allumée la nuit, la sauvegarde du jour se fait à n'importe quelle heure. */
const ANYTIME = process.env.BACKUP_ANYTIME === '1';
/** Docker : le dossier vu par le conteneur ne parle pas à l'utilisateur, l'interface décrit celui de la machine. */
const DIR_KIND = process.env.BACKUP_DIR_KIND === 'docker' ? 'docker' : DIR_CHOICE ? 'local' : 'server';
const KEEP_CHOICES = [3, 7, 14, 30];
/** Sauvegardes faites avant une restauration : gardées en plus des autres (les 3 dernières). */
const KEEP_BEFORE_RESTORE = 3;
const NAME_RE = /^ostal-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})(-avant-restauration)?\.(tar\.gz|ostal)$/;

/** Fichiers et dossiers du dossier de données jamais sauvegardés : réglages des sauvegardes, génération, clé de
 * signature (propre à ce serveur), restaurations en cours, fichiers temporaires. */
function skipped(rel) {
  const top = rel.split('/')[0];
  if (['sauvegarde.json', 'generation.txt', 'signing.key'].includes(rel)) return true;
  if (top.startsWith('.restauration-') || top.startsWith('.envoi-')) return true;
  if (rel.endsWith('.tmp')) return true;
  return false;
}

export class BackupError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Réglages ----------

function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      auto: s.auto !== false,
      keep: KEEP_CHOICES.includes(s.keep) ? s.keep : 7,
      password: typeof s.password === 'string' ? s.password : '',
      dir: DIR_CHOICE && typeof s.dir === 'string' ? s.dir : '',
      fingerprint: typeof s.fingerprint === 'string' ? s.fingerprint : '',
      lastError: s.lastError && typeof s.lastError.message === 'string' ? s.lastError : null,
    };
  } catch {
    return { auto: true, keep: 7, password: '', dir: '', fingerprint: '', lastError: null };
  }
}

let settings = readSettings();

function saveSettings() {
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_FILE);
}

const backupDir = () => settings.dir || DEFAULT_DIR;

/** Réglages modifiables depuis l'application. */
export async function updateBackupSettings(patch) {
  const next = { ...settings };
  if (typeof patch.auto === 'boolean') next.auto = patch.auto;
  if (KEEP_CHOICES.includes(patch.keep)) next.keep = patch.keep;
  if (patch.password !== undefined) {
    if (patch.password !== null && (typeof patch.password !== 'string' || patch.password.length < 6 || patch.password.length > 200))
      throw new BackupError(400, 'Mot de passe : 6 caractères au moins.');
    next.password = patch.password || '';
  }
  if (patch.dir !== undefined) {
    if (!DIR_CHOICE) throw new BackupError(403, 'Le dossier des sauvegardes se règle sur le serveur.');
    const dir = String(patch.dir || '');
    if (dir) {
      if (!path.isAbsolute(dir)) throw new BackupError(400, 'Dossier invalide.');
      await checkWritable(dir);
    }
    next.dir = dir;
  }
  settings = next;
  saveSettings();
}

async function checkWritable(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.ostal-${process.pid}.tmp`);
    await fsp.writeFile(probe, 'ok');
    await fsp.unlink(probe);
  } catch {
    throw new BackupError(400, 'Impossible d’écrire dans ce dossier.');
  }
}

// ---------- Génération des données ----------

/** Identifiant de l'état des données, changé à chaque restauration ('0' : jamais restauré). */
export function dataGeneration() {
  try {
    return fs.readFileSync(GEN_FILE, 'utf8').trim() || '0';
  } catch {
    return '0';
  }
}

function newGeneration() {
  const gen = crypto.randomBytes(9).toString('base64url');
  fs.writeFileSync(GEN_FILE, gen);
  return gen;
}

// ---------- Archive tar ----------

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function header(name, size, mtime, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 100, 'utf8');
  h.write(octal(type === '5' ? 0o755 : 0o644, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(Math.max(0, Math.floor(mtime / 1000)), 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return h;
}

const padding = (size) => Buffer.alloc((512 - (size % 512)) % 512);

/** En-têtes d'une entrée ; nom trop long : entrée GNU « LongLink » avant. */
function entryHeaders(name, size, mtime, type) {
  const bytes = Buffer.byteLength(name);
  if (bytes <= 100) return [header(name, size, mtime, type)];
  const long = Buffer.from(`${name}\0`);
  return [header('././@LongLink', long.length, 0, 'L'), long, padding(long.length), header(Buffer.from(name).subarray(0, 100).toString('latin1'), size, mtime, type)];
}

/** Fichiers sauvegardés : chemins relatifs au dossier de données (séparateur /). */
async function listFiles() {
  const out = [];
  const backups = path.resolve(backupDir());
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skipped(r) || path.resolve(abs) === backups) continue;
      if (e.isDirectory()) await walk(abs, r);
      else if (e.isFile()) {
        const st = await fsp.stat(abs).catch(() => null);
        if (st) out.push({ abs, rel: r, size: st.size, mtime: st.mtimeMs });
      }
    }
  }
  await walk(DATA_DIR, '');
  return out;
}

async function* tarStream(files) {
  for (const f of files) {
    let fh;
    try {
      fh = await fsp.open(f.abs, 'r');
    } catch {
      continue; // fichier disparu entre-temps (page supprimée)
    }
    // Taille lue sur le fichier ouvert : un document remplacé pendant la lecture reste lu en entier (ancienne version).
    const { size } = await fh.stat();
    yield* entryHeaders(f.rel, size, f.mtime, '0');
    if (size > 0) {
      let sent = 0;
      for await (const chunk of fh.createReadStream({ start: 0, end: size - 1 })) {
        sent += chunk.length;
        yield chunk;
      }
      if (sent !== size) throw new Error(`fichier raccourci pendant la sauvegarde : ${f.rel}`);
    } else await fh.close();
    yield padding(size);
  }
  yield Buffer.alloc(1024);
}

/** Lecture d'une archive tar : chaque fichier est écrit dans `dest` (chemins vérifiés : rien en dehors). */
async function extractTar(input, dest) {
  let buf = Buffer.alloc(0);
  let longName = null;
  let current = null; // { remaining, pad, out }
  let entries = 0;
  const root = path.resolve(dest);
  const target = (name) => {
    const clean = name.replace(/\\/g, '/');
    if (!clean || clean.startsWith('/') || clean.split('/').some((p) => p === '..' || p === '')) return null;
    const abs = path.resolve(root, clean);
    return abs.startsWith(root + path.sep) ? abs : null;
  };
  const write = (out, chunk) => new Promise((resolve, reject) => (out.write(chunk, (err) => (err ? reject(err) : resolve()))));
  const end = (out) => new Promise((resolve, reject) => {
    out.on('error', reject);
    out.end(resolve);
  });
  for await (const chunk of input) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (true) {
      if (current) {
        if (current.remaining > 0) {
          if (!buf.length) break;
          const take = Math.min(current.remaining, buf.length);
          if (current.out) await write(current.out, buf.subarray(0, take));
          else if (current.collect) current.collect.push(buf.subarray(0, take));
          current.remaining -= take;
          buf = buf.subarray(take);
          if (current.remaining > 0) break;
        }
        if (buf.length < current.pad) break;
        buf = buf.subarray(current.pad);
        if (current.out) await end(current.out);
        if (current.collect) longName = Buffer.concat(current.collect).toString('utf8').replace(/\0.*$/s, '');
        current = null;
        continue;
      }
      if (buf.length < 512) break;
      const h = buf.subarray(0, 512);
      buf = buf.subarray(512);
      if (h.every((b) => b === 0)) continue;
      const type = String.fromCharCode(h[156] || 48);
      const size = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
      if (!Number.isFinite(size) || size < 0) throw new BackupError(400, 'Archive abîmée.');
      const prefix = h.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
      let name = longName ?? h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
      if (!longName && prefix && h.subarray(257, 262).toString('ascii') === 'ustar') name = `${prefix}/${name}`;
      longName = null;
      const pad = (512 - (size % 512)) % 512;
      if (type === 'L') {
        current = { remaining: size, pad, collect: [] };
        continue;
      }
      if (type === '0' || type === '\0' || type === '7') {
        const abs = target(name);
        if (!abs) throw new BackupError(400, 'Archive refusée : chemin de fichier invalide.');
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        current = { remaining: size, pad, out: fs.createWriteStream(abs) };
        entries++;
        continue;
      }
      // Dossiers, liens et en-têtes étendus : ignorés (les dossiers sont créés avec leurs fichiers).
      current = { remaining: size, pad };
    }
  }
  if (current?.out) await end(current.out);
  if (current && current.remaining > 0) throw new BackupError(400, 'Archive incomplète.');
  return entries;
}

// ---------- Chiffrement ----------

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
const checkValue = (key) => crypto.createHmac('sha256', key).update('ostal-sauvegarde').digest().subarray(0, 16);

/** Flux chiffré : MAGIC, sel, IV, contrôle du mot de passe, données, étiquette GCM (16 octets) à la fin. */
function encryptStream(password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let started = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (!started) {
        started = true;
        this.push(Buffer.concat([MAGIC, salt, iv, checkValue(key)]));
      }
      cb(null, cipher.update(chunk));
    },
    flush(cb) {
      if (!started) this.push(Buffer.concat([MAGIC, salt, iv, checkValue(key)]));
      const last = cipher.final();
      cb(null, Buffer.concat([last, cipher.getAuthTag()]));
    },
  });
}

const HEAD = MAGIC.length + 16 + 12 + 16;

/** Archive chiffrée ? (et son en-tête) */
async function readHead(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const head = Buffer.alloc(HEAD);
    const { bytesRead } = await fh.read(head, 0, HEAD, 0);
    const size = (await fh.stat()).size;
    return { head: head.subarray(0, bytesRead), size };
  } finally {
    await fh.close();
  }
}

/** Flux qui donnent le contenu tar (déchiffré, décompressé) d'une archive, à enchaîner avec pipeline(). */
async function openArchive(file, password) {
  const { head, size } = await readHead(file);
  if (head.subarray(0, MAGIC.length).equals(MAGIC)) {
    if (!password) throw new BackupError(401, 'Cette sauvegarde est protégée par un mot de passe.');
    if (size < HEAD + 16) throw new BackupError(400, 'Archive abîmée.');
    const salt = head.subarray(8, 24);
    const iv = head.subarray(24, 36);
    const key = deriveKey(password, salt);
    if (!checkValue(key).equals(head.subarray(36, 52))) throw new BackupError(401, 'Mot de passe incorrect.');
    const tagBuf = Buffer.alloc(16);
    const fh = await fsp.open(file, 'r');
    await fh.read(tagBuf, 0, 16, size - 16);
    await fh.close();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tagBuf);
    return [fs.createReadStream(file, { start: HEAD, end: size - 17 }), decipher, zlib.createGunzip()];
  }
  if (!(head[0] === 0x1f && head[1] === 0x8b)) throw new BackupError(400, 'Ce fichier n’est pas une sauvegarde d’Ostal.');
  return [fs.createReadStream(file), zlib.createGunzip()];
}

// ---------- Sauvegardes ----------

let running = null; // Promise en cours (sauvegarde ou restauration)
let restoring = false;
export const isRestoring = () => restoring;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Sauvegardes du dossier, la plus récente d'abord. */
export async function listBackups() {
  const dir = backupDir();
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const m = NAME_RE.exec(name);
    if (!m) continue;
    const st = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (!st?.isFile()) continue;
    const createdAt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    out.push({ name, size: st.size, createdAt, encrypted: m[8] === 'ostal', beforeRestore: Boolean(m[7]) });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

/** Empreinte des données (tailles et dates) : rien de changé depuis la dernière sauvegarde automatique ? */
async function fingerprint(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(`${f.rel}\0${f.size}\0${Math.floor(f.mtime)}\n`);
  return h.digest('hex');
}

async function prune() {
  const all = await listBackups();
  const normal = all.filter((b) => !b.beforeRestore).slice(settings.keep);
  const before = all.filter((b) => b.beforeRestore).slice(KEEP_BEFORE_RESTORE);
  for (const b of [...normal, ...before]) await fsp.unlink(path.join(backupDir(), b.name)).catch(() => {});
}

/**
 * Nouvelle sauvegarde. `kind` : 'manual', 'auto' (passée si rien n'a changé depuis la précédente) ou
 * 'before-restore'. Renvoie la sauvegarde créée (null : rien à faire).
 */
async function createBackup(kind, flush) {
  await flush?.();
  const files = await listFiles();
  const print = await fingerprint(files);
  if (kind === 'auto' && print === settings.fingerprint && (await listBackups()).length) return null;
  const dir = backupDir();
  await fsp.mkdir(dir, { recursive: true });
  const total = files.reduce((n, f) => n + f.size, 0);
  try {
    const { bavail, bsize } = await fsp.statfs(dir);
    if (bavail * bsize < total * 1.1 + 50 * 1024 * 1024) throw new BackupError(507, 'Place insuffisante dans le dossier des sauvegardes.');
  } catch (err) {
    if (err instanceof BackupError) throw err;
  }
  const encrypted = Boolean(settings.password);
  const name = `ostal-${stamp()}${kind === 'before-restore' ? '-avant-restauration' : ''}.${encrypted ? 'ostal' : 'tar.gz'}`;
  const file = path.join(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const stages = [Readable.from(tarStream(files)), zlib.createGzip({ level: 6 })];
    if (encrypted) stages.push(encryptStream(settings.password));
    await pipeline(...stages, fs.createWriteStream(tmp));
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
  settings.fingerprint = print;
  settings.lastError = null;
  saveSettings();
  await prune();
  const st = await fsp.stat(file);
  console.log(`[sauvegarde] ${name} (${files.length} fichiers, ${Math.round(st.size / 1024)} Ko)`);
  return { name, size: st.size, createdAt: Date.now(), encrypted, beforeRestore: kind === 'before-restore' };
}

/** Une seule opération à la fois (sauvegarde ou restauration). */
async function exclusive(fn) {
  if (running) throw new BackupError(409, 'Une sauvegarde ou une restauration est déjà en cours.');
  running = fn();
  try {
    return await running;
  } finally {
    running = null;
  }
}

export function runBackup(kind, flush) {
  return exclusive(() => createBackup(kind, flush)).catch((err) => {
    settings.lastError = { message: err instanceof BackupError ? err.message : 'Sauvegarde impossible.', at: Date.now() };
    saveSettings();
    if (!(err instanceof BackupError)) console.error('[sauvegarde] échec :', err);
    throw err;
  });
}

export async function backupStatus() {
  const list = await listBackups();
  return {
    auto: settings.auto,
    keep: settings.keep,
    keepChoices: KEEP_CHOICES,
    encrypted: Boolean(settings.password),
    dir: backupDir(),
    dirKind: settings.dir ? 'custom' : DIR_KIND,
    dirChoice: DIR_CHOICE,
    running: Boolean(running),
    lastError: settings.lastError,
    list,
  };
}

/** Chemin d'une sauvegarde de la liste (nom vérifié), sinon erreur 404. */
export function backupFile(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new BackupError(404, 'Sauvegarde introuvable.');
  const file = path.join(backupDir(), name);
  if (!fs.existsSync(file)) throw new BackupError(404, 'Sauvegarde introuvable.');
  return file;
}

export async function deleteBackup(name) {
  await fsp.unlink(backupFile(name));
}

/** Fichier reçu pour une restauration : enregistré à part dans le dossier de données. */
export async function receiveUpload(req, maxBytes) {
  const file = path.join(DATA_DIR, `.envoi-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  let size = 0;
  const limit = new Transform({
    transform(chunk, _e, cb) {
      size += chunk.length;
      if (size > maxBytes) cb(new BackupError(413, 'Fichier trop volumineux.'));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(req, limit, fs.createWriteStream(file));
  } catch (err) {
    await fsp.unlink(file).catch(() => {});
    throw err;
  }
  return file;
}

/**
 * Restaure une sauvegarde. `hooks` : pause() ferme les connexions et oublie les documents en mémoire sans les
 * enregistrer, reload() relit les espaces et liens de partage, resume() rouvre. Renvoie la nouvelle génération.
 */
export function restoreBackup(file, password, hooks) {
  return exclusive(async () => {
    const stage = path.join(DATA_DIR, `.restauration-${Date.now()}`);
    try {
      // 1. Lecture complète de l'archive à part : rien n'est touché si elle est illisible ou le mot de passe faux.
      let entries = 0;
      let refused = null; // erreur de lecture de l'archive (la chaîne de flux ne rend parfois qu'une fermeture prématurée)
      try {
        const streams = await openArchive(file, password);
        await pipeline(...streams, async (source) => {
          try {
            entries = await extractTar(source, stage);
          } catch (err) {
            refused = err;
            throw err;
          }
        });
      } catch (err) {
        if (refused instanceof BackupError) throw refused;
        if (err instanceof BackupError) throw err;
        throw new BackupError(400, password ? 'Mot de passe incorrect ou sauvegarde abîmée.' : 'Sauvegarde illisible ou abîmée.');
      }
      if (!entries || !fs.existsSync(path.join(stage, 'workspaces.json'))) throw new BackupError(400, 'Ce fichier n’est pas une sauvegarde d’Ostal.');
      // 2. Filet de sécurité : l'état actuel, sauvegardé tel quel.
      await createBackup('before-restore', hooks.flush);
      // 3. Remplacement, documents en mémoire oubliés.
      restoring = true;
      await hooks.pause();
      const backups = path.resolve(backupDir());
      for (const e of await fsp.readdir(DATA_DIR, { withFileTypes: true })) {
        const abs = path.join(DATA_DIR, e.name);
        if (skipped(e.name) || path.resolve(abs) === backups || path.resolve(abs) === path.resolve(stage)) continue;
        await fsp.rm(abs, { recursive: true, force: true });
      }
      for (const e of await fsp.readdir(stage, { withFileTypes: true })) {
        if (skipped(e.name)) continue;
        await fsp.rename(path.join(stage, e.name), path.join(DATA_DIR, e.name));
      }
      const gen = newGeneration();
      settings.fingerprint = '';
      saveSettings();
      hooks.reload();
      console.log(`[sauvegarde] restauration terminée (${entries} fichiers), génération ${gen}`);
      return gen;
    } finally {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      if (restoring) {
        restoring = false;
        hooks.resume();
      }
    }
  });
}

/** Sauvegarde automatique : vérifiée toutes les heures, faite la nuit (entre 2 h et 6 h) une fois par jour. */
export function startBackupSchedule(flush) {
  const check = async () => {
    if (!settings.auto || running) return;
    const last = (await listBackups()).find((b) => !b.beforeRestore);
    const age = last ? Date.now() - last.createdAt : Infinity;
    const hour = new Date().getHours();
    if (age < 23 * 3600_000) return;
    if (!ANYTIME && !(hour >= 2 && hour < 6) && age < 48 * 3600_000) return;
    await runBackup('auto', flush).catch(() => {});
  };
  setTimeout(() => void check(), 5 * 60_000).unref();
  setInterval(() => void check(), 3600_000).unref();
}
