// Traits dessinés (stylo, signature) : même chemin lissé à l'écran (SVG) et dans le PDF exporté.

const n = (v: number) => (Math.round(v * 100) / 100).toString();

/**
 * Chemin SVG lissé passant par les points [x0, y0, x1, y1, …] (courbes entre les milieux des segments).
 * `map` convertit chaque point (fractions d'un cadre de signature, par exemple).
 */
export function strokePath(points: number[], map: (x: number, y: number) => [number, number] = (x, y) => [x, y]): string {
  const count = Math.floor(points.length / 2);
  if (count === 0) return '';
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) pts.push(map(points[2 * i], points[2 * i + 1]));
  const [x0, y0] = pts[0];
  if (count === 1) return `M${n(x0)} ${n(y0)}L${n(x0)} ${n(y0)}`;
  if (count === 2) return `M${n(x0)} ${n(y0)}L${n(pts[1][0])} ${n(pts[1][1])}`;
  let d = `M${n(x0)} ${n(y0)}`;
  for (let i = 1; i < count - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += `Q${n(x)} ${n(y)} ${n((x + nx) / 2)} ${n((y + ny) / 2)}`;
  }
  const [lx, ly] = pts[count - 1];
  return `${d}L${n(lx)} ${n(ly)}`;
}

/** Retire les points trop rapprochés (moins de `minDist`) : traits plus légers, tracé identique. */
export function simplifyStroke(points: number[], minDist: number): number[] {
  if (points.length <= 4) return points.slice();
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i += 2) {
    const dx = points[i] - out[out.length - 2];
    const dy = points[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= minDist * minDist) out.push(points[i], points[i + 1]);
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}

/** Cadre englobant de traits : [x, y, largeur, hauteur]. */
export function strokesBounds(strokes: number[][]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i + 1 < s.length; i += 2) {
      minX = Math.min(minX, s[i]);
      maxX = Math.max(maxX, s[i]);
      minY = Math.min(minY, s[i + 1]);
      maxY = Math.max(maxY, s[i + 1]);
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX - minX, maxY - minY];
}

/** Coche, croix ou point dans un carré de côté 1 (même dessin à l'écran et dans le PDF). */
export const MARK_PATHS = {
  check: 'M0.14 0.55L0.4 0.8L0.87 0.2',
  cross: 'M0.2 0.2L0.8 0.8M0.8 0.2L0.2 0.8',
} as const;
export const MARK_STROKE = 0.14;

/** Chemin d'une marque (coche, croix) mis à l'échelle et placé en (x, y). */
export function markPath(mark: 'check' | 'cross', x: number, y: number, size: number): string {
  return MARK_PATHS[mark].replace(/(\d*\.?\d+) (\d*\.?\d+)/g, (_m, a: string, b: string) => `${n(x + Number(a) * size)} ${n(y + Number(b) * size)}`);
}
