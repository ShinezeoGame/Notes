import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFFont } from '@cantoo/pdf-lib';
import type * as Y from 'yjs';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { toast } from '../components/Toast';
import { annotId, type Annot, type PageRef, type PdfProject, type PdfSource, type ProjectState, type TextAnnot } from './model';
import { clamp, rotatedSize, rotationTransform, unrotateDelta, unrotatePoint, A4 } from './geometry';
import type { PageSize, SourceCache } from './render';
import { PageCanvas } from './PageCanvas';
import { FormLayer } from './FormLayer';
import { AnnotPreview, AnnotSvg, annotBounds, hitAnnot, moveAnnot, textLayout } from './annotations';
import { LINE_HEIGHT, TEXT_FONT, loadHelvetica } from './text';
import { simplifyStroke } from './ink';
import { SignatureDialog, type SavedSignature } from './SignatureDialog';
import { uploadStamp } from './importer';
import { t } from '../lib/i18n';

export type Tool = 'select' | 'text' | 'pen' | 'highlight' | 'rect' | 'mark' | 'eraser';
type ColorTool = 'pen' | 'text' | 'mark' | 'highlight' | 'rect';

const TOOLS: { id: Tool; label: string; icon: IconName; hint: string }[] = [
  {
    id: 'select',
    label: t('Sélection'),
    icon: 'cursor',
    hint: t('Touchez une annotation pour la déplacer ou la modifier. Les champs du formulaire se remplissent directement.'),
  },
  { id: 'text', label: t('Texte'), icon: 'type', hint: t('Touchez la page à l’endroit où écrire.') },
  { id: 'pen', label: t('Stylo'), icon: 'pencil', hint: t('Dessinez sur la page. Faites défiler avec deux doigts.') },
  { id: 'highlight', label: t('Surligneur'), icon: 'highlighter', hint: t('Faites glisser sur le passage à surligner.') },
  {
    id: 'rect',
    label: t('Masquer'),
    icon: 'square',
    hint: t('Faites glisser pour couvrir une zone. À l’export, ce qui est couvert est effacé pour de bon.'),
  },
  { id: 'mark', label: t('Coche'), icon: 'check', hint: t('Touchez une case pour la cocher.') },
  { id: 'eraser', label: t('Gomme'), icon: 'eraser', hint: t('Touchez ou frottez une annotation pour l’effacer.') },
];

const COLORS: Record<ColorTool, { value: string; label: string }[]> = {
  pen: [
    { value: '#1d4ed8', label: t('Bleu') },
    { value: '#111111', label: t('Noir') },
    { value: '#dc2626', label: t('Rouge') },
    { value: '#15803d', label: t('Vert') },
    { value: '#7c3aed', label: t('Violet') },
    { value: '#ffffff', label: t('Blanc') },
  ],
  text: [
    { value: '#111111', label: t('Noir') },
    { value: '#1d4ed8', label: t('Bleu') },
    { value: '#dc2626', label: t('Rouge') },
    { value: '#15803d', label: t('Vert') },
    { value: '#ffffff', label: t('Blanc') },
  ],
  mark: [
    { value: '#111111', label: t('Noir') },
    { value: '#1d4ed8', label: t('Bleu') },
    { value: '#dc2626', label: t('Rouge') },
    { value: '#15803d', label: t('Vert') },
  ],
  highlight: [
    { value: '#facc15', label: t('Jaune') },
    { value: '#4ade80', label: t('Vert') },
    { value: '#f472b6', label: t('Rose') },
    { value: '#60a5fa', label: t('Bleu') },
    { value: '#fb923c', label: t('Orange') },
  ],
  rect: [
    { value: '#ffffff', label: t('Blanc') },
    { value: '#111111', label: t('Noir') },
    { value: '#fef3c7', label: t('Crème') },
  ],
};
const TEXT_SIZES = [8, 10, 12, 14, 18, 24, 32, 48];
const PEN_WIDTHS = [1, 2, 4, 8];
const MARK_SIZES = [10, 14, 20, 28];
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
/** Taille réelle : 1 point = 1/72 de pouce, 1 pixel CSS = 1/96 de pouce. */
const REAL_SIZE = 96 / 72;

type PageInfo = { ref: PageRef; src: PdfSource | undefined; size: PageSize; index: number };

type Gesture =
  | { kind: 'draw'; pointerId: number; page: PageInfo; points: number[] }
  | { kind: 'box'; pointerId: number; page: PageInfo; x0: number; y0: number; type: 'highlight' | 'rect' }
  | { kind: 'move'; pointerId: number; page: PageInfo; annot: Annot; sx: number; sy: number; moved: boolean; wasSelected: boolean }
  | { kind: 'resize'; pointerId: number; page: PageInfo; annot: Annot; sx: number; sy: number }
  | { kind: 'erase'; pointerId: number; page: PageInfo }
  | { kind: 'tap'; pointerId: number; page: PageInfo; sx: number; sy: number; x: number; y: number };

type Editing = { annot: TextAnnot; existing: boolean };

type Props = {
  project: PdfProject;
  state: ProjectState;
  cache: SourceCache;
  /** Document de l'espace : signatures gardées. */
  workspaceDoc: Y.Doc;
  /** Fichiers ajoutés au serveur (images), à rattacher au PDF. */
  onFiles: (paths: string[]) => void;
  /** Page à afficher (demandée depuis la vue Pages). */
  focus: { pageId: string; seq: number } | null;
};

const isTyping = (el: Element | null) =>
  Boolean(el && (el.closest('input, textarea, select, [contenteditable="true"]') || (el as HTMLElement).isContentEditable));

/** Vue « Annoter » : pages en continu, outils d'annotation, formulaire, zoom (boutons, Ctrl + molette, deux doigts). */
export function AnnotateView({ project, state, cache, workspaceDoc, onFiles, focus }: Props) {
  const [tool, setTool] = useState<Tool>('select');
  const [colors, setColors] = useState<Record<ColorTool, string>>({ pen: '#1d4ed8', text: '#111111', mark: '#111111', highlight: '#facc15', rect: '#ffffff' });
  const [penWidth, setPenWidth] = useState(2);
  const [textSize, setTextSize] = useState(12);
  const [markKind, setMarkKind] = useState<'check' | 'cross' | 'dot'>('check');
  const [markSize, setMarkSize] = useState(14);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<{ page: string; annot: Annot } | null>(null);
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  const [containerW, setContainerW] = useState(0);
  const [sizes, setSizes] = useState<Map<string, PageSize>>(new Map());
  const [near, setNear] = useState<Set<string>>(new Set());
  const [font, setFont] = useState<PDFFont | null>(null);
  const [signing, setSigning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [moreTools, setMoreTools] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Set<number>());
  const anchor = useRef<{ id: string; fx: number; fy: number; cx: number; cy: number } | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    let alive = true;
    loadHelvetica().then(
      (f) => alive && setFont(f),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  // Barre d'outils plus large que l'écran (téléphone) : fondu à droite tant qu'il reste des outils à voir.
  useLayoutEffect(() => {
    const el = toolsRef.current;
    if (!el) return;
    const check = () => setMoreTools(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', check);
    };
  }, []);

  // Largeur disponible (zoom « ajusté à la largeur »).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tailles des pages (points) : connues tout de suite pour les photos et pages blanches, lues dans les PDF sinon.
  useEffect(() => {
    let alive = true;
    const known = new Map<string, PageSize>();
    const missing: PageRef[] = [];
    for (const ref of state.pages) {
      const s = cache.knownSize(ref, ref.src ? state.sources.get(ref.src) : undefined);
      if (s) known.set(ref.id, s);
      else missing.push(ref);
    }
    setSizes(new Map(known));
    if (missing.length) {
      void Promise.all(
        missing.map(async (ref) => {
          try {
            known.set(ref.id, await cache.size(ref, state.sources.get(ref.src)));
          } catch {
            /* page illisible : taille par défaut */
          }
        }),
      ).then(() => alive && setSizes(new Map(known)));
    }
    return () => {
      alive = false;
    };
  }, [cache, state.pages, state.sources]);

  const pages: PageInfo[] = useMemo(() => {
    let last: PageSize = A4;
    return state.pages.map((ref, index) => {
      const size = sizes.get(ref.id) ?? last;
      last = size;
      return { ref, src: ref.src ? state.sources.get(ref.src) : undefined, size, index };
    });
  }, [state.pages, state.sources, sizes]);

  const maxWidth = pages.reduce((m, p) => Math.max(m, rotatedSize(p.size.w, p.size.h, p.ref.rot).w), 1);
  const margin = containerW < 600 ? 16 : 48;
  // Ajusté à la largeur, sans dépasser la taille réelle (100 %) sur les grands écrans.
  const fitZoom = clamp((containerW - margin) / maxWidth, MIN_ZOOM, REAL_SIZE);
  const zoom = zoomMode === 'fit' ? fitZoom : zoomMode;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Pages proches de l'écran : seules celles-ci sont dessinées.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) =>
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.page ?? '';
            if (e.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      { root, rootMargin: '900px 0px' },
    );
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages.length, state.pages]);

  // Page demandée depuis la vue Pages.
  useEffect(() => {
    if (!focus) return;
    const el = pagesRef.current?.querySelector<HTMLElement>(`[data-page="${focus.pageId}"]`);
    el?.scrollIntoView({ block: 'start' });
  }, [focus]);

  /** Garde le même point de la page sous le doigt (ou au centre) quand le zoom change. */
  const anchorAt = useCallback((cx: number, cy: number) => {
    const root = pagesRef.current;
    if (!root) return null;
    let best: { el: HTMLElement; dist: number } | null = null;
    root.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const dist = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
      if (!best || dist < best.dist) best = { el, dist };
    });
    if (!best) return null;
    const { el } = best as { el: HTMLElement };
    const r = el.getBoundingClientRect();
    return { id: el.dataset.page ?? '', fx: (cx - r.left) / Math.max(1, r.width), fy: (cy - r.top) / Math.max(1, r.height), cx, cy };
  }, []);

  const zoomTo = useCallback(
    (next: number | 'fit', cx?: number, cy?: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      anchor.current = anchorAt(cx ?? r.left + r.width / 2, cy ?? r.top + r.height / 2);
      setZoomMode(next === 'fit' ? 'fit' : clamp(next, MIN_ZOOM, MAX_ZOOM));
    },
    [anchorAt],
  );

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    anchor.current = null;
    const page = pagesRef.current?.querySelector<HTMLElement>(`[data-page="${a.id}"]`);
    if (!page) return;
    const r = page.getBoundingClientRect();
    el.scrollLeft += r.left + a.fx * r.width - a.cx;
    el.scrollTop += r.top + a.fy * r.height - a.cy;
  }, [zoom]);

  // Deux doigts : zoom et défilement (tous les outils) ; Ctrl + molette : zoom (ordinateur).
  useEffect(() => {
    const el = scrollRef.current;
    const content = pagesRef.current;
    if (!el || !content) return;
    let g: { d0: number; k: number; mx0: number; my0: number; mx: number; my: number; cx0: number; cy0: number; cx: number; cy: number } | null = null;
    const reset = () => {
      content.style.transform = '';
      content.style.transformOrigin = '';
    };
    const measure = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
      d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY),
    });
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      cancelGesture();
      const m = measure(e.touches);
      const r = el.getBoundingClientRect();
      g = { d0: Math.max(10, m.d), k: 1, mx0: m.x - r.left, my0: m.y - r.top, mx: m.x - r.left, my: m.y - r.top, cx0: m.x, cy0: m.y, cx: m.x, cy: m.y };
      content.style.transformOrigin = `${el.scrollLeft + g.mx0}px ${el.scrollTop + g.my0}px`;
    };
    const onMove = (e: TouchEvent) => {
      if (!g || e.touches.length !== 2) return;
      if (!e.cancelable) {
        // Le navigateur fait déjà défiler la page : on le laisse faire.
        g = null;
        reset();
        return;
      }
      e.preventDefault();
      const m = measure(e.touches);
      const r = el.getBoundingClientRect();
      const z0 = zoomRef.current;
      g.k = clamp(m.d / g.d0, MIN_ZOOM / z0, MAX_ZOOM / z0);
      g.mx = m.x - r.left;
      g.my = m.y - r.top;
      g.cx = m.x;
      g.cy = m.y;
      content.style.transform = `translate(${g.mx - g.mx0}px, ${g.my - g.my0}px) scale(${g.k})`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!g || e.touches.length >= 2) return;
      const done = g;
      g = null;
      reset();
      if (Math.abs(done.k - 1) < 0.03) {
        el.scrollLeft -= done.mx - done.mx0;
        el.scrollTop -= done.my - done.my0;
        return;
      }
      // Point de la page sous les doigts au début du geste, replacé sous leur position finale.
      const a = anchorAt(done.cx0, done.cy0);
      anchor.current = a ? { ...a, cx: done.cx, cy: done.cy } : null;
      setZoomMode(clamp(zoomRef.current * done.k, MIN_ZOOM, MAX_ZOOM));
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorAt, zoomTo]);

  const selectedAnnot = selected ? (state.annots.find((a) => a.id === selected) ?? null) : null;
  useEffect(() => {
    if (selected && !state.annots.some((a) => a.id === selected)) setSelected(null);
  }, [selected, state.annots]);

  /** Point de la page (en points) sous un point de l'écran. */
  const pagePoint = (el: HTMLElement, info: PageInfo, cx: number, cy: number) => {
    const r = el.getBoundingClientRect();
    const p = unrotatePoint(cx - r.left, cy - r.top, info.size.w * zoomRef.current, info.size.h * zoomRef.current, info.ref.rot);
    return { x: clamp(p.x / zoomRef.current, 0, info.size.w), y: clamp(p.y / zoomRef.current, 0, info.size.h) };
  };

  function cancelGesture() {
    gesture.current = null;
    setDraft(null);
  }

  const editingRef = useRef<Editing | null>(null);
  const changeEditing = (next: Editing | null) => {
    editingRef.current = next;
    setEditing(next);
  };

  /** Fin de la saisie : un texte laissé vide est retiré. */
  const finishEditing = useCallback(() => {
    const cur = editingRef.current;
    if (!cur) return;
    if (!cur.annot.text.trim() && cur.existing) project.removeAnnots([cur.annot.id]);
    editingRef.current = null;
    setEditing(null);
  }, [project]);

  const startEditing = (a: TextAnnot, existing: boolean) => {
    setSelected(existing ? a.id : null);
    changeEditing({ annot: a, existing });
  };

  /** Texte saisi : enregistré dès le premier caractère (un texte jamais rempli n'est pas créé). */
  const updateEditing = (text: string) => {
    const cur = editingRef.current;
    if (!cur) return;
    const annot = { ...cur.annot, text };
    const save = Boolean(text.trim()) || cur.existing;
    // Frappe regroupée en une seule étape d'annulation (sauf la création du texte).
    if (save) project.setAnnot(annot, cur.existing);
    changeEditing({ annot, existing: cur.existing || save });
  };

  const addAnnot = (a: Annot, select = false) => {
    project.setAnnot(a);
    if (select) {
      setTool('select');
      setSelected(a.id);
    }
  };

  // ---------- Saisie au doigt, au stylet ou à la souris ----------

  const onDrawDown = (e: React.PointerEvent<HTMLDivElement>, info: PageInfo) => {
    if (e.pointerType === 'touch') {
      touches.current.add(e.pointerId);
      if (touches.current.size > 1) {
        cancelGesture();
        return;
      }
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (gesture.current) return;
    e.preventDefault();
    if (editing) {
      finishEditing();
      return;
    }
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const p = pagePoint(el, info, e.clientX, e.clientY);
    setSelected(null);
    if (tool === 'pen') {
      gesture.current = { kind: 'draw', pointerId: e.pointerId, page: info, points: [p.x, p.y] };
      setDraft({ page: info.ref.id, annot: { id: 'draft', page: info.ref.id, type: 'ink', color: colors.pen, width: penWidth, strokes: [[p.x, p.y]] } });
    } else if (tool === 'highlight' || tool === 'rect') {
      gesture.current = { kind: 'box', pointerId: e.pointerId, page: info, x0: p.x, y0: p.y, type: tool };
    } else if (tool === 'eraser') {
      gesture.current = { kind: 'erase', pointerId: e.pointerId, page: info };
      erase(info, p.x, p.y);
    } else {
      gesture.current = { kind: 'tap', pointerId: e.pointerId, page: info, sx: e.clientX, sy: e.clientY, x: p.x, y: p.y };
    }
  };

  const erase = (info: PageInfo, x: number, y: number) => {
    const list = state.annotsByPage.get(info.ref.id) ?? [];
    const tol = 6 / zoomRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      if (hitAnnot(list[i], font, x, y, tol)) {
        project.removeAnnots([list[i].id]);
        return;
      }
    }
  };

  const scheduleDraft = (next: { page: string; annot: Annot }) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setDraft(next));
  };

  const onDrawMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const el = e.currentTarget;
    if (g.kind === 'draw') {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const p = pagePoint(el, g.page, ev.clientX, ev.clientY);
        g.points.push(p.x, p.y);
      }
      scheduleDraft({
        page: g.page.ref.id,
        annot: { id: 'draft', page: g.page.ref.id, type: 'ink', color: colors.pen, width: penWidth, strokes: [g.points.slice()] },
      });
    } else if (g.kind === 'box') {
      const p = pagePoint(el, g.page, e.clientX, e.clientY);
      scheduleDraft({
        page: g.page.ref.id,
        annot: {
          id: 'draft',
          page: g.page.ref.id,
          type: g.type,
          x: Math.min(g.x0, p.x),
          y: Math.min(g.y0, p.y),
          w: Math.abs(p.x - g.x0),
          h: Math.abs(p.y - g.y0),
          color: colors[g.type],
        },
      });
    } else if (g.kind === 'erase') {
      const p = pagePoint(el, g.page, e.clientX, e.clientY);
      erase(g.page, p.x, p.y);
    }
  };

  const onDrawUp = (e: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    setDraft(null);
    const el = e.currentTarget;
    const pageId = g.page.ref.id;
    if (g.kind === 'draw') {
      const minDist = 0.6 / zoomRef.current;
      addAnnot({ id: annotId(), page: pageId, type: 'ink', color: colors.pen, width: penWidth, strokes: [simplifyStroke(g.points, minDist)] });
    } else if (g.kind === 'box') {
      const p = pagePoint(el, g.page, e.clientX, e.clientY);
      const w = Math.abs(p.x - g.x0);
      const h = Math.abs(p.y - g.y0);
      if (w < 3 || h < 3) {
        if (g.type === 'highlight') toast(t('Faites glisser sur le passage à surligner.'));
        return;
      }
      addAnnot({ id: annotId(), page: pageId, type: g.type, x: Math.min(g.x0, p.x), y: Math.min(g.y0, p.y), w, h, color: colors[g.type] });
    } else if (g.kind === 'tap') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 10) return;
      if (tool === 'text') {
        const w = clamp(g.page.size.w - g.x - 8, textSize * 4, 260);
        const a: TextAnnot = {
          id: annotId(),
          page: pageId,
          type: 'text',
          x: g.x,
          y: Math.max(0, g.y - textSize * 0.7),
          w,
          size: textSize,
          color: colors.text,
          text: '',
        };
        startEditing(a, false);
      } else if (tool === 'mark') {
        addAnnot({
          id: annotId(),
          page: pageId,
          type: 'mark',
          x: g.x - markSize / 2,
          y: g.y - markSize / 2,
          size: markSize,
          color: colors.mark,
          mark: markKind,
        });
      }
    }
  };

  const onDrawCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (gesture.current?.pointerId === e.pointerId) cancelGesture();
  };

  // ---------- Outil Sélection : déplacer, redimensionner, modifier ----------

  const onSelectDown = (e: React.PointerEvent<HTMLDivElement>, info: PageInfo) => {
    if (tool !== 'select' || gesture.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest('.pdf-field, .pdfa-text-editor')) return;
    const handle = target.closest('[data-handle]');
    const annotEl = target.closest('[data-annot]');
    const box = target.closest('.pdfa-selection');
    const list = state.annotsByPage.get(info.ref.id) ?? [];
    let annot: Annot | undefined;
    if (handle || box) annot = selectedAnnot ?? undefined;
    else if (annotEl) annot = list.find((a) => a.id === annotEl.getAttribute('data-annot'));
    if (editing) finishEditing();
    if (!annot) {
      setSelected(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const wasSelected = selected === annot.id;
    setSelected(annot.id);
    gesture.current = handle
      ? { kind: 'resize', pointerId: e.pointerId, page: info, annot, sx: e.clientX, sy: e.clientY }
      : { kind: 'move', pointerId: e.pointerId, page: info, annot, sx: e.clientX, sy: e.clientY, moved: false, wasSelected };
  };

  const resized = (a: Annot, dx: number, dy: number): Annot => {
    switch (a.type) {
      case 'text':
        return { ...a, w: Math.max(a.size * 2, a.w + dx) };
      case 'mark':
        return { ...a, size: Math.max(6, a.size + Math.max(dx, dy)) };
      case 'image':
      case 'signature': {
        const w = Math.max(12, a.w + dx);
        return { ...a, w, h: (w * a.h) / a.w };
      }
      case 'rect':
      case 'highlight':
        return { ...a, w: Math.max(4, a.w + dx), h: Math.max(4, a.h + dy) };
      default:
        return a;
    }
  };

  const onSelectMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId || (g.kind !== 'move' && g.kind !== 'resize')) return;
    const d = unrotateDelta(e.clientX - g.sx, e.clientY - g.sy, g.page.ref.rot);
    const dx = d.x / zoomRef.current;
    const dy = d.y / zoomRef.current;
    if (g.kind === 'move') {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return;
      g.moved = true;
      scheduleDraft({ page: g.page.ref.id, annot: moveAnnot(g.annot, dx, dy) });
    } else {
      scheduleDraft({ page: g.page.ref.id, annot: resized(g.annot, dx, dy) });
    }
  };

  const onSelectUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId || (g.kind !== 'move' && g.kind !== 'resize')) return;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    setDraft(null);
    const d = unrotateDelta(e.clientX - g.sx, e.clientY - g.sy, g.page.ref.rot);
    const dx = d.x / zoomRef.current;
    const dy = d.y / zoomRef.current;
    if (g.kind === 'resize') {
      project.setAnnot(resized(g.annot, dx, dy));
    } else if (g.moved) {
      project.setAnnot(moveAnnot(g.annot, dx, dy));
    } else if (g.wasSelected && g.annot.type === 'text') {
      startEditing(g.annot, true);
    }
  };

  // ---------- Clavier ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement)) return;
      if (e.key === 'Escape') {
        if (selected) setSelected(null);
        else if (tool !== 'select') setTool('select');
        return;
      }
      if (!selectedAnnot) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        project.removeAnnots([selectedAnnot.id]);
        setSelected(null);
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        const page = state.pages.find((p) => p.id === selectedAnnot.page);
        const d = unrotateDelta(m[0], m[1], page?.rot ?? 0);
        project.setAnnot(moveAnnot(selectedAnnot, d.x, d.y));
      } else if (e.key === 'Enter' && selectedAnnot.type === 'text') {
        e.preventDefault();
        startEditing(selectedAnnot, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- Signature et image : posées au centre de la page affichée ----------

  const visiblePage = (): { info: PageInfo; x: number; y: number } | null => {
    const root = scrollRef.current;
    const list = pagesRef.current;
    if (!root || !list) return null;
    const rr = root.getBoundingClientRect();
    let best: { el: HTMLElement; area: number; cx: number; cy: number } | null = null;
    list.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, rr.right) - Math.max(r.left, rr.left);
      const h = Math.min(r.bottom, rr.bottom) - Math.max(r.top, rr.top);
      if (w <= 0 || h <= 0) return;
      if (!best || w * h > best.area) best = { el, area: w * h, cx: Math.max(r.left, rr.left) + w / 2, cy: Math.max(r.top, rr.top) + h / 2 };
    });
    if (!best) return null;
    const b = best as { el: HTMLElement; cx: number; cy: number };
    const info = pages.find((p) => p.ref.id === b.el.dataset.page);
    if (!info) return null;
    const p = pagePoint(b.el, info, b.cx, b.cy);
    return { info, ...p };
  };

  const placeSignature = (sig: SavedSignature, color: string) => {
    setSigning(false);
    const at = visiblePage();
    if (!at) return;
    const w = Math.min(160, at.info.size.w * 0.4);
    const h = w / sig.ratio;
    addAnnot(
      {
        id: annotId(),
        page: at.info.ref.id,
        type: 'signature',
        x: clamp(at.x - w / 2, 0, at.info.size.w - w),
        y: clamp(at.y - h / 2, 0, at.info.size.h - h),
        w,
        h,
        color,
        width: sig.width,
        strokes: sig.strokes,
      },
      true,
    );
    toast(t('Signature posée : faites-la glisser à sa place, et agrandissez-la avec la poignée.'));
  };

  const placeImage = async (file: File) => {
    const at = visiblePage();
    if (!at) return;
    try {
      const up = await uploadStamp(file);
      onFiles([up.path]);
      const w = Math.min(180, at.info.size.w * 0.4);
      const h = (w * up.height) / Math.max(1, up.width);
      addAnnot(
        {
          id: annotId(),
          page: at.info.ref.id,
          type: 'image',
          x: clamp(at.x - w / 2, 0, at.info.size.w - w),
          y: clamp(at.y - h / 2, 0, at.info.size.h - h),
          w,
          h,
          path: up.path,
        },
        true,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : t('Image impossible à ajouter.'), 'error');
    }
  };

  // ---------- Options de l'outil ou de l'annotation choisie ----------

  const colorRow = (current: string, list: { value: string; label: string }[], onPick: (c: string) => void) => (
    <div className="pdfa-colors" role="radiogroup" aria-label={t('Couleur')}>
      {list.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={current.toLowerCase() === c.value}
          aria-label={c.label}
          title={c.label}
          className={`pdf-swatch${current.toLowerCase() === c.value ? ' pdf-swatch--active' : ''}`}
          style={{ background: c.value }}
          onClick={() => onPick(c.value)}
        />
      ))}
    </div>
  );

  const sizeRow = (label: string, current: number, list: number[], onPick: (v: number) => void, unit = '') => (
    <label className="pdfa-size">
      <span>{label}</span>
      <select className="nb-input nb-input--sm" value={list.includes(current) ? current : ''} onChange={(e) => onPick(Number(e.target.value))}>
        {!list.includes(current) ? <option value="">{Math.round(current)}</option> : null}
        {list.map((v) => (
          <option key={v} value={v}>
            {v}
            {unit}
          </option>
        ))}
      </select>
    </label>
  );

  let options: React.ReactNode = null;
  if (tool === 'select' && selectedAnnot) {
    const a = selectedAnnot;
    const set = (patch: Partial<Annot>) => project.setAnnot({ ...a, ...patch } as Annot);
    const kind: ColorTool | null = a.type === 'ink' || a.type === 'signature' ? 'pen' : a.type === 'image' ? null : a.type === 'mark' ? 'mark' : a.type;
    options = (
      <>
        {kind && 'color' in a ? colorRow(a.color, COLORS[kind], (color) => set({ color })) : null}
        {a.type === 'text' ? sizeRow(t('Taille'), a.size, TEXT_SIZES, (size) => set({ size }), ' pt') : null}
        {a.type === 'ink' ? sizeRow(t('Épaisseur'), a.width, PEN_WIDTHS, (width) => set({ width }), ' pt') : null}
        {a.type === 'text' ? (
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => startEditing(a, true)}>
            <Icon name="pencil" size={14} /> {t('Modifier le texte')}
          </button>
        ) : null}
        <button
          type="button"
          className="nb-btn nb-btn--sm"
          onClick={() => {
            const copy = { ...moveAnnot(a, 12, 12), id: annotId() } as Annot;
            project.setAnnot(copy);
            setSelected(copy.id);
          }}
        >
          <Icon name="copy" size={14} /> {t('Dupliquer')}
        </button>
        <button
          type="button"
          className="nb-btn nb-btn--sm nb-btn--danger"
          onClick={() => {
            project.removeAnnots([a.id]);
            setSelected(null);
          }}
        >
          <Icon name="trash" size={14} /> {t('Supprimer')}
        </button>
      </>
    );
  } else if (tool === 'pen') {
    options = (
      <>
        {colorRow(colors.pen, COLORS.pen, (c) => setColors({ ...colors, pen: c }))}
        {sizeRow(t('Épaisseur'), penWidth, PEN_WIDTHS, setPenWidth, ' pt')}
      </>
    );
  } else if (tool === 'text') {
    options = (
      <>
        {colorRow(colors.text, COLORS.text, (c) => setColors({ ...colors, text: c }))}
        {sizeRow(t('Taille'), textSize, TEXT_SIZES, setTextSize, ' pt')}
      </>
    );
  } else if (tool === 'highlight' || tool === 'rect') {
    options = colorRow(colors[tool], COLORS[tool], (c) => setColors({ ...colors, [tool]: c }));
  } else if (tool === 'mark') {
    options = (
      <>
        <div className="pdfa-marks" role="radiogroup" aria-label={t('Marque')}>
          {(
            [
              ['check', 'check', t('Coche')],
              ['cross', 'close', t('Croix')],
              ['dot', 'dot', t('Point')],
            ] as const
          ).map(([kind, icon, label]) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={markKind === kind}
              aria-label={label}
              title={label}
              className={`pdfa-mark${markKind === kind ? ' pdfa-mark--active' : ''}`}
              onClick={() => setMarkKind(kind)}
            >
              <Icon name={icon} size={16} />
            </button>
          ))}
        </div>
        {colorRow(colors.mark, COLORS.mark, (c) => setColors({ ...colors, mark: c }))}
        {sizeRow(t('Taille'), markSize, MARK_SIZES, setMarkSize, ' pt')}
      </>
    );
  }
  const hint = tool === 'select' && selectedAnnot ? null : TOOLS.find((t) => t.id === tool)?.hint;

  return (
    <div className="pdfa">
      <div className="pdfa-bar">
        <div ref={toolsRef} className={`pdfa-tools${moreTools ? ' pdfa-tools--more' : ''}`} role="toolbar" aria-label={t('Outils d’annotation')}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pdfa-tool${tool === t.id ? ' pdfa-tool--active' : ''}`}
              aria-pressed={tool === t.id}
              title={t.label}
              onClick={() => {
                finishEditing();
                setTool(t.id);
                if (t.id !== 'select') setSelected(null);
              }}
            >
              <Icon name={t.icon} size={18} />
              <span>{t.label}</span>
            </button>
          ))}
          <span className="pdfa-sep" aria-hidden="true" />
          <button type="button" className="pdfa-tool" title={t('Signature')} onClick={() => setSigning(true)}>
            <Icon name="signature" size={18} />
            <span>{t('Signature')}</span>
          </button>
          <button type="button" className="pdfa-tool" title={t('Image')} onClick={() => imageInput.current?.click()}>
            <Icon name="image" size={18} />
            <span>{t('Image')}</span>
          </button>
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void placeImage(f);
            }}
          />
        </div>
        <div className="pdfa-zoom" role="group" aria-label={t('Zoom')}>
          <button
            type="button"
            className="nb-icon-btn pdfa-zoom-step"
            aria-label={t('Réduire')}
            title={t('Réduire')}
            onClick={() => zoomTo(zoom / 1.25)}
          >
            <Icon name="zoomOut" size={17} />
          </button>
          <button type="button" className="pdfa-zoom-value" title={t('Ajuster à la largeur')} onClick={() => zoomTo('fit')}>
            {t('{pct} %', { pct: Math.round((zoom / REAL_SIZE) * 100) })}
          </button>
          <button
            type="button"
            className="nb-icon-btn pdfa-zoom-step"
            aria-label={t('Agrandir')}
            title={t('Agrandir')}
            onClick={() => zoomTo(zoom * 1.25)}
          >
            <Icon name="zoomIn" size={17} />
          </button>
        </div>
      </div>
      <div className="pdfa-options">
        {options}
        {hint ? <span className="pdfa-hint">{hint}</span> : null}
      </div>

      <div ref={scrollRef} className={`pdfa-scroll pdfa-scroll--${tool}`}>
        <div ref={pagesRef} className="pdfa-pages" style={{ minWidth: maxWidth * zoom + margin }}>
          {pages.map((info) => {
            const { ref, src, size } = info;
            const rs = rotatedSize(size.w, size.h, ref.rot);
            const lw = size.w * zoom;
            const lh = size.h * zoom;
            const isNear = near.has(ref.id);
            const annots = state.annotsByPage.get(ref.id) ?? [];
            const pageDraft = draft?.page === ref.id ? draft.annot : null;
            const sel = selectedAnnot?.page === ref.id && !editing ? selectedAnnot : null;
            const selShown = sel && pageDraft?.id === sel.id ? pageDraft : sel;
            const editHere = editing?.annot.page === ref.id ? editing : null;
            const hiddenId = editHere ? editHere.annot.id : pageDraft && pageDraft.id !== 'draft' ? pageDraft.id : null;
            return (
              <div
                key={ref.id}
                className="pdfa-page"
                data-page={ref.id}
                style={{ width: rs.w * zoom, height: rs.h * zoom }}
                aria-label={t('Page {n}', { n: info.index + 1 })}
              >
                <div
                  className="pdfa-layer"
                  style={{ width: lw, height: lh, transform: rotationTransform(lw, lh, ref.rot) }}
                  onPointerDown={(e) => onSelectDown(e, info)}
                  onPointerMove={onSelectMove}
                  onPointerUp={onSelectUp}
                  onPointerCancel={() => gesture.current?.kind === 'move' && cancelGesture()}
                  onDoubleClick={(e) => {
                    if (tool !== 'select') return;
                    const target = e.target as Element;
                    const id = target.closest('[data-annot]')?.getAttribute('data-annot') ?? (target.closest('.pdfa-selection') ? selected : null);
                    const a = annots.find((x) => x.id === id);
                    if (a?.type === 'text') startEditing(a, true);
                  }}
                >
                  {isNear ? <PageCanvas cache={cache} page={ref} src={src} cssWidth={lw} forms delay={120} /> : null}
                  {isNear ? <FormLayer cache={cache} page={ref} src={src} zoom={zoom} project={project} forms={state.forms} inert={tool !== 'select'} /> : null}
                  {isNear ? <AnnotSvg w={size.w} h={size.h} annots={annots} font={font} interactive={tool === 'select'} hiddenId={hiddenId} /> : null}
                  {pageDraft ? <AnnotPreview w={size.w} h={size.h} annot={pageDraft} font={font} /> : null}
                  {selShown ? <SelectionBox annot={selShown} font={font} zoom={zoom} /> : null}
                  {editHere ? <TextEditor editing={editHere} font={font} zoom={zoom} onChange={updateEditing} onDone={finishEditing} /> : null}
                  {tool !== 'select' ? (
                    <div
                      className="pdfa-draw"
                      onPointerDown={(e) => onDrawDown(e, info)}
                      onPointerMove={onDrawMove}
                      onPointerUp={onDrawUp}
                      onPointerCancel={onDrawCancel}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {signing ? <SignatureDialog doc={workspaceDoc} onPick={placeSignature} onClose={() => setSigning(false)} /> : null}
    </div>
  );
}

/** Cadre de l'annotation choisie, avec sa poignée de redimensionnement. */
function SelectionBox({ annot, font, zoom }: { annot: Annot; font: PDFFont | null; zoom: number }) {
  const [x, y, w, h] = annotBounds(annot, font);
  const pad = 4;
  const resizable = annot.type !== 'ink';
  return (
    <div
      className="pdfa-selection"
      style={{ left: x * zoom - pad, top: y * zoom - pad, width: w * zoom + 2 * pad, height: h * zoom + 2 * pad }}
      aria-hidden="true"
    >
      {resizable ? (
        <span
          className={`pdfa-handle${annot.type === 'text' ? ' pdfa-handle--edge' : ''}`}
          data-handle="resize"
          title={annot.type === 'text' ? t('Largeur de la zone de texte') : t('Taille')}
        />
      ) : null}
    </div>
  );
}

/** Zone de saisie d'un texte posé sur la page. */
function TextEditor({
  editing,
  font,
  zoom,
  onChange,
  onDone,
}: {
  editing: Editing;
  font: PDFFont | null;
  zoom: number;
  onChange: (t: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const a = editing.annot;
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  const lines = Math.max(1, textLayout(font, a).lines.length) + 1;
  return (
    <textarea
      ref={ref}
      className="pdfa-text-editor"
      value={a.text}
      placeholder={t('Votre texte')}
      aria-label={t('Texte à ajouter sur la page')}
      spellCheck
      style={{
        left: a.x * zoom - 2,
        top: a.y * zoom - 2,
        width: a.w * zoom + 8,
        height: lines * LINE_HEIGHT * a.size * zoom + 4,
        fontSize: a.size * zoom,
        lineHeight: LINE_HEIGHT,
        fontFamily: TEXT_FONT,
        color: a.color,
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
    />
  );
}
