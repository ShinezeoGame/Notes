import { createContext, useContext } from 'react';
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
  /** Ouvre la vue Tableau de bord (propriétaire uniquement). */
  openDashboard?: () => void;
  /** Vrai si au moins une application ou un appareil est configuré. */
  homelabConfigured?: boolean;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppCtx(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext manquant');
  return v;
}
