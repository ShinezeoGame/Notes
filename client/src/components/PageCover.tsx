import { useEffect, useRef, useState } from 'react';
import { useAppCtx } from '../editor/context';
import { COVER_HEIGHT_RANGE } from '../lib/hooks';
import { firstImage, isImageLink, prepareImage } from '../lib/images';
import { Icon } from '../icons/Icon';

/** Dégradés proposés pour la bannière (valeur enregistrée : « gradient:<id> »). */
export const COVER_GRADIENTS = [
  { id: 'aurore', label: 'Aurore', css: 'linear-gradient(120deg, #f6d365 0%, #fda085 100%)' },
  { id: 'corail', label: 'Corail', css: 'linear-gradient(120deg, #ff9a9e 0%, #fad0c4 100%)' },
  { id: 'lavande', label: 'Lavande', css: 'linear-gradient(120deg, #a18cd1 0%, #fbc2eb 100%)' },
  { id: 'ciel', label: 'Ciel', css: 'linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)' },
  { id: 'ocean', label: 'Océan', css: 'linear-gradient(120deg, #2193b0 0%, #6dd5ed 100%)' },
  { id: 'menthe', label: 'Menthe', css: 'linear-gradient(120deg, #43e97b 0%, #38f9d7 100%)' },
  { id: 'foret', label: 'Forêt', css: 'linear-gradient(120deg, #134e5e 0%, #71b280 100%)' },
  { id: 'mangue', label: 'Mangue', css: 'linear-gradient(120deg, #ffe259 0%, #ffa751 100%)' },
  { id: 'braise', label: 'Braise', css: 'linear-gradient(120deg, #cb2d3e 0%, #ef473a 100%)' },
  { id: 'crepuscule', label: 'Crépuscule', css: 'linear-gradient(120deg, #355c7d 0%, #6c5b7b 50%, #c06c84 100%)' },
  { id: 'nuit', label: 'Nuit', css: 'linear-gradient(120deg, #0f2027 0%, #203a43 50%, #2c5364 100%)' },
  { id: 'ardoise', label: 'Ardoise', css: 'linear-gradient(120deg, #232526 0%, #414345 100%)' },
] as const;

/** Dégradé CSS d'une bannière « gradient:<id> », sinon null (image). */
export function coverGradient(cover: string): string | null {
  if (!cover.startsWith('gradient:')) return null;
  return COVER_GRADIENTS.find((g) => g.id === cover.slice(9))?.css ?? COVER_GRADIENTS[0].css;
}

/** Bannière affichable : dégradé connu, ou image http(s) / importée hors ligne. */
export function isValidCover(cover: string): boolean {
  return cover.startsWith('gradient:') || /^(https?:\/\/|data:image\/)/.test(cover);
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

type CoverProps = {
  cover: string;
  /** Position verticale de l'image (0 = haut, 100 = bas). */
  coverY: number;
  /** Hauteur choisie (px) ; 0 = hauteur automatique selon l'écran. */
  height: number;
  editable: boolean;
  onChange: (cover: string, y?: number) => void;
  /** Image choisie sur l'appareil : recadrée avant utilisation. */
  onFile?: (file: File) => void;
  /** Recadrer l'image actuelle. */
  onCrop?: () => void;
  /** Nouvelle hauteur (px) ; 0 = revenir à la hauteur automatique. */
  onHeightChange: (height: number) => void;
};

/** Bannière en haut de la page : image (repositionnable) ou dégradé ; changer, repositionner, retirer, hauteur. */
export function PageCover({ cover, coverY, height, editable, onChange, onFile, onCrop, onHeightChange }: CoverProps) {
  const [picker, setPicker] = useState(false);
  const [pos, setPos] = useState<number | null>(null); // position en cours de réglage
  const [dragging, setDragging] = useState(false);
  const [liveHeight, setLiveHeight] = useState<number | null>(null); // hauteur pendant le glissement
  const resize = useRef<{ startY: number; start: number } | null>(null);
  // Téléphone (pas de survol) : boutons affichés après un toucher sur la bannière, cachés en touchant ailleurs.
  const [active, setActive] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastPointer = useRef('mouse');

  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setActive(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [active]);
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ startY: number; start: number; overflow: number } | null>(null);
  const gradient = coverGradient(cover);
  const y = pos ?? coverY;

  useEffect(() => {
    setPos(null);
    setPicker(false);
    setActive(false);
  }, [cover]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (pos === null || !box || !img?.naturalWidth) return;
    // Hauteur de l'image dépassant du cadre (object-fit: cover) : c'est elle qui se déplace.
    const scale = Math.max(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
    const overflow = img.naturalHeight * scale - box.clientHeight;
    if (overflow < 1) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, start: pos, overflow };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setPos(clamp(d.start - ((e.clientY - d.startY) / d.overflow) * 100, 0, 100));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  // Hauteur : poignée sous la bannière (glisser, flèches du clavier, double-clic = hauteur automatique).
  const shownHeight = liveHeight ?? height;
  const clampHeight = (h: number) => Math.round(clamp(h, COVER_HEIGHT_RANGE.min, COVER_HEIGHT_RANGE.max));
  const currentHeight = () => shownHeight || boxRef.current?.getBoundingClientRect().height || 240;
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    resize.current = { startY: e.clientY, start: currentHeight() };
    setLiveHeight(clampHeight(resize.current.start));
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resize.current;
    if (r) setLiveHeight(clampHeight(r.start + e.clientY - r.startY));
  };
  const onResizeEnd = () => {
    if (!resize.current) return;
    resize.current = null;
    if (liveHeight !== null && liveHeight !== height) onHeightChange(liveHeight);
    setLiveHeight(null);
  };

  const repositioning = pos !== null;
  const style: React.CSSProperties & Record<string, string> = gradient ? { background: gradient } : {};
  if (shownHeight) style['--nb-cover-h'] = `${shownHeight}px`;
  return (
    <div ref={wrapRef} className={`nb-cover-wrap${active ? ' nb-cover-wrap--active' : ''}`}>
      <div
        ref={boxRef}
        className={`nb-cover${shownHeight ? ' nb-cover--custom' : ''}${repositioning ? ' nb-cover--repositioning' : ''}${dragging ? ' nb-cover--dragging' : ''}`}
        style={style}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType;
          onPointerDown(e);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onClick={() => {
          // Au clic (et non au relâchement) : sinon le clic qui suit tomberait sur un bouton tout juste affiché.
          if (editable && !repositioning && lastPointer.current !== 'mouse') setActive((v) => !v);
        }}
        onPointerCancel={endDrag}
        tabIndex={repositioning ? 0 : undefined}
        aria-label={repositioning ? 'Position de la bannière : flèches haut et bas' : undefined}
        onKeyDown={(e) => {
          if (!repositioning) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setPos((p) => clamp((p ?? 50) + (e.key === 'ArrowUp' ? -5 : 5), 0, 100));
          }
        }}
      >
        {gradient ? null : <img ref={imgRef} src={cover} alt="" draggable={false} style={{ objectPosition: `center ${y}%` }} />}
        {repositioning ? <div className="nb-cover-hint">Glissez l’image pour la repositionner</div> : null}
      </div>
      {editable && !repositioning ? (
        <div
          className={`nb-cover-resize${liveHeight !== null ? ' nb-cover-resize--active' : ''}`}
          role="slider"
          tabIndex={0}
          aria-label="Hauteur de la bannière"
          aria-valuemin={COVER_HEIGHT_RANGE.min}
          aria-valuemax={COVER_HEIGHT_RANGE.max}
          aria-valuenow={Math.round(currentHeight())}
          title="Glissez pour changer la hauteur (double-clic : hauteur automatique)"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          onDoubleClick={() => onHeightChange(0)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            onHeightChange(clampHeight(currentHeight() + (e.key === 'ArrowDown' ? 10 : -10)));
          }}
        >
          <span />
        </div>
      ) : null}
      {editable ? (
        <div className={`nb-cover-actions${repositioning ? ' nb-cover-actions--visible' : ''}`}>
          {repositioning ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onChange(cover, Math.round(pos ?? coverY));
                  setPos(null);
                }}
              >
                Enregistrer la position
              </button>
              <button type="button" onClick={() => setPos(null)}>
                Annuler
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setPicker((v) => !v)}>
                Changer la bannière
              </button>
              {gradient ? null : (
                <>
                  {onCrop ? (
                    <button type="button" onClick={onCrop}>
                      Recadrer
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setPos(coverY)}>
                    Repositionner
                  </button>
                </>
              )}
              <button type="button" onClick={() => onChange('')}>
                Retirer
              </button>
            </>
          )}
        </div>
      ) : null}
      {picker ? (
        <CoverPicker
          value={cover}
          className="nb-coverpicker--cover"
          onPick={(v) => onChange(v, 50)}
          onFile={
            onFile &&
            ((file) => {
              setPicker(false);
              onFile(file);
            })
          }
          onClose={() => setPicker(false)}
        />
      ) : null}
    </div>
  );
}

type PickerProps = {
  value: string;
  className?: string;
  onPick: (cover: string) => void;
  /** Image choisie sur l'appareil : confiée à l'appelant (recadrage), sinon envoyée telle quelle. */
  onFile?: (file: File) => void;
  onClose: () => void;
};

/** Choix de la bannière : image importée (fichier, glisser-déposer, collage), lien d'image ou dégradé. */
export function CoverPicker({ value, className, onPick, onFile, onClose }: PickerProps) {
  const app = useAppCtx();
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const upload = async (file: File) => {
    if (onFile) {
      onFile(file);
      return;
    }
    setBusy(true);
    setError('');
    try {
      onPick(await app.uploadFile(await prepareImage(file, 2400, 1600, true)));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Envoi de l’image impossible.');
      setBusy(false);
    }
  };
  const applyLink = () => {
    if (isImageLink(link)) onPick(link.trim());
  };

  return (
    <div
      ref={ref}
      className={`nb-coverpicker${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label="Bannière"
      onPaste={(e) => {
        const file = firstImage(e.clipboardData);
        if (file) {
          e.preventDefault();
          void upload(file);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = firstImage(e.dataTransfer);
        if (file) void upload(file);
      }}
    >
      <div className="nb-coverpicker-upload">
        <button type="button" className="nb-btn nb-btn--primary" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="upload" size={15} /> {busy ? 'Envoi…' : 'Importer une image'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          aria-label="Image de la bannière"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
        <span className="nb-muted">Ou glissez-la ici, ou collez-la (Ctrl+V). Idéal : une image large, 1500 × 500 px ou plus.</span>
      </div>
      <div className="nb-row nb-gap">
        <input
          className="nb-input"
          placeholder="Lien d’une image (https://…)"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyLink()}
        />
        <button type="button" className="nb-btn" onClick={applyLink} disabled={!isImageLink(link)}>
          Utiliser
        </button>
      </div>
      {error ? <div className="nb-error">{error}</div> : null}
      <div className="nb-coverpicker-title">Dégradés</div>
      <div className="nb-coverpicker-grid">
        {COVER_GRADIENTS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`nb-coverpicker-item${value === `gradient:${g.id}` ? ' nb-coverpicker-item--active' : ''}`}
            style={{ background: g.css }}
            title={g.label}
            aria-label={`Dégradé ${g.label}`}
            onClick={() => onPick(`gradient:${g.id}`)}
          />
        ))}
      </div>
    </div>
  );
}
