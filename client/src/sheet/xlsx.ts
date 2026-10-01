// Tableur : fichiers Excel (.xlsx, Office Open XML : archive zip de fichiers XML) et CSV.
// Export : valeurs, formules (avec leur résultat, recalculées à l'ouverture), styles, formats de nombre, largeurs de
// colonnes, hauteurs de lignes, feuilles. Import : les mêmes éléments ; une formule qu'on ne sait pas calculer
// (fonction absente, tableau structuré…) garde la valeur enregistrée par Excel.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { Lang } from '../lib/i18n';
import { MAX_COLS, MAX_ROWS, addr, parseAddr } from './address';
import { Engine, FUNCTION_NAMES } from './engine';
import { isDateFormat, parseInput, toSerial } from './format';
import { XLFN, delocalizeFormula, parseFormula, shiftFormula, tokenize, type Node } from './formula';
import { DEFAULT_COL_WIDTH, MAX_CELLS, indexSheet, internStyle, type CellStyle, type Sheet, type StoredCell, type Workbook } from './model';
import { isError, isFormula, storeText, textOf, type CellValue } from './values';

/** Problème d'import : fichier illisible, trop gros, trop de cellules, ancien format .xls. */
export class SheetFileError extends Error {
  readonly code: 'format' | 'too-big' | 'too-many-cells' | 'xls' | 'damaged';
  readonly count: number;
  constructor(code: SheetFileError['code'], count = 0) {
    super(code);
    this.code = code;
    this.count = count;
  }
}

const MAX_FILE = 20 * 1024 * 1024;
const MAX_PART = 120 * 1024 * 1024;

// ---------- XML ----------

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e] ?? m;
  });
}

/** Caractères qu'Excel écrit sous la forme « _x000D_ ». */
const unescapeExcel = (s: string) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

type SaxHandlers = {
  open?: (name: string, attrs: Record<string, string>, selfClosing: boolean) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
};

/** Lecture d'un document XML au fil de l'eau (noms sans préfixe d'espace de noms). */
function sax(xml: string, h: SaxHandlers): void {
  const re =
    /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m.index > last && h.text) h.text(decode(xml.slice(last, m.index)));
    last = re.lastIndex;
    if (m[5] !== undefined) {
      h.text?.(m[5]);
      continue;
    }
    if (!m[2]) continue;
    const name = m[2].includes(':') ? m[2].slice(m[2].indexOf(':') + 1) : m[2];
    if (m[1]) {
      h.close?.(name);
      continue;
    }
    const attrs: Record<string, string> = {};
    if (m[3]) {
      const ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[3]))) {
        const key = a[1].includes(':') && !a[1].startsWith('xmlns') ? a[1].slice(a[1].indexOf(':') + 1) : a[1];
        attrs[key] = decode(a[2] ?? a[3] ?? '');
      }
    }
    h.open?.(name, attrs, Boolean(m[4]));
    if (m[4]) h.close?.(name);
  }
}

type XNode = { name: string; attrs: Record<string, string>; children: XNode[]; text: string };

/** Arbre d'un petit document XML (classeur, styles, relations, thème). */
function tree(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  sax(xml, {
    open: (name, attrs) => {
      const node: XNode = { name, attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    },
    close: () => {
      if (stack.length > 1) stack.pop();
    },
    text: (t) => {
      stack[stack.length - 1].text += t;
    },
  });
  return root;
}

const kids = (n: XNode | undefined, name: string) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n: XNode | undefined, name: string) => n?.children.find((c) => c.name === name);
function find(n: XNode, name: string): XNode | undefined {
  for (const c of n.children) {
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ---------- Couleurs ----------

/** Palette indexée d'Excel (anciens fichiers). */
const INDEXED = [
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '800000',
  '008000',
  '000080',
  '808000',
  '800080',
  '008080',
  'C0C0C0',
  '808080',
  '9999FF',
  '993366',
  'FFFFCC',
  'CCFFFF',
  '660066',
  'FF8080',
  '0066CC',
  'CCCCFF',
  '000080',
  'FF00FF',
  'FFFF00',
  '00FFFF',
  '800080',
  '800000',
  '008080',
  '0000FF',
  '00CCFF',
  'CCFFFF',
  'CCFFCC',
  'FFFF99',
  '99CCFF',
  'FF99CC',
  'CC99FF',
  'FFCC99',
  '3366FF',
  '33CCCC',
  '99CC00',
  'FFCC00',
  'FF9900',
  'FF6600',
  '666699',
  '969696',
  '003366',
  '339966',
  '003300',
  '333300',
  '993300',
  '993366',
  '333399',
  '333333',
];
/** Couleurs du thème Office par défaut, dans l'ordre des numéros de thème d'Excel (clair 1, sombre 1, clair 2…). */
const OFFICE_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

/** Couleur éclaircie (t > 0) ou assombrie (t < 0) comme Excel : sur la luminosité (TSL). */
function tint(hex: string, t: number): string {
  if (!t) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const hue = (p: number, q: number, x: number) => {
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let rgb: number[];
  if (s === 0) rgb = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rgb = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return rgb
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();
}

function colorOf(n: XNode | undefined, theme: string[]): string | null {
  if (!n || n.attrs.auto === '1') return null;
  let hex: string | null = null;
  if (n.attrs.rgb) hex = n.attrs.rgb.slice(-6);
  else if (n.attrs.theme !== undefined) hex = theme[Number(n.attrs.theme)] ?? null;
  else if (n.attrs.indexed !== undefined) hex = INDEXED[Number(n.attrs.indexed)] ?? null;
  if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
  return `#${tint(hex.toUpperCase(), Number(n.attrs.tint) || 0).toLowerCase()}`;
}

function readTheme(xml: string | undefined): string[] {
  if (!xml) return OFFICE_THEME;
  const t = tree(xml);
  const scheme = find(t, 'clrScheme');
  if (!scheme) return OFFICE_THEME;
  const colorFor = (name: string, fallback: string) => {
    const n = kid(scheme, name);
    const c = n?.children[0];
    return (c?.attrs.lastClr ?? c?.attrs.val ?? fallback).toUpperCase();
  };
  return [
    colorFor('lt1', 'FFFFFF'),
    colorFor('dk1', '000000'),
    colorFor('lt2', 'E7E6E6'),
    colorFor('dk2', '44546A'),
    ...[1, 2, 3, 4, 5, 6].map((i) => colorFor(`accent${i}`, OFFICE_THEME[3 + i])),
  ];
}

// ---------- Export ----------

const BUILTIN_FORMATS: Record<string, number> = { '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, '@': 49 };

/** Styles du fichier : polices, remplissages, formats, et un « xf » par style du classeur. */
function stylesXml(styles: CellStyle[]): { xml: string; xf: (s: number) => number } {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const numFmts: string[] = [];
  const fontIds = new Map<string, number>();
  const fillIds = new Map<string, number>();
  const fmtIds = new Map<string, number>();
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfOf = new Map<number, number>([[0, 0]]);
  styles.forEach((st, i) => {
    if (i === 0 || !Object.keys(st).length) return;
    let fontId = 0;
    if (st.b || st.i || st.u || st.st || st.c) {
      const font = `<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}${st.st ? '<strike/>' : ''}${st.u ? '<u/>' : ''}<sz val="11"/>${
        st.c ? `<color rgb="FF${st.c.slice(1).toUpperCase()}"/>` : ''
      }<name val="Calibri"/><family val="2"/></font>`;
      fontId = fontIds.get(font) ?? fonts.length;
      if (!fontIds.has(font)) {
        fontIds.set(font, fontId);
        fonts.push(font);
      }
    }
    let fillId = 0;
    if (st.bg) {
      const fill = `<fill><patternFill patternType="solid"><fgColor rgb="FF${st.bg.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`;
      fillId = fillIds.get(fill) ?? fills.length;
      if (!fillIds.has(fill)) {
        fillIds.set(fill, fillId);
        fills.push(fill);
      }
    }
    let fmtId = 0;
    if (st.nf) {
      fmtId = BUILTIN_FORMATS[st.nf] ?? fmtIds.get(st.nf) ?? 164 + numFmts.length;
      if (fmtId >= 164 && !fmtIds.has(st.nf)) {
        fmtIds.set(st.nf, fmtId);
        numFmts.push(`<numFmt numFmtId="${fmtId}" formatCode="${esc(st.nf)}"/>`);
      }
    }
    const align = st.al || st.wr ? `<alignment${st.al ? ` horizontal="${st.al}"` : ''}${st.wr ? ' wrapText="1"' : ''}/>` : '';
    const attrs = `numFmtId="${fmtId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0"${fmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${
      fillId ? ' applyFill="1"' : ''
    }${align ? ' applyAlignment="1"' : ''}`;
    xfOf.set(i, xfs.length);
    xfs.push(align ? `<xf ${attrs}>${align}</xf>` : `<xf ${attrs}/>`);
  });
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts>` : '') +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="${fills.length}">${fills.join('')}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  return { xml, xf: (s) => xfOf.get(s) ?? 0 };
}

/** Formule telle qu'Excel l'écrit dans un fichier (sans « = », fonctions récentes préfixées par « _xlfn. »). */
function fileFormula(formula: string): string {
  return tokenize(formula.slice(1), 'en')
    .map((t) => (t.type === 'fn' && XLFN.has(t.name.toUpperCase()) ? `_xlfn.${t.name.toUpperCase()}` : t.text))
    .join('');
}

const pxToWidth = (px: number) => Math.max(0, Math.round(((px - 5) / 7) * 100) / 100);

function sheetXml(sheet: Sheet, si: number, engine: Engine, xf: (s: number) => number, active: boolean): string {
  const idx = indexSheet(sheet);
  const byRow = new Map<number, number[]>();
  for (const k of idx.cells.keys()) {
    const r = Math.floor(k / MAX_COLS);
    const list = byRow.get(r);
    if (list) list.push(k);
    else byRow.set(r, [k]);
  }
  const rows = [...new Set([...byRow.keys(), ...Object.keys(sheet.rh ?? {}).map(Number)])].sort((a, b) => a - b);
  const out: string[] = [];
  for (const r of rows) {
    const keys = (byRow.get(r) ?? []).sort((a, b) => a - b);
    const ht = sheet.rh?.[r];
    const cells = keys.map((k) => {
      const c = k % MAX_COLS;
      const cell = idx.cells.get(k)!;
      const ref = addr(r, c);
      const s = xf(cell.s);
      const sAttr = s ? ` s="${s}"` : '';
      const v = cell.v;
      if (v === null || v === '') return `<c r="${ref}"${sAttr}/>`;
      if (isFormula(v)) {
        if (!parseFormula(v)) return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        const res = engine.value(si, r, c);
        const f = `<f>${esc(fileFormula(v))}</f>`;
        if (typeof res === 'number') return `<c r="${ref}"${sAttr}>${f}<v>${res}</v></c>`;
        if (typeof res === 'boolean') return `<c r="${ref}"${sAttr} t="b">${f}<v>${res ? 1 : 0}</v></c>`;
        if (isError(res)) return `<c r="${ref}"${sAttr} t="e">${f}<v>${res.error === '#ERROR!' ? '#NAME?' : res.error}</v></c>`;
        return `<c r="${ref}"${sAttr} t="str">${f}<v>${esc(res === null ? '' : String(res))}</v></c>`;
      }
      if (typeof v === 'number') return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
      return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(textOf(v))}</t></is></c>`;
    });
    out.push(`<row r="${r + 1}"${ht ? ` ht="${Math.round(ht * 0.75 * 100) / 100}" customHeight="1"` : ''}>${cells.join('')}</row>`);
  }
  const widths = Object.entries(sheet.cw ?? {})
    .map(([c, w]) => [Number(c), w] as const)
    .filter(([c]) => c < MAX_COLS)
    .sort((a, b) => a[0] - b[0]);
  const cols = widths.length
    ? `<cols>${widths.map(([c, w]) => `<col min="${c + 1}" max="${c + 1}" width="${pxToWidth(w)}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const dim = idx.rows && idx.cols ? `<dimension ref="A1:${addr(idx.rows - 1, idx.cols - 1)}"/>` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    dim +
    `<sheetViews><sheetView workbookViewId="0"${active ? ' tabSelected="1"' : ''}/></sheetViews>` +
    `<sheetFormatPr defaultColWidth="${pxToWidth(DEFAULT_COL_WIDTH)}" defaultRowHeight="15"/>` +
    cols +
    `<sheetData>${out.join('')}</sheetData>` +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '</worksheet>'
  );
}

/** Classeur au format Excel (.xlsx). */
export function exportXlsx(wb: Workbook, lang: Lang, activeSheet = 0): Uint8Array {
  const engine = new Engine(wb, lang);
  const { xml: styles, xf } = stylesXml(wb.styles);
  const files: Record<string, Uint8Array> = {};
  const sheetNames = wb.sheets.map((s) => s.name);
  files['[Content_Types].xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheetNames
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
  );
  files['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  );
  files['xl/workbook.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<bookViews><workbookView activeTab="${Math.min(activeSheet, sheetNames.length - 1)}"/></bookViews>` +
      `<sheets>${sheetNames.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
      '</workbook>',
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheetNames
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  files['xl/styles.xml'] = strToU8(styles);
  wb.sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet, i, engine, xf, i === activeSheet));
  });
  return zipSync(files, { level: 6 });
}

// ---------- Import ----------

const BUILTIN_CODES: Record<number, string> = {
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  5: '#,##0 "€";-#,##0 "€"',
  6: '#,##0 "€";[Red]-#,##0 "€"',
  7: '#,##0.00 "€";-#,##0.00 "€"',
  8: '#,##0.00 "€";[Red]-#,##0.00 "€"',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'dd/mm/yyyy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'hh:mm',
  21: 'hh:mm:ss',
  22: 'dd/mm/yyyy hh:mm',
  37: '#,##0;-#,##0',
  38: '#,##0;[Red]-#,##0',
  39: '#,##0.00;-#,##0.00',
  40: '#,##0.00;[Red]-#,##0.00',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss',
  48: '##0.0E+0',
  49: '@',
};

const SUPPORTED = new Set(FUNCTION_NAMES);

/** Vrai si toutes les fonctions de la formule sont connues (sinon on garde la valeur calculée par Excel). */
function computable(ast: Node | null): boolean {
  if (!ast) return false;
  switch (ast.k) {
    case 'fn':
      return SUPPORTED.has(ast.name) && ast.args.every(computable);
    case 'bin':
      return computable(ast.a) && computable(ast.b);
    case 'neg':
    case 'pos':
    case 'pct':
      return computable(ast.a);
    case 'name':
      return false;
    default:
      return true;
  }
}

type XfInfo = { style: CellStyle; date: boolean };

function readStyles(xml: string | undefined, theme: string[]): XfInfo[] {
  if (!xml) return [];
  const t = tree(xml);
  const sheet = find(t, 'styleSheet') ?? t;
  const codes = new Map<number, string>();
  for (const f of kids(kid(sheet, 'numFmts'), 'numFmt')) codes.set(Number(f.attrs.numFmtId), f.attrs.formatCode ?? '');
  const fonts = kids(kid(sheet, 'fonts'), 'font');
  const fills = kids(kid(sheet, 'fills'), 'fill');
  return kids(kid(sheet, 'cellXfs'), 'xf').map((xf) => {
    const st: CellStyle = {};
    const fmtId = Number(xf.attrs.numFmtId ?? 0);
    const code = codes.get(fmtId) ?? BUILTIN_CODES[fmtId];
    if (code && !/^general$/i.test(code)) st.nf = code;
    const font = fonts[Number(xf.attrs.fontId ?? 0)];
    if (font) {
      const on = (name: string) => {
        const n = kid(font, name);
        return Boolean(n) && n!.attrs.val !== '0' && n!.attrs.val !== 'false' && n!.attrs.val !== 'none';
      };
      if (on('b')) st.b = 1;
      if (on('i')) st.i = 1;
      if (on('u')) st.u = 1;
      if (on('strike')) st.st = 1;
      const color = colorOf(kid(font, 'color'), theme);
      // Noir (couleur par défaut d'Excel) : couleur du thème de Melo, lisible en sombre comme en clair.
      if (color && color !== '#000000') st.c = color;
    }
    const pattern = kid(fills[Number(xf.attrs.fillId ?? 0)], 'patternFill');
    if (pattern && pattern.attrs.patternType && pattern.attrs.patternType !== 'none' && pattern.attrs.patternType !== 'gray125') {
      const bg = colorOf(kid(pattern, 'fgColor'), theme) ?? colorOf(kid(pattern, 'bgColor'), theme);
      if (bg && bg !== '#ffffff') st.bg = bg;
    }
    const align = kid(xf, 'alignment');
    if (align) {
      const h = align.attrs.horizontal;
      if (h === 'left' || h === 'center' || h === 'right') st.al = h;
      else if (h === 'centerContinuous') st.al = 'center';
      if (align.attrs.wrapText === '1' || align.attrs.wrapText === 'true') st.wr = 1;
    }
    return { style: st, date: isDateFormat(st.nf) };
  });
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  let cur: string | null = null;
  let inT = false;
  let skip = 0;
  sax(xml, {
    open: (name, _attrs, selfClosing) => {
      if (name === 'si') cur = '';
      else if (name === 'rPh' && !selfClosing) skip++;
      else if (name === 't' && !selfClosing) inT = true;
    },
    close: (name) => {
      if (name === 'si') {
        out.push(unescapeExcel(cur ?? ''));
        cur = null;
      } else if (name === 'rPh') skip = Math.max(0, skip - 1);
      else if (name === 't') inT = false;
    },
    text: (t) => {
      if (inT && !skip && cur !== null) cur += t;
    },
  });
  return out;
}

/** Fichier de l'archive désigné par une relation (chemins relatifs à xl/). */
function resolvePath(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `xl/${target}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

type ImportCtx = { wb: Workbook; count: number; styleMemo: Map<number, number>; xfs: XfInfo[]; date1904: boolean };

function readSheet(xml: string, strings: string[], ctx: ImportCtx, si: number): void {
  const cells: Record<string, StoredCell> = {};
  const rh: Record<string, number> = {};
  const cw: Record<string, number> = {};
  const shared = new Map<string, { formula: string; r: number; c: number }>();
  let row = -1;
  let col = -1;
  let cell: { r: number; c: number; t: string; s: number; v: string; f: string | null; fAttrs: Record<string, string>; inline: string } | null = null;
  let inV = false;
  let inF = false;
  // Texte en ligne (<is><t>…</t></is>), sans les indications phonétiques (<rPh>).
  let inIs = false;
  let inT = false;
  let inPhonetic = 0;
  sax(xml, {
    open: (name, a) => {
      switch (name) {
        case 'row': {
          row = a.r ? Number(a.r) - 1 : row + 1;
          col = -1;
          if (a.customHeight === '1' && a.ht && row < MAX_ROWS) rh[row] = Math.round(Number(a.ht) * (4 / 3));
          return;
        }
        case 'c': {
          const p = a.r ? parseAddr(a.r) : null;
          const r = p ? p.r : Math.max(row, 0);
          col = p ? p.c : col + 1;
          cell = { r, c: col, t: a.t ?? 'n', s: Number(a.s ?? 0), v: '', f: null, fAttrs: {}, inline: '' };
          return;
        }
        case 'v':
          inV = true;
          return;
        case 'f':
          if (cell) {
            cell.f = '';
            cell.fAttrs = a;
          }
          inF = true;
          return;
        case 'is':
          inIs = true;
          return;
        case 't':
          inT = true;
          return;
        case 'rPh':
          inPhonetic++;
          return;
        case 'col': {
          const min = Number(a.min) - 1;
          const max = Math.min(Number(a.max) - 1, min + 255, MAX_COLS - 1);
          if (a.width && Number.isFinite(min))
            for (let c = min; c <= max; c++) cw[c] = Math.max(8, Math.min(2000, Math.round(Number(a.width) * 7 + 5)));
          return;
        }
        default:
          return;
      }
    },
    close: (name) => {
      switch (name) {
        case 'v':
          inV = false;
          return;
        case 'f':
          inF = false;
          return;
        case 'is':
          inIs = false;
          return;
        case 't':
          inT = false;
          return;
        case 'rPh':
          inPhonetic = Math.max(0, inPhonetic - 1);
          return;
        case 'c': {
          if (!cell) return;
          const c = cell;
          cell = null;
          let value: CellValue = null;
          const info = ctx.xfs[c.s];
          if (c.t === 's') value = storeText(strings[Number(c.v)] ?? '');
          else if (c.t === 'inlineStr') value = storeText(unescapeExcel(c.inline));
          else if (c.t === 'str') value = storeText(unescapeExcel(c.v));
          else if (c.t === 'b') value = c.v === '1' || c.v.toLowerCase() === 'true';
          else if (c.t === 'e') value = storeText(c.v);
          else if (c.t === 'd') {
            const d = new Date(c.v);
            value = Number.isNaN(d.getTime())
              ? storeText(c.v)
              : toSerial(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
          } else if (c.v !== '') {
            const n = Number(c.v);
            value = Number.isFinite(n) ? (ctx.date1904 && info?.date ? n + 1462 : n) : storeText(c.v);
          }
          // Formule : partagée (écrite une fois pour une plage), ou propre à la cellule.
          let formula: string | null = null;
          if (c.f !== null) {
            const text = c.f.replace(/_xlfn\.|_xlws\./gi, '').trim();
            if (c.fAttrs.t === 'shared' && c.fAttrs.si !== undefined) {
              const master = shared.get(c.fAttrs.si);
              if (text) {
                formula = `=${text}`;
                shared.set(c.fAttrs.si, { formula, r: c.r, c: c.c });
              } else if (master) formula = shiftFormula(master.formula, c.r - master.r, c.c - master.c);
            } else if (text && c.fAttrs.t !== 'dataTable') formula = `=${text}`;
          }
          if (formula) {
            // Écriture normalisée (noms de fonctions en majuscules) ; « =TRUE() » de LibreOffice : simple booléen.
            const normal = delocalizeFormula(formula, 'en');
            if (/^=(TRUE|FALSE)\(\)$/.test(normal)) value = normal === '=TRUE()';
            else if (computable(parseFormula(normal))) value = normal;
          }
          let s = 0;
          if (info && Object.keys(info.style).length) {
            const memo = ctx.styleMemo.get(c.s);
            if (memo !== undefined) s = memo;
            else {
              [ctx.wb, s] = internStyle(ctx.wb, info.style);
              ctx.styleMemo.set(c.s, s);
            }
          }
          if ((value === null || value === '') && !s) return;
          if (c.r >= MAX_ROWS || c.c >= MAX_COLS) return;
          if (++ctx.count > MAX_CELLS) throw new SheetFileError('too-many-cells', ctx.count);
          cells[addr(c.r, c.c)] = s ? [value, s] : value;
          return;
        }
        default:
          return;
      }
    },
    text: (t) => {
      if (!cell) return;
      if (inV) cell.v += t;
      else if (inF) cell.f = (cell.f ?? '') + t;
      else if (inIs && inT && !inPhonetic) cell.inline += t;
    },
  });
  const sheet: Sheet = { ...ctx.wb.sheets[si], cells };
  if (Object.keys(cw).length) sheet.cw = cw;
  if (Object.keys(rh).length) sheet.rh = rh;
  ctx.wb = { ...ctx.wb, sheets: ctx.wb.sheets.map((x, i) => (i === si ? sheet : x)) };
}

/** Classeur lu dans un fichier .xlsx. */
export function importXlsx(bytes: Uint8Array): Workbook {
  let zip: Record<string, Uint8Array>;
  try {
    let total = 0;
    zip = unzipSync(bytes, {
      filter: (f) => {
        if (!/^(\[Content_Types\]\.xml|xl\/.*\.xml|xl\/.*\.rels)$/i.test(f.name)) return false;
        total += f.originalSize;
        if (f.originalSize > MAX_PART || total > MAX_PART * 2) throw new SheetFileError('too-big');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof SheetFileError) throw err;
    throw new SheetFileError('damaged');
  }
  const text = (path: string) => {
    const key = Object.keys(zip).find((k) => k.toLowerCase() === path.toLowerCase());
    return key ? strFromU8(zip[key]) : undefined;
  };
  const workbookXml = text('xl/workbook.xml');
  if (!workbookXml) throw new SheetFileError('damaged');
  const wbTree = tree(workbookXml);
  const rels = new Map<string, string>();
  const relsXml = text('xl/_rels/workbook.xml.rels');
  if (relsXml) for (const r of kids(find(tree(relsXml), 'Relationships'), 'Relationship')) rels.set(r.attrs.Id, r.attrs.Target);
  const date1904 = ['1', 'true'].includes(find(wbTree, 'workbookPr')?.attrs.date1904 ?? '');
  const sheetsNode = kids(find(wbTree, 'sheets'), 'sheet').filter((s) => s.attrs.state !== 'veryHidden');
  if (!sheetsNode.length) throw new SheetFileError('damaged');
  const theme = readTheme(text('xl/theme/theme1.xml'));
  const xfs = readStyles(text('xl/styles.xml'), theme);
  const strings = readSharedStrings(text('xl/sharedStrings.xml'));
  const used = new Set<string>();
  const sheets: Sheet[] = sheetsNode.map((s, i) => {
    let name = (s.attrs.name || `Sheet${i + 1}`).slice(0, 31);
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 27)} (${i + 1})`;
    used.add(name.toLowerCase());
    return { name, cells: {} };
  });
  const ctx: ImportCtx = { wb: { v: 1, sheets, styles: [{}] }, count: 0, styleMemo: new Map(), xfs, date1904 };
  sheetsNode.forEach((s, i) => {
    const target = rels.get(s.attrs.id ?? '');
    const xml = target ? text(resolvePath(target)) : undefined;
    if (xml) readSheet(xml, strings, ctx, i);
  });
  return ctx.wb;
}

// ---------- CSV ----------

/** Lignes d'un fichier CSV (séparateur deviné : virgule, point-virgule ou tabulation). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const sample = src.split(/\r?\n/).slice(0, 20);
  const count = (line: string, d: string) => {
    let n = 0;
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    return n;
  };
  const delim = [';', '\t', ','].map((d) => ({ d, n: sample.reduce((a, l) => a + count(l, d), 0) })).sort((a, b) => b.n - a.n)[0];
  const d = delim.n ? delim.d : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Texte d'un fichier CSV (UTF-8, ou Windows-1252 comme les CSV d'Excel en français). */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function importCsv(text: string, lang: Lang, sheetName: string): Workbook {
  const rows = parseCsv(text);
  let wb: Workbook = { v: 1, sheets: [{ name: sheetName, cells: {} }], styles: [{}] };
  const cells: Record<string, StoredCell> = {};
  const memo = new Map<string, number>();
  let count = 0;
  rows.forEach((fields, r) => {
    fields.forEach((field, c) => {
      if (field === '' || r >= MAX_ROWS || c >= MAX_COLS) return;
      if (++count > MAX_CELLS) throw new SheetFileError('too-many-cells', count);
      const { value, format } = parseInput(field, lang);
      let s = 0;
      if (format) {
        const m = memo.get(format);
        if (m !== undefined) s = m;
        else {
          [wb, s] = internStyle(wb, { nf: format });
          memo.set(format, s);
        }
      }
      cells[addr(r, c)] = s ? [value, s] : value;
    });
  });
  return { ...wb, sheets: [{ name: sheetName, cells }] };
}

/** Feuille au format CSV (valeurs affichées ; point-virgule en français, comme Excel). */
export function exportCsv(wb: Workbook, si: number, lang: Lang): string {
  const engine = new Engine(wb, lang);
  const idx = indexSheet(wb.sheets[si]);
  const d = lang === 'fr' ? ';' : ',';
  const lines: string[] = [];
  for (let r = 0; r < idx.rows; r++) {
    const fields: string[] = [];
    for (let c = 0; c < idx.cols; c++) {
      const text = engine.display(si, r, c).text;
      fields.push(text.includes(d) || /["\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    }
    lines.push(fields.join(d).replace(new RegExp(`${d === ';' ? ';' : ','}+$`), ''));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------- Fichier choisi ----------

/** Classeur lu dans un fichier choisi par l'utilisateur (.xlsx, .csv, .tsv, .txt). */
export async function importFile(file: File, lang: Lang, sheetName: string): Promise<Workbook> {
  if (file.size > MAX_FILE) throw new SheetFileError('too-big');
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.(csv|tsv|txt)$/.test(name) || file.type === 'text/csv') return importCsv(decodeCsv(bytes), lang, sheetName.replace(/\d+$/, '') + '1');
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new SheetFileError('xls');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new SheetFileError('format');
  return importXlsx(bytes);
}

/** Nom de fichier propre (sans caractères interdits), avec son extension. */
export function sheetFileName(base: string, ext: 'xlsx' | 'csv'): string {
  const clean = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'Melo';
  return `${clean.slice(0, 120)}.${ext}`;
}
