// Géométrie des pages : rotation ajoutée par l'utilisateur (affichage et saisie au doigt ou à la souris)
// et passage du repère « page affichée » à celui du fichier PDF (export).
import type { Rotation } from './model';

/** Format A4 en points (1/72 de pouce). */
export const A4 = { w: 595.28, h: 841.89 } as const;

/** Taille après la rotation ajoutée par l'utilisateur. */
export function rotatedSize(w: number, h: number, rot: Rotation): { w: number; h: number } {
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}

/**
 * Transformation CSS (origine en haut à gauche) qui place un calque w × h, non tourné, dans sa boîte tournée
 * de `rot` degrés dans le sens des aiguilles d'une montre.
 */
export function rotationTransform(w: number, h: number, rot: Rotation): string {
  switch (rot) {
    case 90:
      return `translate(${h}px, 0) rotate(90deg)`;
    case 180:
      return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270:
      return `translate(0, ${w}px) rotate(270deg)`;
    default:
      return 'none';
  }
}

/** Point (bx, by) de la boîte tournée → point du calque non tourné (w × h). */
export function unrotatePoint(bx: number, by: number, w: number, h: number, rot: Rotation): { x: number; y: number } {
  switch (rot) {
    case 90:
      return { x: by, y: h - bx };
    case 180:
      return { x: w - bx, y: h - by };
    case 270:
      return { x: w - by, y: bx };
    default:
      return { x: bx, y: by };
  }
}

/** Déplacement (dx, dy) à l'écran → déplacement dans le calque non tourné. */
export function unrotateDelta(dx: number, dy: number, rot: Rotation): { x: number; y: number } {
  switch (rot) {
    case 90:
      return { x: dy, y: -dx };
    case 180:
      return { x: -dx, y: -dy };
    case 270:
      return { x: -dy, y: dx };
    default:
      return { x: dx, y: dy };
  }
}

export type Matrix = [number, number, number, number, number, number];

/**
 * Matrice PDF (a b c d e f) du repère de la page affichée « y vers le haut » (origine en bas à gauche de la page
 * telle qu'on la voit avec sa rotation d'origine, unités en points) vers l'espace du fichier.
 * `box` : zone visible de la page [x0, y0, x1, y1] ; `rotate` : rotation enregistrée dans le fichier.
 */
export function displayUpMatrix(box: [number, number, number, number], rotate: Rotation): Matrix {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  switch (rotate) {
    case 90:
      return [0, 1, -1, 0, x0 + w, y0];
    case 180:
      return [-1, 0, 0, -1, x0 + w, y0 + h];
    case 270:
      return [0, -1, 1, 0, x0, y0 + h];
    default:
      return [1, 0, 0, 1, x0, y0];
  }
}

/** Page d'une photo : même proportions que la partie gardée, grand côté d'un A4. */
export function imagePageSize(width: number, height: number, crop?: { w: number; h: number }): { w: number; h: number } {
  const iw = Math.max(1, width * (crop?.w ?? 1));
  const ih = Math.max(1, height * (crop?.h ?? 1));
  const scale = A4.h / Math.max(iw, ih);
  return { w: Math.round(iw * scale * 100) / 100, h: Math.round(ih * scale * 100) / 100 };
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
