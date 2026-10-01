// Tableur : adresses des cellules (A1, colonnes A…XFD, lignes 1…1 048 576, comme Excel). Numéros internes à partir
// de 0 (colonne A = 0, ligne 1 = 0).

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

/** Lettres d'une colonne (0 → A, 26 → AA). */
export function colName(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Numéro d'une colonne d'après ses lettres (A → 0) ; -1 si invalide. */
export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) {
    const code = ch.charCodeAt(0) - 64;
    if (code < 1 || code > 26) return -1;
    n = n * 26 + code;
  }
  return n - 1;
}

export const addr = (r: number, c: number): string => `${colName(c)}${r + 1}`;

/** Adresse « B12 » → { r: 11, c: 1 } ; null si invalide. */
export function parseAddr(a: string): { r: number; c: number } | null {
  const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(a);
  if (!m) return null;
  const c = colIndex(m[1]);
  const r = Number(m[2]) - 1;
  return c >= 0 && c < MAX_COLS && r >= 0 && r < MAX_ROWS ? { r, c } : null;
}

/** Clé numérique d'une cellule (index des cellules d'une feuille). */
export const keyOf = (r: number, c: number): number => r * MAX_COLS + c;
export const rowOfKey = (k: number): number => Math.floor(k / MAX_COLS);
export const colOfKey = (k: number): number => k % MAX_COLS;

/** Plage rectangulaire (bornes incluses). */
export type Rect = { r1: number; c1: number; r2: number; c2: number };

export const normRect = (r1: number, c1: number, r2: number, c2: number): Rect => ({
  r1: Math.min(r1, r2),
  c1: Math.min(c1, c2),
  r2: Math.max(r1, r2),
  c2: Math.max(c1, c2),
});

/** « A1 » ou « A1:C4 ». */
export function rectName(rect: Rect): string {
  const a = addr(rect.r1, rect.c1);
  return rect.r1 === rect.r2 && rect.c1 === rect.c2 ? a : `${a}:${addr(rect.r2, rect.c2)}`;
}
