// Enregistrer ou partager un fichier fabriqué par la page (PDF exporté, tableur .xlsx ou .csv), selon l'appareil :
// - application Android : plugin natif NotesFiles (« Enregistrer » avec choix du dossier, « Partager » vers une
//   autre application) ; ancienne version de l'application : le fichier s'ouvre dans le navigateur du téléphone ;
// - ordinateur (Chrome, Edge) : fenêtre « Enregistrer sous » ; autres navigateurs : téléchargement ;
// - navigateur du téléphone : partage du fichier quand le navigateur le permet.
import { api, ownerAuth } from '../lib/api';
import { callNative, hasNativePlugin } from '../lib/native';
import { isNative } from '../lib/settings';
import { t } from '../lib/i18n';

const NATIVE = 'NotesFiles';
const CHUNK = 512 * 1024;

export type SaveMode = 'native' | 'legacy-app' | 'picker' | 'download';

export function saveMode(): SaveMode {
  if (isNative()) return hasNativePlugin(NATIVE) ? 'native' : 'legacy-app';
  return 'showSaveFilePicker' in window && window.self === window.top ? 'picker' : 'download';
}

/** Libellé du bouton principal. */
export function saveLabel(mode: SaveMode = saveMode()): string {
  switch (mode) {
    case 'native':
    case 'picker':
      return t('Enregistrer…');
    case 'legacy-app':
      return t('Ouvrir le PDF');
    default:
      return t('Télécharger');
  }
}

/** Type de fichier : type MIME, extension et description (fenêtre « Enregistrer sous »). */
export type FileKind = { mime: string; ext: string; description: string };

export const PDF_MIME = 'application/pdf';
export const pdfKind = (): FileKind => ({ mime: PDF_MIME, ext: '.pdf', description: t('Document PDF') });

const asFile = (bytes: Uint8Array, name: string, mime = PDF_MIME) => new File([bytes as BlobPart], name, { type: mime });

/** Partage possible (application Android récente, ou navigateur compatible). */
export function canShare(bytes?: Uint8Array): boolean {
  if (isNative()) return hasNativePlugin(NATIVE);
  if (typeof navigator.canShare !== 'function' || !window.matchMedia('(pointer: coarse)').matches) return false;
  try {
    return navigator.canShare({ files: [asFile(bytes ?? new Uint8Array([37, 80, 68, 70]), 'test.pdf')] });
  } catch {
    return false;
  }
}

function base64(chunk: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([chunk as BlobPart]));
  });
}

/** Transmet le fichier à l'application Android (par morceaux) ; renvoie son identifiant côté natif. */
async function toNative(bytes: Uint8Array, name: string, mime: string): Promise<string> {
  const { id } = await callNative<{ id: string }>(NATIVE, 'begin', { name, mime });
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    await callNative(NATIVE, 'append', { id, data: await base64(bytes.subarray(offset, offset + CHUNK)) });
  }
  return id;
}

function download(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(asFile(bytes, name, mime));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type SavePicker = (opts: object) => Promise<{ createWritable: () => Promise<{ write: (d: BlobPart) => Promise<void>; close: () => Promise<void> }> }>;

/** Enregistre le fichier ; renvoie ce qui s'est passé (message à afficher). */
export async function saveFile(
  bytes: Uint8Array,
  name: string,
  kind: FileKind = pdfKind(),
): Promise<'saved' | 'downloaded' | 'opened' | 'cancelled'> {
  const mode = saveMode();
  if (mode === 'native') {
    const id = await toNative(bytes, name, kind.mime);
    const { saved } = await callNative<{ saved: boolean }>(NATIVE, 'save', { id });
    return saved ? 'saved' : 'cancelled';
  }
  if (mode === 'legacy-app') {
    // Ancienne application (sans enregistrement natif) : fichier déposé sur le serveur puis ouvert dans le navigateur.
    const { url } = await api.upload(asFile(bytes, name, kind.mime), ownerAuth());
    window.open(url, '_blank');
    return 'opened';
  }
  if (mode === 'picker') {
    try {
      const handle = await (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker({
        suggestedName: name,
        types: [{ description: kind.description, accept: { [kind.mime]: [kind.ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes as BlobPart);
      await writable.close();
      return 'saved';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
      console.warn('Enregistrer sous indisponible, téléchargement', err);
    }
  }
  download(bytes, name, kind.mime);
  return 'downloaded';
}

/** Partage le fichier vers une autre application (messagerie, e-mail…). */
export async function shareFile(bytes: Uint8Array, name: string, mime = PDF_MIME): Promise<'shared' | 'cancelled'> {
  if (isNative()) {
    const id = await toNative(bytes, name, mime);
    await callNative(NATIVE, 'share', { id, title: name });
    return 'shared';
  }
  try {
    await navigator.share({ files: [asFile(bytes, name, mime)], title: name });
    return 'shared';
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

/** Nom de fichier propre, terminé par .pdf. */
export function pdfFileName(name: string): string {
  const base =
    (name || t('Document'))
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .trim() || t('Document');
  return `${base.slice(0, 120)}.pdf`;
}
