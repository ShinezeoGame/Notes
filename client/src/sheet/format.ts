// Tableur : formats de nombre (codes Excel : « #,##0.00 », « 0% », « dd/mm/yyyy »…), dates (numéros de série Excel :
// jours depuis le 30/12/1899), lecture de ce que l'on tape dans une cellule et texte proposé pour la modifier.
import type { Lang } from '../lib/i18n';
import { delocalizeFormula, displayError, localizeFormula } from './formula';
import { isError, isFormula, storeText, textOf, type CellValue, type Scalar } from './values';

// ---------- Dates ----------

const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Numéro de série Excel d'une date (année, mois 1-12, jour) et d'une heure ; mois et jours débordants acceptés. */
export function toSerial(y: number, m: number, d: number, h = 0, mi = 0, s = 0): number {
  return (Date.UTC(y, m - 1, d, h, mi, s) - EPOCH) / DAY_MS;
}

/** Parties d'un numéro de série (date et heure, à la seconde près). */
export function fromSerial(serial: number): { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number } {
  let days = Math.floor(serial);
  let secs = Math.round((serial - days) * 86_400);
  if (secs >= 86_400) {
    days += 1;
    secs -= 86_400;
  }
  const dt = new Date(EPOCH + days * DAY_MS);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    h: Math.floor(secs / 3600),
    mi: Math.floor((secs % 3600) / 60),
    s: secs % 60,
    wd: dt.getUTCDay(),
  };
}

/** Date et heure locales actuelles en numéro de série. */
export function nowSerial(now = new Date()): number {
  return toSerial(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
}

const localeOf = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-GB');

const nameCache = new Map<string, string[]>();
function names(lang: Lang, kind: 'month' | 'weekday', width: 'long' | 'short'): string[] {
  const key = `${lang}|${kind}|${width}`;
  let list = nameCache.get(key);
  if (!list) {
    const fmt = new Intl.DateTimeFormat(localeOf(lang), { [kind]: width, timeZone: 'UTC' });
    list =
      kind === 'month'
        ? Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2021, i, 1))))
        : Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2021, 0, 3 + i))));
    nameCache.set(key, list);
  }
  return list;
}

/** Noms des mois et des jours (recopie de séries : janvier, février…). */
export const monthNames = (lang: Lang, width: 'long' | 'short' = 'long'): string[] => names(lang, 'month', width);
export const dayNames = (lang: Lang, width: 'long' | 'short' = 'long'): string[] => names(lang, 'weekday', width);

// ---------- Nombres ----------

const decimalSep = (lang: Lang) => (lang === 'fr' ? ',' : '.');
const groupSep = (lang: Lang) => (lang === 'fr' ? ' ' : ',');

/** Arrondi d'affichage à `d` décimales (corrige 1.005 → 1.01). */
export function roundTo(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(Number((x * f).toPrecision(15))) / f;
}

function group(intDigits: string, lang: Lang): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep(lang));
}

/** Nombre au format « Standard » d'Excel : 10 chiffres significatifs au plus, sans séparateur de milliers. */
export function generalNumber(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return displayError('#NUM!', lang);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1e11 || abs < 1e-9) {
    const [mant, exp] = n.toExponential(5).split('e');
    s = `${mant.replace(/\.?0+$/, '')}E${Number(exp) < 0 ? '-' : '+'}${String(Math.abs(Number(exp))).padStart(2, '0')}`;
  } else {
    s = Number(n.toPrecision(abs >= 1 ? 11 : 10))
      .toFixed(10)
      .replace(/\.?0+$/, '');
  }
  return s.replace('.', decimalSep(lang));
}

/** Nombre complet (15 chiffres significatifs) pour le modifier dans la barre de formule. */
function editNumber(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const s =
    abs !== 0 && (abs >= 1e15 || abs < 1e-9)
      ? n
          .toPrecision(15)
          .replace(/\.?0+e/, 'e')
          .toUpperCase()
      : String(Number(n.toPrecision(15)));
  return s.replace('.', decimalSep(lang));
}

// ---------- Codes de format ----------

type Part =
  | { t: 'lit'; s: string }
  | { t: 'ph'; c: '0' | '#' | '?' }
  | { t: 'dot' }
  | { t: 'comma' }
  | { t: 'pct' }
  | { t: 'exp'; sign: '+' | '-' }
  | { t: 'text' }
  | { t: 'date'; s: string };

type Section = { parts: Part[]; color?: string; date: boolean };

const COLORS: Record<string, string> = {
  red: '#d32f2f',
  rouge: '#d32f2f',
  blue: '#1e66d0',
  bleu: '#1e66d0',
  green: '#2e7d32',
  vert: '#2e7d32',
  magenta: '#c2185b',
  cyan: '#00838f',
  yellow: '#b58900',
  jaune: '#b58900',
};

/** Découpe une section de code de format en parties (littéraux, chiffres, dates…). */
function parseSection(src: string): Section {
  const parts: Part[] = [];
  let color: string | undefined;
  const lit = (s: string) => {
    const last = parts[parts.length - 1];
    if (last && last.t === 'lit') last.s += s;
    else parts.push({ t: 'lit', s });
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      lit(src.slice(i + 1, end < 0 ? src.length : end));
      i = end < 0 ? src.length : end + 1;
    } else if (ch === '\\') {
      lit(src[i + 1] ?? '');
      i += 2;
    } else if (ch === '_') {
      lit(' ');
      i += 2;
    } else if (ch === '*') {
      i += 2;
    } else if (ch === '[') {
      const end = src.indexOf(']', i);
      const inner = src.slice(i + 1, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end + 1;
      if (COLORS[inner.toLowerCase()]) color = COLORS[inner.toLowerCase()];
      else if (inner.startsWith('$')) lit(inner.slice(1).split('-')[0]);
      else if (/^(h+|m+|s+)$/i.test(inner)) parts.push({ t: 'date', s: `[${inner.toLowerCase()}]` });
    } else if (/^(AM\/PM|A\/P)/i.test(rest)) {
      const m = /^(AM\/PM|A\/P)/i.exec(rest)!;
      parts.push({ t: 'date', s: m[0].toUpperCase() });
      i += m[0].length;
    } else if (/[yYdD]/.test(ch) || /[hH]/.test(ch) || /[sS]/.test(ch) || /[mM]/.test(ch)) {
      const m = /^([yY]+|[dD]+|[hH]+|[sS]+|[mM]+)/.exec(rest)!;
      parts.push({ t: 'date', s: m[0].toLowerCase() });
      i += m[0].length;
    } else if (ch === '0' || ch === '#' || ch === '?') {
      parts.push({ t: 'ph', c: ch });
      i++;
    } else if (ch === '.') {
      parts.push({ t: 'dot' });
      i++;
    } else if (ch === ',') {
      parts.push({ t: 'comma' });
      i++;
    } else if (ch === '%') {
      parts.push({ t: 'pct' });
      i++;
    } else if ((ch === 'E' || ch === 'e') && (src[i + 1] === '+' || src[i + 1] === '-')) {
      parts.push({ t: 'exp', sign: src[i + 1] as '+' | '-' });
      i += 2;
    } else if (ch === '@') {
      parts.push({ t: 'text' });
      i++;
    } else {
      lit(ch);
      i++;
    }
  }
  const date = parts.some((p) => p.t === 'date') && !parts.some((p) => p.t === 'ph' && p.c !== '0');
  return { parts, color, date };
}

/** Sections d'un code (« positif;négatif;zéro;texte »), en cache. */
const formatCache = new Map<string, Section[]>();
function compile(code: string): Section[] {
  let sections = formatCache.get(code);
  if (sections) return sections;
  const raw: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') quoted = !quoted;
    if (ch === '\\' && !quoted) {
      cur += ch + (code[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === ';' && !quoted) {
      raw.push(cur);
      cur = '';
    } else cur += ch;
  }
  raw.push(cur);
  sections = raw.map(parseSection);
  if (formatCache.size > 500) formatCache.clear();
  formatCache.set(code, sections);
  return sections;
}

const isGeneral = (code: string | undefined): boolean => !code || /^general$|^standard$/i.test(code.trim());

/** Vrai si le code affiche une date ou une heure. */
export function isDateFormat(code: string | undefined): boolean {
  return !isGeneral(code) && compile(code!)[0].date;
}

/** Vrai si le code n'affiche qu'une heure (pas de jour, de mois ni d'année). */
export function isTimeFormat(code: string | undefined): boolean {
  if (!isDateFormat(code)) return false;
  return !compile(code!)[0].parts.some((p) => p.t === 'date' && /^[ymd]/.test(p.s));
}

export const isPercentFormat = (code: string | undefined): boolean =>
  !isGeneral(code) && !isDateFormat(code) && compile(code!)[0].parts.some((p) => p.t === 'pct');

export const isTextFormat = (code: string | undefined): boolean => !!code && code.trim() === '@';

function formatDate(serial: number, sec: Section, lang: Lang): string {
  if (serial < 0) return '#'.repeat(8);
  const dt = fromSerial(serial);
  const dateParts = sec.parts.filter((p): p is { t: 'date'; s: string } => p.t === 'date');
  const ampm = dateParts.some((p) => p.s === 'AM/PM' || p.s === 'A/P');
  let out = '';
  // Lettre d'une partie de date, sans les crochets des durées (« [h] » → h).
  const letter = (s: string | undefined) => (s ? s.replace(/[[\]]/g, '')[0] : '');
  sec.parts.forEach((p) => {
    if (p.t === 'lit') out += p.s;
    else if (p.t === 'ph') out += p.c === '0' ? '0' : '';
    else if (p.t === 'dot') out += decimalSep(lang);
    else if (p.t === 'date') {
      const s = p.s;
      const prevDate = dateParts[dateParts.indexOf(p) - 1];
      const nextDate = dateParts[dateParts.indexOf(p) + 1];
      // « m » : minutes après une heure ou avant des secondes, sinon mois.
      const minutes = s[0] === 'm' && s.length <= 2 && (letter(prevDate?.s) === 'h' || letter(nextDate?.s) === 's');
      if (s === '[h]' || s === '[hh]') out += String(Math.floor(serial * 24)).padStart(s.length - 2, '0');
      else if (s === '[m]' || s === '[mm]') out += String(Math.floor(serial * 1440)).padStart(s.length - 2, '0');
      else if (s === '[s]' || s === '[ss]') out += String(Math.round(serial * 86400)).padStart(s.length - 2, '0');
      else if (s[0] === 'y') out += s.length <= 2 ? String(dt.y % 100).padStart(2, '0') : String(dt.y);
      else if (minutes) out += s.length === 2 ? String(dt.mi).padStart(2, '0') : String(dt.mi);
      else if (s[0] === 'm') {
        if (s.length === 1) out += String(dt.m);
        else if (s.length === 2) out += String(dt.m).padStart(2, '0');
        else if (s.length === 3) out += monthNames(lang, 'short')[dt.m - 1];
        else if (s.length === 5) out += monthNames(lang, 'long')[dt.m - 1][0];
        else out += monthNames(lang, 'long')[dt.m - 1];
      } else if (s[0] === 'd') {
        if (s.length === 1) out += String(dt.d);
        else if (s.length === 2) out += String(dt.d).padStart(2, '0');
        else if (s.length === 3) out += dayNames(lang, 'short')[dt.wd];
        else out += dayNames(lang, 'long')[dt.wd];
      } else if (s[0] === 'h') {
        const h = ampm ? ((dt.h + 11) % 12) + 1 : dt.h;
        out += s.length >= 2 ? String(h).padStart(2, '0') : String(h);
      } else if (s[0] === 's') {
        out += s.length >= 2 ? String(dt.s).padStart(2, '0') : String(dt.s);
      } else if (s === 'AM/PM') out += dt.h < 12 ? 'AM' : 'PM';
      else if (s === 'A/P') out += dt.h < 12 ? 'A' : 'P';
    }
  });
  return out;
}

function formatNumberSection(abs: number, sec: Section, lang: Lang): string {
  const parts = sec.parts;
  const phIdx = parts.map((p, i) => (p.t === 'ph' ? i : -1)).filter((i) => i >= 0);
  const pct = parts.filter((p) => p.t === 'pct').length;
  let value = abs * 100 ** pct;
  if (!phIdx.length) {
    // Aucun chiffre dans le code (« "Gratuit" ») : seulement le texte.
    return parts.map((p) => (p.t === 'lit' ? p.s : p.t === 'pct' ? '%' : '')).join('');
  }
  const first = phIdx[0];
  const last = phIdx[phIdx.length - 1];
  const expAt = parts.findIndex((p) => p.t === 'exp');
  const numEnd = expAt >= 0 ? expAt : last + 1;
  const dotAt = parts.findIndex((p, i) => p.t === 'dot' && i > first - 1 && i < numEnd);
  const intParts = parts.slice(first, dotAt >= 0 ? dotAt : numEnd);
  const fracParts = dotAt >= 0 ? parts.slice(dotAt + 1, numEnd) : [];
  // Virgules après le dernier chiffre de la partie entière : division par 1000.
  let scale = 0;
  for (let i = (dotAt >= 0 ? dotAt : numEnd) - 1; i >= first && parts[i].t === 'comma'; i--) scale++;
  value /= 1000 ** scale;
  const thousands = intParts.some((p, i) => p.t === 'comma' && intParts.slice(i + 1).some((q) => q.t === 'ph'));
  const fracPh = fracParts.filter((p): p is { t: 'ph'; c: '0' | '#' | '?' } => p.t === 'ph');
  let exponent = 0;
  if (expAt >= 0) {
    const intCount = Math.max(1, intParts.filter((p) => p.t === 'ph').length);
    if (value !== 0) {
      exponent = Math.floor(Math.log10(value)) - (intCount - 1);
      value /= 10 ** exponent;
    }
  }
  const rounded = roundTo(value, fracPh.length);
  const [intStr, fracStr = ''] = rounded.toFixed(fracPh.length).split('.');
  // Partie entière : chiffres placés de droite à gauche dans les « 0 # ? » (avec leurs séparateurs éventuels).
  let intOut = '';
  const intPh = intParts.filter((p) => p.t === 'ph');
  if (thousands || intParts.every((p) => p.t === 'ph' || p.t === 'comma')) {
    const minDigits = intPh.filter((p) => p.t === 'ph' && p.c === '0').length;
    let digits = intStr === '0' && minDigits === 0 ? '' : intStr.padStart(minDigits, '0');
    if (thousands) digits = group(digits, lang);
    intOut = digits;
  } else {
    let d = intStr === '0' ? '' : intStr;
    const out: string[] = [];
    for (let i = intParts.length - 1; i >= 0; i--) {
      const p = intParts[i];
      if (p.t === 'ph') {
        const isFirstPh = intParts.slice(0, i).every((q) => q.t !== 'ph');
        if (isFirstPh) {
          out.unshift(d || (p.c === '0' ? '0' : p.c === '?' ? ' ' : ''));
          d = '';
        } else {
          const digit = d.slice(-1);
          d = d.slice(0, -1);
          out.unshift(digit || (p.c === '0' ? '0' : p.c === '?' ? ' ' : ''));
        }
      } else if (p.t === 'lit') out.unshift(d || intParts.slice(0, i).some((q) => q.t === 'ph' && q.c === '0') ? p.s : '');
    }
    intOut = out.join('');
  }
  // Partie décimale : « 0 » toujours affiché, « # » sans les zéros de fin, « ? » remplacé par une espace.
  let frac = '';
  for (let i = 0; i < fracPh.length; i++) frac += fracStr[i] ?? '0';
  let end = frac.length;
  while (end > 0 && fracPh[end - 1].c !== '0' && frac[end - 1] === '0') end--;
  frac =
    frac.slice(0, end) +
    fracPh
      .slice(end)
      .map((p) => (p.c === '?' ? ' ' : ''))
      .join('');
  let num = intOut + (dotAt >= 0 && (frac.trim() || fracPh.some((p) => p.c === '0')) ? decimalSep(lang) + frac : '');
  if (expAt >= 0) {
    const expPh = parts.slice(expAt + 1).filter((p) => p.t === 'ph').length;
    const sign = exponent < 0 ? '-' : (parts[expAt] as { sign: string }).sign === '+' ? '+' : '';
    num += `E${sign}${String(Math.abs(exponent)).padStart(expPh, '0')}`;
  }
  const lits = (from: number, to: number) =>
    parts
      .slice(from, to)
      .map((p) => (p.t === 'lit' ? p.s : p.t === 'pct' ? '%' : ''))
      .join('');
  const afterNum = expAt >= 0 ? parts.length : last + 1;
  return lits(0, first) + num + lits(afterNum, parts.length).replace(/^[0#?]+/, '');
}

/** Nombre mis en forme selon un code Excel ; `color` : couleur demandée par le code ([Rouge]…). */
export function formatNumber(n: number, code: string | undefined, lang: Lang): { text: string; color?: string } {
  if (!Number.isFinite(n)) return { text: displayError('#NUM!', lang) };
  if (isGeneral(code) || isTextFormat(code)) return { text: generalNumber(n, lang) };
  const sections = compile(code!);
  let sec = sections[0];
  let abs = n;
  let sign = '';
  if (n < 0 && sections.length >= 2 && sections[1].parts.length) {
    sec = sections[1];
    abs = -n;
  } else if (n === 0 && sections.length >= 3 && sections[2].parts.length) {
    sec = sections[2];
  } else if (n < 0) {
    abs = -n;
    sign = sec.date ? '' : '-';
  }
  if (sec.date) return { text: formatDate(n, sec, lang), color: sec.color };
  const text = formatNumberSection(abs, sec, lang);
  // « -0,00 » : pas de signe pour une valeur arrondie à zéro.
  return { text: sign && /[1-9]/.test(text) ? sign + text : text, color: sec.color };
}

/** Valeur calculée affichée dans la cellule. */
export function formatValue(v: Scalar, code: string | undefined, lang: Lang): { text: string; color?: string } {
  if (v === null) return { text: '' };
  if (isError(v)) return { text: displayError(v.error, lang) };
  if (typeof v === 'boolean') return { text: v ? (lang === 'fr' ? 'VRAI' : 'TRUE') : lang === 'fr' ? 'FAUX' : 'FALSE' };
  if (typeof v === 'number') return formatNumber(v, code, lang);
  const sections = code && !isGeneral(code) ? compile(code) : null;
  const textSec = sections?.[3] ?? (sections && sections.length === 1 && sections[0].parts.some((p) => p.t === 'text') ? sections[0] : null);
  if (textSec) return { text: textSec.parts.map((p) => (p.t === 'lit' ? p.s : p.t === 'text' ? v : '')).join(''), color: textSec.color };
  return { text: v };
}

/**
 * Code de format écrit à la française (fonction TEXTE d'Excel en français : « # ##0,00 », « jj/mm/aaaa ») → écriture
 * anglaise utilisée ici (« #,##0.00 », « dd/mm/yyyy »).
 */
export function delocalizeFormatCode(code: string, lang: Lang): string {
  if (lang !== 'fr') return code;
  let out = '';
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') quoted = !quoted;
    if (quoted || ch === '"') {
      out += ch;
      continue;
    }
    if (ch === '\\' || ch === '[') {
      const end = ch === '[' ? code.indexOf(']', i) : i + 1;
      out += code.slice(i, end < 0 ? code.length : end + 1);
      i = end < 0 ? code.length : end;
      continue;
    }
    const rest = code.slice(i);
    const m = /^(AM\/PM|A\/P)/i.exec(rest);
    if (m) {
      out += m[0];
      i += m[0].length - 1;
      continue;
    }
    if (ch === ',') out += '.';
    else if (ch === '.') out += ',';
    else if (ch === ' ' && /[#0]/.test(code[i - 1] ?? '') && /[#0]/.test(code[i + 1] ?? '')) out += ',';
    else if (ch === 'j' || ch === 'J') out += 'd';
    else if (ch === 'a' || ch === 'A') out += 'y';
    else out += ch;
  }
  return out;
}

// ---------- Formats proposés ----------

export const FORMATS = {
  number: '#,##0.00',
  integer: '#,##0',
  percent: '0%',
  date: 'dd/mm/yyyy',
  time: 'hh:mm',
  datetime: 'dd/mm/yyyy hh:mm',
  text: '@',
} as const;

/** Format monétaire en euros, comme Excel dans la langue de l'interface. */
export const currencyFormat = (lang: Lang, symbol = '€'): string =>
  lang === 'fr' || symbol === '€' ? `#,##0.00 "${symbol}"` : `"${symbol}"#,##0.00`;

/** Une décimale de plus ou de moins (boutons « ,00 »). */
export function adjustDecimals(code: string | undefined, delta: number, sample: number | null, lang: Lang): string | undefined {
  if (isDateFormat(code)) return code;
  if (isGeneral(code)) {
    const shown = sample === null ? '' : generalNumber(sample, lang);
    const decimals = Math.max(0, (shown.split(decimalSep(lang))[1]?.length ?? 0) + delta);
    return decimals ? `0.${'0'.repeat(decimals)}` : '0';
  }
  let out = '';
  let quoted = false;
  let done = false;
  for (let i = 0; i < code!.length; i++) {
    const ch = code![i];
    if (ch === '"') quoted = !quoted;
    if (!done && !quoted && ch === '.' && /[0#]/.test(code![i + 1] ?? '')) {
      let j = i + 1;
      while (/[0#?]/.test(code![j] ?? '')) j++;
      const count = Math.max(0, j - i - 1 + delta);
      out += count ? `.${'0'.repeat(count)}` : '';
      i = j - 1;
      done = true;
      continue;
    }
    out += ch;
  }
  if (!done && delta > 0) {
    // Pas encore de décimales : « .0 » après le dernier chiffre de la première section.
    const m = /^(.*[0#])([^0#]*)$/.exec(out.split(';')[0]);
    if (m) return [m[1] + '.0' + m[2], ...out.split(';').slice(1)].join(';');
  }
  return out;
}

// ---------- Saisie ----------

const SPACES = /[\s   ]/g;

/** Nombre écrit dans la langue de l'interface (« 1 234,5 », « 1,234.5 », « 2.5 ») ; null sinon. */
export function parseLocaleNumber(s: string, lang: Lang): number | null {
  const t = s.trim();
  if (lang === 'fr') {
    if (/^[+-]?\d{1,3}([\s   ]\d{3})+([,.]\d+)?$/.test(t) || /^[+-]?\d+([,.]\d+)?([eE][+-]?\d+)?$/.test(t) || /^[+-]?[,.]\d+$/.test(t))
      return Number(t.replace(SPACES, '').replace(',', '.'));
    return null;
  }
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  return null;
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Ce que l'on a tapé dans une cellule : valeur à enregistrer et format à appliquer s'il n'y en a pas déjà un
 * (pourcentage, monnaie, date, heure), comme Excel.
 */
export function parseInput(input: string, lang: Lang): { value: CellValue; format?: string } {
  if (input === '') return { value: null };
  if (input.startsWith('=') && input.length > 1) return { value: delocalizeFormula(input, lang) };
  if (input.startsWith("'")) return { value: storeText(input.slice(1)) };
  const t = input.trim();
  if (/^(true|vrai)$/i.test(t)) return { value: true };
  if (/^(false|faux)$/i.test(t)) return { value: false };
  const n = parseLocaleNumber(t, lang);
  if (n !== null && Number.isFinite(n)) return { value: n };
  let m = /^(.+?)\s*%$/.exec(t);
  if (m) {
    const p = parseLocaleNumber(m[1], lang);
    if (p !== null) {
      const decimals = (m[1].split(/[,.]/)[1] ?? '').length;
      return { value: roundTo(p / 100, decimals + 2 + 6), format: decimals ? `0.${'0'.repeat(Math.min(decimals, 4))}%` : '0%' };
    }
  }
  m = /^(-?)\s*([€$£])\s*(.+)$/.exec(t) ?? /^(-?)(.+?)\s*([€$£])$/.exec(t);
  if (m) {
    const symbol = /[€$£]/.exec(t)![0];
    const amount = parseLocaleNumber(m[2] === symbol ? m[3] : m[2], lang);
    if (amount !== null) return { value: m[1] === '-' ? -amount : amount, format: currencyFormat(lang, symbol) };
  }
  // Dates : jour/mois/année (français et anglais britannique), ou année-mois-jour ; heure facultative.
  const time = (h?: string, mi?: string, s?: string) => (h ? (Number(h) * 3600 + Number(mi) * 60 + Number(s ?? 0)) / 86400 : 0);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) {
    let y = Number(m[3]);
    if (m[3].length === 2) y += y < 30 ? 2000 : 1900;
    if (validDate(y, Number(m[2]), Number(m[1])) && (!m[4] || (Number(m[4]) < 24 && Number(m[5]) < 60)))
      return { value: toSerial(y, Number(m[2]), Number(m[1])) + time(m[4], m[5], m[6]), format: m[4] ? FORMATS.datetime : FORMATS.date };
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m && validDate(Number(m[1]), Number(m[2]), Number(m[3])))
    return { value: toSerial(Number(m[1]), Number(m[2]), Number(m[3])) + time(m[4], m[5], m[6]), format: m[4] ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd' };
  m = /^(\d{1,2})\/(\d{1,2})$/.exec(t);
  if (m) {
    const y = new Date().getFullYear();
    if (validDate(y, Number(m[2]), Number(m[1]))) return { value: toSerial(y, Number(m[2]), Number(m[1])), format: FORMATS.date };
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3] ?? 0) < 60)
    return { value: time(m[1], m[2], m[3]), format: m[3] ? 'hh:mm:ss' : FORMATS.time };
  return { value: storeText(input) };
}

/** Texte proposé pour modifier une cellule (barre de formule, double-clic). */
export function editText(v: CellValue, code: string | undefined, lang: Lang): string {
  if (v === null) return '';
  if (isFormula(v)) return localizeFormula(v, lang);
  if (typeof v === 'boolean') return v ? (lang === 'fr' ? 'VRAI' : 'TRUE') : lang === 'fr' ? 'FAUX' : 'FALSE';
  if (typeof v === 'number') {
    if (isPercentFormat(code)) return `${editNumber(roundTo(v * 100, 10), lang)}%`;
    if (isDateFormat(code) && v >= 0) {
      const dt = fromSerial(v);
      const time = `${String(dt.h).padStart(2, '0')}:${String(dt.mi).padStart(2, '0')}${dt.s ? `:${String(dt.s).padStart(2, '0')}` : ''}`;
      if (isTimeFormat(code)) return time;
      const date = `${String(dt.d).padStart(2, '0')}/${String(dt.m).padStart(2, '0')}/${dt.y}`;
      return dt.h || dt.mi || dt.s ? `${date} ${time}` : date;
    }
    return editNumber(v, lang);
  }
  const text = textOf(v);
  const parsed = parseInput(text, lang);
  return typeof parsed.value === 'string' && !isFormula(parsed.value) && textOf(parsed.value) === text ? text : `'${text}`;
}
