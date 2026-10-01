// Tableur : formules. Une formule est enregistrée comme dans un fichier Excel (« =SUM(A1:A3,2.5) » : noms anglais,
// virgule entre les arguments, point décimal) ; l'interface l'affiche et la reçoit dans sa langue (« =SOMME(A1:A3;2,5) »
// en français). Ce module découpe, analyse et traduit les formules, et décale leurs références (recopie, lignes ou
// colonnes insérées ou supprimées, feuille renommée ou supprimée).
import type { Lang } from '../lib/i18n';
import { MAX_COLS, MAX_ROWS, colIndex, colName } from './address';

// ---------- Noms des fonctions ----------

/** Nom français des fonctions dont le nom change (Excel en français) ; les autres gardent leur nom anglais. */
export const FR_NAMES: Record<string, string> = {
  SUM: 'SOMME',
  AVERAGE: 'MOYENNE',
  COUNT: 'NB',
  COUNTA: 'NBVAL',
  COUNTBLANK: 'NB.VIDE',
  COUNTIF: 'NB.SI',
  COUNTIFS: 'NB.SI.ENS',
  SUMIF: 'SOMME.SI',
  SUMIFS: 'SOMME.SI.ENS',
  AVERAGEIF: 'MOYENNE.SI',
  AVERAGEIFS: 'MOYENNE.SI.ENS',
  MAXIFS: 'MAX.SI.ENS',
  MINIFS: 'MIN.SI.ENS',
  PRODUCT: 'PRODUIT',
  MEDIAN: 'MEDIANE',
  STDEV: 'ECARTYPE',
  STDEVP: 'ECARTYPEP',
  'STDEV.S': 'ECARTYPE.STANDARD',
  'STDEV.P': 'ECARTYPE.PEARSON',
  LARGE: 'GRANDE.VALEUR',
  SMALL: 'PETITE.VALEUR',
  RANK: 'RANG',
  IF: 'SI',
  IFS: 'SI.CONDITIONS',
  IFERROR: 'SIERREUR',
  IFNA: 'SI.NON.DISP',
  SWITCH: 'SI.MULTIPLE',
  AND: 'ET',
  OR: 'OU',
  NOT: 'NON',
  XOR: 'OUX',
  TRUE: 'VRAI',
  FALSE: 'FAUX',
  ROUND: 'ARRONDI',
  ROUNDUP: 'ARRONDI.SUP',
  ROUNDDOWN: 'ARRONDI.INF',
  MROUND: 'ARRONDI.AU.MULTIPLE',
  INT: 'ENT',
  TRUNC: 'TRONQUE',
  SQRT: 'RACINE',
  POWER: 'PUISSANCE',
  SIGN: 'SIGNE',
  CEILING: 'PLAFOND',
  FLOOR: 'PLANCHER',
  RAND: 'ALEA',
  RANDBETWEEN: 'ALEA.ENTRE.BORNES',
  SUMPRODUCT: 'SOMMEPROD',
  CONCATENATE: 'CONCATENER',
  TEXTJOIN: 'JOINDRE.TEXTE',
  LEFT: 'GAUCHE',
  RIGHT: 'DROITE',
  MID: 'STXT',
  LEN: 'NBCAR',
  UPPER: 'MAJUSCULE',
  LOWER: 'MINUSCULE',
  PROPER: 'NOMPROPRE',
  TRIM: 'SUPPRESPACE',
  SUBSTITUTE: 'SUBSTITUE',
  REPLACE: 'REMPLACER',
  FIND: 'TROUVE',
  SEARCH: 'CHERCHE',
  VALUE: 'CNUM',
  TEXT: 'TEXTE',
  CHAR: 'CAR',
  TODAY: 'AUJOURDHUI',
  NOW: 'MAINTENANT',
  YEAR: 'ANNEE',
  MONTH: 'MOIS',
  DAY: 'JOUR',
  WEEKDAY: 'JOURSEM',
  WEEKNUM: 'NO.SEMAINE',
  HOUR: 'HEURE',
  SECOND: 'SECONDE',
  TIME: 'TEMPS',
  DAYS: 'JOURS',
  EDATE: 'MOIS.DECALER',
  EOMONTH: 'FIN.MOIS',
  NETWORKDAYS: 'NB.JOURS.OUVRES',
  WORKDAY: 'SERIE.JOUR.OUVRE',
  VLOOKUP: 'RECHERCHEV',
  HLOOKUP: 'RECHERCHEH',
  XLOOKUP: 'RECHERCHEX',
  MATCH: 'EQUIV',
  CHOOSE: 'CHOISIR',
  ROW: 'LIGNE',
  COLUMN: 'COLONNE',
  ROWS: 'LIGNES',
  COLUMNS: 'COLONNES',
  ISBLANK: 'ESTVIDE',
  ISNUMBER: 'ESTNUM',
  ISTEXT: 'ESTTEXTE',
  ISERROR: 'ESTERREUR',
  ISERR: 'ESTERR',
  ISNA: 'ESTNA',
  ISLOGICAL: 'ESTLOGIQUE',
  PMT: 'VPM',
  FV: 'VC',
  PV: 'VA',
  NPV: 'VAN',
};

const EN_NAMES: Record<string, string> = Object.fromEntries(Object.entries(FR_NAMES).map(([en, fr]) => [fr, en]));

/** Fonctions récentes qu'un fichier Excel écrit avec le préfixe « _xlfn. ». */
export const XLFN = new Set([
  'CONCAT',
  'TEXTJOIN',
  'IFS',
  'SWITCH',
  'MAXIFS',
  'MINIFS',
  'XLOOKUP',
  'STDEV.S',
  'STDEV.P',
  'VAR.S',
  'VAR.P',
  'DAYS',
  'IFNA',
  'XOR',
  'RANK.EQ',
]);

/** Nom anglais (enregistré) d'une fonction saisie en français ou en anglais. */
export function canonicalName(name: string): string {
  const up = name.toUpperCase().replace(/^_XLFN\.|^_XLWS\./, '');
  return EN_NAMES[up] ?? up;
}

/** Nom affiché d'une fonction dans la langue de l'interface. */
export const displayName = (canonical: string, lang: Lang): string => (lang === 'fr' ? (FR_NAMES[canonical] ?? canonical) : canonical);

// ---------- Erreurs ----------

export const ERROR_CODES = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
const FR_ERRORS: Record<string, string> = { '#NULL!': '#NUL!', '#VALUE!': '#VALEUR!', '#NAME?': '#NOM?', '#NUM!': '#NOMBRE!', '#ERROR!': '#ERREUR!' };
const EN_ERRORS: Record<string, string> = Object.fromEntries(Object.entries(FR_ERRORS).map(([en, fr]) => [fr, en]));

export const displayError = (code: string, lang: Lang): string => (lang === 'fr' ? (FR_ERRORS[code] ?? code) : code);

// ---------- Références ----------

export type RefPart = { row: number; col: number; rowAbs: boolean; colAbs: boolean };
/** Référence : cellule (A1), plage (A1:B3), colonnes entières (A:C) ou lignes entières (2:5), sur une feuille ou non. */
export type RefInfo = { sheet: string | null; kind: 'cell' | 'range' | 'cols' | 'rows'; a: RefPart; b: RefPart };

/** Nom de feuille tel qu'il s'écrit dans une formule (entre apostrophes si besoin). */
export function quoteSheet(name: string): string {
  const plain = /^[A-Za-z_À-ɏ][A-Za-z0-9_.À-ɏ]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(TRUE|FALSE|VRAI|FAUX)$/i.test(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

const partText = (p: RefPart, what: 'cell' | 'col' | 'row'): string => {
  const col = `${p.colAbs ? '$' : ''}${colName(p.col)}`;
  const row = `${p.rowAbs ? '$' : ''}${p.row + 1}`;
  return what === 'cell' ? col + row : what === 'col' ? col : row;
};

export function refToString(ref: RefInfo): string {
  const sheet = ref.sheet === null ? '' : `${quoteSheet(ref.sheet)}!`;
  switch (ref.kind) {
    case 'cell':
      return sheet + partText(ref.a, 'cell');
    case 'range':
      return `${sheet}${partText(ref.a, 'cell')}:${partText(ref.b, 'cell')}`;
    case 'cols':
      return `${sheet}${partText(ref.a, 'col')}:${partText(ref.b, 'col')}`;
    default:
      return `${sheet}${partText(ref.a, 'row')}:${partText(ref.b, 'row')}`;
  }
}

// ---------- Découpage ----------

export type Token =
  | { type: 'num'; text: string; value: number }
  | { type: 'str'; text: string; value: string }
  | { type: 'bool'; text: string; value: boolean }
  | { type: 'err'; text: string; value: string }
  | { type: 'ref'; text: string; ref: RefInfo }
  | { type: 'fn'; text: string; name: string }
  | { type: 'name'; text: string }
  | { type: 'op'; text: string }
  | { type: 'open' | 'close' | 'sep' | 'ws' | 'bad'; text: string };

const IDENT = /^[A-Za-z_À-ɏ][A-Za-z0-9_.À-ɏ]*/;
const SHEET_QUOTED = /^'((?:[^']|'')+)'!/;
const SHEET_PLAIN = /^([A-Za-z_À-ɏ][A-Za-z0-9_.À-ɏ]*)!/;
const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/;
const COLS = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/;
const ROWS = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})/;
const ERROR_LITERAL = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NUL!|VALEUR!|NOM\?|NOMBRE!)/i;
/** Après une référence : rien qui en ferait un nom ou une fonction (LOG10(, A1B…). */
const REF_END = /^[A-Za-z0-9_.(À-ɏ]/;

function cellPart(m: RegExpExecArray): RefPart | null {
  const col = colIndex(m[2]);
  const row = Number(m[4]) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return null;
  return { col, row, colAbs: m[1] === '$', rowAbs: m[3] === '$' };
}

/** Corps d'une référence (sans la feuille) au début de `s` : longueur et référence. */
function readRefBody(s: string): { len: number; ref: Omit<RefInfo, 'sheet'> } | null {
  let m = CELL.exec(s);
  if (m) {
    const a = cellPart(m);
    if (!a) return null;
    let len = m[0].length;
    let b = a;
    let kind: 'cell' | 'range' = 'cell';
    if (s[len] === ':') {
      const m2 = CELL.exec(s.slice(len + 1));
      const b2 = m2 && cellPart(m2);
      if (m2 && b2) {
        b = b2;
        kind = 'range';
        len += 1 + m2[0].length;
      }
    }
    if (REF_END.test(s.slice(len))) return null;
    return { len, ref: { kind, a, b } };
  }
  if ((m = COLS.exec(s))) {
    const c1 = colIndex(m[2]);
    const c2 = colIndex(m[4]);
    if (c1 < 0 || c2 < 0 || c1 >= MAX_COLS || c2 >= MAX_COLS || REF_END.test(s.slice(m[0].length))) return null;
    return {
      len: m[0].length,
      ref: {
        kind: 'cols',
        a: { col: c1, row: 0, colAbs: m[1] === '$', rowAbs: false },
        b: { col: c2, row: MAX_ROWS - 1, colAbs: m[3] === '$', rowAbs: false },
      },
    };
  }
  if ((m = ROWS.exec(s))) {
    const r1 = Number(m[2]) - 1;
    const r2 = Number(m[4]) - 1;
    if (r1 < 0 || r2 < 0 || r1 >= MAX_ROWS || r2 >= MAX_ROWS || REF_END.test(s.slice(m[0].length))) return null;
    return {
      len: m[0].length,
      ref: {
        kind: 'rows',
        a: { row: r1, col: 0, rowAbs: m[1] === '$', colAbs: false },
        b: { row: r2, col: MAX_COLS - 1, rowAbs: m[3] === '$', colAbs: false },
      },
    };
  }
  return null;
}

function readRef(s: string): { len: number; ref: RefInfo } | null {
  for (const re of [SHEET_QUOTED, SHEET_PLAIN]) {
    const m = re.exec(s);
    if (!m) continue;
    const body = readRefBody(s.slice(m[0].length));
    if (body) return { len: m[0].length + body.len, ref: { sheet: m[1].replace(/''/g, "'"), ...body.ref } };
  }
  const body = readRefBody(s);
  return body ? { len: body.len, ref: { sheet: null, ...body.ref } } : null;
}

/**
 * Découpe le corps d'une formule (sans « = »). `lang` : façon d'écrire les nombres et les séparateurs (français :
 * virgule décimale, point-virgule entre les arguments ; la virgule hors d'un nombre sépare aussi les arguments).
 */
export function tokenize(src: string, lang: Lang = 'en'): Token[] {
  const out: Token[] = [];
  const num = lang === 'fr' ? /^\d+([,.]\d+)?([eE][+-]?\d+)?/ : /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;
  let i = 0;
  while (i < src.length) {
    const s = src.slice(i);
    const ch = s[0];
    let m: RegExpExecArray | null;
    let len = 0;
    if ((m = /^\s+/.exec(s))) {
      out.push({ type: 'ws', text: m[0] });
      len = m[0].length;
    } else if (ch === '"') {
      let j = 1;
      let value = '';
      let closed = false;
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += s[j++];
      }
      out.push(closed ? { type: 'str', text: s.slice(0, j), value } : { type: 'bad', text: s.slice(0, j) });
      len = j;
    } else if (ch === '#') {
      m = ERROR_LITERAL.exec(s);
      if (m) {
        const up = m[0].toUpperCase();
        out.push({ type: 'err', text: m[0], value: EN_ERRORS[up] ?? up });
        len = m[0].length;
      } else {
        out.push({ type: 'bad', text: ch });
        len = 1;
      }
    } else {
      const ref = /^['$A-Za-z_À-ɏ\d]/.test(ch) ? readRef(s) : null;
      if (ref) {
        out.push({ type: 'ref', text: s.slice(0, ref.len), ref: ref.ref });
        len = ref.len;
      } else if ((m = num.exec(s))) {
        out.push({ type: 'num', text: m[0], value: Number(m[0].replace(',', '.')) });
        len = m[0].length;
      } else if ((m = IDENT.exec(s))) {
        const word = m[0];
        len = word.length;
        if (/^\s*\(/.test(s.slice(len))) out.push({ type: 'fn', text: word, name: word });
        else if (/^(TRUE|VRAI)$/i.test(word)) out.push({ type: 'bool', text: word, value: true });
        else if (/^(FALSE|FAUX)$/i.test(word)) out.push({ type: 'bool', text: word, value: false });
        else out.push({ type: 'name', text: word });
      } else if ((m = /^(<=|>=|<>|[-+*/^&=<>%])/.exec(s))) {
        out.push({ type: 'op', text: m[0] });
        len = m[0].length;
      } else {
        out.push({ type: ch === '(' ? 'open' : ch === ')' ? 'close' : ch === ',' || ch === ';' ? 'sep' : 'bad', text: ch });
        len = 1;
      }
    }
    i += len;
  }
  return out;
}

// ---------- Analyse ----------

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; v: string }
  | { k: 'ref'; ref: RefInfo }
  | { k: 'name'; name: string }
  | { k: 'empty' }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'neg' | 'pos' | 'pct'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node };

const INFIX: Record<string, number> = {
  '=': 10,
  '<>': 10,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  '&': 20,
  '+': 30,
  '-': 30,
  '*': 40,
  '/': 40,
  '^': 50,
};
const PREFIX_BP = 60;
const PERCENT_BP = 65;

class FormulaSyntaxError extends Error {}

function parseTokens(all: Token[]): Node {
  const toks = all.filter((t) => t.type !== 'ws');
  let p = 0;
  const fail = (): never => {
    throw new FormulaSyntaxError('syntax');
  };
  const expr = (minBp: number): Node => {
    let left = prefix();
    for (;;) {
      const t = toks[p];
      if (!t || t.type !== 'op') break;
      if (t.text === '%') {
        if (PERCENT_BP <= minBp) break;
        p++;
        left = { k: 'pct', a: left };
        continue;
      }
      const bp = INFIX[t.text];
      if (bp === undefined || bp <= minBp) break;
      p++;
      left = { k: 'bin', op: t.text, a: left, b: expr(bp) };
    }
    return left;
  };
  const prefix = (): Node => {
    const t = toks[p++];
    if (!t) return fail();
    switch (t.type) {
      case 'num':
        return { k: 'num', v: t.value };
      case 'str':
        return { k: 'str', v: t.value };
      case 'bool':
        return { k: 'bool', v: t.value };
      case 'err':
        return { k: 'err', v: t.value };
      case 'ref':
        return { k: 'ref', ref: t.ref };
      case 'name':
        return { k: 'name', name: t.text };
      case 'op':
        if (t.text === '-') return { k: 'neg', a: expr(PREFIX_BP) };
        if (t.text === '+') return { k: 'pos', a: expr(PREFIX_BP) };
        return fail();
      case 'open': {
        const e = expr(0);
        if (toks[p++]?.type !== 'close') fail();
        return e;
      }
      case 'fn': {
        if (toks[p++]?.type !== 'open') fail();
        const args: Node[] = [];
        if (toks[p]?.type === 'close') {
          p++;
          return { k: 'fn', name: canonicalName(t.name), args };
        }
        for (;;) {
          const next = toks[p];
          args.push(next && (next.type === 'sep' || next.type === 'close') ? { k: 'empty' } : expr(0));
          const sep = toks[p++];
          if (sep?.type === 'sep') continue;
          if (sep?.type === 'close') break;
          fail();
        }
        return { k: 'fn', name: canonicalName(t.name), args };
      }
      default:
        return fail();
    }
  };
  const ast = expr(0);
  if (p < toks.length) fail();
  return ast;
}

const astCache = new Map<string, Node | null>();

/** Arbre d'une formule enregistrée (« =… », écriture anglaise) ; null si elle est mal écrite. Mis en cache. */
export function parseFormula(formula: string): Node | null {
  let ast = astCache.get(formula);
  if (ast !== undefined) return ast;
  try {
    ast = parseTokens(tokenize(formula.replace(/^=/, ''), 'en'));
  } catch {
    ast = null;
  }
  if (astCache.size > 5000) astCache.clear();
  astCache.set(formula, ast);
  return ast;
}

/** Vrai si la saisie (dans la langue de l'interface) est une formule bien écrite. */
export function isValidInput(input: string, lang: Lang): boolean {
  try {
    parseTokens(tokenize(input.replace(/^=/, ''), lang));
    return true;
  } catch {
    return false;
  }
}

// ---------- Traduction ----------

/** Formule enregistrée → texte affiché dans la langue de l'interface. */
export function localizeFormula(formula: string, lang: Lang): string {
  if (lang === 'en') return formula;
  return (
    '=' +
    tokenize(formula.slice(1), 'en')
      .map((t) => {
        switch (t.type) {
          case 'fn':
            return displayName(canonicalName(t.name), lang);
          case 'sep':
            return ';';
          case 'num':
            return t.text.replace('.', ',');
          case 'bool':
            return t.value ? 'VRAI' : 'FAUX';
          case 'err':
            return displayError(t.value, lang);
          default:
            return t.text;
        }
      })
      .join('')
  );
}

/** Formule saisie (dans la langue de l'interface) → écriture enregistrée (anglaise). */
export function delocalizeFormula(input: string, lang: Lang): string {
  return (
    '=' +
    tokenize(input.replace(/^=/, ''), lang)
      .map((t) => {
        switch (t.type) {
          case 'fn':
            return canonicalName(t.name);
          case 'sep':
            return ',';
          case 'num':
            return t.text.replace(',', '.');
          case 'bool':
            return t.value ? 'TRUE' : 'FALSE';
          case 'err':
            return t.value;
          case 'ref':
            return refToString(t.ref);
          default:
            return t.text;
        }
      })
      .join('')
  );
}

// ---------- Décalage des références ----------

function rebuild(formula: string, map: (ref: RefInfo) => RefInfo | null | undefined): string {
  let changed = false;
  const body = tokenize(formula.slice(1), 'en')
    .map((t) => {
      if (t.type !== 'ref') return t.text;
      const ref = map(t.ref);
      if (ref === undefined) return t.text;
      changed = true;
      return ref ? refToString(ref) : '#REF!';
    })
    .join('');
  return changed ? `=${body}` : formula;
}

/** Formule recopiée `dr` lignes plus bas et `dc` colonnes plus à droite (références relatives décalées). */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (!dr && !dc) return formula;
  return rebuild(formula, (ref) => {
    const move = (p: RefPart): RefPart | null => {
      const row = ref.kind === 'cols' || p.rowAbs ? p.row : p.row + dr;
      const col = ref.kind === 'rows' || p.colAbs ? p.col : p.col + dc;
      return row < 0 || row >= MAX_ROWS || col < 0 || col >= MAX_COLS ? null : { ...p, row, col };
    };
    const a = move(ref.a);
    const b = move(ref.b);
    return a && b ? { ...ref, a, b } : null;
  });
}

/** Modification de la structure du classeur, à reporter dans les formules. */
export type StructEdit =
  /** Lignes ou colonnes insérées (delta > 0) ou supprimées (delta < 0) à partir de `at`, sur la feuille `sheet`. */
  | { kind: 'rows' | 'cols'; sheet: string; at: number; delta: number }
  | { kind: 'rename'; sheet: string; to: string }
  | { kind: 'delete-sheet'; sheet: string }
  /** Cellules de la plage déplacées de `dr` lignes et `dc` colonnes (couper-coller) sur la feuille `sheet`. */
  | { kind: 'move'; sheet: string; r1: number; c1: number; r2: number; c2: number; dr: number; dc: number };

/** Formule de la feuille `ownSheet` après la modification ; inchangée si elle n'est pas concernée. */
export function adjustFormula(formula: string, ownSheet: string, edit: StructEdit): string {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const targets = (ref: RefInfo) => same(ref.sheet ?? ownSheet, edit.sheet);
  if (edit.kind === 'rename')
    return rebuild(formula, (ref) => (ref.sheet !== null && same(ref.sheet, edit.sheet) ? { ...ref, sheet: edit.to } : undefined));
  if (edit.kind === 'delete-sheet') return rebuild(formula, (ref) => (ref.sheet !== null && same(ref.sheet, edit.sheet) ? null : undefined));
  if (edit.kind === 'move') {
    // Références entièrement dans la plage déplacée : elles la suivent (comme Excel).
    return rebuild(formula, (ref) => {
      if (!targets(ref) || ref.kind === 'cols' || ref.kind === 'rows') return undefined;
      const inside = (p: RefPart) => p.row >= edit.r1 && p.row <= edit.r2 && p.col >= edit.c1 && p.col <= edit.c2;
      if (!inside(ref.a) || !inside(ref.b)) return undefined;
      const move = (p: RefPart): RefPart => ({ ...p, row: p.row + edit.dr, col: p.col + edit.dc });
      return { ...ref, a: move(ref.a), b: move(ref.b) };
    });
  }
  const rows = edit.kind === 'rows';
  return rebuild(formula, (ref) => {
    if (!targets(ref) || (rows ? ref.kind === 'cols' : ref.kind === 'rows')) return undefined;
    const get = (p: RefPart) => (rows ? p.row : p.col);
    const set = (p: RefPart, v: number): RefPart => (rows ? { ...p, row: v } : { ...p, col: v });
    const { at, delta } = edit;
    let a = get(ref.a);
    let b = get(ref.b);
    if (delta > 0) {
      if (a < at && b < at) return undefined;
      if (a >= at) a += delta;
      if (b >= at) b += delta;
      const max = rows ? MAX_ROWS : MAX_COLS;
      if (b >= max) return null;
    } else {
      const n = -delta;
      const end = at + n;
      if (a < at && b < at) return undefined;
      if (ref.kind === 'cell') {
        if (a < end) return null;
        a -= n;
        b = a;
      } else {
        a = a >= end ? a - n : a >= at ? at : a;
        b = b >= end ? b - n : b >= at ? at - 1 : b;
        if (b < a) return null;
      }
    }
    return { ...ref, a: set(ref.a, a), b: set(ref.b, b) };
  });
}

/** Références d'une formule enregistrée (pour les mettre en couleur pendant la saisie). */
export function formulaRefs(input: string, lang: Lang): { ref: RefInfo; start: number; end: number }[] {
  const out: { ref: RefInfo; start: number; end: number }[] = [];
  let pos = input.startsWith('=') ? 1 : 0;
  for (const t of tokenize(input.slice(pos), lang)) {
    if (t.type === 'ref') out.push({ ref: t.ref, start: pos, end: pos + t.text.length });
    pos += t.text.length;
  }
  return out;
}
