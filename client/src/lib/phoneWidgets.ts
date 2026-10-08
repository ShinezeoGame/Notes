// Widgets de l'écran d'accueil du téléphone et raccourcis du lanceur (application Android, plugin natif « Widgets ») :
// l'application leur envoie les listes de tâches et les ordinateurs de l'accueil, les raccourcis choisis et de quoi
// joindre le serveur (les widgets cochent, ajoutent et allument par le serveur, même Ostal fermé). Sans serveur, ou
// hors ligne, ce qui est fait sur un widget est rejoué ici à la prochaine ouverture d'Ostal.
import type * as Y from 'yjs';
import { serverBase } from './api';
import { callNative, hasNativePlugin } from './native';
import { getSettings, isNative, subscribeSettings } from './settings';
import { getLang, t } from './i18n';
import { current as currentDashboard, taskMap } from '../dashboard/model';
import type { IconName } from '../icons/registry';

const NATIVE = 'Widgets'; // i18n-ignore
export const MAX_PHONE_SHORTCUTS = 6;
/** Raccourcis aussi proposés en appui long sur l'icône d'Ostal (les premiers choisis). */
export const LAUNCHER_SHORTCUTS = 4;

/** `icon` : dessin du widget Android (res/drawable/ic_w_…) ; `appIcon` : le même dans l'application. */
export type PhoneShortcut = { id: string; label: string; url: string; icon: string; appIcon: IconName; needsServer?: boolean };
export type WidgetKind = 'shortcuts' | 'tasks' | 'wake';

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
    { id: 'home', label: t('Accueil'), url: '#/', icon: 'dashboard', appIcon: 'dashboard' },
  ];
}

/** Raccourcis choisis sur ce téléphone ; par défaut : nouvelle page, agenda, papiers (avec un serveur), atelier PDF. */
export function chosenShortcuts(): PhoneShortcut[] {
  const all = phoneShortcuts().filter((s) => !s.needsServer || serverBase());
  const ids = getSettings().phoneShortcuts.length ? getSettings().phoneShortcuts : ['newPage', 'agenda', serverBase() ? 'papers' : 'notes', 'pdf'];
  return ids.map((id) => all.find((s) => s.id === id)).filter((s): s is PhoneShortcut => Boolean(s)).slice(0, MAX_PHONE_SHORTCUTS);
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
  // Retour dans Ostal après avoir utilisé un widget : ses actions sont appliquées.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync();
  });
}

// ---------- Réglages → Widgets du téléphone ----------

export type WidgetsInfo = { placed: Record<WidgetKind, number>; pinWidgets: boolean; pinShortcuts: boolean };

export const widgetsInfo = () => callNative<WidgetsInfo>(NATIVE, 'info');

/** Ajout d'un widget à l'écran d'accueil (le téléphone demande confirmation) ; faux si le lanceur ne le permet pas. */
export async function pinWidget(kind: WidgetKind): Promise<boolean> {
  return (await callNative<{ requested?: boolean }>(NATIVE, 'pin', { kind })).requested === true;
}

/** Un raccourci seul (icône « Atelier PDF »…) posé sur l'écran d'accueil. */
export async function pinShortcut(s: PhoneShortcut): Promise<boolean> {
  return (await callNative<{ requested?: boolean }>(NATIVE, 'pinShortcut', { id: s.id, label: s.label, url: s.url, icon: s.icon })).requested === true;
}
