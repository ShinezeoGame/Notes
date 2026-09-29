// Import dans l'atelier PDF : PDF (protection retirée si besoin, avec le mot de passe demandé à l'utilisateur)
// et photos (réduites, orientation corrigée), téléversés sur le serveur.
import { api, ownerAuth } from '../lib/api';
import { newId } from '../lib/ids';
import { pageId, uploadPath, type PageRef, type PdfSource } from './model';
import { loadPdfModule } from './render';
import { decryptPdf, looksEncrypted } from './qpdf';

/** Demande le mot de passe d'un PDF protégé ; null = abandon. */
export type AskPassword = (fileName: string, wrong: boolean) => Promise<string | null>;

export type Imported = { sources: PdfSource[]; pages: PageRef[]; files: string[]; skipped: string[] };

export const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isImageFile = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(f.name);

async function upload(file: File): Promise<string> {
  return uploadPath((await api.upload(file, ownerAuth())).url);
}

/**
 * Lit un PDF ; retire sa protection au besoin (mot de passe demandé à l'utilisateur s'il en faut un pour l'ouvrir).
 * Renvoie le contenu à téléverser et son nombre de pages ; null si l'utilisateur abandonne.
 */
async function readPdf(file: File, askPassword: AskPassword): Promise<{ bytes: Uint8Array; pages: number } | null> {
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  const { loadPdfData, closePdf, pdfjs } = await loadPdfModule();
  let password: string | undefined;
  let pages = 0;
  for (;;) {
    try {
      const pdf = await loadPdfData(bytes, password);
      pages = pdf.numPages;
      closePdf(pdf);
      break;
    } catch (err) {
      if (!(err instanceof pdfjs.PasswordException)) throw new Error(`« ${file.name} » n’est pas un PDF lisible.`);
      const answer = await askPassword(file.name, err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
      if (answer === null) return null;
      password = answer;
    }
  }
  // Copie sans protection : les restrictions (impression, modification) et le mot de passe ne suivent pas.
  if (looksEncrypted(bytes)) bytes = await decryptPdf(bytes, password ?? '');
  return { bytes, pages };
}

/** Photo prête pour un PDF : orientation corrigée, grand côté limité, JPEG sur fond blanc. */
export async function preparePhoto(file: File, maxSide = 2400): Promise<{ file: File; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`« ${file.name} » : image illisible (formats acceptés : JPG, PNG, WebP).`);
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Traitement de l’image impossible sur cet appareil.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  canvas.width = 0;
  if (!blob) throw new Error('Traitement de l’image impossible sur cet appareil.');
  const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return { file: new File([blob], `${base}.jpg`, { type: 'image/jpeg' }), width, height };
}

/** Image à poser sur une page (tampon, logo, signature scannée) : transparence gardée (PNG). */
export async function prepareStamp(file: File, maxSide = 1600): Promise<{ file: File; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Image illisible (formats acceptés : JPG, PNG, WebP).');
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const jpeg = file.type === 'image/jpeg';
  if (scale === 1 && (jpeg || file.type === 'image/png') && file.size < 1.5 * 1024 * 1024) {
    bitmap.close();
    return { file, width, height };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Traitement de l’image impossible sur cet appareil.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const type = jpeg ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  canvas.width = 0;
  if (!blob) throw new Error('Traitement de l’image impossible sur cet appareil.');
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return { file: new File([blob], `${base}.${jpeg ? 'jpg' : 'png'}`, { type }), width, height };
}

/** Téléverse une image à poser sur une page ; renvoie son chemin et ses proportions. */
export async function uploadStamp(file: File): Promise<{ path: string; width: number; height: number }> {
  const prepared = await prepareStamp(file);
  return { path: await upload(prepared.file), width: prepared.width, height: prepared.height };
}

/**
 * Importe des fichiers (PDF et photos, dans l'ordre donné) : chaque PDF garde ses pages, chaque photo devient une page.
 * Les fichiers ignorés (autre format, mot de passe refusé) sont listés dans `skipped`.
 */
export async function importFiles(files: File[], opts: { askPassword: AskPassword; onProgress?: (label: string) => void }): Promise<Imported> {
  const result: Imported = { sources: [], pages: [], files: [], skipped: [] };
  for (const [i, file] of files.entries()) {
    const label = files.length > 1 ? ` (${i + 1}/${files.length})` : '';
    if (isPdfFile(file)) {
      opts.onProgress?.(`Lecture de « ${file.name} »${label}…`);
      const read = await readPdf(file, opts.askPassword);
      if (!read) {
        result.skipped.push(file.name);
        continue;
      }
      opts.onProgress?.(`Envoi de « ${file.name} »${label}…`);
      const upFile = new File([read.bytes as BlobPart], file.name, { type: 'application/pdf' });
      const path = await upload(upFile);
      const src: PdfSource = { id: newId(), kind: 'pdf', path, name: file.name, size: upFile.size, pages: read.pages };
      result.sources.push(src);
      result.files.push(path);
      for (let p = 0; p < read.pages; p++) result.pages.push({ id: pageId(), src: src.id, index: p, rot: 0 });
    } else if (isImageFile(file)) {
      opts.onProgress?.(`Préparation de « ${file.name} »${label}…`);
      const photo = await preparePhoto(file);
      opts.onProgress?.(`Envoi de « ${file.name} »${label}…`);
      const path = await upload(photo.file);
      const src: PdfSource = { id: newId(), kind: 'image', path, name: file.name, size: photo.file.size, width: photo.width, height: photo.height };
      result.sources.push(src);
      result.files.push(path);
      result.pages.push({ id: pageId(), src: src.id, index: 0, rot: 0 });
    } else {
      result.skipped.push(file.name);
    }
  }
  return result;
}
