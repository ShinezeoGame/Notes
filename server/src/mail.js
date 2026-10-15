// Mails de la page « Priorités » (section Perso) : le serveur lit la boîte de réception en IMAP, en lecture seule, avec
// l'adresse et le mot de passe d'application du propriétaire. Identifiants gardés ici seulement (DATA_DIR/mail.json,
// jamais renvoyés aux appareils) ; boîte relue au plus une fois par minute.
import fs from 'node:fs';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { DATA_DIR } from './store.js';

const FILE = path.join(DATA_DIR, 'mail.json');
const CACHE_MS = 60_000;
/** Mails des derniers jours seulement : au-delà, ce n'est plus de l'urgence. */
const DAYS = 14;
const MAX = 80;

/** wsId → { messages, at } ou { pending } */
const cache = new Map();

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(all) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

/** Serveur IMAP deviné d'après l'adresse (Gmail, Outlook, Orange, Free…), modifiable. */
export function guessHost(email) {
  const domain = String(email).split('@')[1]?.toLowerCase() ?? '';
  if (/^(gmail|googlemail)\.com$/.test(domain)) return 'imap.gmail.com';
  if (/^(outlook|hotmail|live|msn)\.(com|fr)$/.test(domain)) return 'outlook.office365.com';
  if (/^(yahoo|ymail)\./.test(domain)) return 'imap.mail.yahoo.com';
  if (/^(icloud|me|mac)\.com$/.test(domain)) return 'imap.mail.me.com';
  if (/^(orange|wanadoo)\.fr$/.test(domain)) return 'imap.orange.fr';
  return domain ? `imap.${domain}` : '';
}

function clean({ email, host, password }) {
  const e = String(email ?? '').trim().slice(0, 200);
  const h = String(host ?? '').trim().toLowerCase().slice(0, 200) || guessHost(e);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw fail(400, 'Adresse e-mail invalide.');
  if (!/^[a-z0-9.-]+$/.test(h)) throw fail(400, 'Serveur de messagerie invalide.');
  return { email: e, host: h, password: String(password ?? '').replace(/\s+/g, '').slice(0, 200) };
}

/** Réglage sans le mot de passe (pour l'application), ou null. */
export function mailSettings(wsId) {
  const c = readAll()[wsId];
  return c ? { email: c.email, host: c.host } : null;
}

/** Lit la boîte de réception : [{ id, from, subject, date, unread, flagged, important, link }]. */
async function fetchInbox({ email, host, password }) {
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: email, pass: password }, logger: false, socketTimeout: 30_000 });
  client.on('error', () => {}); // erreur de connexion après coup : la requête en cours échoue déjà
  try {
    await client.connect();
  } catch (err) {
    if (err.authenticationFailed) {
      throw fail(401, 'Identifiants refusés. Pour Gmail, utilisez un mot de passe d’application (pas votre mot de passe habituel).');
    }
    throw fail(502, `Serveur de messagerie injoignable (${host}).`);
  }
  try {
    // EXAMINE : lecture seule, aucun mail n'est marqué comme lu.
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const uids = (await client.search({ since: new Date(Date.now() - DAYS * 86_400_000) }, { uid: true })) || [];
      if (!uids.length) return [];
      const out = [];
      const gmail = host === 'imap.gmail.com';
      for await (const m of client.fetch(uids.slice(-MAX), { envelope: true, flags: true, internalDate: true, labels: gmail, threadId: gmail }, { uid: true })) {
        const from = m.envelope?.from?.[0];
        out.push({
          id: String(m.uid),
          from: (from?.name || from?.address || '').slice(0, 120),
          subject: (m.envelope?.subject || '').slice(0, 300),
          date: new Date(m.internalDate || m.envelope?.date || Date.now()).toISOString(),
          unread: !m.flags?.has('\\Seen'),
          flagged: Boolean(m.flags?.has('\\Flagged')),
          important: Boolean(m.labels?.has('\\Important')),
          link: gmail && m.threadId ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${BigInt(m.threadId).toString(16)}` : '',
        });
      }
      return out.reverse();
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Mails récents de l'espace ; null si la messagerie n'est pas reliée. */
export async function mailFor(wsId, { fresh = false } = {}) {
  const cfg = readAll()[wsId];
  if (!cfg) return null;
  const hit = cache.get(wsId);
  if (hit?.pending) return hit.pending;
  if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return hit.result;
  const pending = fetchInbox(cfg).then(
    (messages) => {
      const result = { email: cfg.email, host: cfg.host, messages, at: Date.now() };
      cache.set(wsId, { result, at: Date.now() });
      return result;
    },
    (err) => {
      cache.delete(wsId);
      throw err;
    },
  );
  cache.set(wsId, { ...hit, pending });
  return pending;
}

/** Relie la messagerie après un essai réussi ; mot de passe vide : celui déjà enregistré. */
export async function saveMail(wsId, input) {
  const all = readAll();
  const cfg = clean(input);
  if (!cfg.password) cfg.password = all[wsId]?.password ?? '';
  if (!cfg.password) throw fail(400, 'Mot de passe manquant.');
  const messages = await fetchInbox(cfg);
  all[wsId] = cfg;
  writeAll(all);
  const result = { email: cfg.email, host: cfg.host, messages, at: Date.now() };
  cache.set(wsId, { result, at: Date.now() });
  return result;
}

export function removeMail(wsId) {
  const all = readAll();
  delete all[wsId];
  writeAll(all);
  cache.delete(wsId);
}
