// Liaison d'un appareil à un espace existant grâce à un code à 6 chiffres (affiché sur un appareil déjà relié).
import { updateSettings } from './settings';
import { clearLocalDocs } from './yjs';

/** « 482913 » → « 482 913 » (saisie partielle acceptée). */
export function formatPairingCode(code: string): string {
  const digits = code.replace(/\D/g, '').slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/** Échange le code contre l'espace du serveur, relie cet appareil puis recharge l'application. */
export async function linkWithCode(serverUrl: string, code: string): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`${serverUrl}/api/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.replace(/\D/g, '') }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Serveur injoignable. Vérifiez l’adresse et la connexion Internet.');
  }
  const data = (await r.json().catch(() => null)) as { wsId?: string; key?: string; error?: string } | null;
  if (!r.ok || !data?.wsId || !data.key) throw new Error(data?.error || `Le serveur a répondu ${r.status}.`);
  await clearLocalDocs();
  updateSettings({ serverUrl, workspaceId: data.wsId, workspaceKey: data.key, onboarded: true, lastPageId: null, expanded: {} });
  location.hash = '#/';
  location.reload();
}
