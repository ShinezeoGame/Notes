// Fichiers des papiers (photos, PDF) : envoyés au serveur Ostal de l'espace et relus avec la clé de l'espace (jamais
// par une adresse publique, voir server/src/papers.js). Les photos sont allégées avant l'envoi.
import { useEffect, useState } from 'react';
import { serverBase } from '../lib/api';
import { getSettings } from '../lib/settings';
import { t, tServer } from '../lib/i18n';
import type { PaperFile } from './model';

/** Plus grand côté d'une photo envoyée (lisible à l'écran et à l'impression, bien plus légère). */
const MAX_SIDE = 2400;

const auth = () => ({ 'x-ws-id': getSettings().workspaceId, 'x-ws-key': getSettings().workspaceKey });

function base(): string {
  const b = serverBase();
  if (!b) throw new Error(t('Aucun serveur configuré. Ajoutez un serveur dans les réglages.'));
  return b;
}

async function failure(res: Response): Promise<Error> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(tServer(data?.error ?? '') || t('Erreur {status}', { status: res.status }));
}

/** Photo réduite (JPEG) si elle est plus grande que nécessaire ; sinon le fichier tel quel. */
async function lighten(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
}

/** Envoie un fichier (photo allégée) ; renvoie sa description pour le papier. */
export async function uploadPaperFile(file: File): Promise<PaperFile> {
  const light = await lighten(file);
  const fd = new FormData();
  fd.append('file', light, light.name);
  let res: Response;
  try {
    res = await fetch(`${base()}/api/papers/files`, { method: 'POST', headers: auth(), body: fd });
  } catch {
    throw new Error(t('Serveur injoignable.'));
  }
  if (!res.ok) throw await failure(res);
  const data = (await res.json()) as { name: string; size: number; type: string };
  return { name: data.name, label: file.name, type: data.type, size: data.size };
}

const blobs = new Map<string, Promise<Blob>>();

/** Contenu d'un fichier (gardé le temps de la session). */
export function paperBlob(name: string): Promise<Blob> {
  let p = blobs.get(name);
  if (!p) {
    p = (async () => {
      let res: Response;
      try {
        res = await fetch(`${base()}/api/papers/files/${encodeURIComponent(name)}`, { headers: auth() });
      } catch {
        throw new Error(t('Serveur injoignable.'));
      }
      if (!res.ok) throw await failure(res);
      return res.blob();
    })();
    blobs.set(name, p);
    p.catch(() => blobs.delete(name));
  }
  return p;
}

const urls = new Map<string, string>();

/** Adresse locale (blob:) d'un fichier, pour l'afficher ; null pendant le chargement ou en cas d'erreur. */
export function usePaperFileUrl(name: string | null): { url: string | null; error: string } {
  const [state, setState] = useState<{ url: string | null; error: string }>(() => ({ url: name ? (urls.get(name) ?? null) : null, error: '' }));
  useEffect(() => {
    if (!name) return;
    const known = urls.get(name);
    if (known) {
      setState({ url: known, error: '' });
      return;
    }
    let alive = true;
    setState({ url: null, error: '' });
    paperBlob(name).then(
      (blob) => {
        const url = urls.get(name) ?? URL.createObjectURL(blob);
        urls.set(name, url);
        if (alive) setState({ url, error: '' });
      },
      (err: Error) => alive && setState({ url: null, error: err.message }),
    );
    return () => {
      alive = false;
    };
  }, [name]);
  return state;
}

export async function deletePaperFile(name: string): Promise<void> {
  blobs.delete(name);
  const url = urls.get(name);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(name);
  }
  try {
    await fetch(`${base()}/api/papers/files/${encodeURIComponent(name)}`, { method: 'DELETE', headers: auth() });
  } catch {
    /* serveur injoignable : le fichier reste sur le serveur, sans papier qui l'utilise */
  }
}

export const isImage = (f: PaperFile) => f.type.startsWith('image/');
export const isPdf = (f: PaperFile) => f.type === 'application/pdf';
