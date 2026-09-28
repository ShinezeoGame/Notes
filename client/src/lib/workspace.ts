// Arborescence des pages (titres, icônes, hiérarchie) stockée dans un document Yjs partagé.
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { newId } from './ids';

export type PageMeta = {
  id: string;
  title: string;
  icon: string;
  parentId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  deletedAt: number;
};

type PageMap = Y.Map<unknown>;

function toMeta(id: string, m: PageMap): PageMeta {
  return {
    id,
    title: String(m.get('title') ?? ''),
    icon: String(m.get('icon') ?? ''),
    parentId: String(m.get('parentId') ?? ''),
    order: Number(m.get('order') ?? 0),
    createdAt: Number(m.get('createdAt') ?? 0),
    updatedAt: Number(m.get('updatedAt') ?? 0),
    deleted: Boolean(m.get('deleted')),
    deletedAt: Number(m.get('deletedAt') ?? 0),
  };
}

export class WorkspaceStore {
  readonly doc: Y.Doc;
  readonly pages: Y.Map<PageMap>;
  private snapshot: PageMeta[] = [];
  private byId = new Map<string, PageMeta>();
  private dirty = true;
  private listeners = new Set<() => void>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.pages = doc.getMap<PageMap>('pages');
    this.pages.observeDeep(() => {
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

  getSnapshot = (): PageMeta[] => {
    if (this.dirty) this.recompute();
    return this.snapshot;
  };

  private recompute() {
    const list: PageMeta[] = [];
    this.pages.forEach((m, id) => {
      if (m instanceof Y.Map) list.push(toMeta(id, m));
    });
    list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    this.snapshot = list;
    this.byId = new Map(list.map((p) => [p.id, p]));
    this.dirty = false;
  }

  get(id: string): PageMeta | undefined {
    this.getSnapshot();
    return this.byId.get(id);
  }

  /** Une page est visible si ni elle ni aucun de ses ancêtres n'est supprimé. */
  isVisible(id: string): boolean {
    let cur = this.get(id);
    let guard = 0;
    while (cur && guard++ < 200) {
      if (cur.deleted) return false;
      if (!cur.parentId) return true;
      cur = this.get(cur.parentId);
    }
    return false;
  }

  children(parentId: string): PageMeta[] {
    return this.getSnapshot().filter((p) => p.parentId === parentId && !p.deleted && (parentId === '' || this.isVisible(parentId)));
  }

  roots(): PageMeta[] {
    return this.getSnapshot().filter((p) => p.parentId === '' && !p.deleted);
  }

  ancestors(id: string): PageMeta[] {
    const chain: PageMeta[] = [];
    let cur = this.get(id);
    let guard = 0;
    while (cur && cur.parentId && guard++ < 200) {
      cur = this.get(cur.parentId);
      if (cur) chain.unshift(cur);
    }
    return chain;
  }

  descendants(id: string): PageMeta[] {
    const out: PageMeta[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const p of this.getSnapshot()) {
        if (p.parentId === cur) {
          out.push(p);
          stack.push(p.id);
        }
      }
    }
    return out;
  }

  /** Pages supprimées de premier niveau (leur parent n'est pas lui-même supprimé). */
  trashed(): PageMeta[] {
    return this.getSnapshot()
      .filter((p) => p.deleted && (!p.parentId || !this.get(p.parentId)?.deleted))
      .sort((a, b) => b.deletedAt - a.deletedAt);
  }

  search(query: string): PageMeta[] {
    const q = query.trim().toLowerCase();
    return this.getSnapshot().filter((p) => !p.deleted && this.isVisible(p.id) && (q === '' || p.title.toLowerCase().includes(q)));
  }

  createPage(parentId = '', title = ''): string {
    const id = newId();
    const now = Date.now();
    this.doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('title', title);
      m.set('icon', '');
      m.set('parentId', parentId);
      m.set('order', now);
      m.set('createdAt', now);
      m.set('updatedAt', now);
      m.set('deleted', false);
      this.pages.set(id, m);
    }, 'local');
    return id;
  }

  update(id: string, patch: Partial<Pick<PageMeta, 'title' | 'icon' | 'parentId' | 'order'>>) {
    const m = this.pages.get(id);
    if (!m) return;
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined && m.get(k) !== v) m.set(k, v);
      }
      m.set('updatedAt', Date.now());
    }, 'local');
  }

  softDelete(id: string) {
    const m = this.pages.get(id);
    if (!m) return;
    this.doc.transact(() => {
      m.set('deleted', true);
      m.set('deletedAt', Date.now());
    }, 'local');
  }

  restore(id: string) {
    const m = this.pages.get(id);
    if (!m) return;
    this.doc.transact(() => {
      m.set('deleted', false);
      m.set('deletedAt', 0);
      const parentId = String(m.get('parentId') ?? '');
      if (parentId && !this.isVisible(parentId)) m.set('parentId', '');
      m.set('order', Date.now());
    }, 'local');
  }

  destroy(id: string) {
    const ids = [id, ...this.descendants(id).map((d) => d.id)];
    this.doc.transact(() => {
      for (const i of ids) this.pages.delete(i);
    }, 'local');
  }

  /** Déplace une page sous `parentId`, juste avant `beforeId` (ou à la fin). */
  move(id: string, parentId: string, beforeId: string | null = null) {
    if (id === parentId) return;
    if (this.descendants(id).some((d) => d.id === parentId)) return; // pas dans sa propre descendance
    const siblings = this.children(parentId).filter((p) => p.id !== id);
    let order: number;
    if (!beforeId) {
      order = siblings.length ? siblings[siblings.length - 1].order + 1000 : Date.now();
    } else {
      const idx = siblings.findIndex((p) => p.id === beforeId);
      if (idx === -1) order = Date.now();
      else {
        const next = siblings[idx].order;
        const prev = idx > 0 ? siblings[idx - 1].order : next - 2000;
        order = (prev + next) / 2;
      }
    }
    this.update(id, { parentId, order });
  }
}

export function useWorkspacePages(store: WorkspaceStore): PageMeta[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
