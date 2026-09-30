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

/** Taille de l'icône en haut de page et hauteur de la bannière, en px. */
export const ICON_SIZE_RANGE = { min: 32, max: 200, default: 64 } as const;
export const COVER_HEIGHT_RANGE = { min: 100, max: 600 } as const;

/** Nombre dans l'intervalle, sinon 0 (valeur par défaut). */
function sizeIn(v: unknown, range: { min: number; max: number }): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(Math.min(range.max, Math.max(range.min, n))) : 0;
}

export type PageDocMeta = {
  title: string;
  icon: string;
  narrow: boolean;
  cover: string;
  coverY: number;
  /** Image d'origine et recadrage de l'icône (JSON), pour la recadrer à nouveau. */
  iconSource: string;
  /** Image d'origine et recadrage de la bannière (JSON), pour la recadrer de nouveau. */
  coverSource: string;
  /** Taille de l'icône en haut de la page (px) ; 0 = taille par défaut. */
  iconSize: number;
  /** Hauteur de la bannière (px) ; 0 = hauteur automatique. */
  coverHeight: number;
};

/** Observe la carte `meta` (titre, icône, largeur, bannière) d'un document de page. */
export function usePageMeta(doc: Y.Doc | null): PageDocMeta {
  const read = (): PageDocMeta => {
    if (!doc) return { title: '', icon: '', narrow: false, cover: '', coverY: 50, iconSource: '', coverSource: '', iconSize: 0, coverHeight: 0 };
    const m = doc.getMap('meta');
    const y = Number(m.get('coverY'));
    return {
      title: String(m.get('title') ?? ''),
      icon: String(m.get('icon') ?? ''),
      narrow: Boolean(m.get('narrow')),
      cover: String(m.get('cover') ?? ''),
      coverY: Number.isFinite(y) && m.has('coverY') ? Math.min(100, Math.max(0, y)) : 50,
      iconSource: String(m.get('iconSource') ?? ''),
      coverSource: String(m.get('coverSource') ?? ''),
      iconSize: sizeIn(m.get('iconSize'), ICON_SIZE_RANGE),
      coverHeight: sizeIn(m.get('coverHeight'), COVER_HEIGHT_RANGE),
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
