import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'notes' }
  | { name: 'page'; pageId: string }
  | { name: 'trash' }
  | { name: 'agenda' }
  | { name: 'homelab' }
  | { name: 'smarthome' }
  | { name: 'cameras' }
  | { name: 'pdf'; pdfId: string | null }
  | { name: 'papers'; paperId: string | null }
  | { name: 'shared'; token: string; pageId: string | null }
  | { name: 'join'; wsId: string; key: string }
  | { name: 'pair'; code: string }
  | { name: 'invite'; token: string };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  let m: RegExpExecArray | null;
  if ((m = /^\/p\/([A-Za-z0-9_-]+)/.exec(h))) return { name: 'page', pageId: m[1] };
  if (/^\/trash/.test(h)) return { name: 'trash' };
  if (/^\/notes/.test(h)) return { name: 'notes' };
  if (/^\/agenda/.test(h)) return { name: 'agenda' };
  // « #/dashboard » : ancienne adresse du homelab.
  if (/^\/(homelab|dashboard)/.test(h)) return { name: 'homelab' };
  if (/^\/maison/.test(h)) return { name: 'smarthome' };
  if (/^\/cameras/.test(h)) return { name: 'cameras' };
  if ((m = /^\/pdf(?:\/([A-Za-z0-9_-]+))?/.exec(h))) return { name: 'pdf', pdfId: m[1] ?? null };
  if ((m = /^\/papiers(?:\/([A-Za-z0-9_-]+))?/.exec(h))) return { name: 'papers', paperId: m[1] ?? null };
  if ((m = /^\/s\/([A-Za-z0-9_-]+)(?:\/p\/([A-Za-z0-9_-]+))?/.exec(h)))
    return { name: 'shared', token: m[1], pageId: m[2] ?? null };
  if ((m = /^\/join\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/.exec(h))) return { name: 'join', wsId: m[1], key: m[2] };
  if ((m = /^\/pair\/(\d{6})/.exec(h))) return { name: 'pair', code: m[1] };
  if ((m = /^\/invite\/([A-Za-z0-9_-]{20,64})/.exec(h))) return { name: 'invite', token: m[1] };
  return { name: 'home' };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'page':
      return `#/p/${route.pageId}`;
    case 'trash':
      return '#/trash';
    case 'notes':
      return '#/notes';
    case 'agenda':
      return '#/agenda';
    case 'homelab':
      return '#/homelab';
    case 'smarthome':
      return '#/maison';
    case 'cameras':
      return '#/cameras';
    case 'pdf':
      return route.pdfId ? `#/pdf/${route.pdfId}` : '#/pdf';
    case 'papers':
      return route.paperId ? `#/papiers/${route.paperId}` : '#/papiers';
    case 'shared':
      return route.pageId ? `#/s/${route.token}/p/${route.pageId}` : `#/s/${route.token}`;
    case 'join':
      return `#/join/${route.wsId}/${route.key}`;
    case 'pair':
      return `#/pair/${route.code}`;
    case 'invite':
      return `#/invite/${route.token}`;
    default:
      return '#/';
  }
}

/** Change d'adresse ; `replace` : sans nouvelle entrée dans l'historique (redirection). */
export function navigate(route: Route | string, opts: { replace?: boolean } = {}) {
  const hash = typeof route === 'string' ? route : routeToHash(route);
  if (location.hash === hash) return;
  if (opts.replace) location.replace(hash);
  else location.hash = hash;
}

let cached = parseRoute(location.hash);
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  cached = parseRoute(location.hash);
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => cached,
    () => cached,
  );
}
