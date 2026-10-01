// Tableur (bloc « Tableur » des notes) : classeur enregistré en JSON dans le bloc (propriété `data`). Feuilles
// (onglets), cellules par adresse (« B3 ») avec leur valeur enregistrée (voir values.ts) et un numéro de style, largeurs
// de colonnes et hauteurs de lignes. Les modifications renvoient un nouveau classeur (l'ancien reste inchangé).
import { MAX_COLS, MAX_ROWS, addr, keyOf, parseAddr, type Rect } from './address';
import { adjustFormula, shiftFormula, type StructEdit } from './formula';
import { isFormula, type CellValue } from './values';

export type CellStyle = {
  /** Gras, italique, souligné, barré. */
  b?: 1;
  i?: 1;
  u?: 1;
  st?: 1;
  /** Couleurs du texte et du fond (#rrggbb). */
  c?: string;
  bg?: string;
  al?: 'left' | 'center' | 'right';
  /** Format de nombre (code Excel). */
  nf?: string;
  /** Retour à la ligne automatique. */
  wr?: 1;
};

/** Cellule enregistrée : valeur seule, ou [valeur, numéro de style]. */
export type StoredCell = CellValue | [CellValue, number];

export type Sheet = {
  name: string;
  cells: Record<string, StoredCell>;
  /** Largeurs de colonnes et hauteurs de lignes modifiées (px), par numéro (0 = colonne A ou ligne 1). */
  cw?: Record<string, number>;
  rh?: Record<string, number>;
};

export type Workbook = { v: 1; sheets: Sheet[]; styles: CellStyle[] };

export type Cell = { v: CellValue; s: number };

/** Au-delà, la page deviendrait trop lourde à enregistrer et à synchroniser à chaque modification. */
export const MAX_CELLS = 50_000;
export const DEFAULT_COL_WIDTH = 100;
export const DEFAULT_ROW_HEIGHT = 25;

const EMPTY: Cell = { v: null, s: 0 };

export function readCell(stored: StoredCell | undefined): Cell {
  if (stored === undefined) return EMPTY;
  if (Array.isArray(stored)) return { v: stored[0] ?? null, s: Number(stored[1]) || 0 };
  return { v: stored, s: 0 };
}

const pack = (v: CellValue, s: number): StoredCell | undefined => (s ? [v === '' ? null : v, s] : v === null || v === '' ? undefined : v);

export const cellAt = (sheet: Sheet, r: number, c: number): Cell => readCell(sheet.cells[addr(r, c)]);

// ---------- Index des cellules (accès rapide), en cache par feuille ----------

export type SheetIndex = {
  cells: Map<number, Cell>;
  /** Formules (clés). */
  formulas: number[];
  /** Nombre de lignes et de colonnes utilisées (valeur ou style). */
  rows: number;
  cols: number;
};

const indexes = new WeakMap<Sheet, SheetIndex>();

export function indexSheet(sheet: Sheet): SheetIndex {
  let idx = indexes.get(sheet);
  if (idx) return idx;
  const cells = new Map<number, Cell>();
  const formulas: number[] = [];
  let rows = 0;
  let cols = 0;
  for (const [a, stored] of Object.entries(sheet.cells)) {
    const p = parseAddr(a);
    if (!p) continue;
    const cell = readCell(stored);
    const k = keyOf(p.r, p.c);
    cells.set(k, cell);
    rows = Math.max(rows, p.r + 1);
    cols = Math.max(cols, p.c + 1);
    if (isFormula(cell.v)) formulas.push(k);
  }
  idx = { cells, formulas, rows, cols };
  indexes.set(sheet, idx);
  return idx;
}

// ---------- Lecture et écriture du JSON ----------

const COLOR = /^#[0-9a-f]{6}$/i;

export function cleanStyle(st: unknown): CellStyle {
  const s = (st && typeof st === 'object' ? st : {}) as Record<string, unknown>;
  const out: CellStyle = {};
  if (s.b) out.b = 1;
  if (s.i) out.i = 1;
  if (s.u) out.u = 1;
  if (s.st) out.st = 1;
  if (s.wr) out.wr = 1;
  if (typeof s.c === 'string' && COLOR.test(s.c)) out.c = s.c.toLowerCase();
  if (typeof s.bg === 'string' && COLOR.test(s.bg)) out.bg = s.bg.toLowerCase();
  if (s.al === 'left' || s.al === 'center' || s.al === 'right') out.al = s.al;
  if (typeof s.nf === 'string' && s.nf && s.nf.length < 200 && !/^general$/i.test(s.nf)) out.nf = s.nf;
  return out;
}

export const emptyWorkbook = (sheetName: string): Workbook => ({ v: 1, sheets: [{ name: sheetName, cells: {} }], styles: [{}] });

const cleanSizes = (m: unknown): Record<string, number> | undefined => {
  if (!m || typeof m !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) if (/^\d+$/.test(k) && Number.isFinite(v) && Number(v) > 0) out[k] = Math.min(2000, Math.round(Number(v)));
  return Object.keys(out).length ? out : undefined;
};

/** Classeur enregistré dans le bloc ; classeur vide (une feuille nommée `sheetName`) si absent ou illisible. */
export function parseWorkbook(json: string, sheetName: string): Workbook {
  if (json) {
    try {
      const d = JSON.parse(json) as { sheets?: unknown; styles?: unknown };
      if (Array.isArray(d.sheets) && d.sheets.length) {
        const styles = Array.isArray(d.styles) && d.styles.length ? d.styles.map(cleanStyle) : [{}];
        const used = new Set<string>();
        const sheets: Sheet[] = d.sheets.map((raw, i) => {
          const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
          let name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 31) : `${sheetName.replace(/\d+$/, '')}${i + 1}`;
          while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} (${i + 1})`;
          used.add(name.toLowerCase());
          const cells = s.cells && typeof s.cells === 'object' && !Array.isArray(s.cells) ? (s.cells as Record<string, StoredCell>) : {};
          const sheet: Sheet = { name, cells };
          const cw = cleanSizes(s.cw);
          const rh = cleanSizes(s.rh);
          if (cw) sheet.cw = cw;
          if (rh) sheet.rh = rh;
          return sheet;
        });
        return { v: 1, sheets, styles };
      }
    } catch {
      /* données illisibles : classeur vide */
    }
  }
  return emptyWorkbook(sheetName);
}

/** JSON à enregistrer (styles inutilisés retirés). */
export function serializeWorkbook(wb: Workbook): string {
  return JSON.stringify(compactStyles(wb));
}

/** Nombre de cellules remplies ou mises en forme du classeur. */
export const countCells = (wb: Workbook): number => wb.sheets.reduce((n, s) => n + Object.keys(s.cells).length, 0);

// ---------- Styles ----------

export const styleAt = (wb: Workbook, s: number): CellStyle => wb.styles[s] ?? {};

const styleKey = (st: CellStyle) =>
  JSON.stringify(
    Object.keys(st)
      .sort()
      .map((k) => [k, st[k as keyof CellStyle]]),
  );

/** Numéro du style (ajouté au classeur s'il n'existe pas encore). */
export function internStyle(wb: Workbook, style: CellStyle): [Workbook, number] {
  const clean = cleanStyle(style);
  if (!Object.keys(clean).length) return [wb, 0];
  const key = styleKey(clean);
  const i = wb.styles.findIndex((st, n) => n > 0 && styleKey(st) === key);
  if (i > 0) return [wb, i];
  return [{ ...wb, styles: [...wb.styles, clean] }, wb.styles.length];
}

function compactStyles(wb: Workbook): Workbook {
  const used = new Set<number>();
  for (const sheet of wb.sheets) for (const stored of Object.values(sheet.cells)) if (Array.isArray(stored)) used.add(Number(stored[1]) || 0);
  if (used.size + 1 >= wb.styles.length) return wb;
  const remap = new Map<number, number>([[0, 0]]);
  const styles: CellStyle[] = [{}];
  for (const i of [...used].sort((a, b) => a - b)) {
    if (i === 0 || !wb.styles[i]) continue;
    remap.set(i, styles.length);
    styles.push(wb.styles[i]);
  }
  const sheets = wb.sheets.map((sheet) => {
    const cells: Record<string, StoredCell> = {};
    for (const [a, stored] of Object.entries(sheet.cells)) {
      if (!Array.isArray(stored)) cells[a] = stored;
      else {
        const packed = pack(stored[0] ?? null, remap.get(Number(stored[1]) || 0) ?? 0);
        if (packed !== undefined) cells[a] = packed;
      }
    }
    return { ...sheet, cells };
  });
  return { ...wb, sheets, styles };
}

// ---------- Cellules ----------

/** Modification d'une cellule ; `v` ou `s` absents : inchangés. */
export type CellChange = { r: number; c: number; v?: CellValue; s?: number };

const replaceSheet = (wb: Workbook, si: number, sheet: Sheet): Workbook => ({ ...wb, sheets: wb.sheets.map((s, i) => (i === si ? sheet : s)) });

export function setCells(wb: Workbook, si: number, changes: CellChange[]): Workbook {
  if (!changes.length) return wb;
  const sheet = wb.sheets[si];
  const cells = { ...sheet.cells };
  for (const ch of changes) {
    const a = addr(ch.r, ch.c);
    const cur = readCell(cells[a]);
    const packed = pack(ch.v === undefined ? cur.v : ch.v, ch.s === undefined ? cur.s : ch.s);
    if (packed === undefined) delete cells[a];
    else cells[a] = packed;
  }
  return replaceSheet(wb, si, { ...sheet, cells });
}

/** Cellules existantes (remplies ou mises en forme) d'une plage. */
export function cellsIn(sheet: Sheet, rect: Rect): { r: number; c: number; cell: Cell }[] {
  const idx = indexSheet(sheet);
  const out: { r: number; c: number; cell: Cell }[] = [];
  const area = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
  if (area <= idx.cells.size) {
    for (let r = rect.r1; r <= rect.r2; r++)
      for (let c = rect.c1; c <= rect.c2; c++) {
        const cell = idx.cells.get(keyOf(r, c));
        if (cell) out.push({ r, c, cell });
      }
  } else {
    for (const [k, cell] of idx.cells) {
      const r = Math.floor(k / MAX_COLS);
      const c = k % MAX_COLS;
      if (r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2) out.push({ r, c, cell });
    }
  }
  return out;
}

/** Applique un changement de style aux cellules d'une plage (limitée à la partie utilisée pour une colonne entière). */
export function applyStyle(wb: Workbook, si: number, rect: Rect, patch: (st: CellStyle) => CellStyle): Workbook {
  const sheet = wb.sheets[si];
  const idx = indexSheet(sheet);
  const r2 = Math.min(rect.r2, Math.max(rect.r1, idx.rows - 1, rect.r1 + 199));
  const c2 = Math.min(rect.c2, Math.max(rect.c1, idx.cols - 1, rect.c1 + 49));
  const memo = new Map<number, number>();
  let next = wb;
  const changes: CellChange[] = [];
  for (let r = rect.r1; r <= r2; r++)
    for (let c = rect.c1; c <= c2; c++) {
      const cur = idx.cells.get(keyOf(r, c)) ?? EMPTY;
      let s = memo.get(cur.s);
      if (s === undefined) {
        [next, s] = internStyle(next, patch(styleAt(next, cur.s)));
        memo.set(cur.s, s);
      }
      if (s !== cur.s) changes.push({ r, c, s });
    }
  return setCells(next, si, changes);
}

// ---------- Lignes, colonnes ----------

/** Toutes les formules du classeur réécrites par `fix` (feuille de la formule en argument). */
function mapFormulas(wb: Workbook, fix: (formula: string, sheetName: string) => string): Workbook {
  let changed = false;
  const sheets = wb.sheets.map((sheet) => {
    let cells: Record<string, StoredCell> | null = null;
    for (const [a, stored] of Object.entries(sheet.cells)) {
      const cell = readCell(stored);
      if (!isFormula(cell.v)) continue;
      const f = fix(cell.v, sheet.name);
      if (f === cell.v) continue;
      cells ??= { ...sheet.cells };
      cells[a] = pack(f, cell.s)!;
    }
    if (!cells) return sheet;
    changed = true;
    return { ...sheet, cells };
  });
  return changed ? { ...wb, sheets } : wb;
}

function shiftSizes(m: Record<string, number> | undefined, at: number, delta: number): Record<string, number> | undefined {
  if (!m) return m;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) {
    const i = Number(k);
    if (i < at) out[k] = v;
    else if (delta > 0) out[String(i + delta)] = v;
    else if (i >= at - delta) out[String(i + delta)] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Lignes (`axis` = 'rows') ou colonnes insérées (`delta` > 0) ou supprimées (`delta` < 0) à partir de `at` sur une
 * feuille ; les formules de tout le classeur suivent, comme dans Excel.
 */
export function shiftAxis(wb: Workbook, si: number, axis: 'rows' | 'cols', at: number, delta: number): Workbook {
  const sheet = wb.sheets[si];
  const cells: Record<string, StoredCell> = {};
  const max = axis === 'rows' ? MAX_ROWS : MAX_COLS;
  for (const [a, stored] of Object.entries(sheet.cells)) {
    const p = parseAddr(a);
    if (!p) continue;
    let { r, c } = p;
    const i = axis === 'rows' ? r : c;
    if (i >= at) {
      if (delta < 0 && i < at - delta) continue;
      const j = i + delta;
      if (j >= max) continue;
      if (axis === 'rows') r = j;
      else c = j;
    }
    cells[addr(r, c)] = stored;
  }
  const moved: Sheet = { ...sheet, cells };
  if (axis === 'rows') moved.rh = shiftSizes(sheet.rh, at, delta);
  else moved.cw = shiftSizes(sheet.cw, at, delta);
  if (!moved.rh) delete moved.rh;
  if (!moved.cw) delete moved.cw;
  const edit: StructEdit = { kind: axis, sheet: sheet.name, at, delta };
  return mapFormulas(replaceSheet(wb, si, moved), (f, own) => adjustFormula(f, own, edit));
}

/**
 * Trie les lignes d'une plage selon une colonne (valeurs calculées données par `valueAt`) : nombres, puis textes, puis
 * booléens, cellules vides à la fin. Les formules déplacées sont recopiées (références relatives décalées).
 */
export function sortRange(wb: Workbook, si: number, rect: Rect, byCol: number, desc: boolean, valueAt: (r: number, c: number) => unknown): Workbook {
  const sheet = wb.sheets[si];
  const rows: number[] = [];
  for (let r = rect.r1; r <= rect.r2; r++) rows.push(r);
  const rank = (v: unknown) =>
    v === null || v === '' || v === undefined ? 3 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3;
  const keyed = rows.map((r) => ({ r, v: valueAt(r, byCol) }));
  keyed.sort((a, b) => {
    const ra = rank(a.v);
    const rb = rank(b.v);
    if (ra !== rb || ra === 3) return ra - rb || a.r - b.r;
    let cmp = 0;
    if (ra === 0) cmp = (a.v as number) - (b.v as number);
    else if (ra === 1) cmp = (a.v as string).localeCompare(b.v as string, undefined, { sensitivity: 'base', numeric: true });
    else cmp = Number(a.v) - Number(b.v);
    return (desc ? -cmp : cmp) || a.r - b.r;
  });
  const changes: CellChange[] = [];
  keyed.forEach(({ r: from }, i) => {
    const to = rect.r1 + i;
    if (from === to) return;
    for (let c = rect.c1; c <= rect.c2; c++) {
      const cell = cellAt(sheet, from, c);
      changes.push({ r: to, c, v: isFormula(cell.v) ? shiftFormula(cell.v, to - from, 0) : cell.v, s: cell.s });
    }
  });
  return setCells(wb, si, changes);
}

// ---------- Feuilles ----------

/** Raison pour laquelle un nom de feuille est refusé (Excel : 31 caractères, sans [ ] : * ? / \), ou null. */
export function sheetNameProblem(wb: Workbook, name: string, except = -1): 'empty' | 'chars' | 'taken' | null {
  const n = name.trim();
  if (!n || n.length > 31) return 'empty';
  if (/[[\]:*?/\\]/.test(n) || n.startsWith("'") || n.endsWith("'")) return 'chars';
  if (wb.sheets.some((s, i) => i !== except && s.name.toLowerCase() === n.toLowerCase())) return 'taken';
  return null;
}

export function addSheet(wb: Workbook, name: string): Workbook {
  return { ...wb, sheets: [...wb.sheets, { name, cells: {} }] };
}

export function renameSheet(wb: Workbook, si: number, name: string): Workbook {
  const old = wb.sheets[si].name;
  const renamed = replaceSheet(wb, si, { ...wb.sheets[si], name });
  return mapFormulas(renamed, (f, own) => adjustFormula(f, own, { kind: 'rename', sheet: old, to: name }));
}

export function deleteSheet(wb: Workbook, si: number): Workbook {
  const name = wb.sheets[si].name;
  const rest = { ...wb, sheets: wb.sheets.filter((_, i) => i !== si) };
  return mapFormulas(rest, (f, own) => adjustFormula(f, own, { kind: 'delete-sheet', sheet: name }));
}

/** Nom libre pour une nouvelle feuille (« Feuil2 », « Feuil3 »…). */
export function nextSheetName(wb: Workbook, base: string): string {
  for (let i = wb.sheets.length + 1; ; i++) {
    const name = `${base}${i}`;
    if (!wb.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) return name;
  }
}

/** Nom de feuille valable tiré d'un texte quelconque (nom de fichier importé…), ou null. */
export function cleanSheetName(raw: string): string | null {
  const name = raw
    .replace(/[[\]:*?/\\]+/g, ' ')
    .replace(/^'+|'+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
    .trim();
  return name || null;
}

/** Feuilles d'un autre classeur (fichier importé) ajoutées après celles-ci, renommées si leur nom est déjà pris. */
export function appendWorkbook(base: Workbook, add: Workbook): Workbook {
  let incoming = add;
  const taken = (name: string, except: number) =>
    base.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase()) ||
    incoming.sheets.some((s, i) => i !== except && s.name.toLowerCase() === name.toLowerCase());
  incoming.sheets.forEach((s, i) => {
    if (!taken(s.name, i)) return;
    let name = s.name;
    for (let n = 2; taken(name, i); n++) name = `${s.name.slice(0, 26)} (${n})`;
    incoming = renameSheet(incoming, i, name);
  });
  let next = base;
  const remap = new Map<number, number>([[0, 0]]);
  incoming.styles.forEach((st, i) => {
    if (i === 0) return;
    let s: number;
    [next, s] = internStyle(next, st);
    remap.set(i, s);
  });
  const sheets = incoming.sheets.map((sheet) => {
    const cells: Record<string, StoredCell> = {};
    for (const [a, stored] of Object.entries(sheet.cells)) {
      const cell = readCell(stored);
      const packed = pack(cell.v, remap.get(cell.s) ?? 0);
      if (packed !== undefined) cells[a] = packed;
    }
    return { ...sheet, cells };
  });
  return { ...next, sheets: [...next.sheets, ...sheets] };
}

/** Largeurs de colonnes (`cw`) ou hauteurs de lignes (`rh`) changées ; `size` null : taille par défaut. */
export function setSizes(wb: Workbook, si: number, key: 'cw' | 'rh', indexes: number[], size: number | null): Workbook {
  const sheet = wb.sheets[si];
  const def = key === 'cw' ? DEFAULT_COL_WIDTH : DEFAULT_ROW_HEIGHT;
  const sizes: Record<string, number> = { ...(sheet[key] ?? {}) };
  for (const i of indexes) {
    if (size === null || Math.round(size) === def) delete sizes[i];
    else sizes[i] = Math.max(4, Math.min(2000, Math.round(size)));
  }
  const next: Sheet = { ...sheet };
  if (Object.keys(sizes).length) next[key] = sizes;
  else delete next[key];
  return replaceSheet(wb, si, next);
}

/** Copie d'une feuille, placée juste après elle. */
export function duplicateSheet(wb: Workbook, si: number, name: string): Workbook {
  const src = wb.sheets[si];
  const copy: Sheet = { ...src, name, cells: { ...src.cells } };
  const sheets = [...wb.sheets];
  sheets.splice(si + 1, 0, copy);
  return { ...wb, sheets };
}

/**
 * Couper-coller dans une feuille : cellules de `src` déplacées en (`r`, `c`) ; les formules du classeur qui les
 * citaient les suivent, celles des cellules déplacées gardent leurs autres références (comme Excel).
 */
export function moveRange(wb: Workbook, si: number, src: Rect, r: number, c: number): Workbook {
  const dr = r - src.r1;
  const dc = c - src.c1;
  if ((!dr && !dc) || src.r2 + dr >= MAX_ROWS || src.c2 + dc >= MAX_COLS) return wb;
  const name = wb.sheets[si].name;
  const moved = cellsIn(wb.sheets[si], src);
  const next = mapFormulas(wb, (f, own) => adjustFormula(f, own, { kind: 'move', sheet: name, ...src, dr, dc }));
  const sheet = next.sheets[si];
  const dest = { r1: src.r1 + dr, c1: src.c1 + dc, r2: src.r2 + dr, c2: src.c2 + dc };
  const changes: CellChange[] = [];
  for (const { r: rr, c: cc } of moved) changes.push({ r: rr, c: cc, v: null, s: 0 });
  for (const { r: rr, c: cc } of cellsIn(sheet, dest)) changes.push({ r: rr, c: cc, v: null, s: 0 });
  for (const { r: rr, c: cc } of moved) {
    const cell = cellAt(sheet, rr, cc);
    changes.push({ r: rr + dr, c: cc + dc, v: cell.v, s: cell.s });
  }
  return setCells(next, si, changes);
}
