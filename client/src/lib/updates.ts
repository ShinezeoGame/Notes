// Mises à jour de l'application. Le serveur Melo annonce la version de son client (/api/app/version) :
// - navigateur : un rechargement de la page suffit ;
// - application Android : la nouvelle version est téléchargée depuis le serveur (plugin natif AppUpdate) puis la
//   WebView bascule dessus (plugin WebView de Capacitor), sans réinstaller l'APK. Une vérification en arrière-plan
//   envoie une notification quand une version est disponible.
import { useSyncExternalStore } from 'react';
import { serverBase } from './api';
import { getSettings, isNative, updateSettings } from './settings';
import { callNative, hasNativePlugin, onNative } from './native';
import { toast } from '../components/Toast';
import { t, locale, getLang } from './i18n';

export const BUILD = __APP_BUILD__;
/** Téléchargement de l'APK, quand une mise à jour demande une application Android plus récente. */
export const APK_PAGE = 'https://github.com/ShinezeoGame/Notes/releases/tag/latest';
/** Documentation sur le dépôt public (branche par défaut) : mode d'emploi, installation d'un serveur. */
export const DOCS_BASE = 'https://github.com/ShinezeoGame/Notes/blob/HEAD/';

export type RemoteVersion = { version: string; builtAt: string; minNative: number };
type Manifest = RemoteVersion & { size: number; files: { path: string; size: number; sha256: string }[] };

export type UpdateState = {
  /** Dernière version annoncée par le serveur (null : pas encore connue). */
  remote: RemoteVersion | null;
  checking: boolean;
  checkedAt: number;
  /** Progression du téléchargement (0 à 1), null hors téléchargement. */
  progress: number | null;
  error: string | null;
  /** API native de l'application Android (0 dans un navigateur). */
  nativeApi: number;
  /** Version de l'APK installé. */
  appVersion: string | null;
  /** Version pour laquelle l'utilisateur a choisi « Plus tard » (jusqu'au prochain lancement). */
  dismissed: string | null;
};

let state: UpdateState = {
  remote: null,
  checking: false,
  checkedAt: 0,
  progress: null,
  error: null,
  nativeApi: 0,
  appVersion: null,
  dismissed: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getUpdateState(): UpdateState {
  return state;
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

/** Application Android capable de se mettre à jour elle-même. */
function nativeUpdater(): boolean {
  return isNative() && hasNativePlugin('AppUpdate');
}

export function isUpdateAvailable(s: UpdateState = state): boolean {
  return Boolean(s.remote && s.remote.version !== BUILD.id);
}

/** La version du serveur demande une application Android plus récente que celle installée. */
export function needsNewApp(s: UpdateState = state): boolean {
  return Boolean(isNative() && s.remote && s.remote.minNative > s.nativeApi);
}

export function formatBuildDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export function dismissUpdate() {
  set({ dismissed: state.remote?.version ?? null, error: null });
}

export async function checkForUpdate(): Promise<RemoteVersion | null> {
  const base = serverBase();
  if (!base) return null;
  set({ checking: true });
  try {
    const r = await fetch(`${base}/api/app/version`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const remote = (await r.json()) as RemoteVersion;
    if (typeof remote?.version !== 'string') return null;
    set({ remote: { version: remote.version, builtAt: String(remote.builtAt ?? ''), minNative: Number(remote.minNative) || 1 }, checkedAt: Date.now() });
    // Mise à jour signalée dans l'application : inutile de la notifier en plus.
    if (remote.version !== BUILD.id && nativeUpdater()) void callNative('AppUpdate', 'markSeen', { version: remote.version }).catch(() => {});
    return state.remote;
  } catch {
    // Serveur injoignable : nouvelle tentative plus tard, sans message.
    return null;
  } finally {
    set({ checking: false });
  }
}

const PENDING_KEY = 'notes.update.pending';
let applying = false;

/** Installe la version du serveur : rechargement (navigateur) ou téléchargement puis bascule (Android). */
export async function applyUpdate(): Promise<void> {
  const base = serverBase();
  if (!base || applying) return;
  if (!isNative()) {
    location.reload();
    return;
  }
  if (!nativeUpdater() || needsNewApp()) {
    window.open(APK_PAGE, '_blank');
    return;
  }
  applying = true;
  set({ progress: 0, error: null });
  const stop = onNative<{ done: number; total: number }>('AppUpdate', 'downloadProgress', ({ done, total }) =>
    set({ progress: total > 0 ? Math.min(1, done / total) : 0 }),
  );
  try {
    const r = await fetch(`${base}/api/app/manifest`, { cache: 'no-store' });
    if (!r.ok) throw new Error(t('Le serveur a répondu {status}.', { status: r.status }));
    const manifest = (await r.json()) as Manifest;
    if (manifest.minNative > state.nativeApi) throw new Error(t('Cette version demande une application Android plus récente.'));
    const { path } = await callNative<{ path: string }>('AppUpdate', 'download', {
      baseUrl: base,
      version: manifest.version,
      files: manifest.files,
    });
    set({ progress: 1 });
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ version: manifest.version, from: BUILD.id }));
    } catch {
      /* stockage indisponible : pas de message après la mise à jour */
    }
    // La WebView recharge l'application depuis la nouvelle version ; celle-ci confirme son démarrage (bootUpdates).
    await callNative('WebView', 'setServerBasePath', { path });
  } catch (err) {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    set({ progress: null, error: err instanceof Error ? err.message : t('Mise à jour impossible.') });
  } finally {
    stop();
    applying = false;
  }
}

/** Réglages de la vérification en arrière-plan (Android). */
export async function configureNativeUpdates(requestPermission = false): Promise<void> {
  if (!nativeUpdater()) return;
  const notify = getSettings().updateNotifications !== false;
  await callNative('AppUpdate', 'configure', { serverUrl: serverBase() ?? '', currentVersion: BUILD.id, notify, lang: getLang() }).catch(() => {});
  if (!notify || !serverBase()) return;
  const perm = await callNative<{ notifications?: string }>('AppUpdate', 'checkPermissions').catch(() => null);
  if (!perm?.notifications?.startsWith('prompt')) return;
  const ASKED = 'notes.update.permissionAsked';
  let asked = false;
  try {
    asked = localStorage.getItem(ASKED) === '1';
    localStorage.setItem(ASKED, '1');
  } catch {
    /* ignore */
  }
  if (requestPermission || !asked) await callNative('AppUpdate', 'requestPermissions').catch(() => {});
}

export async function setUpdateNotifications(enabled: boolean): Promise<void> {
  updateSettings({ updateNotifications: enabled });
  await configureNativeUpdates(enabled);
}

/** Démarrage (Android) : confirme la version en cours, nettoie les anciennes, puis programme les vérifications. */
async function bootNative() {
  const info = await callNative<{ nativeApi?: number; versionName?: string }>('AppUpdate', 'getInfo').catch(() => null);
  set({ nativeApi: Number(info?.nativeApi) || 0, appVersion: info?.versionName || null });

  // Version téléchargée qui démarre correctement : elle devient la version de l'application.
  const { path } = await callNative<{ path: string }>('WebView', 'getServerBasePath').catch(() => ({ path: '' }));
  const bundle = /\/bundles\/([A-Za-z0-9._-]+)$/.exec(path ?? '')?.[1] ?? '';
  if (bundle) await callNative('WebView', 'persistServerBasePath').catch(() => {});

  let pending: { version?: string } | null = null;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  if (pending?.version === BUILD.id)
    toast(t('Melo a été mis à jour : version {version} du {date}.', { version: BUILD.id, date: formatBuildDate(BUILD.builtAt) }));
  else if (pending?.version) toast(t('La nouvelle version n’a pas pu démarrer : la version précédente est conservée.'), 'error');

  await callNative('AppUpdate', 'cleanup', { keep: bundle }).catch(() => {});
  await configureNativeUpdates();

  // Application ouverte en touchant la notification : mise à jour directe.
  const updateNow = async () => {
    await checkForUpdate();
    if (isUpdateAvailable() && !needsNewApp()) void applyUpdate();
  };
  onNative('AppUpdate', 'updateRequested', () => void updateNow());
  const launch = await callNative<{ update?: boolean }>('AppUpdate', 'consumeLaunchRequest').catch(() => null);
  if (launch?.update) await updateNow();
}

let started = false;

/** Vérifications au lancement, au retour sur l'application et toutes les 30 minutes. */
export function startUpdateChecks() {
  if (started || import.meta.env.DEV) return;
  started = true;
  const maybeCheck = () => {
    if (document.visibilityState === 'visible' && Date.now() - state.checkedAt > 5 * 60_000) void checkForUpdate();
  };
  setTimeout(() => {
    void (nativeUpdater() ? bootNative() : Promise.resolve()).finally(() => {
      if (!state.checkedAt) void checkForUpdate();
    });
  }, 1500);
  document.addEventListener('visibilitychange', maybeCheck);
  window.addEventListener('focus', maybeCheck);
  setInterval(maybeCheck, 30 * 60_000);
}
