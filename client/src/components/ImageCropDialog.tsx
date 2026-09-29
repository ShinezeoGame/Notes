import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

/**
 * Recadrage d'une image carrée (icône de page) : `cx`/`cy` = point de l'image (0 à 1) au centre du cadre,
 * `zoom` = 1 quand l'image remplit juste le cadre (plus petit : image entière avec des marges transparentes).
 */
export type CropState = { cx: number; cy: number; zoom: number };

/** Taille de l'icône produite (px). */
export const ICON_SIZE = 256;
const MAX_ZOOM = 5;

type Loaded = { img: HTMLImageElement; w: number; h: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** Zoom minimal : l'image entière tient dans le cadre. */
const minZoom = (l: Loaded) => Math.min(l.w, l.h) / Math.max(l.w, l.h);

/** Garde l'image dans les limites : elle couvre le cadre, ou reste à l'intérieur quand elle est plus petite. */
function clampCrop(c: CropState, l: Loaded): CropState {
  const zoom = clamp(c.zoom, minZoom(l), MAX_ZOOM);
  const side = Math.min(l.w, l.h);
  const ax = side / (2 * l.w * zoom); // demi-cadre, en fraction de la largeur de l'image
  const ay = side / (2 * l.h * zoom);
  return {
    zoom,
    cx: clamp(c.cx, Math.min(ax, 1 - ax), Math.max(ax, 1 - ax)),
    cy: clamp(c.cy, Math.min(ay, 1 - ay), Math.max(ay, 1 - ay)),
  };
}

/** Position de l'image dans un cadre carré de `size` px. */
function placement(c: CropState, l: Loaded, size: number) {
  const scale = (size * c.zoom) / Math.min(l.w, l.h);
  return { left: size / 2 - c.cx * l.w * scale, top: size / 2 - c.cy * l.h * scale, width: l.w * scale, height: l.h * scale };
}

/** Icône finale (PNG carré, transparence conservée). */
export async function renderCrop(img: HTMLImageElement, crop: CropState): Promise<Blob> {
  const l = { img, w: img.naturalWidth, h: img.naturalHeight };
  const p = placement(crop, l, ICON_SIZE);
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Recadrage impossible sur cet appareil.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, p.left, p.top, p.width, p.height);
  let blob: Blob | null;
  try {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    blob = null;
  }
  if (!blob) throw new Error('Cette image vient d’un autre site et ne peut pas être recadrée : importez-la depuis votre appareil.');
  return blob;
}

type Props = {
  /** Image à recadrer : adresse (fichier importé ou image déjà envoyée). */
  src: string;
  initial?: CropState | null;
  /** GIF animé : proposer de le garder tel quel (le recadrage le fige). */
  animated?: boolean;
  onCancel: () => void;
  /** `crop` null : garder l'image telle quelle (GIF animé). */
  onDone: (img: HTMLImageElement, crop: CropState | null) => Promise<void>;
};

/** Fenêtre « Recadrer l'icône » : déplacer l'image, zoomer (curseur, molette, deux doigts), aperçu en direct. */
export function ImageCropDialog({ src, initial, animated, onCancel, onDone }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [crop, setCrop] = useState<CropState>({ cx: 0.5, cy: 0.5, zoom: 1 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState(240); // côté du cadre à l'écran
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number } | null>(null);
  loadedRef.current = loaded;

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setSize(el.clientWidth || 240);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    const img = new Image();
    // Images du serveur Notes (autre origine dans l'application Android) : lecture autorisée par CORS.
    if (!/^(blob|data):/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      const l = { img, w: img.naturalWidth, h: img.naturalHeight };
      setLoaded(l);
      setCrop(clampCrop(initial ?? { cx: 0.5, cy: 0.5, zoom: 1 }, l));
    };
    img.onerror = () => alive && setError('Image illisible : essayez un fichier JPG, PNG ou WebP.');
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, initial]);

  /** Modifie le cadrage (toujours à partir de la dernière valeur, plusieurs gestes pouvant arriver entre deux rendus). */
  const change = (fn: (c: CropState) => CropState) =>
    setCrop((c) => {
      const l = loadedRef.current;
      return l ? clampCrop(fn(c), l) : c;
    });
  const zoomBy = (factor: number) => change((c) => ({ ...c, zoom: c.zoom * factor }));
  /** Déplacement en pixels écran. */
  const pan = (dx: number, dy: number) =>
    change((c) => {
      const l = loadedRef.current!;
      const scale = (size * c.zoom) / Math.min(l.w, l.h);
      return { ...c, cx: c.cx - dx / (l.w * scale), cy: c.cy - dy / (l.h * scale) };
    });

  // Molette : zoom (écouteur non passif pour ne pas faire défiler la fenêtre).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!loadedRef.current) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!loaded || busy) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom };
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !loaded) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size >= 2 && gesture.current) {
      // Deux doigts : zoom.
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const g = gesture.current;
      if (g.dist > 0) change((c) => ({ ...c, zoom: g.zoom * (dist / g.dist) }));
      return;
    }
    pan(cur.x - prev.x, cur.y - prev.y);
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };

  const finish = async (withCrop: boolean) => {
    if (!loaded) return;
    setBusy(true);
    setError('');
    try {
      await onDone(loaded.img, withCrop ? crop : null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Envoi de l’image impossible.');
      setBusy(false);
    }
  };

  const zMin = loaded ? minZoom(loaded) : 1;
  const preview = (size: number) => {
    if (!loaded) return null;
    const p = placement(crop, loaded, size);
    return (
      <span className="nb-crop-preview" style={{ width: size, height: size }}>
        <img src={src} alt="" draggable={false} style={{ left: p.left, top: p.top, width: p.width, height: p.height }} />
      </span>
    );
  };
  const main = loaded ? placement(crop, loaded, size) : null;

  return (
    <Modal
      title="Recadrer l’icône"
      onClose={() => !busy && onCancel()}
      width={440}
      footer={
        <>
          {animated ? (
            <button type="button" className="nb-btn nb-crop-keep" onClick={() => void finish(false)} disabled={!loaded || busy}>
              Garder le GIF animé
            </button>
          ) : null}
          <button type="button" className="nb-btn" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void finish(true)} disabled={!loaded || busy}>
            {busy ? 'Envoi…' : 'Valider'}
          </button>
        </>
      }
    >
      <div
        ref={stageRef}
        className="nb-crop-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div
          ref={frameRef}
          className="nb-crop-frame"
          tabIndex={0}
          aria-label="Zone de l’icône : glissez pour déplacer l’image, flèches pour la déplacer, + et − pour zoomer"
          onKeyDown={(e) => {
            const step = e.shiftKey ? 20 : 5;
            const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
            if (moves[e.key]) {
              e.preventDefault();
              pan(...moves[e.key]);
            } else if (e.key === '+' || e.key === '=' || e.key === '-') {
              e.preventDefault();
              zoomBy(e.key === '-' ? 1 / 1.1 : 1.1);
            }
          }}
        >
          {main ? <img src={src} alt="" draggable={false} style={{ left: main.left, top: main.top, width: main.width, height: main.height }} /> : null}
        </div>
        {!loaded && !error ? <div className="nb-crop-loading">Chargement de l’image…</div> : null}
      </div>
      <div className="nb-crop-controls">
        <label className="nb-crop-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={zMin}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => {
              const zoom = Number(e.target.value);
              change((c) => ({ ...c, zoom }));
            }}
            disabled={!loaded}
            aria-label="Zoom"
          />
        </label>
        <div className="nb-row nb-gap">
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => change(() => ({ cx: 0.5, cy: 0.5, zoom: zMin }))} disabled={!loaded}>
            Image entière
          </button>
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => change(() => ({ cx: 0.5, cy: 0.5, zoom: 1 }))} disabled={!loaded}>
            Remplir le cadre
          </button>
        </div>
      </div>
      <div className="nb-crop-previews">
        <span className="nb-muted">Aperçu</span>
        {preview(64)}
        {preview(32)}
        {preview(18)}
      </div>
      <p className="nb-muted nb-crop-help">Glissez l’image pour choisir la partie à garder ; zoomez avec le curseur, la molette ou deux doigts.</p>
      {animated ? <p className="nb-muted nb-crop-help">Un GIF animé recadré devient une image fixe.</p> : null}
      {error ? <div className="nb-error">{error}</div> : null}
    </Modal>
  );
}
