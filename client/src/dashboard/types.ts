// Contrat commun des widgets du tableau de bord : contenu affiché et réglages propres à chaque type.
import type * as Y from 'yjs';
import type { WorkspaceStore } from '../lib/workspace';
import type { Widget } from './model';

export type WidgetProps = {
  widget: Widget;
  /** Document de l'espace (agendas, caméras, maison, notes rapides…) et arborescence des pages. */
  doc: Y.Doc;
  store: WorkspaceStore;
  /** Tableau de bord en cours de modification (contenu non cliquable). */
  editing: boolean;
  /** Modifie une partie des réglages du widget. */
  setConfig: (patch: Record<string, unknown>) => void;
  /** Ouvre la fenêtre de réglages du widget. */
  openSettings: () => void;
};

export type SettingsProps = {
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
  doc: Y.Doc;
  store: WorkspaceStore;
};

export const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
export const bool = (v: unknown, fallback = false) => (typeof v === 'boolean' ? v : fallback);
export const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
