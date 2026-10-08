// Films et séries : recherche et demandes envoyées à Seerr (ou Jellyseerr, Overseerr), l'application qui transmet les
// demandes à Radarr et Sonarr. Seerr est celui réglé dans le homelab de l'espace (adresse, clé API) : le serveur
// Ostal l'interroge pour l'application et les widgets du téléphone, la clé ne quitte jamais le serveur.
// Demandes faites avec la clé API : au nom de l'administrateur de Seerr, donc acceptées d'office.
import { httpRequest } from './homelab.js';

/** Types d'applications du homelab qui parlent l'API de Seerr. */
export const SEERR_TYPES = ['seerr', 'jellyseerr', 'overseerr'];

const TIMEOUT = 12_000;
const LANG_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Seerr réglé dans le homelab (le premier qui a une clé API), ou null. */
export function findSeerr(homelab) {
  const svc = (homelab?.services ?? []).find((s) => s && SEERR_TYPES.includes(s.type) && typeof s.apiKey === 'string' && s.apiKey.trim());
  if (!svc) return null;
  const base = String(svc.internalUrl || svc.url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return null;
  return { name: String(svc.name || 'Seerr'), url: String(svc.url || base).trim(), base, apiKey: svc.apiKey.trim(), insecure: Boolean(svc.insecure), type: svc.type };
}

/** Paramètre de recherche encodé comme l'attend Seerr (il refuse aussi ! ' ( ) * non encodés). */
const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function call(seerr, method, path, body) {
  let res;
  try {
    res = await httpRequest(`${seerr.base}/api/v1${path}`, {
      method,
      headers: { 'X-Api-Key': seerr.apiKey },
      body,
      insecure: seerr.insecure,
      timeout: TIMEOUT,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/self.signed|certificate|CERT_/i.test(msg)) throw fail(502, 'Certificat de Seerr non reconnu : cochez « Ignorer le certificat » dans le homelab.');
    throw fail(502, 'Seerr ne répond pas : vérifiez son adresse dans le homelab.');
  }
  let message = '';
  if (!res.ok) {
    try {
      const data = res.json();
      message = String(data.message || data.error || '');
    } catch {
      /* pas de message */
    }
  }
  if (res.status === 401 || res.status === 403) {
    // Clé invalide : « You do not have permission to access this endpoint » ; un autre message est un refus de Seerr
    // (quota atteint…), différent d'une clé invalide.
    if (res.status === 403 && message && !/api key|unauthori[sz]ed|permission to access this endpoint/i.test(message)) throw fail(403, `Seerr a refusé : ${message.slice(0, 200)}`);
    throw fail(502, 'Clé API refusée par Seerr : vérifiez-la dans le homelab.');
  }
  if (!res.ok) {
    if (res.status === 409 || /already|existe déjà/i.test(message)) throw fail(409, 'Déjà demandé.');
    if (res.status === 404) throw fail(404, 'Introuvable dans Seerr.');
    throw fail(502, message ? `Seerr a refusé : ${message.slice(0, 200)}` : `Seerr a répondu : erreur ${res.status}.`);
  }
  try {
    return res.text ? res.json() : {};
  } catch {
    throw fail(502, 'Réponse de Seerr illisible : est-ce bien Seerr à cette adresse ?');
  }
}

// ---------- Mise en forme des réponses ----------

const str = (v) => (typeof v === 'string' ? v : '');
const year = (date) => (/^\d{4}/.test(str(date)) ? Number(str(date).slice(0, 4)) : null);

/**
 * Disponibilité d'un film ou d'une série dans Seerr : '' (rien de demandé, ou supprimé), 'pending' (demandé, en
 * attente), 'processing' (accepté, en cours), 'partial' (en partie disponible), 'available'.
 */
export function mediaState(status) {
  return { 2: 'pending', 3: 'processing', 4: 'partial', 5: 'available' }[Number(status)] ?? '';
}

/** Résultat de recherche, de tendances ou fiche : l'essentiel pour l'afficher. */
export function mediaItem(r) {
  const movie = r.mediaType === 'movie';
  return {
    id: Number(r.id),
    mediaType: movie ? 'movie' : 'tv',
    title: str(movie ? r.title : r.name) || str(r.originalTitle) || str(r.originalName),
    year: year(movie ? r.releaseDate : r.firstAirDate),
    overview: str(r.overview).slice(0, 1500),
    poster: str(r.posterPath),
    backdrop: str(r.backdropPath),
    rating: Math.round((Number(r.voteAverage) || 0) * 10) / 10,
    state: mediaState(r.mediaInfo?.status),
  };
}

const listItems = (data) => (Array.isArray(data?.results) ? data.results : []).filter((r) => r && (r.mediaType === 'movie' || r.mediaType === 'tv') && Number(r.id) > 0).map(mediaItem);

const langParam = (lang) => (LANG_RE.test(String(lang)) ? `&language=${lang}` : '');

export async function search(seerr, query, { page = 1, lang } = {}) {
  const q = String(query ?? '').trim().slice(0, 120);
  if (!q) return { results: [], page: 1, totalPages: 0 };
  const data = await call(seerr, 'GET', `/search?query=${encode(q)}&page=${Math.max(1, Math.min(20, Number(page) || 1))}${langParam(lang)}`);
  return { results: listItems(data), page: Number(data.page) || 1, totalPages: Number(data.totalPages) || 1 };
}

export async function trending(seerr, { lang } = {}) {
  const data = await call(seerr, 'GET', `/discover/trending?page=1${langParam(lang)}`);
  return { results: listItems(data) };
}

/** Saisons d'une série : état de chacune (disponible, demandée…) pour choisir celles à demander. */
function seasonStates(info) {
  const states = new Map();
  for (const s of info?.seasons ?? []) states.set(Number(s.seasonNumber), mediaState(s.status));
  for (const req of info?.requests ?? []) {
    if (Number(req.status) === 3) continue; // demande refusée : saison demandable de nouveau
    for (const s of req.seasons ?? []) {
      const n = Number(s.seasonNumber);
      if (!states.get(n)) states.set(n, 'pending');
    }
  }
  return states;
}

export async function details(seerr, mediaType, id, { lang } = {}) {
  const data = await call(seerr, 'GET', `/${mediaType === 'movie' ? 'movie' : 'tv'}/${id}?${langParam(lang).slice(1)}`);
  const item = mediaItem({ ...data, mediaType: mediaType === 'movie' ? 'movie' : 'tv' });
  if (mediaType === 'movie') return { ...item, runtime: Number(data.runtime) || 0, genres: (data.genres ?? []).map((g) => str(g.name)).filter(Boolean).slice(0, 4) };
  const states = seasonStates(data.mediaInfo);
  const seasons = (data.seasons ?? [])
    .filter((s) => Number(s.seasonNumber) > 0)
    .map((s) => ({ number: Number(s.seasonNumber), name: str(s.name), episodes: Number(s.episodeCount) || 0, year: year(s.airDate), state: states.get(Number(s.seasonNumber)) ?? '' }));
  return { ...item, genres: (data.genres ?? []).map((g) => str(g.name)).filter(Boolean).slice(0, 4), seasons };
}

/**
 * Demande d'un film, ou de saisons d'une série (`seasons` : numéros, ou 'all' : toutes celles qui ne sont ni
 * disponibles ni déjà demandées).
 */
export async function request(seerr, { mediaType, mediaId, seasons }) {
  if (mediaType !== 'movie' && mediaType !== 'tv') throw fail(400, 'Demande invalide.');
  const id = Number(mediaId);
  if (!Number.isInteger(id) || id <= 0 || id > 1e9) throw fail(400, 'Demande invalide.');
  const body = { mediaType, mediaId: id, is4k: false };
  if (mediaType === 'tv') {
    const show = await details(seerr, 'tv', id);
    const open = show.seasons.filter((s) => !s.state).map((s) => s.number);
    const wanted = Array.isArray(seasons) ? [...new Set(seasons.map(Number).filter((n) => open.includes(n)))] : open;
    if (!wanted.length) throw fail(409, show.seasons.length ? 'Déjà demandé.' : 'Aucune saison à demander.');
    body.seasons = wanted;
  }
  const data = await call(seerr, 'POST', '/request', body);
  return { id: Number(data?.id) || 0, state: requestState(data, data?.media) };
}

// ---------- Demandes récentes ----------

/**
 * État d'une demande, du point de vue de qui l'a faite : 'waiting' (attend l'accord d'un administrateur), 'declined',
 * 'failed', 'processing' (acceptée, en cours de téléchargement), 'partial', 'available'.
 */
export function requestState(req, media) {
  const status = Number(req?.status);
  if (status === 3) return 'declined';
  const m = mediaState(media?.status);
  if (m === 'available') return 'available';
  if (m === 'partial') return 'partial';
  if (status === 1) return 'waiting';
  if (status === 4) return 'failed';
  return 'processing';
}

/** Titres et affiches des demandes (Seerr ne renvoie que l'identifiant TMDB) : gardés 12 h. */
const titles = new Map();
const TITLE_TTL = 12 * 3600_000;

async function titleOf(seerr, mediaType, id, lang) {
  const key = `${seerr.base}|${mediaType}|${id}|${lang || ''}`;
  const hit = titles.get(key);
  if (hit && Date.now() - hit.at < TITLE_TTL) return hit.value;
  const data = await call(seerr, 'GET', `/${mediaType}/${id}?${langParam(lang).slice(1)}`);
  const value = { title: str(mediaType === 'movie' ? data.title : data.name) || str(data.originalTitle) || str(data.originalName), year: year(mediaType === 'movie' ? data.releaseDate : data.firstAirDate), poster: str(data.posterPath) };
  if (titles.size > 1000) titles.clear();
  titles.set(key, { at: Date.now(), value });
  return value;
}

export async function recentRequests(seerr, { take = 10, lang } = {}) {
  const n = Math.max(1, Math.min(30, Number(take) || 10));
  const data = await call(seerr, 'GET', `/request?take=${n}&skip=0&sort=added&filter=all`);
  const list = (Array.isArray(data?.results) ? data.results : []).filter((r) => r?.media && Number(r.media.tmdbId) > 0);
  const requests = await Promise.all(
    list.map(async (r) => {
      const mediaType = r.type === 'tv' || r.media.mediaType === 'tv' ? 'tv' : 'movie';
      const id = Number(r.media.tmdbId);
      const info = await titleOf(seerr, mediaType, id, lang).catch(() => ({ title: '', year: null, poster: '' }));
      return {
        id: Number(r.id),
        mediaType,
        tmdbId: id,
        ...info,
        state: requestState(r, r.media),
        seasons: mediaType === 'tv' ? (r.seasons ?? []).map((s) => Number(s.seasonNumber)).filter((x) => x > 0) : [],
        by: str(r.requestedBy?.displayName),
        at: Date.parse(r.createdAt) || 0,
      };
    }),
  );
  return { requests };
}

/** Essai d'une adresse et d'une clé (réglage) : version de Seerr si tout va bien. */
export async function testSeerr(cfg) {
  const base = String(cfg?.url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return { ok: false, error: 'Adresse invalide : elle commence par http:// ou https://.' };
  const seerr = { base, apiKey: String(cfg?.apiKey || '').trim(), insecure: Boolean(cfg?.insecure) };
  if (!seerr.apiKey) return { ok: false, error: 'Clé API manquante.' };
  try {
    const status = await call(seerr, 'GET', '/status');
    await call(seerr, 'GET', '/auth/me');
    return { ok: true, version: str(status?.version) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
