import { useSyncExternalStore } from 'react';
import { newId, newKey, randomColor } from './ids';

export type Settings = {
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

function defaults(): Settings {
  return {
    serverUrl: defaultServerUrl(),
    workspaceId: newId(),
    workspaceKey: newKey(),
    userName: `Utilisateur ${Math.floor(1000 + Math.random() * 9000)}`,
    userColor: randomColor(),
    googleClientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '',
    updateNotifications: true,
    onboarded: isStandaloneWeb(),
    lastPageId: null,
    expanded: {},
    navCollapsed: false,
    recentPages: [],
    pagesHidden: false,
    dashTipSeen: false,
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { ...defaults(), ...parsed };
    }
  } catch {
    /* stockage indisponible */
  }
  const s = defaults();
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
  updateSettings({ workspaceId: d.workspaceId, workspaceKey: d.workspaceKey, lastPageId: null, expanded: {} });
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
