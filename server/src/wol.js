// Allumer un ordinateur à distance (Wake-on-LAN) : envoi du « paquet magique » qui réveille sa carte réseau, état
// allumé ou éteint de l'ordinateur, et recherche des appareils du réseau local (pour le régler sans connaître son
// adresse MAC). Dans Docker, le serveur est sur un réseau à part qui n'atteint pas tout le réseau local : le relais
// (wol-relay.js), lancé sur le réseau de la machine hôte, fait alors ce travail à sa place (WOL_RELAY : son socket).
import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { execFile } from 'node:child_process';

const RELAY = process.env.WOL_RELAY || '';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// ---------- Adresses ----------

/**
 * Adresse MAC écrite « AA:BB:CC:DD:EE:FF », ou null : invalide, ou adresse de groupe qui ne désigne aucune carte
 * réseau. Formes acceptées : AA:BB:CC:DD:EE:FF, aa-bb-cc-dd-ee-ff, a:b:c:d:e:f (macOS), aabb.ccdd.eeff, AABBCCDDEEFF.
 */
export function parseMac(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const parts = s.split(/[:-]/);
  const hex =
    parts.length === 6 && parts.every((p) => /^[0-9a-f]{1,2}$/i.test(p)) ? parts.map((p) => p.padStart(2, '0')).join('') : s.replace(/[\s.]/g, '');
  if (!/^[0-9a-f]{12}$/i.test(hex) || /^0{12}$/.test(hex)) return null;
  if (parseInt(hex.slice(0, 2), 16) & 1) return null;
  return hex.toUpperCase().match(/../g).join(':');
}

/** Paquet magique : 6 octets 0xFF puis 16 fois l'adresse MAC de l'ordinateur à réveiller. */
export function magicPacket(mac) {
  const bytes = Buffer.from(mac.replace(/:/g, ''), 'hex');
  const packet = Buffer.alloc(102, 0xff);
  for (let i = 0; i < 16; i++) bytes.copy(packet, 6 + i * 6);
  return packet;
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;
export const isIPv4 = (v) => typeof v === 'string' && IPV4_RE.test(v);
export const ipToInt = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
export const intToIp = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/** Adresse IPv4 d'un appareil désigné par son adresse ou son nom sur le réseau ; null si le nom est inconnu. */
async function resolveIPv4(host) {
  const h = typeof host === 'string' ? host.trim() : '';
  if (isIPv4(h)) return h;
  if (!HOSTNAME_RE.test(h)) throw badRequest('Adresse IP ou nom invalide.');
  try {
    return (await dns.promises.lookup(h, { family: 4 })).address;
  } catch {
    return null;
  }
}

// Interfaces virtuelles (Docker, machines virtuelles, VPN…) : pas le réseau de la maison.
const VIRTUAL_IF =
  /^(docker|br-[0-9a-f]{12}$|veth|virbr|vboxnet|vmnet|lxcbr|lxdbr|cni|flannel|cali|kube|tun|tap|wg|zt|utun|awdl|llw|anpi|bridge\d)|vethernet|virtualbox|vmware|hyper-v|loopback|bluetooth|tailscale|zerotier|wireguard/i;

/** Réseaux locaux IPv4 du serveur : interface, adresse, réseau et adresse de diffusion (en entiers), préfixe. */
export function localNetworks(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [iface, addrs] of Object.entries(ifaces)) {
    if (VIRTUAL_IF.test(iface)) continue;
    for (const a of addrs ?? []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal || !isIPv4(a.address) || !isIPv4(a.netmask)) continue;
      if (a.address.startsWith('169.254.')) continue;
      const mask = ipToInt(a.netmask);
      // /31 et /32 : liaisons point à point (VPN), pas un réseau d'appareils.
      if (mask >= 0xfffffffe) continue;
      const network = (ipToInt(a.address) & mask) >>> 0;
      const prefix = mask.toString(2).replace(/0/g, '').length;
      out.push({ iface, address: a.address, network, broadcast: (network | ~mask) >>> 0, prefix, mask });
    }
  }
  return out;
}

const inNetwork = (ip, n) => ((ipToInt(ip) & n.mask) >>> 0) === n.network;

/** Adresses à parcourir dans un réseau : toutes s'il est petit (/24 au plus), sinon les 254 voisines du serveur. */
export function scanRange(n) {
  let first = n.network + 1;
  let last = n.broadcast - 1;
  if (last - first > 253) {
    const base = (ipToInt(n.address) & 0xffffff00) >>> 0;
    first = base + 1;
    last = base + 254;
  }
  const out = [];
  for (let i = first; i <= last; i++) out.push(intToIp(i));
  return out;
}

/** Passerelle par défaut (la box) sous Linux, ou null. */
function defaultGateway() {
  try {
    for (const line of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const [, dest, gw] = line.trim().split(/\s+/);
      if (dest !== '00000000' || !gw || gw === '00000000') continue;
      const n = parseInt(gw, 16); // octets dans l'ordre de la machine (petit-boutiste)
      return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24].join('.');
    }
  } catch {
    /* pas Linux */
  }
  return null;
}

/** Serveur dans un conteneur, sur un réseau Docker à part (sans le relais) : le signal n'atteint pas le réseau local. */
function isolated() {
  if (!fs.existsSync('/.dockerenv') && !fs.existsSync('/run/.containerenv')) return false;
  const ifaces = os.networkInterfaces();
  if (ifaces.docker0) return false; // réseau de la machine hôte (network_mode: host)
  const docker = ipToInt('172.16.0.0');
  return localNetworks(ifaces).every((n) => ((ipToInt(n.address) & 0xfff00000) >>> 0) === docker);
}

// ---------- Commandes du système ----------

/** Lance une commande (sans shell) : { code, stdout } ; code null si elle a échoué à démarrer ou a été interrompue. */
function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout) => {
      const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
      resolve({ code, stdout: String(stdout ?? ''), missing: err?.code === 'ENOENT' });
    });
  });
}

const absent = new Set();
/** Commande du système, ou à défaut celle de BusyBox (image Docker Alpine). */
async function runTool(name, args, timeout) {
  if (!absent.has(name)) {
    const r = await run(name, args, timeout);
    if (!r.missing) return r;
    absent.add(name);
  }
  if (absent.has('busybox')) return { code: null, stdout: '', missing: true };
  const r = await run('busybox', [name, ...args], timeout);
  if (r.missing) absent.add('busybox');
  return r;
}

/** Table ARP de /proc/net/arp (Linux) : adresse IP → adresse MAC, entrées complètes seulement. */
export function parseProcArp(text, table = new Map()) {
  for (const line of text.split('\n').slice(1)) {
    const [ip, , flags, mac] = line.trim().split(/\s+/);
    if (!isIPv4(ip) || !(Number(flags) & 2)) continue;
    const m = parseMac(mac ?? '');
    if (m) table.set(ip, m);
  }
  return table;
}

/** Sortie de « arp -a » (Windows : « 192.168.1.20  aa-bb-cc-dd-ee-ff  dynamique ») ou « arp -an » (macOS). */
export function parseArpOutput(text, table = new Map()) {
  for (const line of text.split(/\r?\n/)) {
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1];
    const mac = line.match(/\b([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b/i)?.[1];
    if (!isIPv4(ip) || !mac) continue;
    const m = parseMac(mac);
    if (m) table.set(ip, m);
  }
  return table;
}

/** Appareils récemment vus sur le réseau (table ARP du système) : adresse IP → adresse MAC. */
async function arpTable() {
  if (process.platform === 'linux') {
    try {
      return parseProcArp(fs.readFileSync('/proc/net/arp', 'utf8'));
    } catch {
      /* /proc absent : commande arp */
    }
  }
  const r = await run('arp', process.platform === 'win32' ? ['-a'] : ['-an']);
  return parseArpOutput(r.stdout);
}

// ---------- Ordinateur allumé ? ----------

/**
 * Demande ARP (même réseau local) : tout appareil allumé y répond, même pare-feu fermé, avec son adresse MAC.
 * null quand l'outil manque ou n'a pas les droits : on ne sait pas.
 */
async function arping(ip, iface) {
  // -f : arrêt à la première réponse ; deux demandes, 2 secondes au plus.
  const r = await runTool('arping', ['-f', '-c', '2', '-w', '2', '-I', iface, ip], 5000);
  const out = r.stdout;
  if (r.code === 0 && /reply from/i.test(out)) {
    return { up: true, mac: parseMac(out.match(/\[([0-9a-f:]{11,17})\]/i)?.[1] ?? ''), method: 'arp' };
  }
  if (/sent \d+ probe/i.test(out) && /received 0 /i.test(out)) return { up: false, mac: null, method: 'arp' };
  return null;
}

async function ping(ip) {
  const win = process.platform === 'win32';
  const args = win ? ['-n', '1', '-w', '1000', ip] : process.platform === 'darwin' ? ['-c', '1', '-t', '1', ip] : ['-c', '1', '-W', '1', ip];
  const r = await run('ping', args, 3000);
  // Windows répond 0 même pour « Impossible de joindre l'hôte » : seule une vraie réponse porte « TTL= ».
  return r.code === 0 && (!win || /ttl=/i.test(r.stdout));
}

/** Port TCP : connexion acceptée ou refusée (l'ordinateur a répondu), ou silence. */
function tcpCheck(ip, port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    const done = (up) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', (err) => done(err.code === 'ECONNREFUSED'));
  });
}

/** Vrai dès qu'une vérification réussit ; faux quand toutes ont échoué. */
function anyTrue(checks) {
  return new Promise((resolve) => {
    let left = checks.length;
    if (!left) resolve(false);
    const one = (ok) => (ok ? resolve(true) : --left === 0 && resolve(false));
    for (const c of checks) c.then(one, () => one(false));
  });
}

// Bureau à distance, partage de fichiers, SSH, VNC, NetBIOS, RPC, web.
const PROBE_PORTS = [3389, 445, 22, 5900, 139, 135, 80, 443];

const validPort = (p) => {
  const n = Number(p);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
};

/**
 * État d'un ordinateur : réponse ARP sur le réseau local (fiable), sinon ping ou port TCP. `mac` (facultatif) : celle
 * de l'ordinateur réglé, pour reconnaître une adresse IP passée à un autre appareil.
 */
export async function probe({ host, port, mac } = {}) {
  const ip = await resolveIPv4(host);
  if (!ip) return { online: false, ip: null, mac: null, method: 'dns', error: 'Nom introuvable sur le réseau.' };
  const wanted = parseMac(mac ?? '');
  const nets = localNetworks();
  if (nets.some((n) => n.address === ip)) return { online: true, ip, mac: null, method: 'self' };
  const local = nets.find((n) => inNetwork(ip, n));
  let result = local && process.platform === 'linux' ? await arping(ip, local.iface) : null;
  if (!result) {
    const ports = [...new Set([validPort(port), ...PROBE_PORTS].filter(Boolean))];
    const up = await anyTrue([ping(ip), ...ports.map((p) => tcpCheck(ip, p))]);
    result = { up, mac: up && local ? ((await arpTable()).get(ip) ?? null) : null, method: 'ping' };
  }
  // Adresse IP donnée par la box à un autre appareil : ce n'est pas l'ordinateur réglé.
  const other = Boolean(result.up && wanted && result.mac && result.mac !== wanted);
  return { online: result.up && !other, ip, mac: result.mac, method: result.method, ...(other ? { otherDevice: true } : {}) };
}

// ---------- Réveil ----------

/** Envoie le paquet magique : diffusion générale, diffusion de chaque réseau local et adresse de l'ordinateur. */
export async function wake({ mac, host, broadcast } = {}) {
  const target = parseMac(mac);
  if (!target) throw badRequest('Adresse MAC invalide.');
  const nets = localNetworks();
  const addresses = new Set(['255.255.255.255', ...nets.map((n) => intToIp(n.broadcast))]);
  const ip = host ? await resolveIPv4(host).catch(() => null) : null;
  if (ip) {
    // Directement à son adresse (marche tant que le réseau se souvient de sa carte), et à son réseau local (/24) s'il
    // est ailleurs que sur ceux du serveur.
    addresses.add(ip);
    if (isPrivate(ip) && !nets.some((n) => inNetwork(ip, n))) addresses.add(intToIp((ipToInt(ip) | 255) >>> 0));
  }
  if (broadcast) {
    const b = await resolveIPv4(broadcast);
    if (!b) throw badRequest('Adresse de diffusion introuvable.');
    addresses.add(b);
  }
  const sent = await sendAll(magicPacket(target), [...addresses]);
  if (!sent.length) throw Object.assign(new Error('Envoi du signal impossible : aucun réseau disponible.'), { status: 502 });
  console.log(`[wol] signal de réveil envoyé à ${target} (${sent.join(', ')})`);
  return { mac: target, sent };
}

async function sendAll(packet, addresses) {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, () => {
      socket.off('error', reject);
      resolve();
    });
  });
  socket.on('error', () => {});
  socket.setBroadcast(true);
  const sent = new Set();
  // Trois fois, sur les ports 9 et 7 : un datagramme perdu ne fait pas rater le réveil.
  for (let round = 0; round < 3; round++) {
    await Promise.all(
      addresses.flatMap((address) =>
        [9, 7].map(
          (port) =>
            new Promise((resolve) =>
              socket.send(packet, port, address, (err) => {
                if (!err) sent.add(address);
                resolve();
              }),
            ),
        ),
      ),
    );
    if (round < 2) await delay(150);
  }
  socket.close();
  return addresses.filter((a) => sent.has(a));
}

// ---------- Recherche des appareils du réseau ----------

/** Un datagramme vers chaque adresse : le système demande (ARP) quelle carte réseau la porte ; seuls les appareils allumés répondent. */
function poke(ips) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => resolve());
    socket.bind(0, () => {
      let left = ips.length;
      const payload = Buffer.alloc(1);
      for (const ip of ips) {
        socket.send(payload, 9, ip, () => {
          if (--left === 0) {
            socket.close();
            resolve();
          }
        });
      }
    });
  });
}

// Demande NetBIOS « état du nœud » (nom « * ») : les ordinateurs Windows (et les NAS) répondent avec leur nom.
const NBSTAT_QUERY = (() => {
  const b = Buffer.alloc(50);
  b.writeUInt16BE(1, 4); // une question
  b[12] = 0x20;
  b.write(`CK${'A'.repeat(30)}`, 13, 'ascii'); // « * » suivi de 15 octets nuls, codés deux lettres par octet
  b.writeUInt16BE(0x21, 46); // type NBSTAT
  b.writeUInt16BE(1, 48); // classe IN
  return b;
})();

/** Nom de l'ordinateur dans une réponse NetBIOS (premier nom unique de suffixe 0x00), ou ''. */
export function parseNbstat(buf) {
  try {
    if (buf.length < 57 || !(buf[2] & 0x80) || buf.readUInt16BE(6) < 1) return '';
    // Nom interrogé : suite de libellés terminée par un octet nul, ou renvoi (2 octets) vers un nom déjà écrit.
    let off = 12;
    while (off < buf.length) {
      const len = buf[off];
      if ((len & 0xc0) === 0xc0) {
        off += 2;
        break;
      }
      off += 1 + len;
      if (!len) break;
    }
    off += 10; // type, classe, durée de vie, longueur
    const count = buf[off++];
    for (let i = 0; i < count && off + 18 <= buf.length; i++, off += 18) {
      const group = buf.readUInt16BE(off + 16) & 0x8000;
      if (buf[off + 15] === 0 && !group) return buf.toString('latin1', off, off + 15).replace(/[\0 ]+$/, '');
    }
  } catch {
    /* réponse tronquée */
  }
  return '';
}

function netbiosNames(ips, timeout = 1200) {
  return new Promise((resolve) => {
    const names = new Map();
    if (!ips.length) return resolve(names);
    const socket = dgram.createSocket('udp4');
    let timer;
    const finish = () => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* déjà fermé */
      }
      resolve(names);
    };
    timer = setTimeout(finish, timeout);
    socket.on('error', finish);
    socket.on('message', (msg, rinfo) => {
      const name = parseNbstat(msg);
      if (name) names.set(rinfo.address, name);
      if (names.size === ips.length) finish();
    });
    socket.bind(0, () => {
      for (const ip of ips) {
        const q = Buffer.from(NBSTAT_QUERY);
        q.writeUInt16BE(Math.floor(Math.random() * 65536), 0);
        socket.send(q, 137, ip, () => {});
      }
    });
  });
}

/** Noms donnés par le DNS de la box (« PC-salon.home » → « PC-salon »). */
async function reverseNames(ips, timeout = 1500) {
  const resolver = new dns.promises.Resolver({ timeout: 1000, tries: 1 });
  const names = new Map();
  await Promise.all(
    ips.map(async (ip) => {
      try {
        const [name] = await Promise.race([resolver.reverse(ip), delay(timeout).then(() => [])]);
        const short = String(name ?? '').split('.')[0];
        if (short) names.set(ip, short);
      } catch {
        /* pas de nom */
      }
    }),
  );
  resolver.cancel();
  return names;
}

/** Appareils allumés du réseau local : adresse IP, adresse MAC, nom (NetBIOS pour Windows, sinon DNS de la box). */
export async function scan() {
  const nets = localNetworks();
  const own = new Set(nets.map((n) => n.address));
  const targets = new Set();
  for (const n of nets) for (const ip of scanRange(n)) if (!own.has(ip) && targets.size < 512) targets.add(ip);
  const networks = [...new Set(nets.map((n) => `${intToIp(n.network)}/${n.prefix}`))];
  if (!targets.size) return { devices: [], networks };
  await poke([...targets]);
  // Le système refait sa demande ARP chaque seconde : 2 secondes suffisent aux appareils lents (Wi-Fi en veille).
  await delay(2200);
  const table = await arpTable();
  const devices = [...targets].filter((ip) => table.has(ip)).map((ip) => ({ ip, mac: table.get(ip), name: '' }));
  const ips = devices.map((d) => d.ip);
  const [netbios, dnsNames] = await Promise.all([netbiosNames(ips), reverseNames(ips)]);
  const gateway = defaultGateway();
  for (const d of devices) {
    d.name = netbios.get(d.ip) || dnsNames.get(d.ip) || '';
    if (d.ip === gateway) d.router = true;
  }
  return { devices, networks };
}

// ---------- Actions (ici, ou par le relais) ----------

const statusCache = new Map();
const scanCache = new Map();

/** Résultat récent réutilisé (plusieurs appareils affichent le même widget), une seule vérification à la fois. */
function cached(cache, key, ttl, fn) {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > Math.max(ttl, 60_000)) cache.delete(k);
  const hit = cache.get(key);
  if (hit && now - hit.at < ttl) return hit.promise;
  const promise = fn();
  cache.set(key, { at: now, promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

const ACTIONS = {
  wake: (body) => wake(body),
  status: (body) => cached(statusCache, JSON.stringify([body.host, body.port, body.mac]), 3000, () => probe(body)),
  scan: () => cached(scanCache, 'scan', 10_000, () => scan()),
};

export const isAction = (name) => Object.hasOwn(ACTIONS, name);

/** Exécute une action ici même (serveur sur le réseau local, ou relais). */
export function runAction(name, body) {
  return ACTIONS[name](body && typeof body === 'object' ? body : {});
}

function relayCall(name, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body ?? {});
    const req = http.request(
      {
        socketPath: RELAY,
        path: `/${name}`,
        method: 'POST',
        agent: false,
        timeout: 20_000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let data = null;
          try {
            data = JSON.parse(text);
          } catch {
            /* réponse illisible */
          }
          if (res.statusCode === 200 && data) resolve(data);
          else reject(Object.assign(new Error(data?.error || 'Réponse invalide du relais réseau.'), { status: res.statusCode || 502 }));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Délai dépassé')));
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * Action demandée par le serveur : par le relais quand il est configuré (Docker), sinon ici. Relais injoignable
 * (arrêté, pas encore installé) : on tente d'ici, et l'application le signale (`relay: 'down'`).
 */
export async function wolAction(name, body) {
  let relay = 'none';
  if (RELAY) {
    try {
      return { ...(await relayCall(name, body)), relay: 'ok' };
    } catch (err) {
      if (err.status) throw err;
      console.warn(`[wol] relais réseau injoignable (${err.code || err.message}) : action faite depuis le serveur.`);
      relay = 'down';
    }
  }
  const iso = isolated();
  // Réseau Docker à part : la recherche n'y trouverait que d'autres conteneurs.
  if (iso && name === 'scan') return { devices: [], networks: [], relay, isolated: true };
  return { ...(await runAction(name, body)), relay, ...(iso ? { isolated: true } : {}) };
}
