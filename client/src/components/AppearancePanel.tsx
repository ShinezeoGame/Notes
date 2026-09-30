// Panneau « Personnaliser » : thème de couleurs, couleur d'accent, fond d'écran, style des widgets, taille du texte,
// sections de la navigation. Chaque changement s'affiche aussitôt ; il est enregistré dans l'espace (tous les appareils).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';
import { useAppCtx } from '../editor/context';
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  GRADIENTS,
  THEMES,
  normalizeAppearance,
  updateAppearance,
  type Appearance,
  type SectionId,
  type WallpaperKind,
} from '../lib/appearance';
import { prepareImage } from '../lib/images';
import { SECTIONS, groupSections } from './AppNav';
import { Icon } from '../icons/Icon';

type Props = {
  doc: Y.Doc;
  appearance: Appearance;
  /** Réglages en cours d'essai (affichés aussitôt, avant l'enregistrement). */
  onPreview: (a: Appearance | null) => void;
  onClose: () => void;
};

function Range({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="ap-range">
      <span>
        {label}
        <b>
          {value}
          {unit}
        </b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function AppearancePanel({ doc, appearance, onPreview, onClose }: Props) {
  const ctx = useAppCtx();
  const [draft, setDraft] = useState(appearance);
  const pending = useRef<Appearance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState(appearance.wallpaper.kind === 'image' && !appearance.wallpaper.value.startsWith('data:') ? appearance.wallpaper.value : '');

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) updateAppearance(doc, () => next);
  };

  // Fermeture : dernier changement enregistré, fin de l'essai.
  useEffect(
    () => () => {
      flush();
      onPreview(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = (patch: Partial<Appearance>) => {
    const next = normalizeAppearance({ ...draft, ...patch });
    setDraft(next);
    onPreview(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };
  const setWallpaper = (patch: Partial<Appearance['wallpaper']>) => change({ wallpaper: { ...draft.wallpaper, ...patch } });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const url = await ctx.uploadFile(await prepareImage(file, 3200, 2400, true));
      setWallpaper({ kind: 'image', value: url });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Envoi de l’image impossible.');
    } finally {
      setUploading(false);
    }
  };

  const kind = draft.wallpaper.kind;
  const setKind = (k: WallpaperKind) => {
    if (k === kind) return;
    const value = k === 'color' ? '#1e3a8a' : k === 'gradient' ? GRADIENTS[0].id : k === 'image' ? imageUrl : '';
    setWallpaper({ kind: k, value });
  };

  /** Échange une section avec la précédente ou la suivante de son groupe. */
  const moveSection = (id: SectionId, delta: number) => {
    const same = draft.sections.filter((s) => SECTIONS[s].group === SECTIONS[id].group);
    const other = same[same.indexOf(id) + delta];
    if (!other) return;
    const list = [...draft.sections];
    const i = list.indexOf(id);
    const j = list.indexOf(other);
    [list[i], list[j]] = [list[j], list[i]];
    change({ sections: list });
  };

  return createPortal(
    <div className="ap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ap-panel" role="dialog" aria-label="Personnaliser">
        <header className="ap-head">
          <h2>
            <Icon name="palette" size={18} /> Personnaliser
          </h2>
          <button type="button" className="nb-icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="ap-body">
          <section className="ap-section">
            <h3>Thème</h3>
            <div className="ap-themes">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`ap-theme${draft.theme === t.id ? ' ap-theme--on' : ''}`}
                  onClick={() => change({ theme: t.id })}
                  aria-pressed={draft.theme === t.id}
                >
                  <span className="ap-theme-preview" style={{ background: t.palette.bg, borderColor: t.palette.border }}>
                    <span style={{ background: t.palette.sidebar }} />
                    <span>
                      <i style={{ background: t.palette.strong }} />
                      <i style={{ background: t.palette.muted }} />
                      <i style={{ background: draft.accent }} />
                    </span>
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          <section className="ap-section">
            <h3>Couleur d’accent</h3>
            <div className="ap-swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a.color}
                  type="button"
                  className={`ap-swatch${draft.accent === a.color ? ' ap-swatch--on' : ''}`}
                  style={{ background: a.color }}
                  onClick={() => change({ accent: a.color })}
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={draft.accent === a.color}
                />
              ))}
              <label className="ap-swatch ap-swatch--custom" title="Autre couleur">
                <input type="color" value={draft.accent} onChange={(e) => change({ accent: e.target.value })} aria-label="Autre couleur" />
                <Icon name="plus" size={14} />
              </label>
            </div>
          </section>

          <section className="ap-section">
            <h3>Fond d’écran</h3>
            <div className="ap-seg" role="radiogroup" aria-label="Type de fond d’écran">
              {(
                [
                  ['none', 'Aucun'],
                  ['gradient', 'Dégradé'],
                  ['color', 'Couleur'],
                  ['image', 'Image'],
                ] as [WallpaperKind, string][]
              ).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'ap-seg--on' : ''} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
            </div>
            {kind === 'gradient' ? (
              <div className="ap-gradients">
                {GRADIENTS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`ap-gradient${draft.wallpaper.value === g.id ? ' ap-gradient--on' : ''}`}
                    style={{ background: g.css }}
                    onClick={() => setWallpaper({ value: g.id })}
                    title={g.label}
                    aria-label={g.label}
                    aria-pressed={draft.wallpaper.value === g.id}
                  />
                ))}
              </div>
            ) : null}
            {kind === 'color' ? (
              <label className="ap-color">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(draft.wallpaper.value) ? draft.wallpaper.value : '#1e3a8a'} onChange={(e) => setWallpaper({ value: e.target.value })} />
                Choisir la couleur
              </label>
            ) : null}
            {kind === 'image' ? (
              <div className="ap-image">
                <button type="button" className="nb-btn nb-btn--sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  <Icon name="upload" size={14} /> {uploading ? 'Envoi…' : 'Envoyer une image'}
                </button>
                <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
                <div className="nb-row nb-gap">
                  <input
                    className="nb-input"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="… ou adresse d’une image (https://…)"
                    inputMode="url"
                  />
                  <button type="button" className="nb-btn nb-btn--sm" disabled={!/^https?:\/\/\S+$/i.test(imageUrl.trim())} onClick={() => setWallpaper({ value: imageUrl.trim() })}>
                    Utiliser
                  </button>
                </div>
                {error ? <div className="nb-error">{error}</div> : null}
                <Range label="Flou" value={draft.wallpaper.blur} min={0} max={30} unit=" px" onChange={(v) => setWallpaper({ blur: v })} />
              </div>
            ) : null}
            {kind !== 'none' ? (
              <>
                <Range label="Voile (lisibilité)" value={draft.wallpaper.dim} min={0} max={90} unit=" %" onChange={(v) => setWallpaper({ dim: v })} />
                <label className="nb-check">
                  <input type="checkbox" checked={draft.wallpaper.everywhere} onChange={(e) => setWallpaper({ everywhere: e.target.checked })} /> Dans toute
                  l’application (pas seulement l’accueil)
                </label>
              </>
            ) : null}
          </section>

          <section className="ap-section">
            <h3>Widgets</h3>
            <Range label="Opacité du fond" value={draft.widgetOpacity} min={0} max={100} step={5} unit=" %" onChange={(v) => change({ widgetOpacity: v })} />
            <Range label="Flou derrière" value={draft.widgetBlur} min={0} max={40} unit=" px" onChange={(v) => change({ widgetBlur: v })} />
            <Range label="Arrondi des coins" value={draft.radius} min={0} max={32} unit=" px" onChange={(v) => change({ radius: v })} />
            <Range label="Espacement" value={draft.gap} min={0} max={40} step={2} unit=" px" onChange={(v) => change({ gap: v })} />
          </section>

          <section className="ap-section">
            <h3>Texte</h3>
            <Range label="Taille du texte" value={draft.textScale} min={80} max={140} step={5} unit=" %" onChange={(v) => change({ textScale: v })} />
          </section>

          <section className="ap-section">
            <h3>Sections</h3>
            <p className="nb-muted ap-hint">Sections affichées dans la navigation, et leur ordre dans chaque groupe.</p>
            <div className="ap-sections">
              {groupSections(draft.sections).map((g) => (
                <div key={g.id} className="ap-section-group" role="group" aria-label={g.label || 'Accueil'}>
                  {g.label ? <div className="ap-section-group-label">{g.label}</div> : null}
                  {g.ids.map((id, i) => {
                    const hidden = draft.hidden.includes(id);
                    const s = SECTIONS[id];
                    return (
                      <div key={id} className={`ap-section-row${hidden ? ' ap-section-row--off' : ''}`}>
                        <Icon name={s.icon} size={17} />
                        <span title={s.hint}>{s.label}</span>
                        {g.ids.length > 1 ? (
                          <>
                            <button type="button" className="nb-icon-btn nb-icon-btn--sm" onClick={() => moveSection(id, -1)} disabled={i === 0} aria-label={`Monter ${s.label}`}>
                              <Icon name="arrowUp" size={14} />
                            </button>
                            <button
                              type="button"
                              className="nb-icon-btn nb-icon-btn--sm"
                              onClick={() => moveSection(id, 1)}
                              disabled={i === g.ids.length - 1}
                              aria-label={`Descendre ${s.label}`}
                            >
                              <Icon name="arrowDown" size={14} />
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="nb-icon-btn nb-icon-btn--sm"
                          disabled={id === 'home'}
                          onClick={() => change({ hidden: hidden ? draft.hidden.filter((h) => h !== id) : [...draft.hidden, id] })}
                          aria-label={hidden ? `Afficher ${s.label}` : `Masquer ${s.label}`}
                          title={id === 'home' ? 'L’accueil reste toujours affiché' : hidden ? 'Afficher' : 'Masquer'}
                        >
                          <Icon name={hidden ? 'eyeOff' : 'eye'} size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>

          <button
            type="button"
            className="nb-btn nb-btn--sm ap-reset"
            onClick={() => confirm('Revenir à l’apparence de départ (thème sombre, sans fond d’écran) ?') && change({ ...DEFAULT_APPEARANCE })}
          >
            <Icon name="refresh" size={14} /> Apparence de départ
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
