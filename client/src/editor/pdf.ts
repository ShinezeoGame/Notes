// Build « legacy » de pdf.js : compatible avec les WebView Android et navigateurs un peu anciens. Les fonctions
// récentes qui leur manquent encore sont ajoutées avant pdf.js, ici et dans son worker.
import './pdf-polyfills';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSrc from './pdf-worker?worker&url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export { pdfjs };
export type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;

/** Ouvre un PDF à partir de son contenu (copié : pdf.js s'approprie le tampon qu'on lui donne). */
export function loadPdfData(data: Uint8Array, password?: string): Promise<PdfDocument> {
  return pdfjs.getDocument({ data: data.slice(), password }).promise;
}

/** Libère un document pdf.js (mémoire et tâche de fond). */
export function closePdf(pdf: PdfDocument | null | undefined) {
  void pdf?.loadingTask.destroy().catch(() => {});
}

export async function loadPdf(url: string): Promise<PdfDocument> {
  if (url.startsWith('data:')) {
    const b64 = url.slice(url.indexOf(',') + 1);
    const bin = atob(b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return pdfjs.getDocument({ data }).promise;
  }
  return pdfjs.getDocument({ url, withCredentials: false }).promise;
}

/** Largeur maximale d'une page affichée : au-delà (page en pleine largeur), les pages sont centrées
 * plutôt que dessinées en images géantes. */
const MAX_PAGE_WIDTH = 1100;

/**
 * Affiche toutes les pages d'un PDF dans `container`, en ne dessinant que celles visibles.
 * Renvoie une fonction de nettoyage.
 */
export async function renderPdfInto(pdf: PdfDocument, container: HTMLElement, onProgress?: (done: number) => void) {
  container.replaceChildren();
  const width = Math.min(MAX_PAGE_WIDTH, Math.max(200, container.clientWidth - 2));
  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const scale = width / base.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let done = 0;
  let cancelled = false;

  const renderPage = async (index: number, holder: HTMLElement) => {
    try {
      const page = index === 1 ? first : await pdf.getPage(index);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      holder.style.width = `${viewport.width}px`;
      holder.style.height = `${viewport.height}px`;
      const context = canvas.getContext('2d');
      if (!context) return;
      await page.render({ canvasContext: context, canvas, viewport: page.getViewport({ scale: scale * dpr }) }).promise;
      if (cancelled) return;
      holder.replaceChildren(canvas);
      done++;
      onProgress?.(done);
    } catch (err) {
      if (!cancelled) console.warn('PDF: page non rendue', index, err);
    }
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        io.unobserve(el);
        void renderPage(Number(el.dataset.page), el);
      }
    },
    { root: container, rootMargin: '800px 0px' },
  );

  const total = Math.min(pdf.numPages, 400);
  for (let i = 1; i <= total; i++) {
    const holder = document.createElement('div');
    holder.className = 'nb-pdf-page';
    holder.dataset.page = String(i);
    holder.style.width = `${base.width * scale}px`;
    holder.style.height = `${base.height * scale}px`;
    container.appendChild(holder);
    io.observe(holder);
  }

  return () => {
    cancelled = true;
    io.disconnect();
  };
}
