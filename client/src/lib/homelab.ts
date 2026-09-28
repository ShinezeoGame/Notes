// Tableau de bord homelab : types, catalogue des applications/appareils pris en charge, stockage de la configuration.
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { newId } from './ids';

export type ServiceType =
  | 'sonarr' | 'radarr' | 'lidarr' | 'readarr' | 'prowlarr' | 'bazarr'
  | 'jellyfin' | 'emby' | 'plex' | 'jellyseerr' | 'overseerr'
  | 'qbittorrent' | 'transmission' | 'pihole' | 'adguard' | 'portainer'
  | 'homeassistant' | 'uptimekuma' | 'nextcloud' | 'immich' | 'generic';

export type DeviceType = 'local' | 'glances' | 'proxmox' | 'synology' | 'truenas';

export type Service = {
  id: string;
  name: string;
  type: ServiceType;
  url: string;
  /** URL utilisée par le serveur pour interroger l'application si elle diffère de l'URL publique. */
  internalUrl?: string;
  category: string;
  icon: string;
  apiKey?: string;
  username?: string;
  password?: string;
  insecure?: boolean;
};

export type Device = {
  id: string;
  name: string;
  type: DeviceType;
  icon?: string;
  url?: string;
  username?: string;
  password?: string;
  token?: string;
  node?: string;
  mounts?: string;
  insecure?: boolean;
};

export type HomelabConfig = { services: Service[]; devices: Device[]; refreshSeconds: number };

export type StatValue = { label: string; value: string | number; kind?: 'speed' | 'bytes' | 'warn-if-positive' };
export type ServiceStatus = Pick<Service, 'id' | 'name' | 'type' | 'url' | 'icon' | 'category'> & {
  ok: boolean;
  latency: number | null;
  stats: StatValue[];
  version: string | null;
  error: string | null;
};
export type Gauge = { total: number; used: number; percent: number | null };
export type DeviceStatus = Pick<Device, 'id' | 'name' | 'type' | 'icon'> & {
  ok: boolean;
  error: string | null;
  hostname?: string | null;
  os?: string | null;
  model?: string | null;
  cores?: number | null;
  cpu?: number | null;
  load?: number[] | null;
  memory?: Gauge | null;
  swap?: Gauge | null;
  disks?: (Gauge & { name: string; error?: string })[];
  temps?: { label: string; value: number }[];
  uptime?: number | string | null;
  network?: { rx: number; tx: number } | null;
  extra?: StatValue[];
};
export type HomelabStatus = { services: ServiceStatus[]; devices: DeviceStatus[]; fetchedAt: number };

export type AuthKind = 'none' | 'apiKey' | 'token' | 'password' | 'userpass' | 'userpass-optional';

export const CATEGORIES = ['Médias', 'Téléchargements', 'Réseau', 'Système', 'Domotique', 'Cloud', 'Autres'];

export const SERVICE_TYPES: Record<ServiceType, { label: string; icon: string; port?: number; https?: boolean; path?: string; auth: AuthKind; category: string; help?: string }> = {
  sonarr: { label: 'Sonarr', icon: '📺', port: 8989, auth: 'apiKey', category: 'Médias', help: 'Paramètres → Général → Clé API' },
  radarr: { label: 'Radarr', icon: '🎬', port: 7878, auth: 'apiKey', category: 'Médias', help: 'Paramètres → Général → Clé API' },
  lidarr: { label: 'Lidarr', icon: '🎵', port: 8686, auth: 'apiKey', category: 'Médias', help: 'Paramètres → Général → Clé API' },
  readarr: { label: 'Readarr', icon: '📚', port: 8787, auth: 'apiKey', category: 'Médias', help: 'Paramètres → Général → Clé API' },
  prowlarr: { label: 'Prowlarr', icon: '🔍', port: 9696, auth: 'apiKey', category: 'Téléchargements', help: 'Paramètres → Général → Clé API' },
  bazarr: { label: 'Bazarr', icon: '💬', port: 6767, auth: 'apiKey', category: 'Médias', help: 'Paramètres → Général → Sécurité → Clé API' },
  jellyfin: { label: 'Jellyfin', icon: '🍿', port: 8096, auth: 'apiKey', category: 'Médias', help: 'Tableau de bord → Clés API → +' },
  emby: { label: 'Emby', icon: '🎞️', port: 8096, auth: 'apiKey', category: 'Médias', help: 'Paramètres → Avancé → Clés API' },
  plex: { label: 'Plex', icon: '▶️', port: 32400, auth: 'token', category: 'Médias', help: 'Jeton X-Plex-Token (voir l’aide Plex « Finding an authentication token »)' },
  jellyseerr: { label: 'Jellyseerr', icon: '🎟️', port: 5055, auth: 'apiKey', category: 'Médias', help: 'Paramètres → Général → Clé API' },
  overseerr: { label: 'Overseerr', icon: '🎟️', port: 5055, auth: 'apiKey', category: 'Médias', help: 'Paramètres → Général → Clé API' },
  qbittorrent: { label: 'qBittorrent', icon: '⬇️', port: 8080, auth: 'userpass', category: 'Téléchargements', help: 'Identifiants de l’interface web' },
  transmission: { label: 'Transmission', icon: '⬇️', port: 9091, auth: 'userpass-optional', category: 'Téléchargements', help: 'Identifiants RPC si activés' },
  pihole: { label: 'Pi-hole', icon: '🛡️', port: 80, path: '/admin', auth: 'password', category: 'Réseau', help: 'Mot de passe de l’interface (v6) ou jeton API (v5)' },
  adguard: { label: 'AdGuard Home', icon: '🛡️', port: 3000, auth: 'userpass', category: 'Réseau', help: 'Identifiants de l’interface web' },
  portainer: { label: 'Portainer', icon: '🐳', port: 9443, https: true, auth: 'apiKey', category: 'Système', help: 'Mon compte → Jetons d’accès' },
  homeassistant: { label: 'Home Assistant', icon: '🏠', port: 8123, auth: 'token', category: 'Domotique', help: 'Profil → Sécurité → Jetons d’accès longue durée' },
  uptimekuma: { label: 'Uptime Kuma', icon: '💓', port: 3001, auth: 'apiKey', category: 'Système', help: 'Paramètres → Clés API' },
  nextcloud: { label: 'Nextcloud', icon: '☁️', port: 443, https: true, auth: 'userpass', category: 'Cloud', help: 'Utilisateur + mot de passe d’application (Paramètres → Sécurité)' },
  immich: { label: 'Immich', icon: '🖼️', port: 2283, auth: 'apiKey', category: 'Cloud', help: 'Paramètres du compte → Clés API' },
  generic: { label: 'Autre application (vérification de disponibilité)', icon: '🔗', auth: 'none', category: 'Autres' },
};

export const DEVICE_TYPES: Record<DeviceType, { label: string; icon: string; port?: number; https?: boolean; auth: 'none' | 'userpass-optional' | 'userpass' | 'pve-token' | 'token'; help: string }> = {
  local: { label: 'Hôte de ce serveur Notes', icon: '🖥️', auth: 'none', help: 'Statistiques de la machine qui exécute le serveur Notes (CPU, RAM, disques, températures). En Docker, montez les volumes à surveiller et listez leurs points de montage.' },
  glances: { label: 'Glances (API)', icon: '📊', port: 61208, auth: 'userpass-optional', help: 'Fonctionne sur n’importe quel Linux/NAS : lancez Glances en mode web (glances -w) ou son image Docker, puis indiquez http://hote:61208.' },
  proxmox: { label: 'Proxmox VE', icon: '🧊', port: 8006, https: true, auth: 'pve-token', help: 'Créez un jeton API (Datacenter → Permissions → API Tokens) avec le rôle PVEAuditor. Identifiant au format utilisateur@pam!nom-du-jeton.' },
  synology: { label: 'NAS Synology (DSM)', icon: '💾', port: 5000, auth: 'userpass', help: 'Compte DSM sans authentification à deux facteurs (idéalement un compte dédié en lecture seule).' },
  truenas: { label: 'TrueNAS', icon: '💾', port: 443, https: true, auth: 'token', help: 'Clé API créée dans Paramètres → API Keys.' },
};

const EMPTY: HomelabConfig = { services: [], devices: [], refreshSeconds: 30 };

export function readHomelabConfig(doc: Y.Doc): HomelabConfig {
  try {
    const raw = doc.getMap('homelab').get('config');
    if (typeof raw !== 'string') return EMPTY;
    const parsed = JSON.parse(raw) as Partial<HomelabConfig>;
    return {
      services: Array.isArray(parsed.services) ? parsed.services : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      refreshSeconds: Number(parsed.refreshSeconds) || 30,
    };
  } catch {
    return EMPTY;
  }
}

export function saveHomelabConfig(doc: Y.Doc, cfg: HomelabConfig) {
  doc.transact(() => {
    doc.getMap('homelab').set('config', JSON.stringify(cfg));
  }, 'local');
}

export function useHomelabConfig(doc: Y.Doc): HomelabConfig {
  const [cfg, setCfg] = useState(() => readHomelabConfig(doc));
  useEffect(() => {
    const map = doc.getMap('homelab');
    const handler = () => setCfg(readHomelabConfig(doc));
    map.observe(handler);
    handler();
    return () => map.unobserve(handler);
  }, [doc]);
  return cfg;
}

export function defaultUrl(type: ServiceType | DeviceType, host: string, kind: 'service' | 'device'): string {
  const meta = kind === 'service' ? SERVICE_TYPES[type as ServiceType] : DEVICE_TYPES[type as DeviceType];
  if (!meta || !('port' in meta) || !meta.port) return host ? `http://${host}` : '';
  const scheme = meta.https ? 'https' : 'http';
  const path = 'path' in meta && meta.path ? meta.path : '';
  return host ? `${scheme}://${host}:${meta.port}${path}` : '';
}

/** Stack multimédia classique (arr-stack + Jellyfin + Jellyseerr + qBittorrent) sur un même hôte. */
export function mediaStackPreset(host: string): Service[] {
  const types: ServiceType[] = ['jellyfin', 'jellyseerr', 'sonarr', 'radarr', 'prowlarr', 'bazarr', 'qbittorrent'];
  return types.map((type) => ({
    id: newId(),
    name: SERVICE_TYPES[type].label,
    type,
    url: defaultUrl(type, host, 'service'),
    category: SERVICE_TYPES[type].category,
    icon: SERVICE_TYPES[type].icon,
  }));
}

export function newService(type: ServiceType = 'generic'): Service {
  const meta = SERVICE_TYPES[type];
  return { id: newId(), name: type === 'generic' ? '' : meta.label, type, url: '', category: meta.category, icon: meta.icon };
}

export function newDevice(type: DeviceType = 'glances'): Device {
  const meta = DEVICE_TYPES[type];
  return { id: newId(), name: type === 'local' ? 'Serveur' : '', type, icon: meta.icon, insecure: type === 'proxmox' };
}

// ---------- Formatage ----------

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To', 'Po'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

export function formatUptime(v: number | string | null | undefined): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v.replace(/days?/, 'j').replace(/, /, ' ');
  const d = Math.floor(v / 86400);
  const h = Math.floor((v % 86400) / 3600);
  const m = Math.floor((v % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function formatStat(s: StatValue): string {
  if (typeof s.value === 'number') {
    if (s.kind === 'speed') return formatSpeed(s.value);
    if (s.kind === 'bytes') return formatBytes(s.value);
    return s.value.toLocaleString('fr-FR');
  }
  return String(s.value);
}

export function isImageIcon(icon: string): boolean {
  return /^(https?:\/\/|data:image\/|\/)/.test(icon);
}
