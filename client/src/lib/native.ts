import { t, tServer } from './i18n';
// Appels aux plugins natifs de l'application Android (pont Capacitor injecté dans la WebView).

type NativeBridge = {
  nativePromise?: <T>(plugin: string, method: string, options?: object) => Promise<T>;
  addListener?: (plugin: string, event: string, callback: (data: unknown) => void) => { remove: () => Promise<void> };
  PluginHeaders?: { name: string }[];
};

function bridge(): NativeBridge | undefined {
  return (window as unknown as { Capacitor?: NativeBridge }).Capacitor;
}

/** Vrai si l'application Android fournit ce plugin natif. */
export function hasNativePlugin(name: string): boolean {
  return Boolean(bridge()?.PluginHeaders?.some((h) => h.name === name));
}

export function callNative<T = void>(plugin: string, method: string, options: object = {}): Promise<T> {
  const cap = bridge();
  if (!cap?.nativePromise) return Promise.reject(new Error(t('Fonction réservée à l’application Android.')));
  return cap.nativePromise<T>(plugin, method, options).catch((err: unknown) => {
    // Message de l'application Android, écrit en français : traduit comme ceux du serveur.
    if (err instanceof Error && err.message) err.message = tServer(err.message);
    throw err;
  });
}

/** Écoute un évènement d'un plugin natif ; renvoie la fonction de désinscription. */
export function onNative<T>(plugin: string, event: string, callback: (data: T) => void): () => void {
  const cap = bridge();
  if (!cap?.addListener) return () => {};
  const handle = cap.addListener(plugin, event, (data) => callback(data as T));
  return () => void handle.remove();
}

/** Icônes de la barre d'état et de la barre de navigation : claires sur un thème sombre, foncées sur un thème clair. */
export function styleSystemBars(base: 'dark' | 'light' = 'dark') {
  if (hasNativePlugin('SystemBars')) void callNative('SystemBars', 'setStyle', { style: base === 'dark' ? 'DARK' : 'LIGHT' }).catch(() => {});
}
