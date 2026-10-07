// Rappels : échéances des papiers (selon les rappels choisis pour chacun) et événements des agendas (selon le rappel
// choisi pour chaque agenda), calculés à partir du document de l'espace, à l'heure de l'espace (fuseau enregistré par
// les appareils). Servis aux appareils (application Android, page ouverte) et envoyés aux navigateurs abonnés
// (push.js). Textes en français ou en anglais, selon l'appareil.
import * as Y from 'yjs';
import { docs, wsRoom } from './ws.js';
import { loadDocUpdate } from './store.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Heure des rappels des papiers et des événements d'une journée entière ; « la veille » : 18 h. */
const MORNING = 9;
const EVENING = 18;
/** Rappels possibles d'un agenda : minutes avant le début, ou la veille à 18 h. */
const LEADS = { 0: 0, 10: 10, 30: 30, 60: 60 };

/**
 * Document de l'espace pour une lecture : la version en mémoire si elle est chargée (la plus récente, sans repousser
 * son déchargement), sinon celle du disque. `done()` libère la copie lue sur le disque.
 */
export async function readWorkspace(wsId) {
  const loaded = docs.get(wsRoom(wsId));
  if (loaded) {
    await loaded.whenLoaded;
    return { doc: loaded, done: () => {} };
  }
  const doc = new Y.Doc();
  const update = await loadDocUpdate(wsRoom(wsId));
  if (update) Y.applyUpdate(doc, update);
  return { doc, done: () => doc.destroy() };
}

const validZone = (tz) => {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Fuseau horaire de l'espace (enregistré par ses appareils) ; à défaut celui du serveur (TZ), sinon Paris. */
export function workspaceZone(doc) {
  const tz = doc.getMap('agenda').get('tz');
  if (validZone(tz)) return tz;
  return validZone(process.env.TZ) ? process.env.TZ : 'Europe/Paris';
}

const partsCache = new Map();
function zoneParts(tz) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    partsCache.set(tz, f);
  }
  return f;
}

/** Date et heure locales (fuseau `tz`) d'un instant. */
function local(ms, tz) {
  const p = Object.fromEntries(zoneParts(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

/** Jour local (AAAA-MM-JJ) d'un instant. */
export function dayIn(ms, tz) {
  const l = local(ms, tz);
  return `${l.y}-${String(l.m).padStart(2, '0')}-${String(l.d).padStart(2, '0')}`;
}

/** Instant d'une heure locale (fuseau `tz`) d'un jour AAAA-MM-JJ, décalé de `plusDays` jours. */
export function zonedTime(key, hour, tz, plusDays = 0) {
  const [y, m, d] = key.split('-').map(Number);
  const wanted = Date.UTC(y, m - 1, d + plusDays, hour, 0, 0);
  let t = wanted;
  // Deux passes : l'écart avec UTC change autour des changements d'heure.
  for (let i = 0; i < 2; i++) {
    const l = local(t, tz);
    t += wanted - Date.UTC(l.y, l.m - 1, l.d, l.h, l.min, l.s);
  }
  return t;
}

const TEXTS = {
  fr: {
    locale: 'fr-FR',
    today: 'Aujourd’hui',
    tomorrow: 'Demain',
    at: (day, time) => `${day} à ${time}`,
    expiresToday: 'Expire aujourd’hui.',
    expiresTomorrow: 'Expire demain.',
    expiresDays: (n, date) => `Expire dans ${n} jours, le ${date}.`,
    expiresMonths: (n, date) => `Expire dans ${n} mois, le ${date}.`,
    renew: 'Pensez au renouvellement.',
  },
  en: {
    locale: 'en-GB',
    today: 'Today',
    tomorrow: 'Tomorrow',
    at: (day, time) => `${day} at ${time}`,
    expiresToday: 'Expires today.',
    expiresTomorrow: 'Expires tomorrow.',
    expiresDays: (n, date) => `Expires in ${n} days, on ${date}.`,
    expiresMonths: (n, date) => `Expires in ${n} months, on ${date}.`,
    renew: 'Time to renew it.',
  },
};

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(String(raw ?? ''));
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Papiers de l'espace (map « papers » : un texte JSON par papier). */
function readPapers(doc) {
  const out = [];
  doc.getMap('papers').forEach((raw, id) => {
    const p = parseJson(raw, null);
    if (p && typeof p.title === 'string') out.push({ ...p, id });
  });
  return out;
}

/**
 * Rappels dont l'heure tombe dans [from, to[ : { key, at, kind, title, body, url }, triés par heure. `key` identifie
 * un rappel (un même rappel n'est envoyé qu'une fois).
 */
export function remindersBetween(doc, from, to, lang = 'fr') {
  const tz = workspaceZone(doc);
  const tx = TEXTS[lang] ?? TEXTS.fr;
  const out = [];
  const timeFmt = new Intl.DateTimeFormat(tx.locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat(tx.locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  const dateFmt = new Intl.DateTimeFormat(tx.locale, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  /** « Aujourd'hui », « Demain » ou la date, vus depuis l'heure du rappel. */
  const dayLabel = (ms, at) => {
    const day = dayIn(ms, tz);
    if (day === dayIn(at, tz)) return tx.today;
    if (day === dayIn(at + DAY, tz)) return tx.tomorrow;
    return cap(dayFmt.format(new Date(ms)));
  };

  // Papiers : à 9 h, n jours avant l'échéance (0 : le jour même).
  for (const p of readPapers(doc)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.expires || ''))) continue;
    const days = Array.isArray(p.remind) ? [...new Set(p.remind.filter((n) => Number.isInteger(n) && n >= 0 && n <= 400))] : [];
    for (const n of days) {
      const at = zonedTime(p.expires, MORNING, tz, -n);
      if (at < from || at >= to) continue;
      const [y, m, d] = p.expires.split('-').map(Number);
      const date = dateFmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
      const body =
        n === 0 ? tx.expiresToday : n === 1 ? tx.expiresTomorrow : n >= 60 ? tx.expiresMonths(Math.round(n / 30), date) : tx.expiresDays(n, date);
      out.push({
        key: `paper:${p.id}:${p.expires}:${n}`,
        at,
        kind: 'paper',
        title: p.person ? `${p.title} · ${p.person}` : p.title,
        body: `${body} ${tx.renew}`,
        url: `#/papiers/${p.id}`,
      });
    }
  }

  // Agendas affichés dont le rappel est choisi : événements en cours de période (début entre `from` et `to` + 1 jour,
  // le rappel « la veille » précédant le début).
  const agenda = doc.getMap('agenda');
  const config = parseJson(agenda.get('config'), {});
  for (const cal of Array.isArray(config.calendars) ? config.calendars : []) {
    if (!cal || !cal.enabled || typeof cal.id !== 'string') continue;
    const remind = String(cal.remind ?? '');
    if (remind !== 'eve' && !(remind in LEADS)) continue;
    const stored = parseJson(agenda.get(`events:${cal.id}`), {});
    for (const ev of Array.isArray(stored.events) ? stored.events : []) {
      const start = Date.parse(ev?.start);
      if (!Number.isFinite(start) || start < from - DAY || start > to + 2 * DAY) continue;
      const day = dayIn(start, tz);
      let at;
      if (remind === 'eve') at = zonedTime(day, EVENING, tz, -1);
      else if (ev.allDay) at = zonedTime(day, MORNING, tz);
      else at = start - LEADS[remind] * MINUTE;
      if (at < from || at >= to) continue;
      const when = ev.allDay ? dayLabel(start, at) : tx.at(dayLabel(start, at), timeFmt.format(new Date(start)));
      out.push({
        key: `event:${cal.id}:${ev.id}:${ev.start}:${remind}`,
        at,
        kind: 'event',
        title: String(ev.title || cal.name || 'Ostal').slice(0, 200),
        body: ev.location ? `${when} · ${String(ev.location).slice(0, 120)}` : when,
        url: '#/agenda',
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Rappels d'un espace dans [from, to[ (document lu sans le garder chargé). */
export async function workspaceReminders(wsId, from, to, lang) {
  const { doc, done } = await readWorkspace(wsId);
  try {
    return remindersBetween(doc, from, to, lang);
  } finally {
    done();
  }
}
