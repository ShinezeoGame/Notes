import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'page'; pageId: string }
  | { name: 'trash' }
  | { name: 'dashboard' }
  | { name: 'smarthome' }
  | { name: 'cameras' }
  | { name: 'pdf'; pdfId: string | null }
  | { name: 'shared'; token: string; pageId: string | null }
  | { name: 'join'; wsId: string; key: string };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  let m: RegExpExecArray | null;
  if ((m = /^\/p\/([A-Za-z0-9_-]+)/.exec(h))) return { name: 'page', pageId: m[1] };
  if (/^\/trash/.test(h)) return { name: 'trash' };
  if (/^\/dashboard/.test(h)) return { name: 'dashboard' };
  if (/^\/maison/.test(h)) return { name: 'smarthome' };
  if (/^\/cameras/.test(h)) return { name: 'cameras' };
  if ((m = /^\/pdf(?:\/([A-Za-z0-9_-]+))?/.exec(h))) return { name: 'pdf', pdfId: m[1] ?? null };
  if ((m = /^\/s\/([A-Za-z0-9_-]+)(?:\/p\/([A-Za-z0-9_-]+))?/.exec(h)))
    return { name: 'shared', token: m[1], pageId: m[2] ?? null };
  if ((m = /^\/join\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/.exec(h))) return { name: 'join', wsId: m[1], key: m[2] };
  return { name: 'home' };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'page':
      return `#/p/${route.pageId}`;
    case 'trash':
      return '#/trash';
    case 'dashboard':
      return '#/dashboard';
    case 'smarthome':
      return '#/maison';
    case 'cameras':
      return '#/cameras';
    case 'pdf':
      return route.pdfId ? `#/pdf/${route.pdfId}` : '#/pdf';
    case 'shared':
      return route.pageId ? `#/s/${route.token}/p/${route.pageId}` : `#/s/${route.token}`;
    case 'join':
      return `#/join/${route.wsId}/${route.key}`;
    default:
      return '#/';
  }
}

export function navigate(route: Route | string) {
  const hash = typeof route === 'string' ? route : routeToHash(route);
  if (location.hash === hash) return;
  location.hash = hash;
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
