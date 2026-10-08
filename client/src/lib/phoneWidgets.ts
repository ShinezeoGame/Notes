// Widgets de l'écran d'accueil du téléphone et raccourcis du lanceur (application Android, plugin natif « Widgets ») :
// l'application leur envoie les listes de tâches et les ordinateurs de l'accueil, les raccourcis choisis et de quoi
// joindre le serveur (les widgets cochent, ajoutent et allument par le serveur, même Ostal fermé). Sans serveur, ou
// hors ligne, ce qui est fait sur un widget est rejoué ici à la prochaine ouverture d'Ostal.
import type * as Y from 'yjs';
import { serverBase } from './api';
import { callNative, hasNativePlugin } from './native';
import { getSettings, isNative, subscribeSettings } from './settings';
import { getLang, t } from './i18n';
import { appliedAppearance, onAppearanceApplied, readableOn, themeOf } from './appearance';
import { current as currentDashboard, taskMap } from '../dashboard/model';
import type { IconName } from '../icons/registry';

const NATIVE = 'Widgets'; // i18n-ignore
export const MAX_PHONE_SHORTCUTS = 6;
/** Raccourcis aussi proposés en appui long sur l'icône d'Ostal (les premiers choisis). */
export const LAUNCHER_SHORTCUTS = 4;

/** `icon` : dessin du widget Android (res/drawable/ic_w_…) ; `appIcon` : le même dans l'application. */
export type PhoneShortcut = { id: string; label: string; url: string; icon: string; appIcon: IconName; needsServer?: boolean };
export type WidgetKind = 'shortcuts' | 'tasks' | 'wake' | 'seerr';

/** Raccourcis possibles, dans la langue de l'application (icônes : res/drawable/ic_w_… de l'application Android). */
export function phoneShortcuts(): PhoneShortcut[] {
  return [
    { id: 'newPage', label: t('Nouvelle page'), url: '#/nouvelle-page', icon: 'new_page', appIcon: 'filePlus' },
    { id: 'notes', label: t('Notes'), url: '#/notes', icon: 'notes', appIcon: 'note' },
    { id: 'agenda', label: t('Agenda'), url: '#/agenda', icon: 'agenda', appIcon: 'calendar' },
    { id: 'papers', label: t('Papiers'), url: '#/papiers', icon: 'papers', appIcon: 'papers', needsServer: true },
    { id: 'newPaper', label: t('Ajouter un papier'), url: '#/papiers/nouveau', icon: 'camera', appIcon: 'camera', needsServer: true },
    { id: 'pdf', label: t('Atelier PDF'), url: '#/pdf', icon: 'pdf', appIcon: 'filePdf' },
    { id: 'smarthome', label: t('Maison'), url: '#/maison', icon: 'home', appIcon: 'bulb', needsServer: true },
    { id: 'cameras', label: t('Caméras'), url: '#/cameras', icon: 'cameras', appIcon: 'cctv', needsServer: true },
    { id: 'homelab', label: t('Homelab'), url: '#/homelab', icon: 'homelab', appIcon: 'server', needsServer: true },
    { id: 'media', label: t('Films et séries'), url: '#/films', icon: 'media', appIcon: 'film', needsServer: true },
    { id: 'home', label: t('Accueil'), url: '#/', icon: 'dashboard', appIcon: 'dashboard' },
  ];
}

/** Raccourcis choisis sur ce téléphone ; par défaut : nouvelle page, agenda, papiers (avec un serveur), atelier PDF. */
export function chosenShortcuts(): PhoneShortcut[] {
  const all = phoneShortcuts().filter((s) => !s.needsServer || serverBase());
  const ids = getSettings().phoneShortcuts.length ? getSettings().phoneShortcuts : ['newPage', 'agenda', serverBase() ? 'papers' : 'notes', 'pdf'];
  return ids.map((id) => all.find((s) => s.id === id)).filter((s): s is PhoneShortcut => Boolean(s)).slice(0, MAX_PHONE_SHORTCUTS);
}

// ---------- Couleurs des widgets ----------

/** Fonds proposés pour des couleurs personnalisées (vide : celui du thème d'Ostal). */
export function widgetBackgrounds(): { color: string; label: string }[] {
  return [
    { color: '', label: t('Comme Ostal') },
    { color: '#1c1c1f', label: t('Sombre') },
    { color: '#000000', label: t('Noir') },
    { color: '#16233d', label: t('Bleu nuit') },
    { color: '#1a2c22', label: t('Forêt') },
    { color: '#2e1f4d', label: t('Prune') },
    { color: '#ffffff', label: t('Clair') },
    { color: '#f7f3ea', label: t('Crème') },
    { color: '#efeaff', label: t('Lavande') },
  ];
}

const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
/** Mélange de deux couleurs : `t` de la première. */
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [channels(a), channels(b)];
  return toHex(x.map((v, i) => v * t + y[i] * (1 - t)));
};
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
/** « #AARRGGBB » (format des couleurs Android), opacité en %. */
const argb = (hex: string, opacity = 100) => `#${Math.round((Math.min(100, Math.max(0, opacity)) * 255) / 100).toString(16).padStart(2, '0')}${hex.slice(1)}`.toUpperCase();

/**
 * Couleurs envoyées aux widgets : thème et accent d'Ostal, ou fond et couleur choisis ; null : couleurs claires ou
 * sombres du téléphone. Texte lisible sur le fond, icônes de la couleur d'accent assez contrastées.
 */
export function widgetColors(): Record<string, string> | null {
  const s = getSettings();
  if (s.phoneWidgetTheme === 'phone') return null;
  const a = appliedAppearance();
  const p = themeOf(a).palette;
  const custom = s.phoneWidgetTheme === 'custom';
  const bg = custom && isHex(s.phoneWidgetBg) ? s.phoneWidgetBg.toLowerCase() : p.elevated;
  const accent = custom && isHex(s.phoneWidgetAccent) ? s.phoneWidgetAccent.toLowerCase() : a.accent;
  const own = bg === p.elevated;
  const dark = readableOn(bg) === '#ffffff';
  const text = own ? p.strong : dark ? '#ffffff' : '#1c1b1f';
  const muted = own ? p.muted : mix(text, bg, 0.62);
  // Icônes et états : la couleur d'accent, rapprochée du texte tant qu'elle se lit mal sur le fond.
  let icon = accent;
  for (let k = 0.85; contrast(icon, bg) < 3 && k > 0; k -= 0.15) icon = mix(accent, text, k);
  const opacity = custom ? Math.min(100, Math.max(30, s.phoneWidgetOpacity)) : Math.max(70, a.widgetOpacity);
  return {
    bg: argb(bg, opacity),
    tile: argb(mix(accent, bg, dark ? 0.26 : 0.14)),
    text: argb(text),
    muted: argb(muted),
    icon: argb(icon),
    accent: argb(accent),
    onAccent: argb(readableOn(accent)),
    check: argb(mix(text, bg, 0.45)),
  };
}

// ---------- Données des widgets (même lecture que le serveur : server/src/widgets.js) ----------

export type TaskList = { id: string; title: string; hideDone: boolean; items: { id: string; text: string; done: boolean }[] };
export type Computer = { id: string; name: string; mac: string; host: string; broadcast: string };
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Widgets de l'accueil (celui de départ tant qu'il n'est pas enregistré). */
const dashboardWidgets = (doc: Y.Doc) => currentDashboard(doc).widgets;

function readTasks(doc: Y.Doc, listId: string) {
  const all: { id: string; text: string; done: boolean; order: number; doneAt: number }[] = [];
  taskMap(doc, listId).forEach((raw, id) => {
    try {
      const v = JSON.parse(raw) as Record<string, unknown>;
      all.push({ id, text: String(v.text ?? ''), done: Boolean(v.done), order: Number(v.order) || 0, doneAt: Number(v.doneAt) || 0 });
    } catch {
      /* entrée illisible ignorée */
    }
  });
  const todo = all.filter((x) => !x.done).sort((a, b) => a.order - b.order);
  const done = all.filter((x) => x.done).sort((a, b) => b.doneAt - a.doneAt);
  return [...todo, ...done].slice(0, 50).map(({ id, text, done: d }) => ({ id, text, done: d }));
}

/** Listes de tâches de l'accueil (titre vide : titre par défaut). */
export function taskLists(doc: Y.Doc): TaskList[] {
  return dashboardWidgets(doc)
    .filter((w) => w.type === 'tasks')
    .map((w) => ({ id: w.id, title: str(w.title).trim(), hideDone: Boolean(w.config?.hideDone), items: readTasks(doc, w.id) }));
}

/** Ordinateurs réglés sur l'accueil (widget « Allumer un PC »). */
export function computers(doc: Y.Doc): Computer[] {
  return dashboardWidgets(doc)
    .filter((w) => w.type === 'wol' && str(w.config?.mac))
    .map((w) => ({ id: w.id, name: str(w.title).trim() || str(w.config?.name).trim(), mac: str(w.config?.mac), host: str(w.config?.host), broadcast: str(w.config?.broadcast) }));
}

// ---------- Actions faites sur les widgets sans serveur joignable ----------

type WidgetAction = { type: 'done' | 'add'; list: string; task: string; done?: boolean; text?: string; at?: number };

/** Rejoue les actions faites sur les widgets (une tâche cochée, ajoutée) dans le document de l'espace. */
export function applyWidgetActions(doc: Y.Doc, actions: WidgetAction[]) {
  const lists = new Set(taskLists(doc).map((l) => l.id));
  doc.transact(() => {
    for (const a of actions) {
      if (!a || !lists.has(a.list) || typeof a.task !== 'string' || !a.task) continue;
      const map = taskMap(doc, a.list);
      if (a.type === 'done') {
        const raw = map.get(a.task);
        if (typeof raw !== 'string') continue;
        try {
          const v = JSON.parse(raw) as Record<string, unknown>;
          const done = Boolean(a.done);
          map.set(a.task, JSON.stringify({ text: String(v.text ?? ''), done, order: Number(v.order) || 0, doneAt: done ? Number(a.at) || Date.now() : 0 }));
        } catch {
          /* entrée illisible ignorée */
        }
      } else if (a.type === 'add' && !map.has(a.task) && str(a.text).trim()) {
        let order = 0;
        map.forEach((raw) => {
          try {
            order = Math.max(order, Number((JSON.parse(raw) as Record<string, unknown>).order) || 0);
          } catch {
            /* entrée illisible ignorée */
          }
        });
        map.set(a.task, JSON.stringify({ text: str(a.text).trim(), done: false, order: order + 1, doneAt: 0 }));
      }
    }
  });
}

// ---------- Synchronisation avec l'application Android ----------

export const phoneWidgetsAvailable = () => isNative() && hasNativePlugin(NATIVE);

let started = false;
let lastSent = '';

async function takeActions(doc: Y.Doc) {
  const r = await callNative<{ actions?: WidgetAction[] }>(NATIVE, 'takeActions').catch(() => null);
  if (r?.actions?.length) applyWidgetActions(doc, r.actions);
}

/** Réglages et données envoyés au téléphone (seulement s'ils ont changé). */
async function send(doc: Y.Doc, force = false) {
  const s = getSettings();
  const payload = {
    serverUrl: serverBase() ?? '',
    wsId: s.workspaceId,
    key: s.workspaceKey,
    lang: getLang(),
    shortcuts: chosenShortcuts().map(({ id, label, url, icon }) => ({ id, label, url, icon })),
    taskList: s.phoneTaskList,
    data: { tasks: taskLists(doc), computers: computers(doc) },
    colors: widgetColors(),
  };
  const json = JSON.stringify(payload);
  if (json === lastSent && !force) return;
  lastSent = json;
  await callNative(NATIVE, 'configure', payload).catch(() => {
    lastSent = '';
  });
}

/** Démarrage d'Ostal sur le téléphone : actions des widgets rejouées, puis widgets tenus à jour. */
export function startPhoneWidgets(doc: Y.Doc) {
  if (started || !phoneWidgetsAvailable()) return;
  started = true;
  let timer = 0;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void send(doc), 400);
  };
  // Actions d'abord : sinon le widget réafficherait un instant l'état d'avant.
  const sync = async () => {
    await takeActions(doc);
    await send(doc);
  };
  void sync();
  doc.on('update', later);
  subscribeSettings(later);
  // Thème ou couleur d'accent changés : couleurs des widgets refaites.
  onAppearanceApplied(later);
  // Retour dans Ostal après avoir utilisé un widget : ses actions sont appliquées.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync();
  });
}

// ---------- Réglages → Widgets du téléphone ----------

/**
 * `placed.seerr` absent : application Android d'avant le widget « Films et séries » ; `colors` absent : d'avant les
 * couleurs des widgets, faux : Android 11 ou plus ancien (couleurs du téléphone seulement).
 */
export type WidgetsInfo = {
  placed: Record<Exclude<WidgetKind, 'seerr'>, number> & { seerr?: number };
  pinWidgets: boolean;
  pinShortcuts: boolean;
  colors?: boolean;
};

export const widgetsInfo = () => callNative<WidgetsInfo>(NATIVE, 'info');

/** Ajout d'un widget à l'écran d'accueil (le téléphone demande confirmation) ; faux si le lanceur ne le permet pas. */
export async function pinWidget(kind: WidgetKind): Promise<boolean> {
  return (await callNative<{ requested?: boolean }>(NATIVE, 'pin', { kind })).requested === true;
}

/** Un raccourci seul (icône « Atelier PDF »…) posé sur l'écran d'accueil. */
export async function pinShortcut(s: PhoneShortcut): Promise<boolean> {
  return (await callNative<{ requested?: boolean }>(NATIVE, 'pinShortcut', { id: s.id, label: s.label, url: s.url, icon: s.icon })).requested === true;
}
