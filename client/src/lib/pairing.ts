// Rejoindre un espace sur un serveur Ostal : lien ou code à 6 chiffres pour relier un autre appareil de la même
// personne, invitation qui donne à une autre personne son propre espace, ancien lien « Lier un appareil ».
import { getSettings, isDefaultUserName, normalizeServerUrl, resetWorkspace, updateSettings } from './settings';
import { clearLocalDocs } from './yjs';
import { t, tServer } from './i18n';

/** « 482913 » → « 482 913 » (saisie partielle acceptée). */
export function formatPairingCode(code: string): string {
  const digits = code.replace(/\D/g, '').slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/** Lien Ostal reçu (collé, scanné) : ce qu'il permet de faire, et sur quel serveur. */
export type OstalLink =
  | { kind: 'invite'; server: string; token: string }
  | { kind: 'pair'; server: string; code: string }
  | { kind: 'join'; server: string; wsId: string; key: string }
  | { kind: 'share'; server: string; url: string }
  | { kind: 'server'; server: string };

/** Code à 6 chiffres saisi seul (espaces acceptés). */
export function asPairingCode(input: string): string | null {
  const t = input.trim();
  return /^\d{3}\s?\d{3}$/.test(t) ? t.replace(/\s/g, '') : null;
}

/** Reconnaît un lien d'invitation, de liaison, de partage, ou une simple adresse de serveur. */
export function parseOstalLink(input: string): OstalLink | null {
  const text = input.trim();
  if (!text || asPairingCode(text) || /\s/.test(text)) return null;
  const explicit = /^https?:\/\//i.test(text);
  let u: URL;
  try {
    u = new URL(explicit ? text : `https://${text}`);
  } catch {
    return null;
  }
  // Sans « https:// », seul un nom de domaine ou une adresse IP est pris pour un serveur.
  if (!/^https?:$/.test(u.protocol) || (!explicit && !u.hostname.includes('.') && u.hostname !== 'localhost')) return null;
  const server = normalizeServerUrl(u.origin + u.pathname);
  if (!server) return null;
  const hash = u.hash.replace(/^#/, '');
  let m: RegExpExecArray | null;
  if ((m = /^\/invite\/([A-Za-z0-9_-]{20,64})/.exec(hash))) return { kind: 'invite', server, token: m[1] };
  if ((m = /^\/pair\/(\d{6})/.exec(hash))) return { kind: 'pair', server, code: m[1] };
  if ((m = /^\/join\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/.exec(hash))) return { kind: 'join', server, wsId: m[1], key: m[2] };
  if (/^\/s\/[A-Za-z0-9_-]+/.test(hash)) return { kind: 'share', server, url: u.href };
  return { kind: 'server', server };
}

/** Lien à ouvrir sur un autre appareil pour le relier à cet espace avec le code affiché. */
export function pairLink(serverUrl: string, code: string): string {
  return `${serverUrl}/#/pair/${code}`;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(t('Serveur injoignable. Vérifiez l’adresse et la connexion Internet.'));
  }
  const data = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !data) throw new Error(tServer(data?.error ?? '') || t('Le serveur a répondu {status}.', { status: r.status }));
  return data;
}

function restart() {
  location.hash = '#/';
  location.reload();
}

/** Échange le code contre l'espace du serveur, relie cet appareil puis recharge l'application. */
export async function linkWithCode(serverUrl: string, code: string): Promise<void> {
  const data = await post<{ wsId?: string; key?: string }>(`${serverUrl}/api/pair/claim`, { code: code.replace(/\D/g, '') });
  if (!data.wsId || !data.key) throw new Error(t('Réponse inattendue du serveur.'));
  await clearLocalDocs();
  updateSettings({ serverUrl, workspaceId: data.wsId, workspaceKey: data.key, onboarded: true, firstRun: false, lastPageId: null, expanded: {}, guest: false });
  restart();
}

/** Invitation encore valable : nom de la personne qui invite (vide s'il n'a pas été donné). */
export async function inviteInfo(serverUrl: string, token: string): Promise<{ name: string; expiresAt: number }> {
  let r: Response;
  try {
    r = await fetch(`${serverUrl}/api/invite/${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(t('Serveur injoignable. Vérifiez la connexion Internet.'));
  }
  const data = (await r.json().catch(() => null)) as { name?: string; expiresAt?: number; error?: string } | null;
  if (!r.ok || !data) throw new Error(tServer(data?.error ?? '') || t('Le serveur a répondu {status}.', { status: r.status }));
  return { name: data.name ?? '', expiresAt: Number(data.expiresAt) || 0 };
}

/**
 * Accepte une invitation : cet appareil obtient son propre espace sur le serveur. Un appareil encore seul (sans
 * serveur) y garde ses pages ; un appareil relié à un autre serveur repart d'un espace neuf.
 */
export async function acceptInvite(serverUrl: string, token: string, name: string, hostName: string): Promise<void> {
  const s = getSettings();
  const fresh = Boolean(s.serverUrl && s.serverUrl !== serverUrl);
  if (fresh) {
    await clearLocalDocs();
    resetWorkspace();
  }
  const { workspaceId, workspaceKey } = getSettings();
  const userName = name.trim() || (isDefaultUserName(s.userName) ? '' : s.userName);
  const data = await post<{ guest?: boolean; created?: boolean }>(`${serverUrl}/api/invite/${encodeURIComponent(token)}/claim`, {
    wsId: workspaceId,
    key: workspaceKey,
    name: userName,
  });
  updateSettings({
    serverUrl,
    onboarded: true,
    // Espace déjà existant (lien ouvert une deuxième fois) : pas de nouvelle présentation.
    firstRun: Boolean(data.created) || getSettings().firstRun,
    guest: Boolean(data.guest),
    hostName: data.guest ? hostName : '',
    ...(userName ? { userName } : {}),
  });
  restart();
}

/** Ancien lien « Lier un appareil » (identifiant et clé de l'espace dans l'adresse). */
export async function joinWithKey(serverUrl: string, wsId: string, key: string): Promise<void> {
  await post(`${serverUrl}/api/workspaces/claim`, { wsId, key });
  await clearLocalDocs();
  updateSettings({ serverUrl, workspaceId: wsId, workspaceKey: key, onboarded: true, firstRun: false, lastPageId: null, expanded: {}, guest: false });
  restart();
}

/** Premier appareil sur un serveur ouvert : l'espace de cet appareil y est enregistré (pages gardées). */
export async function claimServer(serverUrl: string): Promise<void> {
  const s = getSettings();
  const data = await post<{ guest?: boolean }>(`${serverUrl}/api/workspaces/claim`, { wsId: s.workspaceId, key: s.workspaceKey });
  updateSettings({ serverUrl, onboarded: true, guest: Boolean(data.guest) });
  restart();
}
