// Agendas de l'espace (section Agenda et widgets) : agendas Google ou adresses iCal, avec leur couleur. Liste dans le
// document de l'espace (map « agenda », clé « config ») ; événements de chaque agenda à part (« events:<id> »), pour
// qu'une actualisation ne réécrive pas le reste. S'y ajoutent tout seuls les jours fériés et les vacances scolaires
// (réglages : clé « auto »).
import { useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { dayKey, parseEventsJson, parseIcs, type CalEvent } from './ics';
import { fetchGoogleCalendarsEvents, parseGoogleSource, requestGoogleToken } from './google';
import {
  guessRegion,
  isHolidayRegion,
  isSchoolZone,
  publicHolidays,
  schoolBreaks,
  type HolidayName,
  type HolidayRegion,
  type SchoolBreakName,
  type SchoolZone,
} from './holidays';
import { getSettings } from './settings';
import { newId } from './ids';
import { getLang, t } from './i18n';

export type AgendaCalendar = {
  id: string;
  name: string;
  color: string;
  /** « google:<ids> » (agendas Google choisis) ou adresse iCal. */
  source: string;
  enabled: boolean;
  /** Rappel des événements (server/src/reminders.js) : minutes avant ('0', '10', '30', '60'), « eve » (la veille à 18 h), ou ''. */
  remind?: string;
};

/** Rappels possibles pour les événements d'un agenda. */
export const EVENT_REMINDERS: { id: string; label: string }[] = [
  { id: '', label: t('Pas de rappel') },
  { id: '0', label: t('À l’heure de l’événement') },
  { id: '10', label: t('10 minutes avant') },
  { id: '30', label: t('30 minutes avant') },
  { id: '60', label: t('1 heure avant') },
  { id: 'eve', label: t('La veille à 18 h') },
];

/** `kind` : jour férié ou vacances scolaires (ajoutés tout seuls). */
export type AgendaEvent = CalEvent & { calendarId: string; kind?: 'holiday' | 'school' };

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
      writeCalendars(doc, [...calendars, { id, name: res.title || t('Agenda'), color, source: res.source, enabled: true }]);
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
 * Relit un agenda. iCal : par le serveur Ostal (sans intervention) ; Google : fenêtre de connexion au compte Google
 * (à lancer depuis un clic). Renvoie le nombre d'événements et les agendas Google illisibles.
 */
export async function refreshCalendar(
  doc: Y.Doc,
  cal: AgendaCalendar,
  fetchIcs: ((url: string) => Promise<string>) | null,
): Promise<{ count: number; failed: string[] }> {
  let events: CalEvent[];
  let failed: string[] = [];
  if (!cal.source) throw new Error(t('Agenda importé d’un fichier : importez le fichier à nouveau pour le mettre à jour.'));
  if (isGoogleSource(cal.source)) {
    const clientId = getSettings().googleClientId;
    if (!clientId) throw new Error(t('Renseignez un ID client Google dans les réglages pour actualiser cet agenda.'));
    const token = await requestGoogleToken(clientId);
    ({ events, failed } = await fetchGoogleCalendarsEvents(token, parseGoogleSource(cal.source)));
  } else {
    if (!fetchIcs) throw new Error(t('Un serveur Ostal est nécessaire pour actualiser un agenda iCal.'));
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

// Jours fériés et vacances scolaires ajoutés tout seuls -------------------------------------------------------------

/** Réglages des agendas ajoutés tout seuls (identiques sur tous les appareils de l'espace). */
export type AutoAgenda = {
  /** Jours fériés du pays ou de la région ('' : aucun). */
  holidays: { region: HolidayRegion | ''; enabled: boolean; color: string };
  /** Vacances scolaires de France métropolitaine ('' : zone pas choisie) ; `asked` : proposition déjà refusée. */
  school: { zone: SchoolZone | ''; enabled: boolean; color: string; asked: boolean };
};

export const AUTO_HOLIDAYS = 'auto:holidays';
export const AUTO_SCHOOL = 'auto:school';

/** Pays ou région probable de cet appareil. */
function deviceRegion(): HolidayRegion | '' {
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* fuseau inconnu */
  }
  return guessRegion(zone, navigator.language || (getLang() === 'fr' ? 'fr-FR' : ''));
}

/** Réglages enregistrés, ou devinés tant qu'ils ne le sont pas (jours fériés du pays de l'appareil). */
export function readAuto(doc: Y.Doc): AutoAgenda {
  let raw: { holidays?: Partial<AutoAgenda['holidays']>; school?: Partial<AutoAgenda['school']> } = {};
  try {
    raw = JSON.parse(String(doc.getMap('agenda').get('auto') ?? '{}'));
  } catch {
    /* réglages illisibles : valeurs par défaut */
  }
  const h = raw.holidays ?? {};
  const sc = raw.school ?? {};
  const region = h.region === '' || isHolidayRegion(h.region) ? h.region : deviceRegion();
  return {
    holidays: { region, enabled: h.enabled !== false, color: typeof h.color === 'string' ? h.color : '#e03e3e' },
    school: {
      // Alsace et Moselle : académies de Strasbourg et de Nancy-Metz, toutes deux en zone B.
      zone: sc.zone === '' || isSchoolZone(sc.zone) ? sc.zone : region === 'fr-am' ? 'B' : '',
      enabled: sc.enabled !== false,
      color: typeof sc.color === 'string' ? sc.color : '#2eaf7d',
      asked: Boolean(sc.asked),
    },
  };
}

export function updateAuto(doc: Y.Doc, change: (auto: AutoAgenda) => AutoAgenda) {
  doc.getMap('agenda').set('auto', JSON.stringify(change(readAuto(doc))));
}

/** Nom affiché d'un jour férié. */
export function holidayName(name: HolidayName): string {
  switch (name) {
    case 'newYear':
      return t('Jour de l’an');
    case 'goodFriday':
      return t('Vendredi saint');
    case 'easterMonday':
      return t('Lundi de Pâques');
    case 'labour':
      return t('Fête du Travail');
    case 'victory':
      return t('Victoire 1945');
    case 'ascension':
      return t('Ascension');
    case 'whitMonday':
      return t('Lundi de Pentecôte');
    case 'national':
      return t('Fête nationale');
    case 'assumption':
      return t('Assomption');
    case 'allSaints':
      return t('Toussaint');
    case 'armistice':
      return t('Armistice 1918');
    case 'christmas':
      return t('Noël');
    case 'stStephen':
      return t('Saint-Étienne');
    case 'abolition':
      return t('Abolition de l’esclavage');
    case 'schoelcher':
      return t('Fête de Victor Schœlcher');
    case 'europe':
      return t('Journée de l’Europe');
    case 'luxNational':
      return t('Fête nationale luxembourgeoise');
    case 'beNational':
      return t('Fête nationale belge');
    case 'patriots':
      return t('Journée nationale des patriotes');
    case 'quebecNational':
      return t('Fête nationale du Québec');
    case 'canada':
      return t('Fête du Canada');
    case 'thanksgivingCa':
      return t('Action de grâce');
    case 'earlyMay':
      return t('Jour férié de début mai');
    case 'springBank':
      return t('Jour férié de printemps');
    case 'summerBank':
      return t('Jour férié d’été');
    case 'boxing':
      return t('Lendemain de Noël');
    case 'mlk':
      return t('Journée Martin Luther King');
    case 'presidents':
      return t('Jour des présidents');
    case 'memorial':
      return t('Memorial Day');
    case 'juneteenth':
      return t('Juneteenth');
    case 'independence':
      return t('Fête de l’Indépendance');
    case 'laborUs':
      return t('Labor Day');
    case 'columbus':
      return t('Columbus Day');
    case 'veterans':
      return t('Jour des anciens combattants');
    case 'thanksgivingUs':
      return t('Thanksgiving');
  }
}

/** Nom d'un pays ou d'une région de jours fériés. */
export function regionName(region: HolidayRegion): string {
  switch (region) {
    case 'fr':
      return t('France métropolitaine');
    case 'fr-am':
      return t('Alsace et Moselle');
    case 'fr-gp':
      return t('Guadeloupe');
    case 'fr-mq':
      return t('Martinique');
    case 'fr-gf':
      return t('Guyane');
    case 'fr-re':
      return t('La Réunion');
    case 'fr-yt':
      return t('Mayotte');
    case 'be':
      return t('Belgique');
    case 'lu':
      return t('Luxembourg');
    case 'ca-qc':
      return t('Québec');
    case 'gb':
      return t('Royaume-Uni (Angleterre et pays de Galles)');
    case 'us':
      return t('États-Unis');
  }
}

export function schoolBreakName(name: SchoolBreakName): string {
  switch (name) {
    case 'toussaint':
      return t('Vacances de la Toussaint');
    case 'noel':
      return t('Vacances de Noël');
    case 'hiver':
      return t('Vacances d’hiver');
    case 'printemps':
      return t('Vacances de printemps');
    case 'ete':
      return t('Vacances d’été');
    case 'ascension':
      return t('Pont de l’Ascension');
  }
}

/** Académies de chaque zone de vacances scolaires. */
export function zoneAcademies(zone: SchoolZone): string {
  if (zone === 'A') return t('Académies de Besançon, Bordeaux, Clermont-Ferrand, Dijon, Grenoble, Limoges, Lyon et Poitiers');
  if (zone === 'B')
    return t('Académies d’Aix-Marseille, Amiens, Lille, Nancy-Metz, Nantes, Nice, Normandie, Orléans-Tours, Reims, Rennes et Strasbourg');
  return t('Académies de Créteil, Montpellier, Paris, Toulouse et Versailles');
}

/** Minuit (heure de l'appareil) d'un jour AAAA-MM-JJ, décalé de `plus` jours, en ISO. */
function localDay(key: string, plus = 0): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d + plus).toISOString();
}

/** Jours fériés (de l'an dernier à dans deux ans) et vacances scolaires, selon les réglages. */
export function autoEvents(auto: AutoAgenda, year = new Date().getFullYear()): AgendaEvent[] {
  const events: AgendaEvent[] = [];
  const { holidays, school } = auto;
  if (holidays.enabled && holidays.region) {
    const calendar = t('Jours fériés');
    for (let y = year - 1; y <= year + 2; y++) {
      for (const h of publicHolidays(holidays.region, y)) {
        const name = holidayName(h.name);
        events.push({
          id: `${AUTO_HOLIDAYS}:${h.date}:${h.name}${h.substitute ? ':sub' : ''}`,
          title: h.substitute ? (holidays.region === 'us' ? t('{name} (chômé)', { name }) : t('{name} (jour de remplacement)', { name })) : name,
          start: localDay(h.date),
          end: localDay(h.date, 1),
          allDay: true,
          location: '',
          description: '',
          url: '',
          calendar,
          color: holidays.color,
          calendarId: AUTO_HOLIDAYS,
          kind: 'holiday',
        });
      }
    }
  }
  if (school.enabled && school.zone) {
    const calendar = t('Vacances scolaires · zone {zone}', { zone: school.zone });
    for (const b of schoolBreaks(school.zone)) {
      events.push({
        id: `${AUTO_SCHOOL}:${school.zone}:${b.first}`,
        title: schoolBreakName(b.name),
        start: localDay(b.first),
        end: localDay(b.last, 1),
        allDay: true,
        location: '',
        description: '',
        url: '',
        calendar,
        color: school.color,
        calendarId: AUTO_SCHOOL,
        kind: 'school',
      });
    }
  }
  return events;
}

/** Agendas de l'espace et leurs événements réunis (agendas masqués exclus), jours fériés et vacances compris. */
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
    if (!doc) return { calendars: [] as AgendaCalendar[], events: [] as AgendaEvent[], updatedAt: 0, auto: null };
    const calendars = readCalendars(doc);
    const auto = readAuto(doc);
    const events: AgendaEvent[] = autoEvents(auto);
    let updatedAt = 0;
    for (const cal of calendars) {
      const stored = readEvents(doc, cal.id);
      updatedAt = Math.max(updatedAt, stored.updatedAt);
      if (!cal.enabled) continue;
      for (const ev of stored.events) events.push({ ...ev, calendarId: cal.id, color: ev.color || cal.color, calendar: ev.calendar || cal.name });
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    return { calendars, events, updatedAt, auto };
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
