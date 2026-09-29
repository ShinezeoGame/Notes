// Gestion des documents Yjs : un document par page + un document pour l'arborescence.
// Chaque document est persisté localement (IndexedDB) et synchronisé avec le serveur si configuré.
import { useCallback, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { wsBase, type Auth } from './api';

export const wsRoom = (wsId: string) => `ws_${wsId}`;
export const pgRoom = (wsId: string, pageId: string) => `pg_${wsId}_${pageId}`;

export type ConnStatus = 'offline' | 'connecting' | 'connected' | 'disconnected' | 'denied' | 'outdated';

/**
 * Version du format des pages que ce client sait lire, envoyée au serveur. Une version plus ancienne effacerait les
 * blocs qu'elle ne connaît pas (colonnes depuis la version 2, caméras depuis la 3) : le serveur ne la synchronise donc
 * plus. À augmenter avec MIN_PAGE_SCHEMA (server/src/ws.js) à chaque nouveau type de bloc.
 */
export const DOC_SCHEMA = 3;

export type DocHandle = {
  room: string;
  doc: Y.Doc;
  idb: IndexeddbPersistence | null;
  provider: WebsocketProvider | null;
  /** Résolu quand le contenu local est chargé et que la première synchro serveur est faite (ou a expiré). */
  ready: Promise<void>;
  refs: number;
  destroyTimer: ReturnType<typeof setTimeout> | null;
  status: ConnStatus;
  listeners: Set<() => void>;
};

const handles = new Map<string, DocHandle>();
const DESTROY_DELAY = 20_000;
const FIRST_SYNC_TIMEOUT = 3_000;

function setStatus(h: DocHandle, status: ConnStatus) {
  if (h.status === status) return;
  h.status = status;
  h.listeners.forEach((l) => l());
}

function waitFirstSync(provider: WebsocketProvider, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if (provider.synced) return resolve();
    const done = () => {
      clearTimeout(timer);
      provider.off('sync', onSync);
      resolve();
    };
    const onSync = (isSynced: boolean) => {
      if (isSynced) done();
    };
    const timer = setTimeout(done, timeout);
    provider.on('sync', onSync);
  });
}

export function acquireDoc(room: string, opts: { auth: Auth; persist: boolean }): DocHandle {
  const existing = handles.get(room);
  if (existing) {
    existing.refs++;
    if (existing.destroyTimer) {
      clearTimeout(existing.destroyTimer);
      existing.destroyTimer = null;
    }
    return existing;
  }
  const doc = new Y.Doc();
  const idb = opts.persist ? new IndexeddbPersistence(`notes:${room}`, doc) : null;
  const base = wsBase();
  let provider: WebsocketProvider | null = null;
  const handle: DocHandle = {
    room,
    doc,
    idb,
    provider: null,
    ready: Promise.resolve(),
    refs: 1,
    destroyTimer: null,
    status: base ? 'connecting' : 'offline',
    listeners: new Set(),
  };
  if (base) {
    provider = new WebsocketProvider(base, room, doc, {
      params: { ...(opts.auth as unknown as Record<string, string>), schema: String(DOC_SCHEMA) },
      maxBackoffTime: 15_000,
    });
    provider.on('status', ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      if (handle.status !== 'denied' && handle.status !== 'outdated') setStatus(handle, status);
    });
    provider.on('connection-close', (event: CloseEvent | null) => {
      if (event && event.code === 4401) {
        setStatus(handle, 'denied');
      } else if (event && event.code === 4426) {
        // Serveur plus récent : ce client doit être mis à jour avant de synchroniser cette page.
        setStatus(handle, 'outdated');
      }
    });
    handle.provider = provider;
  }
  const waits: Promise<unknown>[] = [];
  if (idb) waits.push(idb.whenSynced.catch(() => undefined));
  if (provider) waits.push(waitFirstSync(provider, FIRST_SYNC_TIMEOUT));
  handle.ready = Promise.all(waits).then(() => undefined);
  handles.set(room, handle);
  return handle;
}

export function releaseDoc(room: string) {
  const h = handles.get(room);
  if (!h) return;
  h.refs = Math.max(0, h.refs - 1);
  if (h.refs === 0 && !h.destroyTimer) {
    h.destroyTimer = setTimeout(() => {
      handles.delete(room);
      h.provider?.destroy();
      h.idb?.destroy();
      h.doc.destroy();
    }, DESTROY_DELAY);
  }
}

export function useDocStatus(handle: DocHandle | null): ConnStatus {
  const subscribe = useCallback(
    (fn: () => void) => {
      if (!handle) return () => {};
      handle.listeners.add(fn);
      return () => {
        handle.listeners.delete(fn);
      };
    },
    [handle],
  );
  const get = useCallback(() => (handle ? handle.status : 'offline'), [handle]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Supprime toutes les données locales (IndexedDB) de l'application. */
export async function clearLocalDocs(): Promise<void> {
  for (const h of handles.values()) {
    h.provider?.destroy();
    h.idb?.destroy();
    h.doc.destroy();
  }
  handles.clear();
  if ('databases' in indexedDB) {
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs
        .filter((d) => d.name?.startsWith('notes:'))
        .map(
          (d) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(d.name!);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            }),
        ),
    );
  }
}
