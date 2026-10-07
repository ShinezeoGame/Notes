// Papiers de la maison : photos et PDF des documents (carte d'identité, carte grise, contrats…). Rangés à part des
// autres fichiers (DATA_DIR/papers/<espace>) et servis seulement aux appareils de l'espace (clé de l'espace exigée),
// jamais par une adresse publique. La liste des papiers vit dans le document de l'espace (map « papers »).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, isValidId } from './store.js';

export const PAPERS_DIR = path.join(DATA_DIR, 'papers');

/** Noms donnés par safeUploadName (store.js). */
const NAME_RE = /^[a-z0-9]{1,16}-[a-f0-9]{16}(\.[a-z0-9]{1,8})?$/;

export function papersDirFor(wsId) {
  const dir = path.join(PAPERS_DIR, wsId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Chemin d'un fichier de papier de l'espace ; null pour un nom inattendu. */
export function paperFile(wsId, name) {
  if (!isValidId(wsId) || !NAME_RE.test(String(name || ''))) return null;
  return path.join(PAPERS_DIR, wsId, name);
}

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif', pdf: 'application/pdf' };

/** Type d'un fichier d'après son extension. */
export const paperType = (name) => TYPES[path.extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream';

/** Supprime tous les papiers d'un espace (espace retiré). */
export async function removeAllPapers(wsId) {
  if (!isValidId(wsId)) return;
  await fsp.rm(path.join(PAPERS_DIR, wsId), { recursive: true, force: true });
}
