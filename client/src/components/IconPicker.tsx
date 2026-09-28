import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';
import { PAGE_COLORS, PAGE_ICON_CHOICES, encodePageIcon, resolvePageIcon, type PageColor } from '../icons/pageIcon';

type Props = { value: string; onSelect: (icon: string) => void; onClose: () => void };

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function IconPicker({ value, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const current = resolvePageIcon(value);
  const [color, setColor] = useState<PageColor>(current.kind === 'svg' ? current.color : 'default');
  const [query, setQuery] = useState('');

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

  return (
    <div className="nb-iconpicker" ref={ref}>
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
        {value ? (
          <button type="button" className="nb-btn" onClick={() => onSelect('')}>
            Retirer
          </button>
        ) : null}
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
