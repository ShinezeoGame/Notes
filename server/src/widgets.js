// Widgets de l'écran d'accueil du téléphone (application Android) : listes de tâches et ordinateurs à allumer, lus
// dans le document de l'espace (widgets « Tâches » et « Allumer un PC » de l'accueil d'Ostal), et tâches cochées ou
// ajoutées depuis le téléphone, même application fermée. Les modifications passent par le document en mémoire : les
// appareils connectés les reçoivent aussitôt, et il est enregistré comme après une modification dans l'application.
import crypto from 'node:crypto';
import { docsPaused, getDoc, wsRoom } from './ws.js';

/** Tâches envoyées au téléphone par liste, et longueur d'une tâche (comme dans l'application). */
const MAX_TASKS = 50;
const MAX_TEXT = 500;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Widgets de l'accueil (map « dashboard », clé « config »). Pas encore enregistré (accueil jamais ouvert) : celui de
 * départ de l'application (client/src/dashboard/model.ts), dont la liste de tâches « home-tasks ».
 */
function dashboardWidgets(doc) {
  try {
    const raw = doc.getMap('dashboard').get('config');
    if (typeof raw !== 'string') return [{ id: 'home-tasks', type: 'tasks', config: {} }];
    const d = JSON.parse(raw);
    return Array.isArray(d.widgets) ? d.widgets.filter((w) => w && typeof w.id === 'string' && typeof w.type === 'string') : [];
  } catch {
    return [];
  }
}

/** Tâches d'une liste, dans l'ordre de l'application : à faire (ordre choisi), puis faites (les plus récentes d'abord). */
export function readTasks(doc, listId) {
  const all = [];
  doc.getMap(`dash-tasks:${listId}`).forEach((raw, id) => {
    try {
      const t = JSON.parse(raw);
      all.push({ id, text: String(t.text ?? ''), done: Boolean(t.done), order: Number(t.order) || 0, doneAt: Number(t.doneAt) || 0 });
    } catch {
      /* entrée illisible ignorée */
    }
  });
  const todo = all.filter((t) => !t.done).sort((a, b) => a.order - b.order);
  const done = all.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
  return [...todo, ...done].slice(0, MAX_TASKS).map(({ id, text, done: d }) => ({ id, text, done: d }));
}

/**
 * Données des widgets : listes de tâches (titre vide : titre par défaut) et ordinateurs réglés. Les ordinateurs
 * seulement pour le propriétaire du serveur (`host`) : le signal part de son réseau.
 */
export function widgetData(doc, { host }) {
  const widgets = dashboardWidgets(doc);
  const tasks = widgets
    .filter((w) => w.type === 'tasks')
    .map((w) => ({ id: w.id, title: str(w.title).trim(), hideDone: Boolean(w.config?.hideDone), items: readTasks(doc, w.id) }));
  const computers = host
    ? widgets
        .filter((w) => w.type === 'wol' && str(w.config?.mac))
        .map((w) => ({ id: w.id, name: str(w.title).trim() || str(w.config.name).trim(), mac: str(w.config.mac), host: str(w.config.host), broadcast: str(w.config.broadcast) }))
    : [];
  return { tasks, computers };
}

/** Document de l'espace prêt à être modifié, et la liste de tâches demandée (qui doit exister sur l'accueil). */
async function taskList(wsId, listId) {
  if (docsPaused()) throw httpError(503, 'Restauration en cours : réessayez dans un instant.');
  if (!ID_RE.test(listId)) throw httpError(400, 'Liste de tâches invalide.');
  const doc = getDoc(wsRoom(wsId));
  await doc.whenLoaded;
  if (!dashboardWidgets(doc).some((w) => w.id === listId && w.type === 'tasks')) throw httpError(404, 'Cette liste de tâches n’existe plus.');
  return { doc, map: doc.getMap(`dash-tasks:${listId}`) };
}

/** Coche ou décoche une tâche ; renvoie la liste à jour. */
export async function setTaskDone(wsId, listId, taskId, done) {
  const { doc, map } = await taskList(wsId, listId);
  const raw = ID_RE.test(taskId) ? map.get(taskId) : undefined;
  let task;
  try {
    task = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    task = null;
  }
  if (!task) throw httpError(404, 'Cette tâche n’existe plus.');
  if (Boolean(task.done) !== done) {
    const next = { text: String(task.text ?? ''), done, order: Number(task.order) || 0, doneAt: done ? Date.now() : 0 };
    doc.transact(() => map.set(taskId, JSON.stringify(next)), 'widget');
  }
  return readTasks(doc, listId);
}

/** Ajoute une tâche à la fin des tâches à faire ; renvoie son identifiant et la liste à jour. */
export async function addTask(wsId, listId, text, id) {
  const clean = str(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!clean) throw httpError(400, 'Tâche vide.');
  const { doc, map } = await taskList(wsId, listId);
  // Identifiant choisi par le téléphone (tâche déjà affichée par le widget) : ajout fait une seule fois.
  const taskId = ID_RE.test(str(id)) ? id : crypto.randomUUID();
  if (!map.has(taskId)) {
    let order = 0;
    map.forEach((raw) => {
      try {
        order = Math.max(order, Number(JSON.parse(raw).order) || 0);
      } catch {
        /* entrée illisible ignorée */
      }
    });
    doc.transact(() => map.set(taskId, JSON.stringify({ text: clean, done: false, order: order + 1, doneAt: 0 })), 'widget');
  }
  return { id: taskId, items: readTasks(doc, listId) };
}
