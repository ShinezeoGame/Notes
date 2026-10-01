import { useSyncExternalStore } from 'react';
import { newId, newKey, randomColor } from './ids';
import { isDesktopLocal } from './desktop';
import { parseRoute } from './router';

/** Langue de l'interface (voir lib/i18n.ts). */
export type Lang = 'en' | 'fr';

export type Settings = {
  /** Langue de l'interface, propre à l'appareil : anglais pour une nouvelle installation. */
  lang: Lang;
  /** Langue choisie (ou proposition fermée) : la proposition du premier lancement ne s'affiche plus. */
  langChosen: boolean;
  /** URL du serveur de synchronisation (null = mode hors ligne, appareil seul). */
  serverUrl: string | null;
  workspaceId: string;
  workspaceKey: string;
  userName: string;
  userColor: string;
  /** ID client OAuth Google (optionnel) pour importer un agenda via son compte Google. */
  googleClientId: string;
  /** Application Android : notification quand une mise à jour est disponible. */
  updateNotifications: boolean;
  onboarded: boolean;
  lastPageId: string | null;
  expanded: Record<string, boolean>;
  /** Barre des sections repliée (icônes seules), sur ordinateur. */
  navCollapsed: boolean;
  /** Pages ouvertes récemment sur cet appareil (la plus récente en premier). */
  recentPages: string[];
  /** Colonne des pages masquée dans la section Notes, sur ordinateur. */
  pagesHidden: boolean;
  /** Astuce de l'accueil (glisser, tirer un coin) déjà vue sur cet appareil. */
  dashTipSeen: boolean;
  /** Premier lancement pas encore terminé : prénom, sections, présentation de Melo. */
  firstRun: boolean;
  /** Espace créé par une invitation sur le serveur de quelqu'un d'autre (sans maison, caméras ni homelab). */
  guest: boolean;
  /** Nom de la personne qui a invité (serveur utilisé). */
  hostName: string;
};

const STORAGE_KEY = 'notes.settings.v1';

export function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function isStandaloneWeb(): boolean {
  return !isNative() && /^https?:$/.test(location.protocol);
}

function defaultServerUrl(): string | null {
  const env = (import.meta.env.VITE_DEFAULT_SERVER_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, '');
  if (isStandaloneWeb()) return location.origin;
  return null;
}

/**
 * Langue d'une nouvelle installation : l'anglais, sauf pour une personne qui arrive par un lien reçu (page partagée,
 * invitation, liaison d'un appareil) : la langue de son navigateur, si c'est le français.
 */
function firstLang(): Lang {
  const linked = ['shared', 'invite', 'pair', 'join'].includes(parseRoute(location.hash).name);
  const browser = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase();
  return linked && browser.startsWith('fr') ? 'fr' : 'en';
}

function defaults(lang: Lang = 'en'): Settings {
  return {
    lang,
    langChosen: false,
    serverUrl: defaultServerUrl(),
    workspaceId: newId(),
    workspaceKey: newKey(),
    userName: `${lang === 'fr' ? 'Utilisateur' : 'User'} ${Math.floor(1000 + Math.random() * 9000)}`, // i18n-ignore : settings est lu avant i18n
    userColor: randomColor(),
    googleClientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '',
    updateNotifications: true,
    // Application pour ordinateur : écran de bienvenue au premier lancement, comme sur Android.
    onboarded: isStandaloneWeb() && !isDesktopLocal(),
    lastPageId: null,
    expanded: {},
    navCollapsed: false,
    recentPages: [],
    pagesHidden: false,
    dashTipSeen: false,
    firstRun: false,
    guest: false,
    hostName: '',
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // Installation d'avant le choix de la langue : elle reste en français.
      const s: Settings =
        parsed.lang !== 'en' && parsed.lang !== 'fr'
          ? { ...defaults('fr'), ...parsed, lang: 'fr', langChosen: true }
          : { ...defaults(parsed.lang), ...parsed };
      // Réglages apparus depuis le dernier enregistrement (langue…) : enregistrés aussitôt, pour rester les mêmes
      // d'un lancement à l'autre.
      if (Object.keys(s).some((k) => !(k in parsed))) persist(s);
      return s;
    }
  } catch {
    /* stockage indisponible */
  }
  const s = defaults(firstLang());
  persist(s);
  return s;
}

function persist(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  persist(current);
  listeners.forEach((l) => l());
}

export function resetWorkspace() {
  const d = defaults();
  updateSettings({ workspaceId: d.workspaceId, workspaceKey: d.workspaceKey, lastPageId: null, expanded: {}, guest: false, hostName: '' });
}

/** Nom affiché encore choisi au hasard (« Utilisateur 1234 », « User 1234 ») : à remplacer par le vrai prénom. */
export function isDefaultUserName(name: string): boolean {
  return /^(Utilisateur|User) \d{4}$/.test(name);
}

export function subscribeSettings(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
  } catch {
    return null;
  }
}

/** Analyse un lien "Lier un appareil" : https://serveur/#/join/<wsId>/<clé> */
export function parseJoinLink(input: string): { serverUrl: string; workspaceId: string; workspaceKey: string } | null {
  try {
    const u = new URL(input.trim());
    const m = /^#?\/join\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/.exec(u.hash);
    if (!m) return null;
    return { serverUrl: u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')), workspaceId: m[1], workspaceKey: m[2] };
  } catch {
    return null;
  }
}
