// Champs de formulaire d'un PDF (cases à remplir, à cocher, listes) affichés par-dessus la page et modifiables.
// Les valeurs saisies sont gardées dans le document ; elles sont écrites dans le PDF à l'export.
import { useEffect, useState } from 'react';
import type { PdfProject, FormValue, PageRef, PdfSource } from './model';
import { formKey } from './model';
import type { FormWidget } from './exporter';
import type { SourceCache } from './render';

export type Widget = {
  id: string;
  name: string;
  kind: 'text' | 'checkbox' | 'radio' | 'combo' | 'list';
  /** Position dans la page affichée, en points. */
  x: number;
  y: number;
  w: number;
  h: number;
  multiline: boolean;
  maxLen: number;
  readOnly: boolean;
  /** Taille du texte en points (0 : automatique). */
  fontSize: number;
  align: 'left' | 'center' | 'right';
  /** Case à cocher / bouton radio : valeur quand ce bouton est choisi. */
  onValue: string;
  options: { value: string; label: string }[];
  multiple: boolean;
  initial: FormValue;
  label: string;
};

const WIDGET = 20;
const loaded = new WeakMap<SourceCache, Map<string, Promise<Widget[]>>>();

function toWidget(a: FormWidget, vp: { convertToViewportPoint: (x: number, y: number) => number[] }): Widget | null {
  if (a.annotationType !== WIDGET || !a.fieldName || a.hidden) return null;
  let kind: Widget['kind'];
  if (a.fieldType === 'Tx') kind = 'text';
  else if (a.fieldType === 'Btn' && a.checkBox) kind = 'checkbox';
  else if (a.fieldType === 'Btn' && a.radioButton) kind = 'radio';
  else if (a.fieldType === 'Ch') kind = a.combo ? 'combo' : 'list';
  else return null;
  const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
  const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (w < 1 || h < 1) return null;
  const raw = a.fieldValue;
  const onValue = kind === 'radio' ? (a.buttonValue ?? '') : (a.exportValue ?? '');
  let initial: FormValue;
  if (kind === 'text') initial = Array.isArray(raw) ? raw.join(', ') : (raw ?? '');
  else if (kind === 'checkbox') initial = raw && raw === a.exportValue ? onValue : '';
  else if (kind === 'radio') initial = raw && raw !== 'Off' ? String(raw) : '';
  else if (kind === 'list' && a.multiSelect) initial = Array.isArray(raw) ? raw : raw ? [raw] : [];
  else initial = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  return {
    id: a.id,
    name: a.fieldName,
    kind,
    x,
    y,
    w,
    h,
    multiline: Boolean(a.multiLine),
    maxLen: a.maxLen ?? 0,
    readOnly: Boolean(a.readOnly),
    fontSize: a.defaultAppearanceData?.fontSize ?? 0,
    align: a.textAlignment === 1 ? 'center' : a.textAlignment === 2 ? 'right' : 'left',
    onValue,
    options: (a.options ?? []).map((o) => ({ value: o.exportValue, label: o.displayValue || o.exportValue })),
    multiple: Boolean(a.multiSelect),
    initial,
    label: a.alternativeText || a.fieldName,
  };
}

/** Champs d'une page d'un PDF (lus une fois par page pendant l'édition). */
export function pageWidgets(cache: SourceCache, src: PdfSource, index: number): Promise<Widget[]> {
  let map = loaded.get(cache);
  if (!map) {
    map = new Map();
    loaded.set(cache, map);
  }
  const key = `${src.id}:${index}`;
  let p = map.get(key);
  if (!p) {
    p = (async () => {
      const doc = await cache.doc(src);
      const page = await doc.getPage(Math.min(doc.numPages, index + 1));
      const vp = page.getViewport({ scale: 1 });
      const annots = (await page.getAnnotations()) as FormWidget[];
      return annots.map((a) => toWidget(a, vp)).filter((w): w is Widget => w !== null);
    })();
    p.catch(() => map!.delete(key));
    map.set(key, p);
  }
  return p;
}

const same = (a: FormValue, b: FormValue) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b);

type LayerProps = {
  cache: SourceCache;
  page: PageRef;
  src: PdfSource | undefined;
  /** Pixels par point. */
  zoom: number;
  project: PdfProject;
  forms: Map<string, FormValue>;
  /** Champs inactifs (outil de dessin choisi). */
  inert: boolean;
  onCount?: (count: number) => void;
};

export function FormLayer({ cache, page, src, zoom, project, forms, inert, onCount }: LayerProps) {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  useEffect(() => {
    if (src?.kind !== 'pdf') {
      setWidgets([]);
      return;
    }
    let alive = true;
    pageWidgets(cache, src, page.index).then(
      (w) => alive && setWidgets(w),
      () => alive && setWidgets([]),
    );
    return () => {
      alive = false;
    };
  }, [cache, src, page.index]);
  useEffect(() => onCount?.(widgets.length), [widgets.length, onCount]);

  if (!src || widgets.length === 0) return null;
  const valueOf = (w: Widget) => forms.get(formKey(src.id, w.name)) ?? w.initial;
  const commit = (w: Widget, value: FormValue) => project.setFormValue(src.id, w.name, same(value, w.initial) ? null : value);

  return (
    <div className="pdf-form" inert={inert} aria-hidden={inert}>
      {widgets.map((w) => (
        <Field key={w.id} w={w} zoom={zoom} value={valueOf(w)} onChange={(v) => commit(w, v)} />
      ))}
    </div>
  );
}

function Field({ w, zoom, value, onChange }: { w: Widget; zoom: number; value: FormValue; onChange: (v: FormValue) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const style: React.CSSProperties = { left: w.x * zoom, top: w.y * zoom, width: w.w * zoom, height: w.h * zoom };
  // Taille « automatique » (0) ou démesurée : taille lisible qui tient dans le champ.
  const size = w.fontSize > 0 ? w.fontSize : w.multiline ? 11 : w.h * 0.68;
  const fontSize = Math.max(4, Math.min(size, w.multiline ? 16 : w.h * 0.8) * zoom);

  if (w.kind === 'checkbox' || w.kind === 'radio') {
    const on = value !== '' && value === w.onValue;
    return (
      <button
        type="button"
        role={w.kind}
        aria-checked={on}
        aria-label={w.label}
        title={w.label}
        disabled={w.readOnly}
        className={`pdf-field pdf-field--${w.kind}${on ? ' pdf-field--on' : ''}`}
        style={{ ...style, fontSize: Math.min(w.w, w.h) * zoom * 0.8 }}
        onClick={() => onChange(on ? (w.kind === 'checkbox' ? '' : value) : w.onValue)}
      >
        {on ? (w.kind === 'checkbox' ? '✓' : '●') : ''}
      </button>
    );
  }
  if (w.kind === 'combo' || w.kind === 'list') {
    const current = Array.isArray(value) ? value : value ? [value] : [];
    return (
      <select
        className="pdf-field pdf-field--choice"
        style={{ ...style, fontSize }}
        aria-label={w.label}
        title={w.label}
        disabled={w.readOnly}
        multiple={w.multiple}
        value={w.multiple ? current : (current[0] ?? '')}
        onChange={(e) => onChange(w.multiple ? Array.from(e.target.selectedOptions, (o) => o.value) : e.target.value)}
      >
        {!w.multiple && !w.options.some((o) => o.value === '') ? <option value="" /> : null}
        {w.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const text = draft ?? (Array.isArray(value) ? value.join(', ') : value);
  const common = {
    className: `pdf-field pdf-field--text${w.multiline ? ' pdf-field--multiline' : ''}`,
    style: { ...style, fontSize, textAlign: w.align },
    'aria-label': w.label,
    title: w.label,
    disabled: w.readOnly,
    maxLength: w.maxLen > 0 ? w.maxLen : undefined,
    value: text,
    spellCheck: false,
    onFocus: () => setDraft(text),
    onBlur: () => setDraft(null),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      onChange(e.target.value);
    },
  };
  return w.multiline ? <textarea {...common} /> : <input type="text" {...common} />;
}
