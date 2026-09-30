// Agendas de l'espace (section Agenda et widgets) : agendas Google ou adresses iCal, avec leur couleur. Liste dans le
// document de l'espace (map « agenda », clé « config ») ; événements de chaque agenda à part (« events:<id> »), pour
// qu'une actualisation ne réécrive pas le reste.
import { useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { dayKey, parseEventsJson, parseIcs, type CalEvent } from './ics';
import { fetchGoogleCalendarsEvents, parseGoogleSource, requestGoogleToken } from './google';
import { getSettings } from './settings';
import { newId } from './ids';

export type AgendaCalendar = {
  id: string;
  name: string;
  color: string;
  /** « google:<ids> » (agendas Google choisis) ou adresse iCal. */
  source: string;
  enabled: boolean;
};

export type AgendaEvent = CalEvent & { calendarId: string };

export const CALENDAR_COLORS = ['#2383e2', '#e03e3e', '#2eaf7d', '#d9730d', '#7c5cff', '#c14c8a', '#0ea5b7', '#dfab01'];

function readCalendars(doc: Y.Doc): AgendaCalendar[] {
  try {
    const raw = JSON.parse(String(doc.getMap('agenda').get('config') ?? '{}')) as { calendars?: AgendaCalendar[] };
    return (raw.calendars ?? []).filter((c) => c && typeof c.id === 'string');
  } catch {
    return [];
  }
}

function writeCalendars(doc: Y.Doc, calendars: AgendaCalendar[]) {
  doc.getMap('agenda').set('config', JSON.stringify({ calendars }));
}

export function updateCalendars(doc: Y.Doc, change: (list: AgendaCalendar[]) => AgendaCalendar[]) {
  writeCalendars(doc, change(readCalendars(doc)));
}

type Stored = { events: CalEvent[]; updatedAt: number };

function readEvents(doc: Y.Doc, id: string): Stored {
  try {
    const raw = JSON.parse(String(doc.getMap('agenda').get(`events:${id}`) ?? '{}')) as Partial<Stored>;
    return { events: Array.isArray(raw.events) ? raw.events : [], updatedAt: Number(raw.updatedAt) || 0 };
  } catch {
    return { events: [], updatedAt: 0 };
  }
}

function writeEvents(doc: Y.Doc, id: string, events: CalEvent[]) {
  doc.getMap('agenda').set(`events:${id}`, JSON.stringify({ events, updatedAt: Date.now() }));
}

/** Ajoute un agenda (résultat de la fenêtre d'import : Google ou iCal). */
export function addCalendar(doc: Y.Doc, res: { title: string; events: CalEvent[]; source: string }): string {
  const calendars = readCalendars(doc);
  // Même adresse ou mêmes agendas Google : mise à jour de l'agenda déjà ajouté (un fichier importé est toujours nouveau).
  const existing = res.source ? calendars.find((c) => c.source === res.source) : undefined;
  const id = existing?.id ?? newId();
  doc.transact(() => {
    if (!existing) {
      const color = CALENDAR_COLORS[calendars.length % CALENDAR_COLORS.length];
      writeCalendars(doc, [...calendars, { id, name: res.title || 'Agenda', color, source: res.source, enabled: true }]);
    }
    writeEvents(doc, id, res.events);
  });
  return id;
}

export function removeCalendar(doc: Y.Doc, id: string) {
  doc.transact(() => {
    writeCalendars(
      doc,
      readCalendars(doc).filter((c) => c.id !== id),
    );
    doc.getMap('agenda').delete(`events:${id}`);
  });
}

export const isGoogleSource = (source: string) => source.startsWith('google:');

/**
 * Relit un agenda. iCal : par le serveur Notes (sans intervention) ; Google : fenêtre de connexion au compte Google
 * (à lancer depuis un clic). Renvoie le nombre d'événements et les agendas Google illisibles.
 */
export async function refreshCalendar(
  doc: Y.Doc,
  cal: AgendaCalendar,
  fetchIcs: ((url: string) => Promise<string>) | null,
): Promise<{ count: number; failed: string[] }> {
  let events: CalEvent[];
  let failed: string[] = [];
  if (!cal.source) throw new Error('Agenda importé d’un fichier : importez le fichier à nouveau pour le mettre à jour.');
  if (isGoogleSource(cal.source)) {
    const clientId = getSettings().googleClientId;
    if (!clientId) throw new Error('Renseignez un ID client Google dans les réglages pour actualiser cet agenda.');
    const token = await requestGoogleToken(clientId);
    ({ events, failed } = await fetchGoogleCalendarsEvents(token, parseGoogleSource(cal.source)));
  } else {
    if (!fetchIcs) throw new Error('Un serveur Notes est nécessaire pour actualiser un agenda iCal.');
    events = parseIcs(await fetchIcs(cal.source)).events;
  }
  writeEvents(doc, cal.id, events);
  return { count: events.length, failed };
}

const AUTO_REFRESH = 60 * 60_000;
const autoRefreshed = new Set<string>();

/** Agendas iCal pas relus depuis une heure : actualisés en arrière-plan (une fois par session et par agenda). */
export function autoRefreshIcs(doc: Y.Doc, fetchIcs: ((url: string) => Promise<string>) | null) {
  if (!fetchIcs) return;
  for (const cal of readCalendars(doc)) {
    if (!cal.enabled || !cal.source || isGoogleSource(cal.source) || autoRefreshed.has(cal.id)) continue;
    if (Date.now() - readEvents(doc, cal.id).updatedAt < AUTO_REFRESH) continue;
    autoRefreshed.add(cal.id);
    void refreshCalendar(doc, cal, fetchIcs).catch(() => {});
  }
}

/** Agendas de l'espace et leurs événements réunis (agendas masqués exclus), suivis en direct. */
export function useAgenda(doc: Y.Doc | null) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!doc) return;
    const map = doc.getMap('agenda');
    const bump = () => setVersion((v) => v + 1);
    map.observe(bump);
    return () => map.unobserve(bump);
  }, [doc]);
  return useMemo(() => {
    if (!doc) return { calendars: [] as AgendaCalendar[], events: [] as AgendaEvent[], updatedAt: 0 };
    const calendars = readCalendars(doc);
    const events: AgendaEvent[] = [];
    let updatedAt = 0;
    for (const cal of calendars) {
      const stored = readEvents(doc, cal.id);
      updatedAt = Math.max(updatedAt, stored.updatedAt);
      if (!cal.enabled) continue;
      for (const ev of stored.events) events.push({ ...ev, calendarId: cal.id, color: ev.color || cal.color, calendar: ev.calendar || cal.name });
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    return { calendars, events, updatedAt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, version]);
}

/** Événements qui touchent un jour donné (clé AAAA-MM-JJ), y compris ceux sur plusieurs jours. */
export function eventsOnDay(events: AgendaEvent[], key: string): AgendaEvent[] {
  const [y, m, d] = key.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayEnd = dayStart + 86_400_000;
  return events.filter((ev) => {
    const s = new Date(ev.start).getTime();
    const e = Math.max(new Date(ev.end).getTime(), s + 1);
    return s < dayEnd && e > dayStart;
  });
}

/** Jours affichés pour un mois : semaines complètes, du lundi au dimanche. */
export function monthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== month.getMonth()) break;
    days.push(d);
  }
  return days;
}

/** Prochains événements (à partir de maintenant), groupés par jour. */
export function upcomingByDay(events: AgendaEvent[], days: number): [string, AgendaEvent[]][] {
  const now = Date.now();
  const limit = now + days * 86_400_000;
  const groups = new Map<string, AgendaEvent[]>();
  for (const ev of events) {
    const s = new Date(ev.start).getTime();
    const e = new Date(ev.end).getTime();
    if (e < now || s > limit) continue;
    const k = dayKey(s < now ? new Date(now).toISOString() : ev.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(ev);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export { parseEventsJson };
