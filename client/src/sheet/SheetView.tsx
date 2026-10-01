// Tableur : grille du bloc « Tableur » (et son plein écran). Barre d'outils, barre de formule, cellules (seules les
// cellules visibles sont dessinées), sélection à la souris, au doigt et au clavier, saisie avec suggestions de
// fonctions et références désignées en cliquant, poignée de recopie, menu contextuel, onglets des feuilles.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { readableOn, useThemeBase } from '../lib/appearance';
import { getLang, t, tn } from '../lib/i18n';
import { isNative } from '../lib/settings';
import { saveFile, shareFile, type FileKind } from '../pdf/save';
import { MAX_COLS, MAX_ROWS, addr, colName, keyOf, normRect, parseAddr, rectName, type Rect } from './address';
import { Axis } from './axis';
import { buildCopy, forgetCut, lastCopy, readPaste, SHEET_MIME, type ClipData, type CopyCell } from './clipboard';
import { Engine, FUNCTION_NAMES } from './engine';
import {
  FORMATS,
  adjustDecimals,
  currencyFormat,
  editText,
  formatValue,
  generalNumber,
  isDateFormat,
  isPercentFormat,
  isTextFormat,
  isTimeFormat,
  parseInput,
} from './format';
import { displayName, formulaRefs, quoteSheet, shiftFormula } from './formula';
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  addSheet,
  appendWorkbook,
  applyStyle,
  cellAt,
  cellsIn,
  cleanSheetName,
  countCells,
  deleteSheet,
  duplicateSheet,
  indexSheet,
  internStyle,
  moveRange,
  nextSheetName,
  renameSheet,
  setCells,
  setSizes,
  sheetNameProblem,
  shiftAxis,
  sortRange,
  styleAt,
  type CellChange,
  type CellStyle,
  type Workbook,
} from './model';
import {
  autoFormat,
  autoSumRange,
  canInsertRef,
  copyDownRight,
  currentRegion,
  errorHelp,
  fillChanges,
  hasHeader,
  jump,
  selectionStats,
  typedFunctionPrefix,
} from './ops';
import { isError, isFormula, storeText, type CellValue } from './values';

const HEAD_H = 24;
const MIN_ROWS = 100;
const MIN_COLS = 26;
const OVERSCAN = 2;
const FONT_SIZE = 13;
const LINE_H = 17;
const MAX_COPY = 200_000;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; // i18n-ignore
/** Couleurs des références d'une formule en cours de saisie (comme Excel). */
const REF_COLORS = ['#1a73e8', '#e8453c', '#9334e6', '#188038', '#e37400', '#12b5cb'];
/** Couleurs proposées pour le texte et le fond (couleurs standard d'Excel, puis teintes claires). */
const COLORS = [
  '#000000',
  '#7f7f7f',
  '#c00000',
  '#ff0000',
  '#ffc000',
  '#ffff00',
  '#92d050',
  '#00b050',
  '#00b0f0',
  '#0070c0',
  '#002060',
  '#7030a0',
  '#ffffff',
  '#d9d9d9',
  '#f4cccc',
  '#ffc7ce',
  '#fce4d6',
  '#fff2cc',
  '#e2efda',
  '#c6efce',
  '#ddebf7',
  '#d9e1f2',
  '#cfe2f3',
  '#e4dfec',
];

type Dir = 'up' | 'down' | 'left' | 'right';
const DELTA: Record<Dir, [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const MODIFIERS = new Set(['Shift', 'Control', 'Meta', 'Alt']); // i18n-ignore

/** Sélection : cellules, lignes ou colonnes entières, ou toute la feuille ; ancre (ar, ac), coin mobile (fr, fc), cellule active (r, c). */
type SelKind = 'cells' | 'rows' | 'cols' | 'all';
type Sel = { kind: SelKind; ar: number; ac: number; fr: number; fc: number; r: number; c: number };
type Edit = { si: number; r: number; c: number; text: string; mode: 'enter' | 'edit'; where: 'cell' | 'bar' };
/** Référence désignée à la souris ou aux flèches pendant la saisie d'une formule (position dans le texte). */
type Point = { start: number; end: number; anchor: { r: number; c: number }; focus: { r: number; c: number } };
type Drag =
  | { kind: 'select' | 'point' | 'extend' | 'cols' | 'rows'; id: number; touch: boolean; x: number; y: number; moved: boolean; at?: number }
  | { kind: 'fill'; id: number; src: Rect }
  | { kind: 'resize'; id: number; axis: 'col' | 'row'; i: number; start: number; size: number; targets: number[] };
type MenuState = { x: number; y: number; area: 'cells' | 'rows' | 'cols' | 'tab'; tab?: number };
type PopState = { kind: 'color' | 'fill' | 'format' | 'align' | 'export'; anchor: DOMRect };
type ClipMark = { sheet: string; rect: Rect; cut: boolean };

const cellSel = (r: number, c: number): Sel => ({ kind: 'cells', ar: r, ac: c, fr: r, fc: c, r, c });
const clampR = (r: number) => Math.max(0, Math.min(MAX_ROWS - 1, r));
const clampC = (c: number) => Math.max(0, Math.min(MAX_COLS - 1, c));
const inRect = (r: number, c: number, rect: Rect) => r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;

function rectOf(s: Sel): Rect {
  switch (s.kind) {
    case 'rows':
      return { r1: Math.min(s.ar, s.fr), r2: Math.max(s.ar, s.fr), c1: 0, c2: MAX_COLS - 1 };
    case 'cols':
      return { r1: 0, r2: MAX_ROWS - 1, c1: Math.min(s.ac, s.fc), c2: Math.max(s.ac, s.fc) };
    case 'all':
      return { r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 };
    default:
      return normRect(s.ar, s.ac, s.fr, s.fc);
  }
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const isMod = (e: { ctrlKey: boolean; metaKey: boolean }) => e.ctrlKey || e.metaKey;
const shortcut = (k: string) => (MAC ? `⌘${k}` : `Ctrl+${k}`);
const touchScreen = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

// ---------- Mesure du texte ----------

let measureCtx: CanvasRenderingContext2D | null = null;
let family = '';
const measured = new Map<string, number>();

function fontOf(st: CellStyle): string {
  if (!family) family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  return `${st.i ? 'italic ' : ''}${st.b ? 'bold ' : ''}${FONT_SIZE}px ${family}`;
}

function textWidth(text: string, font: string): number {
  const k = `${font}\n${text}`;
  let w = measured.get(k);
  if (w === undefined) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!measureCtx) return text.length * 7;
    measureCtx.font = font;
    w = measureCtx.measureText(text).width;
    if (measured.size > 20_000) measured.clear();
    measured.set(k, w);
  }
  return w;
}

// ---------- Couleurs ----------

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Couleur du texte d'une cellule, lisible sur son fond (ou sur le fond du thème). */
function ink(st: CellStyle, dark: boolean): string | undefined {
  if (st.bg) return st.c && contrast(st.c, st.bg) >= 2 ? st.c : readableOn(st.bg);
  if (!st.c) return undefined;
  // Texte noir ou très foncé sur thème sombre (fichiers Excel faits pour un fond blanc), ou l'inverse.
  if (dark && luminance(st.c) < 0.08) return `color-mix(in srgb, ${st.c} 35%, var(--text-strong))`;
  if (!dark && luminance(st.c) > 0.85) return `color-mix(in srgb, ${st.c} 35%, var(--text-strong))`;
  return st.c;
}

// ---------- Formats ----------

const formatKind = (nf: string | undefined): string =>
  !nf
    ? ''
    : isTextFormat(nf)
      ? 'text'
      : isTimeFormat(nf)
        ? 'time'
        : isDateFormat(nf)
          ? 'date'
          : isPercentFormat(nf)
            ? 'pct'
            : /[€$£]/.test(nf)
              ? 'cur'
              : 'num';

type FormatOption = { label: string; nf: string | undefined };

function formatOptions(): FormatOption[] {
  const lang = getLang();
  return [
    { label: t('Automatique'), nf: undefined },
    { label: t('Nombre'), nf: FORMATS.number },
    { label: t('Nombre entier'), nf: FORMATS.integer },
    { label: t('Monnaie'), nf: currencyFormat(lang) },
    { label: t('Pourcentage'), nf: FORMATS.percent },
    { label: t('Date'), nf: FORMATS.date },
    { label: t('Heure'), nf: FORMATS.time },
    { label: t('Date et heure'), nf: FORMATS.datetime },
    { label: t('Texte'), nf: FORMATS.text },
  ];
}

// ---------- Fenêtres flottantes (menus, couleurs, formats) ----------

function Popover({
  anchor,
  onClose,
  children,
  className,
}: {
  anchor: DOMRect | { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const isRect = 'width' in anchor;
  const ax = isRect ? anchor.left : anchor.x;
  const ay = isRect ? anchor.bottom + 4 : anchor.y;
  const above = isRect ? anchor.top - 4 : anchor.y;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = ax;
    let top = ay;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
    if (top + h > window.innerHeight - 8) top = isRect ? Math.max(8, above - h) : Math.max(8, window.innerHeight - 8 - h);
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [ax, ay, above, isRect]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
    };
    const resize = () => close.current();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      className={`nb-menu xl-pop${className ? ` ${className}` : ''}`}
      style={pos ?? { left: -9999, top: 0 }}
      // Le clic sur un menu ne doit pas retirer le curseur de la grille (saisie en cours).
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export type SheetViewProps = {
  wb: Workbook;
  editable: boolean;
  /**
   * Modification du classeur (appliquée au contenu le plus récent du bloc) ; false si elle est refusée. `retry` :
   * modification qui peut être réappliquée telle quelle si une écriture simultanée l'écarte (saisie, mise en forme).
   */
  apply: (fn: (wb: Workbook) => Workbook, retry?: boolean) => boolean;
  undo: () => void;
  redo: () => void;
  /** Hauteur de la grille dans la page (px). */
  height: number;
  /** Nom des fichiers exportés (titre de la page). */
  fileBase: string;
  /** Début du nom des nouvelles feuilles (« Feuil », « Sheet »). */
  sheetBase: string;
  notify: (message: string, kind?: 'info' | 'error') => void;
};

export function SheetView(props: SheetViewProps) {
  const { wb, editable, apply, notify } = props;
  const lang = getLang();
  const dark = useThemeBase() === 'dark';

  const [siState, setSi] = useState(0);
  const si = Math.min(siState, wb.sheets.length - 1);
  const sheet = wb.sheets[si];
  const idx = indexSheet(sheet);
  const engine = useMemo(() => new Engine(wb, lang), [wb, lang]);

  const [sel, setSelState] = useState<Sel>(() => cellSel(0, 0));
  const [edit, setEditState] = useState<Edit | null>(null);
  const [caret, setCaret] = useState(0);
  const [point, setPointState] = useState<Point | null>(null);
  const [acIndex, setAcIndex] = useState(0);
  const [acNav, setAcNav] = useState(false);
  const [acClosed, setAcClosed] = useState(false);
  const [acPos, setAcPos] = useState<{ left: number; top: number } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pop, setPop] = useState<PopState | null>(null);
  const [full, setFull] = useState(false);
  const [focused, setFocused] = useState(false);
  const [vp, setVp] = useState({ top: 0, left: 0, w: 600, h: 300 });
  const [grow, setGrow] = useState({ rows: 0, cols: 0 });
  const [live, setLive] = useState<{ axis: 'col' | 'row'; i: number; size: number } | null>(null);
  const [fillTarget, setFillTarget] = useState<{ rect: Rect; dir: Dir; count: number } | null>(null);
  const [renaming, setRenaming] = useState<{ i: number; name: string } | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [clipMark, setClipMarkState] = useState<ClipMark | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const pendingReveal = useRef<{ r: number | null; c: number | null } | null>(null);
  const lastTouch = useRef(false);
  /** Colonne où a commencé une saisie au clavier avec Tab : Entrée y revient, une ligne plus bas (comme Excel). */
  const tabStart = useRef<number | null>(null);
  const selBySheet = useRef(new Map<string, Sel>());
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const autoScroll = useRef<number | null>(null);
  /** Dernier appui sur une bordure d'en-tête (double-clic : taille ajustée au contenu). */
  const lastResizeDown = useRef<{ axis: 'col' | 'row'; i: number; t: number } | null>(null);

  // Valeurs à jour pour les gestionnaires d'événements.
  const selRef = useRef(sel);
  const editRef = useRef(edit);
  const pointRef = useRef(point);
  const caretRef = useRef(caret);
  const clipMarkRef = useRef(clipMark);
  selRef.current = sel;
  editRef.current = edit;
  pointRef.current = point;
  caretRef.current = caret;
  clipMarkRef.current = clipMark;

  const setEdit = (e: Edit | null) => {
    editRef.current = e;
    setEditState(e);
  };
  const setPoint = (p: Point | null) => {
    pointRef.current = p;
    setPointState(p);
  };
  const setClipMark = (m: ClipMark | null) => {
    clipMarkRef.current = m;
    setClipMarkState(m);
  };
  const select = (next: Sel, reveal: { r: number | null; c: number | null } | null = { r: next.fr, c: next.fc }) => {
    selRef.current = next;
    setSelState(next);
    if (reveal) pendingReveal.current = reveal;
  };

  // ---------- Dimensions ----------

  const interestRow = sel.kind === 'cells' || sel.kind === 'rows' ? Math.max(sel.r, sel.fr, sel.ar) : sel.r;
  const interestCol = sel.kind === 'cells' || sel.kind === 'cols' ? Math.max(sel.c, sel.fc, sel.ac) : sel.c;
  const rowCount = Math.min(MAX_ROWS, Math.max(MIN_ROWS, idx.rows + 30, interestRow + 30, grow.rows));
  const colCount = Math.min(MAX_COLS, Math.max(MIN_COLS, idx.cols + 6, interestCol + 6, grow.cols));
  const rowSizes = useMemo(() => (live?.axis === 'row' ? { ...sheet.rh, [live.i]: live.size } : sheet.rh), [sheet.rh, live]);
  const colSizes = useMemo(() => (live?.axis === 'col' ? { ...sheet.cw, [live.i]: live.size } : sheet.cw), [sheet.cw, live]);
  const rows = useMemo(() => new Axis(DEFAULT_ROW_HEIGHT, rowSizes, rowCount), [rowSizes, rowCount]);
  const cols = useMemo(() => new Axis(DEFAULT_COL_WIDTH, colSizes, colCount), [colSizes, colCount]);
  const headW = Math.max(40, String(rowCount).length * 8 + 16);

  const readViewport = () => {
    const el = scrollRef.current;
    if (!el) return;
    setVp((v) =>
      v.top === el.scrollTop && v.left === el.scrollLeft && v.w === el.clientWidth && v.h === el.clientHeight
        ? v
        : { top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight },
    );
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    readViewport();
    const ro = new ResizeObserver(readViewport);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);

  const onScroll = () => {
    readViewport();
    const el = scrollRef.current!;
    // Plus de lignes et de colonnes en approchant du bord.
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 300 && rowCount < MAX_ROWS)
      setGrow((g) => ({ ...g, rows: Math.min(MAX_ROWS, rowCount + 100) }));
    if (el.scrollLeft + el.clientWidth > el.scrollWidth - 300 && colCount < MAX_COLS)
      setGrow((g) => ({ ...g, cols: Math.min(MAX_COLS, colCount + 10) }));
  };

  // Cellule rendue visible après un déplacement au clavier.
  useLayoutEffect(() => {
    const target = pendingReveal.current;
    const el = scrollRef.current;
    if (!target || !el) return;
    pendingReveal.current = null;
    const viewH = el.clientHeight - HEAD_H;
    const viewW = el.clientWidth - headW;
    // Petite marge au bord, pour que la poignée de recopie reste visible.
    const margin = 10;
    if (target.r !== null && target.r < rowCount) {
      const top = rows.pos(target.r);
      const bottom = top + rows.size(target.r);
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom + margin > el.scrollTop + viewH) el.scrollTop = Math.min(top, bottom + margin - viewH);
    }
    if (target.c !== null && target.c < colCount) {
      const left = cols.pos(target.c);
      const right = left + cols.size(target.c);
      if (left < el.scrollLeft) el.scrollLeft = left;
      else if (right + margin > el.scrollLeft + viewW) el.scrollLeft = Math.min(left, right + margin - viewW);
    }
  });

  // Curseur placé dans le champ de saisie après une modification faite par programme.
  useLayoutEffect(() => {
    const p = pendingCaret.current;
    if (p === null) return;
    pendingCaret.current = null;
    const el = editRef.current?.where === 'bar' ? barRef.current : inputRef.current;
    if (el && document.activeElement === el) el.setSelectionRange(p, p);
  });

  // Retour au clavier de la grille en entrant ou sortant du plein écran.
  useEffect(() => {
    if (!lastTouch.current || editRef.current) inputRef.current?.focus({ preventScroll: true });
    pendingReveal.current = { r: selRef.current.r, c: selRef.current.c };
  }, [full]);

  useEffect(() => {
    if (!editable && editRef.current) setEdit(null);
  }, [editable]);

  // ---------- Modifications ----------

  const sheetName = sheet.name;
  /**
   * Modification de la feuille affichée (retrouvée par son nom dans le contenu le plus récent). `retry` : faux pour
   * les modifications qui ne peuvent pas être refaites deux fois (insertion de lignes, tri, déplacement…).
   */
  const onSheet = (fn: (latest: Workbook, i: number) => Workbook, name = sheetName, retry = true) =>
    apply((latest) => {
      const i = latest.sheets.findIndex((s) => s.name === name);
      return i < 0 ? latest : fn(latest, i);
    }, retry);

  /** Plage limitée à la partie utilisée de la feuille (colonnes ou lignes entières). */
  const usedRect = (rect: Rect): Rect => ({
    r1: rect.r1,
    c1: rect.c1,
    r2: Math.min(rect.r2, Math.max(rect.r1, idx.rows - 1)),
    c2: Math.min(rect.c2, Math.max(rect.c1, idx.cols - 1)),
  });

  const focusGrid = () => {
    const el = inputRef.current;
    if (!el || document.activeElement === el) return;
    // Au doigt, le clavier du téléphone ne s'ouvre que pour écrire.
    if (lastTouch.current && !editRef.current) return;
    el.focus({ preventScroll: true });
  };

  // ---------- Saisie ----------

  const startEdit = (opts: { text?: string; mode: 'enter' | 'edit'; where?: 'cell' | 'bar'; caret?: number }) => {
    if (!editable) return;
    const s = selRef.current;
    const cell = cellAt(sheet, s.r, s.c);
    const text = opts.text ?? editText(cell.v, styleAt(wb, cell.s).nf, lang);
    const where = opts.where ?? 'cell';
    const pos = opts.caret ?? text.length;
    setEdit({ si, r: s.r, c: s.c, text, mode: opts.mode, where });
    setCaret(pos);
    caretRef.current = pos;
    pendingCaret.current = pos;
    setPoint(null);
    setAcClosed(false);
    setAcNav(false);
    setAcIndex(0);
    setClipMark(null);
    if (where === 'cell') inputRef.current?.focus({ preventScroll: true });
    pendingReveal.current = { r: s.r, c: s.c };
  };

  /** Valide la saisie ; `move` : cellule suivante, `all` : même saisie dans toute la sélection (Ctrl+Entrée). */
  const commitEdit = (move: Dir | null, all = false, refocus = true, key: 'tab' | 'enter' | null = null) => {
    const ed = editRef.current;
    if (!ed) return;
    setEdit(null);
    setPoint(null);
    setAcClosed(false);
    setAcNav(false);
    const target = wb.sheets[ed.si] ?? sheet;
    const original = cellAt(target, ed.r, ed.c);
    const unchanged = !all && ed.text === editText(original.v, styleAt(wb, original.s).nf, lang);
    if (!unchanged) {
      const s = selRef.current;
      const rect = usedRect(rectOf(s));
      const targets: { r: number; c: number }[] = [];
      if (all && s.kind === 'cells' && (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1) <= 10_000) {
        for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) targets.push({ r, c });
      } else targets.push({ r: ed.r, c: ed.c });
      onSheet((latest, i) => {
        let next = latest;
        const changes: CellChange[] = [];
        const lines = ed.text.includes('\n') ? ed.text.split('\n').length : 1;
        for (const { r, c } of targets) {
          const cur = cellAt(next.sheets[i], r, c);
          let st = styleAt(next, cur.s);
          let value: CellValue;
          let format: string | undefined;
          if (isTextFormat(st.nf)) value = ed.text === '' ? null : storeText(ed.text);
          else ({ value, format } = parseInput(ed.text, lang));
          if (isFormula(value)) {
            if (all) value = shiftFormula(value, r - ed.r, c - ed.c);
            if (!st.nf) format = autoFormat(value, next, i);
          }
          let s2 = cur.s;
          if (format && formatKind(format) !== formatKind(st.nf)) st = { ...st, nf: format };
          // Retour à la ligne (Alt+Entrée) : renvoi à la ligne automatique, comme Excel.
          if (lines > 1 && typeof value === 'string' && !isFormula(value)) st = { ...st, wr: 1 };
          if (st !== styleAt(next, cur.s)) [next, s2] = internStyle(next, st);
          changes.push({ r, c, v: value, s: s2 });
        }
        next = setCells(next, i, changes);
        // Hauteur de la ligne agrandie pour un texte de plusieurs lignes.
        if (lines > 1) {
          const need = lines * LINE_H + 8;
          const cur = next.sheets[i].rh?.[ed.r] ?? DEFAULT_ROW_HEIGHT;
          if (need > cur) next = setSizes(next, i, 'rh', [ed.r], Math.min(need, 400));
        }
        return next;
      }, target.name);
    }
    if (ed.si !== si && wb.sheets[ed.si]) showSheet(ed.si, false);
    if (move) advance(move, key);
    if (refocus) focusGrid();
  };

  const cancelEdit = () => {
    const ed = editRef.current;
    setEdit(null);
    setPoint(null);
    if (ed && ed.si !== si && wb.sheets[ed.si]) showSheet(ed.si, false);
    focusGrid();
  };

  /** Texte de la saisie remplacé entre `start` et `end` (référence désignée, suggestion acceptée…). */
  const replaceText = (start: number, end: number, insert: string) => {
    const ed = editRef.current;
    if (!ed) return;
    const text = ed.text.slice(0, start) + insert + ed.text.slice(end);
    const pos = start + insert.length;
    setEdit({ ...ed, text });
    setCaret(pos);
    caretRef.current = pos;
    pendingCaret.current = pos;
  };

  const refText = (a: { r: number; c: number }, b: { r: number; c: number }) => {
    const rect = normRect(a.r, a.c, b.r, b.c);
    const body = rectName(rect);
    const ed = editRef.current;
    return ed && ed.si !== si ? `${quoteSheet(sheet.name)}!${body}` : body;
  };

  /** Clic (ou glissement) sur une cellule pendant la saisie d'une formule : sa référence est insérée. */
  const pointAt = (r: number, c: number, extend: boolean) => {
    const p = pointRef.current;
    const at = caretRef.current;
    const base: Point = p && p.end === at ? p : { start: at, end: at, anchor: { r, c }, focus: { r, c } };
    const next: Point = extend ? { ...base, focus: { r, c } } : { ...base, anchor: { r, c }, focus: { r, c } };
    const text = refText(next.anchor, next.focus);
    replaceText(next.start, next.end, text);
    setPoint({ ...next, end: next.start + text.length });
  };

  /** Flèches pendant la saisie d'une formule (juste après « = », un opérateur…) : référence déplacée. */
  const pointMove = (dir: Dir, extend: boolean) => {
    const ed = editRef.current!;
    const p = pointRef.current;
    const from = p ? p.focus : ed.si === si ? { r: ed.r, c: ed.c } : { r: selRef.current.r, c: selRef.current.c };
    const [dr, dc] = DELTA[dir];
    const r = clampR(from.r + dr);
    const c = clampC(from.c + dc);
    if (p && extend) pointAt(r, c, true);
    else {
      const at = caretRef.current;
      const base: Point = p && p.end === at ? p : { start: at, end: at, anchor: { r, c }, focus: { r, c } };
      const next: Point = { ...base, anchor: { r, c }, focus: { r, c } };
      const text = refText(next.anchor, next.focus);
      replaceText(next.start, next.end, text);
      setPoint({ ...next, end: next.start + text.length });
    }
    pendingReveal.current = { r, c };
  };

  const fnNames = useMemo(() => FUNCTION_NAMES.map((n) => displayName(n, lang)).sort(), [lang]);
  const typed = edit && !acClosed ? typedFunctionPrefix(edit.text, caret) : null;
  const suggestions = typed ? fnNames.filter((n) => n.startsWith(typed.prefix.toUpperCase())).slice(0, 8) : [];
  const acShown = suggestions.length > 0;

  const acceptSuggestion = (name: string) => {
    const ed = editRef.current;
    if (!ed || !typed) return;
    const after = ed.text.slice(caretRef.current);
    replaceText(typed.start, caretRef.current, after.startsWith('(') ? name : `${name}(`);
    setAcIndex(0);
    setAcNav(false);
  };

  useLayoutEffect(() => {
    if (!acShown) {
      if (acPos) setAcPos(null);
      return;
    }
    const el = edit?.where === 'bar' ? barRef.current : inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = { left: r.left, top: r.bottom + 2 };
    if (!acPos || acPos.left !== next.left || acPos.top !== next.top) setAcPos(next);
  });

  // ---------- Sélection et déplacements ----------

  const advance = (dir: Dir, key: 'tab' | 'enter' | null = null) => {
    const s = selRef.current;
    const rect = rectOf(s);
    const multi = s.kind === 'cells' && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2);
    const [dr, dc] = DELTA[dir];
    if (!multi) {
      const back = tabStart.current;
      if (key === 'tab' && dir === 'right') tabStart.current ??= s.c;
      else tabStart.current = null;
      const r = clampR(s.r + dr);
      const c = key === 'enter' && dir === 'down' && back !== null ? back : clampC(s.c + dc);
      select(cellSel(r, c));
      return;
    }
    // Dans une plage sélectionnée, Entrée et Tab parcourent ses cellules sans la quitter (comme Excel).
    let { r, c } = s;
    if (dr) {
      r += dr;
      if (r > rect.r2) {
        r = rect.r1;
        c = c + 1 > rect.c2 ? rect.c1 : c + 1;
      } else if (r < rect.r1) {
        r = rect.r2;
        c = c - 1 < rect.c1 ? rect.c2 : c - 1;
      }
    } else {
      c += dc;
      if (c > rect.c2) {
        c = rect.c1;
        r = r + 1 > rect.r2 ? rect.r1 : r + 1;
      } else if (c < rect.c1) {
        c = rect.c2;
        r = r - 1 < rect.r1 ? rect.r2 : r - 1;
      }
    }
    select({ ...s, r, c }, { r, c });
  };

  const moveBy = (dr: number, dc: number, extend: boolean) => {
    tabStart.current = null;
    const s = selRef.current;
    if (extend) {
      const base = s.kind === 'cells' ? s : { ...cellSel(s.r, s.c) };
      const fr = clampR(base.fr + dr);
      const fc = clampC(base.fc + dc);
      select({ ...base, fr, fc });
    } else select(cellSel(clampR(s.r + dr), clampC(s.c + dc)));
  };

  const jumpTo = (dir: Dir, extend: boolean) => {
    tabStart.current = null;
    const s = selRef.current;
    const [dr, dc] = DELTA[dir];
    const from = extend && s.kind === 'cells' ? { r: s.fr, c: s.fc } : { r: s.r, c: s.c };
    const to = jump(sheet, from.r, from.c, dr, dc);
    if (extend) select({ ...(s.kind === 'cells' ? s : cellSel(s.r, s.c)), fr: to.r, fc: to.c });
    else select(cellSel(to.r, to.c));
  };

  const showSheet = (i: number, keepEdit: boolean) => {
    if (i === si || !wb.sheets[i]) return;
    if (!keepEdit && editRef.current && editRef.current.si === si) commitEdit(null, false, false);
    selBySheet.current.set(sheet.name, selRef.current);
    setSi(i);
    const s = selBySheet.current.get(wb.sheets[i].name) ?? cellSel(0, 0);
    select(s, { r: s.r, c: s.c });
    setGrow({ rows: 0, cols: 0 });
    setFillTarget(null);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  };

  /** Onglet choisi : pendant la saisie d'une formule, les références désignées viennent de cette feuille. */
  const pickSheet = (i: number) => {
    const ed = editRef.current;
    const pointing = !!ed && ed.text.startsWith('=') && (pointRef.current !== null || canInsertRef(ed.text, caretRef.current, lang));
    if (pointing) {
      setPoint(null);
      selBySheet.current.set(sheet.name, selRef.current);
      setSi(i);
      const s = selBySheet.current.get(wb.sheets[i].name) ?? cellSel(0, 0);
      select(s, { r: s.r, c: s.c });
      const el = ed!.where === 'bar' ? barRef.current : inputRef.current;
      el?.focus({ preventScroll: true });
      return;
    }
    if (ed) commitEdit(null, false, false);
    showSheet(i, true);
    focusGrid();
  };

  // ---------- Opérations ----------

  const styleSelection = (patch: (st: CellStyle) => CellStyle) => {
    if (!editable) return;
    const rect = rectOf(selRef.current);
    onSheet((latest, i) => applyStyle(latest, i, rect, patch));
  };

  const activeCell = cellAt(sheet, sel.r, sel.c);
  const activeStyle = styleAt(wb, activeCell.s);

  const toggleStyle = (k: 'b' | 'i' | 'u' | 'st' | 'wr') => {
    const on = !activeStyle[k];
    styleSelection((st) => {
      const n = { ...st };
      if (on) n[k] = 1;
      else delete n[k];
      return n;
    });
  };

  const setAlign = (al: 'left' | 'center' | 'right') => {
    const off = activeStyle.al === al;
    styleSelection((st) => {
      const n = { ...st };
      if (off) delete n.al;
      else n.al = al;
      return n;
    });
  };

  const setColor = (k: 'c' | 'bg', color: string | null) =>
    styleSelection((st) => {
      const n = { ...st };
      if (color) n[k] = color;
      else delete n[k];
      return n;
    });

  const setFormat = (nf: string | undefined) =>
    styleSelection((st) => {
      const n = { ...st };
      if (nf) n.nf = nf;
      else delete n.nf;
      return n;
    });

  const changeDecimals = (delta: number) => {
    const v = engine.value(si, sel.r, sel.c);
    setFormat(adjustDecimals(activeStyle.nf, delta, typeof v === 'number' ? v : null, lang));
  };

  const clearSelection = (what: 'contents' | 'formats' | 'all') => {
    if (!editable) return;
    const rect = rectOf(selRef.current);
    onSheet((latest, i) => {
      const changes: CellChange[] = [];
      for (const { r, c, cell } of cellsIn(latest.sheets[i], rect)) {
        if (what === 'contents' && cell.v !== null) changes.push({ r, c, v: null });
        else if (what === 'formats' && cell.s) changes.push({ r, c, s: 0 });
        else if (what === 'all') changes.push({ r, c, v: null, s: 0 });
      }
      return setCells(latest, i, changes);
    });
    setClipMark(null);
  };

  const selectionCount = (s: Sel, axis: 'rows' | 'cols') => {
    const rect = rectOf(s);
    return axis === 'rows' ? rect.r2 - rect.r1 + 1 : rect.c2 - rect.c1 + 1;
  };

  const insertLines = (axis: 'rows' | 'cols', after: boolean) => {
    const s = selRef.current;
    const rect = rectOf(s);
    const n = Math.min(selectionCount(s, axis), 1000);
    const at = axis === 'rows' ? (after ? rect.r2 + 1 : rect.r1) : after ? rect.c2 + 1 : rect.c1;
    onSheet((latest, i) => shiftAxis(latest, i, axis, at, n), sheetName, false);
    setClipMark(null);
  };

  const deleteLines = (axis: 'rows' | 'cols') => {
    const s = selRef.current;
    const rect = rectOf(s);
    const n = selectionCount(s, axis);
    const at = axis === 'rows' ? rect.r1 : rect.c1;
    onSheet((latest, i) => shiftAxis(latest, i, axis, at, -n), sheetName, false);
    setClipMark(null);
    if (axis === 'rows') select(cellSel(rect.r1, s.c));
    else select(cellSel(s.r, rect.c1));
  };

  const sort = (desc: boolean) => {
    const s = selRef.current;
    onSheet(
      (latest, i) => {
        const sh = latest.sheets[i];
        const eng = new Engine(latest, lang);
        const used = indexSheet(sh);
        let rect = rectOf(s);
        const single = s.kind !== 'cells' || (rect.r1 === rect.r2 && rect.c1 === rect.c2);
        if (single) {
          // Une seule cellule : tout le tableau autour d'elle, sans sa ligne d'en-tête.
          rect = currentRegion(sh, s.r, s.c);
          if (hasHeader(latest, i, rect, eng)) rect = { ...rect, r1: rect.r1 + 1 };
        } else rect = { ...rect, r2: Math.min(rect.r2, used.rows - 1) };
        if (rect.r2 <= rect.r1) return latest;
        return sortRange(latest, i, rect, s.c, desc, (r, c) => {
          const v = eng.value(i, r, c);
          return isError(v) ? null : v;
        });
      },
      sheetName,
      false,
    );
  };

  const fillDownRight = (down: boolean) => {
    if (!editable) return;
    const rect = usedRect(rectOf(selRef.current));
    onSheet((latest, i) => setCells(latest, i, copyDownRight(latest, i, rect, down)));
  };

  const autoSum = () => {
    if (!editable) return;
    const s = selRef.current;
    const rect = rectOf(s);
    const sum = displayName('SUM', lang);
    if (s.kind === 'cells' && rect.r1 === rect.r2 && rect.c1 === rect.c2) {
      const range = autoSumRange(engine, si, s.r, s.c);
      const text = range ? `=${sum}(${rectName(range)})` : `=${sum}()`;
      startEdit({ text, mode: 'edit', caret: range ? text.length : text.length - 1 });
      return;
    }
    // Plage sélectionnée : somme de chaque colonne, sous la plage.
    const r = usedRect(rect);
    if (r.r2 + 1 >= MAX_ROWS) return;
    onSheet((latest, i) => {
      const changes: CellChange[] = [];
      for (let c = r.c1; c <= r.c2; c++) changes.push({ r: r.r2 + 1, c, v: `=SUM(${rectName({ r1: r.r1, c1: c, r2: r.r2, c2: c })})` });
      return setCells(latest, i, changes);
    });
  };

  // ---------- Presse-papiers ----------

  const copySelection = (cut: boolean) => {
    const s = selRef.current;
    const rect = usedRect(rectOf(s));
    if ((rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1) > MAX_COPY) {
      notify(t('Sélection trop grande pour être copiée.'), 'error');
      return null;
    }
    const grid: CopyCell[][] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const row: CopyCell[] = [];
      for (let c = rect.c1; c <= rect.c2; c++) {
        const cell = cellAt(sheet, r, c);
        row.push({ v: cell.v, st: styleAt(wb, cell.s), text: cell.v === null ? '' : engine.display(si, r, c).text });
      }
      grid.push(row);
    }
    const out = buildCopy(grid, { r: rect.r1, c: rect.c1 }, cut && editable, lang);
    setClipMark({ sheet: sheet.name, rect, cut: cut && editable });
    return out;
  };

  const pasteData = (data: ClipData) => {
    if (!editable || !data.rows || !data.cols) return;
    const s = selRef.current;
    const rect = rectOf(s);
    const top = rect.r1;
    const left = rect.c1;
    const mark = clipMarkRef.current;
    if (
      data.cut &&
      mark?.cut &&
      data.from &&
      mark.sheet === sheet.name &&
      mark.rect.r1 === data.from.r &&
      mark.rect.c1 === data.from.c &&
      mark.rect.r2 - mark.rect.r1 + 1 === data.rows &&
      mark.rect.c2 - mark.rect.c1 + 1 === data.cols
    ) {
      // Couper-coller dans la même feuille : déplacement (les formules qui citaient ces cellules suivent).
      onSheet((latest, i) => moveRange(latest, i, mark.rect, top, left), sheetName, false);
      setClipMark(null);
      forgetCut();
      select(
        { ...cellSel(top, left), fr: Math.min(MAX_ROWS - 1, top + data.rows - 1), fc: Math.min(MAX_COLS - 1, left + data.cols - 1) },
        { r: top, c: left },
      );
      return;
    }
    const selRows = rect.r2 - rect.r1 + 1;
    const selCols = rect.c2 - rect.c1 + 1;
    // Sélection multiple de la taille copiée : le contenu est répété (comme Excel).
    const tile = s.kind === 'cells' && selRows % data.rows === 0 && selCols % data.cols === 0 && selRows * selCols <= 100_000;
    const reps = tile ? [selRows / data.rows, selCols / data.cols] : [1, 1];
    const ok = onSheet((latest, i) => {
      let next = latest;
      const memo = new Map<string, number>();
      const changes: CellChange[] = [];
      for (let ti = 0; ti < reps[0]; ti++)
        for (let tj = 0; tj < reps[1]; tj++)
          for (let dr = 0; dr < data.rows; dr++)
            for (let dc = 0; dc < data.cols; dc++) {
              const r = top + ti * data.rows + dr;
              const c = left + tj * data.cols + dc;
              if (r >= MAX_ROWS || c >= MAX_COLS) continue;
              const cell = data.cells[dr]?.[dc] ?? { v: null };
              let v = cell.v;
              if (isFormula(v) && data.from) v = shiftFormula(v, r - (data.from.r + dr), c - (data.from.c + dc));
              if (data.plain) {
                // Texte simple : la cellule garde sa mise en forme (format de date ou de pourcentage reconnu ajouté).
                let s2: number | undefined;
                if (cell.st?.nf) {
                  const cur = styleAt(next, cellAt(next.sheets[i], r, c).s);
                  if (formatKind(cur.nf) !== formatKind(cell.st.nf)) [next, s2] = internStyle(next, { ...cur, nf: cell.st.nf });
                }
                changes.push(s2 === undefined ? { r, c, v } : { r, c, v, s: s2 });
                continue;
              }
              let s2 = 0;
              if (cell.st) {
                const k = JSON.stringify(cell.st);
                const known = memo.get(k);
                if (known !== undefined) s2 = known;
                else {
                  [next, s2] = internStyle(next, cell.st);
                  memo.set(k, s2);
                }
              }
              changes.push({ r, c, v, s: s2 });
            }
      return setCells(next, i, changes);
    });
    if (!ok) return;
    if (data.cut) forgetCut();
    setClipMark(null);
    select(
      {
        ...cellSel(top, left),
        fr: Math.min(MAX_ROWS - 1, top + data.rows * reps[0] - 1),
        fc: Math.min(MAX_COLS - 1, left + data.cols * reps[1] - 1),
      },
      { r: top, c: left },
    );
  };

  /** Boutons Copier, Couper, Coller du menu (au doigt) : presse-papiers du système quand il est accessible. */
  const menuCopy = async (cut: boolean) => {
    const out = copySelection(cut);
    if (!out) return;
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([out.text], { type: 'text/plain' }),
            'text/html': new Blob([out.html], { type: 'text/html' }),
          }),
        ]);
      } else await navigator.clipboard?.writeText(out.text);
    } catch {
      /* presse-papiers du système refusé : la copie reste disponible dans Melo */
    }
  };

  const menuPaste = async () => {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        const found: Record<string, string> = {};
        for (const item of items)
          for (const type of ['text/html', 'text/plain'])
            if (item.types.includes(type) && !(type in found)) found[type] = await (await item.getType(type)).text();
        const data = readPaste((type) => found[type] ?? '', lang);
        if (data) return pasteData(data);
      } else if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        const data = readPaste((type) => (type === 'text/plain' ? text : ''), lang);
        if (data) return pasteData(data);
      }
    } catch {
      /* lecture refusée : dernière copie faite dans Melo */
    }
    const data = lastCopy();
    if (data) pasteData(data);
    else notify(t('Pour coller, utilisez Ctrl+V.'), 'error');
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (editRef.current) return;
    e.preventDefault();
    const out = copySelection(false);
    if (!out) return;
    e.clipboardData.setData('text/plain', out.text);
    e.clipboardData.setData('text/html', out.html);
    e.clipboardData.setData(SHEET_MIME, out.json);
  };

  const onCut = (e: React.ClipboardEvent) => {
    if (editRef.current) return;
    e.preventDefault();
    const out = copySelection(true);
    if (!out) return;
    e.clipboardData.setData('text/plain', out.text);
    e.clipboardData.setData('text/html', out.html);
    e.clipboardData.setData(SHEET_MIME, out.json);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const ed = editRef.current;
    const get = (type: string) => e.clipboardData.getData(type);
    if (ed) {
      // Plusieurs cellules collées au début d'une saisie : collées dans la grille.
      const text = get('text/plain').replace(/\r?\n$/, '');
      if (ed.text === '' && /[\t\n]/.test(text)) {
        e.preventDefault();
        setEdit(null);
        const data = readPaste(get, lang);
        if (data) pasteData(data);
      }
      return;
    }
    e.preventDefault();
    if (!editable) return;
    const data = readPaste(get, lang);
    if (data) pasteData(data);
  };

  // ---------- Clavier ----------

  const onEditKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ed = editRef.current;
    if (!ed || e.nativeEvent.isComposing) return;
    const k = e.key;
    if (acShown && !acClosed) {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        setAcNav(true);
        setAcIndex((i) => (i + (k === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (k === 'Tab' || (k === 'Enter' && acNav && !e.altKey && !isMod(e))) {
        e.preventDefault();
        acceptSuggestion(suggestions[Math.min(acIndex, suggestions.length - 1)]);
        return;
      }
      if (k === 'Escape') {
        e.preventDefault();
        setAcClosed(true);
        return;
      }
    }
    if (pointRef.current && !ARROWS[k] && !MODIFIERS.has(k)) setPoint(null);
    switch (k) {
      case 'Enter':
        e.preventDefault();
        if (e.altKey) {
          replaceText(caretRef.current, e.currentTarget.selectionEnd ?? caretRef.current, '\n');
          return;
        }
        if (isMod(e)) commitEdit(null, true);
        else commitEdit(e.shiftKey ? 'up' : 'down', false, true, 'enter');
        return;
      case 'Tab':
        e.preventDefault();
        commitEdit(e.shiftKey ? 'left' : 'right', false, true, 'tab');
        return;
      case 'Escape':
        e.preventDefault();
        cancelEdit();
        return;
      case 'F2':
        e.preventDefault();
        setEdit({ ...ed, mode: ed.mode === 'enter' ? 'edit' : 'enter' });
        return;
      default:
        break;
    }
    const dir = ARROWS[k];
    if (dir && ed.mode === 'enter' && ed.where === 'cell' && !e.altKey && !isMod(e)) {
      e.preventDefault();
      if (ed.text.startsWith('=') && (pointRef.current || canInsertRef(ed.text, caretRef.current, lang))) pointMove(dir, e.shiftKey);
      else commitEdit(dir);
    }
  };

  const onReadyKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const k = e.key;
    const dir = ARROWS[k];
    if (isMod(e) && !e.altKey) {
      const lower = k.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (lower === 'z') return run(() => (e.shiftKey ? props.redo() : props.undo()));
      if (lower === 'y') return run(props.redo);
      if (lower === 'a') return run(() => select({ kind: 'all', ar: 0, ac: 0, fr: MAX_ROWS - 1, fc: MAX_COLS - 1, r: sel.r, c: sel.c }, null));
      if (editable && lower === 'b') return run(() => toggleStyle('b'));
      if (editable && lower === 'i') return run(() => toggleStyle('i'));
      if (editable && lower === 'u') return run(() => toggleStyle('u'));
      if (editable && lower === 'd') return run(() => fillDownRight(true));
      if (editable && lower === 'r') return run(() => fillDownRight(false));
      if (k === 'Home') return run(() => select(cellSel(0, 0)));
      if (k === 'End') return run(() => select(cellSel(Math.max(0, idx.rows - 1), Math.max(0, idx.cols - 1))));
      if (k === ' ') return run(() => select({ kind: 'cols', ar: 0, ac: sel.c, fr: MAX_ROWS - 1, fc: sel.c, r: sel.r, c: sel.c }, null));
      if (dir) return run(() => jumpTo(dir, e.shiftKey));
      // Ctrl+C, Ctrl+X, Ctrl+V : événements copier, couper, coller (voir plus haut).
      return;
    }
    if (dir) {
      e.preventDefault();
      const [dr, dc] = DELTA[dir];
      moveBy(dr, dc, e.shiftKey);
      return;
    }
    switch (k) {
      case 'Enter':
        e.preventDefault();
        advance(e.shiftKey ? 'up' : 'down', 'enter');
        return;
      case 'Tab':
        e.preventDefault();
        advance(e.shiftKey ? 'left' : 'right', 'tab');
        return;
      case 'Home':
        e.preventDefault();
        select(cellSel(sel.r, 0));
        return;
      case 'PageDown':
      case 'PageUp': {
        e.preventDefault();
        const n = Math.max(1, Math.floor((vp.h - HEAD_H) / DEFAULT_ROW_HEIGHT) - 1);
        moveBy(k === 'PageDown' ? n : -n, 0, e.shiftKey);
        return;
      }
      case 'F2':
        e.preventDefault();
        startEdit({ mode: 'edit' });
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        clearSelection('contents');
        return;
      case 'Escape':
        if (clipMarkRef.current) setClipMark(null);
        else if (full) setFull(false);
        return;
      case ' ':
        if (e.shiftKey) {
          e.preventDefault();
          select({ kind: 'rows', ar: sel.r, ac: 0, fr: sel.r, fc: MAX_COLS - 1, r: sel.r, c: sel.c }, null);
        }
        return;
      default:
        break;
    }
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (editRef.current) onEditKey(e);
    else onReadyKey(e);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const pos = e.target.selectionStart ?? value.length;
    const ed = editRef.current;
    if (!ed) {
      if (!editable || !value) return;
      // Frappe dans la grille : la saisie commence (le texte tapé remplace le contenu).
      startEdit({ text: value, mode: 'enter', caret: pos });
      return;
    }
    if (pointRef.current) setPoint(null);
    setEdit({ ...ed, text: value });
    setCaret(pos);
    caretRef.current = pos;
    setAcClosed(false);
    setAcNav(false);
    setAcIndex(0);
  };

  const onSelectText = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const pos = e.currentTarget.selectionStart ?? 0;
    if (pos === caretRef.current) return;
    setCaret(pos);
    caretRef.current = pos;
    const p = pointRef.current;
    if (p && pos !== p.end) setPoint(null);
  };

  // ---------- Souris et doigt ----------

  const cellAtPoint = (x: number, y: number) => {
    const b = bodyRef.current!.getBoundingClientRect();
    return { r: rows.indexAt(y - b.top), c: cols.indexAt(x - b.left) };
  };

  const stopAutoScroll = () => {
    if (autoScroll.current !== null) cancelAnimationFrame(autoScroll.current);
    autoScroll.current = null;
  };

  /** Défilement automatique quand on glisse au-delà du bord de la grille. */
  const runAutoScroll = () => {
    if (autoScroll.current !== null) return;
    const step = () => {
      const el = scrollRef.current;
      const p = pointer.current;
      if (!el || !p || !drag.current) {
        autoScroll.current = null;
        return;
      }
      const r = el.getBoundingClientRect();
      const dx = p.x < r.left + headW ? p.x - (r.left + headW) : p.x > r.right ? p.x - r.right : 0;
      const dy = p.y < r.top + HEAD_H ? p.y - (r.top + HEAD_H) : p.y > r.bottom ? p.y - r.bottom : 0;
      if (!dx && !dy) {
        autoScroll.current = null;
        return;
      }
      el.scrollLeft += Math.max(-40, Math.min(40, dx / 2));
      el.scrollTop += Math.max(-40, Math.min(40, dy / 2));
      dragMoveRef.current(p.x, p.y);
      autoScroll.current = requestAnimationFrame(step);
    };
    autoScroll.current = requestAnimationFrame(step);
  };

  const fillFor = (src: Rect, r: number, c: number): { rect: Rect; dir: Dir; count: number } | null => {
    const options: [Dir, number][] = [
      ['down', r - src.r2],
      ['up', src.r1 - r],
      ['right', c - src.c2],
      ['left', src.c1 - c],
    ];
    const [dir, count] = options.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (count <= 0) return null;
    const rect =
      dir === 'down'
        ? { ...src, r1: src.r2 + 1, r2: src.r2 + count }
        : dir === 'up'
          ? { ...src, r1: src.r1 - count, r2: src.r1 - 1 }
          : dir === 'right'
            ? { ...src, c1: src.c2 + 1, c2: src.c2 + count }
            : { ...src, c1: src.c1 - count, c2: src.c1 - 1 };
    return { rect, dir, count };
  };

  const dragMove = (x: number, y: number) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'resize') return;
    const { r, c } = cellAtPoint(x, y);
    const s = selRef.current;
    switch (d.kind) {
      case 'select':
      case 'extend':
        if (s.fr !== r || s.fc !== c || s.kind !== 'cells') select({ ...(s.kind === 'cells' ? s : cellSel(s.r, s.c)), fr: r, fc: c }, null);
        break;
      case 'point':
        pointAt(r, c, true);
        break;
      case 'cols':
        if (s.fc !== c) select({ ...s, fc: c }, null);
        break;
      case 'rows':
        if (s.fr !== r) select({ ...s, fr: r }, null);
        break;
      case 'fill':
        setFillTarget(fillFor(d.src, r, c));
        break;
    }
  };

  const dragMoveRef = useRef(dragMove);
  dragMoveRef.current = dragMove;

  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target === inputRef.current) return;
    const touch = e.pointerType === 'touch';
    lastTouch.current = touch;
    const { r, c } = cellAtPoint(e.clientX, e.clientY);
    const ed = editRef.current;
    if (ed && ed.text.startsWith('=') && (pointRef.current || canInsertRef(ed.text, caretRef.current, lang))) {
      // Saisie d'une formule : la cellule touchée devient une référence.
      e.preventDefault();
      pointAt(r, c, e.shiftKey && !!pointRef.current);
      drag.current = { kind: 'point', id: e.pointerId, touch, x: e.clientX, y: e.clientY, moved: false };
      if (!touch) scrollRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (touch) {
      // Au doigt, la grille défile ; la cellule est choisie au relâchement, sans glissement.
      drag.current = { kind: 'select', id: e.pointerId, touch, x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    e.preventDefault();
    if (ed) commitEdit(null, false, false);
    focusGrid();
    setMenu(null);
    tabStart.current = null;
    const s = selRef.current;
    if (e.shiftKey) select({ ...(s.kind === 'cells' ? s : cellSel(s.r, s.c)), fr: r, fc: c }, null);
    else select(cellSel(r, c), null);
    drag.current = { kind: 'select', id: e.pointerId, touch, x: e.clientX, y: e.clientY, moved: false };
    scrollRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.kind === 'resize') {
      const delta = (d.axis === 'col' ? e.clientX : e.clientY) - d.start;
      setLive({ axis: d.axis, i: d.i, size: Math.max(d.axis === 'col' ? 16 : 12, Math.round(d.size + delta)) });
      return;
    }
    if ('touch' in d && d.touch) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true;
      if (d.kind === 'select' || d.kind === 'cols' || d.kind === 'rows') return;
    }
    pointer.current = { x: e.clientX, y: e.clientY };
    dragMove(e.clientX, e.clientY);
    runAutoScroll();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    pointer.current = null;
    stopAutoScroll();
    if (d.kind === 'resize') {
      const size = live?.size ?? d.size;
      setLive(null);
      if (size !== d.size) {
        // Bordure glissée : le clic suivant n'est pas un double-clic.
        lastResizeDown.current = null;
        onSheet((latest, i) => setSizes(latest, i, d.axis === 'col' ? 'cw' : 'rh', d.targets, size));
      }
      return;
    }
    if (d.kind === 'fill') {
      const target = fillTarget;
      setFillTarget(null);
      if (!target) return;
      onSheet((latest, i) => setCells(latest, i, fillChanges(latest, i, d.src, target.dir, target.count)));
      const union = normRect(
        Math.min(d.src.r1, target.rect.r1),
        Math.min(d.src.c1, target.rect.c1),
        Math.max(d.src.r2, target.rect.r2),
        Math.max(d.src.c2, target.rect.c2),
      );
      const s = selRef.current;
      select({ ...s, kind: 'cells', ar: union.r1, ac: union.c1, fr: union.r2, fc: union.c2 }, null);
      return;
    }
    if (d.kind === 'select' && d.touch) {
      if (d.moved || e.type === 'pointercancel') return;
      const { r, c } = cellAtPoint(e.clientX, e.clientY);
      const ed = editRef.current;
      const s = selRef.current;
      if (ed) commitEdit(null, false, false);
      // Nouvel appui sur la cellule active : saisie (le clavier du téléphone s'ouvre).
      if (!ed && editable && s.kind === 'cells' && s.r === r && s.c === c && s.ar === s.fr && s.ac === s.fc) {
        startEdit({ mode: 'edit' });
        inputRef.current?.focus({ preventScroll: true });
        return;
      }
      select(cellSel(r, c), null);
      if (ed) inputRef.current?.blur();
      return;
    }
    if ((d.kind === 'cols' || d.kind === 'rows') && d.touch && !d.moved && e.type !== 'pointercancel' && d.at !== undefined) {
      const at = d.at;
      if (d.kind === 'cols') select({ kind: 'cols', ar: 0, ac: at, fr: MAX_ROWS - 1, fc: at, r: firstVisibleRow(), c: at }, null);
      else select({ kind: 'rows', ar: at, ac: 0, fr: at, fc: MAX_COLS - 1, r: at, c: firstVisibleCol() }, null);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!editable || editRef.current || e.target === inputRef.current) return;
    const { r, c } = cellAtPoint(e.clientX, e.clientY);
    select(cellSel(r, c), null);
    startEdit({ mode: 'edit' });
  };

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const touch = e.pointerType === 'touch';
    lastTouch.current = touch;
    if (editRef.current) commitEdit(null, false, false);
    const src = usedRect(rectOf(selRef.current));
    // Au doigt, la poignée agrandit la sélection ; à la souris, elle recopie (suites, formules).
    drag.current = touch
      ? { kind: 'extend', id: e.pointerId, touch: false, x: e.clientX, y: e.clientY, moved: false }
      : { kind: 'fill', id: e.pointerId, src };
    scrollRef.current?.setPointerCapture(e.pointerId);
  };

  const onHeadDown = (e: React.PointerEvent<HTMLDivElement>, axis: 'cols' | 'rows', at: number) => {
    if (e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    lastTouch.current = touch;
    if (editRef.current) commitEdit(null, false, false);
    setMenu(null);
    if (touch) {
      drag.current = { kind: axis, id: e.pointerId, touch, x: e.clientX, y: e.clientY, moved: false, at };
      return;
    }
    e.preventDefault();
    focusGrid();
    const s = selRef.current;
    if (axis === 'cols') {
      if (e.shiftKey && s.kind === 'cols') select({ ...s, fc: at }, null);
      else select({ kind: 'cols', ar: 0, ac: at, fr: MAX_ROWS - 1, fc: at, r: firstVisibleRow(), c: at }, null);
    } else if (e.shiftKey && s.kind === 'rows') select({ ...s, fr: at }, null);
    else select({ kind: 'rows', ar: at, ac: 0, fr: at, fc: MAX_COLS - 1, r: at, c: firstVisibleCol() }, null);
    drag.current = { kind: axis, id: e.pointerId, touch, x: e.clientX, y: e.clientY, moved: false, at };
    scrollRef.current?.setPointerCapture(e.pointerId);
  };

  const firstVisibleRow = () => rows.indexAt(vp.top);
  const firstVisibleCol = () => cols.indexAt(vp.left);

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>, axis: 'col' | 'row', i: number) => {
    if (!editable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Double-clic sur la bordure (le clic est capturé par la grille : détecté ici) : taille ajustée au contenu.
    const now = Date.now();
    const prev = lastResizeDown.current;
    lastResizeDown.current = { axis, i, t: now };
    if (prev && prev.axis === axis && prev.i === i && now - prev.t < 450) {
      lastResizeDown.current = null;
      autoFit(axis, i);
      return;
    }
    const s = selRef.current;
    const rect = rectOf(s);
    // Plusieurs colonnes (lignes) entières sélectionnées : toutes prennent la nouvelle taille.
    const targets: number[] = [];
    if (axis === 'col' && (s.kind === 'cols' || s.kind === 'all') && i >= rect.c1 && i <= rect.c2)
      for (let c = rect.c1; c <= Math.min(rect.c2, colCount - 1); c++) targets.push(c);
    else if (axis === 'row' && (s.kind === 'rows' || s.kind === 'all') && i >= rect.r1 && i <= rect.r2)
      for (let r = rect.r1; r <= Math.min(rect.r2, rowCount - 1); r++) targets.push(r);
    else targets.push(i);
    drag.current = {
      kind: 'resize',
      id: e.pointerId,
      axis,
      i,
      start: axis === 'col' ? e.clientX : e.clientY,
      size: axis === 'col' ? cols.size(i) : rows.size(i),
      targets,
    };
    scrollRef.current?.setPointerCapture(e.pointerId);
  };

  /** Double-clic sur la bordure d'un en-tête : largeur ajustée au contenu (ou hauteur par défaut). */
  const autoFit = (axis: 'col' | 'row', i: number) => {
    if (!editable) return;
    if (axis === 'row') {
      let lines = 1;
      for (let c = 0; c < idx.cols; c++) {
        const cell = idx.cells.get(keyOf(i, c));
        if (cell && typeof cell.v === 'string') lines = Math.max(lines, cell.v.split('\n').length);
      }
      onSheet((latest, n) => setSizes(latest, n, 'rh', [i], lines > 1 ? lines * LINE_H + 8 : null));
      return;
    }
    let w = 0;
    for (let r = 0; r < Math.min(idx.rows, 5000); r++) {
      const cell = idx.cells.get(keyOf(r, i));
      if (!cell || cell.v === null) continue;
      const text = engine.display(si, r, i).text;
      const font = fontOf(styleAt(wb, cell.s));
      for (const line of text.split('\n')) w = Math.max(w, textWidth(line, font));
    }
    onSheet((latest, n) => setSizes(latest, n, 'cw', [i], w ? Math.min(600, Math.max(30, Math.ceil(w) + 14)) : null));
  };

  const onBodyContextMenu = (e: React.MouseEvent) => {
    if (e.target === inputRef.current && editRef.current) return;
    e.preventDefault();
    if (drag.current && 'moved' in drag.current) drag.current.moved = true;
    if (editRef.current) commitEdit(null, false, false);
    const { r, c } = cellAtPoint(e.clientX, e.clientY);
    if (!inRect(r, c, rectOf(selRef.current))) select(cellSel(r, c), null);
    setMenu({ x: e.clientX, y: e.clientY, area: 'cells' });
  };

  const onHeadContextMenu = (e: React.MouseEvent, axis: 'cols' | 'rows', at: number) => {
    e.preventDefault();
    if (drag.current && 'moved' in drag.current) drag.current.moved = true;
    if (editRef.current) commitEdit(null, false, false);
    const s = selRef.current;
    const rect = rectOf(s);
    const inside =
      axis === 'cols'
        ? s.kind === 'cols' || s.kind === 'all'
          ? at >= rect.c1 && at <= rect.c2
          : false
        : s.kind === 'rows' || s.kind === 'all'
          ? at >= rect.r1 && at <= rect.r2
          : false;
    if (!inside) {
      if (axis === 'cols') select({ kind: 'cols', ar: 0, ac: at, fr: MAX_ROWS - 1, fc: at, r: firstVisibleRow(), c: at }, null);
      else select({ kind: 'rows', ar: at, ac: 0, fr: at, fc: MAX_COLS - 1, r: at, c: firstVisibleCol() }, null);
    }
    setMenu({ x: e.clientX, y: e.clientY, area: axis });
  };

  const onRootBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    setFocused(false);
    if (editRef.current) commitEdit(null, false, false);
  };

  // ---------- Fichiers ----------

  const fileError = (err: unknown): string => {
    const code = (err as { code?: string })?.code;
    switch (code) {
      case 'xls':
        return t('Ancien format .xls : enregistrez le fichier au format .xlsx dans Excel, puis importez-le.');
      case 'too-big':
        return t('Fichier trop volumineux (20 Mo au plus).');
      case 'too-many-cells':
        return t('Fichier trop grand : {max} cellules au plus.', { max: (50_000).toLocaleString(lang) });
      case 'format':
        return t('Format non reconnu : choisissez un fichier .xlsx ou .csv.');
      default:
        return t('Fichier illisible ou endommagé.');
    }
  };

  const importFile = async (file: File) => {
    try {
      const mod = await import('./xlsx');
      let imported = await mod.importFile(file, lang, `${props.sheetBase}1`);
      // Fichier CSV : la feuille prend le nom du fichier.
      if (/\.(csv|tsv|txt)$/i.test(file.name) && imported.sheets.length === 1) {
        const name = cleanSheetName(file.name.replace(/\.[^.]+$/, ''));
        if (name && !sheetNameProblem(imported, name, 0)) imported = renameSheet(imported, 0, name);
      }
      const empty = countCells(wb) === 0 && wb.sheets.length === 1;
      const first = empty ? 0 : wb.sheets.length;
      const ok = apply((latest) => (countCells(latest) === 0 && latest.sheets.length === 1 ? imported : appendWorkbook(latest, imported)));
      if (!ok) return;
      notify(tn(imported.sheets.length, 'Fichier importé : {n} feuille.', 'Fichier importé : {n} feuilles.'));
      setSi(first);
      select(cellSel(0, 0));
    } catch (err) {
      console.warn('Import du tableur impossible', err);
      notify(fileError(err), 'error');
    }
  };

  const exportAs = async (kind: 'xlsx' | 'csv', share = false) => {
    try {
      const mod = await import('./xlsx');
      let bytes: Uint8Array;
      let fileKind: FileKind;
      if (kind === 'xlsx') {
        bytes = mod.exportXlsx(wb, lang, si);
        fileKind = { mime: XLSX_MIME, ext: '.xlsx', description: t('Classeur Excel') };
      } else {
        bytes = new TextEncoder().encode(`﻿${mod.exportCsv(wb, si, lang)}`);
        fileKind = { mime: 'text/csv', ext: '.csv', description: t('Fichier CSV') };
      }
      const base = kind === 'csv' && wb.sheets.length > 1 ? `${props.fileBase} - ${sheet.name}` : props.fileBase;
      const name = mod.sheetFileName(base, kind);
      if (share) {
        await shareFile(bytes, name, fileKind.mime);
        return;
      }
      const res = await saveFile(bytes, name, fileKind);
      if (res === 'saved') notify(t('Fichier enregistré.'));
      else if (res === 'downloaded') notify(t('Fichier téléchargé.'));
    } catch (err) {
      console.warn('Export du tableur impossible', err);
      notify(t('Export impossible.'), 'error');
    }
  };

  // ---------- Feuilles ----------

  const sheetProblemText = (p: 'empty' | 'chars' | 'taken') =>
    p === 'empty'
      ? t('Nom de feuille vide ou trop long (31 caractères au plus).')
      : p === 'chars'
        ? t('Caractères interdits dans un nom de feuille : [ ] : * ? / \\')
        : t('Une autre feuille porte déjà ce nom.');

  const renamingRef = useRef(renaming);
  renamingRef.current = renaming;
  const commitRename = () => {
    const r = renamingRef.current;
    if (!r) return;
    renamingRef.current = null;
    setRenaming(null);
    const name = r.name.trim();
    const old = wb.sheets[r.i]?.name;
    if (!old || name === old) return;
    const problem = sheetNameProblem(wb, name, r.i);
    if (problem) {
      notify(sheetProblemText(problem), 'error');
      return;
    }
    // Les formules qui citaient l'ancien nom sont réécrites : modification qui ne se refait pas.
    onSheet((latest, i) => renameSheet(latest, i, name), old, false);
  };

  const addNewSheet = () => {
    if (editRef.current) commitEdit(null, false, false);
    if (!apply((latest) => addSheet(latest, nextSheetName(latest, props.sheetBase)))) return;
    selBySheet.current.set(sheet.name, selRef.current);
    setSi(wb.sheets.length);
    select(cellSel(0, 0));
    focusGrid();
  };

  const removeSheet = (i: number) => {
    if (wb.sheets.length < 2) return;
    const name = wb.sheets[i].name;
    onSheet((latest, n) => deleteSheet(latest, n), name, false);
    if (si >= i && si > 0) setSi(si - 1);
    notify(t('Feuille « {name} » supprimée (Ctrl+Z pour annuler).', { name }));
  };

  const copySheet = (i: number) => {
    const src = wb.sheets[i];
    let name = `${src.name.slice(0, 26)} (2)`;
    for (let n = 3; sheetNameProblem(wb, name); n++) name = `${src.name.slice(0, 26)} (${n})`;
    onSheet((latest, n) => duplicateSheet(latest, n, name), src.name, false);
  };

  // ---------- Rendu ----------

  const viewW = Math.max(0, vp.w - headW);
  const viewH = Math.max(0, vp.h - HEAD_H);
  const r0 = Math.max(0, rows.indexAt(vp.top) - OVERSCAN);
  const r1 = Math.min(rowCount - 1, rows.indexAt(vp.top + viewH) + OVERSCAN);
  const c0 = Math.max(0, cols.indexAt(vp.left) - OVERSCAN);
  const c1 = Math.min(colCount - 1, cols.indexAt(vp.left + viewW) + OVERSCAN);
  const rect = rectOf(sel);
  const shownRect = {
    r1: Math.min(rect.r1, rowCount - 1),
    c1: Math.min(rect.c1, colCount - 1),
    r2: Math.min(rect.r2, rowCount - 1),
    c2: Math.min(rect.c2, colCount - 1),
  };
  const multi = rect.r1 !== rect.r2 || rect.c1 !== rect.c2;
  const editingHere = edit && edit.si === si;

  const cells: ReactNode[] = [];
  for (let r = r0; r <= r1; r++) {
    const top = rows.pos(r);
    const h = rows.size(r);
    // Texte d'une cellule à gauche de la zone visible qui déborde jusqu'ici.
    let start = c0;
    for (let back = c0 - 1; back >= Math.max(0, c0 - 40); back--) {
      const cell = idx.cells.get(keyOf(r, back));
      if (cell && cell.v !== null && cell.v !== '') {
        start = back;
        break;
      }
    }
    for (let c = start; c <= c1; c++) {
      if (editingHere && edit.r === r && edit.c === c) continue;
      const cell = idx.cells.get(keyOf(r, c));
      if (!cell) continue;
      const st = styleAt(wb, cell.s);
      const hasValue = cell.v !== null && cell.v !== '';
      if (!hasValue && !st.bg) continue;
      const d = hasValue ? engine.display(si, r, c) : { text: '', value: null as CellValue | null, color: undefined };
      const value = d.value;
      const al = st.al ?? (typeof value === 'number' ? 'right' : typeof value === 'boolean' || isError(value) ? 'center' : 'left');
      let width = cols.size(c);
      let end = c;
      const font = fontOf(st);
      if (typeof value === 'string' && !st.wr && al === 'left' && d.text) {
        const need = textWidth(d.text.split('\n')[0], font) + 8;
        while (need > width && end + 1 < colCount && end < c1 + 40) {
          const next = idx.cells.get(keyOf(r, end + 1));
          if (next && ((next.v !== null && next.v !== '') || styleAt(wb, next.s).bg)) break;
          if (editingHere && edit.r === r && edit.c === end + 1) break;
          end++;
          width += cols.size(end);
        }
      }
      if (end < c0 && c < c0) continue;
      let text = d.text;
      // Nombre trop large pour sa colonne : « ### », comme Excel.
      if (typeof value === 'number' && !st.wr && textWidth(text, font) + 7 > width) text = '#'.repeat(Math.max(1, Math.floor((width - 6) / 8)));
      const style: CSSProperties = {
        left: cols.pos(c),
        top,
        width: st.bg ? width : width - 1,
        height: st.bg ? h : h - 1,
        justifyContent: al === 'right' ? 'flex-end' : al === 'center' ? 'center' : 'flex-start',
        textAlign: al,
      };
      const color = d.color ?? ink(st, dark);
      if (color) style.color = color;
      if (st.bg) style.background = st.bg;
      if (st.b) style.fontWeight = 600;
      if (st.i) style.fontStyle = 'italic';
      if (st.u || st.st) style.textDecoration = `${st.u ? 'underline' : ''} ${st.st ? 'line-through' : ''}`.trim();
      cells.push(
        <div
          key={keyOf(r, c)}
          data-a={addr(r, c)}
          className={`xl-cell${st.wr ? ' xl-cell--wrap' : ''}${end > c && !st.bg ? ' xl-cell--spill' : ''}`}
          style={style}
          title={isError(value) ? errorHelp(value, lang) : undefined}
        >
          {text}
        </div>,
      );
    }
  }

  const gridLeft = cols.pos(c0);
  const gridRight = cols.pos(c1 + 1);
  const gridTop = rows.pos(r0);
  const gridBottom = rows.pos(r1 + 1);
  const lines: ReactNode[] = [];
  for (let r = r0; r <= r1; r++)
    lines.push(<div key={`h${r}`} className="xl-hl" style={{ top: rows.pos(r + 1) - 1, left: gridLeft, width: gridRight - gridLeft }} />);
  for (let c = c0; c <= c1; c++)
    lines.push(<div key={`v${c}`} className="xl-vl" style={{ left: cols.pos(c + 1) - 1, top: gridTop, height: gridBottom - gridTop }} />);

  const box = (r: Rect) => ({
    left: cols.pos(r.c1),
    top: rows.pos(r.r1),
    width: cols.pos(r.c2 + 1) - cols.pos(r.c1),
    height: rows.pos(r.r2 + 1) - rows.pos(r.r1),
  });
  const selBox = box(shownRect);
  const activeBox = box({ r1: sel.r, c1: sel.c, r2: sel.r, c2: sel.c });

  // Références de la formule en cours de saisie, en couleur.
  const refBoxes: ReactNode[] = [];
  if (edit && edit.text.startsWith('=')) {
    formulaRefs(edit.text, lang).forEach((x, n) => {
      const on = x.ref.sheet === null ? edit.si === si : x.ref.sheet.toLowerCase() === sheet.name.toLowerCase();
      if (!on) return;
      const rr = normRect(x.ref.a.row, x.ref.a.col, x.ref.b.row, x.ref.b.col);
      const shown = {
        r1: Math.min(rr.r1, rowCount - 1),
        c1: Math.min(rr.c1, colCount - 1),
        r2: Math.min(rr.r2, rowCount - 1),
        c2: Math.min(rr.c2, colCount - 1),
      };
      const color = REF_COLORS[n % REF_COLORS.length];
      refBoxes.push(
        <div
          key={`ref${n}`}
          className="xl-ref"
          style={{ ...box(shown), borderColor: color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
        />,
      );
    });
  }

  // Champ de saisie : invisible sur la cellule active (il reçoit le clavier), visible pendant la saisie.
  let inputStyle: CSSProperties;
  const showEditor = !!editingHere;
  if (showEditor) {
    const left = cols.pos(edit.c);
    const top = rows.pos(edit.r);
    const w0 = cols.size(edit.c);
    const h0 = rows.size(edit.r);
    const font = fontOf(styleAt(wb, cellAt(sheet, edit.r, edit.c).s));
    const textLines = edit.text.split('\n');
    const maxW = Math.max(w0, vp.left + viewW - left - 2);
    const width = Math.min(Math.max(w0, Math.max(...textLines.map((l) => textWidth(l, font))) + 16), maxW);
    const wrapped = textLines.reduce((n, l) => n + Math.max(1, Math.ceil((textWidth(l, font) + 12) / Math.max(20, width - 4))), 0);
    inputStyle = { left: left - 1, top: top - 1, width: width + 1, height: Math.max(h0 + 1, wrapped * LINE_H + 8), font, textAlign: 'left' };
  } else {
    inputStyle = { left: activeBox.left, top: activeBox.top, width: Math.min(activeBox.width, 200), height: activeBox.height };
  }

  const colHeads: ReactNode[] = [];
  for (let c = c0; c <= c1; c++) {
    const selected = c >= rect.c1 && c <= rect.c2;
    const fullSel = selected && (sel.kind === 'cols' || sel.kind === 'all');
    colHeads.push(
      <div
        key={c}
        className={`xl-h${selected ? ' xl-h--sel' : ''}${fullSel ? ' xl-h--full' : ''}`}
        style={{ left: headW + cols.pos(c), width: cols.size(c) }}
        onPointerDown={(e) => onHeadDown(e, 'cols', c)}
        onContextMenu={(e) => onHeadContextMenu(e, 'cols', c)}
      >
        <span className="xl-h-label">{colName(c)}</span>
        {editable ? <div className="xl-rsz-x" onPointerDown={(e) => onResizeDown(e, 'col', c)} /> : null}
      </div>,
    );
  }
  const rowHeads: ReactNode[] = [];
  for (let r = r0; r <= r1; r++) {
    const selected = r >= rect.r1 && r <= rect.r2;
    const fullSel = selected && (sel.kind === 'rows' || sel.kind === 'all');
    rowHeads.push(
      <div
        key={r}
        className={`xl-h${selected ? ' xl-h--sel' : ''}${fullSel ? ' xl-h--full' : ''}`}
        style={{ top: rows.pos(r), height: rows.size(r) }}
        onPointerDown={(e) => onHeadDown(e, 'rows', r)}
        onContextMenu={(e) => onHeadContextMenu(e, 'rows', r)}
      >
        <span className="xl-h-label">{r + 1}</span>
        {editable ? <div className="xl-rsz-y" onPointerDown={(e) => onResizeDown(e, 'row', r)} /> : null}
      </div>,
    );
  }

  // Barre d'état : explication d'une erreur, ou somme et moyenne des nombres sélectionnés.
  const activeValue = engine.value(si, sel.r, sel.c);
  let status = '';
  if (isError(activeValue)) status = errorHelp(activeValue, lang);
  else if (multi) {
    const stats = selectionStats(engine, si, rect);
    if (stats.numbers) {
      const nf = activeStyle.nf;
      const fmt = (n: number) => (nf && !isTextFormat(nf) ? formatValue(n, nf, lang).text : generalNumber(n, lang));
      status = `${t('Somme : {value}', { value: fmt(stats.sum) })} · ${t('Moyenne : {value}', { value: fmt(stats.sum / stats.numbers) })} · ${t('Nombre : {n}', { n: stats.count })}`;
    } else if (stats.count > 1) status = t('Nombre : {n}', { n: stats.count });
  }

  const nameText =
    sel.kind === 'cells'
      ? multi
        ? rectName(rect)
        : addr(sel.r, sel.c)
      : sel.kind === 'all'
        ? t('Tout')
        : sel.kind === 'cols'
          ? `${colName(rect.c1)}:${colName(rect.c2)}`
          : `${rect.r1 + 1}:${rect.r2 + 1}`;
  const goToName = (text: string) => {
    const m = /^\s*([A-Za-z]{1,3}\d{1,7})(?::([A-Za-z]{1,3}\d{1,7}))?\s*$/.exec(text);
    const a = m && parseAddr(m[1].toUpperCase());
    const b = m && (m[2] ? parseAddr(m[2].toUpperCase()) : a);
    if (!a || !b) {
      notify(t('Adresse incorrecte (exemples : B3, A1:C10).'), 'error');
      return;
    }
    select({ kind: 'cells', ar: a.r, ac: a.c, fr: b.r, fc: b.c, r: a.r, c: a.c }, { r: a.r, c: a.c });
    pendingReveal.current = { r: a.r, c: a.c };
    inputRef.current?.focus({ preventScroll: true });
  };

  const barText = edit ? edit.text : editText(activeCell.v, activeStyle.nf, lang);
  const formats = formatOptions();
  const formatLabel = formats.find((f) => f.nf === activeStyle.nf)?.label ?? t('Personnalisé');

  const tb = (
    icon: IconName,
    label: string,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void,
    opts: { on?: boolean; disabled?: boolean; keys?: string; swatch?: string } = {},
  ) => (
    <button
      type="button"
      className={`xl-tb${opts.on ? ' xl-tb--on' : ''}`}
      title={opts.keys ? `${label} (${opts.keys})` : label}
      aria-label={label}
      aria-pressed={opts.on}
      disabled={opts.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
      {opts.swatch ? <span className="xl-tb-swatch" style={{ background: opts.swatch }} /> : null}
    </button>
  );
  const openPop = (kind: PopState['kind']) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget.getBoundingClientRect();
    setPop((p) => (p?.kind === kind ? null : { kind, anchor }));
  };
  const sep = lang === 'fr' ? ',' : '.';

  const toolbar = (
    <div className="xl-toolbar">
      {/* Outils de mise en forme : défilent sur un écran étroit ; import, export et plein écran restent visibles. */}
      <div className="xl-tb-main">
        {editable ? (
          <>
            {tb('undo', t('Annuler'), props.undo, { keys: shortcut('Z') })}
            {tb('redo', t('Rétablir'), props.redo, { keys: shortcut('Y') })}
            <span className="xl-tb-sep" />
            <button
              type="button"
              className="xl-tb xl-tb--text"
              title={t('Format des nombres')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={openPop('format')}
            >
              <span className="xl-tb-label">{formatLabel}</span>
              <Icon name="chevronDown" size={13} />
            </button>
            <button
              type="button"
              className="xl-tb xl-tb--text"
              title={t('Moins de décimales')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => changeDecimals(-1)}
            >
              {`${sep}0`}
              <Icon name="arrowDown" size={12} />
            </button>
            <button
              type="button"
              className="xl-tb xl-tb--text"
              title={t('Plus de décimales')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => changeDecimals(1)}
            >
              {`${sep}00`}
              <Icon name="arrowUp" size={12} />
            </button>
            <span className="xl-tb-sep" />
            {tb('bold', t('Gras'), () => toggleStyle('b'), { on: !!activeStyle.b, keys: shortcut('B') })}
            {tb('italic', t('Italique'), () => toggleStyle('i'), { on: !!activeStyle.i, keys: shortcut('I') })}
            {tb('underline', t('Souligné'), () => toggleStyle('u'), { on: !!activeStyle.u, keys: shortcut('U') })}
            {tb('strike', t('Barré'), () => toggleStyle('st'), { on: !!activeStyle.st })}
            {tb('textColor', t('Couleur du texte'), openPop('color'), { swatch: activeStyle.c ?? 'currentColor' })}
            {tb('fillColor', t('Couleur de fond'), openPop('fill'), { swatch: activeStyle.bg ?? 'transparent' })}
            <span className="xl-tb-sep" />
            <button
              type="button"
              className="xl-tb"
              title={t('Alignement')}
              aria-label={t('Alignement')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={openPop('align')}
            >
              <Icon name={activeStyle.al === 'center' ? 'alignCenter' : activeStyle.al === 'right' ? 'alignRight' : 'alignLeft'} size={16} />
              <Icon name="chevronDown" size={12} />
            </button>
            {tb('sigma', t('Somme automatique'), autoSum)}
          </>
        ) : null}
      </div>
      <div className="xl-tb-side">
        {editable ? tb('upload', t('Importer un fichier Excel ou CSV'), () => fileRef.current?.click()) : null}
        {tb('download', t('Exporter (Excel, CSV)'), openPop('export'))}
        {tb(full ? 'minimize' : 'maximize', full ? t('Quitter le plein écran') : t('Plein écran'), () => setFull((f) => !f))}
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </div>
    </div>
  );

  const formulaBar = (
    <div className="xl-fbar">
      <input
        className="xl-name"
        value={nameDraft ?? nameText}
        aria-label={t('Adresse de la cellule')}
        spellCheck={false}
        onFocus={(e) => {
          setNameDraft(nameText);
          e.currentTarget.select();
        }}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={() => setNameDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            goToName(e.currentTarget.value);
            setNameDraft(null);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setNameDraft(null);
            inputRef.current?.focus({ preventScroll: true });
          }
        }}
      />
      <span className="xl-fx" aria-hidden="true">
        {'fx'}
      </span>
      <textarea
        ref={barRef}
        className="xl-formula"
        rows={1}
        value={barText}
        readOnly={!editable}
        spellCheck={false}
        aria-label={t('Contenu de la cellule')}
        onFocus={() => {
          if (!editable) return;
          const ed = editRef.current;
          if (!ed) startEdit({ mode: 'edit', where: 'bar', caret: barRef.current?.selectionStart ?? undefined });
          else if (ed.where !== 'bar') setEdit({ ...ed, where: 'bar', mode: 'edit' });
        }}
        onChange={onInputChange}
        onKeyDown={(e) => {
          if (editRef.current) onEditKey(e);
        }}
        onSelect={onSelectText}
      />
    </div>
  );

  const tabs = (
    <div className="xl-foot">
      <div className="xl-tabs">
        {wb.sheets.map((s, i) =>
          renaming?.i === i ? (
            <input
              key={`r${i}`}
              className="xl-tab-input"
              autoFocus
              value={renaming.name}
              maxLength={31}
              onChange={(e) => setRenaming({ i, name: e.target.value })}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                  inputRef.current?.focus({ preventScroll: true });
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenaming(null);
                  inputRef.current?.focus({ preventScroll: true });
                }
              }}
            />
          ) : (
            <button
              key={s.name}
              type="button"
              className={`xl-tab${i === si ? ' xl-tab--on' : ''}`}
              onMouseDown={(e) => {
                // Pendant la saisie d'une formule, le curseur reste dans la saisie.
                if (editRef.current) e.preventDefault();
              }}
              onClick={() => pickSheet(i)}
              onDoubleClick={() => editable && setRenaming({ i, name: s.name })}
              onContextMenu={(e) => {
                e.preventDefault();
                pickSheet(i);
                setMenu({ x: e.clientX, y: e.clientY, area: 'tab', tab: i });
              }}
            >
              {s.name}
            </button>
          ),
        )}
        {editable ? (
          <button type="button" className="xl-tab xl-tab-add" title={t('Nouvelle feuille')} aria-label={t('Nouvelle feuille')} onClick={addNewSheet}>
            <Icon name="plus" size={14} />
          </button>
        ) : null}
      </div>
      {status ? (
        <div className="xl-status" title={status}>
          {status}
        </div>
      ) : null}
    </div>
  );

  const menuItem = (icon: IconName | null, label: string, run: () => void, opts: { keys?: string; danger?: boolean; disabled?: boolean } = {}) => (
    <button
      type="button"
      className={opts.danger ? 'nb-menu-danger' : undefined}
      disabled={opts.disabled}
      onClick={() => {
        setMenu(null);
        run();
        focusGrid();
      }}
    >
      {icon ? <Icon name={icon} size={15} /> : <span className="xl-menu-icon" />}
      <span className="xl-menu-label">{label}</span>
      {opts.keys && !touchScreen() ? <kbd className="xl-menu-keys">{opts.keys}</kbd> : null}
    </button>
  );

  let menuNode: ReactNode = null;
  if (menu) {
    const nRows = Math.min(selectionCount(sel, 'rows'), 1000);
    const nCols = Math.min(selectionCount(sel, 'cols'), 1000);
    const wholeSheet = sel.kind === 'all';
    const items: ReactNode[] = [];
    if (menu.area === 'tab' && menu.tab !== undefined) {
      const i = menu.tab;
      if (editable) {
        items.push(menuItem('pencil', t('Renommer'), () => setRenaming({ i, name: wb.sheets[i].name }), { keys: undefined }));
        items.push(menuItem('copy', t('Dupliquer'), () => copySheet(i)));
        items.push(<div key="s1" className="nb-menu-sep" />);
        items.push(menuItem('trash', t('Supprimer la feuille'), () => removeSheet(i), { danger: true, disabled: wb.sheets.length < 2 }));
      }
    } else {
      if (editable) items.push(menuItem('scissors', t('Couper'), () => void menuCopy(true), { keys: shortcut('X') }));
      items.push(menuItem('copy', t('Copier'), () => void menuCopy(false), { keys: shortcut('C') }));
      if (editable) {
        items.push(menuItem(null, t('Coller'), () => void menuPaste(), { keys: shortcut('V') }));
        items.push(<div key="s1" className="nb-menu-sep" />);
        if (menu.area !== 'cols' && !wholeSheet) {
          items.push(menuItem('plus', tn(nRows, 'Insérer {n} ligne au-dessus', 'Insérer {n} lignes au-dessus'), () => insertLines('rows', false)));
          items.push(menuItem(null, tn(nRows, 'Insérer {n} ligne en dessous', 'Insérer {n} lignes en dessous'), () => insertLines('rows', true)));
        }
        if (menu.area !== 'rows' && !wholeSheet) {
          items.push(menuItem('plus', tn(nCols, 'Insérer {n} colonne à gauche', 'Insérer {n} colonnes à gauche'), () => insertLines('cols', false)));
          items.push(menuItem(null, tn(nCols, 'Insérer {n} colonne à droite', 'Insérer {n} colonnes à droite'), () => insertLines('cols', true)));
        }
        if (menu.area !== 'cols' && !wholeSheet)
          items.push(menuItem('minus', tn(nRows, 'Supprimer {n} ligne', 'Supprimer {n} lignes'), () => deleteLines('rows')));
        if (menu.area !== 'rows' && !wholeSheet)
          items.push(menuItem('minus', tn(nCols, 'Supprimer {n} colonne', 'Supprimer {n} colonnes'), () => deleteLines('cols')));
        items.push(<div key="s2" className="nb-menu-sep" />);
        if (menu.area === 'cells') {
          items.push(menuItem('sortAsc', t('Trier de A à Z'), () => sort(false)));
          items.push(menuItem('sortDesc', t('Trier de Z à A'), () => sort(true)));
          items.push(menuItem('arrowDown', t('Recopier vers le bas'), () => fillDownRight(true), { keys: shortcut('D') }));
          items.push(menuItem(null, t('Recopier vers la droite'), () => fillDownRight(false), { keys: shortcut('R') }));
          items.push(<div key="s3" className="nb-menu-sep" />);
        }
        if (menu.area === 'cols') items.push(menuItem('width', t('Ajuster la largeur au contenu'), () => autoFit('col', sel.fc)));
        items.push(
          menuItem('eraser', t('Effacer le contenu'), () => clearSelection('contents'), { keys: touchScreen() ? undefined : MAC ? '⌫' : t('Suppr') }),
        );
        items.push(menuItem(null, t('Effacer la mise en forme'), () => clearSelection('formats')));
      }
    }
    menuNode = items.length ? (
      <Popover anchor={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} className="xl-menu">
        {items}
      </Popover>
    ) : null;
  }

  let popNode: ReactNode = null;
  if (pop) {
    const close = () => setPop(null);
    if (pop.kind === 'color' || pop.kind === 'fill') {
      const k = pop.kind === 'color' ? 'c' : 'bg';
      popNode = (
        <Popover anchor={pop.anchor} onClose={close} className="xl-colors">
          <button
            type="button"
            className="xl-color-auto"
            onClick={() => {
              setColor(k, null);
              close();
            }}
          >
            {k === 'c' ? t('Couleur automatique') : t('Aucun fond')}
          </button>
          <div className="xl-palette">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`xl-swatch${activeStyle[k] === color ? ' xl-swatch--on' : ''}`}
                style={{ background: color }}
                title={color}
                aria-label={color}
                onClick={() => {
                  setColor(k, color);
                  close();
                }}
              />
            ))}
          </div>
        </Popover>
      );
    } else if (pop.kind === 'align') {
      const choice = (icon: IconName, label: string, on: boolean, run: () => void) => (
        <button
          type="button"
          onClick={() => {
            run();
            close();
          }}
        >
          <Icon name={icon} size={15} />
          <span className="xl-menu-label">{label}</span>
          <span className="xl-menu-icon">{on ? <Icon name="check" size={14} /> : null}</span>
        </button>
      );
      popNode = (
        <Popover anchor={pop.anchor} onClose={close}>
          {choice('alignLeft', t('Aligner à gauche'), activeStyle.al === 'left', () => setAlign('left'))}
          {choice('alignCenter', t('Centrer'), activeStyle.al === 'center', () => setAlign('center'))}
          {choice('alignRight', t('Aligner à droite'), activeStyle.al === 'right', () => setAlign('right'))}
          <div className="nb-menu-sep" />
          {choice('wrapText', t('Renvoyer à la ligne automatiquement'), !!activeStyle.wr, () => toggleStyle('wr'))}
        </Popover>
      );
    } else if (pop.kind === 'format') {
      const sample = engine.value(si, sel.r, sel.c);
      popNode = (
        <Popover anchor={pop.anchor} onClose={close} className="xl-formats">
          {formats.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => {
                setFormat(f.nf);
                close();
              }}
            >
              <span className="xl-menu-icon">{f.nf === activeStyle.nf ? <Icon name="check" size={14} /> : null}</span>
              <span className="xl-menu-label">{f.label}</span>
              <span className="xl-format-sample">{typeof sample === 'number' ? formatValue(sample, f.nf, lang).text : ''}</span>
            </button>
          ))}
        </Popover>
      );
    } else {
      popNode = (
        <Popover anchor={pop.anchor} onClose={close}>
          <button
            type="button"
            onClick={() => {
              close();
              void exportAs('xlsx');
            }}
          >
            <Icon name="table" size={15} /> {t('Classeur Excel (.xlsx)')}
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              void exportAs('csv');
            }}
          >
            <Icon name="file" size={15} /> {t('Feuille en CSV (.csv)')}
          </button>
          {isNative() ? (
            <button
              type="button"
              onClick={() => {
                close();
                void exportAs('xlsx', true);
              }}
            >
              <Icon name="share" size={15} /> {t('Partager le classeur')}
            </button>
          ) : null}
        </Popover>
      );
    }
  }

  const acNode =
    acShown && !acClosed && acPos
      ? createPortal(
          <div className="nb-menu xl-ac" style={{ left: acPos.left, top: acPos.top }} onMouseDown={(e) => e.preventDefault()}>
            {suggestions.map((name, i) => (
              <button key={name} type="button" className={i === acIndex ? 'xl-ac--on' : undefined} onClick={() => acceptSuggestion(name)}>
                {name}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  const grid = (
    <div
      ref={scrollRef}
      className="xl-scroll"
      style={full ? undefined : { height: props.height }}
      onScroll={onScroll}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="xl-canvas" style={{ width: headW + cols.total(), height: HEAD_H + rows.total() }}>
        <div className="xl-colhead" style={{ width: headW + cols.total() }}>
          <div
            className={`xl-corner${sel.kind === 'all' ? ' xl-h--full' : ''}`}
            style={{ width: headW }}
            title={t('Tout sélectionner')}
            onPointerDown={(e) => {
              e.preventDefault();
              if (editRef.current) commitEdit(null, false, false);
              focusGrid();
              select({ kind: 'all', ar: 0, ac: 0, fr: MAX_ROWS - 1, fc: MAX_COLS - 1, r: sel.r, c: sel.c }, null);
            }}
          />
          {colHeads}
        </div>
        <div className="xl-rowhead" style={{ width: headW, height: rows.total() }}>
          {rowHeads}
        </div>
        <div
          ref={bodyRef}
          className="xl-body"
          style={{ left: headW, top: HEAD_H, width: cols.total(), height: rows.total() }}
          onPointerDown={onBodyPointerDown}
          onDoubleClick={onDoubleClick}
          onContextMenu={onBodyContextMenu}
        >
          {lines}
          {cells}
          {clipMark && clipMark.sheet === sheet.name ? (
            <div
              className="xl-clip"
              style={box({
                r1: clipMark.rect.r1,
                c1: clipMark.rect.c1,
                r2: Math.min(clipMark.rect.r2, rowCount - 1),
                c2: Math.min(clipMark.rect.c2, colCount - 1),
              })}
            />
          ) : null}
          {refBoxes}
          {multi ? (
            <div
              className={`xl-sel xl-sel--range${focused ? '' : ' xl-sel--blur'}`}
              style={{ left: selBox.left - 1, top: selBox.top - 1, width: selBox.width + 1, height: selBox.height + 1 }}
            />
          ) : null}
          <div
            className={`xl-active${focused || edit ? '' : ' xl-sel--blur'}${multi ? ' xl-active--in' : ''}`}
            style={{ left: activeBox.left - 1, top: activeBox.top - 1, width: activeBox.width + 1, height: activeBox.height + 1 }}
          />
          {fillTarget ? <div className="xl-fill" style={box(fillTarget.rect)} /> : null}
          {editable && !edit && sel.kind === 'cells' ? (
            <div
              className="xl-handle"
              style={{ left: selBox.left + selBox.width - 4, top: selBox.top + selBox.height - 4 }}
              onPointerDown={onHandleDown}
            />
          ) : null}
          <textarea
            ref={inputRef}
            className={`xl-input${showEditor ? '' : ' xl-input--idle'}`}
            style={inputStyle}
            value={edit ? edit.text : ''}
            readOnly={!editable}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label={t('Cellule {name}', { name: addr(sel.r, sel.c) })}
            tabIndex={0}
            onKeyDown={onInputKey}
            onChange={onInputChange}
            onSelect={onSelectText}
            onCopy={onCopy}
            onCut={onCut}
            onPaste={onPaste}
            onCompositionStart={() => {
              if (!editRef.current && editable) startEdit({ text: '', mode: 'enter' });
            }}
          />
        </div>
      </div>
    </div>
  );

  const view = (
    <div ref={rootRef} className={`xl${full ? ' xl--full' : ''}${focused ? ' xl--focus' : ''}`} onFocus={() => setFocused(true)} onBlur={onRootBlur}>
      {toolbar}
      {formulaBar}
      {grid}
      {tabs}
      {menuNode}
      {popNode}
      {acNode}
    </div>
  );

  if (full)
    return (
      <>
        <div className="xl-fullnote">
          <Icon name="table" size={16} /> {t('Tableur affiché en plein écran.')}
          <button type="button" className="nb-btn" onClick={() => setFull(false)}>
            {t('Revenir à la page')}
          </button>
        </div>
        {createPortal(<div className="xl-overlay">{view}</div>, document.body)}
      </>
    );
  return view;
}
