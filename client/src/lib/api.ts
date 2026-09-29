import { getSettings } from './settings';
import type { Device, DeviceStatus, HomelabStatus, Service, ServiceStatus } from './homelab';
import type { HomeEntity, HomeStates } from './smarthome';
import type { Camera, CamerasStatus, CameraTestResult } from './cameras';

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

export type Auth = { key: string } | { share: string };

export function serverBase(): string | null {
  const s = getSettings().serverUrl;
  return s ? s.replace(/\/$/, '') : null;
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
  if (!base) throw new ApiError('Aucun serveur configuré. Ajoutez un serveur dans les réglages.', 0);
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.auth) Object.assign(headers, authHeaders(init.auth));
  if (init.body && !(init.body instanceof FormData)) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('Serveur injoignable.', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* pas de JSON */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `Erreur ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  claim: (wsId: string, key: string) =>
    request<{ ok: boolean }>('/api/workspaces/claim', { method: 'POST', body: JSON.stringify({ wsId, key }) }),
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
  homelabStatus: (force = false) => request<HomelabStatus>(`/api/homelab/status${force ? '?force=1' : ''}`, { auth: ownerAuth() }),
  homelabTest: (payload: { service?: Service; device?: Device }) =>
    request<ServiceStatus | DeviceStatus>('/api/homelab/test', { method: 'POST', body: JSON.stringify(payload), auth: ownerAuth() }),
  pairStart: () => request<{ code: string; expiresAt: number }>('/api/pair/start', { method: 'POST', auth: ownerAuth() }),
  homeStates: () => request<HomeStates>('/api/home/states', { auth: ownerAuth() }),
  homeCall: (entity_id: string, service: string, data?: Record<string, unknown>) =>
    request<{ entities: HomeEntity[] }>('/api/home/call', { method: 'POST', body: JSON.stringify({ entity_id, service, data }), auth: ownerAuth() }),
  homeTest: (cfg: { url: string; token: string; insecure: boolean }) =>
    request<{ ok: boolean; message: string }>('/api/home/test', { method: 'POST', body: JSON.stringify(cfg), auth: ownerAuth() }),
  cameras: () => request<CamerasStatus>('/api/cameras', { auth: ownerAuth() }),
  cameraTest: (camera: Camera) =>
    request<CameraTestResult>('/api/cameras/test', { method: 'POST', body: JSON.stringify({ camera }), auth: ownerAuth() }),
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
