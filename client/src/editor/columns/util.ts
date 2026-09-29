// Réglages communs aux colonnes.

/** Nombre maximal de colonnes dans une rangée. */
export const MAX_COLUMNS = 4;

/** Largeur relative d'une colonne (1 = part égale). */
export function columnWidth(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(20, Math.max(0.05, Math.round(n * 1000) / 1000)) : 1;
}
