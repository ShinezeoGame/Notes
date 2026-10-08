// Application Ostal pour ordinateur (Windows) : fenêtre Electron qui affiche soit l'espace de cet ordinateur (serveur
// Ostal intégré, adresse 127.0.0.1), soit un serveur Ostal distant. Le pont `window.meloDesktop` est fourni par
// l'application (desktop/preload.cjs) ; il n'existe pas dans un navigateur ni sur Android.

export type DesktopFile = { name: string; type: string; data: Uint8Array<ArrayBuffer> };
export type DesktopUpdate = { status: 'downloading' | 'ready'; version: string; progress?: number };

type DesktopBridge = {
  /** Version de l'application installée (ex. 1.260930.930). */
  version: string;
  /** Niveau des fonctions offertes par le pont (augmenté à chaque ajout). */
  api: number;
  /** « local » : espace de cet ordinateur ; « server » : serveur distant (`serverUrl`). */
  mode: 'local' | 'server';
  localUrl: string;
  serverUrl: string | null;
  /** Niveau 2 : tout site s'affiche dans le widget « Site web » (en-têtes d'interdiction levés, http permis). */
  embedsAnySite?: boolean;
  /** Ouvre un serveur Ostal dans la fenêtre (et le retient), éventuellement à une adresse précise (#/invite/…). */
  useServer: (url: string, route?: string) => Promise<void>;
  /** Revient à l'espace de cet ordinateur. */
  useLocal: () => Promise<void>;
  /** Fichiers ouverts avec Ostal (« Ouvrir avec », glisser sur l'icône). */
  onOpenFiles: (callback: (files: DesktopFile[]) => void) => () => void;
  /** Mise à jour de l'application téléchargée en arrière-plan. */
  onUpdate: (callback: (update: DesktopUpdate) => void) => () => void;
  /** Redémarre sur la mise à jour téléchargée. */
  installUpdate: () => void;
  /** Niveau 3 : langue de l'interface, pour les menus et la page d'erreur de l'application. */
  setLanguage?: (lang: 'en' | 'fr') => void;
  /** Niveau 4 : choix d'un dossier de l'ordinateur (sauvegardes) ; null si annulé. */
  chooseFolder?: (title: string) => Promise<string | null>;
  /** Niveau 5 : extinction de cet ordinateur depuis un autre appareil (réglage, adresses MAC, nom). */
  power?: () => Promise<DesktopPower | null>;
  /** Niveau 5 : active ou non l'extinction à distance ; serveur et espace où l'application attend les ordres. */
  setPower?: (enabled: boolean, where: { server: string; wsId: string; key: string }) => Promise<DesktopPower | null>;
};

export type DesktopPower = { enabled: boolean; macs: string[]; name: string };

export function desktop(): DesktopBridge | null {
  return (window as unknown as { meloDesktop?: DesktopBridge }).meloDesktop ?? null;
}

export function isDesktop(): boolean {
  return Boolean(desktop());
}

/** Application pour ordinateur, sur l'espace de cet ordinateur (serveur intégré, joignable de ce seul ordinateur). */
export function isDesktopLocal(): boolean {
  return desktop()?.mode === 'local';
}
