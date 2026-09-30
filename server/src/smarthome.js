// Maison connectée : pilotage des appareils (lumières, prises, volets, chauffage, caméras…) via Home Assistant.
// Le serveur Melo interroge Home Assistant avec un jeton d'accès longue durée ; le jeton et l'adresse ne sont
// jamais renvoyés aux navigateurs. Les images des caméras passent par des adresses signées et temporaires.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { httpRequest } from './homelab.js';
import { signingKey } from './store.js';

/** Types d'appareils affichés, et services autorisés pour chacun (rien d'autre ne peut être déclenché). */
const SERVICES = {
  light: ['turn_on', 'turn_off', 'toggle'],
  switch: ['turn_on', 'turn_off', 'toggle'],
  input_boolean: ['turn_on', 'turn_off', 'toggle'],
  fan: ['turn_on', 'turn_off', 'toggle', 'set_percentage', 'oscillate'],
  cover: ['open_cover', 'close_cover', 'stop_cover', 'set_cover_position'],
  valve: ['open_valve', 'close_valve', 'stop_valve', 'set_valve_position'],
  climate: ['set_temperature', 'set_hvac_mode', 'turn_on', 'turn_off'],
  humidifier: ['turn_on', 'turn_off', 'toggle', 'set_humidity'],
  lock: ['lock', 'unlock'],
  media_player: ['media_play_pause', 'media_next_track', 'media_previous_track', 'volume_set', 'volume_mute', 'turn_on', 'turn_off'],
  vacuum: ['start', 'pause', 'stop', 'return_to_base', 'locate'],
  scene: ['turn_on'],
  script: ['turn_on'],
  button: ['press'],
  input_button: ['press'],
  siren: ['turn_on', 'turn_off'],
  camera: [],
  sensor: [],
  binary_sensor: [],
  alarm_control_panel: [],
};
const DOMAINS = Object.keys(SERVICES);

/** Capteurs affichés (les autres — signal Wi‑Fi, diagnostics… — encombreraient la liste). */
const SENSOR_CLASSES = new Set([
  'temperature', 'humidity', 'pressure', 'illuminance', 'carbon_dioxide', 'co2', 'pm25', 'pm10', 'pm1',
  'volatile_organic_compounds', 'power', 'energy', 'battery', 'moisture', 'gas', 'water', 'aqi', 'carbon_monoxide',
]);
const BINARY_CLASSES = new Set([
  'door', 'window', 'garage_door', 'opening', 'motion', 'occupancy', 'presence', 'smoke', 'moisture', 'gas',
  'carbon_monoxide', 'safety', 'vibration', 'lock', 'problem', 'tamper', 'sound', 'light',
]);

/** Attributs utiles transmis au navigateur, par type. */
const ATTRS = {
  light: ['brightness', 'color_mode', 'supported_color_modes', 'hs_color', 'rgb_color', 'color_temp_kelvin', 'min_color_temp_kelvin', 'max_color_temp_kelvin'],
  fan: ['percentage', 'percentage_step', 'oscillating', 'supported_features'],
  cover: ['current_position', 'supported_features', 'device_class'],
  valve: ['current_position', 'supported_features', 'device_class'],
  climate: ['current_temperature', 'temperature', 'target_temp_step', 'min_temp', 'max_temp', 'hvac_modes', 'hvac_action', 'current_humidity'],
  humidifier: ['humidity', 'current_humidity', 'min_humidity', 'max_humidity', 'mode'],
  media_player: ['volume_level', 'is_volume_muted', 'media_title', 'media_artist', 'app_name', 'source'],
  vacuum: ['battery_level', 'status'],
  sensor: ['device_class', 'unit_of_measurement', 'state_class'],
  binary_sensor: ['device_class'],
};

// ---------- Configuration ----------

export function parseHomeConfig(raw) {
  try {
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      url: typeof cfg?.url === 'string' ? cfg.url.trim().replace(/\/+$/, '') : '',
      token: typeof cfg?.token === 'string' ? cfg.token.trim() : '',
      insecure: Boolean(cfg?.insecure),
    };
  } catch {
    return { url: '', token: '', insecure: false };
  }
}

export const isHomeConfigured = (cfg) => Boolean(cfg.url && cfg.token);

function friendly(err, status) {
  if (status === 401 || status === 403) return 'Jeton refusé par Home Assistant (créez un jeton d’accès longue durée).';
  const msg = err?.message || String(err || '');
  if (/ECONNREFUSED/.test(msg)) return 'Home Assistant ne répond pas à cette adresse (connexion refusée).';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Adresse de Home Assistant introuvable.';
  if (/EHOSTUNREACH|ENETUNREACH|Délai dépassé|ETIMEDOUT/.test(msg)) return 'Home Assistant injoignable depuis le serveur Melo.';
  if (/self.signed|certificate|CERT_/i.test(msg)) return 'Certificat HTTPS non reconnu (cochez « ignorer le certificat »).';
  return msg ? msg.slice(0, 160) : `Home Assistant a répondu ${status}.`;
}

async function ha(cfg, path, { method = 'GET', body, timeout = 10_000 } = {}) {
  let r;
  try {
    r = await httpRequest(`${cfg.url}${path}`, {
      method,
      body,
      insecure: cfg.insecure,
      timeout,
      headers: { authorization: `Bearer ${cfg.token}` },
    });
  } catch (err) {
    throw new Error(friendly(err));
  }
  if (!r.ok) throw new Error(friendly(null, r.status));
  return r;
}

// ---------- États ----------

/** Pièces et entités masquées, lues par un modèle Jinja (API REST, pas besoin du WebSocket). */
const AREA_TEMPLATE = `{%- set ns = namespace(items=[]) -%}
{%- for s in states if s.domain in ${JSON.stringify(DOMAINS)} -%}
{%- set ns.items = ns.items + [[s.entity_id, area_name(s.entity_id) or '', is_hidden_entity(s.entity_id)]] -%}
{%- endfor -%}
{{ ns.items | tojson }}`;

const areaCache = new Map(); // adresse + jeton -> { until, map }

async function readAreas(cfg) {
  const key = `${cfg.url}\n${cfg.token}`;
  const cached = areaCache.get(key);
  if (cached && Date.now() < cached.until) return cached.map;
  const map = new Map();
  let ttl = 60_000;
  try {
    const r = await ha(cfg, '/api/template', { method: 'POST', body: { template: AREA_TEMPLATE } });
    for (const [id, area, hidden] of JSON.parse(r.text)) map.set(id, { area: String(area || ''), hidden: Boolean(hidden) });
  } catch {
    // Modèles indisponibles (ancienne version, droits limités, coupure) : appareils sans pièce, nouvel essai bientôt.
    ttl = 15_000;
  }
  areaCache.set(key, { until: Date.now() + ttl, map });
  return map;
}

function wanted(s) {
  const domain = s.entity_id.split('.')[0];
  if (!(domain in SERVICES)) return false;
  const a = s.attributes || {};
  if (domain === 'sensor') return SENSOR_CLASSES.has(a.device_class) || (a.unit_of_measurement === '°C' && !a.device_class);
  if (domain === 'binary_sensor') return BINARY_CLASSES.has(a.device_class);
  return true;
}

function simplify(s, areas) {
  const domain = s.entity_id.split('.')[0];
  const a = s.attributes || {};
  const attrs = {};
  for (const key of ATTRS[domain] || []) if (a[key] !== undefined) attrs[key] = a[key];
  const info = areas?.get(s.entity_id);
  return {
    id: s.entity_id,
    domain,
    name: String(a.friendly_name || s.entity_id),
    state: String(s.state),
    area: info?.area || '',
    icon: typeof a.icon === 'string' ? a.icon : '',
    unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : '',
    deviceClass: typeof a.device_class === 'string' ? a.device_class : '',
    changedAt: s.last_changed || '',
    attrs,
  };
}

export async function homeStates(cfg) {
  const [r, areas] = await Promise.all([ha(cfg, '/api/states'), readAreas(cfg)]);
  const states = r.json();
  if (!Array.isArray(states)) throw new Error('Réponse inattendue de Home Assistant.');
  return states.filter((s) => wanted(s) && !areas.get(s.entity_id)?.hidden).map((s) => simplify(s, areas));
}

export async function testHome(cfg) {
  if (!isHomeConfigured(cfg)) return { ok: false, message: 'Renseignez l’adresse et le jeton.' };
  try {
    const [config, list] = await Promise.all([ha(cfg, '/api/config'), homeStates(cfg)]);
    const count = list.length;
    return { ok: true, message: `Connexion réussie : Home Assistant ${config.json().version || ''}, ${count} appareil(s) et capteur(s).` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// ---------- Commandes ----------

const ENTITY_RE = /^([a-z_]+)\.[a-z0-9_]+$/;
const clampNum = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);

/** Ne garde que les paramètres attendus, avec des valeurs plausibles. */
function cleanData(data = {}) {
  const out = {};
  const num = (key, min, max) => {
    const v = clampNum(data[key], min, max);
    if (v !== undefined) out[key] = v;
  };
  num('brightness_pct', 0, 100);
  num('color_temp_kelvin', 1000, 12000);
  num('percentage', 0, 100);
  num('position', 0, 100);
  num('temperature', -50, 100);
  num('humidity', 0, 100);
  num('volume_level', 0, 1);
  if (Array.isArray(data.rgb_color) && data.rgb_color.length === 3 && data.rgb_color.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) out.rgb_color = data.rgb_color;
  if (typeof data.oscillating === 'boolean') out.oscillating = data.oscillating;
  if (typeof data.is_volume_muted === 'boolean') out.is_volume_muted = data.is_volume_muted;
  if (typeof data.hvac_mode === 'string' && /^[a-z_]{1,20}$/.test(data.hvac_mode)) out.hvac_mode = data.hvac_mode;
  return out;
}

/** Un appareil, ou plusieurs du même type (groupe : « tout allumer » en une seule commande). */
export async function callHome(cfg, { entity_id, service, data }) {
  const ids = Array.isArray(entity_id) ? [...new Set(entity_id.map(String))] : [String(entity_id || '')];
  const domains = new Set();
  for (const id of ids) {
    const m = ENTITY_RE.exec(id);
    if (!m) throw Object.assign(new Error('Appareil invalide.'), { status: 400 });
    domains.add(m[1]);
  }
  if (!ids.length || ids.length > 200) throw Object.assign(new Error('Appareil invalide.'), { status: 400 });
  if (domains.size !== 1) throw Object.assign(new Error('Appareils de types différents dans une même commande.'), { status: 400 });
  const [domain] = domains;
  if (!SERVICES[domain]?.includes(service)) throw Object.assign(new Error('Commande non autorisée.'), { status: 400 });
  const target = ids.length === 1 ? ids[0] : ids;
  const r = await ha(cfg, `/api/services/${domain}/${service}`, { method: 'POST', body: { ...cleanData(data), entity_id: target } });
  let changed = [];
  try {
    const parsed = r.json();
    if (Array.isArray(parsed)) changed = parsed;
  } catch {
    // Réponse vide : l'état sera relu au prochain rafraîchissement.
  }
  const areas = await readAreas(cfg);
  return changed.filter(wanted).map((s) => simplify(s, areas));
}

// ---------- Caméras : adresses signées ----------

const SECRET = signingKey('home-camera');
const CAMERA_TTL = 30 * 60_000;

function sign(wsId, entityId, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${wsId}\n${entityId}\n${exp}`).digest('base64url');
}

/** Adresse d'image (snapshot) ou de vidéo (stream) valable 30 min au plus (échéance arrondie : adresse stable). */
export function cameraUrl(wsId, entityId, kind) {
  const exp = Math.ceil((Date.now() + CAMERA_TTL) / CAMERA_TTL) * CAMERA_TTL;
  const q = new URLSearchParams({ ws: wsId, exp: String(exp), sig: sign(wsId, entityId, exp) });
  return `/api/home/camera/${encodeURIComponent(entityId)}/${kind}?${q}`;
}

export function verifyCamera(wsId, entityId, exp, sig) {
  const e = Number(exp);
  if (!wsId || !Number.isFinite(e) || e < Date.now() || typeof sig !== 'string') return false;
  const expected = Buffer.from(sign(wsId, entityId, e));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Relaie l'image ou le flux MJPEG d'une caméra Home Assistant vers le navigateur. */
export function proxyCamera(cfg, entityId, kind, res) {
  const path = kind === 'stream' ? 'camera_proxy_stream' : 'camera_proxy';
  let target;
  try {
    target = new URL(`${cfg.url}/api/${path}/${entityId}`);
  } catch {
    return res.status(400).json({ error: 'Adresse de Home Assistant invalide.' });
  }
  const lib = target.protocol === 'https:' ? https : http;
  const upstream = lib.request(
    target,
    { headers: { authorization: `Bearer ${cfg.token}` }, rejectUnauthorized: !cfg.insecure, timeout: 15_000 },
    (up) => {
      if ((up.statusCode || 500) >= 400) {
        up.resume();
        return res.status(502).json({ error: 'Image de la caméra indisponible.' });
      }
      res.status(200);
      res.setHeader('Content-Type', up.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');
      up.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy(new Error('Délai dépassé')));
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ error: 'Caméra injoignable.' });
    else res.end();
  });
  // Flux vidéo : on coupe la connexion vers Home Assistant quand la page se ferme.
  res.on('close', () => upstream.destroy());
  upstream.end();
}
