import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import type { Auth } from './api';
import { acquireDoc, releaseDoc, type DocHandle } from './yjs';

export function useDocHandle(room: string | null, auth: Auth, persist: boolean) {
  const [state, setState] = useState<{ handle: DocHandle | null; ready: boolean }>({ handle: null, ready: false });
  const authKey = 'share' in auth ? `share:${auth.share}` : `key:${auth.key}`;
  useEffect(() => {
    if (!room) {
      setState({ handle: null, ready: false });
      return;
    }
    const h = acquireDoc(room, { auth, persist });
    let cancelled = false;
    setState({ handle: h, ready: false });
    h.ready.then(() => {
      if (!cancelled) setState({ handle: h, ready: true });
    });
    return () => {
      cancelled = true;
      releaseDoc(room);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, authKey, persist]);
  return state;
}

export type PageDocMeta = { title: string; icon: string; narrow: boolean; cover: string; coverY: number };

/** Observe la carte `meta` (titre, icône, largeur, bannière) d'un document de page. */
export function usePageMeta(doc: Y.Doc | null): PageDocMeta {
  const read = (): PageDocMeta => {
    if (!doc) return { title: '', icon: '', narrow: false, cover: '', coverY: 50 };
    const m = doc.getMap('meta');
    const y = Number(m.get('coverY'));
    return {
      title: String(m.get('title') ?? ''),
      icon: String(m.get('icon') ?? ''),
      narrow: Boolean(m.get('narrow')),
      cover: String(m.get('cover') ?? ''),
      coverY: Number.isFinite(y) && m.has('coverY') ? Math.min(100, Math.max(0, y)) : 50,
    };
  };
  const [meta, setMeta] = useState(read);
  useEffect(() => {
    if (!doc) return;
    const m = doc.getMap('meta');
    const handler = () => setMeta(read());
    m.observe(handler);
    handler();
    return () => m.unobserve(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  return meta;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = () => setMatches(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
