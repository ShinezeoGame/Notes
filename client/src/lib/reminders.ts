// Rappels sur cet appareil : échéances des papiers et événements des agendas, calculés par le serveur Ostal
// (server/src/reminders.js). Selon l'appareil :
// - application Android : rappels programmés par l'application (alarmes du téléphone), même Ostal fermé ;
// - navigateur qui le permet (ordinateur, Android, iPhone avec Ostal sur l'écran d'accueil) : notifications push
//   envoyées par le serveur, même Ostal fermé ;
// - application Windows, autres navigateurs : tant qu'Ostal est ouvert, même réduit.
// Choix propre à chaque appareil (réglages locaux).
import type * as Y from 'yjs';
import { api, serverBase, type Reminder } from './api';
import { callNative, hasNativePlugin, onNative } from './native';
import { getSettings, isNative, updateSettings } from './settings';
import { isDesktop } from './desktop';
import { navigate } from './router';
import { getLang, t } from './i18n';

const NATIVE = 'Reminders'; // i18n-ignore
const ICON = 'icons/app-192.png';

export type ReminderMode = 'native' | 'push' | 'page';

/** Moyen possible sur cet appareil (null : aucun, voir reminderHelp). */
export function reminderSupport(): ReminderMode | null {
  if (isNative()) return hasNativePlugin(NATIVE) ? 'native' : null;
  if (isDesktop()) return 'Notification' in window ? 'page' : null;
  // Navigateur : notifications seulement sur une adresse sécurisée (https, ou cet ordinateur).
  if (!('Notification' in window) || !window.isSecureContext) return null;
  if ('serviceWorker' in navigator && 'PushManager' in window) return 'push';
  return 'page';
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

/** Pourquoi les rappels ne sont pas possibles ici, et comment faire. */
export function reminderHelp(): string {
  if (isNative()) return t('Installez la dernière version de l’application Android pour recevoir les rappels.');
  if (!window.isSecureContext)
    return t('Les navigateurs n’affichent les notifications que sur une adresse sécurisée (https://). Utilisez l’application Android ou Windows, ou une adresse https pour votre serveur (voir le guide d’installation).');
  if (isIos())
    return t('Sur iPhone et iPad : ajoutez Ostal à l’écran d’accueil (bouton Partager → « Sur l’écran d’accueil »), ouvrez-le depuis son icône, puis activez les rappels.');
  return t('Ce navigateur n’affiche pas de notifications. Essayez Chrome, Edge, Firefox ou Safari.');
}

/** Notifications autorisées pour Ostal sur cet appareil (navigateur) ; null : pas encore demandé. */
export function browserPermission(): 'granted' | 'denied' | null {
  if (!('Notification' in window)) return null;
  return Notification.permission === 'default' ? null : Notification.permission;
}

// ---------- Application Android ----------

function configureNative(enabled: boolean) {
  const s = getSettings();
  return callNative(NATIVE, 'configure', { serverUrl: serverBase() ?? '', wsId: s.workspaceId, key: s.workspaceKey, lang: getLang(), enabled });
}

// ---------- Notifications push ----------

const fromB64u = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

function sameKey(buf: ArrayBuffer | null, key: string): boolean {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  const b = fromB64u(key);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('service worker')), 10_000)), // i18n-ignore
  ]);
  return reg;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Abonne cet appareil aux notifications du serveur (refait si la clé du serveur a changé) et l'enregistre. */
async function subscribePush(): Promise<PushSubscription> {
  const reg = await registration();
  const { key } = await api.pushKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
  await api.pushSubscribe(sub.toJSON(), getLang());
  return sub;
}

// ---------- Page ouverte ----------

const SHOWN_KEY = 'notes.reminders.shown';
let pageTimers: number[] = [];
let pageLoop: number | null = null;

/** Rappels déjà affichés par une page (clé → heure), pour ne pas les répéter. */
function shown(): Record<string, number> {
  try {
    const all = JSON.parse(localStorage.getItem(SHOWN_KEY) || '{}') as Record<string, number>;
    const old = Date.now() - 3 * 86_400_000;
    return Object.fromEntries(Object.entries(all).filter(([, at]) => at > old));
  } catch {
    return {};
  }
}

function markShown(key: string, at: number) {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ ...shown(), [key]: at }));
  } catch {
    /* stockage indisponible */
  }
}

/** Affiche une notification depuis la page (service worker quand il y en a un : seul moyen sur Android). */
export async function showNotification(r: Pick<Reminder, 'key' | 'title' | 'body' | 'url'>) {
  if (!isDesktop() && navigator.serviceWorker?.controller) {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(r.title, { body: r.body, tag: r.key, data: { url: r.url }, icon: ICON });
    return;
  }
  const n = new Notification(r.title, { body: r.body, tag: r.key, icon: ICON });
  n.onclick = () => {
    window.focus();
    if (r.url) navigate(r.url);
    n.close();
  };
}

async function planPage() {
  for (const id of pageTimers) clearTimeout(id);
  pageTimers = [];
  const s = getSettings();
  if (!s.reminders || s.remindersMode !== 'page' || browserPermission() !== 'granted') return;
  let list: Reminder[];
  try {
    list = (await api.reminders(12, getLang())).reminders;
  } catch {
    return;
  }
  const done = shown();
  for (const r of list) {
    if (done[r.key]) continue;
    pageTimers.push(
      window.setTimeout(
        () => {
          if (shown()[r.key]) return;
          markShown(r.key, r.at);
          void showNotification(r).catch(() => {});
        },
        Math.max(0, r.at - Date.now()),
      ),
    );
  }
}

function startPage() {
  if (pageLoop !== null) return;
  void planPage();
  pageLoop = window.setInterval(() => void planPage(), 20 * 60_000);
  document.addEventListener('visibilitychange', onVisible);
}

function stopPage() {
  if (pageLoop !== null) clearInterval(pageLoop);
  pageLoop = null;
  for (const id of pageTimers) clearTimeout(id);
  pageTimers = [];
  document.removeEventListener('visibilitychange', onVisible);
}

function onVisible() {
  if (document.visibilityState === 'visible') void planPage();
}

// ---------- Activation ----------

/** Active les rappels sur cet appareil (autorisation demandée) ; renvoie le moyen retenu. */
export async function enableReminders(): Promise<ReminderMode> {
  const support = reminderSupport();
  if (!support) throw new Error(reminderHelp());
  if (!serverBase()) throw new Error(t('Un serveur Ostal est nécessaire pour les rappels.'));
  if (support === 'native') {
    const { granted } = await callNative<{ granted: boolean }>(NATIVE, 'requestPermission');
    if (!granted) throw new Error(t('Les notifications d’Ostal sont bloquées : autorisez-les dans les réglages du téléphone (Applications → Ostal → Notifications).'));
    await configureNative(true);
    updateSettings({ reminders: true, remindersMode: 'native' });
    return 'native';
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(t('Notifications refusées : autorisez-les pour Ostal dans les réglages du navigateur (cadenas à gauche de l’adresse).'));
  let mode: ReminderMode = 'page';
  if (support === 'push') {
    try {
      await subscribePush();
      mode = 'push';
    } catch (err) {
      // Service de notifications du navigateur injoignable ou désactivé : rappels tant que la page est ouverte.
      console.warn('Notifications push indisponibles', err);
    }
  }
  updateSettings({ reminders: true, remindersMode: mode });
  if (mode === 'page') startPage();
  return mode;
}

export async function disableReminders() {
  const mode = getSettings().remindersMode;
  updateSettings({ reminders: false, remindersMode: '' });
  stopPage();
  if (mode === 'native') await configureNative(false).catch(() => {});
  if (mode === 'push') {
    const sub = await currentSubscription().catch(() => null);
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  }
}

/** Notification d'essai, par le même chemin que les rappels. */
export async function testReminder() {
  const s = getSettings();
  const title = t('Rappels d’Ostal');
  const body = t('Les rappels fonctionnent sur cet appareil.');
  if (s.remindersMode === 'native') return callNative(NATIVE, 'test', { title, body });
  if (s.remindersMode === 'push') {
    const sub = (await currentSubscription()) ?? (await subscribePush());
    await api.pushTest(sub.endpoint);
    return;
  }
  await showNotification({ key: 'test', title, body, url: '#/' });
}

/** Données changées (papier, rappel d'un agenda) : programmation refaite sur cet appareil. */
export function refreshReminders() {
  const s = getSettings();
  if (!s.reminders) return;
  if (s.remindersMode === 'native') void callNative(NATIVE, 'refresh').catch(() => {});
  if (s.remindersMode === 'page') void planPage();
}

let clicks = false;

/** Notification, widget ou raccourci touché : la page qu'il désigne (service worker, application Android). */
export function listenOpenRequests() {
  if (clicks) return;
  clicks = true;
  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: string; url?: string } | null;
    if (data?.type === 'notes-open' && typeof data.url === 'string' && data.url.startsWith('#/')) navigate(data.url);
  });
  if (isNative() && hasNativePlugin(NATIVE)) {
    onNative<{ url?: string }>(NATIVE, 'open', (d) => d.url?.startsWith('#/') && navigate(d.url));
    void callNative<{ url?: string }>(NATIVE, 'consumeLaunch')
      .then((d) => d.url?.startsWith('#/') && navigate(d.url))
      .catch(() => {});
  }
}

/** Fuseau horaire des rappels : celui de l'appareil, enregistré dans l'espace s'il ne l'est pas encore. */
function rememberZone(doc: Y.Doc) {
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return;
  }
  const agenda = doc.getMap('agenda');
  if (tz && !agenda.get('tz')) agenda.set('tz', tz);
}

/** Démarrage de l'application (espace synchronisé) : rappels de cet appareil remis en place. */
export function startReminders(doc: Y.Doc) {
  listenOpenRequests();
  rememberZone(doc);
  const s = getSettings();
  if (!s.reminders || !serverBase()) return;
  if (s.remindersMode === 'native' && hasNativePlugin(NATIVE)) void configureNative(true).catch(() => {});
  else if (s.remindersMode === 'push' && browserPermission() === 'granted') void subscribePush().catch(() => {});
  else if (s.remindersMode === 'page') startPage();
}
