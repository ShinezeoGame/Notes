// Tableur : calcul des formules. Le moteur calcule à la demande les cellules affichées et ce dont elles dépendent
// (sans récursion profonde : une longue chaîne A2=A1+1, A3=A2+1… ne fait pas déborder la pile), détecte les
// références circulaires, et suit les règles d'Excel (types, erreurs, plages, comparaisons, ~110 fonctions).
import type { Lang } from '../lib/i18n';
import { colOfKey, keyOf, rowOfKey } from './address';
import { delocalizeFormatCode, fromSerial, formatValue, generalNumber, nowSerial, parseLocaleNumber, roundTo, toSerial } from './format';
import { parseFormula, type Node, type RefInfo } from './formula';
import { indexSheet, type Workbook } from './model';
import { errorValue, isError, isFormula, textOf, type CellValue, type ErrorValue, type Scalar } from './values';

type Range = { kind: 'range'; s: number; r1: number; c1: number; r2: number; c2: number };
type Arr = { kind: 'array'; rows: Scalar[][] };
type Val = Scalar | Range | Arr;
type Ctx = { s: number; r: number; c: number };

const isRange = (v: Val): v is Range => typeof v === 'object' && v !== null && (v as Range).kind === 'range';
const isArr = (v: Val): v is Arr => typeof v === 'object' && v !== null && (v as Arr).kind === 'array';
const isMulti = (v: Val): v is Range | Arr => isRange(v) || isArr(v);

const VALUE = (msg?: string) => errorValue('#VALUE!', msg);
const DIV0 = () => errorValue('#DIV/0!');
const NUM = () => errorValue('#NUM!');
const NA = () => errorValue('#N/A');

const VISITING = 1;
const DONE = 2;
/** Au-delà, une plage n'est pas mise en tableau (RECHERCHEV sur des millions de cellules…). */
const MAX_MATRIX = 2_000_000;

export function rawToScalar(v: CellValue): Scalar {
  if (v === null) return null;
  if (typeof v === 'string') return v === '' ? null : textOf(v);
  return v;
}

/** Égalité de nombres à 15 chiffres significatifs, comme Excel (0,1+0,2 = 0,3). */
const numEq = (a: number, b: number) => a === b || Number(a.toPrecision(15)) === Number(b.toPrecision(15));

type Fn = {
  min: number;
  max: number;
  /** Arguments calculés avant l'appel. */
  f?: (args: Val[], e: Engine, ctx: Ctx) => Val;
  /** Arguments calculés par la fonction elle-même (SI, SIERREUR… : seule la branche utile est calculée). */
  lazy?: (args: Node[], e: Engine, ctx: Ctx) => Val;
};

export class Engine {
  readonly wb: Workbook;
  readonly lang: Lang;
  readonly now: number;
  private results: Map<number, Scalar>[];
  private state: Map<number, number>[];
  private circular: Set<number>[];
  private byName = new Map<string, number>();

  constructor(wb: Workbook, lang: Lang, now = new Date()) {
    this.wb = wb;
    this.lang = lang;
    this.now = nowSerial(now);
    this.results = wb.sheets.map(() => new Map());
    this.state = wb.sheets.map(() => new Map());
    this.circular = wb.sheets.map(() => new Set());
    wb.sheets.forEach((s, i) => this.byName.set(s.name.toLowerCase(), i));
  }

  /** Valeur calculée d'une cellule (vide : null). */
  value(s: number, r: number, c: number): Scalar {
    const sheet = this.wb.sheets[s];
    if (!sheet) return errorValue('#REF!');
    const k = keyOf(r, c);
    const cell = indexSheet(sheet).cells.get(k);
    if (!cell) return null;
    if (!isFormula(cell.v)) return rawToScalar(cell.v);
    this.ensure(s, k);
    return this.results[s].get(k) ?? null;
  }

  /** Texte affiché d'une cellule (format de nombre de son style). */
  display(s: number, r: number, c: number): { text: string; value: Scalar; color?: string } {
    const sheet = this.wb.sheets[s];
    const cell = sheet ? indexSheet(sheet).cells.get(keyOf(r, c)) : undefined;
    const value = this.value(s, r, c);
    const nf = cell ? this.wb.styles[cell.s]?.nf : undefined;
    return { ...formatValue(value, nf, this.lang), value };
  }

  sheetIndex(name: string): number {
    return this.byName.get(name.toLowerCase()) ?? -1;
  }

  // ---------- Ordre de calcul ----------

  private refSheet(ref: RefInfo, own: number): number {
    return ref.sheet === null ? own : this.sheetIndex(ref.sheet);
  }

  /** Bornes réelles d'une référence (colonnes ou lignes entières : limitées à la partie utilisée de la feuille). */
  private bounds(ref: RefInfo, s: number): { r1: number; c1: number; r2: number; c2: number } {
    const idx = indexSheet(this.wb.sheets[s]);
    let r1 = Math.min(ref.a.row, ref.b.row);
    let r2 = Math.max(ref.a.row, ref.b.row);
    let c1 = Math.min(ref.a.col, ref.b.col);
    let c2 = Math.max(ref.a.col, ref.b.col);
    if (ref.kind === 'cols') {
      r1 = 0;
      r2 = Math.max(0, idx.rows - 1);
    }
    if (ref.kind === 'rows') {
      c1 = 0;
      c2 = Math.max(0, idx.cols - 1);
    }
    return { r1, c1, r2, c2 };
  }

  /** Formules dont dépend directement une formule (cellules et plages citées). */
  private deps(s: number, k: number): [number, number][] {
    const cell = indexSheet(this.wb.sheets[s]).cells.get(k);
    const ast = cell && isFormula(cell.v) ? parseFormula(cell.v) : null;
    if (!ast) return [];
    const out: [number, number][] = [];
    const visit = (n: Node) => {
      switch (n.k) {
        case 'ref': {
          const ts = this.refSheet(n.ref, s);
          if (ts < 0) return;
          const idx = indexSheet(this.wb.sheets[ts]);
          const b = this.bounds(n.ref, ts);
          if (b.r1 === b.r2 && b.c1 === b.c2) {
            const tk = keyOf(b.r1, b.c1);
            const target = idx.cells.get(tk);
            if (target && isFormula(target.v)) out.push([ts, tk]);
          } else {
            for (const fk of idx.formulas) {
              const r = rowOfKey(fk);
              const c = colOfKey(fk);
              if (r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2) out.push([ts, fk]);
            }
          }
          return;
        }
        case 'fn':
          n.args.forEach(visit);
          return;
        case 'bin':
          visit(n.a);
          visit(n.b);
          return;
        case 'neg':
        case 'pos':
        case 'pct':
          visit(n.a);
          return;
        default:
          return;
      }
    };
    visit(ast);
    return out;
  }

  /** Calcule une formule et, avant elle, toutes les formules dont elle dépend (pile explicite). */
  private ensure(s: number, k: number): void {
    if (this.state[s].get(k) === DONE) return;
    type Frame = { s: number; k: number; deps: [number, number][] | null; i: number };
    const stack: Frame[] = [{ s, k, deps: null, i: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const st = this.state[top.s];
      if (top.deps === null) {
        if (st.get(top.k) === DONE) {
          stack.pop();
          continue;
        }
        st.set(top.k, VISITING);
        top.deps = this.deps(top.s, top.k);
      }
      if (top.i < top.deps.length) {
        const [ds, dk] = top.deps[top.i++];
        const dst = this.state[ds].get(dk);
        if (dst === DONE) continue;
        if (dst === VISITING) {
          // Référence circulaire : toutes les cellules du cycle (de `dk` au sommet de la pile) en erreur.
          const from = stack.findIndex((f) => f.s === ds && f.k === dk);
          for (let j = Math.max(0, from); j < stack.length; j++) this.circular[stack[j].s].add(stack[j].k);
          continue;
        }
        stack.push({ s: ds, k: dk, deps: null, i: 0 });
        continue;
      }
      const v = this.circular[top.s].has(top.k) ? errorValue('#REF!', 'circular') : this.compute(top.s, top.k);
      this.results[top.s].set(top.k, v);
      st.set(top.k, DONE);
      stack.pop();
    }
  }

  private compute(s: number, k: number): Scalar {
    const cell = indexSheet(this.wb.sheets[s]).cells.get(k);
    if (!cell || !isFormula(cell.v)) return null;
    const ast = parseFormula(cell.v);
    if (!ast) return errorValue('#ERROR!', 'syntax');
    const ctx: Ctx = { s, r: rowOfKey(k), c: colOfKey(k) };
    let v: Val;
    try {
      v = this.eval(ast, ctx);
    } catch (err) {
      v = errorValue('#VALUE!', err instanceof RangeError ? 'deep' : undefined);
    }
    const out = this.scalar(v, ctx);
    // Une formule qui renvoie une cellule vide affiche 0, comme Excel.
    return out === null ? 0 : out;
  }

  // ---------- Évaluation ----------

  eval(n: Node, ctx: Ctx): Val {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'str':
        return n.v;
      case 'bool':
        return n.v;
      case 'err':
        return errorValue(n.v);
      case 'empty':
        return null;
      case 'name':
        return errorValue('#NAME?', `name:${n.name}`);
      case 'ref': {
        const s = this.refSheet(n.ref, ctx.s);
        if (s < 0) return errorValue('#REF!');
        const b = this.bounds(n.ref, s);
        return { kind: 'range', s, ...b };
      }
      case 'neg':
      case 'pos':
      case 'pct': {
        const a = this.eval(n.a, ctx);
        if (n.k === 'pos') return a;
        return this.map1(a, (x) => {
          const v = this.toNumber(x);
          return isError(v) ? v : n.k === 'neg' ? -v : v / 100;
        });
      }
      case 'bin':
        return this.binary(n.op, this.eval(n.a, ctx), this.eval(n.b, ctx));
      case 'fn': {
        const fn = FUNCS[n.name];
        if (!fn) return errorValue('#NAME?', `fn:${n.name}`);
        if (n.args.length < fn.min || n.args.length > fn.max) return VALUE(`args:${n.name}`);
        if (fn.lazy) return fn.lazy(n.args, this, ctx);
        return fn.f!(
          n.args.map((a) => this.eval(a, ctx)),
          this,
          ctx,
        );
      }
    }
  }

  /** Valeur d'une cellule pendant un calcul (formule déjà calculée, ou calculée maintenant). */
  cellValue(s: number, r: number, c: number): Scalar {
    return this.value(s, r, c);
  }

  /** Valeur simple d'un argument : une plage d'une cellule donne sa valeur ; une plage d'une colonne, la valeur sur la
   * ligne de la formule (intersection implicite d'Excel). */
  scalar(v: Val, ctx: Ctx): Scalar {
    if (isArr(v)) return v.rows[0]?.[0] ?? null;
    if (!isRange(v)) return v;
    if (v.r1 === v.r2 && v.c1 === v.c2) return this.cellValue(v.s, v.r1, v.c1);
    if (v.c1 === v.c2 && ctx.r >= v.r1 && ctx.r <= v.r2) return this.cellValue(v.s, ctx.r, v.c1);
    if (v.r1 === v.r2 && ctx.c >= v.c1 && ctx.c <= v.c2) return this.cellValue(v.s, v.r1, ctx.c);
    return VALUE();
  }

  /** Tableau des valeurs d'une plage (cellules vides comprises). */
  matrix(v: Val): Scalar[][] | ErrorValue {
    if (isArr(v)) return v.rows;
    if (!isRange(v)) return [[v]];
    const rows = v.r2 - v.r1 + 1;
    const cols = v.c2 - v.c1 + 1;
    if (rows * cols > MAX_MATRIX) return NUM();
    const out: Scalar[][] = [];
    for (let r = v.r1; r <= v.r2; r++) {
      const row: Scalar[] = [];
      for (let c = v.c1; c <= v.c2; c++) row.push(this.cellValue(v.s, r, c));
      out.push(row);
    }
    return out;
  }

  /** Parcourt les valeurs non vides d'une plage ou d'un tableau ; `cb` renvoie false pour arrêter. */
  each(v: Range | Arr, cb: (x: Scalar, i: number, j: number) => boolean | void): void {
    if (isArr(v)) {
      for (let i = 0; i < v.rows.length; i++) for (let j = 0; j < v.rows[i].length; j++) if (cb(v.rows[i][j], i, j) === false) return;
      return;
    }
    const sheet = this.wb.sheets[v.s];
    if (!sheet) return;
    const idx = indexSheet(sheet);
    const r2 = Math.min(v.r2, idx.rows - 1);
    const c2 = Math.min(v.c2, idx.cols - 1);
    const area = (r2 - v.r1 + 1) * (c2 - v.c1 + 1);
    if (area <= 0) return;
    if (area <= idx.cells.size * 4) {
      for (let r = v.r1; r <= r2; r++)
        for (let c = v.c1; c <= c2; c++) {
          if (!idx.cells.has(keyOf(r, c))) continue;
          const x = this.cellValue(v.s, r, c);
          if (x !== null && cb(x, r - v.r1, c - v.c1) === false) return;
        }
    } else {
      const keys = [...idx.cells.keys()].filter((k) => {
        const r = rowOfKey(k);
        const c = colOfKey(k);
        return r >= v.r1 && r <= r2 && c >= v.c1 && c <= c2;
      });
      keys.sort((a, b) => a - b);
      for (const k of keys) {
        const x = this.cellValue(v.s, rowOfKey(k), colOfKey(k));
        if (x !== null && cb(x, rowOfKey(k) - v.r1, colOfKey(k) - v.c1) === false) return;
      }
    }
  }

  size(v: Val): [number, number] {
    if (isArr(v)) return [v.rows.length, v.rows[0]?.length ?? 0];
    if (isRange(v)) return [v.r2 - v.r1 + 1, v.c2 - v.c1 + 1];
    return [1, 1];
  }

  /** Valeur (ligne i, colonne j) d'une plage ou d'un tableau. */
  at(v: Val, i: number, j: number): Scalar {
    if (isArr(v)) return v.rows[i]?.[j] ?? null;
    if (isRange(v)) return this.cellValue(v.s, v.r1 + i, v.c1 + j);
    return v;
  }

  // ---------- Conversions ----------

  toNumber(v: Scalar): number | ErrorValue {
    if (v === null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isError(v)) return v;
    const t = v.trim();
    if (t === '') return VALUE();
    const n = parseLocaleNumber(t, this.lang) ?? parseLocaleNumber(t, 'en');
    if (n !== null) return n;
    const pct = /^(.+?)\s*%$/.exec(t);
    if (pct) {
      const p = parseLocaleNumber(pct[1], this.lang);
      if (p !== null) return p / 100;
    }
    return VALUE();
  }

  toText(v: Scalar): string | ErrorValue {
    if (v === null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return generalNumber(v, this.lang);
    if (typeof v === 'boolean') return v ? (this.lang === 'fr' ? 'VRAI' : 'TRUE') : this.lang === 'fr' ? 'FAUX' : 'FALSE';
    return v;
  }

  toBool(v: Scalar): boolean | ErrorValue {
    if (v === null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (isError(v)) return v;
    if (/^(true|vrai)$/i.test(v.trim())) return true;
    if (/^(false|faux)$/i.test(v.trim())) return false;
    return VALUE();
  }

  /** Comparaison à la manière d'Excel : nombres < textes < booleens ; textes sans tenir compte de la casse. */
  compare(a: Scalar, b: Scalar): number {
    const kind = (x: Scalar) => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : typeof x === 'boolean' ? 2 : 3);
    if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    const ka = kind(a);
    const kb = kind(b);
    if (ka !== kb) return ka - kb;
    if (ka === 0) return numEq(a as number, b as number) ? 0 : (a as number) < (b as number) ? -1 : 1;
    if (ka === 1) {
      const x = (a as string).toLowerCase();
      const y = (b as string).toLowerCase();
      return x === y ? 0 : x.localeCompare(y, this.lang === 'fr' ? 'fr' : 'en', { sensitivity: 'accent' }) || (x < y ? -1 : 1);
    }
    return Number(a) - Number(b);
  }

  private map1(v: Val, f: (x: Scalar) => Scalar): Val {
    if (!isMulti(v)) return f(v);
    const [rows, cols] = this.size(v);
    if (rows * cols > MAX_MATRIX) return NUM();
    if (rows === 1 && cols === 1) return f(this.at(v, 0, 0));
    const out: Scalar[][] = [];
    for (let i = 0; i < rows; i++) {
      const row: Scalar[] = [];
      for (let j = 0; j < cols; j++) row.push(f(this.at(v, i, j)));
      out.push(row);
    }
    return { kind: 'array', rows: out };
  }

  private binary(op: string, a: Val, b: Val): Val {
    if (isMulti(a) || isMulti(b)) {
      const [ra, ca] = this.size(a);
      const [rb, cb] = this.size(b);
      if (ra * ca === 1 && rb * cb === 1) return this.op(op, this.at(a, 0, 0), this.at(b, 0, 0));
      const rows = Math.max(ra, rb);
      const cols = Math.max(ca, cb);
      if (rows * cols > MAX_MATRIX) return NUM();
      const pick = (v: Val, r: number, c: number, i: number, j: number): Scalar => {
        const ii = r === 1 ? 0 : i;
        const jj = c === 1 ? 0 : j;
        return ii < r && jj < c ? this.at(v, ii, jj) : NA();
      };
      const out: Scalar[][] = [];
      for (let i = 0; i < rows; i++) {
        const row: Scalar[] = [];
        for (let j = 0; j < cols; j++) row.push(this.op(op, pick(a, ra, ca, i, j), pick(b, rb, cb, i, j)));
        out.push(row);
      }
      return { kind: 'array', rows: out };
    }
    return this.op(op, a, b);
  }

  private op(op: string, a: Scalar, b: Scalar): Scalar {
    if (op === '&') {
      const x = this.toText(a);
      if (isError(x)) return x;
      const y = this.toText(b);
      if (isError(y)) return y;
      return x + y;
    }
    if (isError(a)) return a;
    if (isError(b)) return b;
    switch (op) {
      case '=':
        return this.compare(a, b) === 0;
      case '<>':
        return this.compare(a, b) !== 0;
      case '<':
        return this.compare(a, b) < 0;
      case '>':
        return this.compare(a, b) > 0;
      case '<=':
        return this.compare(a, b) <= 0;
      case '>=':
        return this.compare(a, b) >= 0;
    }
    const x = this.toNumber(a);
    if (isError(x)) return x;
    const y = this.toNumber(b);
    if (isError(y)) return y;
    let r: number;
    switch (op) {
      case '+':
        r = x + y;
        break;
      case '-':
        r = x - y;
        break;
      case '*':
        r = x * y;
        break;
      case '/':
        if (y === 0) return DIV0();
        r = x / y;
        break;
      case '^':
        if (x === 0 && y === 0) return NUM();
        if (x === 0 && y < 0) return DIV0();
        r = x ** y;
        break;
      default:
        return VALUE();
    }
    return Number.isFinite(r) ? r : NUM();
  }

  // ---------- Outils des fonctions ----------

  /** Nombres des arguments, règles d'Excel : dans une plage, seuls les nombres comptent ; un argument direct est
   * converti (texte numérique, booléen), sinon #VALEUR!. */
  numbers(args: Val[]): number[] | ErrorValue {
    const out: number[] = [];
    for (const a of args) {
      if (isMulti(a)) {
        let err: ErrorValue | null = null;
        this.each(a, (v) => {
          if (isError(v)) {
            err = v;
            return false;
          }
          if (typeof v === 'number') out.push(v);
        });
        if (err) return err;
      } else {
        const n = this.toNumber(a);
        if (isError(n)) return n;
        out.push(n);
      }
    }
    return out;
  }

  num(v: Val, ctx: Ctx): number | ErrorValue {
    return this.toNumber(this.scalar(v, ctx));
  }

  text(v: Val, ctx: Ctx): string | ErrorValue {
    return this.toText(this.scalar(v, ctx));
  }

  bool(v: Val, ctx: Ctx): boolean | ErrorValue {
    return this.toBool(this.scalar(v, ctx));
  }

  /** Entier positif (index, nombre de caractères…). */
  int(v: Val, ctx: Ctx): number | ErrorValue {
    const n = this.num(v, ctx);
    return isError(n) ? n : Math.trunc(n);
  }
}

// ---------- Critères (NB.SI, SOMME.SI…) ----------

function wildcard(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~' && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is');
}

function criteria(e: Engine, crit: Scalar): (v: Scalar) => boolean {
  if (typeof crit === 'number') return (v) => typeof v === 'number' && numEq(v, crit);
  if (typeof crit === 'boolean') return (v) => v === crit;
  if (crit === null) return (v) => v === null || v === '';
  if (isError(crit)) return (v) => isError(v) && v.error === crit.error;
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(crit)!;
  const op = m[1] ?? '=';
  const operand = m[2];
  const n = parseLocaleNumber(operand, e.lang) ?? parseLocaleNumber(operand, 'en');
  if (operand === '') {
    if (op === '=') return (v) => v === null || v === '';
    if (op === '<>') return (v) => v !== null && v !== '';
  }
  if (n !== null) {
    const cmp = (v: Scalar): number | null => (typeof v === 'number' ? (numEq(v, n) ? 0 : v < n ? -1 : 1) : null);
    switch (op) {
      case '=':
        return (v) => cmp(v) === 0 || (typeof v === 'string' && parseLocaleNumber(v, e.lang) === n);
      case '<>':
        return (v) => cmp(v) !== 0;
      case '<':
        return (v) => (cmp(v) ?? 1) < 0;
      case '>':
        return (v) => (cmp(v) ?? -1) > 0;
      case '<=':
        return (v) => (cmp(v) ?? 1) <= 0;
      default:
        return (v) => (cmp(v) ?? -1) >= 0;
    }
  }
  const bool = /^(true|vrai)$/i.test(operand) ? true : /^(false|faux)$/i.test(operand) ? false : null;
  if (bool !== null && (op === '=' || op === '<>')) return op === '=' ? (v) => v === bool : (v) => v !== bool;
  if (op === '=' || op === '<>') {
    const re = wildcard(operand);
    const match = (v: Scalar) => typeof v === 'string' && re.test(v);
    return op === '=' ? match : (v) => !match(v);
  }
  return (v) => {
    if (typeof v !== 'string') return false;
    const c = e.compare(v, operand);
    return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
  };
}

/** Lignes et colonnes d'une plage de critère qui remplissent toutes les conditions (…SI.ENS). */
function matchAll(e: Engine, pairs: Val[], ctx: Ctx): { rows: number; cols: number; ok: boolean[][] } | ErrorValue {
  let rows = 0;
  let cols = 0;
  let ok: boolean[][] | null = null;
  for (let i = 0; i < pairs.length; i += 2) {
    const range = pairs[i];
    const test = criteria(e, e.scalar(pairs[i + 1], ctx));
    const [r, c] = e.size(range);
    if (ok === null) {
      rows = r;
      cols = c;
      ok = Array.from({ length: r }, () => Array<boolean>(c).fill(true));
    } else if (r !== rows || c !== cols) return VALUE();
    const m = e.matrix(range);
    if (isError(m)) return m;
    for (let a = 0; a < rows; a++) for (let b = 0; b < cols; b++) if (ok[a][b] && !test(m[a]?.[b] ?? null)) ok[a][b] = false;
  }
  return { rows, cols, ok: ok ?? [] };
}

// ---------- Fonctions ----------

const n1 =
  (f: (x: number) => number | ErrorValue) =>
  (args: Val[], e: Engine, ctx: Ctx): Val => {
    const x = e.num(args[0], ctx);
    if (isError(x)) return x;
    const r = f(x);
    return typeof r === 'number' && !Number.isFinite(r) ? NUM() : r;
  };

const agg =
  (f: (xs: number[]) => number | ErrorValue) =>
  (args: Val[], e: Engine): Val => {
    const xs = e.numbers(args);
    if (isError(xs)) return xs;
    const r = f(xs);
    return typeof r === 'number' && !Number.isFinite(r) ? NUM() : r;
  };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : DIV0());
function variance(xs: number[], sample: boolean): number | ErrorValue {
  if (xs.length < (sample ? 2 : 1)) return DIV0();
  const m = sum(xs) / xs.length;
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - (sample ? 1 : 0));
}
const sqrtOf = (v: number | ErrorValue) => (isError(v) ? v : Math.sqrt(v));

function roundDigits(x: number, d: number, mode: 'round' | 'up' | 'down'): number {
  const f = 10 ** Math.trunc(d);
  const scaled = Number((Math.abs(x) * f).toPrecision(15));
  const r = mode === 'round' ? Math.round(scaled) : mode === 'up' ? Math.ceil(scaled) : Math.floor(scaled);
  return (Math.sign(x) * r) / f;
}

function textArgs(e: Engine, args: Val[], ctx: Ctx, flatten: boolean): string[] | ErrorValue {
  const out: string[] = [];
  for (const a of args) {
    if (flatten && isMulti(a)) {
      const m = e.matrix(a);
      if (isError(m)) return m;
      for (const row of m)
        for (const v of row) {
          const t = e.toText(v);
          if (isError(t)) return t;
          out.push(t);
        }
    } else {
      const t = e.text(a, ctx);
      if (isError(t)) return t;
      out.push(t);
    }
  }
  return out;
}

/** Recherche dans une ligne ou une colonne (EQUIV, RECHERCHEV…) : position (0…) ou -1. */
function lookup(e: Engine, needle: Scalar, list: Scalar[], mode: 0 | 1 | -1, wild: boolean): number {
  if (mode === 0) {
    const re = wild && typeof needle === 'string' && /[*?~]/.test(needle) ? wildcard(needle) : null;
    return list.findIndex((v) => (re ? typeof v === 'string' && re.test(v) : v !== null && e.compare(v, needle) === 0 && typeof v === typeof needle));
  }
  // Liste triée : dernière valeur ≤ (mode 1) ou ≥ (mode -1) de même type.
  let found = -1;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v === null || typeof v !== typeof needle) continue;
    const c = e.compare(v, needle);
    if (c === 0) return i;
    if (mode === 1 ? c < 0 : c > 0) found = i;
    else break;
  }
  return found;
}

const column = (m: Scalar[][], j: number) => m.map((row) => row[j] ?? null);
const flatten = (m: Scalar[][]) => (m.length === 1 ? m[0] : m.map((row) => row[0] ?? null));

function dateParts(e: Engine, v: Val, ctx: Ctx) {
  const n = e.num(v, ctx);
  if (isError(n)) return n;
  if (n < 0) return NUM();
  return fromSerial(n);
}

function pmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return -(pv + fv) / nper;
  const f = (1 + rate) ** nper;
  return (-rate * (fv + pv * f)) / ((1 + rate * type) * (f - 1));
}

const FUNCS: Record<string, Fn> = {
  // Statistiques
  SUM: { min: 1, max: 255, f: agg(sum) },
  AVERAGE: { min: 1, max: 255, f: agg(mean) },
  MIN: { min: 1, max: 255, f: agg((xs) => (xs.length ? Math.min(...xs) : 0)) },
  MAX: { min: 1, max: 255, f: agg((xs) => (xs.length ? Math.max(...xs) : 0)) },
  PRODUCT: { min: 1, max: 255, f: agg((xs) => (xs.length ? xs.reduce((a, b) => a * b, 1) : 0)) },
  MEDIAN: {
    min: 1,
    max: 255,
    f: agg((xs) => {
      if (!xs.length) return NUM();
      const s = [...xs].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }),
  },
  STDEV: { min: 1, max: 255, f: agg((xs) => sqrtOf(variance(xs, true))) },
  'STDEV.S': { min: 1, max: 255, f: agg((xs) => sqrtOf(variance(xs, true))) },
  STDEVP: { min: 1, max: 255, f: agg((xs) => sqrtOf(variance(xs, false))) },
  'STDEV.P': { min: 1, max: 255, f: agg((xs) => sqrtOf(variance(xs, false))) },
  VAR: { min: 1, max: 255, f: agg((xs) => variance(xs, true)) },
  'VAR.S': { min: 1, max: 255, f: agg((xs) => variance(xs, true)) },
  VARP: { min: 1, max: 255, f: agg((xs) => variance(xs, false)) },
  'VAR.P': { min: 1, max: 255, f: agg((xs) => variance(xs, false)) },
  COUNT: {
    min: 1,
    max: 255,
    f: (args, e) => {
      let n = 0;
      for (const a of args) {
        if (isMulti(a)) e.each(a, (v) => void (typeof v === 'number' && n++));
        else if (a !== null && (typeof a === 'number' || typeof a === 'boolean' || (typeof a === 'string' && !isError(e.toNumber(a))))) n++;
      }
      return n;
    },
  },
  COUNTA: {
    min: 1,
    max: 255,
    f: (args, e) => {
      let n = 0;
      for (const a of args) {
        if (isMulti(a)) e.each(a, () => void n++);
        else if (a !== null) n++;
      }
      return n;
    },
  },
  COUNTBLANK: {
    min: 1,
    max: 1,
    f: ([a], e) => {
      if (!isMulti(a)) return VALUE();
      const [rows, cols] = e.size(a);
      let filled = 0;
      e.each(a, (v) => void (v !== '' && filled++));
      return rows * cols - filled;
    },
  },
  LARGE: {
    min: 2,
    max: 2,
    f: ([a, k], e, ctx) => {
      const xs = e.numbers([a]);
      const n = e.int(k, ctx);
      if (isError(xs)) return xs;
      if (isError(n)) return n;
      if (n < 1 || n > xs.length) return NUM();
      return [...xs].sort((x, y) => y - x)[n - 1];
    },
  },
  SMALL: {
    min: 2,
    max: 2,
    f: ([a, k], e, ctx) => {
      const xs = e.numbers([a]);
      const n = e.int(k, ctx);
      if (isError(xs)) return xs;
      if (isError(n)) return n;
      if (n < 1 || n > xs.length) return NUM();
      return [...xs].sort((x, y) => x - y)[n - 1];
    },
  },
  RANK: { min: 2, max: 3, f: (args, e, ctx) => rank(args, e, ctx) },
  'RANK.EQ': { min: 2, max: 3, f: (args, e, ctx) => rank(args, e, ctx) },

  // Conditions
  COUNTIF: {
    min: 2,
    max: 2,
    f: ([range, crit], e, ctx) => {
      const m = matchAll(e, [range, crit], ctx);
      if (isError(m)) return m;
      return m.ok.reduce((n, row) => n + row.filter(Boolean).length, 0);
    },
  },
  COUNTIFS: {
    min: 2,
    max: 254,
    f: (args, e, ctx) => {
      if (args.length % 2) return VALUE();
      const m = matchAll(e, args, ctx);
      if (isError(m)) return m;
      return m.ok.reduce((n, row) => n + row.filter(Boolean).length, 0);
    },
  },
  SUMIF: { min: 2, max: 3, f: ([range, crit, sumRange], e, ctx) => condAgg(e, ctx, sumRange ?? range, [range, crit], sum) },
  SUMIFS: { min: 3, max: 255, f: ([target, ...pairs], e, ctx) => (pairs.length % 2 ? VALUE() : condAgg(e, ctx, target, pairs, sum)) },
  AVERAGEIF: { min: 2, max: 3, f: ([range, crit, avgRange], e, ctx) => condAgg(e, ctx, avgRange ?? range, [range, crit], mean) },
  AVERAGEIFS: { min: 3, max: 255, f: ([target, ...pairs], e, ctx) => (pairs.length % 2 ? VALUE() : condAgg(e, ctx, target, pairs, mean)) },
  MAXIFS: {
    min: 3,
    max: 255,
    f: ([target, ...pairs], e, ctx) => (pairs.length % 2 ? VALUE() : condAgg(e, ctx, target, pairs, (xs) => (xs.length ? Math.max(...xs) : 0))),
  },
  MINIFS: {
    min: 3,
    max: 255,
    f: ([target, ...pairs], e, ctx) => (pairs.length % 2 ? VALUE() : condAgg(e, ctx, target, pairs, (xs) => (xs.length ? Math.min(...xs) : 0))),
  },

  // Logique
  IF: {
    min: 2,
    max: 3,
    lazy: (args, e, ctx) => {
      const cond = e.bool(e.eval(args[0], ctx), ctx);
      if (isError(cond)) return cond;
      const branch = cond ? args[1] : args[2];
      if (!branch) return cond ? true : false;
      return branch.k === 'empty' ? 0 : e.eval(branch, ctx);
    },
  },
  IFS: {
    min: 2,
    max: 254,
    lazy: (args, e, ctx) => {
      if (args.length % 2) return VALUE();
      for (let i = 0; i < args.length; i += 2) {
        const cond = e.bool(e.eval(args[i], ctx), ctx);
        if (isError(cond)) return cond;
        if (cond) return e.eval(args[i + 1], ctx);
      }
      return NA();
    },
  },
  IFERROR: {
    min: 2,
    max: 2,
    lazy: (args, e, ctx) => {
      const v = e.scalar(e.eval(args[0], ctx), ctx);
      return isError(v) ? e.eval(args[1], ctx) : v;
    },
  },
  IFNA: {
    min: 2,
    max: 2,
    lazy: (args, e, ctx) => {
      const v = e.scalar(e.eval(args[0], ctx), ctx);
      return isError(v) && v.error === '#N/A' ? e.eval(args[1], ctx) : v;
    },
  },
  SWITCH: {
    min: 3,
    max: 254,
    lazy: (args, e, ctx) => {
      const v = e.scalar(e.eval(args[0], ctx), ctx);
      if (isError(v)) return v;
      let i = 1;
      for (; i + 1 < args.length; i += 2) {
        const w = e.scalar(e.eval(args[i], ctx), ctx);
        if (!isError(w) && e.compare(v, w) === 0) return e.eval(args[i + 1], ctx);
      }
      return i < args.length ? e.eval(args[i], ctx) : NA();
    },
  },
  AND: { min: 1, max: 255, f: (args, e) => logical(args, e, (xs) => xs.every(Boolean)) },
  OR: { min: 1, max: 255, f: (args, e) => logical(args, e, (xs) => xs.some(Boolean)) },
  XOR: { min: 1, max: 255, f: (args, e) => logical(args, e, (xs) => xs.filter(Boolean).length % 2 === 1) },
  NOT: {
    min: 1,
    max: 1,
    f: ([a], e, ctx) => {
      const b = e.bool(a, ctx);
      return isError(b) ? b : !b;
    },
  },
  TRUE: { min: 0, max: 0, f: () => true },
  FALSE: { min: 0, max: 0, f: () => false },

  // Mathématiques
  ABS: { min: 1, max: 1, f: n1(Math.abs) },
  SQRT: { min: 1, max: 1, f: n1((x) => (x < 0 ? NUM() : Math.sqrt(x))) },
  EXP: { min: 1, max: 1, f: n1(Math.exp) },
  LN: { min: 1, max: 1, f: n1((x) => (x <= 0 ? NUM() : Math.log(x))) },
  LOG10: { min: 1, max: 1, f: n1((x) => (x <= 0 ? NUM() : Math.log10(x))) },
  LOG: {
    min: 1,
    max: 2,
    f: ([a, b], e, ctx) => {
      const x = e.num(a, ctx);
      const base = b === undefined || b === null ? 10 : e.num(b, ctx);
      if (isError(x)) return x;
      if (isError(base)) return base;
      if (x <= 0 || base <= 0 || base === 1) return NUM();
      return Math.log(x) / Math.log(base);
    },
  },
  INT: { min: 1, max: 1, f: n1(Math.floor) },
  TRUNC: {
    min: 1,
    max: 2,
    f: ([a, d], e, ctx) => {
      const x = e.num(a, ctx);
      const digits = d === undefined ? 0 : e.num(d, ctx);
      if (isError(x)) return x;
      if (isError(digits)) return digits;
      return roundDigits(x, digits, 'down');
    },
  },
  SIGN: { min: 1, max: 1, f: n1((x) => Math.sign(x)) },
  PI: { min: 0, max: 0, f: () => Math.PI },
  ROUND: { min: 1, max: 2, f: (args, e, ctx) => roundFn(args, e, ctx, 'round') },
  ROUNDUP: { min: 1, max: 2, f: (args, e, ctx) => roundFn(args, e, ctx, 'up') },
  ROUNDDOWN: { min: 1, max: 2, f: (args, e, ctx) => roundFn(args, e, ctx, 'down') },
  MROUND: {
    min: 2,
    max: 2,
    f: ([a, b], e, ctx) => {
      const x = e.num(a, ctx);
      const m = e.num(b, ctx);
      if (isError(x)) return x;
      if (isError(m)) return m;
      if (m === 0) return 0;
      if (Math.sign(x) * Math.sign(m) < 0) return NUM();
      return roundTo(Math.round(Number((x / m).toPrecision(15))) * m, 10);
    },
  },
  CEILING: { min: 1, max: 2, f: (args, e, ctx) => multipleFn(args, e, ctx, 'up') },
  FLOOR: { min: 1, max: 2, f: (args, e, ctx) => multipleFn(args, e, ctx, 'down') },
  MOD: {
    min: 2,
    max: 2,
    f: ([a, b], e, ctx) => {
      const x = e.num(a, ctx);
      const d = e.num(b, ctx);
      if (isError(x)) return x;
      if (isError(d)) return d;
      if (d === 0) return DIV0();
      return roundTo(x - d * Math.floor(x / d), 12);
    },
  },
  QUOTIENT: {
    min: 2,
    max: 2,
    f: ([a, b], e, ctx) => {
      const x = e.num(a, ctx);
      const d = e.num(b, ctx);
      if (isError(x)) return x;
      if (isError(d)) return d;
      return d === 0 ? DIV0() : Math.trunc(x / d);
    },
  },
  POWER: {
    min: 2,
    max: 2,
    f: ([a, b], e, ctx) => {
      const x = e.scalar(a, ctx);
      const y = e.scalar(b, ctx);
      return powerOf(e, x, y);
    },
  },
  RAND: { min: 0, max: 0, f: () => Math.random() },
  RANDBETWEEN: {
    min: 2,
    max: 2,
    f: ([a, b], e, ctx) => {
      const lo = e.num(a, ctx);
      const hi = e.num(b, ctx);
      if (isError(lo)) return lo;
      if (isError(hi)) return hi;
      const l = Math.ceil(lo);
      const h = Math.floor(hi);
      return h < l ? NUM() : l + Math.floor(Math.random() * (h - l + 1));
    },
  },
  SUMPRODUCT: {
    min: 1,
    max: 255,
    f: (args, e) => {
      const ms: Scalar[][][] = [];
      for (const a of args) {
        const m = e.matrix(a);
        if (isError(m)) return m;
        ms.push(m);
      }
      const rows = ms[0].length;
      const cols = ms[0][0]?.length ?? 0;
      if (ms.some((m) => m.length !== rows || (m[0]?.length ?? 0) !== cols)) return VALUE();
      let total = 0;
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          let p = 1;
          for (const m of ms) {
            const v = m[i][j];
            if (isError(v)) return v;
            p *= typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0;
          }
          total += p;
        }
      return total;
    },
  },

  // Texte
  CONCATENATE: {
    min: 1,
    max: 255,
    f: (args, e, ctx) => {
      const parts = textArgs(e, args, ctx, false);
      return isError(parts) ? parts : parts.join('');
    },
  },
  CONCAT: {
    min: 1,
    max: 255,
    f: (args, e, ctx) => {
      const parts = textArgs(e, args, ctx, true);
      return isError(parts) ? parts : parts.join('');
    },
  },
  TEXTJOIN: {
    min: 3,
    max: 255,
    f: ([sep, ignore, ...rest], e, ctx) => {
      const d = e.text(sep, ctx);
      const skip = e.bool(ignore, ctx);
      if (isError(d)) return d;
      if (isError(skip)) return skip;
      const parts = textArgs(e, rest, ctx, true);
      if (isError(parts)) return parts;
      return (skip ? parts.filter((p) => p !== '') : parts).join(d);
    },
  },
  LEFT: { min: 1, max: 2, f: ([a, n], e, ctx) => sliceText(e, ctx, a, n, (s, k) => s.slice(0, k)) },
  RIGHT: { min: 1, max: 2, f: ([a, n], e, ctx) => sliceText(e, ctx, a, n, (s, k) => (k ? s.slice(-k) : [])) },
  MID: {
    min: 3,
    max: 3,
    f: ([a, start, n], e, ctx) => {
      const s = e.text(a, ctx);
      const st = e.int(start, ctx);
      const k = e.int(n, ctx);
      if (isError(s)) return s;
      if (isError(st)) return st;
      if (isError(k)) return k;
      if (st < 1 || k < 0) return VALUE();
      return [...s].slice(st - 1, st - 1 + k).join('');
    },
  },
  LEN: {
    min: 1,
    max: 1,
    f: ([a], e, ctx) => {
      const s = e.text(a, ctx);
      return isError(s) ? s : [...s].length;
    },
  },
  UPPER: { min: 1, max: 1, f: ([a], e, ctx) => mapText(e, ctx, a, (s) => s.toLocaleUpperCase()) },
  LOWER: { min: 1, max: 1, f: ([a], e, ctx) => mapText(e, ctx, a, (s) => s.toLocaleLowerCase()) },
  PROPER: {
    min: 1,
    max: 1,
    f: ([a], e, ctx) =>
      mapText(e, ctx, a, (s) => s.toLocaleLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, p, l: string) => p + l.toLocaleUpperCase())),
  },
  TRIM: { min: 1, max: 1, f: ([a], e, ctx) => mapText(e, ctx, a, (s) => s.trim().replace(/ {2,}/g, ' ')) },
  REPT: {
    min: 2,
    max: 2,
    f: ([a, n], e, ctx) => {
      const s = e.text(a, ctx);
      const k = e.int(n, ctx);
      if (isError(s)) return s;
      if (isError(k)) return k;
      if (k < 0 || s.length * k > 32767) return VALUE();
      return s.repeat(k);
    },
  },
  EXACT: {
    min: 2,
    max: 2,
    f: ([a, b], e, ctx) => {
      const x = e.text(a, ctx);
      const y = e.text(b, ctx);
      if (isError(x)) return x;
      if (isError(y)) return y;
      return x === y;
    },
  },
  SUBSTITUTE: {
    min: 3,
    max: 4,
    f: ([a, from, to, nth], e, ctx) => {
      const s = e.text(a, ctx);
      const f = e.text(from, ctx);
      const t = e.text(to, ctx);
      if (isError(s)) return s;
      if (isError(f)) return f;
      if (isError(t)) return t;
      if (!f) return s;
      if (nth === undefined) return s.split(f).join(t);
      const k = e.int(nth, ctx);
      if (isError(k)) return k;
      if (k < 1) return VALUE();
      let idx = -1;
      for (let i = 0; i < k; i++) {
        idx = s.indexOf(f, idx + 1);
        if (idx < 0) return s;
      }
      return s.slice(0, idx) + t + s.slice(idx + f.length);
    },
  },
  REPLACE: {
    min: 4,
    max: 4,
    f: ([a, start, n, by], e, ctx) => {
      const s = e.text(a, ctx);
      const st = e.int(start, ctx);
      const k = e.int(n, ctx);
      const t = e.text(by, ctx);
      if (isError(s)) return s;
      if (isError(st)) return st;
      if (isError(k)) return k;
      if (isError(t)) return t;
      if (st < 1 || k < 0) return VALUE();
      return s.slice(0, st - 1) + t + s.slice(st - 1 + k);
    },
  },
  FIND: { min: 2, max: 3, f: (args, e, ctx) => findText(args, e, ctx, false) },
  SEARCH: { min: 2, max: 3, f: (args, e, ctx) => findText(args, e, ctx, true) },
  VALUE: {
    min: 1,
    max: 1,
    f: ([a], e, ctx) => e.toNumber(e.scalar(a, ctx)),
  },
  TEXT: {
    min: 2,
    max: 2,
    f: ([a, fmt], e, ctx) => {
      const v = e.scalar(a, ctx);
      const code = e.text(fmt, ctx);
      if (isError(v)) return v;
      if (isError(code)) return code;
      const n = typeof v === 'string' ? e.toNumber(v) : v;
      return formatValue(isError(n) ? v : n, delocalizeFormatCode(code, e.lang), e.lang).text;
    },
  },
  CHAR: {
    min: 1,
    max: 1,
    f: ([a], e, ctx) => {
      const n = e.int(a, ctx);
      if (isError(n)) return n;
      return n < 1 || n > 255 ? VALUE() : String.fromCharCode(n);
    },
  },

  // Dates
  TODAY: { min: 0, max: 0, f: (_, e) => Math.floor(e.now) },
  NOW: { min: 0, max: 0, f: (_, e) => e.now },
  DATE: {
    min: 3,
    max: 3,
    f: ([y, m, d], e, ctx) => {
      const yy = e.int(y, ctx);
      const mm = e.int(m, ctx);
      const dd = e.int(d, ctx);
      if (isError(yy)) return yy;
      if (isError(mm)) return mm;
      if (isError(dd)) return dd;
      const year = yy < 1900 ? yy + 1900 : yy;
      if (year > 9999) return NUM();
      const serial = toSerial(year, mm, dd);
      return serial < 0 ? NUM() : serial;
    },
  },
  TIME: {
    min: 3,
    max: 3,
    f: ([h, m, s], e, ctx) => {
      const hh = e.num(h, ctx);
      const mm = e.num(m, ctx);
      const ss = e.num(s, ctx);
      if (isError(hh)) return hh;
      if (isError(mm)) return mm;
      if (isError(ss)) return ss;
      const t = (Math.trunc(hh) * 3600 + Math.trunc(mm) * 60 + Math.trunc(ss)) / 86400;
      return t < 0 ? NUM() : t - Math.floor(t);
    },
  },
  YEAR: { min: 1, max: 1, f: ([a], e, ctx) => withDate(e, a, ctx, (d) => d.y) },
  MONTH: { min: 1, max: 1, f: ([a], e, ctx) => withDate(e, a, ctx, (d) => d.m) },
  DAY: { min: 1, max: 1, f: ([a], e, ctx) => withDate(e, a, ctx, (d) => d.d) },
  HOUR: { min: 1, max: 1, f: ([a], e, ctx) => withDate(e, a, ctx, (d) => d.h) },
  MINUTE: { min: 1, max: 1, f: ([a], e, ctx) => withDate(e, a, ctx, (d) => d.mi) },
  SECOND: { min: 1, max: 1, f: ([a], e, ctx) => withDate(e, a, ctx, (d) => d.s) },
  WEEKDAY: {
    min: 1,
    max: 2,
    f: ([a, type], e, ctx) => {
      const t = type === undefined ? 1 : e.int(type, ctx);
      if (isError(t)) return t;
      return withDate(e, a, ctx, (d) => (t === 2 ? ((d.wd + 6) % 7) + 1 : t === 3 ? (d.wd + 6) % 7 : d.wd + 1));
    },
  },
  WEEKNUM: {
    min: 1,
    max: 2,
    f: ([a, type], e, ctx) => {
      const t = type === undefined ? 1 : e.int(type, ctx);
      const n = e.num(a, ctx);
      if (isError(t)) return t;
      if (isError(n)) return n;
      const d = fromSerial(n);
      if (t === 21) {
        // Semaine ISO (lundi, première semaine contenant un jeudi).
        const thursday = Math.floor(n) - ((d.wd + 6) % 7) + 3;
        const jan1 = toSerial(fromSerial(thursday).y, 1, 1);
        return Math.floor((thursday - jan1) / 7) + 1;
      }
      const jan1 = toSerial(d.y, 1, 1);
      const startDay = t === 2 ? 1 : 0;
      const offset = (fromSerial(jan1).wd - startDay + 7) % 7;
      return Math.floor((Math.floor(n) - jan1 + offset) / 7) + 1;
    },
  },
  DAYS: {
    min: 2,
    max: 2,
    f: ([end, start], e, ctx) => {
      const b = e.num(end, ctx);
      const a = e.num(start, ctx);
      if (isError(b)) return b;
      if (isError(a)) return a;
      return Math.floor(b) - Math.floor(a);
    },
  },
  EDATE: { min: 2, max: 2, f: ([a, m], e, ctx) => addMonths(e, ctx, a, m, false) },
  EOMONTH: { min: 2, max: 2, f: ([a, m], e, ctx) => addMonths(e, ctx, a, m, true) },
  DATEDIF: {
    min: 3,
    max: 3,
    f: ([a, b, unit], e, ctx) => {
      const x = e.num(a, ctx);
      const y = e.num(b, ctx);
      const u = e.text(unit, ctx);
      if (isError(x)) return x;
      if (isError(y)) return y;
      if (isError(u)) return u;
      if (y < x) return NUM();
      const d1 = fromSerial(x);
      const d2 = fromSerial(y);
      let months = (d2.y - d1.y) * 12 + d2.m - d1.m - (d2.d < d1.d ? 1 : 0);
      switch (u.toUpperCase()) {
        case 'Y':
          return Math.floor(months / 12);
        case 'M':
          return months;
        case 'D':
          return Math.floor(y) - Math.floor(x);
        case 'YM':
          return months % 12;
        case 'MD': {
          months = (d2.y - d1.y) * 12 + d2.m - d1.m - (d2.d < d1.d ? 1 : 0);
          const anchor = toSerial(d1.y, d1.m + months, d1.d);
          return Math.floor(y) - Math.floor(anchor);
        }
        case 'YD': {
          let anchor = toSerial(d2.y, d1.m, d1.d);
          if (anchor > Math.floor(y)) anchor = toSerial(d2.y - 1, d1.m, d1.d);
          return Math.floor(y) - Math.floor(anchor);
        }
        default:
          return NUM();
      }
    },
  },
  NETWORKDAYS: {
    min: 2,
    max: 3,
    f: ([a, b, holidays], e, ctx) => {
      const x = e.num(a, ctx);
      const y = e.num(b, ctx);
      if (isError(x)) return x;
      if (isError(y)) return y;
      const off = holidays === undefined ? [] : e.numbers([holidays]);
      if (isError(off)) return off;
      const skip = new Set(off.map(Math.floor));
      const lo = Math.floor(Math.min(x, y));
      const hi = Math.floor(Math.max(x, y));
      if (hi - lo > 100_000) return NUM();
      let n = 0;
      for (let d = lo; d <= hi; d++) {
        const wd = fromSerial(d).wd;
        if (wd !== 0 && wd !== 6 && !skip.has(d)) n++;
      }
      return y < x ? -n : n;
    },
  },
  WORKDAY: {
    min: 2,
    max: 3,
    f: ([a, days, holidays], e, ctx) => {
      const start = e.num(a, ctx);
      const k = e.int(days, ctx);
      if (isError(start)) return start;
      if (isError(k)) return k;
      const off = holidays === undefined ? [] : e.numbers([holidays]);
      if (isError(off)) return off;
      const skip = new Set(off.map(Math.floor));
      let d = Math.floor(start);
      let left = Math.abs(k);
      const step = k < 0 ? -1 : 1;
      while (left > 0) {
        d += step;
        const wd = fromSerial(d).wd;
        if (wd !== 0 && wd !== 6 && !skip.has(d)) left--;
      }
      return d;
    },
  },

  // Recherche
  VLOOKUP: { min: 3, max: 4, f: (args, e, ctx) => vhlookup(args, e, ctx, true) },
  HLOOKUP: { min: 3, max: 4, f: (args, e, ctx) => vhlookup(args, e, ctx, false) },
  XLOOKUP: {
    min: 3,
    max: 6,
    f: ([needle, inList, outList, notFound, matchMode, searchMode], e, ctx) => {
      const v = e.scalar(needle, ctx);
      if (isError(v)) return v;
      const a = e.matrix(inList);
      const b = e.matrix(outList);
      if (isError(a)) return a;
      if (isError(b)) return b;
      const list = flatten(a);
      const mm = matchMode === undefined || matchMode === null ? 0 : e.int(matchMode, ctx);
      const sm = searchMode === undefined || searchMode === null ? 1 : e.int(searchMode, ctx);
      if (isError(mm)) return mm;
      if (isError(sm)) return sm;
      const order = sm < 0 ? [...list.keys()].reverse() : [...list.keys()];
      let idx = -1;
      if (mm === 0 || mm === 2) {
        const re = mm === 2 && typeof v === 'string' ? wildcard(v) : null;
        idx =
          order.find((i) => (re ? typeof list[i] === 'string' && re.test(list[i] as string) : list[i] !== null && e.compare(list[i], v) === 0)) ?? -1;
      } else {
        let best = -1;
        for (const i of order) {
          const x = list[i];
          if (x === null || typeof x !== typeof v) continue;
          const c = e.compare(x, v);
          if (c === 0) {
            best = i;
            break;
          }
          if ((mm === -1 && c < 0 && (best < 0 || e.compare(x, list[best]) > 0)) || (mm === 1 && c > 0 && (best < 0 || e.compare(x, list[best]) < 0)))
            best = i;
        }
        idx = best;
      }
      if (idx < 0) return notFound === undefined ? NA() : e.scalar(notFound, ctx);
      const out = a.length === 1 ? column(b, idx) : b[idx];
      return out?.[0] ?? null;
    },
  },
  MATCH: {
    min: 2,
    max: 3,
    f: ([needle, list, type], e, ctx) => {
      const v = e.scalar(needle, ctx);
      if (isError(v)) return v;
      const m = e.matrix(list);
      if (isError(m)) return m;
      if (m.length > 1 && (m[0]?.length ?? 0) > 1) return NA();
      const t = type === undefined ? 1 : e.int(type, ctx);
      if (isError(t)) return t;
      const i = lookup(e, v, flatten(m), t === 0 ? 0 : t > 0 ? 1 : -1, true);
      return i < 0 ? NA() : i + 1;
    },
  },
  INDEX: {
    min: 2,
    max: 3,
    f: ([a, row, col], e, ctx) => {
      const [rows, cols] = e.size(a);
      const r0 = e.int(row, ctx);
      const c0 = col === undefined ? null : e.int(col, ctx);
      if (isError(r0)) return r0;
      if (isError(c0)) return c0;
      // Une seule ligne et un seul numéro : position dans la ligne.
      const [r, c] = c0 === null && rows === 1 && cols > 1 ? [1, r0] : [r0, c0 ?? 1];
      if (r < 1 || c < 1 || r > rows || c > cols) return errorValue('#REF!');
      return e.at(a, r - 1, c - 1);
    },
  },
  CHOOSE: {
    min: 2,
    max: 255,
    lazy: (args, e, ctx) => {
      const i = e.int(e.eval(args[0], ctx), ctx);
      if (isError(i)) return i;
      if (i < 1 || i >= args.length) return VALUE();
      return e.eval(args[i], ctx);
    },
  },
  ROW: {
    min: 0,
    max: 1,
    lazy: (args, e, ctx) => {
      if (!args.length || args[0].k === 'empty') return ctx.r + 1;
      const v = e.eval(args[0], ctx);
      return isRange(v) ? v.r1 + 1 : VALUE();
    },
  },
  COLUMN: {
    min: 0,
    max: 1,
    lazy: (args, e, ctx) => {
      if (!args.length || args[0].k === 'empty') return ctx.c + 1;
      const v = e.eval(args[0], ctx);
      return isRange(v) ? v.c1 + 1 : VALUE();
    },
  },
  ROWS: { min: 1, max: 1, f: ([a], e) => e.size(a)[0] },
  COLUMNS: { min: 1, max: 1, f: ([a], e) => e.size(a)[1] },

  // Informations
  ISBLANK: { min: 1, max: 1, f: ([a], e, ctx) => e.scalar(a, ctx) === null },
  ISNUMBER: { min: 1, max: 1, f: ([a], e, ctx) => typeof e.scalar(a, ctx) === 'number' },
  ISTEXT: { min: 1, max: 1, f: ([a], e, ctx) => typeof e.scalar(a, ctx) === 'string' },
  ISLOGICAL: { min: 1, max: 1, f: ([a], e, ctx) => typeof e.scalar(a, ctx) === 'boolean' },
  ISERROR: { min: 1, max: 1, f: ([a], e, ctx) => isError(e.scalar(a, ctx)) },
  ISERR: {
    min: 1,
    max: 1,
    f: ([a], e, ctx) => {
      const v = e.scalar(a, ctx);
      return isError(v) && v.error !== '#N/A';
    },
  },
  ISNA: {
    min: 1,
    max: 1,
    f: ([a], e, ctx) => {
      const v = e.scalar(a, ctx);
      return isError(v) && v.error === '#N/A';
    },
  },
  NA: { min: 0, max: 0, f: () => NA() },

  // Finances
  PMT: { min: 3, max: 5, f: (args, e, ctx) => finance(args, e, ctx, (r, n, pv, fv, t) => pmt(r, n, pv, fv, t)) },
  FV: {
    min: 3,
    max: 5,
    f: (args, e, ctx) =>
      finance(args, e, ctx, (r, n, p, pv, t) => (r === 0 ? -(pv + p * n) : -(pv * (1 + r) ** n + (p * (1 + r * t) * ((1 + r) ** n - 1)) / r))),
  },
  PV: {
    min: 3,
    max: 5,
    f: (args, e, ctx) =>
      finance(args, e, ctx, (r, n, p, fv, t) => (r === 0 ? -(fv + p * n) : -(fv + (p * (1 + r * t) * ((1 + r) ** n - 1)) / r) / (1 + r) ** n)),
  },
  NPV: {
    min: 2,
    max: 255,
    f: ([rate, ...values], e, ctx) => {
      const r = e.num(rate, ctx);
      if (isError(r)) return r;
      const xs = e.numbers(values);
      if (isError(xs)) return xs;
      if (r === -1) return DIV0();
      return xs.reduce((acc, x, i) => acc + x / (1 + r) ** (i + 1), 0);
    },
  },
};

/** Noms (anglais) des fonctions disponibles. */
export const FUNCTION_NAMES = Object.keys(FUNCS).sort();

function rank([a, ref, order]: Val[], e: Engine, ctx: Ctx): Val {
  const x = e.num(a, ctx);
  if (isError(x)) return x;
  const xs = e.numbers([ref]);
  if (isError(xs)) return xs;
  const asc = order === undefined ? false : e.bool(order, ctx);
  if (isError(asc)) return asc;
  if (!xs.some((v) => numEq(v, x))) return NA();
  return xs.filter((v) => (asc ? v < x : v > x) && !numEq(v, x)).length + 1;
}

function condAgg(e: Engine, ctx: Ctx, target: Val, pairs: Val[], f: (xs: number[]) => number | ErrorValue): Val {
  const m = matchAll(e, pairs, ctx);
  if (isError(m)) return m;
  // Plage à additionner de la même taille que celle des critères (à partir de son coin), comme Excel.
  const base = isRange(target) ? { ...target, r2: target.r1 + m.rows - 1, c2: target.c1 + m.cols - 1 } : target;
  const values = e.matrix(base);
  if (isError(values)) return values;
  const xs: number[] = [];
  for (let i = 0; i < m.rows; i++)
    for (let j = 0; j < m.cols; j++) {
      if (!m.ok[i][j]) continue;
      const v = values[i]?.[j] ?? null;
      if (isError(v)) return v;
      if (typeof v === 'number') xs.push(v);
    }
  const r = f(xs);
  return typeof r === 'number' && !Number.isFinite(r) ? NUM() : r;
}

function logical(args: Val[], e: Engine, test: (xs: boolean[]) => boolean): Val {
  const xs: boolean[] = [];
  for (const a of args) {
    if (isMulti(a)) {
      let err: ErrorValue | null = null;
      e.each(a, (v) => {
        if (isError(v)) {
          err = v;
          return false;
        }
        if (typeof v === 'boolean') xs.push(v);
        else if (typeof v === 'number') xs.push(v !== 0);
      });
      if (err) return err;
    } else {
      const b = e.toBool(a as Scalar);
      if (isError(b)) return b;
      xs.push(b);
    }
  }
  return xs.length ? test(xs) : VALUE();
}

function roundFn([a, d]: Val[], e: Engine, ctx: Ctx, mode: 'round' | 'up' | 'down'): Val {
  const x = e.num(a, ctx);
  const digits = d === undefined ? 0 : e.num(d, ctx);
  if (isError(x)) return x;
  if (isError(digits)) return digits;
  return roundDigits(x, digits, mode);
}

function multipleFn([a, b]: Val[], e: Engine, ctx: Ctx, mode: 'up' | 'down'): Val {
  const x = e.num(a, ctx);
  const sig = b === undefined ? 1 : e.num(b, ctx);
  if (isError(x)) return x;
  if (isError(sig)) return sig;
  if (sig === 0) return mode === 'up' ? 0 : DIV0();
  if (x > 0 && sig < 0) return NUM();
  const q = Number((x / sig).toPrecision(15));
  return roundTo((mode === 'up' ? Math.ceil(q) : Math.floor(q)) * sig, 10);
}

function powerOf(e: Engine, x: Scalar, y: Scalar): Val {
  const a = e.toNumber(x);
  const b = e.toNumber(y);
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (a === 0 && b === 0) return NUM();
  if (a === 0 && b < 0) return DIV0();
  const r = a ** b;
  return Number.isFinite(r) ? r : NUM();
}

function sliceText(e: Engine, ctx: Ctx, a: Val, n: Val | undefined, f: (s: string[], k: number) => string[]): Val {
  const s = e.text(a, ctx);
  const k = n === undefined ? 1 : e.int(n, ctx);
  if (isError(s)) return s;
  if (isError(k)) return k;
  if (k < 0) return VALUE();
  return f([...s], k).join('');
}

function mapText(e: Engine, ctx: Ctx, a: Val, f: (s: string) => string): Val {
  const s = e.text(a, ctx);
  return isError(s) ? s : f(s);
}

function findText([needle, hay, start]: Val[], e: Engine, ctx: Ctx, insensitive: boolean): Val {
  const n = e.text(needle, ctx);
  const h = e.text(hay, ctx);
  const st = start === undefined ? 1 : e.int(start, ctx);
  if (isError(n)) return n;
  if (isError(h)) return h;
  if (isError(st)) return st;
  if (st < 1 || st > h.length + 1) return VALUE();
  if (insensitive && /[*?~]/.test(n)) {
    const re = wildcard(n);
    for (let i = st - 1; i <= h.length; i++) {
      for (let j = h.length; j >= i; j--) if (re.test(h.slice(i, j))) return i + 1;
    }
    return VALUE();
  }
  if (insensitive) {
    const i = h.toLowerCase().indexOf(n.toLowerCase(), st - 1);
    return i < 0 ? VALUE() : i + 1;
  }
  const i = h.indexOf(n, st - 1);
  return i < 0 ? VALUE() : i + 1;
}

function withDate(e: Engine, a: Val, ctx: Ctx, f: (d: ReturnType<typeof fromSerial>) => number): Val {
  const d = dateParts(e, a, ctx);
  return isError(d) ? d : f(d);
}

function addMonths(e: Engine, ctx: Ctx, a: Val, m: Val, endOfMonth: boolean): Val {
  const n = e.num(a, ctx);
  const k = e.int(m, ctx);
  if (isError(n)) return n;
  if (isError(k)) return k;
  if (n < 0) return NUM();
  const d = fromSerial(n);
  if (endOfMonth) return toSerial(d.y, d.m + k + 1, 0);
  const last = new Date(Date.UTC(d.y, d.m - 1 + k + 1, 0)).getUTCDate();
  return toSerial(d.y, d.m + k, Math.min(d.d, last));
}

function vhlookup([needle, table, index, approx]: Val[], e: Engine, ctx: Ctx, vertical: boolean): Val {
  const v = e.scalar(needle, ctx);
  if (isError(v)) return v;
  const m = e.matrix(table);
  if (isError(m)) return m;
  const k = e.int(index, ctx);
  if (isError(k)) return k;
  const sorted = approx === undefined || approx === null ? true : e.bool(approx, ctx);
  if (isError(sorted)) return sorted;
  const width = vertical ? (m[0]?.length ?? 0) : m.length;
  if (k < 1) return VALUE();
  if (k > width) return errorValue('#REF!');
  const keys = vertical ? column(m, 0) : (m[0] ?? []);
  const i = lookup(e, v, keys, sorted ? 1 : 0, !sorted);
  if (i < 0) return NA();
  return vertical ? (m[i][k - 1] ?? null) : (m[k - 1][i] ?? null);
}

function finance(args: Val[], e: Engine, ctx: Ctx, f: (r: number, n: number, x: number, y: number, t: number) => number): Val {
  const xs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = args[i];
    if (a === undefined || a === null) {
      xs.push(0);
      continue;
    }
    const n = e.num(a, ctx);
    if (isError(n)) return n;
    xs.push(n);
  }
  if (xs[1] === 0) return NUM();
  const r = f(xs[0], xs[1], xs[2], xs[3], xs[4] ? 1 : 0);
  return Number.isFinite(r) ? r : NUM();
}
