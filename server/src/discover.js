// Homelab : recherche des applications et appareils du réseau local, pour les proposer sans rien saisir. Ports connus
// des applications courantes, puis page d'accueil reconnue (titre, en-têtes) ; une application inconnue qui a une page
// web est proposée sous son titre. Lancée par le relais réseau dans Docker (voir wol.js), sinon par le serveur.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { arpTable, defaultGateway, isolated, localNetworks, poke, scanRange } from './wol.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ports par défaut des applications et appareils les plus courants d'un serveur maison.
export const PORTS = [
  80, 443, 81, 2283, 3000, 3001, 4533, 5000, 5001, 5055, 6767, 7575, 7878, 8000, 8006, 8080, 8081, 8083, 8096, 8123, 8181, 8200, 8384,
  8443, 8686, 8787, 8920, 8989, 9000, 9091, 9443, 9696, 9925, 32400, 61208,
];
// Ports où l'on essaie d'abord HTTPS.
const TLS_FIRST = new Set([443, 5001, 8006, 8443, 8920, 9443]);

// Applications et appareils reconnus : type (celui du homelab de Melo) et motif cherché dans le titre de la page, ou
// dans les en-têtes. L'ordre compte : le premier motif trouvé l'emporte.
const RULES = [
  { kind: 'device', type: 'proxmox', title: /Proxmox/i },
  { kind: 'device', type: 'synology', title: /Synology|DiskStation/i },
  { kind: 'device', type: 'truenas', title: /TrueNAS/i },
  { kind: 'device', type: 'glances', title: /^Glances/i },
  { kind: 'service', type: 'jellyseerr', title: /Jellyseerr/i },
  { kind: 'service', type: 'overseerr', title: /Overseerr/i },
  { kind: 'service', type: 'sonarr', title: /Sonarr/i },
  { kind: 'service', type: 'radarr', title: /Radarr/i },
  { kind: 'service', type: 'lidarr', title: /Lidarr/i },
  { kind: 'service', type: 'readarr', title: /Readarr/i },
  { kind: 'service', type: 'prowlarr', title: /Prowlarr/i },
  { kind: 'service', type: 'bazarr', title: /Bazarr/i },
  { kind: 'service', type: 'jellyfin', title: /Jellyfin/i },
  { kind: 'service', type: 'emby', title: /Emby/i },
  { kind: 'service', type: 'plex', title: /^Plex/i, header: 'x-plex-protocol' },
  { kind: 'service', type: 'qbittorrent', title: /qBittorrent/i },
  { kind: 'service', type: 'transmission', title: /Transmission/i, header: 'x-transmission-session-id' },
  { kind: 'service', type: 'pihole', title: /Pi-hole/i },
  { kind: 'service', type: 'adguard', title: /AdGuard/i },
  { kind: 'service', type: 'portainer', title: /Portainer/i },
  { kind: 'service', type: 'homeassistant', title: /Home Assistant/i },
  { kind: 'service', type: 'uptimekuma', title: /Uptime Kuma/i },
  { kind: 'service', type: 'nextcloud', title: /Nextcloud/i },
  { kind: 'service', type: 'immich', title: /Immich/i },
];

// Pages qui ne sont pas une application (erreur, page par défaut d'un serveur web).
const NOT_AN_APP = /^(\d{3}\b|error|erreur|not found|forbidden|unauthorized|bad request|bad gateway|service unavailable|index of|it works|welcome to nginx|apache.*default page|test page|default page|document|untitled|redirect|loading)/i;

/** Port TCP ouvert ? (connexion acceptée dans le délai). */
function portOpen(host, port, timeout = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Exécute les tâches `concurrency` par `concurrency`. */
async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Début de la page d'accueil (64 Ko au plus), en suivant jusqu'à 3 redirections sur la même machine. Certificats non
 * vérifiés : les applications d'un serveur maison en ont rarement un valable.
 */
function peek(url, redirects = 3, timeout = 3000) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      return reject(err);
    }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      target,
      { method: 'GET', timeout, rejectUnauthorized: false, headers: { 'user-agent': 'Melo-Homelab/1.0', accept: 'text/html,*/*' } },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && redirects > 0) {
          res.resume();
          let next;
          try {
            next = new URL(location, target);
          } catch {
            return resolve({ status, headers: res.headers, body: '', url: target.href });
          }
          if (next.hostname !== target.hostname) return resolve({ status, headers: res.headers, body: '', url: target.href });
          return resolve(peek(next.href, redirects - 1, timeout));
        }
        const chunks = [];
        let size = 0;
        const finish = () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), url: target.href });
        res.on('data', (c) => {
          chunks.push(c);
          size += c.length;
          if (size >= 64 * 1024) {
            res.destroy();
            finish();
          }
        });
        res.on('end', finish);
        res.on('error', finish);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** Titre d'une page HTML, sans entités ni espaces superflus. */
export function pageTitle(html) {
  const m = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html || '');
  if (!m) return '';
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ce qu'est une page : application ou appareil reconnu, autre application (sous son titre), ou rien d'utile. */
export function recognize({ title = '', headers = {} }) {
  for (const r of RULES) {
    if ((r.header && headers[r.header] !== undefined) || r.title.test(title)) return { kind: r.kind, type: r.type, name: '' };
  }
  // L'interface de Melo elle-même n'est pas à surveiller.
  if (!title || /^Melo\b/.test(title) || NOT_AN_APP.test(title)) return null;
  return { kind: 'service', type: 'generic', name: title.slice(0, 48) };
}

async function identify(host, port) {
  const schemes = TLS_FIRST.has(port) ? ['https', 'http'] : ['http', 'https'];
  for (const scheme of schemes) {
    const base = `${scheme}://${host}${(scheme === 'http' && port === 80) || (scheme === 'https' && port === 443) ? '' : `:${port}`}`;
    let page;
    try {
      page = await peek(`${base}/`);
    } catch {
      continue;
    }
    let found = recognize({ title: pageTitle(page.body), headers: page.headers });
    // Pi-hole : son interface est sous /admin, la racine est souvent vide.
    if ((!found || found.type === 'generic') && (port === 80 || port === 443)) {
      const admin = await peek(`${base}/admin/`).catch(() => null);
      const inAdmin = admin && recognize({ title: pageTitle(admin.body), headers: admin.headers });
      if (inAdmin?.type === 'pihole') found = inAdmin;
    }
    if (!found) return null;
    // Adresse à garder : celle de l'application (après redirection, sans la page de connexion).
    let url = base;
    if (found.type === 'pihole') url = `${base}/admin`;
    return { ...found, url };
  }
  return null;
}

/**
 * Machines à interroger : celle du serveur (sa propre adresse sur le réseau local ; dans un conteneur Docker isolé, la
 * machine hôte vue du conteneur) et les appareils allumés du réseau (sauf la box), 48 au plus.
 */
async function hosts() {
  const gateway = defaultGateway();
  if (isolated()) return gateway ? [{ ip: gateway, self: true }] : [];
  const nets = localNetworks();
  const own = nets.map((n) => n.address);
  const list = own.slice(0, 1).map((ip) => ({ ip, self: true }));
  const range = [];
  for (const n of nets) for (const ip of scanRange(n)) if (!own.includes(ip) && range.length < 512) range.push(ip);
  if (range.length) {
    await poke(range);
    await delay(2200);
    const table = await arpTable();
    for (const ip of range) if (table.has(ip) && ip !== gateway && list.length < 49) list.push({ ip, self: false });
  }
  return list;
}

/** Applications et appareils de ces machines (une application par machine : la même sur deux ports compte une fois). */
export async function findApps(machines, ports = PORTS) {
  const pairs = machines.flatMap((m) => ports.map((port) => ({ ...m, port })));
  const open = (await pool(pairs, 160, async (p) => ((await portOpen(p.ip, p.port)) ? p : null))).filter(Boolean);
  const found = await pool(open, 12, async (p) => {
    const app = await identify(p.ip, p.port).catch(() => null);
    return app ? { ...app, host: p.ip, port: p.port, self: Boolean(p.self) } : null;
  });
  const seen = new Set();
  const apps = [];
  for (const a of found) {
    if (!a) continue;
    const key = `${a.host}|${a.type}|${a.type === 'generic' ? a.name : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    apps.push(a);
  }
  return apps;
}

/** Applications et appareils trouvés sur le réseau local. */
export async function discover() {
  const started = Date.now();
  const machines = await hosts();
  const apps = await findApps(machines);
  console.log(`[homelab] recherche : ${apps.length} application(s) sur ${machines.length} machine(s) en ${Date.now() - started} ms`);
  return { apps, hosts: machines.length };
}
