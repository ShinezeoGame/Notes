import { t } from './i18n';
// Images importées pour les logos de page et les bannières : réduites avant l'envoi, pour rester légères partout
// (barre latérale, téléphone, pages partagées).

/** Les GIF (souvent animés) et SVG (vectoriels) sont envoyés tels quels. */
const KEEP_AS_IS = new Set(['image/gif', 'image/svg+xml']);

/**
 * Réduit l'image pour qu'elle tienne dans maxW × maxH, sans la recadrer. `opaque` : JPEG sur fond sombre (photos,
 * bannières) plutôt que PNG (logos avec transparence).
 */
export async function prepareImage(file: File, maxW: number, maxH: number, opaque: boolean): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error(t('Ce fichier n’est pas une image (JPG, PNG, WebP, GIF…).'));
  if (KEEP_AS_IS.has(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(t('Image illisible : essayez un fichier JPG, PNG ou WebP.'));
  }
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
  if (scale === 1 && file.size <= 500 * 1024) {
    bitmap.close();
    return file;
  }
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  if (opaque) {
    ctx.fillStyle = '#191919';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const type = opaque ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  if (!blob) return file;
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${base}.${opaque ? 'jpg' : 'png'}`, { type });
}

/** Image collée (Ctrl+V) ou déposée, s'il y en a une. */
export function firstImage(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) if (file.type.startsWith('image/')) return file;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/** Adresse d'image saisie à la main : http(s) uniquement. */
export function isImageLink(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}
