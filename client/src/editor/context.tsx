import { createContext, useContext } from 'react';
import type * as Y from 'yjs';
import type { CalEvent } from '../lib/ics';

export type PageRef = { id: string; title: string; icon: string };
export type CalendarImportResult = { title: string; events: CalEvent[]; source: string };

export type AppContextValue = {
  mode: 'owner' | 'shared';
  canEdit: boolean;
  currentPageId: string;
  getPage: (id: string) => PageRef | undefined;
  openPage: (id: string) => void;
  /** Crée une sous-page et renvoie son identifiant (null si impossible). */
  createSubpage: ((parentId: string, title?: string) => Promise<string | null>) | null;
  uploadFile: (file: File) => Promise<string>;
  fetchIcs: ((url: string) => Promise<string>) | null;
  importCalendar: (initial?: { source?: string; title?: string }) => Promise<CalendarImportResult | null>;
  notify: (message: string, kind?: 'info' | 'error') => void;
  /** Ouvre la section Homelab (propriétaire uniquement). */
  openDashboard?: () => void;
  /** Ouvre la vue Maison (propriétaire uniquement). */
  openSmartHome?: () => void;
  /** Ouvre la vue Caméras (propriétaire uniquement). */
  openCameras?: () => void;
  /** Rejoindre un serveur Melo (appareil seul : maison, caméras, homelab et PDF en ont besoin). */
  joinServer?: () => void;
  /** Vrai si au moins une application ou un appareil est configuré. */
  homelabConfigured?: boolean;
  /** Document de l'espace de travail (configuration du homelab, tailles des modules). */
  workspaceDoc?: Y.Doc | null;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppCtx(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext manquant'); // i18n-ignore
  return v;
}

/** Document Yjs de la page affichée (blocs qui suivent les modifications des autres personnes : tableur). */
export const PageDocContext = createContext<Y.Doc | null>(null);
