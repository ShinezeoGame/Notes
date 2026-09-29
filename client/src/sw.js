/*
 * Service worker de Notes (navigateur, application installée sur l'ordinateur) : l'application s'ouvre même sans
 * réseau et démarre plus vite. Modèle publié en « sw.js » à chaque construction (vite.config.ts), avec la version
 * et la liste des fichiers de cette construction. Les pages elles-mêmes sont gardées par l'application (IndexedDB) ;
 * l'API, les fichiers importés et la synchronisation passent toujours par le réseau.
 */
const VERSION = __NOTES_VERSION__;
const FILES = __NOTES_FILES__;
const CACHE = `notes-app-${VERSION}`;
const SCOPE = new URL(self.registration.scope);
const SHELL = SCOPE.href; // page de l'application (index.html)
const FILE_SET = new Set(FILES);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([SHELL, ...FILES.map((f) => new URL(f, SCOPE).href)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('notes-app-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const rel = url.pathname.slice(SCOPE.pathname.length);

  // Page de l'application : toujours la version du serveur ; la dernière copie sert quand le serveur est injoignable.
  if (req.mode === 'navigate' && (rel === '' || rel === 'index.html')) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(SHELL, copy)));
          }
          return res;
        } catch (err) {
          const cached = await caches.match(SHELL, { ignoreVary: true });
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // Fichiers de l'application (nom propre à chaque version) : copie locale d'abord.
  if (FILE_SET.has(rel) || rel.startsWith('assets/')) {
    event.respondWith(
      (async () => {
        // ignoreVary : le serveur répond « Vary: Origin » et les scripts de modules envoient l'en-tête Origin.
        const cached = await caches.match(req, { ignoreVary: true });
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
        }
        return res;
      })(),
    );
  }
});
