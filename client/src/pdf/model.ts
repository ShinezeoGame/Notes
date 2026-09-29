// Atelier PDF : la bibliothèque (liste des PDF, dans le document de l'espace) et le contenu de chaque PDF
// (un document Yjs par PDF : fichiers d'origine, ordre des pages, annotations, valeurs du formulaire).
// Les fichiers d'origine restent intacts sur le serveur : le PDF modifié est fabriqué à l'export.
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { newId } from '../lib/ids';
import { serverBase } from '../lib/api';

export const pdfRoom = (wsId: string, pdfId: string) => `pdf_${wsId}_${pdfId}`;

/** Origine des modifications faites par l'utilisateur (seules celles-ci peuvent être annulées). */
export const LOCAL = 'local';

// ---------- Contenu d'un PDF ----------

export type Rotation = 0 | 90 | 180 | 270;

/** Fichier d'origine (PDF ou photo) téléversé sur le serveur. */
export type PdfSource = {
  id: string;
  kind: 'pdf' | 'image';
  /** Chemin sur le serveur (uploads/<espace>/<fichier>) : l'adresse complète suit le serveur configuré. */
  path: string;
  name: string;
  size: number;
  /** PDF : nombre de pages. */
  pages?: number;
  /** Photo : dimensions en pixels. */
  width?: number;
  height?: number;
};

/** Zone gardée d'une photo, en fractions de l'image. */
export type CropRect = { x: number; y: number; w: number; h: number };

export type PageRef = {
  id: string;
  /** Fichier d'origine ; vide pour une page blanche. */
  src: string;
  /** Page du fichier d'origine (à partir de 0). */
  index: number;
  /** Rotation ajoutée par l'utilisateur, dans le sens des aiguilles d'une montre. */
  rot: Rotation;
  /** Page blanche : taille en points. */
  w?: number;
  h?: number;
  /** Photo : partie gardée. */
  crop?: CropRect;
};

/**
 * Annotations, en points dans le repère de la page affichée (avant la rotation ajoutée par l'utilisateur) :
 * origine en haut à gauche, y vers le bas. Elles tournent avec la page.
 */
type AnnotBase = { id: string; page: string };
export type TextAnnot = AnnotBase & { type: 'text'; x: number; y: number; w: number; size: number; color: string; text: string };
export type InkAnnot = AnnotBase & { type: 'ink'; color: string; width: number; strokes: number[][] };
export type BoxAnnot = AnnotBase & { type: 'highlight' | 'rect'; x: number; y: number; w: number; h: number; color: string };
export type ImageAnnot = AnnotBase & { type: 'image'; x: number; y: number; w: number; h: number; path: string };
/** Signature dessinée : traits en fractions du cadre, épaisseur en fraction de sa hauteur. */
export type SignatureAnnot = AnnotBase & { type: 'signature'; x: number; y: number; w: number; h: number; color: string; width: number; strokes: number[][] };
export type MarkAnnot = AnnotBase & { type: 'mark'; x: number; y: number; size: number; color: string; mark: 'check' | 'cross' | 'dot' };
export type Annot = TextAnnot | InkAnnot | BoxAnnot | ImageAnnot | SignatureAnnot | MarkAnnot;

/** Valeur d'un champ de formulaire : texte, choix, ou valeur d'export de la case cochée ('' : aucune). */
export type FormValue = string | string[];

export type ProjectState = {
  sources: Map<string, PdfSource>;
  pages: PageRef[];
  annots: Annot[];
  annotsByPage: Map<string, Annot[]>;
  /** Clé : formKey(source, nom du champ). */
  forms: Map<string, FormValue>;
};

export const formKey = (src: string, field: string) => `${src}\u001f${field}`;
export const formKeySource = (key: string) => key.slice(0, key.indexOf('\u001f'));

/** Contenu complet d'un PDF (création, assemblage, extraction de pages). */
export type ProjectContent = { sources: PdfSource[]; pages: PageRef[]; annots?: Annot[]; forms?: Map<string, FormValue> };

function parse<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const ROTATIONS = new Set([0, 90, 180, 270]);
export const normRotation = (deg: number): Rotation => {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return (ROTATIONS.has(r) ? r : 0) as Rotation;
};

export class PdfProject {
  readonly doc: Y.Doc;
  readonly root: Y.Map<unknown>;
  readonly sources: Y.Map<string>;
  readonly annots: Y.Map<string>;
  readonly forms: Y.Map<string>;
  readonly undo: Y.UndoManager;
  private version = 0;
  private cached: { version: number; state: ProjectState } | null = null;
  private listeners = new Set<() => void>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.root = doc.getMap('project');
    this.sources = doc.getMap('sources');
    this.annots = doc.getMap('annots');
    this.forms = doc.getMap('forms');
    this.undo = new Y.UndoManager([this.root, this.sources, this.annots, this.forms], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 400,
    });
    doc.on('update', this.onUpdate);
    this.undo.on('stack-item-added', this.onUpdate);
    this.undo.on('stack-item-popped', this.onUpdate);
    this.undo.on('stack-cleared', this.onUpdate);
  }

  destroy() {
    this.doc.off('update', this.onUpdate);
    this.undo.destroy();
  }

  private onUpdate = () => {
    this.version++;
    this.listeners.forEach((l) => l());
  };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): ProjectState => {
    if (this.cached?.version === this.version) return this.cached.state;
    const sources = new Map<string, PdfSource>();
    this.sources.forEach((raw, id) => {
      const s = parse<PdfSource>(raw);
      if (s) sources.set(id, { ...s, id });
    });
    const pages = (parse<PageRef[]>(this.root.get('pages')) ?? []).filter((p) => p && typeof p.id === 'string');
    const annots: Annot[] = [];
    const annotsByPage = new Map<string, Annot[]>();
    this.annots.forEach((raw, id) => {
      const a = parse<Annot>(raw);
      if (!a) return;
      const annot = { ...a, id } as Annot;
      annots.push(annot);
      const list = annotsByPage.get(annot.page);
      if (list) list.push(annot);
      else annotsByPage.set(annot.page, [annot]);
    });
    // Ordre d'empilement : ordre de création (horodatage dans l'identifiant).
    const byOrder = (a: Annot, b: Annot) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    annots.sort(byOrder);
    annotsByPage.forEach((list) => list.sort(byOrder));
    const forms = new Map<string, FormValue>();
    this.forms.forEach((raw, key) => {
      const v = parse<FormValue>(raw);
      if (v !== null) forms.set(key, v);
    });
    const state = { sources, pages, annots, annotsByPage, forms };
    this.cached = { version: this.version, state };
    return state;
  };

  get canUndo() {
    return this.undo.undoStack.length > 0;
  }

  get canRedo() {
    return this.undo.redoStack.length > 0;
  }

  /** Premier remplissage (non annulable) : fichiers d'origine, pages, et éventuellement annotations et formulaire. */
  init(content: ProjectContent) {
    this.doc.transact(() => {
      for (const s of content.sources) this.sources.set(s.id, JSON.stringify(s));
      this.root.set('pages', JSON.stringify(content.pages));
      for (const a of content.annots ?? []) this.annots.set(a.id, JSON.stringify(a));
      content.forms?.forEach((v, k) => this.forms.set(k, JSON.stringify(v)));
    }, 'init');
  }

  /** Ajoute des fichiers et leurs pages, avant la page `at` (à la fin par défaut). */
  addPages(sources: PdfSource[], pages: PageRef[], at?: number) {
    this.undo.stopCapturing();
    this.doc.transact(() => {
      for (const s of sources) this.sources.set(s.id, JSON.stringify(s));
      const list = this.getSnapshot().pages.slice();
      list.splice(at ?? list.length, 0, ...pages);
      this.root.set('pages', JSON.stringify(list));
    }, LOCAL);
  }

  setPages(pages: PageRef[]) {
    this.undo.stopCapturing();
    this.doc.transact(() => {
      this.root.set('pages', JSON.stringify(pages));
      // Annotations des pages supprimées : effacées avec elles (et rétablies par « Annuler »).
      const keep = new Set(pages.map((p) => p.id));
      this.annots.forEach((raw, id) => {
        const a = parse<Annot>(raw);
        if (a && !keep.has(a.page)) this.annots.delete(id);
      });
    }, LOCAL);
  }

  /**
   * Crée ou modifie une annotation. Chaque action s'annule séparément, sauf `merge` (frappe d'un texte, regroupée
   * avec les modifications des instants précédents).
   */
  setAnnot(a: Annot, merge = false) {
    if (!merge) this.undo.stopCapturing();
    this.doc.transact(() => this.annots.set(a.id, JSON.stringify(a)), LOCAL);
  }

  removeAnnots(ids: string[]) {
    this.undo.stopCapturing();
    this.doc.transact(() => ids.forEach((id) => this.annots.delete(id)), LOCAL);
  }

  setFormValue(src: string, field: string, value: FormValue | null) {
    const key = formKey(src, field);
    this.doc.transact(() => {
      if (value === null) this.forms.delete(key);
      else this.forms.set(key, JSON.stringify(value));
    }, LOCAL);
  }
}

export function useProject(project: PdfProject): ProjectState {
  return useSyncExternalStore(project.subscribe, project.getSnapshot, project.getSnapshot);
}

let lastTime = 0;
let sequence = 0;

/** Identifiant d'annotation : croît avec le temps (ordre d'empilement), unique. */
export function annotId(): string {
  const t = Date.now();
  if (t === lastTime) sequence++;
  else {
    lastTime = t;
    sequence = 0;
  }
  return `${t.toString(36).padStart(9, '0')}${sequence.toString(36).padStart(3, '0')}-${Math.random().toString(36).slice(2, 8)}`;
}

export const pageId = () => newId();

// ---------- Bibliothèque ----------

export type PdfEntry = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Nombre de pages. */
  pages: number;
  /** Miniature de la première page (data URL). */
  thumb: string;
  /** Fichiers du serveur utilisés par ce PDF (chemins uploads/…), effacés avec lui. */
  files: string[];
  deleted: boolean;
  deletedAt: number;
};

function toEntry(id: string, m: Y.Map<unknown>): PdfEntry {
  return {
    id,
    name: String(m.get('name') ?? '') || 'Sans titre',
    createdAt: Number(m.get('createdAt') ?? 0),
    updatedAt: Number(m.get('updatedAt') ?? 0),
    pages: Number(m.get('pages') ?? 0),
    thumb: String(m.get('thumb') ?? ''),
    files: parse<string[]>(m.get('files')) ?? [],
    deleted: Boolean(m.get('deleted')),
    deletedAt: Number(m.get('deletedAt') ?? 0),
  };
}

export class PdfLibrary {
  readonly doc: Y.Doc;
  readonly map: Y.Map<Y.Map<unknown>>;
  private snapshot: PdfEntry[] = [];
  private dirty = true;
  private listeners = new Set<() => void>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.map = doc.getMap('pdfs');
    this.map.observeDeep(() => {
      this.dirty = true;
      this.listeners.forEach((l) => l());
    });
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Tous les PDF (y compris ceux en cours de suppression), du plus récent au plus ancien. */
  getSnapshot = (): PdfEntry[] => {
    if (this.dirty) {
      const list: PdfEntry[] = [];
      this.map.forEach((m, id) => {
        if (m instanceof Y.Map) list.push(toEntry(id, m));
      });
      list.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
      this.snapshot = list;
      this.dirty = false;
    }
    return this.snapshot;
  };

  get(id: string): PdfEntry | undefined {
    return this.getSnapshot().find((e) => e.id === id);
  }

  create(name: string, files: string[], pages: number, thumb = ''): string {
    const id = newId();
    const now = Date.now();
    this.doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('name', name);
      m.set('createdAt', now);
      m.set('updatedAt', now);
      m.set('pages', pages);
      m.set('thumb', thumb);
      m.set('files', JSON.stringify([...new Set(files)]));
      m.set('deleted', false);
      this.map.set(id, m);
    }, LOCAL);
    return id;
  }

  update(id: string, patch: Partial<Pick<PdfEntry, 'name' | 'pages' | 'thumb'>>) {
    const m = this.map.get(id);
    if (!m) return;
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined && m.get(k) !== v) m.set(k, v);
      m.set('updatedAt', Date.now());
    }, LOCAL);
  }

  addFiles(id: string, files: string[]) {
    const m = this.map.get(id);
    if (!m || files.length === 0) return;
    const current = parse<string[]>(m.get('files')) ?? [];
    const next = [...new Set([...current, ...files])];
    if (next.length !== current.length) this.doc.transact(() => m.set('files', JSON.stringify(next)), LOCAL);
  }

  setDeleted(id: string, deleted: boolean) {
    const m = this.map.get(id);
    if (!m) return;
    this.doc.transact(() => {
      m.set('deleted', deleted);
      m.set('deletedAt', deleted ? Date.now() : 0);
    }, LOCAL);
  }

  remove(id: string) {
    this.doc.transact(() => this.map.delete(id), LOCAL);
  }

  /** Fichiers encore utilisés par les autres PDF. */
  filesUsedByOthers(id: string): Set<string> {
    const used = new Set<string>();
    for (const e of this.getSnapshot()) if (e.id !== id) e.files.forEach((f) => used.add(f));
    return used;
  }
}

export function useLibrary(lib: PdfLibrary): PdfEntry[] {
  return useSyncExternalStore(lib.subscribe, lib.getSnapshot, lib.getSnapshot);
}

// ---------- Fichiers du serveur ----------

/** Chemin (uploads/…) d'une adresse de fichier renvoyée par le serveur. */
export function uploadPath(url: string): string {
  const m = /\/(uploads\/[^?#]+)$/.exec(url);
  return m ? decodeURI(m[1]) : url;
}

/** Adresse d'un fichier du serveur à partir de son chemin (suit le serveur configuré). */
export function fileUrl(path: string): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const base = serverBase() ?? '';
  return `${base}/${path.replace(/^\/+/, '')}`;
}
