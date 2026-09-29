// Affichage des annotations au-dessus des pages (SVG en points : même dessin qu'à l'export) et géométrie
// (cadres, zones de clic, gomme).
import type { PDFFont } from '@cantoo/pdf-lib';
import { fileUrl, type Annot } from './model';
import { BASELINE, LINE_HEIGHT, TEXT_FONT, layoutText, toPdfText, wrapLines } from './text';
import { MARK_STROKE, markPath, strokePath, strokesBounds } from './ink';

/** Lignes d'un texte ; mesure approchée tant que la police n'est pas chargée. */
export function textLayout(font: PDFFont | null, a: { text: string; w: number; size: number }) {
  if (font) return layoutText(font, a.text, a.w, a.size);
  const widthOf = (s: string) => s.length * a.size * 0.52;
  const lines = wrapLines(toPdfText(a.text), Math.max(a.size, a.w), widthOf);
  return { lines, width: lines.reduce((m, l) => Math.max(m, widthOf(l)), 0), height: Math.max(1, lines.length) * a.size * LINE_HEIGHT };
}

/** Cadre d'une annotation [x, y, largeur, hauteur], en points. */
export function annotBounds(a: Annot, font: PDFFont | null): [number, number, number, number] {
  switch (a.type) {
    case 'text': {
      const l = textLayout(font, a);
      return [a.x, a.y, Math.max(l.width, a.size * 0.6), l.height];
    }
    case 'ink': {
      const [x, y, w, h] = strokesBounds(a.strokes);
      const pad = a.width / 2;
      return [x - pad, y - pad, w + 2 * pad, h + 2 * pad];
    }
    case 'mark':
      return [a.x, a.y, a.size, a.size];
    default:
      return [a.x, a.y, a.w, a.h];
  }
}

/** Vrai si le point (en points) touche l'annotation, avec une marge `tol`. */
export function hitAnnot(a: Annot, font: PDFFont | null, x: number, y: number, tol: number): boolean {
  if (a.type === 'ink') {
    const reach = a.width / 2 + tol;
    for (const s of a.strokes) {
      for (let i = 0; i + 1 < s.length; i += 2) {
        const x1 = s[i];
        const y1 = s[i + 1];
        const x2 = i + 3 < s.length ? s[i + 2] : x1;
        const y2 = i + 3 < s.length ? s[i + 3] : y1;
        if (distToSegment(x, y, x1, y1, x2, y2) <= reach) return true;
      }
    }
    return false;
  }
  const [bx, by, bw, bh] = annotBounds(a, font);
  return x >= bx - tol && x <= bx + bw + tol && y >= by - tol && y <= by + bh + tol;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Annotation déplacée de (dx, dy) points. */
export function moveAnnot(a: Annot, dx: number, dy: number): Annot {
  if (a.type === 'ink') return { ...a, strokes: a.strokes.map((s) => s.map((v, i) => (i % 2 ? v + dy : v + dx))) };
  return { ...a, x: a.x + dx, y: a.y + dy };
}

function Shape({ a, font }: { a: Annot; font: PDFFont | null }) {
  switch (a.type) {
    case 'rect':
      return <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color} />;
    case 'highlight':
      return <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color} fillOpacity={0.4} />;
    case 'text': {
      const { lines } = textLayout(font, a);
      return (
        <text fontFamily={TEXT_FONT} fontSize={a.size} fill={a.color} style={{ whiteSpace: 'pre' }}>
          {lines.map((line, i) => (
            <tspan key={i} x={a.x} y={a.y + (i * LINE_HEIGHT + BASELINE) * a.size}>
              {line}
            </tspan>
          ))}
        </text>
      );
    }
    case 'ink':
      return (
        <g fill="none" stroke={a.color} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round">
          {a.strokes.map((s, i) => (
            <path key={i} d={strokePath(s)} />
          ))}
        </g>
      );
    case 'signature':
      return (
        <g fill="none" stroke={a.color} strokeWidth={Math.max(0.3, a.width * a.h)} strokeLinecap="round" strokeLinejoin="round">
          {a.strokes.map((s, i) => (
            <path key={i} d={strokePath(s, (x, y) => [a.x + x * a.w, a.y + y * a.h])} />
          ))}
        </g>
      );
    case 'image':
      return <image href={fileUrl(a.path)} x={a.x} y={a.y} width={a.w} height={a.h} preserveAspectRatio="none" />;
    case 'mark':
      if (a.mark === 'dot') return <circle cx={a.x + a.size / 2} cy={a.y + a.size / 2} r={a.size * 0.3} fill={a.color} />;
      return (
        <path
          d={markPath(a.mark, a.x, a.y, a.size)}
          fill="none"
          stroke={a.color}
          strokeWidth={a.size * MARK_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
  }
}

type SvgProps = {
  /** Taille de la page affichée, en points. */
  w: number;
  h: number;
  annots: Annot[];
  font: PDFFont | null;
  /** Zones de clic (outil Sélection). */
  interactive?: boolean;
  /** Annotation masquée (affichée ailleurs pendant un déplacement, ou en cours de saisie). */
  hiddenId?: string | null;
  className?: string;
};

/**
 * Annotations d'une page. Les surlignages sont dans un calque à part, fusionné avec la page (effet surligneur :
 * le texte reste lisible), comme dans le PDF exporté.
 */
export function AnnotSvg({ w, h, annots, font, interactive, hiddenId, className }: SvgProps) {
  const visible = hiddenId ? annots.filter((a) => a.id !== hiddenId) : annots;
  const highlights = visible.filter((a) => a.type === 'highlight');
  const others = visible.filter((a) => a.type !== 'highlight');
  const hit = (a: Annot) => {
    if (!interactive) return null;
    if (a.type === 'ink')
      return (
        <g fill="none" stroke="transparent" strokeWidth={a.width + 10} strokeLinecap="round" pointerEvents="stroke">
          {a.strokes.map((s, i) => (
            <path key={i} d={strokePath(s)} />
          ))}
        </g>
      );
    const [x, y, bw, bh] = annotBounds(a, font);
    return <rect x={x} y={y} width={bw} height={bh} fill="transparent" pointerEvents="all" />;
  };
  return (
    <>
      {highlights.length ? (
        <svg
          className={`pdf-annots pdf-annots--highlights${className ? ` ${className}` : ''}`}
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {highlights.map((a) => (
            <g key={a.id} data-annot={a.id}>
              <Shape a={a} font={font} />
              {hit(a)}
            </g>
          ))}
        </svg>
      ) : null}
      <svg className={`pdf-annots${className ? ` ${className}` : ''}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {others.map((a) => (
          <g key={a.id} data-annot={a.id}>
            <Shape a={a} font={font} />
            {hit(a)}
          </g>
        ))}
      </svg>
    </>
  );
}

/** Une seule annotation (aperçu pendant un déplacement ou un dessin). */
export function AnnotPreview({ w, h, annot, font }: { w: number; h: number; annot: Annot; font: PDFFont | null }) {
  return (
    <svg
      className={`pdf-annots pdf-annots--draft${annot.type === 'highlight' ? ' pdf-annots--highlights' : ''}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <Shape a={annot} font={font} />
    </svg>
  );
}
