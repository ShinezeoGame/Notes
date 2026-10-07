// Tableau de bord de l'accueil : widgets et leur disposition pour chaque taille d'écran (grande, moyenne, petite,
// téléphone). Enregistré dans le document de l'espace (map « dashboard », clé « config ») : le même sur tous les
// appareils, chacun gardant la disposition de sa taille d'écran. Le contenu des notes rapides et des listes de tâches
// est à part (types Yjs propres à chaque widget), pour que deux appareils puissent y écrire en même temps.
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { newId } from '../lib/ids';

export type WidgetType =
  | 'clock'
  | 'weather'
  | 'note'
  | 'tasks'
  | 'page'
  | 'pages'
  | 'agenda'
  | 'cameras'
  | 'smarthome'
  | 'homelab'
  | 'links'
  | 'image'
  | 'web'
  | 'search'
  | 'wol'
  | 'wifi'
  | 'papers';

export type Widget = {
  id: string;
  type: WidgetType;
  /** Titre personnalisé (vide : titre par défaut du widget). */
  title?: string;
  /** Barre de titre affichée (par défaut : selon le type de widget). */
  showTitle?: boolean;
  /** Vrai : pas de fond (contenu posé directement sur le fond d'écran). */
  transparent?: boolean;
  config: Record<string, unknown>;
};

export type Breakpoint = 'lg' | 'md' | 'sm' | 'xs';
export type GridItem = { i: string; x: number; y: number; w: number; h: number };
export type Layouts = Partial<Record<Breakpoint, GridItem[]>>;
export type DashboardData = { widgets: Widget[]; layouts: Layouts };

/** Largeur minimale (px) de la zone du tableau de bord pour chaque disposition, et nombre de colonnes. */
export const BREAKPOINTS: Record<Breakpoint, number> = { lg: 960, md: 700, sm: 460, xs: 0 };
export const COLS: Record<Breakpoint, number> = { lg: 12, md: 8, sm: 4, xs: 2 };
export const ROW_HEIGHT = 40;

/** Taille à l'ajout (sur 12 colonnes) et taille minimale. */
export const SIZES: Record<WidgetType, { w: number; h: number; minW: number; minH: number }> = {
  clock: { w: 4, h: 4, minW: 2, minH: 2 },
  weather: { w: 4, h: 4, minW: 2, minH: 3 },
  note: { w: 4, h: 5, minW: 2, minH: 2 },
  tasks: { w: 4, h: 6, minW: 2, minH: 3 },
  page: { w: 6, h: 9, minW: 2, minH: 3 },
  pages: { w: 4, h: 6, minW: 2, minH: 3 },
  agenda: { w: 4, h: 9, minW: 2, minH: 3 },
  cameras: { w: 6, h: 7, minW: 2, minH: 3 },
  smarthome: { w: 6, h: 8, minW: 2, minH: 3 },
  homelab: { w: 8, h: 9, minW: 2, minH: 3 },
  links: { w: 4, h: 4, minW: 1, minH: 2 },
  image: { w: 4, h: 5, minW: 1, minH: 2 },
  web: { w: 6, h: 9, minW: 2, minH: 3 },
  search: { w: 6, h: 2, minW: 2, minH: 2 },
  wol: { w: 4, h: 3, minW: 2, minH: 2 },
  wifi: { w: 4, h: 6, minW: 2, minH: 3 },
  papers: { w: 4, h: 5, minW: 3, minH: 3 },
};

/** Texte d'une note rapide et tâches d'une liste (un type Yjs par widget). */
export const noteText = (doc: Y.Doc, widgetId: string) => doc.getText(`dash-note:${widgetId}`);
export const taskMap = (doc: Y.Doc, widgetId: string) => doc.getMap<string>(`dash-tasks:${widgetId}`);

function readData(doc: Y.Doc): DashboardData | null {
  try {
    const raw = doc.getMap('dashboard').get('config');
    if (typeof raw !== 'string') return null;
    const d = JSON.parse(raw) as Partial<DashboardData>;
    const widgets = (Array.isArray(d.widgets) ? d.widgets : []).filter((w) => w && typeof w.id === 'string' && w.type in SIZES);
    return { widgets: widgets.map((w) => ({ ...w, config: w.config ?? {} })), layouts: d.layouts ?? {} };
  } catch {
    return null;
  }
}

function writeData(doc: Y.Doc, data: DashboardData) {
  doc.getMap('dashboard').set('config', JSON.stringify(data));
}

/** Place un widget en bas de chaque disposition existante, à une taille adaptée à ses colonnes. */
function placeEverywhere(layouts: Layouts, widget: Widget): Layouts {
  const size = SIZES[widget.type];
  const out: Layouts = {};
  for (const bp of Object.keys(COLS) as Breakpoint[]) {
    const items = layouts[bp];
    if (!items && bp !== 'lg') continue;
    const list = items ?? [];
    const cols = COLS[bp];
    const w = Math.max(Math.min(size.minW, cols), Math.min(cols, Math.round((size.w * cols) / 12)));
    const bottom = list.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    out[bp] = [...list, { i: widget.id, x: 0, y: bottom, w, h: size.h }];
  }
  return out;
}

/**
 * Tableau de bord de départ : horloge, météo, agenda, pages, note rapide, tâches, puis ce qui est déjà configuré
 * (caméras, maison, homelab). Identifiants fixes : deux appareils qui le créent en même temps créent le même.
 */
export function defaultDashboard(doc: Y.Doc): DashboardData {
  const configured = (map: string, test: (cfg: Record<string, unknown>) => boolean) => {
    try {
      return test(JSON.parse(String(doc.getMap(map).get('config') ?? '{}')) as Record<string, unknown>);
    } catch {
      return false;
    }
  };
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const w = (type: WidgetType, config: Record<string, unknown> = {}): Widget => ({ id: `home-${type}`, type, config });
  const widgets = [
    w('clock', { date: true, greeting: true }),
    w('weather'),
    w('agenda', { days: 14 }),
    w('pages', { mode: 'recent' }),
    w('note'),
    w('tasks'),
  ];
  // Trois colonnes : horloge et pages, météo et note, agenda et tâches.
  const lg: GridItem[] = [
    { i: widgets[0].id, x: 0, y: 0, w: 4, h: 4 },
    { i: widgets[1].id, x: 4, y: 0, w: 4, h: 4 },
    { i: widgets[2].id, x: 8, y: 0, w: 4, h: 5 },
    { i: widgets[3].id, x: 0, y: 4, w: 4, h: 6 },
    { i: widgets[4].id, x: 4, y: 4, w: 4, h: 6 },
    { i: widgets[5].id, x: 8, y: 5, w: 4, h: 5 },
  ];
  let data: DashboardData = { widgets, layouts: { lg } };
  const extra: [WidgetType, Record<string, unknown>][] = [];
  if (configured('cameras', (c) => count(c.cameras) > 0)) extra.push(['cameras', {}]);
  if (configured('smarthome', (c) => Boolean(c.url && c.token))) extra.push(['smarthome', { favoritesOnly: true }]);
  if (configured('homelab', (c) => count(c.services) + count(c.devices) > 0)) extra.push(['homelab', {}]);
  for (const [type, config] of extra) {
    const widget = w(type, config);
    data = { widgets: [...data.widgets, widget], layouts: placeEverywhere(data.layouts, widget) };
  }
  return data;
}

/** Tableau de bord enregistré, sinon celui de départ (enregistré à la première modification). */
function current(doc: Y.Doc): DashboardData {
  return readData(doc) ?? defaultDashboard(doc);
}

export function addWidget(doc: Y.Doc, type: WidgetType, config: Record<string, unknown> = {}): string {
  const data = current(doc);
  const widget: Widget = { id: newId(), type, config };
  writeData(doc, { widgets: [...data.widgets, widget], layouts: placeEverywhere(data.layouts, widget) });
  return widget.id;
}

export function removeWidget(doc: Y.Doc, id: string) {
  const data = current(doc);
  const widget = data.widgets.find((w) => w.id === id);
  const layouts: Layouts = {};
  for (const [bp, items] of Object.entries(data.layouts) as [Breakpoint, GridItem[]][]) layouts[bp] = items.filter((it) => it.i !== id);
  doc.transact(() => {
    writeData(doc, { widgets: data.widgets.filter((w) => w.id !== id), layouts });
    // Contenu propre au widget : vidé (les types Yjs de premier niveau ne peuvent pas être supprimés).
    if (widget?.type === 'note') {
      const text = noteText(doc, id);
      if (text.length) text.delete(0, text.length);
    } else if (widget?.type === 'tasks') {
      const map = taskMap(doc, id);
      for (const key of [...map.keys()]) map.delete(key);
    }
  });
}

export function updateWidget(doc: Y.Doc, id: string, change: (w: Widget) => Widget) {
  const data = current(doc);
  writeData(doc, { ...data, widgets: data.widgets.map((w) => (w.id === id ? change(w) : w)) });
}

const sameLayouts = (a: Layouts, b: Layouts) => {
  const norm = (l: Layouts) =>
    JSON.stringify(
      (Object.keys(COLS) as Breakpoint[]).map((bp) =>
        l[bp] ? [...l[bp]!].sort((x, y) => x.i.localeCompare(y.i)).map(({ i, x, y, w, h }) => [i, x, y, w, h]) : null,
      ),
    );
  return norm(a) === norm(b);
};

/** Enregistre les dispositions (après un déplacement ou un redimensionnement), seulement si elles ont changé. */
export function saveLayouts(doc: Y.Doc, layouts: Layouts) {
  const data = current(doc);
  const clean: Layouts = {};
  for (const [bp, items] of Object.entries(layouts) as [Breakpoint, GridItem[]][]) {
    if (!(bp in COLS) || !items) continue;
    clean[bp] = items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  }
  if (sameLayouts(clean, data.layouts) && readData(doc)) return;
  writeData(doc, { ...data, layouts: clean });
}

/** Enregistre la disposition d'une taille d'écran après un déplacement ou un redimensionnement. */
export function saveLayout(doc: Y.Doc, bp: Breakpoint, items: readonly GridItem[]) {
  saveLayouts(doc, { ...current(doc).layouts, [bp]: [...items] });
}

/** Revient au tableau de bord de départ. */
export function resetDashboard(doc: Y.Doc) {
  writeData(doc, defaultDashboard(doc));
}

/**
 * Tableau de bord suivi en direct. Tant qu'il n'est pas enregistré, celui de départ est affiché ; il n'est enregistré
 * d'office que si `canCreate` (document synchronisé avec le serveur, ou pas de serveur) pour ne pas remplacer celui
 * qu'un autre appareil aurait déjà enregistré.
 */
export function useDashboard(doc: Y.Doc, canCreate: boolean): DashboardData {
  const [data, setData] = useState<DashboardData>(() => current(doc));
  useEffect(() => {
    const map = doc.getMap('dashboard');
    const read = () => setData(current(doc));
    map.observe(read);
    read();
    return () => map.unobserve(read);
  }, [doc]);
  useEffect(() => {
    if (canCreate && !readData(doc)) writeData(doc, defaultDashboard(doc));
  }, [doc, canCreate]);
  return data;
}
