// Import d'agenda via l'API Google Calendar (OAuth côté client, Google Identity Services).
import type { CalEvent } from './ics';

type TokenClient = { requestAccessToken: (opts?: { prompt?: string }) => void };
type GoogleAccounts = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        callback: (resp: { access_token?: string; error?: string; error_description?: string }) => void;
        error_callback?: (err: { type?: string; message?: string }) => void;
      }) => TokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

let gisLoading: Promise<void> | null = null;

export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisLoading = null;
        reject(new Error('Impossible de charger la bibliothèque Google.'));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

export async function requestGoogleToken(clientId: string): Promise<string> {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      callback: (resp) => {
        if (resp.access_token) resolve(resp.access_token);
        else reject(new Error(resp.error_description || resp.error || 'Connexion Google refusée.'));
      },
      error_callback: (err) => reject(new Error(err.message || 'Connexion Google annulée.')),
    });
    client.requestAccessToken();
  });
}

export type GoogleCalendar = {
  id: string;
  summary: string;
  summaryOverride?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
};

const DEFAULT_COLOR = '#2383E2';
const MAX_MERGED_EVENTS = 2000;

export function calendarName(cal: GoogleCalendar): string {
  return cal.summaryOverride || cal.summary || cal.id;
}

/** Titre proposé pour un bloc : nom de l'agenda, ou « Mes agendas » s'il y en a plusieurs. */
export function calendarsTitle(cals: GoogleCalendar[]): string {
  if (cals.length === 1) return calendarName(cals[0]);
  return cals.length > 1 ? 'Mes agendas' : '';
}

/** Source d'un bloc agenda : « google:id1,id2… » (un seul identifiant pour les anciens blocs). */
export function googleSource(ids: string[]): string {
  return `google:${ids.map(encodeURIComponent).join(',')}`;
}

export function parseGoogleSource(source: string): string[] {
  if (!source.startsWith('google:')) return [];
  return source
    .slice('google:'.length)
    .split(',')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

/** Réunit les événements de plusieurs agendas : ordre chronologique, sans doublons (invitations présentes dans deux agendas). */
export function mergeCalendarEvents(parts: { cal: GoogleCalendar; events: CalEvent[] }[]): CalEvent[] {
  const seen = new Set<string>();
  const out: CalEvent[] = [];
  for (const { cal, events } of parts) {
    for (const ev of events) {
      const key = `${ev.id}|${ev.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...ev, calendar: calendarName(cal), color: cal.backgroundColor || DEFAULT_COLOR });
    }
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out.slice(0, MAX_MERGED_EVENTS);
}

/** Relit plusieurs agendas (bouton « Actualiser ») ; les agendas devenus inaccessibles sont signalés sans bloquer les autres. */
export async function fetchGoogleCalendarsEvents(
  token: string,
  ids: string[],
): Promise<{ events: CalEvent[]; failed: string[] }> {
  const known = new Map((await listGoogleCalendars(token)).map((c) => [c.id, c] as const));
  const cals = ids.map((id) => known.get(id) ?? { id, summary: id });
  const results = await Promise.allSettled(cals.map((c) => fetchGoogleEvents(token, c.id)));
  const parts: { cal: GoogleCalendar; events: CalEvent[] }[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') parts.push({ cal: cals[i], events: r.value });
    else failed.push(calendarName(cals[i]));
  });
  if (!parts.length) throw results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason ?? new Error('Agenda introuvable.');
  return { events: mergeCalendarEvents(parts), failed };
}

async function gfetch<T>(url: string, token: string): Promise<T> {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Google a répondu ${r.status}`);
  return (await r.json()) as T;
}

export async function listGoogleCalendars(token: string): Promise<GoogleCalendar[]> {
  const data = await gfetch<{ items?: GoogleCalendar[] }>(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250',
    token,
  );
  return (data.items ?? []).sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
}

type GEvent = {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  status?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
};

export async function fetchGoogleEvents(
  token: string,
  calendarId: string,
  opts: { from?: Date; to?: Date; max?: number } = {},
): Promise<CalEvent[]> {
  const from = opts.from ?? new Date(Date.now() - 30 * 86_400_000);
  const to = opts.to ?? new Date(Date.now() + 365 * 86_400_000);
  const max = opts.max ?? 800;
  const out: CalEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gfetch<{ items?: GEvent[]; nextPageToken?: string }>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      token,
    );
    for (const ev of data.items ?? []) {
      if (ev.status === 'cancelled') continue;
      const allDay = Boolean(ev.start.date);
      const start = ev.start.dateTime ?? `${ev.start.date}T00:00:00`;
      const end = ev.end.dateTime ?? `${ev.end.date}T00:00:00`;
      out.push({
        id: ev.id,
        title: ev.summary || '(Sans titre)',
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        allDay,
        location: ev.location || '',
        description: (ev.description || '').slice(0, 600),
        url: ev.htmlLink || '',
      });
      if (out.length >= max) return out;
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}
