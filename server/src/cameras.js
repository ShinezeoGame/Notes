// Caméras de surveillance reliées directement au serveur Melo (sans Home Assistant) : flux vidéo RTSP des caméras
// IP et enregistreurs (Hikvision, Dahua, Reolink, Tapo…), ou images et flux MJPEG en http.
//
// Le serveur se connecte aux caméras sur le réseau local ; les navigateurs ne reçoivent que la vidéo, par des adresses
// signées et temporaires (lecture sans en-têtes d'authentification). Identifiants et adresses des caméras restent dans
// le document de l'espace et ne figurent dans aucune réponse de l'API.
//
// Vidéo : ffmpeg lit le flux et le réemballe, sans le réencoder, en MP4 fragmenté que le navigateur lit avec Media
// Source Extensions. Un seul ffmpeg par flux, partagé entre les spectateurs (les caméras n'acceptent souvent que
// quelques connexions) : un nouveau spectateur reçoit l'en-tête du flux puis les fragments depuis la dernière image
// clé. Si l'appareil ne sait pas lire le format de la caméra (H.265 sur la plupart des ordinateurs), la vidéo est
// convertie en H.264, ou en VP9 à défaut, ce qui sollicite davantage le processeur du serveur.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { signingKey } from './store.js';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// ---------- Configuration ----------

const two = (n) => String(n).padStart(2, '0');

/**
 * Marques : port RTSP par défaut et chemins des flux principal (HD) et secondaire (SD), du plus courant au moins
 * courant (le premier qui répond est retenu).
 */
const BRANDS = {
  hikvision: { port: 554, main: (ch) => [`/Streaming/Channels/${ch}01`], sub: (ch) => [`/Streaming/Channels/${ch}02`] },
  dahua: {
    port: 554,
    main: (ch) => [`/cam/realmonitor?channel=${ch}&subtype=0`],
    sub: (ch) => [`/cam/realmonitor?channel=${ch}&subtype=1`],
  },
  reolink: {
    port: 554,
    main: (ch) => [`/h264Preview_${two(ch)}_main`, `/h265Preview_${two(ch)}_main`],
    sub: (ch) => [`/h264Preview_${two(ch)}_sub`],
  },
  tapo: { port: 554, main: () => ['/stream1'], sub: () => ['/stream2'] },
  ezviz: {
    port: 554,
    main: (ch) => [`/h264/ch${ch}/main/av_stream`, `/Streaming/Channels/${ch}01`],
    sub: (ch) => [`/h264/ch${ch}/sub/av_stream`, `/Streaming/Channels/${ch}02`],
  },
  foscam: { port: 88, main: () => ['/videoMain'], sub: () => ['/videoSub'] },
  uniview: { port: 554, main: (ch) => [`/unicast/c${ch}/s0/live`], sub: (ch) => [`/unicast/c${ch}/s1/live`] },
  axis: { port: 554, main: () => ['/axis-media/media.amp'], sub: () => ['/axis-media/media.amp?resolution=640x360'] },
};
/** Adresses de flux vidéo acceptées (ffmpeg ne peut ouvrir que celles-ci : pas de fichiers du serveur). */
const VIDEO_URL = /^(rtsps?|rtmps?|https?):\/\//i;
const PROTOCOLS = 'tcp,udp,rtp,srtp,tls,rtmp,rtmps,rtmpt,http,https,httpproxy,crypto,hls';

function cleanHost(raw) {
  return String(raw || '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^[^@/]*@/, '')
    .replace(/[/?#].*$/, '')
    .slice(0, 255);
}

/** Une caméra de la configuration, nettoyée (null si invalide). */
export function parseCamera(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(c.id)) return null;
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const brand = c.brand in BRANDS || c.brand === 'image' ? c.brand : 'rtsp';
  let host = cleanHost(c.host);
  let port = Number(c.port);
  // « 192.168.1.20:8554 » saisi dans l'adresse : le port en fait partie.
  const withPort = /^([^:[\]]+):(\d{1,5})$/.exec(host);
  if (withPort) {
    host = withPort[1];
    if (!port) port = Number(withPort[2]);
  }
  const channel = Number(c.channel);
  return {
    id: c.id,
    name: str(c.name, 80) || 'Caméra',
    brand,
    host,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 0,
    channel: Number.isInteger(channel) && channel > 0 && channel < 1000 ? channel : 1,
    username: str(c.username, 200),
    password: typeof c.password === 'string' ? c.password.slice(0, 200) : '',
    url: str(c.url, 2000),
    subUrl: str(c.subUrl, 2000),
    insecure: Boolean(c.insecure),
  };
}

export function parseCamerasConfig(raw) {
  let cfg;
  try {
    cfg = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
  } catch {
    cfg = null;
  }
  return (Array.isArray(cfg?.cameras) ? cfg.cameras : []).map(parseCamera).filter(Boolean);
}

/** « video » : flux lu par ffmpeg ; « image » : image ou flux MJPEG relayé tel quel. */
export const cameraKind = (cam) => (cam.brand === 'image' ? 'image' : 'video');

/** Ajoute identifiant et mot de passe à une adresse qui n'en contient pas (caractères spéciaux encodés). */
function withCredentials(url, username, password) {
  if (!username && !password) return url;
  try {
    const u = new URL(url);
    if (u.username || u.password) return url;
    u.username = username;
    u.password = password;
    return u.toString();
  } catch {
    return url;
  }
}

/** Adresses possibles du flux : « hd » = flux principal ; « sd » = flux secondaire, à défaut le principal. */
export function streamCandidates(cam, quality) {
  let main = [];
  let sub = [];
  const brand = BRANDS[cam.brand];
  if (brand) {
    if (cam.host) {
      const host = cam.host.includes(':') ? `[${cam.host}]` : cam.host;
      const base = `rtsp://${host}:${cam.port || brand.port}`;
      main = brand.main(cam.channel).map((p) => base + p);
      sub = brand.sub(cam.channel).map((p) => base + p);
    }
  } else if (cam.brand === 'rtsp') {
    main = cam.url ? [cam.url] : [];
    sub = cam.subUrl ? [cam.subUrl] : [];
  }
  const list = quality === 'hd' ? main : [...sub, ...main];
  return [...new Set(list.filter((u) => VIDEO_URL.test(u)).map((u) => withCredentials(u, cam.username, cam.password)))];
}

// ---------- Adresses signées ----------

const SECRET = signingKey('camera-link');
const LINK_TTL = 60 * 60_000;

function sign(wsId, camId, exp) {
  return crypto.createHmac('sha256', SECRET).update(`camera\n${wsId}\n${camId}\n${exp}`).digest('base64url');
}

/** Adresse du direct d'une caméra, valable une heure au moins (échéance arrondie : adresse stable). */
export function cameraLink(wsId, camId) {
  const exp = Math.ceil((Date.now() + LINK_TTL) / LINK_TTL) * LINK_TTL;
  const q = new URLSearchParams({ ws: wsId, exp: String(exp), sig: sign(wsId, camId, exp) });
  return `/api/cameras/${encodeURIComponent(camId)}/live?${q}`;
}

export function verifyCameraLink(wsId, camId, exp, sig) {
  const e = Number(exp);
  if (!wsId || !Number.isFinite(e) || e < Date.now() || typeof sig !== 'string') return false;
  const expected = Buffer.from(sign(wsId, camId, e));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---------- ffmpeg ----------

let ffmpegCheck = null;

/** ffmpeg est-il installé ? (inclus dans l'image Docker ; revérifié chaque minute s'il manque) */
export function hasFfmpeg() {
  if (ffmpegCheck && (ffmpegCheck.ok || Date.now() - ffmpegCheck.at < 60_000)) return Promise.resolve(ffmpegCheck.ok);
  return new Promise((resolve) => {
    const done = (ok) => {
      ffmpegCheck = { ok, at: Date.now() };
      resolve(ok);
    };
    try {
      const p = spawn(FFMPEG, ['-hide_banner', '-version'], { stdio: 'ignore' });
      p.on('error', () => done(false));
      p.on('close', (code) => done(code === 0));
    } catch {
      done(false);
    }
  });
}

const NO_FFMPEG = 'ffmpeg n’est pas installé sur le serveur Melo (il est inclus dans l’image Docker ; sinon : sudo apt install ffmpeg).';

function inputArgs(input) {
  const args = [];
  if (/^rtsps?:/i.test(input)) args.push('-rtsp_transport', 'tcp', '-timeout', '10000000');
  else args.push('-rw_timeout', '10000000');
  args.push('-fflags', '+genpts+nobuffer+discardcorrupt', '-analyzeduration', '3000000', '-probesize', '2000000');
  args.push('-protocol_whitelist', PROTOCOLS, '-i', input);
  return args;
}

/** Réemballage (copy) ou conversion (avc, vp9) en MP4 fragmenté, sans le son. */
function streamArgs(input, mode, quality) {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', ...inputArgs(input), '-map', '0:v:0', '-an', '-sn', '-dn'];
  if (mode === 'copy') {
    args.push('-c:v', 'copy');
  } else {
    const hd = quality === 'hd';
    const rate = hd ? '3M' : '800k';
    args.push('-vf', `scale=w='min(iw,${hd ? 1920 : 854})':h=-2`, '-fpsmax', hd ? '25' : '15', '-pix_fmt', 'yuv420p');
    args.push('-force_key_frames', 'expr:gte(t,n_forced*2)');
    if (mode === 'avc') {
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-bf', '0');
      args.push('-crf', '23', '-maxrate', rate, '-bufsize', hd ? '6M' : '1600k');
    } else {
      args.push('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-lag-in-frames', '0');
      args.push('-b:v', rate, '-maxrate', rate, '-bufsize', hd ? '6M' : '1600k');
    }
  }
  args.push('-f', 'mp4', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000', '-flush_packets', '1', 'pipe:1');
  return args;
}

/** Message compréhensible à partir des erreurs de ffmpeg. */
export function explainFfmpeg(stderr) {
  const s = String(stderr || '');
  if (/401|Unauthorized|authorization failed/i.test(s)) return 'Identifiant ou mot de passe refusé par la caméra.';
  if (/403|Forbidden/i.test(s)) return 'La caméra refuse l’accès à ce flux (droits de l’utilisateur ?).';
  if (/404|Not Found|454/i.test(s)) return 'Flux introuvable à cette adresse : vérifiez la marque, le canal ou le chemin du flux.';
  if (/Connection refused/i.test(s)) return 'La caméra refuse la connexion sur ce port : vérifiez le port et que le flux RTSP est activé dans ses réglages.';
  if (/Name or service not known|Temporary failure in name resolution|Failed to resolve|nodename nor servname/i.test(s)) {
    return 'Adresse de la caméra introuvable.';
  }
  if (/timed out|Operation timed out|No route to host|Network is unreachable|Host is unreachable/i.test(s)) {
    return 'Caméra injoignable depuis le serveur Melo : vérifiez son adresse IP.';
  }
  if (/not on whitelist|Protocol not found/i.test(s)) return 'Type d’adresse non pris en charge (rtsp://, rtsps://, rtmp:// ou http(s)://).';
  if (/Stream map .* matches no streams|does not contain any stream|Invalid data found|Could not find codec parameters/i.test(s)) {
    return 'Aucune vidéo lisible à cette adresse.';
  }
  if (/\b5\d\d\b/.test(s)) return 'La caméra a refusé le flux (trop de connexions ouvertes ?).';
  const last = s.trim().split('\n').filter(Boolean).at(-1)?.replace(/^\[[^\]]*\]\s*/, '').slice(0, 160);
  return `Lecture du flux impossible${last ? ` (${last})` : ''}.`;
}

/** Erreur liée à l'adresse (chemin du flux) plutôt qu'à la caméra : l'adresse suivante peut être essayée. */
const pathProblem = (stderr) => !/401|403|Unauthorized|Forbidden|Connection refused|timed out|No route|unreachable|resolve|not known/i.test(stderr);

// ---------- MP4 fragmenté : lecture des boîtes ----------

/** Boîtes MP4 contenues entre start et end. */
function* boxes(buf, start = 0, end = buf.length) {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) return;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < header || off + size > end) return;
    yield { type, body: off + header, end: off + size };
    off += size;
  }
}

function child(buf, parent, type) {
  for (const b of boxes(buf, parent.body, parent.end)) if (b.type === type) return b;
  return null;
}

function childPath(buf, parent, ...types) {
  let cur = parent;
  for (const t of types) {
    cur = cur && child(buf, cur, t);
    if (!cur) return null;
  }
  return cur;
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Chaîne « codecs » pour Media Source Extensions (avc1.64001f, hvc1.1.6.L93.B0, vp09.00.10.08…). */
function codecString(buf, entry, type) {
  // VisualSampleEntry : 78 octets de champs fixes avant les boîtes de configuration.
  const cfgStart = entry.body + 78;
  const sub = { body: cfgStart, end: entry.end };
  if (type === 'avc1' || type === 'avc3') {
    const c = child(buf, sub, 'avcC');
    return c ? `${type}.${hex2(buf[c.body + 1])}${hex2(buf[c.body + 2])}${hex2(buf[c.body + 3])}` : `${type}.42e01e`;
  }
  if (type === 'hvc1' || type === 'hev1') {
    const c = child(buf, sub, 'hvcC');
    if (!c) return `${type}.1.6.L93.B0`;
    const p = buf[c.body + 1];
    const space = ['', 'A', 'B', 'C'][p >> 6];
    const tier = (p >> 5) & 1 ? 'H' : 'L';
    const compat = buf.readUInt32BE(c.body + 2);
    let reversed = 0;
    for (let i = 0; i < 32; i++) if (compat & (1 << i)) reversed |= 1 << (31 - i);
    const constraints = [];
    for (let i = 0; i < 6; i++) constraints.push(buf[c.body + 6 + i]);
    while (constraints.length && constraints.at(-1) === 0) constraints.pop();
    const tail = constraints.map((b) => `.${b.toString(16).toUpperCase()}`).join('');
    return `${type}.${space}${p & 0x1f}.${(reversed >>> 0).toString(16).toUpperCase()}.${tier}${buf[c.body + 12]}${tail}`;
  }
  if (type === 'vp09') {
    const c = child(buf, sub, 'vpcC');
    if (!c) return 'vp09.00.10.08';
    return `vp09.${two(buf[c.body + 4])}.${two(buf[c.body + 5])}.${two(buf[c.body + 6] >> 4)}`;
  }
  return type;
}

const FAMILY = { avc1: 'avc', avc3: 'avc', hvc1: 'hevc', hev1: 'hevc', vp09: 'vp9', av01: 'av1' };

/** Format de la vidéo et indicateurs d'image par défaut, d'après l'en-tête (moov). */
export function parseInit(moov) {
  const root = { body: 8, end: moov.length };
  const info = { codec: '', family: 'other', width: 0, height: 0, defaultFlags: 0x10000 };
  for (const trak of boxes(moov, root.body, root.end)) {
    if (trak.type !== 'trak') continue;
    const stsd = childPath(moov, trak, 'mdia', 'minf', 'stbl', 'stsd');
    if (!stsd) continue;
    const entries = { body: stsd.body + 8, end: stsd.end };
    const entry = boxes(moov, entries.body, entries.end).next().value;
    if (!entry) continue;
    const type = moov.toString('latin1', entry.body - 4, entry.body);
    info.codec = codecString(moov, entry, type);
    info.family = FAMILY[type] ?? 'other';
    info.width = moov.readUInt16BE(entry.body + 24);
    info.height = moov.readUInt16BE(entry.body + 26);
    break;
  }
  const trex = childPath(moov, root, 'mvex', 'trex');
  if (trex) info.defaultFlags = moov.readUInt32BE(trex.body + 20);
  return info;
}

/** Le fragment (moof) commence-t-il par une image clé ? */
export function isKeyFragment(moof, defaultFlags) {
  const root = { body: 8, end: moof.length };
  for (const traf of boxes(moof, root.body, root.end)) {
    if (traf.type !== 'traf') continue;
    let flags = defaultFlags;
    const tfhd = child(moof, traf, 'tfhd');
    if (tfhd) {
      const f = moof.readUInt32BE(tfhd.body) & 0xffffff;
      let off = tfhd.body + 8;
      if (f & 0x1) off += 8;
      if (f & 0x2) off += 4;
      if (f & 0x8) off += 4;
      if (f & 0x10) off += 4;
      if (f & 0x20) flags = moof.readUInt32BE(off);
    }
    const trun = child(moof, traf, 'trun');
    if (!trun) return false;
    const f = moof.readUInt32BE(trun.body) & 0xffffff;
    let off = trun.body + 8;
    if (f & 0x1) off += 4;
    if (f & 0x4) {
      flags = moof.readUInt32BE(off);
    } else if (f & 0x400) {
      if (f & 0x100) off += 4;
      if (f & 0x200) off += 4;
      flags = moof.readUInt32BE(off);
    }
    // sample_is_non_sync_sample
    return !((flags >> 16) & 1);
  }
  return false;
}

/** Découpe la sortie de ffmpeg en boîtes MP4 complètes. */
class BoxReader {
  constructor(onBox) {
    this.onBox = onBox;
    this.chunks = [];
    this.length = 0;
    this.need = 0;
  }

  push(chunk) {
    this.chunks.push(chunk);
    this.length += chunk.length;
    for (;;) {
      if (!this.need) {
        if (this.length < 8) return;
        const head = this.peek(Math.min(16, this.length));
        let size = head.readUInt32BE(0);
        if (size === 1) {
          if (head.length < 16) return;
          size = Number(head.readBigUInt64BE(8));
        }
        if (size < 8) throw new Error('Flux MP4 invalide');
        this.need = size;
      }
      if (this.length < this.need) return;
      const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.length);
      const box = all.subarray(0, this.need);
      const rest = all.subarray(this.need);
      this.chunks = rest.length ? [rest] : [];
      this.length = rest.length;
      this.need = 0;
      this.onBox(box.toString('latin1', 4, 8), box);
    }
  }

  peek(n) {
    if (this.chunks[0].length >= n) return this.chunks[0].subarray(0, n);
    return Buffer.concat(this.chunks, this.length).subarray(0, n);
  }
}

// ---------- Flux partagés ----------

const MAX_HUBS = 32;
const MAX_VIEWERS = 16;
/** Flux gardé ouvert un moment après le départ du dernier spectateur (passage d'une vue à l'autre). */
const IDLE_GRACE = 10_000;
const START_TIMEOUT = 25_000;
const STALL_TIMEOUT = 20_000;
/** Retard accepté pour un spectateur (réseau lent) avant de sauter jusqu'à la prochaine image clé. */
const MAX_BUFFERED = 6 * 1024 * 1024;
const MAX_GOP_BYTES = 24 * 1024 * 1024;

const hubs = new Map();
/** Pour une liste d'adresses candidates : celle qui a fonctionné. */
const resolvedInput = new Map();
/** Pour une liste d'adresses candidates : format de la vidéo de la caméra (avc, hevc…). */
const knownFamily = new Map();

class Hub {
  constructor(key, candidates, mode, quality) {
    this.key = key;
    this.candidates = candidates;
    this.mode = mode;
    this.quality = quality;
    this.viewers = new Set();
    this.ftyp = null;
    this.init = null;
    this.info = null;
    this.moof = null;
    this.gop = [];
    this.gopBytes = 0;
    this.proc = null;
    this.closed = false;
    this.lastData = Date.now();
    this.watchdog = setInterval(() => {
      if (this.init && Date.now() - this.lastData > STALL_TIMEOUT) this.close();
    }, 5_000);
    this.ready = this.start();
    this.ready.catch(() => {});
  }

  async start() {
    const listKey = this.candidates.join('\n');
    const known = resolvedInput.get(listKey);
    const order = known ? [known, ...this.candidates.filter((c) => c !== known)] : this.candidates;
    let lastError = httpError(400, 'Adresse du flux de la caméra manquante.');
    for (const input of order) {
      if (this.closed) break;
      try {
        await this.run(input);
        resolvedInput.set(listKey, input);
        // Personne ne s'est joint au flux (lecteur parti pendant le démarrage) : il s'arrêtera de lui-même.
        this.scheduleIdle();
        return this;
      } catch (err) {
        lastError = err;
        if (!err.tryNext) break;
      }
    }
    this.close();
    throw lastError;
  }

  /** Lance ffmpeg sur une adresse ; se résout dès que l'en-tête vidéo est prêt. */
  run(input) {
    return new Promise((resolve, reject) => {
      let stderr = '';
      let settled = false;
      let started = false;
      const reader = new BoxReader((type, box) => this.onBox(type, box));
      const proc = spawn(FFMPEG, streamArgs(input, this.mode, this.quality), { stdio: ['ignore', 'pipe', 'pipe'] });
      this.proc = proc;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        kill(proc);
        reject(err);
      };
      const timer = setTimeout(() => fail(httpError(504, 'La caméra ne répond pas.')), START_TIMEOUT);
      proc.stdout.on('data', (chunk) => {
        this.lastData = Date.now();
        try {
          reader.push(chunk);
        } catch (err) {
          fail(httpError(502, 'Flux vidéo illisible.'));
          this.close();
          return;
        }
        if (!settled && this.init) {
          settled = true;
          started = true;
          clearTimeout(timer);
          resolve();
        }
      });
      proc.stderr.on('data', (d) => {
        stderr = (stderr + d).slice(-4000);
      });
      proc.on('error', (err) => fail(httpError(500, err.code === 'ENOENT' ? NO_FFMPEG : `ffmpeg : ${err.message}`)));
      proc.on('close', () => {
        if (!settled) {
          const err = httpError(502, explainFfmpeg(stderr));
          err.tryNext = pathProblem(stderr);
          fail(err);
        } else if (started && !this.closed) {
          // Flux coupé en cours de route (caméra redémarrée…) : les lecteurs se reconnectent.
          console.warn('[caméras] flux interrompu :', stderr.trim().split('\n').at(-1) || 'fin du flux');
          this.close();
        }
      });
    });
  }

  onBox(type, box) {
    if (type === 'ftyp') {
      this.ftyp = Buffer.from(box);
    } else if (type === 'moov') {
      this.init = Buffer.concat([this.ftyp ?? Buffer.alloc(0), box]);
      this.info = parseInit(box);
    } else if (type === 'moof') {
      this.moof = Buffer.from(box);
    } else if (type === 'mdat' && this.moof && this.info) {
      const key = isKeyFragment(this.moof, this.info.defaultFlags);
      const fragment = Buffer.concat([this.moof, box]);
      this.moof = null;
      if (key) {
        this.gop = [];
        this.gopBytes = 0;
      }
      if (key || this.gop.length) {
        if (this.gopBytes + fragment.length <= MAX_GOP_BYTES) {
          this.gop.push(fragment);
          this.gopBytes += fragment.length;
        } else {
          this.gop = [];
          this.gopBytes = 0;
        }
      }
      for (const v of this.viewers) this.send(v, fragment, key);
    }
  }

  send(v, fragment, key) {
    if (v.res.writableLength > MAX_BUFFERED) {
      v.waitKey = true;
      return;
    }
    if (v.waitKey) {
      if (!key) return;
      v.waitKey = false;
    }
    v.res.write(fragment);
  }

  addViewer(res) {
    if (res.destroyed || res.writableEnded) return;
    if (this.closed || !this.init) return res.status(502).json({ error: 'Flux vidéo interrompu.' });
    if (this.viewers.size >= MAX_VIEWERS) return res.status(503).json({ error: 'Trop de spectateurs pour cette caméra.' });
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Camera-Codec': this.info.codec,
      'Access-Control-Expose-Headers': 'X-Camera-Codec',
    });
    res.write(this.init);
    for (const fragment of this.gop) res.write(fragment);
    const v = { res, waitKey: this.gop.length === 0 };
    this.viewers.add(v);
    clearTimeout(this.idleTimer);
    const leave = () => {
      if (!this.viewers.delete(v)) return;
      if (!this.viewers.size) this.scheduleIdle();
    };
    res.on('close', leave);
  }

  scheduleIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.viewers.size) this.close();
    }, IDLE_GRACE);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    clearInterval(this.watchdog);
    if (hubs.get(this.key) === this) hubs.delete(this.key);
    for (const v of this.viewers) v.res.end();
    this.viewers.clear();
    if (this.proc) kill(this.proc);
  }
}

function kill(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
  }, 3_000).unref();
}

function hubFor(candidates, mode, quality) {
  // Réemballage : même flux pour les deux qualités si la caméra n'a qu'un flux.
  const key = mode === 'copy' ? `copy\n${candidates.join('\n')}` : `${mode}\n${quality}\n${candidates.join('\n')}`;
  const existing = hubs.get(key);
  if (existing && !existing.closed) return existing;
  if (hubs.size >= MAX_HUBS) throw httpError(503, 'Trop de flux vidéo ouverts en même temps sur le serveur Melo.');
  const hub = new Hub(key, candidates, mode, quality);
  hubs.set(key, hub);
  return hub;
}

/**
 * Flux vidéo d'une caméra lisible par l'appareil : `accept` liste les formats qu'il sait lire (avc, hevc, vp9).
 * Le format de la caméra est découvert au premier démarrage, puis mémorisé.
 */
export async function openVideo(cam, quality, accept) {
  const candidates = streamCandidates(cam, quality);
  if (!candidates.length) throw httpError(400, 'Adresse de la caméra manquante.');
  if (!(await hasFfmpeg())) throw httpError(500, NO_FFMPEG);
  const listKey = candidates.join('\n');
  for (let attempt = 0; attempt < 2; attempt++) {
    let family = knownFamily.get(listKey);
    if (!family) {
      const probe = hubFor(candidates, 'copy', quality);
      await probe.ready;
      family = probe.info.family;
      knownFamily.set(listKey, family);
    }
    const mode = accept.includes(family) ? 'copy' : ['avc', 'vp9'].find((f) => accept.includes(f));
    if (!mode) throw httpError(415, 'Cet appareil ne sait pas lire la vidéo de cette caméra.');
    const hub = hubFor(candidates, mode, quality);
    await hub.ready;
    // La caméra a changé de format depuis la dernière fois (réglage modifié) : on refait le choix.
    if (mode === 'copy' && hub.info.family !== family) {
      knownFamily.set(listKey, hub.info.family);
      continue;
    }
    return hub;
  }
  throw httpError(502, 'Format vidéo de la caméra instable.');
}

/** Arrêt du serveur : fin de tous les ffmpeg. */
export function stopCameras() {
  for (const hub of [...hubs.values()]) hub.close();
}

/** Nombre de flux ouverts (tests). */
export const openStreams = () => hubs.size;

// ---------- Images et flux MJPEG (http) ----------

const BOUNDARY = 'notescamera';
const IMAGE_INTERVAL = 1_000;
const MAX_IMAGE = 8 * 1024 * 1024;

function parseDigest(header) {
  const h = Array.isArray(header) ? header.join(', ') : String(header || '');
  const m = /Digest\s+(.*)$/i.exec(h);
  if (!m) return null;
  const out = {};
  for (const [, k, quoted, bare] of m[1].matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) out[k.toLowerCase()] = quoted ?? bare;
  return out.nonce ? out : null;
}

function digestHeader(d, user, pass, target) {
  const algorithm = (d.algorithm || 'MD5').toUpperCase();
  const H = (s) => crypto.createHash(algorithm.startsWith('SHA-256') ? 'sha256' : 'md5').update(s).digest('hex');
  const uri = target.pathname + target.search;
  const cnonce = crypto.randomBytes(8).toString('hex');
  d.nc = (d.nc || 0) + 1;
  const nc = d.nc.toString(16).padStart(8, '0');
  let ha1 = H(`${user}:${d.realm}:${pass}`);
  if (algorithm.endsWith('-SESS')) ha1 = H(`${ha1}:${d.nonce}:${cnonce}`);
  const ha2 = H(`GET:${uri}`);
  const qop = d.qop && /(^|,)\s*auth\s*(,|$)/i.test(d.qop) ? 'auth' : '';
  const response = qop ? H(`${ha1}:${d.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${d.nonce}:${ha2}`);
  const parts = [`username="${user}"`, `realm="${d.realm ?? ''}"`, `nonce="${d.nonce}"`, `uri="${uri}"`, `response="${response}"`];
  if (d.algorithm) parts.push(`algorithm=${d.algorithm}`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (d.opaque) parts.push(`opaque="${d.opaque}"`);
  return `Digest ${parts.join(', ')}`;
}

function requestOnce(target, headers, insecure) {
  return new Promise((resolve, reject) => {
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(target, { headers: { 'user-agent': 'Melo-Cameras/1.0', ...headers }, rejectUnauthorized: !insecure, timeout: 10_000 }, resolve);
    req.on('timeout', () => req.destroy(new Error('Délai dépassé')));
    req.on('error', reject);
    req.end();
  });
}

function explainHttp(err) {
  const msg = err?.message || '';
  if (/ECONNREFUSED/.test(msg)) return 'La caméra refuse la connexion à cette adresse (port ?).';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Adresse de la caméra introuvable.';
  return 'Caméra injoignable depuis le serveur Melo : vérifiez son adresse.';
}

/**
 * Requête GET vers une caméra (authentification Basic ou Digest, la plus courante sur les caméras IP).
 * `auth` garde le défi Digest d'une requête à l'autre.
 */
async function openHttp(cam, auth = {}) {
  let target;
  try {
    target = new URL(cam.url);
  } catch {
    throw httpError(400, 'Adresse de la caméra invalide.');
  }
  if (!/^https?:$/.test(target.protocol)) throw httpError(400, 'L’adresse doit commencer par http:// ou https://.');
  const user = cam.username || decodeURIComponent(target.username);
  const pass = cam.password || decodeURIComponent(target.password);
  target.username = '';
  target.password = '';
  const credentials = Boolean(user || pass);
  const authorization = () => {
    if (auth.digest) return { authorization: digestHeader(auth.digest, user, pass, target) };
    return credentials ? { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` } : {};
  };
  let res;
  try {
    res = await requestOnce(target, authorization(), cam.insecure);
    if (res.statusCode === 401 && credentials) {
      const challenge = parseDigest(res.headers['www-authenticate']);
      res.resume();
      if (challenge) {
        auth.digest = challenge;
        res = await requestOnce(target, authorization(), cam.insecure);
      }
    }
  } catch (err) {
    throw httpError(502, explainHttp(err));
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    res.resume();
    throw httpError(502, 'Identifiant ou mot de passe refusé par la caméra.');
  }
  if ((res.statusCode || 500) >= 400) {
    res.resume();
    throw httpError(502, `La caméra a répondu « ${res.statusCode} » à cette adresse.`);
  }
  return res;
}

function readBody(stream, max = MAX_IMAGE) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stream.on('data', (c) => {
      size += c.length;
      if (size > max) {
        stream.destroy();
        reject(new Error('Image trop grande'));
      } else chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Première image JPEG d'un flux MJPEG. */
function readFirstFrame(stream, max = MAX_IMAGE) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const done = (value, err) => {
      stream.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    stream.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      const start = buf.indexOf(Buffer.from([0xff, 0xd8]));
      const end = start >= 0 ? buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2) : -1;
      if (end >= 0) done(buf.subarray(start, end + 2));
      else if (buf.length > max) done(null, new Error('Image trop grande'));
    });
    stream.on('end', () => done(null, new Error('Flux MJPEG vide')));
    stream.on('error', (err) => done(null, err));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Direct d'une caméra « image » : flux MJPEG relayé, ou image fixe renvoyée chaque seconde sous forme de flux MJPEG. */
export async function streamImage(cam, res) {
  const auth = {};
  let up;
  try {
    up = await openHttp(cam, auth);
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
  const type = String(up.headers['content-type'] || '');
  const headers = { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
  if (/multipart\/x-mixed-replace/i.test(type)) {
    res.writeHead(200, { ...headers, 'Content-Type': type });
    up.pipe(res);
    res.on('close', () => up.destroy());
    return;
  }
  if (!/^image\//i.test(type)) {
    up.resume();
    return res.status(502).json({ error: 'Cette adresse ne renvoie ni image ni flux MJPEG.' });
  }
  res.writeHead(200, { ...headers, 'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}` });
  let open = true;
  res.on('close', () => {
    open = false;
  });
  let current = up;
  while (open) {
    let image;
    try {
      image = await readBody(current);
    } catch {
      break;
    }
    if (!open) break;
    res.write(`--${BOUNDARY}\r\nContent-Type: ${type.split(';')[0]}\r\nContent-Length: ${image.length}\r\n\r\n`);
    res.write(image);
    res.write('\r\n');
    await sleep(IMAGE_INTERVAL);
    if (!open) break;
    try {
      current = await openHttp(cam, auth);
    } catch {
      break;
    }
  }
  res.end();
}

// ---------- Test depuis la fenêtre de configuration ----------

/** Capture d'une image du flux (aperçu) et description de la vidéo. */
function grabFrame(input) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'info', ...inputArgs(input), '-map', '0:v:0', '-frames:v', '1'];
    args.push('-vf', "scale=w='min(iw,640)':h=-2", '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1');
    let proc;
    try {
      proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(httpError(500, NO_FFMPEG));
    }
    const out = [];
    let stderr = '';
    const timer = setTimeout(() => kill(proc), 20_000);
    proc.stdout.on('data', (c) => out.push(c));
    proc.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-20_000);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(httpError(500, err.code === 'ENOENT' ? NO_FFMPEG : err.message));
    });
    proc.on('close', () => {
      clearTimeout(timer);
      const jpeg = Buffer.concat(out);
      if (jpeg.length) return resolve({ jpeg, ...describeInput(stderr) });
      const err = httpError(502, stderr ? explainFfmpeg(stderr) : 'La caméra ne répond pas.');
      err.tryNext = pathProblem(stderr);
      reject(err);
    });
  });
}

const CODEC_NAMES = { h264: 'H.264', hevc: 'H.265', mjpeg: 'MJPEG', mpeg4: 'MPEG-4', vp8: 'VP8', vp9: 'VP9', av1: 'AV1' };

/** Codec, définition et cadence de la vidéo d'entrée, d'après le journal de ffmpeg. */
function describeInput(stderr) {
  const input = stderr.split(/^Output #0/m)[0];
  const line = input.split('\n').find((l) => /Stream #0:\d+.*Video:/.test(l)) ?? '';
  const codec = /Video: (\w+)/.exec(line)?.[1] ?? '';
  const size = /, (\d{2,5})x(\d{2,5})[\s,]/.exec(line);
  const fps = /([\d.]+) fps/.exec(line);
  return {
    codec: CODEC_NAMES[codec] ?? codec.toUpperCase(),
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    fps: fps ? Math.round(Number(fps[1])) : 0,
  };
}

async function grabFirst(candidates) {
  let lastError = httpError(400, 'Adresse de la caméra manquante.');
  for (const input of candidates) {
    try {
      return await grabFrame(input);
    } catch (err) {
      lastError = err;
      if (!err.tryNext) break;
    }
  }
  throw lastError;
}

const describe = (s) => `${s.width && s.height ? `${s.width} × ${s.height}` : 'définition inconnue'}${s.codec ? ` (${s.codec})` : ''}`;
const dataUrl = (buf, type = 'image/jpeg') => `data:${type};base64,${buf.toString('base64')}`;

/** Essai d'une caméra avant enregistrement : aperçu et description des flux, ou explication du problème. */
export async function testCamera(cam) {
  if (!cam) return { ok: false, message: 'Caméra invalide.' };
  if (cameraKind(cam) === 'image') {
    try {
      const res = await openHttp(cam);
      const type = String(res.headers['content-type'] || '');
      if (/multipart\/x-mixed-replace/i.test(type)) {
        const frame = await readFirstFrame(res);
        return { ok: true, message: 'Connexion réussie : flux vidéo MJPEG.', preview: dataUrl(frame) };
      }
      if (!/^image\//i.test(type)) {
        res.resume();
        return { ok: false, message: 'Cette adresse ne renvoie ni image ni flux MJPEG.' };
      }
      const image = await readBody(res);
      return { ok: true, message: 'Connexion réussie : image actualisée chaque seconde.', preview: dataUrl(image, type.split(';')[0]) };
    } catch (err) {
      return { ok: false, message: err.status ? err.message : 'Lecture de l’image impossible.' };
    }
  }
  if (!(await hasFfmpeg())) return { ok: false, message: NO_FFMPEG };
  const main = streamCandidates(cam, 'hd');
  if (!main.length) return { ok: false, message: cam.brand === 'rtsp' ? 'Indiquez l’adresse du flux (rtsp://…).' : 'Indiquez l’adresse IP de la caméra.' };
  let hd;
  try {
    hd = await grabFirst(main);
  } catch (err) {
    return { ok: false, message: err.message };
  }
  let message = `Connexion réussie : ${describe(hd)}`;
  const sub = streamCandidates(cam, 'sd').filter((u) => !main.includes(u));
  if (sub.length) {
    try {
      message += `, flux secondaire ${describe(await grabFirst(sub))}`;
    } catch {
      message += ' (pas de flux secondaire : la vidéo complète sera aussi utilisée pour les miniatures)';
    }
  }
  return { ok: true, message: `${message}.`, preview: dataUrl(hd.jpeg), hevc: hd.codec === 'H.265' };
}
