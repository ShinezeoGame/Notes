// Analyse de fichiers/flux iCalendar (export Google Agenda) en événements simples.
import ICAL from 'ical.js';

export type CalEvent = {
  id: string;
  title: string;
  /** ISO 8601 */
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  url: string;
};

export type ParsedCalendar = { name: string; events: CalEvent[] };

const DAY = 86_400_000;

function toEvent(e: ICAL.Event, start: ICAL.Time, end: ICAL.Time, id: string): CalEvent {
  return {
    id,
    title: e.summary || '(Sans titre)',
    start: start.toJSDate().toISOString(),
    end: end.toJSDate().toISOString(),
    allDay: Boolean(start.isDate),
    location: e.location || '',
    description: (e.description || '').slice(0, 600),
    url: String(e.component.getFirstPropertyValue('url') ?? ''),
  };
}

export function parseIcs(text: string, opts: { from?: Date; to?: Date; max?: number } = {}): ParsedCalendar {
  const from = opts.from ?? new Date(Date.now() - 30 * DAY);
  const to = opts.to ?? new Date(Date.now() + 365 * DAY);
  const max = opts.max ?? 800;

  const jcal = ICAL.parse(text.replace(/\r?\n/g, '\r\n'));
  const comp = new ICAL.Component(jcal);
  for (const tz of comp.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* fuseau non reconnu */
    }
  }
  const name = String(comp.getFirstPropertyValue('x-wr-calname') ?? 'Agenda');

  const masters: ICAL.Event[] = [];
  const exceptions: ICAL.Event[] = [];
  for (const v of comp.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(v);
    if (e.isRecurrenceException()) exceptions.push(e);
    else masters.push(e);
  }
  const byUid = new Map(masters.map((e) => [e.uid, e] as const));
  for (const ex of exceptions) {
    const master = byUid.get(ex.uid);
    if (master) master.relateException(ex);
    else masters.push(ex);
  }

  const events: CalEvent[] = [];
  outer: for (const e of masters) {
    try {
      if (e.isRecurring()) {
        const it = e.iterator();
        let next: ICAL.Time | null;
        let guard = 0;
        while ((next = it.next()) && guard++ < 20_000) {
          const startDate = next.toJSDate();
          if (startDate > to) break;
          const det = e.getOccurrenceDetails(next);
          if (det.endDate.toJSDate() < from) continue;
          events.push(toEvent(det.item, det.startDate, det.endDate, `${e.uid}:${next.toString()}`));
          if (events.length >= max) break outer;
        }
      } else {
        if (!e.startDate) continue;
        const end = e.endDate ?? e.startDate;
        if (end.toJSDate() < from || e.startDate.toJSDate() > to) continue;
        events.push(toEvent(e, e.startDate, end, e.uid));
        if (events.length >= max) break;
      }
    } catch {
      /* événement mal formé : ignoré */
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return { name, events };
}

export function parseEventsJson(json: string): CalEvent[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as CalEvent[]) : [];
  } catch {
    return [];
  }
}

const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDay(iso: string): string {
  const label = dayFmt.format(new Date(iso));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatTimeRange(ev: CalEvent): string {
  if (ev.allDay) {
    const days = Math.round((new Date(ev.end).getTime() - new Date(ev.start).getTime()) / DAY);
    return days > 1 ? `Journée entière · ${days} jours` : 'Journée entière';
  }
  return `${timeFmt.format(new Date(ev.start))} – ${timeFmt.format(new Date(ev.end))}`;
}
