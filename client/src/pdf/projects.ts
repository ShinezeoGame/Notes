// Opérations sur les PDF de la bibliothèque hors de l'éditeur : création, assemblage, extraction de pages,
// miniature, suppression définitive.
import { api, ownerAuth } from '../lib/api';
import { getSettings } from '../lib/settings';
import { acquireDoc, releaseDoc, type DocHandle } from '../lib/yjs';
import {
  annotId,
  formKeySource,
  pageId,
  pdfRoom,
  PdfProject,
  type Annot,
  type FormValue,
  type PageRef,
  type PdfLibrary,
  type PdfSource,
  type ProjectContent,
  type ProjectState,
} from './model';
import { SourceCache, thumbnail } from './render';

const room = (id: string) => pdfRoom(getSettings().workspaceId, id);

/** Attend le contenu d'un document jamais ouvert sur cet appareil (première synchronisation avec le serveur). */
async function waitForContent(handle: DocHandle, timeout = 15_000) {
  const hasPages = () => handle.doc.getMap('project').has('pages');
  if (hasPages() || !handle.provider) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      handle.doc.off('update', check);
      resolve();
    };
    const check = () => hasPages() && done();
    const timer = setTimeout(done, timeout);
    handle.doc.on('update', check);
  });
}

/** Ouvre le document d'un PDF le temps d'une opération (`fresh` : document qu'on vient de créer). */
export async function withProject<T>(id: string, fn: (project: PdfProject) => T | Promise<T>, fresh = false): Promise<T> {
  const r = room(id);
  const handle = acquireDoc(r, { auth: ownerAuth(), persist: true });
  try {
    await handle.ready;
    if (!fresh) await waitForContent(handle);
    const project = new PdfProject(handle.doc);
    try {
      return await fn(project);
    } finally {
      project.destroy();
    }
  } finally {
    releaseDoc(r);
  }
}

/** Contenu d'un PDF à lire (erreur claire s'il n'est pas disponible). */
export async function readProject(id: string): Promise<ProjectState> {
  const state = await withProject(id, (p) => p.getSnapshot());
  if (state.pages.length === 0) throw new Error('Ce PDF n’est pas encore disponible sur cet appareil : vérifiez la connexion au serveur.');
  return state;
}

/** Crée un PDF dans la bibliothèque avec ce contenu ; renvoie son identifiant. */
export async function createProject(library: PdfLibrary, name: string, content: ProjectContent, files: string[]): Promise<string> {
  const id = library.create(name, files, content.pages.length);
  await withProject(id, (p) => p.init(content), true);
  void refreshThumbnail(library, id, content);
  return id;
}

/** Copie de pages (nouveaux identifiants), avec leurs annotations et les valeurs de formulaire de leurs fichiers. */
export function copyContent(parts: { state: ProjectState; pageIds?: string[] }[]): Required<ProjectContent> {
  const sources = new Map<string, PdfSource>();
  const pages: PageRef[] = [];
  const annots: Annot[] = [];
  const forms = new Map<string, FormValue>();
  for (const { state, pageIds } of parts) {
    const wanted = pageIds ? new Set(pageIds) : null;
    for (const ref of state.pages) {
      if (wanted && !wanted.has(ref.id)) continue;
      const id = pageId();
      pages.push({ ...ref, id });
      const src = ref.src ? state.sources.get(ref.src) : undefined;
      if (src) sources.set(src.id, src);
      for (const a of state.annotsByPage.get(ref.id) ?? []) annots.push({ ...a, id: annotId(), page: id });
    }
    state.forms.forEach((v, k) => {
      if (sources.has(formKeySource(k))) forms.set(k, v);
    });
  }
  return { sources: [...sources.values()], pages, annots, forms };
}

/** Assemble plusieurs PDF (dans l'ordre donné) en un nouveau. */
export async function mergeProjects(library: PdfLibrary, ids: string[], name: string): Promise<string> {
  const parts: { state: ProjectState }[] = [];
  const files: string[] = [];
  for (const id of ids) {
    parts.push({ state: await readProject(id) });
    files.push(...(library.get(id)?.files ?? []));
  }
  return createProject(library, name, copyContent(parts), files);
}

/** Miniature de la première page, pour la bibliothèque. */
export async function refreshThumbnail(library: PdfLibrary, id: string, content?: Pick<ProjectContent, 'sources' | 'pages'>) {
  const cache = new SourceCache();
  try {
    let first: PageRef | undefined;
    let src: PdfSource | undefined;
    if (content) {
      first = content.pages[0];
      src = content.sources.find((s) => s.id === first?.src);
    } else {
      const state = await withProject(id, (p) => p.getSnapshot());
      first = state.pages[0];
      src = first?.src ? state.sources.get(first.src) : undefined;
    }
    if (!first) return;
    library.update(id, { thumb: await thumbnail(cache, first, src) });
  } catch (err) {
    console.warn('PDF : miniature impossible', err);
  } finally {
    cache.destroy();
  }
}

/** Efface les données locales (IndexedDB) d'un document. */
function forgetLocal(roomName: string) {
  try {
    indexedDB.deleteDatabase(`notes:${roomName}`);
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Suppression définitive (après le délai d'annulation) : document et fichiers du serveur que ce PDF était seul
 * à utiliser, puis retrait de la bibliothèque.
 */
export async function purgeProject(library: PdfLibrary, id: string) {
  const entry = library.get(id);
  if (!entry) return;
  const others = library.filesUsedByOthers(id);
  await api.deletePdf(
    id,
    entry.files.filter((f) => !others.has(f)),
  );
  library.remove(id);
  forgetLocal(room(id));
}

/** Supprime les PDF mis à la corbeille depuis plus de `delay` ms (suppression interrompue par une fermeture). */
export function purgeStale(library: PdfLibrary, delay = 15_000) {
  const now = Date.now();
  for (const e of library.getSnapshot()) {
    if (e.deleted && now - e.deletedAt > delay) void purgeProject(library, e.id).catch((err) => console.warn('PDF : suppression différée', err));
  }
}
