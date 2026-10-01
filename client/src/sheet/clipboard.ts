// Tableur : copier-coller compatible avec Excel, LibreOffice et Google Sheets (texte séparé par des tabulations et
// tableau HTML), et entre les tableurs de Melo (formules et mises en forme conservées).
import type { Lang } from '../lib/i18n';
import { parseInput } from './format';
import type { CellStyle } from './model';
import { cleanStyle } from './model';
import { isFormula, storeText, type CellValue } from './values';

/** Type du presse-papiers réservé aux tableurs de Melo. */
export const SHEET_MIME = 'application/x-melo-sheet';

export type ClipCell = { v: CellValue; st?: CellStyle };
/**
 * Cellules copiées ; `from` : position d'origine (pour décaler les formules), `cut` : cellules coupées, `plain` : texte
 * sans mise en forme (les cellules gardent la leur en le collant).
 */
export type ClipData = { rows: number; cols: number; cells: ClipCell[][]; from?: { r: number; c: number }; cut?: boolean; plain?: boolean };

/** Cellule à copier : valeur enregistrée, mise en forme et texte affiché. */
export type CopyCell = { v: CellValue; st: CellStyle; text: string };

/** Dernière copie faite dans Melo : sert quand le presse-papiers du système ne garde que le texte (téléphone). */
let last: { text: string; data: ClipData } | null = null;

const sameText = (a: string, b: string) => a.replace(/\r\n?/g, '\n').replace(/\n$/, '') === b.replace(/\r\n?/g, '\n').replace(/\n$/, '');

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Texte d'une cellule dans un texte séparé par des tabulations (entre guillemets si besoin, comme Excel). */
const tsvField = (s: string) => (/[\t\n\r]/.test(s) || s.startsWith('"') ? `"${s.replace(/"/g, '""')}"` : s);

function cssOf(st: CellStyle): string {
  const css: string[] = [];
  if (st.b) css.push('font-weight:bold');
  if (st.i) css.push('font-style:italic');
  const deco = [st.u ? 'underline' : '', st.st ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) css.push(`text-decoration:${deco}`);
  if (st.c) css.push(`color:${st.c}`);
  if (st.bg) css.push(`background-color:${st.bg}`);
  if (st.al) css.push(`text-align:${st.al}`);
  if (st.wr) css.push('white-space:normal');
  return css.join(';');
}

/** Contenu du presse-papiers pour une plage : texte (tabulations), HTML et données internes. */
export function buildCopy(
  grid: CopyCell[][],
  from: { r: number; c: number },
  cut: boolean,
  lang: Lang,
): { text: string; html: string; json: string } {
  const text = grid.map((row) => row.map((cell) => tsvField(cell.text)).join('\t')).join('\r\n');
  const rows = grid
    .map(
      (row) =>
        '<tr>' +
        row
          .map((cell) => {
            let css = cssOf(cell.st);
            let attrs = '';
            if (typeof cell.v === 'number') attrs = ` x:num="${cell.v}"`;
            // Texte qu'Excel prendrait pour un nombre ou une date (« 0612 ») : format Texte.
            else if (cell.text && typeof parseInput(cell.text, lang).value !== 'string') css = `${css ? `${css};` : ''}mso-number-format:"\\@"`;
            return `<td${css ? ` style="${escapeHtml(css)}"` : ''}${attrs}>${escapeHtml(cell.text).replace(/\r?\n/g, '<br>')}</td>`;
          })
          .join('') +
        '</tr>',
    )
    .join('');
  const html = `<table xmlns:x="urn:schemas-microsoft-com:office:excel" style="border-collapse:collapse">${rows}</table>`;
  const data: ClipData = {
    rows: grid.length,
    cols: grid[0]?.length ?? 0,
    cells: grid.map((row) => row.map((cell) => (Object.keys(cell.st).length ? { v: cell.v, st: cell.st } : { v: cell.v }))),
    from,
    ...(cut ? { cut: true } : {}),
  };
  last = { text, data };
  return { text, html, json: JSON.stringify(data) };
}

/** Oublie la dernière copie (après avoir collé des cellules coupées : on ne les colle qu'une fois). */
export function forgetCut() {
  if (last?.data.cut) last = null;
}

/** Données internes relues (null si illisibles). */
function readJson(json: string): ClipData | null {
  try {
    const d = JSON.parse(json) as ClipData;
    if (!Array.isArray(d.cells) || !d.cells.length) return null;
    const cells = d.cells.map((row) =>
      (Array.isArray(row) ? row : []).map((cell) => {
        const v = cell && typeof cell === 'object' ? cell.v : null;
        const value: CellValue = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;
        const st = cell?.st ? cleanStyle(cell.st) : undefined;
        return st && Object.keys(st).length ? { v: value, st } : { v: value };
      }),
    );
    const cols = Math.max(...cells.map((r) => r.length));
    const from = d.from && Number.isInteger(d.from.r) && Number.isInteger(d.from.c) ? { r: d.from.r, c: d.from.c } : undefined;
    return { rows: cells.length, cols, cells, from, cut: !!d.cut };
  } catch {
    return null;
  }
}

/** Texte séparé par des tabulations (Excel : cellules entre guillemets si elles contiennent un retour à la ligne). */
export function parseTsv(text: string): string[][] {
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  for (;;) {
    let field: string | null = null;
    let j = i;
    if (s[i] === '"') {
      // Entre guillemets, si le champ se termine bien par un guillemet suivi d'une tabulation ou d'une fin de ligne.
      let k = i + 1;
      let value = '';
      while (k < s.length) {
        if (s[k] === '"') {
          if (s[k + 1] === '"') {
            value += '"';
            k += 2;
            continue;
          }
          break;
        }
        value += s[k++];
      }
      if (k < s.length && (k + 1 === s.length || s[k + 1] === '\t' || s[k + 1] === '\n')) {
        field = value;
        j = k + 1;
      }
    }
    if (field === null) {
      while (j < s.length && s[j] !== '\t' && s[j] !== '\n') j++;
      field = s.slice(i, j);
    }
    row.push(field);
    if (j >= s.length) {
      rows.push(row);
      break;
    }
    if (s[j] === '\n') {
      rows.push(row);
      row = [];
    }
    i = j + 1;
  }
  return rows;
}

// ---------- Tableau HTML (Excel, LibreOffice, Google Sheets, pages web) ----------

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  gray: '#808080',
  grey: '#808080',
  purple: '#800080',
  windowtext: '#000000',
  window: '#ffffff',
};

function cssColor(raw: string): string | undefined {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s*!important$/, '');
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${[...m[1]].map((x) => x + x).join('')}`;
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return s;
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return undefined;
    return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}`;
  }
  return NAMED[s];
}

function styleFromCss(decls: string): CellStyle {
  const st: CellStyle = {};
  for (const decl of decls.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl
      .slice(i + 1)
      .trim()
      .toLowerCase();
    if (prop === 'font-weight') {
      if (value === 'bold' || value === 'bolder' || Number(value) >= 600) st.b = 1;
      else delete st.b;
    } else if (prop === 'font-style') {
      if (value.includes('italic') || value.includes('oblique')) st.i = 1;
      else delete st.i;
    } else if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      if (value.includes('underline')) st.u = 1;
      if (value.includes('line-through')) st.st = 1;
      if (value === 'none') {
        delete st.u;
        delete st.st;
      }
    } else if (prop === 'color') {
      const c = cssColor(value);
      // Texte noir (habituel dans Excel) : couleur du thème, lisible aussi sur fond sombre.
      if (c && c !== '#000000') st.c = c;
      else delete st.c;
    } else if (prop === 'background' || prop === 'background-color') {
      const c = cssColor(value.split(/\s+(?![^(]*\))/)[0]);
      if (c && c !== '#ffffff') st.bg = c;
      else delete st.bg;
    } else if (prop === 'text-align') {
      if (value === 'left' || value === 'center' || value === 'right') st.al = value;
      else if (value === 'start' || value === 'end') st.al = value === 'start' ? 'left' : 'right';
    } else if (prop === 'mso-number-format') {
      if (/^["']?\\?@["']?$/.test(value)) st.nf = '@';
    }
  }
  return st;
}

/** Texte d'une cellule HTML, comme à l'écran (espaces regroupés, retours à la ligne des <br> et paragraphes). */
function cellText(el: Element): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === 3) out += (node.nodeValue ?? '').replace(/[ \t\r\n]+/g, ' ');
    else if (node.nodeType === 1) {
      const tag = (node as Element).tagName.toLowerCase();
      if (tag === 'br') out += '\n';
      else if (tag === 'style' || tag === 'script') return;
      else {
        const block = /^(p|div|li|h[1-6])$/.test(tag);
        if (block && out && !out.endsWith('\n')) out += '\n';
        node.childNodes.forEach(walk);
        if (block && !out.endsWith('\n')) out += '\n';
      }
    }
  };
  el.childNodes.forEach(walk);
  return out
    .split('\n')
    .map((line) => line.replace(/ /g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Cellules d'un tableau HTML (null s'il n'y en a pas). */
export function parseHtmlTable(html: string, lang: Lang): ClipCell[][] | null {
  if (!/<table[\s>]/i.test(html) || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  // Styles par classe (Excel : .xl65 { font-weight: 700 }).
  const classes = new Map<string, string>();
  doc.querySelectorAll('style').forEach((el) => {
    const css = (el.textContent ?? '').replace(/<!--|-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      for (const sel of m[1].split(',')) {
        const cls = /^\s*(?:td|th)?\.([\w-]+)\s*$/.exec(sel);
        if (cls) classes.set(cls[1], `${classes.get(cls[1]) ?? ''};${m[2]}`);
      }
    }
  });
  const grid: ClipCell[][] = [];
  const rows = Array.from((table as HTMLTableElement).rows ?? []);
  rows.forEach((tr, ri) => {
    grid[ri] ??= [];
    let ci = 0;
    const rowCss = [...tr.classList].map((c) => classes.get(c) ?? '').join(';') + ';' + (tr.getAttribute('style') ?? '');
    for (const td of Array.from(tr.cells)) {
      while (grid[ri][ci]) ci++;
      const css =
        rowCss +
        ';' +
        (td.tagName === 'TH' ? 'font-weight:bold;' : '') +
        [...td.classList].map((c) => classes.get(c) ?? '').join(';') +
        ';' +
        (td.getAttribute('style') ?? '');
      const st = styleFromCss(css);
      const text = cellText(td);
      const parsed = st.nf === '@' ? { value: storeText(text) } : parseInput(text, lang);
      let v: CellValue = text === '' ? null : parsed.value;
      // Valeur exacte d'Excel (x:num) ou de Google Sheets (data-sheets-value), quand elle est donnée.
      const xnum = td.getAttribute('x:num');
      let exact: number | null = xnum !== null && xnum !== '' && Number.isFinite(Number(xnum)) ? Number(xnum) : null;
      const gs = td.getAttribute('data-sheets-value');
      if (exact === null && gs) {
        try {
          const d = JSON.parse(gs) as Record<string, unknown>;
          if (typeof d['3'] === 'number') exact = d['3'];
        } catch {
          /* valeur illisible : texte affiché */
        }
      }
      if (exact !== null) v = exact;
      // Formule affichée sur une page web : gardée comme texte.
      if (isFormula(v)) v = `'${v}`;
      if (parsed.format && typeof v === 'number' && !st.nf) st.nf = parsed.format;
      const span = Math.max(1, Math.min(100, Number(td.getAttribute('colspan')) || 1));
      const rspan = Math.max(1, Math.min(1000, Number(td.getAttribute('rowspan')) || 1));
      for (let dr = 0; dr < rspan; dr++) {
        grid[ri + dr] ??= [];
        for (let dc = 0; dc < span; dc++) {
          const first = dr === 0 && dc === 0;
          const keep = Object.keys(st).length ? { st } : {};
          grid[ri + dr][ci + dc] = first ? { v, ...keep } : { v: null, ...keep };
        }
      }
      ci += span;
    }
  });
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (!grid.length || !cols) return null;
  return grid.map((row) => Array.from({ length: cols }, (_, c) => row[c] ?? { v: null }));
}

/** Cellules d'un texte collé (tabulations, une ligne par rangée). */
export function cellsFromText(text: string, lang: Lang): ClipCell[][] {
  const rows = parseTsv(text);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((row) =>
    Array.from({ length: cols }, (_, c) => {
      const s = row[c] ?? '';
      const parsed = parseInput(s, lang);
      return parsed.format && typeof parsed.value === 'number' ? { v: parsed.value, st: { nf: parsed.format } } : { v: parsed.value };
    }),
  );
}

const fromCells = (cells: ClipCell[][], plain = false): ClipData => ({
  rows: cells.length,
  cols: Math.max(0, ...cells.map((r) => r.length)),
  cells,
  ...(plain ? { plain: true } : {}),
});

/** Ce qu'il y a à coller : cellules de Melo, tableau HTML, ou texte. */
export function readPaste(get: (type: string) => string, lang: Lang): ClipData | null {
  const json = get(SHEET_MIME);
  if (json) {
    const d = readJson(json);
    if (d) return d;
  }
  const text = get('text/plain');
  if (last && text && sameText(text, last.text)) return last.data;
  const html = get('text/html');
  if (html) {
    const cells = parseHtmlTable(html, lang);
    if (cells) return fromCells(cells);
  }
  if (!text) return null;
  return fromCells(cellsFromText(text, lang), true);
}

/** Dernière copie de Melo (bouton « Coller » quand le presse-papiers du système est illisible). */
export const lastCopy = (): ClipData | null => last?.data ?? null;
