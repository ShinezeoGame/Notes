// Affichage des pages de l'atelier PDF avec pdf.js : un document ouvert par fichier d'origine pendant l'édition,
// tailles des pages, rendu d'une page (PDF, photo ou page blanche) dans un canvas.
import type { PdfDocument } from '../editor/pdf';
import { fileUrl, type PageRef, type PdfSource } from './model';
import { A4, imagePageSize } from './geometry';
import { t } from '../lib/i18n';

type PdfModule = typeof import('../editor/pdf');
let pdfModule: Promise<PdfModule> | null = null;
export const loadPdfModule = () => (pdfModule ??= import('../editor/pdf'));

/** Taille de la page telle qu'affichée (rotation propre au fichier comprise), en points. */
export type PageSize = { w: number; h: number };

/** Nombre maximal de pixels d'un rendu (mémoire des téléphones). */
const MAX_PIXELS = 12_000_000;

export class SourceCache {
  private docs = new Map<string, Promise<PdfDocument>>();
  private images = new Map<string, Promise<HTMLImageElement>>();
  private sizes = new Map<string, PageSize>();
  private opened: PdfDocument[] = [];
  private destroyed = false;

  doc(src: PdfSource): Promise<PdfDocument> {
    let p = this.docs.get(src.id);
    if (!p) {
      p = loadPdfModule()
        .then((m) => m.loadPdf(fileUrl(src.path)))
        .then((d) => {
          if (this.destroyed) void d.loadingTask.destroy();
          else this.opened.push(d);
          return d;
        });
      p.catch(() => this.docs.delete(src.id));
      this.docs.set(src.id, p);
    }
    return p;
  }

  image(src: PdfSource): Promise<HTMLImageElement> {
    let p = this.images.get(src.id);
    if (!p) {
      p = new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(t('Photo introuvable : {name}', { name: src.name })));
        img.src = fileUrl(src.path);
      });
      p.catch(() => this.images.delete(src.id));
      this.images.set(src.id, p);
    }
    return p;
  }

  /** Taille déjà connue (sans attendre). */
  knownSize(ref: PageRef, src: PdfSource | undefined): PageSize | undefined {
    if (!src) return { w: ref.w ?? A4.w, h: ref.h ?? A4.h };
    if (src.kind === 'image') return imagePageSize(src.width ?? 1000, src.height ?? 1414, ref.crop);
    return this.sizes.get(`${src.id}:${ref.index}`);
  }

  async size(ref: PageRef, src: PdfSource | undefined): Promise<PageSize> {
    const known = this.knownSize(ref, src);
    if (known) return known;
    const doc = await this.doc(src!);
    const page = await doc.getPage(Math.min(doc.numPages, ref.index + 1));
    const vp = page.getViewport({ scale: 1 });
    const size = { w: vp.width, h: vp.height };
    this.sizes.set(`${src!.id}:${ref.index}`, size);
    return size;
  }

  destroy() {
    this.destroyed = true;
    for (const d of this.opened) void d.loadingTask.destroy().catch(() => {});
    this.opened = [];
    this.docs.clear();
    this.images.clear();
  }
}

export type RenderHandle = { promise: Promise<void>; cancel: () => void };

/**
 * Dessine la page dans `canvas` pour une largeur affichée de `cssWidth` px (avant la rotation ajoutée).
 * `forms` : sans les champs de formulaire (affichés par-dessus, modifiables).
 */
export function drawPage(
  cache: SourceCache,
  ref: PageRef,
  src: PdfSource | undefined,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  opts: { forms?: boolean; dpr?: number } = {},
): RenderHandle {
  let cancelled = false;
  let cancelTask: (() => void) | null = null;
  const dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 3);
  const promise = (async () => {
    const size = await cache.size(ref, src);
    if (cancelled) return;
    let scale = (cssWidth / size.w) * dpr;
    if (size.w * size.h * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (size.w * size.h));
    const width = Math.max(1, Math.floor(size.w * scale));
    const height = Math.max(1, Math.floor(size.h * scale));
    if (!src) {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      return;
    }
    if (src.kind === 'image') {
      const img = await cache.image(src);
      if (cancelled) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const c = ref.crop ?? { x: 0, y: 0, w: 1, h: 1 };
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, c.x * img.naturalWidth, c.y * img.naturalHeight, c.w * img.naturalWidth, c.h * img.naturalHeight, 0, 0, width, height);
      return;
    }
    const [{ pdfjs }, doc] = await Promise.all([loadPdfModule(), cache.doc(src)]);
    if (cancelled) return;
    const page = await doc.getPage(Math.min(doc.numPages, ref.index + 1));
    if (cancelled) return;
    const viewport = page.getViewport({ scale });
    // Rendu dans un canvas hors écran, puis copie : l'image précédente reste visible pendant le rendu.
    const work = document.createElement('canvas');
    work.width = Math.max(1, Math.floor(viewport.width));
    work.height = Math.max(1, Math.floor(viewport.height));
    const ctx = work.getContext('2d');
    if (!ctx) return;
    const task = page.render({
      canvasContext: ctx,
      canvas: work,
      viewport,
      annotationMode: opts.forms ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.ENABLE,
    });
    cancelTask = () => task.cancel();
    try {
      await task.promise;
    } catch (err) {
      if (cancelled) return;
      throw err;
    }
    if (cancelled) return;
    canvas.width = work.width;
    canvas.height = work.height;
    canvas.getContext('2d')?.drawImage(work, 0, 0);
    work.width = 0;
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      cancelTask?.();
    },
  };
}

/** Miniature (data URL JPEG) d'une page, pour la bibliothèque. */
export async function thumbnail(cache: SourceCache, ref: PageRef, src: PdfSource | undefined, width = 160): Promise<string> {
  const canvas = document.createElement('canvas');
  await drawPage(cache, ref, src, canvas, width, { dpr: 1 }).promise;
  // Rotation ajoutée par l'utilisateur appliquée à la miniature.
  let out = canvas;
  if (ref.rot) {
    out = document.createElement('canvas');
    const quarter = ref.rot === 90 || ref.rot === 270;
    out.width = quarter ? canvas.height : canvas.width;
    out.height = quarter ? canvas.width : canvas.height;
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.translate(out.width / 2, out.height / 2);
      ctx.rotate((ref.rot * Math.PI) / 180);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    }
  }
  const url = out.toDataURL('image/jpeg', 0.72);
  canvas.width = 0;
  out.width = 0;
  return url;
}
