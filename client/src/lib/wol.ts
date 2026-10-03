// Widget « Allumer un PC » (Wake-on-LAN) : adresses de l'ordinateur et réponses du serveur (voir server/src/wol.js).
import { t } from './i18n';

/**
 * Adresse MAC écrite « AA:BB:CC:DD:EE:FF », ou null : invalide, ou adresse de groupe qui ne désigne aucune carte
 * réseau. Mêmes formes acceptées que le serveur (AA-BB-…, aabb.ccdd.eeff, AABBCCDDEEFF…).
 */
export function parseMac(value: string): string | null {
  const s = value.trim();
  const parts = s.split(/[:-]/);
  const hex =
    parts.length === 6 && parts.every((p) => /^[0-9a-f]{1,2}$/i.test(p)) ? parts.map((p) => p.padStart(2, '0')).join('') : s.replace(/[\s.]/g, '');
  if (!/^[0-9a-f]{12}$/i.test(hex) || /^0{12}$/.test(hex)) return null;
  if (parseInt(hex.slice(0, 2), 16) & 1) return null;
  return hex.toUpperCase().match(/../g)!.join(':');
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;

/** Adresse IPv4 ou nom d'appareil sur le réseau (« 192.168.1.20 », « pc-salon.home »). */
export const isHost = (value: string) => IPV4_RE.test(value) || HOSTNAME_RE.test(value);

/** Relais réseau du serveur (Docker) : utilisé, absent (serveur directement sur le réseau local) ou injoignable. */
type RelayInfo = { relay: 'ok' | 'none' | 'down'; isolated?: boolean };

export type WolWake = RelayInfo & { mac: string; sent: string[] };
export type WolStatus = RelayInfo & {
  online: boolean;
  ip: string | null;
  mac: string | null;
  method: string;
  /** L'adresse IP réglée répond, mais avec la carte réseau d'un autre appareil. */
  otherDevice?: boolean;
  error?: string;
};
export type WolDevice = { ip: string; mac: string; name: string; router?: boolean; you?: boolean };
export type WolScan = RelayInfo & { devices: WolDevice[]; networks: string[] };

/** Avertissement quand le signal risque de ne pas atteindre le réseau local (serveur dans Docker sans son relais). */
export function relayWarning(r: RelayInfo): string {
  if (r.relay === 'down') return t('Le relais réseau du serveur Melo ne répond pas : le signal risque de ne pas atteindre l’ordinateur.');
  if (r.isolated) return t('Le serveur Melo tourne dans Docker sans son relais réseau : le signal risque de ne pas atteindre l’ordinateur.');
  return '';
}
