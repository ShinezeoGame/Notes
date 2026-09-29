import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppCtx } from '../editor/context';
import { firstImage, isImageLink, prepareImage } from '../lib/images';
import { Icon } from '../icons/Icon';
import { PAGE_COLORS, PAGE_ICON_CHOICES, encodePageIcon, resolvePageIcon, type PageColor } from '../icons/pageIcon';

type Props = {
  value: string;
  onSelect: (icon: string) => void;
  onClose: () => void;
  /** Recadrage avant utilisation : nouvelle image importée (`file`) ou image actuelle (`src`). */
  onCrop?: (req: { file?: File; src?: string }) => void;
};

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function IconPicker({ value, onSelect, onClose, onCrop }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const current = resolvePageIcon(value);
  const [color, setColor] = useState<PageColor>(current.kind === 'svg' ? current.color : 'default');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'icons' | 'image'>(current.kind === 'img' ? 'image' : 'icons');
  const app = useAppCtx();
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Image personnelle (logo…) : recadrée avant utilisation, sinon réduite à 256 px (transparence conservée).
  const upload = async (file: File) => {
    if (onCrop) {
      onCrop({ file });
      return;
    }
    setBusy(true);
    setError('');
    try {
      onSelect(await app.uploadFile(await prepareImage(file, 256, 256, false)));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Envoi de l’image impossible.');
      setBusy(false);
    }
  };
  const applyLink = () => {
    if (isImageLink(link)) onSelect(link.trim());
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const choices = useMemo(() => {
    const q = normalize(query.trim());
    return q ? PAGE_ICON_CHOICES.filter((c) => normalize(`${c.name} ${c.label}`).includes(q)) : PAGE_ICON_CHOICES;
  }, [query]);

  const colorValue = PAGE_COLORS[color].value;

  const tabs = (
    <div className="nb-iconpicker-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'icons'}
        className={tab === 'icons' ? 'nb-iconpicker-tab--active' : ''}
        onClick={() => setTab('icons')}
      >
        Icônes
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'image'}
        className={tab === 'image' ? 'nb-iconpicker-tab--active' : ''}
        onClick={() => setTab('image')}
      >
        Image
      </button>
      {value ? (
        <button type="button" className="nb-iconpicker-remove" onClick={() => onSelect('')}>
          Retirer
        </button>
      ) : null}
    </div>
  );

  if (tab === 'image') {
    return (
      <div
        className="nb-iconpicker"
        ref={ref}
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
        {tabs}
        <div className="nb-iconpicker-image">
          {current.kind === 'img' ? (
            <div className="nb-row nb-gap">
              <img className="nb-iconpicker-preview" src={current.src} alt="Image actuelle" />
              {onCrop ? (
                <button type="button" className="nb-btn" onClick={() => onCrop({ src: current.src })}>
                  <Icon name="crop" size={15} /> Recadrer
                </button>
              ) : null}
            </div>
          ) : null}
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="upload" size={15} /> {busy ? 'Envoi…' : 'Importer une image'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            aria-label="Image de l’icône"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
          <span className="nb-muted">Votre logo, une photo… Ou glissez-la ici, ou collez-la (Ctrl+V). Idéal : une image carrée, PNG transparent.</span>
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
        </div>
      </div>
    );
  }

  return (
    <div className="nb-iconpicker" ref={ref}>
      {tabs}
      <div className="nb-iconpicker-head">
        <input className="nb-input" placeholder="Rechercher une icône…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <button
          type="button"
          className="nb-btn"
          onClick={() => {
            const pick = PAGE_ICON_CHOICES[Math.floor(Math.random() * PAGE_ICON_CHOICES.length)];
            const colors = Object.keys(PAGE_COLORS) as PageColor[];
            onSelect(encodePageIcon(pick.name, colors[Math.floor(Math.random() * colors.length)]));
          }}
        >
          Aléatoire
        </button>
      </div>
      <div className="nb-iconpicker-colors" role="radiogroup" aria-label="Couleur de l’icône">
        {(Object.keys(PAGE_COLORS) as PageColor[]).map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={key === color}
            title={PAGE_COLORS[key].label}
            className={`nb-iconpicker-color${key === color ? ' nb-iconpicker-color--active' : ''}`}
            style={{ background: key === 'default' ? 'var(--text)' : PAGE_COLORS[key].value }}
            onClick={() => setColor(key)}
          />
        ))}
      </div>
      <div className="nb-iconpicker-grid">
        {choices.length === 0 ? <div className="nb-muted nb-pad">Aucune icône trouvée.</div> : null}
        {choices.map((c) => {
          const active = current.kind === 'svg' && current.name === c.name;
          return (
            <button
              key={c.name}
              type="button"
              title={c.label}
              aria-label={c.label}
              className={`nb-iconpicker-item${active ? ' nb-iconpicker-item--active' : ''}`}
              style={{ color: colorValue }}
              onClick={() => onSelect(encodePageIcon(c.name, color))}
            >
              <Icon name={c.name} size={22} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
