// Cadre redimensionnable pour les blocs personnalisés (PDF, vidéo intégrée, agenda, homelab) :
// poignée droite pour la largeur (en %), poignée basse optionnelle pour la hauteur (en px).
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

type Props = {
  editable: boolean;
  /** Largeur en pourcentage de la page (20 à 100). */
  width: number;
  onWidthCommit: (pct: number) => void;
  height?: number;
  minHeight?: number;
  maxHeight?: number;
  onHeightCommit?: (px: number) => void;
  className?: string;
  children: (liveHeight: number | undefined, resizing: boolean) => ReactNode;
};

type Drag = { axis: 'x' | 'y'; startX: number; startY: number; startW: number; startH: number; parentW: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const WIDTH_PRESETS = [25, 50, 75, 100];

export function normalizeWidth(width: unknown): number {
  const n = Number(width);
  return Number.isFinite(n) && n > 0 ? clamp(Math.round(n), 20, 100) : 100;
}

export function ResizableFrame({ editable, width, onWidthCommit, height, minHeight = 160, maxHeight = 2000, onHeightCommit, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const live = useRef<{ w: number | null; h: number | null }>({ w: null, h: null });
  const [liveW, setLiveW] = useState<number | null>(null);
  const [liveH, setLiveH] = useState<number | null>(null);

  const start = (axis: 'x' | 'y') => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || !ref.current) return;
    e.preventDefault();
    e.stopPropagation();
    const parentW = ref.current.parentElement?.clientWidth || ref.current.offsetWidth;
    drag.current = { axis, startX: e.clientX, startY: e.clientY, startW: ref.current.offsetWidth, startH: height ?? ref.current.offsetHeight, parentW };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.axis === 'x') {
      const pct = clamp(Math.round(((d.startW + e.clientX - d.startX) / d.parentW) * 20) * 5, 20, 100);
      live.current.w = pct;
      setLiveW(pct);
    } else {
      const px = clamp(Math.round(d.startH + e.clientY - d.startY), minHeight, maxHeight);
      live.current.h = px;
      setLiveH(px);
    }
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.axis === 'x' && live.current.w != null && live.current.w !== width) onWidthCommit(live.current.w);
    if (d.axis === 'y' && live.current.h != null && live.current.h !== height) onHeightCommit?.(live.current.h);
    live.current = { w: null, h: null };
    setLiveW(null);
    setLiveH(null);
  };

  const w = liveW ?? normalizeWidth(width);
  const resizing = liveW != null || liveH != null;
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  return (
    <div ref={ref} className={`nb-resizable${resizing ? ' nb-resizable--active' : ''}${className ? ` ${className}` : ''}`} style={{ width: `${w}%` }}>
      {children(liveH ?? height, resizing)}
      {editable ? (
        <div className="nb-resize-x" title="Glisser pour changer la largeur" onPointerDown={start('x')} {...handlers} />
      ) : null}
      {editable && onHeightCommit ? (
        <div className="nb-resize-y" title="Glisser pour changer la hauteur" onPointerDown={start('y')} {...handlers} />
      ) : null}
      {liveW != null ? <div className="nb-resize-badge">{liveW} %</div> : null}
      {liveH != null ? <div className="nb-resize-badge">{liveH} px</div> : null}
    </div>
  );
}
