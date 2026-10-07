import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { t } from '../lib/i18n';

/**
 * Recadrage d'une image dans un cadre (carré pour une icône, large pour une bannière, au format de l'écran pour un fond
 * d'écran) : `cx`/`cy` = point de l'image (0 à 1) au centre du cadre, `zoom` = 1 quand l'image remplit juste le cadre
 * (plus petit : image entière avec des marges). Indépendant de la taille du cadre, seul son format compte.
 */
export type CropState = { cx: number; cy: number; zoom: number };

/** Taille de l'icône produite (px). */
export const ICON_SIZE = 256;
const MAX_ZOOM = 5;

type Loaded = { img: HTMLImageElement; w: number; h: number };
/** Cadre : largeur et hauteur (px, ou toute unité : seules les proportions comptent pour le recadrage). */
type Frame = { w: number; h: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** Échelle à laquelle l'image remplit juste le cadre. */
const coverScale = (l: Loaded, f: Frame) => Math.max(f.w / l.w, f.h / l.h);
/** Zoom minimal : l'image entière tient dans le cadre. */
const minZoom = (l: Loaded, f: Frame) => Math.min(f.w / l.w, f.h / l.h) / coverScale(l, f);

/** Garde l'image dans les limites : elle couvre le cadre, ou reste à l'intérieur quand elle est plus petite. */
function clampCrop(c: CropState, l: Loaded, f: Frame): CropState {
  const zoom = clamp(c.zoom, minZoom(l, f), MAX_ZOOM);
  const scale = coverScale(l, f) * zoom;
  const ax = f.w / (2 * l.w * scale); // demi-cadre, en fraction de la largeur de l'image
  const ay = f.h / (2 * l.h * scale);
  return {
    zoom,
    cx: clamp(c.cx, Math.min(ax, 1 - ax), Math.max(ax, 1 - ax)),
    cy: clamp(c.cy, Math.min(ay, 1 - ay), Math.max(ay, 1 - ay)),
  };
}

/** Position de l'image dans un cadre de `f.w` × `f.h` px. */
function placement(c: CropState, l: Loaded, f: Frame) {
  const scale = coverScale(l, f) * c.zoom;
  return { left: f.w / 2 - c.cx * l.w * scale, top: f.h / 2 - c.cy * l.h * scale, width: l.w * scale, height: l.h * scale };
}

async function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  let blob: Blob | null;
  try {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.88));
  } catch {
    blob = null;
  }
  if (!blob) throw new Error(t('Cette image vient d’un autre site et ne peut pas être recadrée : importez-la depuis votre appareil.'));
  return blob;
}

/** Icône finale (PNG carré, transparence conservée). */
export async function renderCrop(img: HTMLImageElement, crop: CropState): Promise<Blob> {
  const l = { img, w: img.naturalWidth, h: img.naturalHeight };
  const p = placement(crop, l, { w: ICON_SIZE, h: ICON_SIZE });
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Recadrage impossible sur cet appareil.'));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, p.left, p.top, p.width, p.height);
  return toBlob(canvas, 'image/png');
}

/**
 * Partie choisie de l'image (bannière, fond d'écran…) au format `aspect` (largeur / hauteur) : à la définition de
 * l'original, réduite à `maxW` × `maxH` px au plus ; JPEG, ou PNG pour garder la transparence.
 */
export async function renderCropArea(img: HTMLImageElement, crop: CropState, aspect: number, maxW: number, maxH: number, transparent = false): Promise<File> {
  const l = { img, w: img.naturalWidth, h: img.naturalHeight };
  // Partie de l'original couverte par le cadre, en pixels de l'image.
  const scale = coverScale(l, { w: aspect, h: 1 }) * crop.zoom;
  const k = Math.min(1, maxW / (aspect / scale), maxH / (1 / scale));
  const w = Math.max(1, Math.round((aspect / scale) * k));
  const h = Math.max(1, Math.round((1 / scale) * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Recadrage impossible sur cet appareil.'));
  if (!transparent) {
    // Marges (image dézoomée) : même fond que les images réduites à l'envoi.
    ctx.fillStyle = '#191919';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  const p = placement(crop, l, { w, h });
  ctx.drawImage(img, p.left, p.top, p.width, p.height);
  const type = transparent ? 'image/png' : 'image/jpeg';
  return new File([await toBlob(canvas, type)], transparent ? 'image.png' : 'image.jpg', { type });
}

/** Image d'origine et recadrage enregistrés (pour recadrer de nouveau à partir de l'original), ou null. */
export function parseCropSource(raw: unknown): ({ src: string } & CropState) | null {
  let v: Partial<{ src: string } & CropState>;
  try {
    v = (typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : raw) as Partial<{ src: string } & CropState>;
  } catch {
    return null;
  }
  if (!v || typeof v.src !== 'string' || !/^(https?:\/\/|data:image\/)/.test(v.src)) return null;
  const num = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
  return { src: v.src, cx: num(v.cx, 0.5), cy: num(v.cy, 0.5), zoom: num(v.zoom, 1) };
}

type Props = {
  /** Image à recadrer : adresse (fichier importé ou image déjà envoyée). */
  src: string;
  initial?: CropState | null;
  /** Format du cadre : largeur / hauteur (1 : carré, icône). */
  aspect?: number;
  /** Formats au choix (0 : format de l'image d'origine), le premier par défaut ; remplace `aspect`. */
  formats?: { label: string; aspect: number }[];
  title?: string;
  /** Aperçus en petit, aux tailles d'une icône. */
  previews?: boolean;
  /** GIF animé : proposer de le garder tel quel (le recadrage le fige). */
  animated?: boolean;
  onCancel: () => void;
  /** `crop` null : garder l'image telle quelle (GIF animé) ; `aspect` : format choisi. */
  onDone: (img: HTMLImageElement, crop: CropState | null, aspect: number) => Promise<void>;
};

/** Marge autour du cadre (px) : la partie de l'image hors du cadre reste visible, voilée. */
const MARGIN = 30;

/** Fenêtre « Recadrer » : déplacer l'image, zoomer (curseur, molette, deux doigts), aperçu en direct. */
export function ImageCropDialog({
  src,
  initial,
  aspect: fixedAspect = 1,
  formats,
  title = t('Recadrer l’icône'),
  previews = !formats && fixedAspect === 1,
  animated,
  onCancel,
  onDone,
}: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Format choisi parmi `formats` (index), le format de l'image d'origine valant 0.
  const [formatIndex, setFormatIndex] = useState(0);
  const chosen = formats?.[formatIndex]?.aspect;
  const aspect = formats ? (chosen || (loaded ? loaded.w / loaded.h : 1)) : fixedAspect;
  const [crop, setCrop] = useState<CropState>({ cx: 0.5, cy: 0.5, zoom: 1 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Cadre à l'écran : le plus grand possible dans la zone de recadrage, au format demandé.
  const [frame, setFrame] = useState<Frame>({ w: 240, h: 240 / aspect });
  const stageRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const frameRef = useRef(frame);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number } | null>(null);
  loadedRef.current = loaded;
  frameRef.current = frame;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const maxW = Math.max(60, el.clientWidth - 2 * MARGIN);
      const maxH = Math.max(60, el.clientHeight - 2 * MARGIN);
      const w = Math.round(Math.min(maxW, maxH * aspect));
      const f = { w, h: Math.round(w / aspect) };
      setFrame(f);
      // Autre format : cadrage remis dans les limites du nouveau cadre.
      setCrop((c) => (loadedRef.current ? clampCrop(c, loadedRef.current, f) : c));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useEffect(() => {
    let alive = true;
    const img = new Image();
    // Images du serveur Ostal (autre origine dans l'application Android) : lecture autorisée par CORS.
    if (!/^(blob|data):/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      const l = { img, w: img.naturalWidth, h: img.naturalHeight };
      setLoaded(l);
      setCrop(clampCrop(initial ?? { cx: 0.5, cy: 0.5, zoom: 1 }, l, frameRef.current));
    };
    img.onerror = () => alive && setError(t('Image illisible : essayez un fichier JPG, PNG ou WebP.'));
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, initial]);

  /** Modifie le cadrage (toujours à partir de la dernière valeur, plusieurs gestes pouvant arriver entre deux rendus). */
  const change = (fn: (c: CropState) => CropState) =>
    setCrop((c) => {
      const l = loadedRef.current;
      return l ? clampCrop(fn(c), l, frameRef.current) : c;
    });
  const zoomBy = (factor: number) => change((c) => ({ ...c, zoom: c.zoom * factor }));
  /** Déplacement en pixels écran. */
  const pan = (dx: number, dy: number) =>
    change((c) => {
      const l = loadedRef.current!;
      const scale = coverScale(l, frameRef.current) * c.zoom;
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
      await onDone(loaded.img, withCrop ? crop : null, aspect);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('Envoi de l’image impossible.'));
      setBusy(false);
    }
  };

  const zMin = loaded ? minZoom(loaded, frame) : 1;
  const preview = (size: number) => {
    if (!loaded) return null;
    const p = placement(crop, loaded, { w: size, h: size });
    return (
      <span className="nb-crop-preview" style={{ width: size, height: size }}>
        <img src={src} alt="" draggable={false} style={{ left: p.left, top: p.top, width: p.width, height: p.height }} />
      </span>
    );
  };
  const main = loaded ? placement(crop, loaded, frame) : null;
  // Format large : fenêtre plus large ; format haut (écran de téléphone) : zone de recadrage plus haute.
  const wide = aspect > 1.3;
  const tall = aspect < 0.8;

  return (
    <Modal
      title={title}
      onClose={() => !busy && onCancel()}
      width={wide ? 640 : 440}
      footer={
        <>
          {animated ? (
            <button type="button" className="nb-btn nb-crop-keep" onClick={() => void finish(false)} disabled={!loaded || busy}>
              {t('Garder le GIF animé')}
            </button>
          ) : null}
          <button type="button" className="nb-btn" onClick={onCancel} disabled={busy}>
            {t('Annuler')}
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void finish(true)} disabled={!loaded || busy}>
            {busy ? t('Envoi…') : t('Valider')}
          </button>
        </>
      }
    >
      {formats ? (
        <div className="ap-seg nb-crop-formats" role="radiogroup" aria-label={t('Format')}>
          {formats.map((f, i) => (
            <button
              key={f.label}
              type="button"
              role="radio"
              aria-checked={i === formatIndex}
              className={i === formatIndex ? 'ap-seg--on' : ''}
              onClick={() => {
                setFormatIndex(i);
                // Autre format : l'image remplit de nouveau le cadre, autour du même point.
                change((c) => ({ ...c, zoom: 1 }));
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={stageRef}
        className={`nb-crop-stage${tall ? ' nb-crop-stage--tall' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div
          className="nb-crop-frame"
          style={{ width: frame.w, height: frame.h }}
          tabIndex={0}
          aria-label={t('Partie gardée : glissez pour déplacer l’image, flèches pour la déplacer, + et − pour zoomer')}
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
        {!loaded && !error ? <div className="nb-crop-loading">{t('Chargement de l’image…')}</div> : null}
      </div>
      <div className="nb-crop-controls">
        <label className="nb-crop-zoom">
          <span>{t('Zoom')}</span>
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
            aria-label={t('Zoom')}
          />
        </label>
        <div className="nb-row nb-gap">
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => change(() => ({ cx: 0.5, cy: 0.5, zoom: zMin }))} disabled={!loaded}>
            {t('Image entière')}
          </button>
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => change(() => ({ cx: 0.5, cy: 0.5, zoom: 1 }))} disabled={!loaded}>
            {t('Remplir le cadre')}
          </button>
        </div>
      </div>
      {previews ? (
        <div className="nb-crop-previews">
          <span className="nb-muted">{t('Aperçu')}</span>
          {preview(64)}
          {preview(32)}
          {preview(18)}
        </div>
      ) : null}
      <p className="nb-muted nb-crop-help">
        {t('Glissez l’image pour choisir la partie à garder ; zoomez avec le curseur, la molette ou deux doigts.')}
      </p>
      {animated ? <p className="nb-muted nb-crop-help">{t('Un GIF animé recadré devient une image fixe.')}</p> : null}
      {error ? <div className="nb-error">{error}</div> : null}
    </Modal>
  );
}
