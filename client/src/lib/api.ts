import { getSettings } from './settings';
import { isDesktopLocal } from './desktop';
import type { Device, DeviceStatus, HomelabStatus, Service, ServiceStatus } from './homelab';
import type { HomeEntity, HomeStates } from './smarthome';
import type { Camera, CamerasStatus, CameraTestResult } from './cameras';
import type { WolScan, WolStatus, WolWake } from './wol';
import type { DiscoverResult } from './homelabImport';
import { t, tServer } from './i18n';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type ShareMode = 'edit' | 'view';
export type ShareInfo = { token: string; wsId: string; pageId: string; mode: ShareMode; createdAt: number; url: string };
export type SharedPage = { id: string; title: string; icon: string; parentId: string; order: number };
export type ShareTree = { token: string; wsId: string; pageId: string; mode: ShareMode; pages: SharedPage[] };
export type UploadResult = { url: string; name: string; size: number; type: string };
export type InviteInfo = { token: string; name: string; createdAt: number; expiresAt: number; url: string };
export type GuestInfo = { wsId: string; name: string; createdAt: number };

export type Auth = { key: string } | { share: string };

/** Sauvegarde du serveur (voir server/src/backup.js). */
export type BackupEntry = { name: string; size: number; createdAt: number; encrypted: boolean; beforeRestore: boolean };
export type BackupStatus = {
  auto: boolean;
  keep: number;
  keepChoices: number[];
  encrypted: boolean;
  dir: string;
  /** docker : dossier « sauvegardes » de la machine ; server : chemin sur le serveur ; local / custom : application pour ordinateur. */
  dirKind: 'docker' | 'server' | 'local' | 'custom';
  dirChoice: boolean;
  running: boolean;
  lastError: { message: string; at: number } | null;
  list: BackupEntry[];
};
export type RestoreResult = { ok: boolean; gen: string; wsId: string | null };
/** Rappel calculé par le serveur (server/src/reminders.js). */
export type Reminder = { key: string; at: number; kind: 'paper' | 'event'; title: string; body: string; url: string };

export function serverBase(): string | null {
  const s = getSettings().serverUrl;
  return s ? s.replace(/\/$/, '') : null;
}

/**
 * Liens de partage, liaison d'autres appareils et invitations possibles : un serveur joignable par les autres.
 * L'espace de l'application pour ordinateur (serveur intégré) ne l'est que depuis cet ordinateur.
 */
export function canShareLinks(): boolean {
  return Boolean(serverBase()) && !isDesktopLocal();
}

export function wsBase(): string | null {
  const base = serverBase();
  if (!base) return null;
  return `${base.replace(/^http/, 'ws')}/ws`;
}

export function ownerAuth(): Auth {
  return { key: getSettings().workspaceKey };
}

function authHeaders(auth: Auth): Record<string, string> {
  if ('share' in auth) return { 'x-share-token': auth.share };
  return { 'x-ws-id': getSettings().workspaceId, 'x-ws-key': auth.key };
}

async function request<T>(path: string, init: RequestInit & { auth?: Auth } = {}): Promise<T> {
  const base = serverBase();
  if (!base) throw new ApiError(t('Aucun serveur configuré. Ajoutez un serveur dans les réglages.'), 0);
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.auth) Object.assign(headers, authHeaders(init.auth));
  if (init.body && !(init.body instanceof FormData)) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(t('Serveur injoignable.'), 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* pas de JSON */
  }
  if (!res.ok) {
    // Message du serveur, écrit en français : traduit à l'affichage.
    const msg = tServer((data as { error?: string } | null)?.error ?? '') || t('Erreur {status}', { status: res.status });
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean; gen?: string }>('/api/health'),
  backupStatus: () => request<BackupStatus>('/api/backup', { auth: ownerAuth() }),
  backupSettings: (patch: { auto?: boolean; keep?: number; password?: string | null; dir?: string }) =>
    request<BackupStatus>('/api/backup/settings', { method: 'PUT', body: JSON.stringify(patch), auth: ownerAuth() }),
  backupRun: () => request<{ backup: BackupEntry | null; status: BackupStatus }>('/api/backup/run', { method: 'POST', auth: ownerAuth() }),
  backupDelete: (name: string) => request<BackupStatus>(`/api/backup/files/${encodeURIComponent(name)}`, { method: 'DELETE', auth: ownerAuth() }),
  backupRestore: (name: string, password: string) =>
    request<RestoreResult>('/api/backup/restore', { method: 'POST', body: JSON.stringify({ name, password }), auth: ownerAuth() }),
  reminders: (hours: number, lang: string) =>
    request<{ now: number; reminders: Reminder[] }>(`/api/reminders?hours=${hours}&lang=${lang}`, { auth: ownerAuth() }),
  pushKey: () => request<{ key: string }>('/api/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON, lang: string) =>
    request<{ ok: boolean }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription, lang }), auth: ownerAuth() }),
  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }), auth: ownerAuth() }),
  pushStatus: (endpoint: string) =>
    request<{ subscribed: boolean; key: string }>('/api/push/status', { method: 'POST', body: JSON.stringify({ endpoint }), auth: ownerAuth() }),
  pushTest: (endpoint: string) => request<{ ok: boolean }>('/api/push/test', { method: 'POST', body: JSON.stringify({ endpoint }), auth: ownerAuth() }),
  claim: (wsId: string, key: string) =>
    request<{ ok: boolean; guest?: boolean }>('/api/workspaces/claim', { method: 'POST', body: JSON.stringify({ wsId, key }) }),
  createInvite: (name: string) => request<InviteInfo>('/api/invites', { method: 'POST', body: JSON.stringify({ name }), auth: ownerAuth() }),
  listInvites: () => request<{ invites: InviteInfo[]; guests: GuestInfo[] }>('/api/invites', { auth: ownerAuth() }),
  deleteInvite: (token: string) => request<{ ok: boolean }>(`/api/invites/${encodeURIComponent(token)}`, { method: 'DELETE', auth: ownerAuth() }),
  removeGuest: (wsId: string) => request<{ ok: boolean }>(`/api/guests/${encodeURIComponent(wsId)}`, { method: 'DELETE', auth: ownerAuth() }),
  upload: (file: File, auth: Auth) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return request<UploadResult>('/api/upload', { method: 'POST', body: fd, auth });
  },
  createShare: (pageId: string, mode: ShareMode) =>
    request<ShareInfo>('/api/shares', { method: 'POST', body: JSON.stringify({ pageId, mode }), auth: ownerAuth() }),
  listShares: (pageId: string) =>
    request<ShareInfo[]>(`/api/shares?pageId=${encodeURIComponent(pageId)}`, { auth: ownerAuth() }),
  deleteShare: (token: string) =>
    request<{ ok: boolean }>(`/api/shares/${encodeURIComponent(token)}`, { method: 'DELETE', auth: ownerAuth() }),
  createSharedPage: (token: string, parentId: string, title = '') =>
    request<{ id: string }>(`/api/share/${encodeURIComponent(token)}/pages`, {
      method: 'POST',
      body: JSON.stringify({ parentId, title }),
    }),
  getShare: (token: string) => request<ShareTree>(`/api/share/${encodeURIComponent(token)}`),
  /** Le site accepte-t-il d'être affiché dans une page d'Ostal ? (null : le serveur ne l'a pas joint) */
  frameCheck: (url: string) => request<{ allowed: boolean | null }>(`/api/frame-check?url=${encodeURIComponent(url)}`, { auth: ownerAuth() }),
  homelabStatus: (force = false) => request<HomelabStatus>(`/api/homelab/status${force ? '?force=1' : ''}`, { auth: ownerAuth() }),
  /** Applications et appareils du réseau local, cherchés par le serveur (une dizaine de secondes). */
  homelabDiscover: () => request<DiscoverResult>('/api/homelab/discover', { method: 'POST', auth: ownerAuth() }),
  homelabTest: (payload: { service?: Service; device?: Device }) =>
    request<ServiceStatus | DeviceStatus>('/api/homelab/test', { method: 'POST', body: JSON.stringify(payload), auth: ownerAuth() }),
  pairStart: () => request<{ code: string; expiresAt: number }>('/api/pair/start', { method: 'POST', auth: ownerAuth() }),
  homeStates: () => request<HomeStates>('/api/home/states', { auth: ownerAuth() }),
  /** Un appareil, ou plusieurs du même type (commande de groupe). */
  homeCall: (entity_id: string | string[], service: string, data?: Record<string, unknown>) =>
    request<{ entities: HomeEntity[] }>('/api/home/call', { method: 'POST', body: JSON.stringify({ entity_id, service, data }), auth: ownerAuth() }),
  homeTest: (cfg: { url: string; token: string; insecure: boolean }) =>
    request<{ ok: boolean; message: string }>('/api/home/test', { method: 'POST', body: JSON.stringify(cfg), auth: ownerAuth() }),
  cameras: () => request<CamerasStatus>('/api/cameras', { auth: ownerAuth() }),
  cameraTest: (camera: Camera) =>
    request<CameraTestResult>('/api/cameras/test', { method: 'POST', body: JSON.stringify({ camera }), auth: ownerAuth() }),
  /** Allumer un ordinateur (Wake-on-LAN) : signal envoyé par le serveur sur son réseau local. */
  wolWake: (target: { mac: string; host?: string; broadcast?: string }) =>
    request<WolWake>('/api/wol/wake', { method: 'POST', body: JSON.stringify(target), auth: ownerAuth() }),
  wolStatus: (target: { host: string; mac?: string }) =>
    request<WolStatus>(`/api/wol/status?${new URLSearchParams({ host: target.host, ...(target.mac ? { mac: target.mac } : {}) })}`, { auth: ownerAuth() }),
  wolScan: () => request<WolScan>('/api/wol/scan', { method: 'POST', auth: ownerAuth() }),
  fetchIcs: (url: string, auth: Auth) =>
    request<{ text: string }>('/api/ics/fetch', { method: 'POST', body: JSON.stringify({ url }), auth }),
  deletePdf: (id: string, files: string[]) =>
    request<{ ok: boolean; removed: number }>('/api/pdf/delete', { method: 'POST', body: JSON.stringify({ id, files }), auth: ownerAuth() }),
};

/** Convertit un fichier en data-URL (mode hors ligne, sans serveur). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
