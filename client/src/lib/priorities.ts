// Page « Priorités » (section Perso) : mails, événements de l'agenda et tâches de l'accueil classés par urgence. Règles
// simples et prévisibles, sans IA : rien ne quitte le serveur de l'utilisateur.
import type { AgendaEvent } from './agenda';
import type { TaskList } from './phoneWidgets';

export type Mail = { id: string; from: string; subject: string; date: string; unread: boolean; flagged: boolean; important: boolean; link: string };

export type Bucket = 'urgent' | 'today' | 'week' | 'later';
export const BUCKETS: Bucket[] = ['urgent', 'today', 'week', 'later'];

export type Priority =
  | { kind: 'event'; key: string; bucket: Bucket; at: number; event: AgendaEvent }
  | { kind: 'mail'; key: string; bucket: Bucket; at: number; mail: Mail }
  | { kind: 'task'; key: string; bucket: Bucket; at: number; list: TaskList; task: TaskList['items'][number] };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Mots d'un message ou d'une tâche qui pressent (sans accents ni majuscules). */
const URGENT_WORDS = /\b(urgent|urgence|asap|relance|dernier rappel|mise en demeure|action requise|action required|impaye|echeance|deadline|immediat)/;
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const looksUrgent = (s: string) => URGENT_WORDS.test(plain(s));

function eventBucket(ev: AgendaEvent, now: number): Bucket | null {
  const s = new Date(ev.start).getTime();
  const e = Math.max(new Date(ev.end).getTime(), s + 1);
  if (e <= now) return null;
  if (!ev.allDay && s - now <= 3 * HOUR) return 'urgent';
  const endOfDay = new Date(now).setHours(24, 0, 0, 0);
  if (s < endOfDay) return 'today';
  return s - now <= 7 * DAY ? 'week' : null;
}

function mailBucket(m: Mail, now: number): Bucket | null {
  if (m.flagged || (m.unread && looksUrgent(m.subject))) return 'urgent';
  if (!m.unread) return null;
  return m.important || now - new Date(m.date).getTime() < DAY ? 'today' : 'week';
}

/** Tâche urgente : mot qui presse, ou « ! » au début ou à la fin (« ! payer le loyer »). */
const taskBucket = (text: string): Bucket => (looksUrgent(text) || /^\s*!|!\s*$/.test(text) ? 'urgent' : 'later');

const KIND_ORDER = { event: 0, mail: 1, task: 2 };

/**
 * Éléments classés : par seau d'urgence, puis événements (par heure), mails (plus récents d'abord), tâches (ordre de la
 * liste). Jours fériés et vacances scolaires exclus : rien à faire.
 */
export function prioritize(input: { events: AgendaEvent[]; mails: Mail[]; lists: TaskList[]; now?: number }): Priority[] {
  const now = input.now ?? Date.now();
  const out: Priority[] = [];
  for (const event of input.events) {
    if (event.kind) continue;
    const bucket = eventBucket(event, now);
    if (bucket) out.push({ kind: 'event', key: `e:${event.calendarId}:${event.id}:${event.start}`, bucket, at: new Date(event.start).getTime(), event });
  }
  for (const mail of input.mails) {
    const bucket = mailBucket(mail, now);
    if (bucket) out.push({ kind: 'mail', key: `m:${mail.id}`, bucket, at: -new Date(mail.date).getTime(), mail });
  }
  let order = 0;
  for (const list of input.lists) {
    for (const task of list.items) {
      if (!task.done) out.push({ kind: 'task', key: `t:${list.id}:${task.id}`, bucket: taskBucket(task.text), at: order++, list, task });
    }
  }
  return out.sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.at - b.at);
}
