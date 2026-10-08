// Films et séries : recherche et demandes envoyées à Seerr (ou Jellyseerr, Overseerr), réglé dans le homelab de
// l'espace. Le serveur Ostal interroge Seerr (server/src/seerr.js) : la clé API ne passe jamais par l'appareil.
import { useCallback, useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { api } from './api';
import { getLang, t } from './i18n';
import { readHomelabConfig, useHomelabConfig, type HomelabConfig, type Service } from './homelab';

export type MediaType = 'movie' | 'tv';
/** Disponibilité dans Seerr : rien de demandé (''), demandé, en cours, en partie disponible, disponible. */
export type MediaState = '' | 'pending' | 'processing' | 'partial' | 'available';
/** État d'une demande : attend l'accord d'un administrateur, en cours, en partie disponible, disponible, refusée, échouée. */
export type RequestState = 'waiting' | 'processing' | 'partial' | 'available' | 'declined' | 'failed';

export type MediaItem = {
  id: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  overview: string;
  poster: string;
  backdrop: string;
  rating: number;
  state: MediaState;
};
export type Season = { number: number; name: string; episodes: number; year: number | null; state: MediaState };
export type MediaDetails = MediaItem & { genres: string[]; runtime?: number; seasons?: Season[] };
export type MediaRequest = {
  id: number;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  year: number | null;
  poster: string;
  state: RequestState;
  seasons: number[];
  by: string;
  at: number;
};
export type SeerrStatus = { configured: boolean; name?: string; url?: string; type?: string };

/** Types d'applications du homelab qui parlent l'API de Seerr (même liste que le serveur). */
export const SEERR_TYPES = ['seerr', 'jellyseerr', 'overseerr'];

/** Seerr réglé dans le homelab (le premier qui a une clé API), comme le cherche le serveur. */
export function seerrService(cfg: HomelabConfig): Service | null {
  return cfg.services.find((s) => SEERR_TYPES.includes(s.type) && Boolean(s.apiKey?.trim()) && /^https?:\/\//i.test(s.internalUrl || s.url)) ?? null;
}

export const isSeerrConfigured = (doc: Y.Doc) => Boolean(seerrService(readHomelabConfig(doc)));

/** Seerr réglé, suivi en direct (ajout ou retrait dans le homelab). */
export function useSeerr(doc: Y.Doc): Service | null {
  return seerrService(useHomelabConfig(doc));
}

/** Langue des titres et résumés demandée à Seerr. */
export const seerrLang = () => getLang();

/** Affiche d'un film (images de TMDB, la base de films qu'utilise Seerr). */
export function posterUrl(path: string, size: 'w92' | 'w185' | 'w342' | 'w780' = 'w342'): string {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
}

export function mediaStateLabel(state: MediaState | RequestState): string {
  switch (state) {
    case 'pending':
      return t('Demandé');
    case 'waiting':
      return t('En attente d’accord');
    case 'processing':
      return t('En cours');
    case 'partial':
      return t('En partie disponible');
    case 'available':
      return t('Disponible');
    case 'declined':
      return t('Refusée');
    case 'failed':
      return t('Échec');
    default:
      return '';
  }
}

/** Couleur de l'état (classes nb-chip--…). */
export function stateTone(state: MediaState | RequestState): 'ok' | 'busy' | 'bad' | '' {
  if (state === 'available') return 'ok';
  if (state === 'declined' || state === 'failed') return 'bad';
  return state ? 'busy' : '';
}

export const typeLabel = (type: MediaType) => (type === 'movie' ? t('Film') : t('Série'));

// ---------- Demandes récentes : partagées entre la section et le widget, relues après chaque demande ----------

let recent: { list: MediaRequest[]; at: number; error: string } = { list: [], at: 0, error: '' };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

export function refreshRequests(): Promise<void> {
  loading ??= api
    .seerrRequests(20, seerrLang())
    .then(
      (r) => {
        recent = { list: r.requests, at: Date.now(), error: '' };
      },
      (err: unknown) => {
        recent = { ...recent, at: Date.now(), error: err instanceof Error ? err.message : t('Seerr ne répond pas.') };
      },
    )
    .finally(() => {
      loading = null;
      listeners.forEach((l) => l());
    });
  return loading;
}

/** Demandes récentes (relues chaque minute tant qu'elles sont affichées). */
export function useRecentRequests(enabled: boolean): { list: MediaRequest[]; loaded: boolean; error: string } {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setTick((n) => n + 1);
    listeners.add(update);
    if (Date.now() - recent.at > 20_000) void refreshRequests();
    const timer = window.setInterval(() => void refreshRequests(), 60_000);
    return () => {
      listeners.delete(update);
      window.clearInterval(timer);
    };
  }, [enabled]);
  return { list: recent.list, loaded: recent.at > 0, error: recent.error };
}

/** Recherche avec un court délai pendant la frappe ; résultats de la dernière recherche seulement. */
export function useMediaSearch(query: string): { results: MediaItem[] | null; error: string; busy: boolean } {
  const [state, setState] = useState<{ q: string; results: MediaItem[] | null; error: string }>({ q: '', results: null, error: '' });
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      api.seerrSearch(q, seerrLang()).then(
        (r) => alive && setState({ q, results: r.results, error: '' }),
        (err: unknown) => alive && setState({ q, results: [], error: err instanceof Error ? err.message : t('Seerr ne répond pas.') }),
      );
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q]);
  if (q.length < 2) return { results: null, error: '', busy: false };
  return { results: state.q === q ? state.results : null, error: state.q === q ? state.error : '', busy: state.q !== q };
}

/** Une demande : envoyée, puis demandes récentes relues. Renvoie l'état de la demande. */
export function useRequestMedia() {
  const [busy, setBusy] = useState<string>('');
  const send = useCallback(async (item: Pick<MediaItem, 'id' | 'mediaType'>, seasons?: number[]) => {
    const key = `${item.mediaType}:${item.id}`;
    setBusy(key);
    try {
      const r = await api.seerrRequest(item.mediaType, item.id, seasons);
      void refreshRequests();
      return r.state;
    } finally {
      setBusy('');
    }
  }, []);
  return { send, busy };
}
