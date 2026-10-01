import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFFont } from '@cantoo/pdf-lib';
import { Icon } from '../icons/Icon';
import { useMediaQuery } from '../lib/hooks';
import { toast } from '../components/Toast';
import { normRotation, pageId, type PageRef, type PdfProject, type PdfSource, type ProjectState } from './model';
import { A4, rotatedSize, rotationTransform } from './geometry';
import type { PageSize, SourceCache } from './render';
import { PageCanvas } from './PageCanvas';
import { AnnotSvg } from './annotations';
import { loadHelvetica } from './text';
import { t, tn } from '../lib/i18n';

type Props = {
  project: PdfProject;
  state: ProjectState;
  cache: SourceCache;
  selection: Set<string>;
  onSelection: (s: Set<string>) => void;
  /** Ouvre une page dans la vue « Annoter ». */
  onOpenPage: (pageId: string) => void;
  /** Ajoute des PDF ou des photos, avant la position donnée. */
  onAddFiles: (files: File[], at: number) => void;
  /** Crée un nouveau PDF avec les pages choisies. */
  onExtract: (pageIds: string[]) => void;
  busy: boolean;
};

const THUMB = 150;

/** Vue « Pages » : miniatures ; choisir des pages pour les tourner, déplacer, supprimer ou extraire ; ajouter des pages. */
export function PagesView({ project, state, cache, selection, onSelection, onOpenPage, onAddFiles, onExtract, busy }: Props) {
  const [moving, setMoving] = useState(false);
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);
  const [font, setFont] = useState<PDFFont | null>(null);
  const [sizes, setSizes] = useState<Map<string, PageSize>>(new Map());
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const touch = useMediaQuery('(pointer: coarse)');
  /** Position d'insertion des fichiers ajoutés (null : à la fin). */
  const insertAt = useRef<number | null>(null);
  const anchorIndex = useRef<number | null>(null);
  const pages = state.pages;
  const chosen = pages.filter((p) => selection.has(p.id));

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

  useEffect(() => {
    let alive = true;
    const next = new Map<string, PageSize>();
    void Promise.all(
      pages.map(async (ref) => {
        try {
          next.set(ref.id, await cache.size(ref, ref.src ? state.sources.get(ref.src) : undefined));
        } catch {
          /* taille par défaut */
        }
      }),
    ).then(() => alive && setSizes(next));
    return () => {
      alive = false;
    };
  }, [cache, pages, state.sources]);

  // Sélection retirée des pages supprimées (annuler / autre appareil).
  useEffect(() => {
    const ids = new Set(pages.map((p) => p.id));
    if ([...selection].some((id) => !ids.has(id))) onSelection(new Set([...selection].filter((id) => ids.has(id))));
  }, [pages, selection, onSelection]);

  const setPages = (list: PageRef[]) => project.setPages(list);

  const rotate = (delta: number) => setPages(pages.map((p) => (selection.has(p.id) ? { ...p, rot: normRotation(p.rot + delta) } : p)));

  const remove = () => {
    if (chosen.length === 0) return;
    if (chosen.length === pages.length) {
      toast(t('Un PDF garde au moins une page : pour tout effacer, supprimez le PDF depuis la bibliothèque.'), 'error');
      return;
    }
    setPages(pages.filter((p) => !selection.has(p.id)));
    onSelection(new Set());
    toast(tn(chosen.length, '{n} page supprimée.', '{n} pages supprimées.'), 'info', {
      duration: 6000,
      action: { label: t('Annuler'), run: () => project.undo.undo() },
    });
  };

  /** Place les pages choisies (ou `ids`) avant la page d'indice `index` (fin de liste : pages.length). */
  const moveTo = (index: number, ids: Set<string> = selection) => {
    const moved = pages.filter((p) => ids.has(p.id));
    if (moved.length === 0) return;
    const rest = pages.filter((p) => !ids.has(p.id));
    const at = pages.slice(0, index).filter((p) => !ids.has(p.id)).length;
    rest.splice(at, 0, ...moved);
    if (rest.some((p, i) => p.id !== pages[i].id)) setPages(rest);
    setMoving(false);
  };

  const addBlank = () => {
    const last = chosen.length ? pages.indexOf(chosen[chosen.length - 1]) + 1 : pages.length;
    const ref = pages[Math.max(0, last - 1)];
    const size = (ref && sizes.get(ref.id)) ?? A4;
    const blank: PageRef = { id: pageId(), src: '', index: 0, rot: 0, w: Math.round(size.w * 100) / 100, h: Math.round(size.h * 100) / 100 };
    project.addPages([], [blank], last);
    onSelection(new Set([blank.id]));
  };

  const click = (e: React.MouseEvent, index: number) => {
    const id = pages[index].id;
    if (moving) return;
    const next = new Set(selection);
    if (e.shiftKey && anchorIndex.current !== null) {
      const [a, b] = [Math.min(anchorIndex.current, index), Math.max(anchorIndex.current, index)];
      for (let i = a; i <= b; i++) next.add(pages[i].id);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    anchorIndex.current = index;
    onSelection(next);
  };

  const dropIndex = (e: React.DragEvent, index: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2 ? index + 1 : index;
  };

  const single = chosen.length === 1 ? chosen[0] : null;

  return (
    <div className="pdfp">
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onAddFiles(files, insertAt.current ?? pages.length);
          insertAt.current = null;
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onAddFiles(files, insertAt.current ?? pages.length);
          insertAt.current = null;
        }}
      />
      <div className="pdfp-bar" role="toolbar" aria-label={t('Pages')}>
        {chosen.length ? (
          <>
            <span className="pdfp-count">{tn(chosen.length, '{n} page', '{n} pages')}</span>
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => rotate(-90)} title={t('Pivoter vers la gauche')}>
              <Icon name="rotateLeft" size={15} /> <span className="pdfp-label">{t('Gauche')}</span>
            </button>
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => rotate(90)} title={t('Pivoter vers la droite')}>
              <Icon name="rotateRight" size={15} /> <span className="pdfp-label">{t('Droite')}</span>
            </button>
            <button
              type="button"
              className={`nb-btn nb-btn--sm${moving ? ' nb-btn--active' : ''}`}
              aria-pressed={moving}
              onClick={() => setMoving((v) => !v)}
            >
              <Icon name="move" size={15} /> {t('Déplacer')}
            </button>
            <button
              type="button"
              className="nb-btn nb-btn--sm"
              onClick={() => onExtract(chosen.map((p) => p.id))}
              disabled={busy}
              title={t('Créer un nouveau PDF avec ces pages')}
            >
              <Icon name="scissors" size={15} /> {t('Extraire')}
            </button>
            {single ? (
              <button type="button" className="nb-btn nb-btn--sm" onClick={() => onOpenPage(single.id)}>
                <Icon name="pencil" size={15} /> {t('Annoter')}
              </button>
            ) : null}
            <button type="button" className="nb-btn nb-btn--sm nb-btn--danger" onClick={remove}>
              <Icon name="trash" size={15} /> {t('Supprimer')}
            </button>
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => (setMoving(false), onSelection(new Set()))}>
              {t('Désélectionner')}
            </button>
          </>
        ) : (
          <>
            <span className="pdfp-count nb-muted">{t('Touchez des pages pour les choisir.')}</span>
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => onSelection(new Set(pages.map((p) => p.id)))}>
              {t('Tout sélectionner')}
            </button>
          </>
        )}
        <span className="pdfp-spacer" />
        <button
          type="button"
          className="nb-btn nb-btn--sm"
          disabled={busy}
          onClick={() => {
            insertAt.current = chosen.length ? pages.indexOf(chosen[chosen.length - 1]) + 1 : pages.length;
            fileInput.current?.click();
          }}
        >
          <Icon name="filePlus" size={15} /> {t('Ajouter PDF ou photos')}
        </button>
        {touch ? (
          <button
            type="button"
            className="nb-btn nb-btn--sm"
            disabled={busy}
            onClick={() => {
              insertAt.current = chosen.length ? pages.indexOf(chosen[chosen.length - 1]) + 1 : pages.length;
              cameraInput.current?.click();
            }}
          >
            <Icon name="camera" size={15} /> {t('Photo')}
          </button>
        ) : null}
        <button type="button" className="nb-btn nb-btn--sm" onClick={addBlank}>
          <Icon name="plus" size={15} /> {t('Page blanche')}
        </button>
      </div>
      {moving ? (
        <div className="pdfp-moving" role="status">
          {chosen.length > 1
            ? t('Touchez l’endroit où placer les {n} pages : avant ou après une autre page.', { n: chosen.length })
            : t('Touchez l’endroit où placer la page : avant ou après une autre page.')}
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => setMoving(false)}>
            {t('Annuler')}
          </button>
        </div>
      ) : null}

      <ol className="pdfp-grid" aria-label={t('Pages du PDF')}>
        {pages.map((ref, index) => {
          const isSel = selection.has(ref.id);
          const src = ref.src ? state.sources.get(ref.src) : undefined;
          const size = sizes.get(ref.id);
          return (
            <li
              key={ref.id}
              className={`pdfp-item${isSel ? ' pdfp-item--selected' : ''}${drag?.over === index ? ' pdfp-item--drop-before' : ''}${drag?.over === index + 1 && index === pages.length - 1 ? ' pdfp-item--drop-after' : ''}`}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const over = dropIndex(e, index);
                if (over !== drag.over) setDrag({ ...drag, over });
              }}
              onDrop={(e) => {
                if (!drag) return;
                e.preventDefault();
                const ids = selection.has(drag.id) ? selection : new Set([drag.id]);
                moveTo(dropIndex(e, index), ids);
                setDrag(null);
              }}
            >
              <button
                type="button"
                className="pdfp-thumb"
                aria-pressed={isSel}
                aria-label={ref.rot ? t('Page {n}, tournée de {deg}°', { n: index + 1, deg: ref.rot }) : t('Page {n}', { n: index + 1 })}
                draggable={!moving}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', ref.id);
                  setDrag({ id: ref.id, over: null });
                }}
                onDragEnd={() => setDrag(null)}
                onClick={(e) => click(e, index)}
                onDoubleClick={() => onOpenPage(ref.id)}
              >
                <Thumb cache={cache} page={ref} src={src} size={size} annots={state.annotsByPage.get(ref.id)} font={font} selected={isSel} />
              </button>
              <span className="pdfp-num">{index + 1}</span>
              {moving && !isSel ? (
                <div className="pdfp-targets">
                  <button type="button" onClick={() => moveTo(index)} aria-label={t('Placer avant la page {n}', { n: index + 1 })}>
                    <Icon name="chevronLeft" size={16} /> {t('Avant')}
                  </button>
                  <button type="button" onClick={() => moveTo(index + 1)} aria-label={t('Placer après la page {n}', { n: index + 1 })}>
                    {t('Après')} <Icon name="chevronRight" size={16} />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Miniature d'une page (dessinée quand elle approche de l'écran), avec ses annotations. */
function Thumb({
  cache,
  page,
  src,
  size,
  annots,
  font,
  selected,
}: {
  cache: SourceCache;
  page: PageRef;
  src: PdfSource | undefined;
  size: PageSize | undefined;
  annots: ProjectState['annots'] | undefined;
  font: PDFFont | null;
  selected: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const s = size ?? A4;
  const rs = rotatedSize(s.w, s.h, page.rot);
  const scale = THUMB / Math.max(rs.w, rs.h);
  const lw = s.w * scale;
  const lh = s.h * scale;
  const box = useMemo(() => ({ width: rs.w * scale, height: rs.h * scale }), [rs.w, rs.h, scale]);
  return (
    <span ref={ref} className="pdfp-frame" style={box}>
      <span className="pdfp-page" style={box}>
        <span className="pdfp-layer" style={{ width: lw, height: lh, transform: rotationTransform(lw, lh, page.rot) }}>
          {visible && size ? <PageCanvas cache={cache} page={page} src={src} cssWidth={lw} /> : null}
          {visible && size && annots?.length ? <AnnotSvg w={s.w} h={s.h} annots={annots} font={font} /> : null}
        </span>
      </span>
      <span className="pdfp-check" aria-hidden="true">
        {selected ? <Icon name="check" size={14} strokeWidth={3} /> : null}
      </span>
    </span>
  );
}
