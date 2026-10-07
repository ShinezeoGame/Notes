// Jours fériés (calculés, sans connexion) et vacances scolaires françaises (calendrier officiel embarqué), ajoutés
// tout seuls dans l'agenda. Module sans dépendance : les noms affichés et les réglages sont dans agenda.ts.

/** Pays ou région des jours fériés. */
export type HolidayRegion = 'fr' | 'fr-am' | 'fr-gp' | 'fr-mq' | 'fr-gf' | 'fr-re' | 'fr-yt' | 'be' | 'lu' | 'ca-qc' | 'gb' | 'us';

export const HOLIDAY_REGIONS: HolidayRegion[] = ['fr', 'fr-am', 'fr-gp', 'fr-mq', 'fr-gf', 'fr-re', 'fr-yt', 'be', 'lu', 'ca-qc', 'gb', 'us'];

export const isHolidayRegion = (v: unknown): v is HolidayRegion => HOLIDAY_REGIONS.includes(v as HolidayRegion);

export type HolidayName =
  | 'newYear'
  | 'goodFriday'
  | 'easterMonday'
  | 'labour'
  | 'victory'
  | 'ascension'
  | 'whitMonday'
  | 'national'
  | 'assumption'
  | 'allSaints'
  | 'armistice'
  | 'christmas'
  | 'stStephen'
  | 'abolition'
  | 'schoelcher'
  | 'europe'
  | 'luxNational'
  | 'beNational'
  | 'patriots'
  | 'quebecNational'
  | 'canada'
  | 'thanksgivingCa'
  | 'earlyMay'
  | 'springBank'
  | 'summerBank'
  | 'boxing'
  | 'mlk'
  | 'presidents'
  | 'memorial'
  | 'juneteenth'
  | 'independence'
  | 'laborUs'
  | 'columbus'
  | 'veterans'
  | 'thanksgivingUs';

/** Jour férié : date (AAAA-MM-JJ) et nom ; `substitute` : jour de remplacement (Royaume-Uni) ou chômé (États-Unis). */
export type Holiday = { date: string; name: HolidayName; substitute?: boolean };

const DAY = 86_400_000;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
/** Jour de la semaine (0 : dimanche). */
const weekday = (time: number) => new Date(time).getUTCDay();

/** Dimanche de Pâques (calendrier grégorien, méthode de Meeus, Jones et Butcher). */
export function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return utc(year, Math.floor(n / 31), (n % 31) + 1);
}

/** n-ième jour `wd` (0 : dimanche) du mois ; n = -1 : le dernier. */
function nthWeekday(year: number, month: number, wd: number, n: number): number {
  if (n > 0) {
    const first = utc(year, month, 1);
    return first + (((wd - weekday(first) + 7) % 7) + (n - 1) * 7) * DAY;
  }
  const last = utc(year, month + 1, 0);
  return last - ((weekday(last) - wd + 7) % 7) * DAY;
}

/** Jours fériés d'une année. Les jours exceptionnels (jubilé, funérailles nationales…) n'y sont pas. */
export function publicHolidays(region: HolidayRegion, year: number): Holiday[] {
  const e = easter(year);
  const list: [number, HolidayName][] = [];
  const add = (time: number, name: HolidayName) => list.push([time, name]);
  const fixed = (m: number, d: number, name: HolidayName) => add(utc(year, m, d), name);
  const out = (extra: Holiday[] = []): Holiday[] =>
    [...list.map(([time, name]) => ({ date: iso(time), name })), ...extra].sort((x, y) => x.date.localeCompare(y.date));

  if (region.startsWith('fr')) {
    fixed(1, 1, 'newYear');
    if (region === 'fr-am') add(e - 2 * DAY, 'goodFriday');
    add(e + DAY, 'easterMonday');
    fixed(5, 1, 'labour');
    fixed(5, 8, 'victory');
    add(e + 39 * DAY, 'ascension');
    add(e + 50 * DAY, 'whitMonday');
    fixed(7, 14, 'national');
    fixed(8, 15, 'assumption');
    fixed(11, 1, 'allSaints');
    fixed(11, 11, 'armistice');
    fixed(12, 25, 'christmas');
    if (region === 'fr-am') fixed(12, 26, 'stStephen');
    // Commémoration de l'abolition de l'esclavage (décret du 23 novembre 1983), fête de Victor Schœlcher.
    const abolition: Partial<Record<HolidayRegion, [number, number]>> = { 'fr-gp': [5, 27], 'fr-mq': [5, 22], 'fr-gf': [6, 10], 'fr-re': [12, 20], 'fr-yt': [4, 27] };
    const day = abolition[region];
    if (day) fixed(day[0], day[1], 'abolition');
    if (region === 'fr-gp' || region === 'fr-mq') fixed(7, 21, 'schoelcher');
    return out();
  }
  if (region === 'be') {
    fixed(1, 1, 'newYear');
    add(e + DAY, 'easterMonday');
    fixed(5, 1, 'labour');
    add(e + 39 * DAY, 'ascension');
    add(e + 50 * DAY, 'whitMonday');
    fixed(7, 21, 'beNational');
    fixed(8, 15, 'assumption');
    fixed(11, 1, 'allSaints');
    fixed(11, 11, 'armistice');
    fixed(12, 25, 'christmas');
    return out();
  }
  if (region === 'lu') {
    fixed(1, 1, 'newYear');
    add(e + DAY, 'easterMonday');
    fixed(5, 1, 'labour');
    if (year >= 2019) fixed(5, 9, 'europe');
    add(e + 39 * DAY, 'ascension');
    add(e + 50 * DAY, 'whitMonday');
    fixed(6, 23, 'luxNational');
    fixed(8, 15, 'assumption');
    fixed(11, 1, 'allSaints');
    fixed(12, 25, 'christmas');
    fixed(12, 26, 'stStephen');
    return out();
  }
  if (region === 'ca-qc') {
    fixed(1, 1, 'newYear');
    add(e - 2 * DAY, 'goodFriday');
    add(e + DAY, 'easterMonday');
    // Lundi qui précède le 25 mai.
    const may25 = utc(year, 5, 25);
    add(may25 - ((weekday(may25) + 6) % 7 || 7) * DAY, 'patriots');
    fixed(6, 24, 'quebecNational');
    fixed(7, 1, 'canada');
    add(nthWeekday(year, 9, 1, 1), 'labour');
    add(nthWeekday(year, 10, 1, 2), 'thanksgivingCa');
    fixed(12, 25, 'christmas');
    return out();
  }
  if (region === 'gb') {
    // Angleterre et pays de Galles : un jour férié tombé un samedi ou un dimanche est remplacé par le jour ouvré suivant.
    const subs: Holiday[] = [];
    const sub = (time: number, name: HolidayName) => subs.push({ date: iso(time), name, substitute: true });
    const jan1 = utc(year, 1, 1);
    fixed(1, 1, 'newYear');
    if (weekday(jan1) === 6) sub(jan1 + 2 * DAY, 'newYear');
    if (weekday(jan1) === 0) sub(jan1 + DAY, 'newYear');
    add(e - 2 * DAY, 'goodFriday');
    add(e + DAY, 'easterMonday');
    add(nthWeekday(year, 5, 1, 1), 'earlyMay');
    add(nthWeekday(year, 5, 1, -1), 'springBank');
    add(nthWeekday(year, 8, 1, -1), 'summerBank');
    const xmas = utc(year, 12, 25);
    fixed(12, 25, 'christmas');
    fixed(12, 26, 'boxing');
    const wd = weekday(xmas);
    if (wd === 6) {
      sub(xmas + 2 * DAY, 'christmas');
      sub(xmas + 3 * DAY, 'boxing');
    } else if (wd === 0) sub(xmas + 2 * DAY, 'christmas');
    else if (wd === 5) sub(xmas + 3 * DAY, 'boxing');
    return out(subs);
  }
  // États-Unis (jours fériés fédéraux) : chômé le vendredi s'il tombe un samedi, le lundi s'il tombe un dimanche.
  const observed: Holiday[] = [];
  const day = (m: number, d: number, name: HolidayName) => {
    const time = utc(year, m, d);
    add(time, name);
    if (weekday(time) === 6) observed.push({ date: iso(time - DAY), name, substitute: true });
    if (weekday(time) === 0) observed.push({ date: iso(time + DAY), name, substitute: true });
  };
  day(1, 1, 'newYear');
  add(nthWeekday(year, 1, 1, 3), 'mlk');
  add(nthWeekday(year, 2, 1, 3), 'presidents');
  add(nthWeekday(year, 5, 1, -1), 'memorial');
  if (year >= 2021) day(6, 19, 'juneteenth');
  day(7, 4, 'independence');
  add(nthWeekday(year, 9, 1, 1), 'laborUs');
  add(nthWeekday(year, 10, 1, 2), 'columbus');
  day(11, 11, 'veterans');
  add(nthWeekday(year, 11, 4, 4), 'thanksgivingUs');
  day(12, 25, 'christmas');
  return out(observed);
}

/** Pays ou région probable de l'appareil (fuseau horaire, puis langue du navigateur) ; '' : inconnu. */
export function guessRegion(timeZone: string, language: string): HolidayRegion | '' {
  const byZone: Record<string, HolidayRegion> = {
    'Europe/Paris': 'fr',
    'America/Guadeloupe': 'fr-gp',
    'America/Martinique': 'fr-mq',
    'America/Cayenne': 'fr-gf',
    'Indian/Reunion': 'fr-re',
    'Indian/Mayotte': 'fr-yt',
    'Europe/Brussels': 'be',
    'Europe/Luxembourg': 'lu',
    'Europe/London': 'gb',
  };
  if (byZone[timeZone]) return byZone[timeZone];
  const lang = language.toLowerCase();
  const unknown = !timeZone || timeZone === 'UTC' || timeZone.startsWith('Etc/');
  const america = timeZone.startsWith('America/') || timeZone === 'Pacific/Honolulu';
  if (lang === 'fr-ca' && (america || unknown)) return 'ca-qc';
  if (lang === 'en-us' && (america || unknown)) return 'us';
  if (!unknown) return '';
  // Fuseau horaire inconnu (appareil réglé en UTC) : d'après la langue.
  const byLang: Record<string, HolidayRegion> = { fr: 'fr', 'fr-fr': 'fr', 'fr-be': 'be', 'nl-be': 'be', 'fr-lu': 'lu', lb: 'lu', 'en-gb': 'gb' };
  return byLang[lang] ?? '';
}

// Vacances scolaires de France métropolitaine : calendrier officiel du ministère de l'Éducation nationale
// (data.education.gouv.fr, Licence Ouverte), relevé par le jeu de données du paquet vacances-scolaires-france
// (licence MIT, © 2018 Antoine Augusti). À compléter quand le ministère publie les années suivantes.

export type SchoolZone = 'A' | 'B' | 'C';
export const SCHOOL_ZONES: SchoolZone[] = ['A', 'B', 'C'];
export const isSchoolZone = (v: unknown): v is SchoolZone => SCHOOL_ZONES.includes(v as SchoolZone);

export type SchoolBreakName = 'toussaint' | 'noel' | 'hiver' | 'printemps' | 'ete' | 'ascension';

/** [vacances, premier jour, dernier jour (la reprise est le lendemain), zones] */
const SCHOOL_BREAKS: [SchoolBreakName, string, string, string][] = [
  ['toussaint', '2023-10-21', '2023-11-05', 'ABC'],
  ['noel', '2023-12-23', '2024-01-07', 'ABC'],
  ['hiver', '2024-02-10', '2024-02-25', 'C'],
  ['hiver', '2024-02-17', '2024-03-03', 'A'],
  ['hiver', '2024-02-24', '2024-03-10', 'B'],
  ['printemps', '2024-04-06', '2024-04-21', 'C'],
  ['printemps', '2024-04-13', '2024-04-28', 'A'],
  ['printemps', '2024-04-20', '2024-05-05', 'B'],
  ['ete', '2024-07-06', '2024-09-01', 'ABC'],
  ['toussaint', '2024-10-19', '2024-11-03', 'ABC'],
  ['noel', '2024-12-21', '2025-01-05', 'ABC'],
  ['hiver', '2025-02-08', '2025-02-23', 'B'],
  ['hiver', '2025-02-15', '2025-03-02', 'C'],
  ['hiver', '2025-02-22', '2025-03-09', 'A'],
  ['printemps', '2025-04-05', '2025-04-21', 'B'],
  ['printemps', '2025-04-12', '2025-04-27', 'C'],
  ['printemps', '2025-04-19', '2025-05-04', 'A'],
  ['ete', '2025-07-05', '2025-08-31', 'ABC'],
  ['toussaint', '2025-10-18', '2025-11-02', 'ABC'],
  ['noel', '2025-12-20', '2026-01-04', 'ABC'],
  ['hiver', '2026-02-07', '2026-02-22', 'A'],
  ['hiver', '2026-02-14', '2026-03-01', 'B'],
  ['hiver', '2026-02-21', '2026-03-08', 'C'],
  ['printemps', '2026-04-04', '2026-04-19', 'A'],
  ['printemps', '2026-04-11', '2026-04-26', 'B'],
  ['printemps', '2026-04-18', '2026-05-03', 'C'],
  ['ete', '2026-07-04', '2026-08-31', 'ABC'],
  ['toussaint', '2026-10-17', '2026-11-01', 'ABC'],
  ['noel', '2026-12-19', '2027-01-03', 'ABC'],
  ['hiver', '2027-02-06', '2027-02-21', 'C'],
  ['hiver', '2027-02-13', '2027-02-28', 'A'],
  ['hiver', '2027-02-20', '2027-03-07', 'B'],
  ['printemps', '2027-04-03', '2027-04-18', 'C'],
  ['printemps', '2027-04-10', '2027-04-25', 'A'],
  ['printemps', '2027-04-17', '2027-05-02', 'B'],
  ['ascension', '2027-05-06', '2027-05-08', 'ABC'],
  ['ete', '2027-07-03', '2027-08-31', 'ABC'],
  ['toussaint', '2027-10-23', '2027-11-07', 'ABC'],
  ['noel', '2027-12-18', '2028-01-02', 'ABC'],
  ['hiver', '2028-02-05', '2028-02-20', 'B'],
  ['hiver', '2028-02-12', '2028-02-27', 'C'],
  ['hiver', '2028-02-19', '2028-03-05', 'A'],
  ['printemps', '2028-04-08', '2028-04-23', 'B'],
  ['printemps', '2028-04-15', '2028-05-01', 'C'],
  ['printemps', '2028-04-22', '2028-05-08', 'A'],
  ['ascension', '2028-05-26', '2028-05-27', 'ABC'],
  ['ete', '2028-07-04', '2028-08-31', 'ABC'],
];

/** Dernier jour couvert par le calendrier embarqué. */
export const SCHOOL_DATA_UNTIL = SCHOOL_BREAKS[SCHOOL_BREAKS.length - 1][2];

export type SchoolBreak = { name: SchoolBreakName; first: string; last: string };

/** Vacances d'une zone, dans l'ordre. */
export function schoolBreaks(zone: SchoolZone): SchoolBreak[] {
  return SCHOOL_BREAKS.filter(([, , , zones]) => zones.includes(zone)).map(([name, first, last]) => ({ name, first, last }));
}
