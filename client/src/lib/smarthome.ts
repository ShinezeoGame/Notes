// Maison connectée : appareils de Home Assistant (lumières, prises, volets, chauffage, caméras, capteurs…)
// affichés et pilotés via le serveur Notes, qui détient l'adresse et le jeton de Home Assistant.
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import type { IconName } from '../icons/registry';

export type HomeEntity = {
  id: string;
  domain: string;
  name: string;
  state: string;
  area: string;
  icon: string;
  unit: string;
  deviceClass: string;
  changedAt: string;
  attrs: Record<string, unknown>;
  /** Caméras : adresses signées (relatives au serveur Notes) de l'image et du flux vidéo. */
  snapshot?: string;
  stream?: string;
};

export type HomeStates = { configured: boolean; entities: HomeEntity[]; error?: string; fetchedAt: number };

export type HomeConfig = {
  url: string;
  token: string;
  insecure: boolean;
  /** Appareils épinglés en tête de liste. */
  favorites: string[];
  /** Appareils masqués de la liste. */
  hidden: string[];
};

// ---------- Configuration (document Yjs de l'espace, comme le homelab) ----------

const EMPTY_CONFIG: HomeConfig = { url: '', token: '', insecure: false, favorites: [], hidden: [] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function readHomeConfig(doc: Y.Doc): HomeConfig {
  try {
    const raw = JSON.parse(String(doc.getMap('smarthome').get('config') ?? '{}')) as Partial<HomeConfig>;
    return {
      url: typeof raw.url === 'string' ? raw.url : '',
      token: typeof raw.token === 'string' ? raw.token : '',
      insecure: Boolean(raw.insecure),
      favorites: strings(raw.favorites),
      hidden: strings(raw.hidden),
    };
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

export function saveHomeConfig(doc: Y.Doc, cfg: HomeConfig) {
  doc.getMap('smarthome').set('config', JSON.stringify(cfg));
}

/** Modifie la configuration relue dans le document (rien n'est écrasé entre deux appareils). */
export function updateHomeConfig(doc: Y.Doc, change: (cfg: HomeConfig) => HomeConfig) {
  saveHomeConfig(doc, change(readHomeConfig(doc)));
}

export function toggleInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function useHomeConfig(doc: Y.Doc | null): HomeConfig {
  const [cfg, setCfg] = useState<HomeConfig>(() => (doc ? readHomeConfig(doc) : { ...EMPTY_CONFIG }));
  useEffect(() => {
    if (!doc) return;
    const map = doc.getMap('smarthome');
    const read = () => setCfg(readHomeConfig(doc));
    map.observe(read);
    read();
    return () => map.unobserve(read);
  }, [doc]);
  return cfg;
}

export const isHomeConfigured = (cfg: HomeConfig) => Boolean(cfg.url.trim() && cfg.token.trim());

// ---------- Catégories ----------

export type CategoryKey = 'light' | 'power' | 'climate' | 'cover' | 'camera' | 'media' | 'sensor' | 'scene' | 'other';

export const CATEGORIES: { key: CategoryKey; label: string; icon: IconName; domains: string[] }[] = [
  { key: 'light', label: 'Lumières', icon: 'bulb', domains: ['light'] },
  { key: 'power', label: 'Prises', icon: 'plug', domains: ['switch', 'input_boolean', 'siren'] },
  { key: 'climate', label: 'Climat', icon: 'thermometer', domains: ['climate', 'fan', 'humidifier'] },
  { key: 'cover', label: 'Volets et portes', icon: 'blinds', domains: ['cover', 'valve', 'lock'] },
  { key: 'camera', label: 'Caméras', icon: 'camera', domains: ['camera'] },
  { key: 'media', label: 'Multimédia', icon: 'speaker', domains: ['media_player'] },
  { key: 'sensor', label: 'Capteurs', icon: 'activity', domains: ['sensor', 'binary_sensor', 'alarm_control_panel'] },
  { key: 'scene', label: 'Scènes', icon: 'sparkles', domains: ['scene', 'script', 'button', 'input_button'] },
  { key: 'other', label: 'Autres', icon: 'cube', domains: ['vacuum'] },
];

export function categoryOf(domain: string): CategoryKey {
  return CATEGORIES.find((c) => c.domains.includes(domain))?.key ?? 'other';
}

// ---------- États ----------

export const isUnavailable = (e: HomeEntity) => e.state === 'unavailable';
const OPENING_CLASSES = new Set(['door', 'window', 'garage_door', 'opening']);
const ALERT_CLASSES = new Set(['smoke', 'gas', 'carbon_monoxide', 'moisture', 'safety', 'problem', 'tamper']);

/** Appareil « actif » (allumé, ouvert, en lecture…) : tuile colorée. */
export function isActive(e: HomeEntity): boolean {
  switch (e.domain) {
    case 'cover':
    case 'valve':
      return e.state === 'open' || e.state === 'opening';
    case 'lock':
      return e.state !== 'locked';
    case 'climate':
      return e.state !== 'off';
    case 'media_player':
      return e.state === 'playing';
    case 'vacuum':
      return e.state === 'cleaning' || e.state === 'returning';
    case 'camera':
      return e.state === 'recording' || e.state === 'streaming';
    case 'alarm_control_panel':
      return e.state !== 'disarmed';
    default:
      return e.state === 'on';
  }
}

/** Alerte (fumée, fuite d'eau, alarme déclenchée, serrure bloquée) : tuile rouge. */
export function isAlert(e: HomeEntity): boolean {
  if (e.domain === 'binary_sensor') return e.state === 'on' && ALERT_CLASSES.has(e.deviceClass);
  if (e.domain === 'alarm_control_panel') return e.state === 'triggered';
  if (e.domain === 'lock') return e.state === 'jammed';
  return false;
}

const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function formatValue(value: string | number, unit = ''): string {
  const n = typeof value === 'number' ? value : Number(value);
  const text = Number.isFinite(n) && value !== '' ? NUMBER.format(n) : String(value);
  return unit ? `${text} ${unit}` : text;
}

export const brightnessPct = (e: HomeEntity): number | null =>
  e.state === 'on' && typeof e.attrs.brightness === 'number' ? Math.max(1, Math.round((e.attrs.brightness / 255) * 100)) : null;

const HVAC: Record<string, string> = {
  off: 'Arrêt',
  heat: 'Chauffage',
  cool: 'Climatisation',
  auto: 'Automatique',
  heat_cool: 'Chaud / froid',
  dry: 'Déshumidification',
  fan_only: 'Ventilation',
};
export const hvacLabel = (mode: string) => HVAC[mode] ?? mode;

const SIMPLE: Record<string, Record<string, string>> = {
  light: { on: 'Allumée', off: 'Éteinte' },
  switch: { on: 'Allumé', off: 'Éteint' },
  input_boolean: { on: 'Activé', off: 'Désactivé' },
  siren: { on: 'En marche', off: 'Arrêtée' },
  fan: { on: 'En marche', off: 'Arrêté' },
  humidifier: { on: 'En marche', off: 'Arrêté' },
  cover: { open: 'Ouvert', closed: 'Fermé', opening: 'Ouverture…', closing: 'Fermeture…', stopped: 'Arrêté' },
  valve: { open: 'Ouverte', closed: 'Fermée', opening: 'Ouverture…', closing: 'Fermeture…' },
  lock: { locked: 'Verrouillée', unlocked: 'Déverrouillée', jammed: 'Bloquée !', locking: 'Verrouillage…', unlocking: 'Déverrouillage…', open: 'Ouverte' },
  media_player: { playing: 'Lecture', paused: 'En pause', idle: 'Inactif', off: 'Éteint', on: 'Allumé', standby: 'En veille', buffering: 'Chargement…' },
  vacuum: { cleaning: 'Nettoyage', docked: 'Sur sa base', returning: 'Retour à la base', idle: 'Inactif', paused: 'En pause', error: 'Erreur' },
  camera: { idle: 'En veille', recording: 'Enregistrement', streaming: 'En direct' },
  alarm_control_panel: {
    disarmed: 'Désactivée',
    armed_home: 'Activée (maison)',
    armed_away: 'Activée (absence)',
    armed_night: 'Activée (nuit)',
    armed_vacation: 'Activée (vacances)',
    arming: 'Activation…',
    pending: 'En attente…',
    triggered: 'Déclenchée !',
  },
};

function binaryLabel(e: HomeEntity): string {
  const on = e.state === 'on';
  if (OPENING_CLASSES.has(e.deviceClass)) return on ? 'Ouverte' : 'Fermée';
  if (['motion', 'occupancy', 'presence'].includes(e.deviceClass)) return on ? (e.deviceClass === 'motion' ? 'Mouvement détecté' : 'Présence') : 'Aucun mouvement';
  if (ALERT_CLASSES.has(e.deviceClass)) return on ? 'Alerte !' : 'Normal';
  if (e.deviceClass === 'lock') return on ? 'Déverrouillé' : 'Verrouillé';
  if (e.deviceClass === 'light') return on ? 'Lumière' : 'Obscurité';
  if (e.deviceClass === 'vibration' || e.deviceClass === 'sound') return on ? 'Détecté' : 'Calme';
  return on ? 'Activé' : 'Désactivé';
}

/** Texte d'état en français (« Allumée · 80 % », « 19,5 °C », « Ouvert · 70 % »…). */
export function formatState(e: HomeEntity): string {
  if (e.state === 'unavailable') return 'Indisponible';
  const a = e.attrs;
  switch (e.domain) {
    case 'sensor':
      return e.state === 'unknown' ? '—' : formatValue(e.state, e.unit);
    case 'binary_sensor':
      return e.state === 'unknown' ? '—' : binaryLabel(e);
    case 'light': {
      const pct = brightnessPct(e);
      return pct !== null ? `Allumée · ${pct} %` : (SIMPLE.light[e.state] ?? e.state);
    }
    case 'fan':
      return e.state === 'on' && typeof a.percentage === 'number' && a.percentage > 0 ? `En marche · ${Math.round(a.percentage)} %` : (SIMPLE.fan[e.state] ?? e.state);
    case 'cover':
    case 'valve': {
      const base = SIMPLE[e.domain][e.state] ?? e.state;
      return e.state === 'open' && typeof a.current_position === 'number' && a.current_position < 100 ? `${base} · ${a.current_position} %` : base;
    }
    case 'climate': {
      const current = typeof a.current_temperature === 'number' ? formatValue(a.current_temperature, '°C') : '';
      return [current, hvacLabel(e.state)].filter(Boolean).join(' · ');
    }
    case 'humidifier':
      return e.state === 'on' && typeof a.humidity === 'number' ? `En marche · ${a.humidity} %` : (SIMPLE.humidifier[e.state] ?? e.state);
    case 'media_player': {
      const title = [a.media_title, a.media_artist].filter((x) => typeof x === 'string' && x).join(' — ');
      const base = SIMPLE.media_player[e.state] ?? e.state;
      return title && (e.state === 'playing' || e.state === 'paused') ? `${base} · ${title}` : base;
    }
    case 'vacuum':
      return typeof a.battery_level === 'number' ? `${SIMPLE.vacuum[e.state] ?? e.state} · batterie ${a.battery_level} %` : (SIMPLE.vacuum[e.state] ?? e.state);
    case 'scene':
    case 'script':
    case 'button':
    case 'input_button':
      return '';
    default:
      return SIMPLE[e.domain]?.[e.state] ?? (e.state === 'unknown' ? '—' : e.state);
  }
}

/** Icône de l'appareil, d'après son type et sa classe. */
export function entityIcon(e: HomeEntity): IconName {
  const dc = e.deviceClass;
  switch (e.domain) {
    case 'light':
      return 'bulb';
    case 'switch':
      return dc === 'outlet' || /socket|outlet|plug/.test(e.icon) ? 'plug' : 'power';
    case 'input_boolean':
    case 'siren':
      return e.domain === 'siren' ? 'bell' : 'power';
    case 'fan':
      return 'fan';
    case 'cover':
      return dc === 'door' || dc === 'garage' || dc === 'gate' ? 'door' : 'blinds';
    case 'valve':
    case 'humidifier':
      return 'droplet';
    case 'climate':
      return 'thermometer';
    case 'lock':
      return e.state === 'locked' ? 'lock' : 'unlock';
    case 'camera':
      return 'camera';
    case 'media_player':
      return dc === 'tv' ? 'tv' : 'speaker';
    case 'vacuum':
      return 'vacuum';
    case 'scene':
      return 'sparkles';
    case 'script':
      return 'play';
    case 'button':
    case 'input_button':
      return 'target';
    case 'alarm_control_panel':
      return 'shield';
    case 'binary_sensor':
      if (OPENING_CLASSES.has(dc)) return 'door';
      if (dc === 'motion' || dc === 'occupancy' || dc === 'presence') return 'motion';
      if (dc === 'moisture') return 'droplet';
      if (dc === 'smoke' || dc === 'gas' || dc === 'carbon_monoxide') return 'flame';
      if (dc === 'lock') return 'lock';
      return 'bell';
    case 'sensor':
      if (dc === 'temperature' || e.unit === '°C') return 'thermometer';
      if (dc === 'humidity' || dc === 'moisture' || dc === 'water') return 'droplet';
      if (dc === 'power' || dc === 'energy') return 'zap';
      if (dc === 'battery') return 'battery';
      if (dc === 'illuminance') return 'sun';
      return 'activity';
    default:
      return 'cube';
  }
}

// ---------- Lumières ----------

const modes = (e: HomeEntity): string[] => (Array.isArray(e.attrs.supported_color_modes) ? (e.attrs.supported_color_modes as string[]) : []);
export const supportsColor = (e: HomeEntity) => modes(e).some((m) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m));
export const supportsColorTemp = (e: HomeEntity) => modes(e).includes('color_temp');
export const supportsBrightness = (e: HomeEntity) => modes(e).some((m) => m !== 'onoff');

/** Couleur actuelle d'une lampe allumée (pour la pastille et la lueur de la tuile). */
export function lightColor(e: HomeEntity): string | null {
  if (e.domain !== 'light' || e.state !== 'on') return null;
  const rgb = e.attrs.rgb_color;
  if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((c) => typeof c === 'number')) return `rgb(${rgb.join(', ')})`;
  return null;
}

export const LIGHT_PRESETS: { label: string; rgb?: [number, number, number]; kelvin?: number }[] = [
  { label: 'Blanc chaud', kelvin: 2700 },
  { label: 'Blanc neutre', kelvin: 4000 },
  { label: 'Blanc froid', kelvin: 6000 },
  { label: 'Rouge', rgb: [255, 40, 30] },
  { label: 'Orange', rgb: [255, 140, 20] },
  { label: 'Jaune', rgb: [255, 220, 40] },
  { label: 'Vert', rgb: [60, 220, 90] },
  { label: 'Cyan', rgb: [40, 200, 230] },
  { label: 'Bleu', rgb: [50, 90, 255] },
  { label: 'Violet', rgb: [150, 70, 255] },
  { label: 'Rose', rgb: [255, 80, 180] },
];

/** Aperçu d'une température de couleur (approximation pour les pastilles). */
export function kelvinToCss(k: number): string {
  const t = Math.min(1, Math.max(0, (k - 2000) / 4500));
  const r = 255;
  const g = Math.round(170 + 70 * t);
  const b = Math.round(90 + 165 * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

export function rgbToHex(rgb: unknown): string {
  if (!Array.isArray(rgb) || rgb.length !== 3) return '#ffcc88';
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Number(c) || 0)).toString(16).padStart(2, '0')).join('')}`;
}

// ---------- Commandes ----------

const COVER = { OPEN: 1, CLOSE: 2, SET_POSITION: 4, STOP: 8 };
export function coverSupports(e: HomeEntity, feature: keyof typeof COVER): boolean {
  const f = Number(e.attrs.supported_features);
  return Number.isFinite(f) ? (f & COVER[feature]) !== 0 : feature !== 'SET_POSITION';
}

const TOGGLE_DOMAINS = new Set(['light', 'switch', 'input_boolean', 'fan', 'humidifier', 'siren']);
export const isToggleable = (e: HomeEntity) => TOGGLE_DOMAINS.has(e.domain) || (e.domain === 'climate' && Array.isArray(e.attrs.hvac_modes));

/** Commande « allumer / éteindre » et état attendu juste après (affichage immédiat). */
export function toggleCommand(e: HomeEntity): { service: string; data?: Record<string, unknown>; optimistic: Partial<HomeEntity> } {
  if (e.domain === 'climate') {
    const modes = (e.attrs.hvac_modes as string[]) || [];
    const target = e.state === 'off' ? (modes.find((m) => m !== 'off') ?? 'heat') : 'off';
    return { service: 'set_hvac_mode', data: { hvac_mode: target }, optimistic: { state: target } };
  }
  const on = e.state === 'on';
  return { service: on ? 'turn_off' : 'turn_on', optimistic: { state: on ? 'off' : 'on' } };
}

/** Regroupe par pièce (ordre alphabétique, appareils sans pièce à la fin). */
export function groupByArea(list: HomeEntity[]): [string, HomeEntity[]][] {
  const groups = new Map<string, HomeEntity[]>();
  for (const e of list) {
    const key = e.area || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const order = (e: HomeEntity) => CATEGORIES.findIndex((c) => c.key === categoryOf(e.domain));
  for (const items of groups.values()) items.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name, 'fr'));
  return Array.from(groups.entries()).sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'fr')));
}
