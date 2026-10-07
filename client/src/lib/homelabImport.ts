// Homelab : applications et appareils à ajouter d'un coup, trouvés sur le réseau local (recherche faite par le
// serveur, voir server/src/discover.js) ou repris du fichier services.yaml de Homepage (gethomepage.dev).
import { newId } from './ids';
import { DEVICE_TYPES, SERVICE_TYPES, type DeviceType, type HomelabConfig, type ServiceType } from './homelab';
import { t } from './i18n';

export type Candidate = {
  key: string;
  kind: 'service' | 'device';
  type: ServiceType | DeviceType;
  name: string;
  url: string;
  internalUrl?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  token?: string;
  insecure?: boolean;
  /** Clé ou identifiants que les statistiques demandent, encore absents (à saisir ensuite). */
  missingSecret: boolean;
  /** Déjà dans le homelab (même adresse). */
  exists: boolean;
};

/** Application ou appareil trouvé par le serveur. */
export type DiscoveredApp = { kind: 'service' | 'device'; type: string; name: string; url: string; host: string; port: number; self: boolean };
export type DiscoverResult = { apps: DiscoveredApp[]; hosts: number; relay: 'ok' | 'none' | 'down'; isolated?: boolean };

const isServiceType = (v: string): v is ServiceType => Object.hasOwn(SERVICE_TYPES, v);
const isDeviceType = (v: string): v is DeviceType => Object.hasOwn(DEVICE_TYPES, v);

/** Machine et port d'une adresse (« 192.168.1.10:8989 »), en minuscules ; vide si l'adresse est invalide. */
function hostPort(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/** Déjà dans le homelab : même machine et même port (deux applications ne partagent pas un port). */
export function alreadyThere(cfg: HomelabConfig, c: { kind: 'service' | 'device'; type: string; url: string; internalUrl?: string }): boolean {
  if (c.kind === 'device' && c.type === 'local') return cfg.devices.some((d) => d.type === 'local');
  const wanted = [hostPort(c.url), hostPort(c.internalUrl)].filter(Boolean);
  if (!wanted.length) return false;
  const list: { url?: string; internalUrl?: string }[] = c.kind === 'service' ? cfg.services : cfg.devices;
  return list.some((x) => [hostPort(x.url), hostPort(x.internalUrl)].some((h) => h && wanted.includes(h)));
}

/** Statistiques impossibles sans clé ou identifiants : la vérification de disponibilité, elle, marche sans. */
function needsSecret(kind: 'service' | 'device', type: string): boolean {
  if (kind === 'service') return isServiceType(type) && ['apiKey', 'token', 'password', 'userpass'].includes(SERVICE_TYPES[type].auth);
  return isDeviceType(type) && ['userpass', 'pve-token', 'token'].includes(DEVICE_TYPES[type].auth);
}

/** Nom proposé : celui de l'application connue (« Sonarr »), sinon son titre. */
function defaultName(kind: 'service' | 'device', type: string, name: string): string {
  if (name) return name;
  if (kind === 'device') return type === 'glances' ? 'Glances' : isDeviceType(type) ? DEVICE_TYPES[type].label : name;
  return isServiceType(type) && type !== 'generic' ? SERVICE_TYPES[type].label : name;
}

/** Ordre d'affichage : appareils, applications reconnues, puis les autres. */
function rank(c: Candidate): number {
  if (c.kind === 'device') return c.type === 'local' ? 0 : 1;
  return c.type === 'generic' ? 3 : 2;
}

function finish(list: Candidate[], cfg: HomelabConfig): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of list) {
    const k = c.type === 'local' ? 'local' : hostPort(c.url) || c.key;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...c, exists: alreadyThere(cfg, c) });
  }
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Résultat de la recherche du serveur. `publicHost` : dans Docker sans relais, la machine du serveur n'est vue que par
 * son adresse interne ; l'adresse ouverte au clic prend alors celle de la page (si c'est une adresse du réseau local).
 */
export function fromDiscovery(apps: DiscoveredApp[], cfg: HomelabConfig, publicHost?: string): Candidate[] {
  const list: Candidate[] = [
    { key: 'local', kind: 'device', type: 'local', name: t('Serveur'), url: '', missingSecret: false, exists: false },
  ];
  for (const a of apps) {
    const kind = a.kind === 'device' && isDeviceType(a.type) ? 'device' : 'service';
    const type = kind === 'device' ? (a.type as DeviceType) : isServiceType(a.type) ? a.type : 'generic';
    let url = a.url;
    let internalUrl: string | undefined;
    if (a.self && publicHost) {
      try {
        const u = new URL(a.url);
        u.hostname = publicHost;
        internalUrl = a.url;
        url = u.href.replace(/\/$/, '');
      } catch {
        /* adresse gardée */
      }
    }
    list.push({
      key: `${kind}:${type}:${a.url}`,
      kind,
      type,
      name: defaultName(kind, type, a.name),
      url,
      internalUrl,
      insecure: url.startsWith('https:') || undefined,
      missingSecret: needsSecret(kind, type),
      exists: false,
    });
  }
  return finish(list, cfg);
}

/** Adresse de la page, si c'est une adresse du réseau local (IP privée, nom sans domaine, .local, .lan, .home). */
export function localPageHost(hostname: string): string | undefined {
  if (/^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(hostname)) return hostname;
  if (hostname !== 'localhost' && (!hostname.includes('.') || /\.(local|lan|home|internal)$/i.test(hostname))) return hostname;
  return undefined;
}

// ---------- Homepage (services.yaml) ----------

/** Types de widget de Homepage → types du homelab d'Ostal (les autres : vérification de disponibilité). */
const HOMEPAGE_SERVICES: Record<string, ServiceType> = {
  sonarr: 'sonarr',
  radarr: 'radarr',
  lidarr: 'lidarr',
  readarr: 'readarr',
  prowlarr: 'prowlarr',
  bazarr: 'bazarr',
  jellyfin: 'jellyfin',
  emby: 'emby',
  plex: 'plex',
  jellyseerr: 'jellyseerr',
  overseerr: 'overseerr',
  qbittorrent: 'qbittorrent',
  transmission: 'transmission',
  pihole: 'pihole',
  adguard: 'adguard',
  portainer: 'portainer',
  homeassistant: 'homeassistant',
  uptimekuma: 'uptimekuma',
  nextcloud: 'nextcloud',
  immich: 'immich',
};
const HOMEPAGE_DEVICES: Record<string, DeviceType> = { glances: 'glances', proxmox: 'proxmox', diskstation: 'synology', truenas: 'truenas' };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const httpUrl = (v: unknown): string | undefined => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim().replace(/\/$/, '') : undefined);
/** Valeur secrète utilisable : pas une variable de Homepage ({{HOMEPAGE_VAR_…}}), restée dans son environnement. */
const secret = (v: unknown): string | undefined =>
  (typeof v === 'string' || typeof v === 'number') && String(v).trim() && !/\{\{\s*HOMEPAGE_/i.test(String(v)) ? String(v).trim() : undefined;
/** Adresse qu'Ostal peut joindre : IP ou nom avec domaine (pas un nom de conteneur Docker de Homepage). */
const reachable = (url: string | undefined) => {
  try {
    const h = new URL(url ?? '').hostname;
    return h === 'localhost' || h.includes('.') || h.includes(':');
  } catch {
    return false;
  }
};

function homepageItem(name: string, item: Obj): Candidate | null {
  const widget = isObj(item.widget) ? item.widget : isObj((item.widgets as unknown[] | undefined)?.[0]) ? ((item.widgets as unknown[])[0] as Obj) : null;
  const wType = typeof widget?.type === 'string' ? widget.type.toLowerCase() : '';
  const href = httpUrl(item.href);
  const wUrl = httpUrl(widget?.url);
  const url = href ?? wUrl ?? httpUrl(item.siteMonitor);
  if (!url) return null;
  const internalUrl = wUrl && wUrl !== url && reachable(wUrl) ? wUrl : undefined;
  const base = { key: `homepage:${name}:${url}`, name, url, internalUrl, insecure: url.startsWith('https:') || undefined, exists: false };
  const deviceType = HOMEPAGE_DEVICES[wType];
  if (widget && deviceType) {
    const d: Candidate = { ...base, kind: 'device', type: deviceType, missingSecret: false };
    if (deviceType === 'proxmox') Object.assign(d, { username: secret(widget.username), token: secret(widget.password), insecure: true });
    else if (deviceType === 'truenas') d.token = secret(widget.key);
    else Object.assign(d, { username: secret(widget.username), password: secret(widget.password) });
    d.missingSecret = needsSecret('device', deviceType) && !(d.token || d.password);
    return d;
  }
  const type: ServiceType = (widget && HOMEPAGE_SERVICES[wType]) || 'generic';
  const s: Candidate = { ...base, kind: 'service', type, missingSecret: false };
  const auth = SERVICE_TYPES[type].auth;
  if (auth === 'apiKey' || auth === 'token') s.apiKey = secret(widget?.key);
  else if (auth === 'password') s.password = secret(widget?.key ?? widget?.password);
  else if (auth === 'userpass' || auth === 'userpass-optional') Object.assign(s, { username: secret(widget?.username), password: secret(widget?.password) });
  s.missingSecret = needsSecret('service', type) && !(s.apiKey || s.password);
  return s;
}

/** Parcourt les groupes (et sous-groupes) de services.yaml : « - Groupe: [ - Application: {…} ] ». */
function walk(node: unknown, out: Candidate[], depth = 0) {
  if (depth > 6) return;
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, out, depth + 1);
    return;
  }
  if (!isObj(node)) return;
  for (const [name, value] of Object.entries(node)) {
    if (Array.isArray(value)) walk(value, out, depth + 1);
    else if (isObj(value)) {
      const c = homepageItem(name, value);
      if (c) out.push(c);
      else walk(value, out, depth + 1);
    }
  }
}

/**
 * Applications du fichier services.yaml de Homepage. `parse` : lecteur YAML (bibliothèque chargée à la demande).
 * Les clés laissées en variables de Homepage ({{HOMEPAGE_VAR_…}}) sont à saisir ensuite dans Ostal.
 */
export function fromHomepage(text: string, cfg: HomelabConfig, parse: (s: string) => unknown): { candidates: Candidate[]; error?: string } {
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    const line = (err as { linePos?: { line: number }[] }).linePos?.[0]?.line;
    return { candidates: [], error: line ? t('Ce texte n’est pas un fichier YAML valide (ligne {line}).', { line }) : t('Ce texte n’est pas un fichier YAML valide.') };
  }
  const found: Candidate[] = [];
  walk(data, found);
  if (!found.length) {
    return {
      candidates: [],
      error: t('Aucune application dans ce texte. Collez le contenu de services.yaml (pas celui de settings.yaml ou bookmarks.yaml).'),
    };
  }
  return { candidates: finish(found, cfg) };
}

/** Ajoute les éléments choisis au homelab. */
export function addCandidates(cfg: HomelabConfig, chosen: Candidate[]): HomelabConfig {
  const services = [...cfg.services];
  const devices = [...cfg.devices];
  for (const c of chosen) {
    if (c.kind === 'service') {
      const type = c.type as ServiceType;
      services.push({
        id: newId(),
        name: c.name || SERVICE_TYPES[type].label,
        type,
        url: c.url,
        internalUrl: c.internalUrl,
        category: SERVICE_TYPES[type].category,
        icon: '',
        apiKey: c.apiKey,
        username: c.username,
        password: c.password,
        insecure: c.insecure,
      });
    } else {
      const type = c.type as DeviceType;
      devices.push({
        id: newId(),
        name: c.name || DEVICE_TYPES[type].label,
        type,
        icon: '',
        url: c.url || undefined,
        username: c.username,
        password: c.password,
        token: c.token,
        insecure: c.insecure ?? (type === 'proxmox' || undefined),
      });
    }
  }
  return { ...cfg, services, devices };
}
