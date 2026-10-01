// Tableur : valeurs des cellules.
// - Valeur enregistrée : nombre, booléen, texte, ou formule (texte commençant par « = »). Un texte qui commence lui-même
//   par « = » ou « ' » est enregistré précédé d'une apostrophe (« '=abc »), comme l'apostrophe d'Excel.
// - Valeur calculée : nombre, texte, booléen, erreur (#DIV/0!…) ou vide.

export type CellValue = string | number | boolean | null;

/** Erreur de calcul : code Excel (anglais) et explication facultative. */
export type ErrorValue = { error: string; message?: string };

export type Scalar = number | string | boolean | ErrorValue | null;

export const isError = (v: unknown): v is ErrorValue => typeof v === 'object' && v !== null && 'error' in v;

export const errorValue = (error: string, message?: string): ErrorValue => (message ? { error, message } : { error });

export const isFormula = (v: unknown): v is string => typeof v === 'string' && v.length > 1 && v.startsWith('=');

/** Texte affiché d'une valeur texte enregistrée. */
export const textOf = (v: string): string => (v.startsWith("'") ? v.slice(1) : v);

/** Valeur à enregistrer pour un texte (apostrophe s'il commence par « = » ou « ' »). */
export const storeText = (s: string): string => (s.startsWith('=') || s.startsWith("'") ? `'${s}` : s);
