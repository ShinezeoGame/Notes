// Tableau de bord homelab : vérification des applications (arr-stack, Jellyfin, Seerr…)
// et statistiques des appareils (hôte local, Glances, Proxmox, Synology DSM, TrueNAS).
// Toutes les requêtes partent du serveur (accès LAN, pas de CORS) ; les secrets ne sont jamais renvoyés.
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TIMEOUT = 8_000;

// ---------- Client HTTP minimal (gère les certificats auto-signés) ----------

export function httpRequest(url, { method = 'GET', headers = {}, body, insecure = false, timeout = DEFAULT_TIMEOUT, auth, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error('URL invalide'));
    }
    if (!/^https?:$/.test(target.protocol)) return reject(new Error('Protocole non pris en charge'));
    const lib = target.protocol === 'https:' ? https : http;
    const payload = body == null ? null : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const reqHeaders = { 'user-agent': 'Ostal-Homelab/1.0', accept: 'application/json, text/plain, */*', ...headers };
    if (payload != null && !reqHeaders['content-type'] && typeof body === 'object' && !Buffer.isBuffer(body)) reqHeaders['content-type'] = 'application/json';
    if (payload != null) reqHeaders['content-length'] = Buffer.byteLength(payload);
    const req = lib.request(
      target,
      { method, headers: reqHeaders, auth, rejectUnauthorized: !insecure, timeout },
      (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, target).toString();
          const keepMethod = status === 307 || status === 308;
          return resolve(
            httpRequest(next, { method: keepMethod ? method : 'GET', headers, body: keepMethod ? body : undefined, insecure, timeout, auth, redirects: redirects - 1 }),
          );
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size <= 5 * 1024 * 1024) chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: res.headers,
            text,
            json() {
              try {
                return JSON.parse(text);
              } catch {
                throw new Error('Réponse non JSON');
              }
            },
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Délai dépassé')));
    req.on('error', (err) => reject(err));
    if (payload != null) req.write(payload);
    req.end();
  });
}

async function getJson(url, opts = {}) {
  const r = await httpRequest(url, opts);
  if (r.status === 401 || r.status === 403) throw new Error('Authentification refusée (clé/API ou identifiants invalides)');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function friendly(err) {
  const msg = err?.message || String(err);
  if (/ECONNREFUSED/.test(msg)) return 'Connexion refusée';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Hôte introuvable';
  if (/EHOSTUNREACH|ENETUNREACH/.test(msg)) return 'Hôte injoignable';
  if (/self.signed|certificate|CERT_/i.test(msg)) return 'Certificat TLS non reconnu (activez « ignorer le certificat »)';
  if (/ECONNRESET/.test(msg)) return 'Connexion interrompue';
  return msg.slice(0, 160);
}

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const stat = (label, value, kind) => ({ label, value, ...(kind ? { kind } : {}) });

// ---------- Intégrations applicatives ----------
// Chaque intégration renvoie { stats: [{label, value, kind?}], version? }.

async function arrApp(base, svc, v) {
  const opts = { headers: { 'X-Api-Key': svc.apiKey }, insecure: svc.insecure };
  const [queue, missing, health, status] = await Promise.all([
    getJson(`${base}/api/${v}/queue?pageSize=1`, opts),
    getJson(`${base}/api/${v}/wanted/missing?pageSize=1`, opts).catch(() => null),
    getJson(`${base}/api/${v}/health`, opts).catch(() => []),
    getJson(`${base}/api/${v}/system/status`, opts).catch(() => ({})),
  ]);
  const stats = [stat('File d’attente', n(queue.totalRecords))];
  if (missing) stats.push(stat('Manquants', n(missing.totalRecords)));
  stats.push(stat('Alertes', Array.isArray(health) ? health.length : 0, 'warn-if-positive'));
  return { stats, version: status.version };
}

const integrations = {
  sonarr: (b, s) => arrApp(b, s, 'v3'),
  radarr: (b, s) => arrApp(b, s, 'v3'),
  lidarr: (b, s) => arrApp(b, s, 'v1'),
  readarr: (b, s) => arrApp(b, s, 'v1'),
  whisparr: (b, s) => arrApp(b, s, 'v3'),
  prowlarr: async (base, svc) => {
    const opts = { headers: { 'X-Api-Key': svc.apiKey }, insecure: svc.insecure };
    const [indexers, health, status] = await Promise.all([
      getJson(`${base}/api/v1/indexer`, opts),
      getJson(`${base}/api/v1/health`, opts).catch(() => []),
      getJson(`${base}/api/v1/system/status`, opts).catch(() => ({})),
    ]);
    const list = Array.isArray(indexers) ? indexers : [];
    return {
      stats: [stat('Indexeurs actifs', list.filter((i) => i.enable !== false).length), stat('Indexeurs', list.length), stat('Alertes', health.length, 'warn-if-positive')],
      version: status.version,
    };
  },
  bazarr: async (base, svc) => {
    const opts = { headers: { 'X-API-KEY': svc.apiKey }, insecure: svc.insecure };
    const [badges, status] = await Promise.all([getJson(`${base}/api/badges`, opts), getJson(`${base}/api/system/status`, opts).catch(() => ({}))]);
    return {
      stats: [stat('Épisodes sans sous-titres', n(badges.episodes)), stat('Films sans sous-titres', n(badges.movies)), stat('Fournisseurs limités', n(badges.throttled_providers), 'warn-if-positive')],
      version: status?.data?.bazarr_version,
    };
  },
  jellyfin: async (base, svc) => {
    const opts = { headers: { Authorization: `MediaBrowser Token="${svc.apiKey}", Client="Ostal", Device="Ostal", DeviceId="notes-homelab", Version="1.0"`, 'X-Emby-Token': svc.apiKey }, insecure: svc.insecure };
    const [sessions, counts, info] = await Promise.all([
      getJson(`${base}/Sessions?activeWithinSeconds=300`, opts),
      getJson(`${base}/Items/Counts`, opts).catch(() => ({})),
      getJson(`${base}/System/Info`, opts).catch(() => ({})),
    ]);
    const playing = (Array.isArray(sessions) ? sessions : []).filter((s) => s.NowPlayingItem).length;
    return {
      stats: [stat('Lectures en cours', playing), stat('Films', n(counts.MovieCount)), stat('Séries', n(counts.SeriesCount)), stat('Épisodes', n(counts.EpisodeCount))],
      version: info.Version,
    };
  },
  emby: async (base, svc) => integrations.jellyfin(base, svc),
  plex: async (base, svc) => {
    const opts = { headers: { 'X-Plex-Token': svc.apiKey, accept: 'application/json' }, insecure: svc.insecure };
    const [sessions, identity] = await Promise.all([getJson(`${base}/status/sessions`, opts), getJson(`${base}/identity`, opts).catch(() => ({}))]);
    return { stats: [stat('Lectures en cours', n(sessions?.MediaContainer?.size))], version: identity?.MediaContainer?.version };
  },
  jellyseerr: async (base, svc) => {
    const opts = { headers: { 'X-Api-Key': svc.apiKey }, insecure: svc.insecure };
    const [count, status] = await Promise.all([getJson(`${base}/api/v1/request/count`, opts), getJson(`${base}/api/v1/status`, opts).catch(() => ({}))]);
    return {
      stats: [stat('Demandes en attente', n(count.pending), 'warn-if-positive'), stat('En traitement', n(count.processing)), stat('Disponibles', n(count.available)), stat('Total', n(count.total))],
      version: status.version,
    };
  },
  overseerr: async (base, svc) => integrations.jellyseerr(base, svc),
  seerr: async (base, svc) => integrations.jellyseerr(base, svc),
  qbittorrent: async (base, svc) => {
    const login = await httpRequest(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', referer: base, origin: base },
      body: `username=${encodeURIComponent(svc.username || '')}&password=${encodeURIComponent(svc.password || '')}`,
      insecure: svc.insecure,
    });
    const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    if (!login.ok || !/Ok/i.test(login.text) || !cookie) throw new Error('Identifiants qBittorrent refusés');
    const opts = { headers: { cookie, referer: base }, insecure: svc.insecure };
    const [transfer, downloading, version] = await Promise.all([
      getJson(`${base}/api/v2/transfer/info`, opts),
      getJson(`${base}/api/v2/torrents/info?filter=downloading`, opts).catch(() => []),
      httpRequest(`${base}/api/v2/app/version`, opts).then((r) => r.text.trim()).catch(() => undefined),
    ]);
    httpRequest(`${base}/api/v2/auth/logout`, { method: 'POST', ...opts }).catch(() => {});
    return {
      stats: [stat('Réception', n(transfer.dl_info_speed), 'speed'), stat('Envoi', n(transfer.up_info_speed), 'speed'), stat('Téléchargements actifs', Array.isArray(downloading) ? downloading.length : 0)],
      version,
    };
  },
  transmission: async (base, svc) => {
    const auth = svc.username ? `${svc.username}:${svc.password || ''}` : undefined;
    const rpc = `${base}/transmission/rpc`;
    let r = await httpRequest(rpc, { method: 'POST', body: { method: 'session-stats' }, auth, insecure: svc.insecure });
    if (r.status === 409) {
      const sid = r.headers['x-transmission-session-id'];
      r = await httpRequest(rpc, { method: 'POST', body: { method: 'session-stats' }, headers: { 'x-transmission-session-id': sid }, auth, insecure: svc.insecure });
    }
    if (r.status === 401) throw new Error('Identifiants Transmission refusés');
    const data = r.json();
    const a = data.arguments || {};
    return { stats: [stat('Réception', n(a.downloadSpeed), 'speed'), stat('Envoi', n(a.uploadSpeed), 'speed'), stat('Torrents actifs', n(a.activeTorrentCount)), stat('Torrents', n(a.torrentCount))] };
  },
  pihole: async (base, svc) => {
    const secret = svc.password || svc.apiKey || '';
    // Pi-hole v6
    const auth = await httpRequest(`${base}/api/auth`, { method: 'POST', body: { password: secret }, insecure: svc.insecure }).catch(() => null);
    if (auth && auth.status !== 404) {
      const sid = auth.json()?.session?.sid;
      if (!sid) throw new Error('Mot de passe Pi-hole refusé');
      const opts = { headers: { sid }, insecure: svc.insecure };
      const [summary, version] = await Promise.all([getJson(`${base}/api/stats/summary`, opts), getJson(`${base}/api/info/version`, opts).catch(() => ({}))]);
      httpRequest(`${base}/api/auth`, { method: 'DELETE', ...opts }).catch(() => {});
      const q = summary.queries || {};
      return {
        stats: [stat('Requêtes (24 h)', n(q.total)), stat('Bloquées', n(q.blocked)), stat('Taux de blocage', `${n(q.percent_blocked).toFixed(1)} %`), stat('Clients actifs', n(summary?.clients?.active))],
        version: version?.version?.core?.local?.version,
      };
    }
    // Pi-hole v5
    const data = await getJson(`${base}/admin/api.php?summaryRaw&auth=${encodeURIComponent(secret)}`, { insecure: svc.insecure });
    if (!('dns_queries_today' in data)) throw new Error('Jeton API Pi-hole refusé');
    return { stats: [stat('Requêtes (24 h)', n(data.dns_queries_today)), stat('Bloquées', n(data.ads_blocked_today)), stat('Taux de blocage', `${n(data.ads_percentage_today).toFixed(1)} %`)] };
  },
  adguard: async (base, svc) => {
    const opts = { auth: `${svc.username || ''}:${svc.password || ''}`, insecure: svc.insecure };
    const [stats, status] = await Promise.all([getJson(`${base}/control/stats`, opts), getJson(`${base}/control/status`, opts).catch(() => ({}))]);
    const total = n(stats.num_dns_queries);
    const blocked = n(stats.num_blocked_filtering);
    return {
      stats: [stat('Requêtes DNS', total), stat('Bloquées', blocked), stat('Taux de blocage', `${total ? ((blocked / total) * 100).toFixed(1) : 0} %`), stat('Protection', status.protection_enabled === false ? 'désactivée' : 'active')],
      version: status.version,
    };
  },
  portainer: async (base, svc) => {
    const opts = { headers: { 'X-API-Key': svc.apiKey }, insecure: svc.insecure };
    const endpoints = await getJson(`${base}/api/endpoints`, opts);
    let running = 0;
    let total = 0;
    for (const ep of (Array.isArray(endpoints) ? endpoints : []).slice(0, 4)) {
      const containers = await getJson(`${base}/api/endpoints/${ep.Id}/docker/containers/json?all=true`, opts).catch(() => []);
      total += containers.length;
      running += containers.filter((c) => c.State === 'running').length;
    }
    return { stats: [stat('Conteneurs actifs', running), stat('Arrêtés', total - running, 'warn-if-positive'), stat('Environnements', Array.isArray(endpoints) ? endpoints.length : 0)] };
  },
  homeassistant: async (base, svc) => {
    const opts = { headers: { Authorization: `Bearer ${svc.apiKey}` }, insecure: svc.insecure };
    const [config, states] = await Promise.all([getJson(`${base}/api/config`, opts), getJson(`${base}/api/states`, opts).catch(() => [])]);
    const list = Array.isArray(states) ? states : [];
    return {
      stats: [stat('Entités', list.length), stat('Indisponibles', list.filter((s) => s.state === 'unavailable').length, 'warn-if-positive'), stat('Instance', config.location_name || '—')],
      version: config.version,
    };
  },
  uptimekuma: async (base, svc) => {
    const r = await httpRequest(`${base}/metrics`, { auth: `:${svc.apiKey}`, insecure: svc.insecure });
    if (r.status === 401) throw new Error('Clé API Uptime Kuma refusée');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    let up = 0;
    let down = 0;
    for (const line of r.text.split('\n')) {
      const m = /^monitor_status\{.*\}\s+(\d)/.exec(line);
      if (m) {
        if (m[1] === '1') up++;
        else if (m[1] === '0') down++;
      }
    }
    return { stats: [stat('Moniteurs OK', up), stat('En panne', down, 'warn-if-positive')] };
  },
  nextcloud: async (base, svc) => {
    const opts = { auth: `${svc.username || ''}:${svc.password || ''}`, headers: { 'OCS-APIRequest': 'true' }, insecure: svc.insecure };
    const data = await getJson(`${base}/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipUpdate=true`, opts);
    const nc = data?.ocs?.data?.nextcloud || {};
    const active = data?.ocs?.data?.activeUsers || {};
    return {
      stats: [stat('Utilisateurs', n(nc?.storage?.num_users)), stat('Actifs (5 min)', n(active.last5minutes)), stat('Fichiers', n(nc?.storage?.num_files)), stat('Espace libre', n(nc?.system?.freespace), 'bytes')],
      version: nc?.system?.version,
    };
  },
  immich: async (base, svc) => {
    const opts = { headers: { 'x-api-key': svc.apiKey }, insecure: svc.insecure };
    const [statsRes, version] = await Promise.all([getJson(`${base}/api/server/statistics`, opts), getJson(`${base}/api/server/version`, opts).catch(() => null)]);
    return {
      stats: [stat('Photos', n(statsRes.photos)), stat('Vidéos', n(statsRes.videos)), stat('Espace utilisé', n(statsRes.usage), 'bytes')],
      version: version ? `${version.major}.${version.minor}.${version.patch}` : undefined,
    };
  },
};

const NEEDS_CREDS = {
  sonarr: 'apiKey', radarr: 'apiKey', lidarr: 'apiKey', readarr: 'apiKey', whisparr: 'apiKey', prowlarr: 'apiKey', bazarr: 'apiKey',
  jellyfin: 'apiKey', emby: 'apiKey', plex: 'apiKey', jellyseerr: 'apiKey', overseerr: 'apiKey', seerr: 'apiKey', qbittorrent: 'username', transmission: null,
  pihole: null, adguard: 'username', portainer: 'apiKey', homeassistant: 'apiKey', uptimekuma: 'apiKey', nextcloud: 'username', immich: 'apiKey',
};

function hasCreds(svc) {
  const field = NEEDS_CREDS[svc.type];
  if (field === undefined) return false;
  if (field === null) return true;
  return Boolean(svc[field]);
}

export async function checkService(svc) {
  const base = String(svc.internalUrl || svc.url || '').trim().replace(/\/+$/, '');
  const result = { id: svc.id, ok: false, latency: null, stats: [], version: null, error: null };
  if (!base) {
    result.error = 'Aucune URL';
    return result;
  }
  const t0 = Date.now();
  const integ = integrations[svc.type];
  if (integ && hasCreds(svc)) {
    try {
      const out = await integ(base, svc);
      result.ok = true;
      result.stats = out.stats || [];
      result.version = out.version || null;
      result.latency = Date.now() - t0;
      return result;
    } catch (err) {
      result.error = `API : ${friendly(err)}`;
    }
  }
  try {
    const t1 = Date.now();
    const r = await httpRequest(base, { insecure: svc.insecure, timeout: 6000 });
    result.ok = r.status > 0 && r.status < 500;
    result.latency = Date.now() - t1;
    if (!result.ok) result.error = `HTTP ${r.status}`;
  } catch (err) {
    result.ok = false;
    result.latency = null;
    result.error = friendly(err);
  }
  return result;
}

// ---------- Appareils ----------

function cpuSnapshot() {
  return os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
}

async function sampleCpuPercent(ms = 600) {
  const a = cpuSnapshot();
  await new Promise((r) => setTimeout(r, ms));
  const b = cpuSnapshot();
  let idle = 0;
  let total = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    idle += b[i].idle - a[i].idle;
    total += b[i].total - a[i].total;
  }
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : null;
}

function readMeminfo() {
  try {
    const txt = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => {
      const m = new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(txt);
      return m ? Number(m[1]) * 1024 : null;
    };
    const total = get('MemTotal');
    const avail = get('MemAvailable');
    const swapTotal = get('SwapTotal');
    const swapFree = get('SwapFree');
    if (total && avail != null) {
      return {
        memory: { total, used: total - avail, percent: Math.round(((total - avail) / total) * 1000) / 10 },
        swap: swapTotal ? { total: swapTotal, used: swapTotal - (swapFree ?? 0), percent: Math.round(((swapTotal - (swapFree ?? 0)) / swapTotal) * 1000) / 10 } : null,
      };
    }
  } catch {
    /* pas de /proc */
  }
  const total = os.totalmem();
  const used = total - os.freemem();
  return { memory: { total, used, percent: Math.round((used / total) * 1000) / 10 }, swap: null };
}

async function readTemps() {
  const temps = [];
  try {
    const zones = (await fsp.readdir('/sys/class/thermal')).filter((z) => z.startsWith('thermal_zone'));
    for (const z of zones.slice(0, 6)) {
      try {
        const raw = Number(await fsp.readFile(path.join('/sys/class/thermal', z, 'temp'), 'utf8'));
        const type = (await fsp.readFile(path.join('/sys/class/thermal', z, 'type'), 'utf8')).trim();
        if (Number.isFinite(raw) && raw > 0) temps.push({ label: type || z, value: Math.round(raw / 100) / 10 });
      } catch {
        /* zone illisible */
      }
    }
  } catch {
    /* pas de capteurs */
  }
  return temps;
}

async function localStats(dev) {
  const mounts = String(dev.mounts || '/').split(',').map((s) => s.trim()).filter(Boolean);
  const [cpu, temps] = await Promise.all([sampleCpuPercent(), readTemps()]);
  const { memory, swap } = readMeminfo();
  const disks = [];
  for (const m of mounts.slice(0, 12)) {
    try {
      const st = await fsp.statfs(m);
      const total = Number(st.blocks) * Number(st.bsize);
      const free = Number(st.bavail) * Number(st.bsize);
      if (total > 0) disks.push({ name: m, total, used: total - free, percent: Math.round(((total - free) / total) * 1000) / 10 });
    } catch {
      disks.push({ name: m, total: 0, used: 0, percent: 0, error: 'introuvable' });
    }
  }
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    model: cpus[0]?.model?.trim() || null,
    cores: cpus.length,
    cpu,
    load: os.loadavg().map((v) => Math.round(v * 100) / 100),
    memory,
    swap,
    disks,
    temps,
    uptime: Math.round(os.uptime()),
    network: null,
    extra: [],
  };
}

async function glancesStats(dev) {
  const base = dev.url.replace(/\/+$/, '');
  const opts = { auth: dev.username ? `${dev.username}:${dev.password || ''}` : undefined, insecure: dev.insecure };
  let api = `${base}/api/4`;
  let quick;
  try {
    quick = await getJson(`${api}/quicklook`, opts);
  } catch (err) {
    if (!/HTTP 404/.test(err.message)) throw err;
    api = `${base}/api/3`;
    quick = await getJson(`${api}/quicklook`, opts);
  }
  const [fsList, sensors, uptime, system, mem, swap, load] = await Promise.all([
    getJson(`${api}/fs`, opts).catch(() => []),
    getJson(`${api}/sensors`, opts).catch(() => []),
    getJson(`${api}/uptime`, opts).catch(() => null),
    getJson(`${api}/system`, opts).catch(() => ({})),
    getJson(`${api}/mem`, opts).catch(() => null),
    getJson(`${api}/swap`, opts).catch(() => null),
    getJson(`${api}/load`, opts).catch(() => null),
  ]);
  const memInfo = mem && mem.total ? { total: n(mem.total), used: n(mem.used), percent: n(mem.percent) } : quick.mem != null ? { total: 0, used: 0, percent: n(quick.mem) } : null;
  const swapInfo = swap && swap.total ? { total: n(swap.total), used: n(swap.used), percent: n(swap.percent) } : null;
  const disks = (Array.isArray(fsList) ? fsList : []).map((f) => ({ name: f.mnt_point || f.device_name, total: n(f.size), used: n(f.used), percent: n(f.percent) })).slice(0, 12);
  const temps = (Array.isArray(sensors) ? sensors : [])
    .filter((s) => (s.type || '').startsWith('temperature') && Number.isFinite(Number(s.value)))
    .slice(0, 8)
    .map((s) => ({ label: s.label, value: Number(s.value) }));
  return {
    hostname: system.hostname || null,
    os: system.os_name ? `${system.os_name} ${system.os_version || ''}`.trim() : null,
    model: quick.cpu_name || null,
    cores: null,
    cpu: quick.cpu != null ? n(quick.cpu) : null,
    load: load ? [n(load.min1), n(load.min5), n(load.min15)] : quick.load != null ? [n(quick.load)] : null,
    memory: memInfo,
    swap: swapInfo,
    disks,
    temps,
    uptime: typeof uptime === 'string' ? uptime : null,
    network: null,
    extra: [],
  };
}

async function proxmoxStats(dev) {
  const base = dev.url.replace(/\/+$/, '');
  const opts = { headers: { Authorization: `PVEAPIToken=${dev.username}=${dev.token}` }, insecure: dev.insecure !== false };
  const nodes = (await getJson(`${base}/api2/json/nodes`, opts)).data || [];
  if (!nodes.length) throw new Error('Aucun nœud Proxmox');
  const node = nodes.find((x) => x.node === dev.node) || nodes[0];
  const [status, resources] = await Promise.all([
    getJson(`${base}/api2/json/nodes/${node.node}/status`, opts).then((r) => r.data).catch(() => ({})),
    getJson(`${base}/api2/json/cluster/resources?type=vm`, opts).then((r) => r.data || []).catch(() => []),
  ]);
  const vms = resources.filter((r) => r.node === node.node);
  const running = vms.filter((r) => r.status === 'running').length;
  return {
    hostname: node.node,
    os: status.pveversion || null,
    model: status?.cpuinfo?.model || null,
    cores: status?.cpuinfo?.cpus || node.maxcpu || null,
    cpu: Math.round(n(node.cpu) * 1000) / 10,
    load: Array.isArray(status.loadavg) ? status.loadavg.map((v) => n(v)) : null,
    memory: { total: n(node.maxmem), used: n(node.mem), percent: node.maxmem ? Math.round((n(node.mem) / n(node.maxmem)) * 1000) / 10 : 0 },
    swap: status.swap ? { total: n(status.swap.total), used: n(status.swap.used), percent: status.swap.total ? Math.round((n(status.swap.used) / n(status.swap.total)) * 1000) / 10 : 0 } : null,
    disks: [{ name: 'rootfs', total: n(node.maxdisk), used: n(node.disk), percent: node.maxdisk ? Math.round((n(node.disk) / n(node.maxdisk)) * 1000) / 10 : 0 }],
    temps: [],
    uptime: n(node.uptime),
    network: null,
    extra: [stat('VM / conteneurs actifs', `${running} / ${vms.length}`), stat('Nœuds', nodes.length)],
  };
}

async function synologyStats(dev) {
  const base = dev.url.replace(/\/+$/, '');
  const insecure = dev.insecure;
  const login = await getJson(
    `${base}/webapi/auth.cgi?api=SYNO.API.Auth&version=3&method=login&account=${encodeURIComponent(dev.username || '')}&passwd=${encodeURIComponent(dev.password || '')}&session=NotesHomelab&format=sid`,
    { insecure },
  );
  if (!login.success || !login.data?.sid) throw new Error('Identifiants DSM refusés (compte sans authentification à deux facteurs requis)');
  const sid = login.data.sid;
  try {
    const [util, info, storage] = await Promise.all([
      getJson(`${base}/webapi/entry.cgi?api=SYNO.Core.System.Utilization&version=1&method=get&_sid=${sid}`, { insecure }),
      getJson(`${base}/webapi/entry.cgi?api=SYNO.Core.System&version=1&method=info&_sid=${sid}`, { insecure }).catch(() => ({})),
      getJson(`${base}/webapi/entry.cgi?api=SYNO.Storage.CGI.Storage&version=1&method=load_info&_sid=${sid}`, { insecure }).catch(() => ({})),
    ]);
    const u = util.data || {};
    const cpu = n(u.cpu?.user_load) + n(u.cpu?.system_load) + n(u.cpu?.other_load);
    const memTotal = n(u.memory?.memory_size) * 1024 * 1024;
    const memPercent = n(u.memory?.real_usage);
    const net = Array.isArray(u.network) ? u.network.find((x) => x.device === 'total') || u.network[0] : null;
    const volumes = (storage.data?.volumes || []).map((v) => ({
      name: v.display_name || v.desc || v.id,
      total: n(v.size?.total),
      used: n(v.size?.used),
      percent: v.size?.total ? Math.round((n(v.size.used) / n(v.size.total)) * 1000) / 10 : 0,
    }));
    const temps = (storage.data?.disks || []).filter((d) => d.temp != null).slice(0, 8).map((d) => ({ label: d.name || d.id, value: n(d.temp) }));
    const i = info.data || {};
    if (i.sys_temp != null) temps.unshift({ label: 'Système', value: n(i.sys_temp) });
    return {
      hostname: i.hostname || null,
      os: i.firmware_ver ? `DSM ${i.firmware_ver}` : null,
      model: i.model || null,
      cores: null,
      cpu: Math.round(cpu * 10) / 10,
      load: null,
      memory: { total: memTotal, used: Math.round((memTotal * memPercent) / 100), percent: memPercent },
      swap: null,
      disks: volumes,
      temps,
      uptime: typeof i.up_time === 'string' ? i.up_time : null,
      network: net ? { rx: n(net.rx), tx: n(net.tx) } : null,
      extra: [],
    };
  } finally {
    httpRequest(`${base}/webapi/auth.cgi?api=SYNO.API.Auth&version=1&method=logout&session=NotesHomelab&_sid=${sid}`, { insecure }).catch(() => {});
  }
}

async function truenasStats(dev) {
  const base = dev.url.replace(/\/+$/, '');
  const opts = { headers: { Authorization: `Bearer ${dev.token}` }, insecure: dev.insecure };
  const [info, pools] = await Promise.all([getJson(`${base}/api/v2.0/system/info`, opts), getJson(`${base}/api/v2.0/pool`, opts).catch(() => [])]);
  const disks = (Array.isArray(pools) ? pools : []).map((p) => ({
    name: p.name,
    warn: p.healthy === false,
    total: n(p.size),
    used: n(p.allocated),
    percent: p.size ? Math.round((n(p.allocated) / n(p.size)) * 1000) / 10 : 0,
  }));
  return {
    hostname: info.hostname || null,
    os: info.version || null,
    model: info.model || null,
    cores: info.cores || null,
    cpu: null,
    load: Array.isArray(info.loadavg) ? info.loadavg.map((v) => Math.round(n(v) * 100) / 100) : null,
    memory: info.physmem ? { total: n(info.physmem), used: 0, percent: null } : null,
    swap: null,
    disks,
    temps: [],
    uptime: n(info.uptime_seconds),
    network: null,
    extra: [],
  };
}

const deviceHandlers = { local: localStats, glances: glancesStats, proxmox: proxmoxStats, synology: synologyStats, truenas: truenasStats };

export async function checkDevice(dev) {
  const handler = deviceHandlers[dev.type];
  const result = { id: dev.id, ok: false, error: null };
  if (!handler) {
    result.error = 'Type d’appareil inconnu';
    return result;
  }
  if (dev.type !== 'local' && !dev.url) {
    result.error = 'Aucune URL';
    return result;
  }
  try {
    const stats = await handler(dev);
    return { ...result, ok: true, ...stats };
  } catch (err) {
    result.error = friendly(err);
    return result;
  }
}

// ---------- Orchestration + cache ----------

const cache = new Map(); // wsId -> { at, promise }
const CACHE_TTL = 10_000;

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

export function parseConfig(raw) {
  try {
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      services: Array.isArray(cfg?.services) ? cfg.services : [],
      devices: Array.isArray(cfg?.devices) ? cfg.devices : [],
      refreshSeconds: Number(cfg?.refreshSeconds) || 30,
    };
  } catch {
    return { services: [], devices: [], refreshSeconds: 30 };
  }
}

export function homelabStatus(wsId, config, { force = false } = {}) {
  const cached = cache.get(wsId);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL) return cached.promise;
  const publicService = (s) => ({ id: s.id, name: s.name || '', type: s.type, url: s.url || '', icon: s.icon || '', category: s.category || 'Autres' });
  const publicDevice = (d) => ({ id: d.id, name: d.name || '', type: d.type, icon: d.icon || '' });
  const promise = (async () => {
    const [services, devices] = await Promise.all([
      Promise.all(
        config.services.map(async (s) => ({
          ...publicService(s),
          ...(await withTimeout(checkService(s), 15_000, { id: s.id, ok: false, latency: null, stats: [], version: null, error: 'Délai dépassé' })),
        })),
      ),
      Promise.all(config.devices.map(async (d) => ({ ...publicDevice(d), ...(await withTimeout(checkDevice(d), 15_000, { id: d.id, ok: false, error: 'Délai dépassé' })) }))),
    ]);
    return { services, devices, fetchedAt: Date.now() };
  })();
  cache.set(wsId, { at: Date.now(), promise });
  promise.catch(() => cache.delete(wsId));
  return promise;
}
