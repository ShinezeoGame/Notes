// Application installable depuis le navigateur (Edge, Chrome, Brave… sur Windows, Mac ou Linux) : service worker
// pour l'ouverture sans réseau, et proposition d'installation (« Installer Notes ») depuis l'application.
import { useSyncExternalStore } from 'react';
import { isStandaloneWeb } from './settings';
import { toast } from '../components/Toast';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;
let installed = false;
let snapshot = { canInstall: false, installed: false };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { canInstall: Boolean(deferred), installed };
  listeners.forEach((l) => l());
}

/** Vrai dans la fenêtre de l'application installée (sans barre d'adresse). */
export function isInstalledApp(): boolean {
  return ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen'].some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches);
}

/** Au démarrage (navigateur uniquement) : écoute la proposition d'installation et enregistre le service worker. */
export function startPwa() {
  if (!isStandaloneWeb()) return;
  installed = isInstalledApp();
  emit();
  window.addEventListener('beforeinstallprompt', (e) => {
    // Le navigateur garde son propre bouton (barre d'adresse) ; l'application propose le sien.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
    toast('Notes est installée : retrouvez-la dans le menu Démarrer (épinglez-la à la barre des tâches si vous voulez).');
  });
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  const register = () => void navigator.serviceWorker.register('sw.js').catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** Ouvre la fenêtre d'installation du navigateur ; vrai si l'utilisateur a accepté. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}

export function useInstallState(): { canInstall: boolean; installed: boolean } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}
