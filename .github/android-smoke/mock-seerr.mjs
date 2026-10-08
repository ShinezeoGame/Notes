// Faux Seerr (API v1) pour le test de l'APK sur l'émulateur (run.sh) : recherche, tendances, fiches, demandes en
// mémoire. Clé API : « cle-seerr ». Usage : node mock-seerr.mjs <port>
import http from 'node:http';

const PORT = Number(process.argv[2] || 5055);
const KEY = 'cle-seerr';
const MEDIA = [
  { id: 693134, mediaType: 'movie', title: 'Dune : Deuxième partie', originalTitle: 'Dune: Part Two', releaseDate: '2024-02-27', overview: 'Paul Atréides s’unit à Chani et aux Fremen pour mener la révolte contre ceux qui ont anéanti sa famille.', posterPath: '/dune2.jpg', voteAverage: 8.2 },
  { id: 438631, mediaType: 'movie', title: 'Dune', releaseDate: '2021-09-15', overview: 'L’histoire de Paul Atréides, jeune homme aussi doué que brillant.', posterPath: '/dune.jpg', voteAverage: 7.8 },
  { id: 1084736, mediaType: 'movie', title: 'Le Comte de Monte-Cristo', releaseDate: '2024-06-28', overview: 'Victime d’un complot, Edmond Dantès est arrêté le jour de son mariage.', posterPath: '/monte-cristo.jpg', voteAverage: 8.1 },
  { id: 100088, mediaType: 'tv', name: 'The Last of Us', firstAirDate: '2023-01-15', overview: 'Vingt ans après la destruction de la civilisation moderne, Joel est chargé de faire sortir Ellie d’une zone de quarantaine.', posterPath: '/tlou.jpg', voteAverage: 8.6, seasons: [{ seasonNumber: 0, name: 'Épisodes spéciaux', episodeCount: 2 }, { seasonNumber: 1, name: 'Saison 1', episodeCount: 9, airDate: '2023-01-15' }, { seasonNumber: 2, name: 'Saison 2', episodeCount: 7, airDate: '2025-04-13' }] },
  { id: 94605, mediaType: 'tv', name: 'Arcane', firstAirDate: '2021-11-06', overview: 'Au milieu du conflit entre les villes jumelles de Piltover et Zaun, deux sœurs se battent dans les camps opposés.', posterPath: '/arcane.jpg', voteAverage: 8.7, seasons: [{ seasonNumber: 1, name: 'Saison 1', episodeCount: 9, airDate: '2021-11-06' }, { seasonNumber: 2, name: 'Saison 2', episodeCount: 9, airDate: '2024-11-09' }] },
  { id: 76479, mediaType: 'tv', name: 'The Boys', firstAirDate: '2019-07-25', overview: 'Dans un monde où les super-héros se comportent comme des célébrités…', posterPath: '/boys.jpg', voteAverage: 8.5, seasons: [1, 2, 3, 4].map((n) => ({ seasonNumber: n, name: `Saison ${n}`, episodeCount: 8 })) },
];
// État des médias (tmdbId → { status, seasons: Map }) et demandes.
const media = new Map([
  [438631, { status: 5, seasons: new Map() }],
  [94605, { status: 4, seasons: new Map([[1, 5]]) }],
]);
let requests = [
  { id: 1, status: 2, type: 'movie', createdAt: '2026-10-05T18:00:00.000Z', media: { tmdbId: 438631, mediaType: 'movie', status: 5 }, seasons: [], requestedBy: { displayName: 'Léa' } },
  { id: 2, status: 2, type: 'tv', createdAt: '2026-10-06T20:00:00.000Z', media: { tmdbId: 94605, mediaType: 'tv', status: 4 }, seasons: [{ seasonNumber: 1 }], requestedBy: { displayName: 'Paul' } },
];
let nextId = 3;
const log = [];

const info = (m) => {
  const s = media.get(m.id);
  if (!s) return undefined;
  return {
    status: s.status,
    seasons: [...s.seasons].map(([seasonNumber, status]) => ({ seasonNumber, status })),
    requests: requests.filter((r) => r.media.tmdbId === m.id).map((r) => ({ status: r.status, seasons: r.seasons })),
  };
};
const view = (m) => ({ ...m, seasons: undefined, mediaInfo: info(m) });

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      log.push(`${req.method} ${url.pathname}${url.search}`);
      if (url.pathname === '/__log') return send(res, 200, log);
      if (url.pathname === '/api/v1/status') return send(res, 200, { version: '3.0.1' });
      if (req.headers['x-api-key'] !== KEY) return send(res, 403, { message: 'You do not have permission to access this endpoint.' });
      if (url.pathname === '/api/v1/auth/me') return send(res, 200, { id: 1, displayName: 'Admin' });
      if (url.pathname === '/api/v1/search') {
        const q = url.searchParams.get('query') || '';
        // Comme Seerr : refuse les caractères réservés non encodés.
        if (/[!'()*]/.test(req.url.split('?')[1] ?? '')) return send(res, 400, { message: 'invalid query' });
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        const results = MEDIA.filter((m) => words.every((w) => `${m.title ?? ''} ${m.name ?? ''} ${m.originalTitle ?? ''}`.toLowerCase().includes(w))).map(view);
        results.push({ id: 31, mediaType: 'person', name: 'Personne' });
        return send(res, 200, { page: 1, totalPages: 1, totalResults: results.length, results });
      }
      if (url.pathname === '/api/v1/discover/trending') return send(res, 200, { page: 1, totalPages: 1, results: MEDIA.slice(0, 5).map(view) });
      let m;
      if ((m = /^\/api\/v1\/(movie|tv)\/(\d+)$/.exec(url.pathname))) {
        const item = MEDIA.find((x) => x.id === Number(m[2]) && x.mediaType === m[1]);
        if (!item) return send(res, 404, { message: 'Unable to retrieve' });
        return send(res, 200, { ...item, genres: [{ name: item.mediaType === 'movie' ? 'Science-Fiction' : 'Drame' }], runtime: 166, mediaInfo: info(item) });
      }
      if (url.pathname === '/api/v1/request' && req.method === 'GET') {
        const take = Number(url.searchParams.get('take')) || 20;
        return send(res, 200, { pageInfo: { results: requests.length }, results: [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, take) });
      }
      if (url.pathname === '/api/v1/request' && req.method === 'POST') {
        const b = JSON.parse(body || '{}');
        const item = MEDIA.find((x) => x.id === b.mediaId && x.mediaType === b.mediaType);
        if (!item) return send(res, 404, { message: 'Media not found' });
        const state = media.get(item.id);
        if (item.mediaType === 'movie' && state && state.status >= 2) return send(res, 409, { message: 'Request for this media already exists.' });
        if (item.mediaType === 'tv' && !(Array.isArray(b.seasons) || b.seasons === 'all')) return send(res, 400, { message: 'seasons required' });
        const seasons = item.mediaType === 'tv' ? (b.seasons === 'all' ? item.seasons.filter((s) => s.seasonNumber > 0).map((s) => s.seasonNumber) : b.seasons) : [];
        const st = state ?? { status: 3, seasons: new Map() };
        if (state && state.status < 2) st.status = 3;
        for (const n of seasons) st.seasons.set(n, 3);
        media.set(item.id, st);
        const r = { id: nextId++, status: 2, type: item.mediaType, createdAt: new Date().toISOString(), media: { tmdbId: item.id, mediaType: item.mediaType, status: st.status }, seasons: seasons.map((seasonNumber) => ({ seasonNumber })), requestedBy: { displayName: 'Admin' }, body: b };
        requests.push(r);
        return send(res, 201, r);
      }
      send(res, 404, { message: 'Not found' });
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`faux Seerr sur ${PORT}`));
