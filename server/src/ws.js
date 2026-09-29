// Serveur de synchronisation Yjs (protocole compatible y-websocket) avec contrôle d'accès,
// mode lecture seule, persistance sur disque et miroir des titres de pages vers l'arborescence.
import crypto from 'node:crypto';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { loadDocUpdate, saveDocUpdate, removeDocFile, authorizeWorkspace, getShare } from './store.js';

const messageSync = 0;
const messageAwareness = 1;
const PING_INTERVAL = 30_000;
const SAVE_DEBOUNCE = 1_000;
const UNLOAD_AFTER_IDLE = 90_000;

const WS_ROOM_RE = /^ws_([A-Za-z0-9_-]{6,80})$/;
const PG_ROOM_RE = /^pg_([A-Za-z0-9_-]{6,80})_([A-Za-z0-9_-]{6,80})$/;
const PDF_ROOM_RE = /^pdf_([A-Za-z0-9_-]{6,80})_([A-Za-z0-9_-]{6,80})$/;

export const wsRoom = (wsId) => `ws_${wsId}`;
export const pgRoom = (wsId, pageId) => `pg_${wsId}_${pageId}`;
/** Document d'un PDF de l'atelier PDF (pages, annotations, formulaire). */
export const pdfRoom = (wsId, pdfId) => `pdf_${wsId}_${pdfId}`;

/** room -> WSSharedDoc */
export const docs = new Map();

class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: true });
    this.name = name;
    /** @type {Map<import('ws').WebSocket, Set<number>>} */
    this.conns = new Map();
    this.lastActivity = Date.now();
    this.dirty = false;
    this.saveTimer = null;
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    this.awareness.on('update', ({ added, updated, removed }, conn) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const controlled = this.conns.get(conn);
        if (controlled) {
          added.forEach((id) => controlled.add(id));
          removed.forEach((id) => controlled.delete(id));
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      );
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => send(this, c, buff));
    });

    this.on('update', (update, origin) => {
      this.lastActivity = Date.now();
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn) => send(this, conn, message));
      if (origin !== 'load') this.scheduleSave();
    });

    this.whenLoaded = loadDocUpdate(name)
      .then((u) => {
        if (u) Y.applyUpdate(this, u, 'load');
      })
      .catch((err) => console.error(`[ws] chargement impossible de ${name}:`, err));
  }

  scheduleSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    if (!this.dirty) return;
    this.dirty = false;
    this.saving = saveDocUpdate(this.name, Y.encodeStateAsUpdate(this));
    try {
      await this.saving;
    } catch (err) {
      this.dirty = true;
      console.error(`[ws] sauvegarde impossible de ${this.name}:`, err);
    } finally {
      this.saving = null;
    }
  }
}

export function getDoc(room) {
  let doc = docs.get(room);
  if (!doc) {
    doc = new WSSharedDoc(room);
    docs.set(room, doc);
    if (PG_ROOM_RE.test(room)) attachMetaMirror(doc);
  }
  doc.lastActivity = Date.now();
  return doc;
}

/**
 * Quand le titre/l'icône d'une page change dans son document (ex. modifié par un invité),
 * on répercute la valeur dans l'arborescence de l'espace de travail.
 */
function attachMetaMirror(pageDoc) {
  const m = PG_ROOM_RE.exec(pageDoc.name);
  if (!m) return;
  const [, wsId, pageId] = m;
  const meta = pageDoc.getMap('meta');
  meta.observe((event, tr) => {
    if (tr.origin === 'load') return;
    const keys = ['title', 'icon'].filter((k) => event.keysChanged.has(k));
    if (keys.length === 0) return;
    const wsDoc = getDoc(wsRoom(wsId));
    wsDoc.whenLoaded.then(() => {
      const entry = wsDoc.getMap('pages').get(pageId);
      if (!(entry instanceof Y.Map)) return;
      wsDoc.transact(() => {
        let changed = false;
        for (const k of keys) {
          const v = meta.get(k);
          if (typeof v === 'string' && entry.get(k) !== v) {
            entry.set(k, v);
            changed = true;
          }
        }
        if (changed) entry.set('updatedAt', Date.now());
      }, 'mirror');
    });
  });
}

function send(doc, conn, message) {
  if (conn.readyState !== 0 && conn.readyState !== 1) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(message, (err) => err != null && closeConn(doc, conn));
  } catch {
    closeConn(doc, conn);
  }
}

function closeConn(doc, conn) {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    doc.lastActivity = Date.now();
  }
  try {
    conn.close();
  } catch {
    /* ignore */
  }
}

function messageListener(conn, doc, message, readOnly) {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync: {
        encoding.writeVarUint(encoder, messageSync);
        if (readOnly) {
          // Un lecteur peut demander l'état (étape 1) mais ses modifications sont ignorées.
          const syncType = decoding.readVarUint(decoder);
          if (syncType !== syncProtocol.messageYjsSyncStep1) return;
          syncProtocol.readSyncStep1(decoder, encoder, doc);
        } else {
          syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        }
        if (encoding.length(encoder) > 1) send(doc, conn, encoding.toUint8Array(encoder));
        break;
      }
      case messageAwareness:
        awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('[ws] message invalide:', err);
  }
}

/**
 * Attache une connexion WebSocket (déjà autorisée) à une salle.
 */
export async function setupWSConnection(conn, room, { readOnly = false } = {}) {
  conn.binaryType = 'arraybuffer';
  const doc = getDoc(room);
  doc.conns.set(conn, new Set());

  let loaded = false;
  const queue = [];
  conn.on('message', (data) => {
    const u8 = new Uint8Array(data);
    if (!loaded) queue.push(u8);
    else messageListener(conn, doc, u8, readOnly);
  });

  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) closeConn(doc, conn);
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, PING_INTERVAL);
  conn.on('close', () => {
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });
  conn.on('pong', () => {
    pongReceived = true;
  });

  await doc.whenLoaded;
  if (!doc.conns.has(conn)) return; // fermée pendant le chargement
  loaded = true;

  {
    // Étape 1 : demander au client ses modifications (sauf lecteur) puis envoyer notre état.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    if (readOnly) {
      syncProtocol.writeSyncStep2(encoder, doc);
    } else {
      syncProtocol.writeSyncStep1(encoder, doc);
    }
    send(doc, conn, encoding.toUint8Array(encoder));

    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageAwareness);
      encoding.writeVarUint8Array(
        enc,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())),
      );
      send(doc, conn, encoding.toUint8Array(enc));
    }
  }
  for (const m of queue) messageListener(conn, doc, m, readOnly);
}

// ---------- Autorisation ----------

/**
 * Vérifie qu'une page appartient au sous-arbre partagé (et qu'aucun ancêtre n'est supprimé).
 */
export async function pageInShare(share, pageId) {
  const wsDoc = getDoc(wsRoom(share.wsId));
  await wsDoc.whenLoaded;
  const pages = wsDoc.getMap('pages');
  let current = pageId;
  for (let depth = 0; depth < 200 && current; depth++) {
    const entry = pages.get(current);
    if (!(entry instanceof Y.Map)) return false;
    if (entry.get('deleted')) return false;
    if (current === share.pageId) return true;
    current = entry.get('parentId') || '';
  }
  return false;
}

/**
 * @returns {Promise<{ok: true, readOnly: boolean, wsId: string} | {ok: false, reason: string}>}
 */
export async function authorizeRoom(room, { key, share }) {
  const mWs = WS_ROOM_RE.exec(room);
  if (mWs) {
    if (key && authorizeWorkspace(mWs[1], key)) return { ok: true, readOnly: false, wsId: mWs[1] };
    return { ok: false, reason: 'unauthorized' };
  }
  const mPdf = PDF_ROOM_RE.exec(room);
  if (mPdf) {
    // Atelier PDF : réservé au propriétaire de l'espace, jamais accessible par un lien de partage.
    if (key && authorizeWorkspace(mPdf[1], key)) return { ok: true, readOnly: false, wsId: mPdf[1] };
    return { ok: false, reason: 'unauthorized' };
  }
  const mPg = PG_ROOM_RE.exec(room);
  if (mPg) {
    const [, wsId, pageId] = mPg;
    if (key && authorizeWorkspace(wsId, key)) return { ok: true, readOnly: false, wsId };
    if (share) {
      const s = getShare(share);
      if (s && s.wsId === wsId && (await pageInShare(s, pageId))) {
        return { ok: true, readOnly: s.mode !== 'edit', wsId };
      }
    }
    return { ok: false, reason: 'unauthorized' };
  }
  return { ok: false, reason: 'unknown-room' };
}

/** Sous-arbre (non supprimé) d'un partage, pour l'affichage côté invité. */
export async function shareTree(share) {
  const wsDoc = getDoc(wsRoom(share.wsId));
  await wsDoc.whenLoaded;
  const pages = wsDoc.getMap('pages');
  const root = pages.get(share.pageId);
  if (!(root instanceof Y.Map) || root.get('deleted')) return null;
  if (!(await pageInShare(share, share.pageId))) return null;
  const byParent = new Map();
  pages.forEach((entry, id) => {
    if (!(entry instanceof Y.Map) || entry.get('deleted')) return;
    const parentId = entry.get('parentId') || '';
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push({
      id,
      title: entry.get('title') || '',
      icon: entry.get('icon') || '',
      parentId,
      order: Number(entry.get('order')) || 0,
    });
  });
  const result = [];
  const stack = [share.pageId];
  while (stack.length) {
    const id = stack.pop();
    const entry = pages.get(id);
    result.push({
      id,
      title: entry.get('title') || '',
      icon: entry.get('icon') || '',
      parentId: id === share.pageId ? '' : entry.get('parentId') || '',
      order: Number(entry.get('order')) || 0,
    });
    for (const child of byParent.get(id) || []) stack.push(child.id);
  }
  return result;
}

/** Crée une page dans l'arborescence côté serveur (utilisé pour les invités). */
export function createPageInWorkspace(wsId, parentId, title) {
  const wsDoc = getDoc(wsRoom(wsId));
  const id = crypto.randomUUID();
  const now = Date.now();
  wsDoc.transact(() => {
    const m = new Y.Map();
    m.set('title', title);
    m.set('icon', '');
    m.set('parentId', parentId);
    m.set('order', now);
    m.set('createdAt', now);
    m.set('updatedAt', now);
    m.set('deleted', false);
    wsDoc.getMap('pages').set(id, m);
  }, 'server');
  return id;
}

// ---------- Entretien ----------

setInterval(() => {
  const now = Date.now();
  for (const [room, doc] of docs) {
    if (doc.conns.size === 0 && now - doc.lastActivity > UNLOAD_AFTER_IDLE && !doc.dirty) {
      docs.delete(room);
      doc.destroy();
    }
  }
}, 30_000).unref();

/** Supprime définitivement un document : connexions fermées, version en mémoire oubliée, fichier effacé. */
export async function deleteDoc(room) {
  const doc = docs.get(room);
  if (doc) {
    clearTimeout(doc.saveTimer);
    doc.dirty = false;
    for (const conn of Array.from(doc.conns.keys())) closeConn(doc, conn);
    docs.delete(room);
    // Une sauvegarde en cours recréerait le fichier après sa suppression.
    await doc.saving?.catch(() => {});
    doc.destroy();
  }
  await removeDocFile(room);
}

export async function flushAll() {
  await Promise.all(Array.from(docs.values()).map((d) => d.flush()));
}
