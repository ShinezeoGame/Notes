// Widget Note rapide : texte libre, enregistré à chaque frappe dans le document de l'espace (texte partagé Yjs :
// deux appareils peuvent écrire en même temps sans s'écraser), façon post-it avec une couleur au choix.
import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { noteText } from '../model';
import { str, type SettingsProps, type WidgetProps } from '../types';

export const NOTE_COLORS: { id: string; label: string; color: string }[] = [
  { id: '', label: 'Aucune', color: '' },
  { id: 'yellow', label: 'Jaune', color: '#f5d565' },
  { id: 'orange', label: 'Orange', color: '#f4a261' },
  { id: 'pink', label: 'Rose', color: '#f28fb1' },
  { id: 'green', label: 'Vert', color: '#8fd19e' },
  { id: 'blue', label: 'Bleu', color: '#8ec5ff' },
  { id: 'purple', label: 'Violet', color: '#c3a6ff' },
];

/** Remplace le texte partagé par `next` en ne modifiant que la partie changée (fusion avec les autres appareils). */
function applyText(text: Y.Text, next: string) {
  const prev = text.toString();
  if (prev === next) return;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  text.doc!.transact(() => {
    if (endPrev > start) text.delete(start, endPrev - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
  }, 'dash-note');
}

export function NoteWidget({ widget, doc }: WidgetProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Position du curseur, relative au texte partagé : gardée quand un autre appareil modifie la note.
  const caret = useRef<{ start: Y.RelativePosition; end: Y.RelativePosition } | null>(null);
  const text = noteText(doc, widget.id);
  const size = str(widget.config.size, 'md');

  useEffect(() => {
    const el = ref.current!;
    el.value = text.toString();
    const onChange = (_e: Y.YTextEvent, tr: Y.Transaction) => {
      if (tr.origin === 'dash-note' && tr.local) return;
      const focused = document.activeElement === el;
      el.value = text.toString();
      if (focused && caret.current) {
        const a = Y.createAbsolutePositionFromRelativePosition(caret.current.start, doc)?.index ?? el.value.length;
        const b = Y.createAbsolutePositionFromRelativePosition(caret.current.end, doc)?.index ?? a;
        el.setSelectionRange(a, b);
      }
    };
    text.observe(onChange);
    return () => text.unobserve(onChange);
  }, [text, doc]);

  const remember = () => {
    const el = ref.current;
    if (!el) return;
    caret.current = {
      start: Y.createRelativePositionFromTypeIndex(text, el.selectionStart),
      end: Y.createRelativePositionFromTypeIndex(text, el.selectionEnd),
    };
  };

  return (
    <textarea
      ref={ref}
      className={`w-note w-note--${size}`}
      placeholder="Écrivez une note…"
      aria-label={widget.title || 'Note rapide'}
      spellCheck
      onInput={(e) => {
        applyText(text, e.currentTarget.value);
        remember();
      }}
      onSelect={remember}
      onKeyUp={remember}
      onMouseUp={remember}
    />
  );
}

export function NoteSettings({ config, set }: SettingsProps) {
  const color = str(config.color);
  return (
    <>
      <div className="nb-field">
        <span>Couleur (post-it)</span>
        <div className="w-swatches">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.id || 'none'}
              type="button"
              className={`w-swatch${color === c.id ? ' w-swatch--on' : ''}${c.id ? '' : ' w-swatch--none'}`}
              style={c.color ? { background: c.color } : undefined}
              onClick={() => set({ color: c.id })}
              title={c.label}
              aria-label={c.label}
              aria-pressed={color === c.id}
            />
          ))}
        </div>
      </div>
      <label className="nb-field">
        <span>Taille du texte</span>
        <select className="nb-input" value={str(config.size, 'md')} onChange={(e) => set({ size: e.target.value })}>
          <option value="sm">Petite</option>
          <option value="md">Normale</option>
          <option value="lg">Grande</option>
        </select>
      </label>
    </>
  );
}
