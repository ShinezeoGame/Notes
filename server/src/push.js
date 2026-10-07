// Notifications « push » des navigateurs (ordinateur, Android, iPhone avec Ostal sur l'écran d'accueil) : les rappels
// arrivent même quand Ostal est fermé. Norme Web Push : clés du serveur (VAPID, RFC 8292), contenu chiffré pour
// chaque appareil (RFC 8291, aes128gcm) et remis par le service de notifications du navigateur (Google, Mozilla,
// Apple, Microsoft). Clés et abonnements dans DATA_DIR/push.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, isValidId } from './store.js';

const FILE = path.join(DATA_DIR, 'push.json');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Rappels manqués (serveur arrêté) encore envoyés au redémarrage. */
const CATCH_UP = 12 * HOUR;
const MAX_SUBS = 30;
/** Services de notifications des navigateurs (adresse d'abonnement). */
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)$/;
/** Contact indiqué aux services de notifications (exigé par Apple). */
const SUBJECT = 'https://github.com/ShinezeoGame/Notes';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');

/** { vapid: { publicKey, privateKey }, subs: { [espace]: Abonnement[] }, last: { [espace]: heure } } */
let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    state = {};
  }
  if (!state.vapid?.publicKey || !state.vapid?.privateKey) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    state.vapid = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
    state.subs = {};
    state.last = {};
    save();
  }
  state.subs ??= {};
  state.last ??= {};
  return state;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

/** Restauration d'une sauvegarde : clés et abonnements relus du fichier restauré. */
export function reloadPush() {
  state = null;
}

/** Clé publique du serveur, transmise aux navigateurs pour s'abonner. */
export const vapidPublicKey = () => load().vapid.publicKey;

export class PushError extends Error {}

/** Enregistre l'abonnement d'un appareil (langue des textes) ; remplace celui de même adresse. */
export function addSubscription(wsId, sub, lang) {
  const s = load();
  const endpoint = String(sub?.endpoint || '');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PushError('Abonnement invalide.');
  }
  const anyHost = process.env.PUSH_ALLOW_ANY === '1';
  if (!anyHost && (url.protocol !== 'https:' || !PUSH_HOSTS.test(url.hostname))) throw new PushError('Service de notifications inconnu.');
  const p256dh = unb64u(sub?.keys?.p256dh);
  const auth = unb64u(sub?.keys?.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) throw new PushError('Abonnement invalide.');
  const list = (s.subs[wsId] ?? []).filter((x) => x.endpoint !== endpoint);
  list.push({ endpoint, keys: { p256dh: b64u(p256dh), auth: b64u(auth) }, lang: lang === 'en' ? 'en' : 'fr', addedAt: Date.now() });
  s.subs[wsId] = list.slice(-MAX_SUBS);
  s.last[wsId] ??= Date.now();
  save();
}

export function removeSubscription(wsId, endpoint) {
  const s = load();
  const list = s.subs[wsId] ?? [];
  const next = list.filter((x) => x.endpoint !== endpoint);
  if (next.length === list.length) return false;
  if (next.length) s.subs[wsId] = next;
  else {
    delete s.subs[wsId];
    delete s.last[wsId];
  }
  save();
  return true;
}

/** Abonnement d'un appareil de l'espace (adresse d'abonnement), ou null. */
export const findSubscription = (wsId, endpoint) => (load().subs[wsId] ?? []).find((x) => x.endpoint === endpoint) ?? null;

/** Espace retiré : ses abonnements aussi. */
export function removeWorkspacePush(wsId) {
  const s = load();
  if (!s.subs[wsId] && !s.last[wsId]) return;
  delete s.subs[wsId];
  delete s.last[wsId];
  save();
}

/** Contenu chiffré pour un abonnement (RFC 8291 : un seul enregistrement aes128gcm). */
export function encryptPayload(payload, keys) {
  const uaPublic = unb64u(keys.p256dh);
  const authSecret = unb64u(keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // Dernier (et seul) enregistrement : délimiteur 0x02 après le contenu.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** En-tête d'autorisation VAPID (jeton ES256 signé par la clé du serveur, valable 12 heures). */
function vapidAuthorization(endpoint) {
  const { publicKey, privateKey } = load().vapid;
  const pub = unb64u(publicKey);
  const key = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${publicKey}`;
}

/** Envoie une notification ; 'gone' : abonnement expiré (à oublier). */
export async function sendPush(sub, message) {
  const payload = Buffer.from(JSON.stringify(message));
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(sub.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(24 * 3600),
        Urgency: 'high',
      },
      body: encryptPayload(payload, sub.keys),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) {
      console.warn(`[push] refus de ${new URL(sub.endpoint).hostname} : ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return 'error';
    }
    return 'ok';
  } catch (err) {
    console.warn('[push] envoi impossible :', err.message);
    return 'error';
  }
}

/** Envoie un message à tous les appareils abonnés d'un espace (abonnements expirés oubliés). */
export async function pushToWorkspace(wsId, makeMessage) {
  const s = load();
  let sent = 0;
  for (const sub of [...(s.subs[wsId] ?? [])]) {
    const message = await makeMessage(sub.lang);
    if (!message) continue;
    const result = await sendPush(sub, message);
    if (result === 'gone') removeSubscription(wsId, sub.endpoint);
    if (result === 'ok') sent++;
  }
  return sent;
}

/**
 * Envoi des rappels chaque minute aux espaces qui ont des appareils abonnés. `due(espace, de, à, langue)` donne les
 * rappels dont l'heure est passée depuis le dernier passage ; `paused()` : restauration en cours.
 */
export function startPushSchedule(due, paused) {
  let running = false;
  let lastSave = Date.now();
  const tick = async () => {
    if (running || paused()) return;
    running = true;
    try {
      const s = load();
      const now = Date.now();
      let changed = false;
      for (const wsId of Object.keys(s.subs)) {
        if (!isValidId(wsId) || !s.subs[wsId]?.length) continue;
        const from = Math.max(s.last[wsId] ?? now - MINUTE, now - CATCH_UP);
        s.last[wsId] = now;
        const byLang = new Map();
        const list = async (lang) => {
          if (!byLang.has(lang)) byLang.set(lang, await due(wsId, from, now, lang));
          return byLang.get(lang);
        };
        const any = await list('fr').catch((err) => {
          console.error('[push] rappels illisibles pour', wsId, err);
          return [];
        });
        for (let i = 0; i < any.length; i++) {
          await pushToWorkspace(wsId, async (lang) => {
            const r = (await list(lang))[i];
            return r ? { title: r.title, body: r.body, url: r.url, tag: r.key } : null;
          });
          changed = true;
        }
      }
      if (changed || now - lastSave > 10 * MINUTE) {
        save();
        lastSave = now;
      }
    } catch (err) {
      console.error('[push]', err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), Number(process.env.PUSH_TICK_MS) || MINUTE);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
