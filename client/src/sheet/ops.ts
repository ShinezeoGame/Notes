// Tableur : opérations de la grille, sans interface (déplacements Ctrl+flèches, zone de données, somme automatique,
// recopie, format automatique des formules de date, statistiques de la sélection, explication des erreurs).
import { t, type Lang } from '../lib/i18n';
import { MAX_COLS, MAX_ROWS, keyOf, type Rect } from './address';
import type { Engine } from './engine';
import { fillSeries } from './fill';
import { FORMATS, isDateFormat, isTimeFormat } from './format';
import { canonicalName, displayName, parseFormula, shiftFormula, tokenize, type Node } from './formula';
import { cellAt, cellsIn, indexSheet, styleAt, type CellChange, type Sheet, type Workbook } from './model';
import { isFormula, type ErrorValue } from './values';

const filled = (sheet: Sheet, r: number, c: number): boolean => {
  const cell = indexSheet(sheet).cells.get(keyOf(r, c));
  return !!cell && cell.v !== null && cell.v !== '';
};

/** Ctrl+flèche : bord de la zone de données dans la direction (dr, dc), comme Excel. */
export function jump(sheet: Sheet, r: number, c: number, dr: number, dc: number): { r: number; c: number } {
  const idx = indexSheet(sheet);
  const maxR = MAX_ROWS - 1;
  const maxC = MAX_COLS - 1;
  const inside = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr <= maxR && cc <= maxC;
  // Au-delà de la partie utilisée : bord de la feuille.
  const beyond = (rr: number, cc: number) => (dr > 0 && rr >= idx.rows) || (dc > 0 && cc >= idx.cols);
  let rr = r + dr;
  let cc = c + dc;
  if (!inside(rr, cc)) return { r, c };
  if (filled(sheet, r, c) && filled(sheet, rr, cc)) {
    // Dans un bloc rempli : jusqu'à sa dernière cellule.
    while (inside(rr + dr, cc + dc) && filled(sheet, rr + dr, cc + dc)) {
      rr += dr;
      cc += dc;
    }
    return { r: rr, c: cc };
  }
  // Sinon : prochaine cellule remplie, ou le bord.
  while (inside(rr, cc) && !filled(sheet, rr, cc)) {
    if (beyond(rr, cc)) return { r: dr ? (dr > 0 ? maxR : 0) : r, c: dc ? (dc > 0 ? maxC : 0) : c };
    rr += dr;
    cc += dc;
  }
  if (!inside(rr, cc)) return { r: dr ? (dr > 0 ? maxR : 0) : r, c: dc ? (dc > 0 ? maxC : 0) : c };
  return { r: rr, c: cc };
}

/** Bloc de cellules remplies autour d'une cellule (zone de données d'Excel). */
export function currentRegion(sheet: Sheet, r: number, c: number): Rect {
  const rect = { r1: r, c1: c, r2: r, c2: c };
  const idx = indexSheet(sheet);
  const any = (r1: number, c1: number, r2: number, c2: number) => {
    for (let rr = Math.max(0, r1); rr <= Math.min(r2, idx.rows - 1); rr++)
      for (let cc = Math.max(0, c1); cc <= Math.min(c2, idx.cols - 1); cc++) if (filled(sheet, rr, cc)) return true;
    return false;
  };
  for (let changed = true; changed; ) {
    changed = false;
    if (rect.r1 > 0 && any(rect.r1 - 1, rect.c1 - 1, rect.r1 - 1, rect.c2 + 1)) {
      rect.r1--;
      changed = true;
    }
    if (rect.r2 < idx.rows - 1 && any(rect.r2 + 1, rect.c1 - 1, rect.r2 + 1, rect.c2 + 1)) {
      rect.r2++;
      changed = true;
    }
    if (rect.c1 > 0 && any(rect.r1 - 1, rect.c1 - 1, rect.r2 + 1, rect.c1 - 1)) {
      rect.c1--;
      changed = true;
    }
    if (rect.c2 < idx.cols - 1 && any(rect.r1 - 1, rect.c2 + 1, rect.r2 + 1, rect.c2 + 1)) {
      rect.c2++;
      changed = true;
    }
  }
  return rect;
}

/** Ligne d'en-tête probable en haut d'une plage à trier (textes au-dessus de nombres, ou en gras). */
export function hasHeader(wb: Workbook, si: number, rect: Rect, engine: Engine): boolean {
  if (rect.r2 <= rect.r1) return false;
  const sheet = wb.sheets[si];
  let texts = 0;
  let bold = true;
  for (let c = rect.c1; c <= rect.c2; c++) {
    const v = engine.value(si, rect.r1, c);
    if (v === null) continue;
    if (typeof v !== 'string') return false;
    texts++;
    if (!styleAt(wb, cellAt(sheet, rect.r1, c).s).b) bold = false;
  }
  if (!texts) return false;
  if (bold) return true;
  for (let c = rect.c1; c <= rect.c2; c++) if (typeof engine.value(si, rect.r1 + 1, c) === 'number') return true;
  return false;
}

/** Somme automatique (Σ) : plage de nombres au-dessus de la cellule, sinon à sa gauche. */
export function autoSumRange(engine: Engine, si: number, r: number, c: number): Rect | null {
  const isNum = (rr: number, cc: number) => rr >= 0 && cc >= 0 && typeof engine.value(si, rr, cc) === 'number';
  const run = (dr: number, dc: number): Rect | null => {
    let rr = r + dr;
    let cc = c + dc;
    // Cellules vides juste à côté : ignorées (Excel saute une ligne vide sous un tableau).
    if (!isNum(rr, cc)) return null;
    while (isNum(rr + dr, cc + dc)) {
      rr += dr;
      cc += dc;
    }
    return dr ? { r1: rr, c1: c, r2: r - 1, c2: c } : { r1: r, c1: cc, r2: r, c2: c - 1 };
  };
  return run(-1, 0) ?? run(0, -1);
}

const DATE_FNS = new Set(['TODAY', 'DATE', 'EDATE', 'EOMONTH', 'WORKDAY']);

/** Format proposé pour une nouvelle formule (date pour AUJOURDHUI(), DATE()… ou une date + un nombre), sinon rien. */
export function autoFormat(formula: string, wb: Workbook, si: number): string | undefined {
  const ast = parseFormula(formula);
  if (!ast) return undefined;
  const fmtOf = (n: Node): string | undefined => {
    if (n.k === 'fn') {
      const name = canonicalName(n.name);
      if (DATE_FNS.has(name)) return FORMATS.date;
      if (name === 'NOW') return FORMATS.datetime;
      if (name === 'TIME') return FORMATS.time;
      return undefined;
    }
    if (n.k === 'ref' && n.ref.kind === 'cell') {
      const sheetIndex = n.ref.sheet === null ? si : wb.sheets.findIndex((s) => s.name.toLowerCase() === n.ref.sheet!.toLowerCase());
      const sheet = wb.sheets[sheetIndex];
      if (!sheet) return undefined;
      const nf = styleAt(wb, cellAt(sheet, n.ref.a.row, n.ref.a.col).s).nf;
      return isDateFormat(nf) ? nf : undefined;
    }
    if (n.k === 'bin' && (n.op === '+' || n.op === '-')) {
      const a = fmtOf(n.a);
      const b = fmtOf(n.b);
      // Date + nombre : date ; date - date : nombre de jours.
      if (a && !b) return a;
      if (b && !a && n.op === '+') return b;
      return undefined;
    }
    return undefined;
  };
  const nf = fmtOf(ast);
  return nf && (isDateFormat(nf) || isTimeFormat(nf)) ? nf : undefined;
}

/**
 * Recopie avec la poignée : cellules de `src` prolongées de `count` lignes ou colonnes dans la direction `dir`
 * (suites de nombres et de dates, textes numérotés, formules décalées).
 */
export function fillChanges(wb: Workbook, si: number, src: Rect, dir: 'down' | 'up' | 'right' | 'left', count: number): CellChange[] {
  const sheet = wb.sheets[si];
  const changes: CellChange[] = [];
  const vertical = dir === 'down' || dir === 'up';
  const sign = dir === 'down' || dir === 'right' ? 1 : -1;
  const lines = vertical ? [src.c1, src.c2] : [src.r1, src.r2];
  const span = vertical ? [src.r1, src.r2] : [src.c1, src.c2];
  for (let line = lines[0]; line <= lines[1]; line++) {
    const order: number[] = [];
    for (let i = span[0]; i <= span[1]; i++) order.push(i);
    if (sign < 0) order.reverse();
    const sources = order.map((i) => {
      const cell = vertical ? cellAt(sheet, i, line) : cellAt(sheet, line, i);
      return { v: cell.v, s: cell.s, date: isDateFormat(styleAt(wb, cell.s).nf) };
    });
    const out = fillSeries(sources, count, (f, k) => (vertical ? shiftFormula(f, sign * k, 0) : shiftFormula(f, 0, sign * k)));
    out.forEach((cell, k) => {
      const pos = sign > 0 ? span[1] + 1 + k : span[0] - 1 - k;
      if (pos < 0 || pos >= (vertical ? MAX_ROWS : MAX_COLS)) return;
      changes.push(vertical ? { r: pos, c: line, v: cell.v, s: cell.s } : { r: line, c: pos, v: cell.v, s: cell.s });
    });
  }
  return changes;
}

/** Ctrl+D (vers le bas) ou Ctrl+R (vers la droite) : première ligne ou colonne recopiée dans le reste de la sélection. */
export function copyDownRight(wb: Workbook, si: number, rect: Rect, down: boolean): CellChange[] {
  const sheet = wb.sheets[si];
  const changes: CellChange[] = [];
  // Une seule ligne (colonne) sélectionnée : recopie de celle du dessus (de gauche).
  const single = down ? rect.r1 === rect.r2 : rect.c1 === rect.c2;
  const from = down ? (single ? rect.r1 - 1 : rect.r1) : single ? rect.c1 - 1 : rect.c1;
  if (from < 0) return changes;
  for (let r = rect.r1; r <= rect.r2; r++)
    for (let c = rect.c1; c <= rect.c2; c++) {
      const sr = down ? from : r;
      const sc = down ? c : from;
      if (sr === r && sc === c) continue;
      const cell = cellAt(sheet, sr, sc);
      changes.push({ r, c, v: isFormula(cell.v) ? shiftFormula(cell.v, r - sr, c - sc) : cell.v, s: cell.s });
    }
  return changes;
}

/** Barre d'état : nombre de cellules remplies, somme et moyenne des nombres de la sélection. */
export function selectionStats(engine: Engine, si: number, rect: Rect): { count: number; numbers: number; sum: number } {
  const sheet = engine.wb.sheets[si];
  let count = 0;
  let numbers = 0;
  let sum = 0;
  for (const { r, c, cell } of cellsIn(sheet, rect)) {
    if (cell.v === null || cell.v === '') continue;
    count++;
    const v = isFormula(cell.v) ? engine.value(si, r, c) : cell.v;
    if (typeof v === 'number') {
      numbers++;
      sum += v;
    }
  }
  return { count, numbers, sum };
}

/** Explication d'une erreur de formule (infobulle de la cellule). */
export function errorHelp(err: ErrorValue, lang: Lang): string {
  const name = (m: string | undefined, prefix: string) => (m?.startsWith(prefix) ? m.slice(prefix.length) : '');
  switch (err.error) {
    case '#DIV/0!':
      return t('Division par zéro.');
    case '#N/A':
      return t('Valeur introuvable.');
    case '#NAME?': {
      const fn = name(err.message, 'fn:');
      if (fn) return t('Fonction inconnue : {name}.', { name: fn });
      return t('Nom inconnu : {name}. Mettez le texte entre guillemets.', { name: name(err.message, 'name:') });
    }
    case '#REF!':
      return err.message === 'circular'
        ? t('Référence circulaire : la formule dépend de sa propre cellule.')
        : t('Référence invalide (cellule ou feuille supprimée).');
    case '#VALUE!': {
      const fn = name(err.message, 'args:');
      if (fn) return t('Nombre d’arguments incorrect pour {name}.', { name: displayName(fn, lang) });
      if (err.message === 'deep') return t('Calcul trop complexe.');
      return t('Valeur de type incorrect (du texte au lieu d’un nombre ?).');
    }
    case '#NUM!':
      return t('Nombre incorrect ou hors limites.');
    case '#NULL!':
      return t('Ces plages n’ont aucune cellule en commun.');
    case '#ERROR!':
      return t('Formule incorrecte.');
    default:
      return '';
  }
}

/**
 * Formule en cours de saisie : une référence peut-elle être insérée à la position `caret` (juste après « = », un
 * opérateur, une parenthèse ou un séparateur) ?
 */
export function canInsertRef(text: string, caret: number, lang: Lang): boolean {
  if (!text.startsWith('=') || caret < 1) return false;
  const after = text.slice(caret);
  if (after && !/^[\s);,+\-*/^&=<>:]/.test(after)) return false;
  const tokens = tokenize(text.slice(1, caret), lang).filter((tk) => tk.type !== 'ws');
  const lastTok = tokens[tokens.length - 1];
  if (!lastTok) return true;
  if (lastTok.type === 'op') return lastTok.text !== '%';
  return lastTok.type === 'open' || lastTok.type === 'sep';
}

/** Nom de fonction en cours de saisie avant `caret` (pour la liste de suggestions), ou null. */
export function typedFunctionPrefix(text: string, caret: number): { start: number; prefix: string } | null {
  if (!text.startsWith('=')) return null;
  const before = text.slice(0, caret);
  // Pas dans une chaîne entre guillemets.
  if ((before.match(/"/g) ?? []).length % 2) return null;
  const m = /(^|[=(;,+\-*/^&<>\s])([A-Za-zÀ-ɏ][A-Za-z0-9.À-ɏ]*)$/.exec(before);
  if (!m) return null;
  if (/^[A-Za-z]{1,3}\d+$/.test(m[2])) return null;
  return { start: caret - m[2].length, prefix: m[2] };
}
