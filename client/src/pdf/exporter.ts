// Fabrication du PDF final (bibliothèque pdf-lib) : pages des fichiers d'origine dans l'ordre choisi, rotations,
// photos, pages blanches, formulaires remplis (valeurs écrites par pdf.js puis figées) et annotations dessinées
// dans le contenu des pages. Les fichiers d'origine ne sont jamais modifiés.
// Options : filigrane et contenu masqué effacé pour de bon (pages transformées en images : rien de ce qu'elles
// cachaient n'entre dans le fichier), taille réduite (photos et images allégées) ou minimale (pages en images).
import type { PDFDict, PDFDocument, PDFFont, PDFImage, PDFPage, PDFRef } from '@cantoo/pdf-lib';
import type { PdfDocument } from '../editor/pdf';
import { fileUrl, formKey, normRotation, type Annot, type FormValue, type PageRef, type PdfSource, type ProjectState, type Rotation } from './model';
import { A4, displayUpMatrix, imagePageSize } from './geometry';
import { BASELINE, LINE_HEIGHT, layoutText } from './text';
import { MARK_STROKE, markPath, strokePath } from './ink';
import { loadPdfModule } from './render';
import { repairPdf } from './qpdf';
import { t } from '../lib/i18n';

type Lib = typeof import('@cantoo/pdf-lib');

export type ExportProgress = (fraction: number, label: string) => void;

/** Taille du fichier : d'origine, réduite (photos et images allégées), minimale (pages en images légères). */
export type ExportSize = 'normal' | 'small' | 'tiny';

export type ExportOptions = {
  /** Pages à exporter (toutes par défaut), dans l'ordre du document. */
  pageIds?: string[];
  title?: string;
  onProgress?: ExportProgress;
  /** Texte écrit en travers de chaque page, incrusté dans l'image (toutes les pages deviennent des images). */
  watermark?: string;
  /** Ce que couvre « Masquer » est effacé pour de bon : les pages concernées deviennent des images. */
  redact?: boolean;
  size?: ExportSize;
};

/** Pages transformées en images : résolution (points par pouce) et qualité JPEG, selon la taille voulue. */
const RASTER: Record<ExportSize, { dpi: number; quality: number }> = {
  normal: { dpi: 200, quality: 0.85 },
  small: { dpi: 120, quality: 0.72 },
  tiny: { dpi: 96, quality: 0.55 },
};
/** Taille réduite : grand côté des photos et images ramené à ce nombre de pixels, qualité JPEG. */
const SHRINK = { maxSide: 2000, quality: 0.72 };
/** Nombre maximal de pixels d'une page transformée en image (mémoire des téléphones). */
const MAX_RASTER_PIXELS = 12_000_000;

/** Pages transformées en images à l'export, avec ces options. */
export function flattenedPages(state: ProjectState, opts: Pick<ExportOptions, 'watermark' | 'redact' | 'size'>, pageIds?: string[]): Set<string> {
  const wanted = pageIds ? new Set(pageIds) : null;
  const all = Boolean(opts.watermark?.trim()) || opts.size === 'tiny';
  const ids = new Set<string>();
  for (const ref of state.pages) {
    if (wanted && !wanted.has(ref.id)) continue;
    if (all || (opts.redact && state.annotsByPage.get(ref.id)?.some((a) => a.type === 'rect'))) ids.add(ref.id);
  }
  return ids;
}

/** Fichier d'origine prêt à copier : document pdf-lib, ou pages à redessiner en images si illisible. */
type Loaded = { kind: 'doc'; doc: PDFDocument; keepFields: boolean } | { kind: 'raster'; bytes: Uint8Array };

export async function fetchBytes(url: string, name = 'fichier'): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(t('Serveur injoignable : « {name} » n’a pas pu être téléchargé.', { name }));
  }
  if (!res.ok) throw new Error(t('« {name} » est introuvable sur le serveur ({status}).', { name, status: res.status }));
  return new Uint8Array(await res.arrayBuffer());
}

function rgbOf(L: Lib, hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0;
  return L.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

async function loadLib(L: Lib, bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await L.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    // Chiffré sans mot de passe d'ouverture (restrictions seulement).
    if (err instanceof L.EncryptedPDFError) return L.PDFDocument.load(bytes, { updateMetadata: false, password: '' });
    throw err;
  }
}

/**
 * Écrit les valeurs du formulaire dans le PDF avec pdf.js (même moteur que l'affichage : apparence des champs,
 * cases à cocher, listes). Renvoie le PDF complété.
 */
async function fillForm(bytes: Uint8Array, values: Map<string, FormValue>): Promise<Uint8Array> {
  const { loadPdfData, closePdf } = await loadPdfModule();
  const pdf = await loadPdfData(bytes);
  try {
    const storage = pdf.annotationStorage;
    let touched = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      for (const a of (await page.getAnnotations()) as FormWidget[]) {
        if (!a.fieldName || !values.has(a.fieldName)) continue;
        const v = values.get(a.fieldName)!;
        if (a.fieldType === 'Tx') storage.setValue(a.id, { value: Array.isArray(v) ? v.join(', ') : v });
        else if (a.fieldType === 'Btn' && a.checkBox) storage.setValue(a.id, { value: v !== '' && v === a.exportValue });
        else if (a.fieldType === 'Btn' && a.radioButton) storage.setValue(a.id, { value: v !== '' && v === a.buttonValue });
        else if (a.fieldType === 'Ch') storage.setValue(a.id, { value: v });
        else continue;
        touched++;
      }
    }
    if (!touched) return bytes;
    return await pdf.saveDocument();
  } finally {
    closePdf(pdf);
  }
}

/** Champ de formulaire tel que décrit par pdf.js (getAnnotations). */
export type FormWidget = {
  id: string;
  annotationType: number;
  fieldName?: string;
  fieldType?: 'Tx' | 'Btn' | 'Ch' | 'Sig';
  fieldValue?: string | string[] | null;
  rect: [number, number, number, number];
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  exportValue?: string;
  buttonValue?: string;
  options?: { exportValue: string; displayValue: string }[];
  combo?: boolean;
  multiSelect?: boolean;
  multiLine?: boolean;
  comb?: boolean;
  maxLen?: number;
  readOnly?: boolean;
  hidden?: boolean;
  textAlignment?: number;
  defaultAppearanceData?: { fontSize?: number; fontColor?: Uint8ClampedArray | number[] };
  alternativeText?: string;
};

async function loadSource(L: Lib, src: PdfSource, values: Map<string, FormValue>): Promise<Loaded> {
  let bytes = await fetchBytes(fileUrl(src.path), src.name);
  let filled = false;
  if (values.size) {
    try {
      const out = await fillForm(bytes, values);
      filled = out !== bytes;
      bytes = out;
    } catch (err) {
      console.warn('PDF : formulaire non rempli par pdf.js', err);
    }
  }
  let doc: PDFDocument | null = null;
  try {
    doc = await loadLib(L, bytes);
  } catch (err) {
    console.warn('PDF : fichier refusé, réparation', err);
    try {
      doc = await loadLib(L, await repairPdf(bytes));
    } catch (err2) {
      console.warn('PDF : réparation impossible, pages exportées en images', err2);
    }
  }
  if (!doc) return { kind: 'raster', bytes };
  if (values.size && !filled) filled = fillWithPdfLib(L, doc, values);
  let keepFields = true;
  if (filled) {
    try {
      const form = doc.getForm();
      form.deleteXFA();
      form.flatten();
      keepFields = false;
    } catch (err) {
      // Champs gardés (avec leurs valeurs) si le figeage échoue.
      console.warn('PDF : formulaire non figé', err);
    }
  }
  return { kind: 'doc', doc, keepFields };
}

/** Secours : valeurs écrites par pdf-lib quand pdf.js n'a pas pu compléter le formulaire. */
function fillWithPdfLib(L: Lib, doc: PDFDocument, values: Map<string, FormValue>): boolean {
  let done = false;
  let form;
  try {
    form = doc.getForm();
  } catch {
    return false;
  }
  for (const [name, v] of values) {
    try {
      const f = form.getField(name);
      const one = Array.isArray(v) ? (v[0] ?? '') : v;
      if (f instanceof L.PDFTextField) f.setText(Array.isArray(v) ? v.join(', ') : v);
      else if (f instanceof L.PDFCheckBox) {
        if (one) f.check();
        else f.uncheck();
      } else if (f instanceof L.PDFRadioGroup) {
        if (one) f.select(one);
        else f.clear();
      } else if (f instanceof L.PDFDropdown || f instanceof L.PDFOptionList) f.select(v);
      else continue;
      done = true;
    } catch (err) {
      console.warn('PDF : champ non rempli', name, err);
    }
  }
  return done;
}

/** Garde les champs d'un formulaire non rempli modifiables dans le PDF exporté. */
function registerFields(L: Lib, out: PDFDocument, pages: PDFPage[]) {
  const acro = out.catalog.getOrCreateAcroForm();
  const known = new Set<string>();
  const fields = acro.dict.lookupMaybe(L.PDFName.of('Fields'), L.PDFArray); // i18n-ignore : nom PDF
  fields?.asArray().forEach((r) => known.add(r.toString()));
  for (const page of pages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (!(ref instanceof L.PDFRef)) continue;
      let fieldRef: PDFRef = ref;
      const widget = out.context.lookup(ref);
      if (!(widget instanceof L.PDFDict) || widget.get(L.PDFName.of('Subtype')) !== L.PDFName.of('Widget')) continue; // i18n-ignore : nom PDF
      let dict: PDFDict = widget;
      for (let guard = 0; guard < 32; guard++) {
        const parent = dict.get(L.PDFName.of('Parent'));
        if (!(parent instanceof L.PDFRef)) break;
        const parentDict: unknown = out.context.lookup(parent);
        if (!(parentDict instanceof L.PDFDict)) break;
        fieldRef = parent;
        dict = parentDict;
      }
      const key = fieldRef.toString();
      if (!known.has(key)) {
        known.add(key);
        acro.addField(fieldRef);
      }
    }
  }
}

/** Polices et réglages par défaut du formulaire d'origine (nécessaires pour modifier les champs gardés). */
function copyFormDefaults(L: Lib, from: PDFDocument, out: PDFDocument) {
  const src = from.catalog.getAcroForm();
  if (!src) return;
  const dst = out.catalog.getOrCreateAcroForm();
  const copier = L.PDFObjectCopier.for(from.context, out.context);
  for (const key of ['DR', 'DA']) {
    const name = L.PDFName.of(key);
    const value = src.dict.get(name);
    if (value && !dst.dict.has(name)) dst.dict.set(name, copier.copy(value));
  }
}

/** Document en cours de fabrication : police (si du texte est écrit), images déjà intégrées, photos allégées ou non. */
type DrawContext = { L: Lib; out: PDFDocument; font: PDFFont | null; images: Map<string, Promise<PDFImage>>; shrink: boolean };

async function embedImage(ctx: DrawContext, path: string): Promise<PDFImage> {
  let p = ctx.images.get(path);
  if (!p) {
    p = (async () => {
      let bytes = await fetchBytes(fileUrl(path), 'image');
      if (ctx.shrink) {
        const small = await shrinkImage(bytes, false);
        if (small) return ctx.out.embedJpg(small.bytes);
      }
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!isPng && !isJpg) bytes = await toPng(bytes);
      return isJpg ? ctx.out.embedJpg(bytes) : ctx.out.embedPng(bytes);
    })();
    ctx.images.set(path, p);
  }
  return p;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** Une image a-t-elle des pixels transparents ? (échantillon : tampons, logos) */
function hasAlpha(c: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = c.getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.floor((w * h) / 200_000)) * 4;
  for (let i = 3; i < data.length; i += step) if (data[i] < 250) return true;
  return false;
}

/**
 * Image allégée en JPEG (grand côté limité) ; null si elle est transparente, illisible ou déjà assez légère.
 * `raw` : orientation EXIF ignorée (image d'un PDF, que les lecteurs de PDF affichent sans la tourner).
 */
async function shrinkImage(bytes: Uint8Array, raw: boolean): Promise<{ bytes: Uint8Array; w: number; h: number } | null> {
  if (bytes.length < 120_000) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), raw ? { imageOrientation: 'none' } : undefined);
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, SHRINK.maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    canvas.width = w;
    canvas.height = h;
    const c2d = canvas.getContext('2d');
    if (!c2d) return null;
    c2d.drawImage(bitmap, 0, 0, w, h);
    if (bytes[0] === 0x89 && hasAlpha(c2d, w, h)) return null;
    const blob = await toBlob(canvas, 'image/jpeg', SHRINK.quality);
    if (!blob) return null;
    const out = new Uint8Array(await blob.arrayBuffer());
    return out.length < bytes.length * 0.85 ? { bytes: out, w, h } : null;
  } finally {
    bitmap.close();
    canvas.width = 0;
  }
}

/**
 * Taille réduite : images JPEG venues des PDF d'origine (scans, photos) allégées. Les images à masque, en CMJN ou
 * dans un espace de couleurs particulier restent telles quelles.
 */
async function shrinkPdfImages(L: Lib, out: PDFDocument) {
  const N = (name: string) => L.PDFName.of(name);
  const IMAGE = N('Image'); // i18n-ignore : nom PDF
  const DCT = N('DCTDecode'); // i18n-ignore : nom PDF
  for (const [ref, obj] of out.context.enumerateIndirectObjects()) {
    if (!(obj instanceof L.PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(N('Subtype')) !== IMAGE) continue; // i18n-ignore : nom PDF
    const filter = d.get(N('Filter')); // i18n-ignore : nom PDF
    if (!(filter === DCT || (filter instanceof L.PDFArray && filter.size() === 1 && filter.get(0) === DCT))) continue;
    if (['SMask', 'Mask', 'Decode', 'ImageMask'].some((k) => d.has(N(k)))) continue; // i18n-ignore : noms PDF
    let cs = d.get(N('ColorSpace')); // i18n-ignore : nom PDF
    if (cs instanceof L.PDFRef) cs = out.context.lookup(cs);
    let simple = cs === N('DeviceRGB') || cs === N('DeviceGray'); // i18n-ignore : noms PDF
    if (cs instanceof L.PDFArray && cs.get(0) === N('ICCBased')) {
      const icc = out.context.lookup(cs.get(1));
      const n = icc instanceof L.PDFRawStream ? icc.dict.get(N('N')) : undefined;
      simple = n instanceof L.PDFNumber && (n.asNumber() === 1 || n.asNumber() === 3);
    }
    if (!simple) continue;
    const small = await shrinkImage(obj.contents, true);
    if (!small) continue;
    out.context.assign(
      ref,
      out.context.stream(small.bytes, {
        Type: 'XObject',
        Subtype: 'Image', // i18n-ignore : nom PDF
        Width: small.w,
        Height: small.h,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
        Filter: 'DCTDecode',
      }),
    );
  }
}

/** Filigrane : texte répété en diagonale sur toute la page, foncé et semi-transparent, bordé de clair. */
export function drawWatermark(c: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const size = Math.max(12, Math.round(Math.min(w, h) / 26));
  c.save();
  c.font = `600 ${size}px Helvetica, Arial, sans-serif`; // i18n-ignore : polices
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = Math.max(1, size / 10);
  c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  c.fillStyle = 'rgba(30, 35, 60, 0.33)';
  c.translate(w / 2, h / 2);
  c.rotate(-Math.PI / 6);
  const reach = Math.hypot(w, h) / 2 + size;
  const unit = c.measureText(`${text}      `).width || size;
  let row = 0;
  for (let y = -reach; y <= reach; y += size * 3.4, row++) {
    for (let x = -reach - (row % 2 ? unit / 2 : 0); x <= reach; x += unit) {
      c.strokeText(text, x, y);
      c.fillText(text, x, y);
    }
  }
  c.restore();
}

/** Image d'un autre format (WebP, GIF…) convertie en PNG. */
async function toPng(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await toBlob(canvas, 'image/png');
  if (!blob) throw new Error(t('Image illisible.'));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Dessine les annotations d'une page dans son contenu, dans le repère de la page affichée
 * (`box` : zone visible du fichier, `rotate` : rotation enregistrée dans le fichier).
 */
async function drawAnnotations(ctx: DrawContext, page: PDFPage, box: [number, number, number, number], rotate: Rotation, list: Annot[]) {
  const { L } = ctx;
  const quarter = rotate === 90 || rotate === 270;
  const hd = quarter ? box[2] - box[0] : box[3] - box[1];
  const m = displayUpMatrix(box, rotate);
  // Images chargées d'abord : les opérations de dessin restent groupées dans un même repère.
  const images = new Map<string, PDFImage>();
  for (const a of list) if (a.type === 'image' && !images.has(a.path)) images.set(a.path, await embedImage(ctx, a.path));
  page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(...m), L.setLineJoin(L.LineJoinStyle.Round));
  for (const a of list) {
    switch (a.type) {
      case 'rect':
        page.drawRectangle({ x: a.x, y: hd - a.y - a.h, width: a.w, height: a.h, color: rgbOf(L, a.color), borderWidth: 0 });
        break;
      case 'highlight':
        page.drawRectangle({
          x: a.x,
          y: hd - a.y - a.h,
          width: a.w,
          height: a.h,
          color: rgbOf(L, a.color),
          opacity: 0.4,
          blendMode: L.BlendMode.Multiply,
          borderWidth: 0,
        });
        break;
      case 'text': {
        if (!ctx.font) break;
        const { lines } = layoutText(ctx.font, a.text, a.w, a.size);
        lines.forEach((line, i) => {
          if (!line) return;
          page.drawText(line, { x: a.x, y: hd - (a.y + (i * LINE_HEIGHT + BASELINE) * a.size), size: a.size, font: ctx.font!, color: rgbOf(L, a.color) });
        });
        break;
      }
      case 'ink':
        for (const s of a.strokes) {
          const d = strokePath(s);
          if (d) page.drawSvgPath(d, { x: 0, y: hd, borderColor: rgbOf(L, a.color), borderWidth: a.width, borderLineCap: L.LineCapStyle.Round });
        }
        break;
      case 'signature':
        for (const s of a.strokes) {
          const d = strokePath(s, (x, y) => [a.x + x * a.w, a.y + y * a.h]);
          if (d)
            page.drawSvgPath(d, {
              x: 0,
              y: hd,
              borderColor: rgbOf(L, a.color),
              borderWidth: Math.max(0.3, a.width * a.h),
              borderLineCap: L.LineCapStyle.Round,
            });
        }
        break;
      case 'image': {
        const img = images.get(a.path);
        if (img) page.drawImage(img, { x: a.x, y: hd - a.y - a.h, width: a.w, height: a.h });
        break;
      }
      case 'mark':
        if (a.mark === 'dot') page.drawCircle({ x: a.x + a.size / 2, y: hd - a.y - a.size / 2, size: a.size * 0.3, color: rgbOf(L, a.color), borderWidth: 0 });
        else
          page.drawSvgPath(markPath(a.mark, a.x, a.y, a.size), {
            x: 0,
            y: hd,
            borderColor: rgbOf(L, a.color),
            borderWidth: a.size * MARK_STROKE,
            borderLineCap: L.LineCapStyle.Round,
          });
        break;
    }
  }
  page.pushOperators(L.popGraphicsState());
}

/** Page d'un fichier illisible par pdf-lib, redessinée en image (150 points par pouce). */
async function rasterPage(ctx: DrawContext, pdf: PdfDocument, index: number): Promise<{ page: PDFPage; box: [number, number, number, number] }> {
  const p = await pdf.getPage(Math.min(pdf.numPages, index + 1));
  const base = p.getViewport({ scale: 1 });
  const viewport = p.getViewport({ scale: 150 / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error(t('Page illisible.'));
  c2d.fillStyle = '#ffffff';
  c2d.fillRect(0, 0, canvas.width, canvas.height);
  await p.render({ canvasContext: c2d, canvas, viewport }).promise;
  const blob = await toBlob(canvas, 'image/jpeg', 0.88);
  canvas.width = 0;
  if (!blob) throw new Error(t('Page illisible.'));
  const img = await ctx.out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  const page = ctx.out.addPage([base.width, base.height]);
  page.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
  return { page, box: [0, 0, base.width, base.height] };
}

type PdfJs = Awaited<ReturnType<typeof loadPdfModule>>;

/** Ce dont la fabrication des pages a besoin : état du document, fichiers d'origine lus, pdf.js. */
type Env = { L: Lib; state: ProjectState; loaded: Map<string, Loaded>; pdfjs: PdfJs; rasterDocs: Map<string, PdfDocument> };

/**
 * Ajoute la page `ref` au document de `ctx`, annotations comprises (`copy` : page déjà copiée dans ce document).
 * Renvoie la page et, pour un formulaire gardé modifiable, le fichier d'origine de ses champs.
 */
async function placePage(env: Env, ctx: DrawContext, ref: PageRef, copy?: PDFPage): Promise<{ page: PDFPage; fieldsOf?: string }> {
  const { L, state, loaded } = env;
  const src = ref.src ? state.sources.get(ref.src) : undefined;
  let page: PDFPage;
  let box: [number, number, number, number];
  let rotate: Rotation = 0;
  let fieldsOf: string | undefined;
  if (!src) {
    page = ctx.out.addPage([ref.w ?? A4.w, ref.h ?? A4.h]);
    box = [0, 0, ref.w ?? A4.w, ref.h ?? A4.h];
  } else if (src.kind === 'image') {
    const size = imagePageSize(src.width ?? 1000, src.height ?? 1414, ref.crop);
    page = ctx.out.addPage([size.w, size.h]);
    const img = await embedImage(ctx, src.path);
    const c = ref.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const dw = size.w / c.w;
    const dh = size.h / c.h;
    page.drawImage(img, { x: -c.x * dw, y: size.h + c.y * dh - dh, width: dw, height: dh });
    box = [0, 0, size.w, size.h];
  } else {
    const l = loaded.get(src.id);
    const inDoc = l?.kind === 'doc' && ref.index < l.doc.getPageCount();
    if (l?.kind === 'doc' && inDoc) {
      page = ctx.out.addPage(copy ?? (await ctx.out.copyPages(l.doc, [ref.index]))[0]);
      rotate = normRotation(page.getRotation().angle);
      const cb = page.getCropBox();
      box = [cb.x, cb.y, cb.x + cb.width, cb.y + cb.height];
      if (l.keepFields) fieldsOf = src.id;
    } else if (l?.kind === 'raster') {
      let pdf = env.rasterDocs.get(src.id);
      if (!pdf) {
        pdf = await env.pdfjs.loadPdfData(l.bytes);
        env.rasterDocs.set(src.id, pdf);
      }
      ({ page, box } = await rasterPage(ctx, pdf, ref.index));
    } else {
      // Page absente du fichier (fichier remplacé ?) : page blanche plutôt qu'un échec.
      page = ctx.out.addPage([A4.w, A4.h]);
      box = [0, 0, A4.w, A4.h];
    }
  }
  page.setRotation(L.degrees((rotate + ref.rot) % 360));
  const annots = state.annotsByPage.get(ref.id);
  if (annots?.length) await drawAnnotations(ctx, page, box, rotate, annots);
  return { page, fieldsOf };
}

/**
 * Page transformée en image : fabriquée seule dans un document à part, dessinée par pdf.js (champs de formulaire et
 * annotations compris), filigrane ajouté, puis posée en JPEG dans `out`. Rien de ce qu'elle contenait d'autre
 * (texte couvert par un masque, champs) n'entre dans le fichier exporté.
 */
async function flatPage(env: Env, out: PDFDocument, ref: PageRef, raster: { dpi: number; quality: number }, watermark: string) {
  const { L } = env;
  const tmp = await L.PDFDocument.create();
  const hasText = env.state.annotsByPage.get(ref.id)?.some((a) => a.type === 'text');
  const ctx: DrawContext = { L, out: tmp, font: hasText ? await tmp.embedFont(L.StandardFonts.Helvetica) : null, images: new Map(), shrink: false };
  await placePage(env, ctx, ref);
  const pdf = await env.pdfjs.loadPdfData(await tmp.save());
  const canvas = document.createElement('canvas');
  try {
    const p = await pdf.getPage(1);
    const base = p.getViewport({ scale: 1 });
    const scale = Math.min(raster.dpi / 72, Math.sqrt(MAX_RASTER_PIXELS / Math.max(1, base.width * base.height)));
    const viewport = p.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const c2d = canvas.getContext('2d');
    if (!c2d) throw new Error(t('Page illisible.'));
    c2d.fillStyle = '#ffffff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: c2d, canvas, viewport }).promise;
    if (watermark) drawWatermark(c2d, canvas.width, canvas.height, watermark);
    const blob = await toBlob(canvas, 'image/jpeg', raster.quality);
    if (!blob) throw new Error(t('Page illisible.'));
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    out.addPage([base.width, base.height]).drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
  } finally {
    canvas.width = 0;
    env.pdfjs.closePdf(pdf);
  }
}

/** Fabrique le PDF (octets) à partir de l'état du document. */
export async function exportPdf(state: ProjectState, opts: ExportOptions = {}): Promise<Uint8Array> {
  const progress = opts.onProgress ?? (() => {});
  progress(0, t('Préparation…'));
  const L = await import('@cantoo/pdf-lib');
  const wanted = opts.pageIds ? new Set(opts.pageIds) : null;
  const refs = state.pages.filter((p) => !wanted || wanted.has(p.id));
  if (refs.length === 0) throw new Error(t('Aucune page à exporter.'));
  const size = opts.size ?? 'normal';
  const watermark = opts.watermark?.trim() ?? '';
  const flat = flattenedPages(state, { ...opts, size }, opts.pageIds);

  const out = await L.PDFDocument.create();
  if (opts.title) out.setTitle(opts.title);
  out.setCreator('Ostal');
  out.setProducer('Ostal');
  const needsFont = refs.some((r) => !flat.has(r.id) && state.annotsByPage.get(r.id)?.some((a) => a.type === 'text'));
  const ctx: DrawContext = {
    L,
    out,
    font: needsFont ? await out.embedFont(L.StandardFonts.Helvetica) : null,
    images: new Map(),
    shrink: size !== 'normal',
  };

  // Fichiers d'origine (PDF) utilisés, avec les valeurs de formulaire saisies.
  const pdfSources = [...new Set(refs.map((r) => r.src))].map((id) => state.sources.get(id)).filter((s): s is PdfSource => s?.kind === 'pdf');
  const loaded = new Map<string, Loaded>();
  const steps = pdfSources.length + refs.length + (size === 'small' ? 1 : 0);
  let step = 0;
  for (const src of pdfSources) {
    progress(step++ / steps, t('Lecture de « {name} »…', { name: src.name }));
    const values = new Map<string, FormValue>();
    const prefix = formKey(src.id, '');
    state.forms.forEach((v, k) => {
      if (k.startsWith(prefix)) values.set(k.slice(prefix.length), v);
    });
    loaded.set(src.id, await loadSource(L, src, values));
  }

  // Pages gardées telles quelles, copiées par fichier (une même page demandée deux fois est copiée deux fois). Les
  // pages transformées en images ne sont pas copiées : leur contenu n'entre pas dans le fichier.
  const copies = new Map<PageRef, PDFPage>();
  for (const [id, l] of loaded) {
    if (l.kind !== 'doc') continue;
    const count = l.doc.getPageCount();
    const mine = refs.filter((r) => r.src === id && r.index < count && !flat.has(r.id));
    const seen = new Set<number>();
    const first: PageRef[] = [];
    const again: PageRef[] = [];
    for (const r of mine) {
      (seen.has(r.index) ? again : first).push(r);
      seen.add(r.index);
    }
    const copied = await out.copyPages(
      l.doc,
      first.map((r) => r.index),
    );
    first.forEach((r, i) => copies.set(r, copied[i]));
    for (const r of again) copies.set(r, (await out.copyPages(l.doc, [r.index]))[0]);
  }

  const keptFields = new Map<string, PDFPage[]>();
  const env: Env = { L, state, loaded, pdfjs: await loadPdfModule(), rasterDocs: new Map() };
  try {
    for (const [n, ref] of refs.entries()) {
      progress(step++ / steps, t('Page {n} sur {total}…', { n: n + 1, total: refs.length }));
      if (flat.has(ref.id)) {
        await flatPage(env, out, ref, RASTER[size], watermark);
        continue;
      }
      const { page, fieldsOf } = await placePage(env, ctx, ref, copies.get(ref));
      if (fieldsOf) {
        const list = keptFields.get(fieldsOf) ?? [];
        list.push(page);
        keptFields.set(fieldsOf, list);
      }
    }
  } finally {
    env.rasterDocs.forEach((pdf) => env.pdfjs.closePdf(pdf));
  }

  for (const [id, pages] of keptFields) {
    const l = loaded.get(id);
    try {
      registerFields(L, out, pages);
      if (l?.kind === 'doc') copyFormDefaults(L, l.doc, out);
    } catch (err) {
      console.warn('PDF : champs du formulaire non repris', err);
    }
  }

  if (size === 'small') {
    progress(step++ / steps, t('Allègement des images…'));
    await shrinkPdfImages(L, out);
  }

  progress(0.98, t('Enregistrement…'));
  const bytes = await out.save({ useObjectStreams: true });
  progress(1, t('Terminé'));
  return bytes;
}
