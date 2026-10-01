// Maison connectée : appareils de Home Assistant (lumières, prises, volets, chauffage, caméras, capteurs…)
// affichés et pilotés via le serveur Melo, qui détient l'adresse et le jeton de Home Assistant.
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { isIconName, type IconName } from '../icons/registry';
import { newId } from './ids';
import { reorderSubset } from './sortable';
import { t, tn, locale } from './i18n';

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
  /** Caméras : adresses signées (relatives au serveur Melo) de l'image et du flux vidéo. */
  snapshot?: string;
  stream?: string;
};

export type HomeStates = { configured: boolean; entities: HomeEntity[]; error?: string; fetchedAt: number };

/** Appareils pilotés ensemble (lumières d'une pièce, prises du bureau…). */
export type HomeGroup = {
  /** « group:… » (jamais confondu avec un appareil, dont l'identifiant contient un point). */
  id: string;
  name: string;
  /** Icône choisie ; vide : d'après les appareils du groupe. */
  icon: string;
  members: string[];
};

export type HomeConfig = {
  url: string;
  token: string;
  insecure: boolean;
  /** Appareils et groupes épinglés en tête de liste, dans cet ordre. */
  favorites: string[];
  /** Appareils masqués de la liste. */
  hidden: string[];
  groups: HomeGroup[];
  /** Ordre choisi des appareils (glisser-déposer) ; ceux qui n'y figurent pas suivent, dans l'ordre par défaut. */
  order: string[];
};

// ---------- Configuration (document Yjs de l'espace, comme le homelab) ----------

const EMPTY_CONFIG: HomeConfig = { url: '', token: '', insecure: false, favorites: [], hidden: [], groups: [], order: [] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function readGroups(v: unknown): HomeGroup[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: HomeGroup[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    if (typeof g.id !== 'string' || !isGroupId(g.id) || seen.has(g.id)) continue;
    seen.add(g.id);
    out.push({ id: g.id, name: typeof g.name === 'string' ? g.name : '', icon: typeof g.icon === 'string' ? g.icon : '', members: strings(g.members) });
  }
  return out;
}

export function readHomeConfig(doc: Y.Doc): HomeConfig {
  try {
    const raw = JSON.parse(String(doc.getMap('smarthome').get('config') ?? '{}')) as Partial<HomeConfig>;
    return {
      url: typeof raw.url === 'string' ? raw.url : '',
      token: typeof raw.token === 'string' ? raw.token : '',
      insecure: Boolean(raw.insecure),
      favorites: strings(raw.favorites),
      hidden: strings(raw.hidden),
      groups: readGroups(raw.groups),
      order: strings(raw.order),
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
  { key: 'light', label: t('Lumières'), icon: 'bulb', domains: ['light'] },
  { key: 'power', label: t('Prises'), icon: 'plug', domains: ['switch', 'input_boolean', 'siren'] },
  { key: 'climate', label: t('Climat'), icon: 'thermometer', domains: ['climate', 'fan', 'humidifier'] },
  { key: 'cover', label: t('Volets et portes'), icon: 'blinds', domains: ['cover', 'valve', 'lock'] },
  { key: 'camera', label: t('Caméras'), icon: 'camera', domains: ['camera'] },
  { key: 'media', label: t('Multimédia'), icon: 'speaker', domains: ['media_player'] },
  { key: 'sensor', label: t('Capteurs'), icon: 'activity', domains: ['sensor', 'binary_sensor', 'alarm_control_panel'] },
  { key: 'scene', label: t('Scènes'), icon: 'sparkles', domains: ['scene', 'script', 'button', 'input_button'] },
  { key: 'other', label: t('Autres'), icon: 'cube', domains: ['vacuum'] },
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

const NUMBER = new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 });

export function formatValue(value: string | number, unit = ''): string {
  const n = typeof value === 'number' ? value : Number(value);
  const text = Number.isFinite(n) && value !== '' ? NUMBER.format(n) : String(value);
  return unit ? `${text} ${unit}` : text;
}

export const brightnessPct = (e: HomeEntity): number | null =>
  e.state === 'on' && typeof e.attrs.brightness === 'number' ? Math.max(1, Math.round((e.attrs.brightness / 255) * 100)) : null;

const HVAC: Record<string, string> = {
  off: t('Arrêt'),
  heat: t('Chauffage'),
  cool: t('Climatisation'),
  auto: t('Automatique'),
  heat_cool: t('Chaud / froid'),
  dry: t('Déshumidification'),
  fan_only: t('Ventilation'),
};
export const hvacLabel = (mode: string) => HVAC[mode] ?? mode;

const SIMPLE: Record<string, Record<string, string>> = {
  light: { on: t('Allumée'), off: t('Éteinte') },
  switch: { on: t('Allumé'), off: t('Éteint') },
  input_boolean: { on: t('Activé'), off: t('Désactivé') },
  siren: { on: t('En marche'), off: t('Arrêtée') },
  fan: { on: t('En marche'), off: t('Arrêté') },
  humidifier: { on: t('En marche'), off: t('Arrêté') },
  cover: { open: t('Ouvert'), closed: t('Fermé'), opening: t('Ouverture…'), closing: t('Fermeture…'), stopped: t('Arrêté') },
  valve: { open: t('Ouverte'), closed: t('Fermée'), opening: t('Ouverture…'), closing: t('Fermeture…') },
  lock: {
    locked: t('Verrouillée'),
    unlocked: t('Déverrouillée'),
    jammed: t('Bloquée !'),
    locking: t('Verrouillage…'),
    unlocking: t('Déverrouillage…'),
    open: t('Ouverte'),
  },
  media_player: {
    playing: t('Lecture'),
    paused: t('En pause'),
    idle: t('Inactif'),
    off: t('Éteint'),
    on: t('Allumé'),
    standby: t('En veille'),
    buffering: t('Chargement…'),
  },
  vacuum: {
    cleaning: t('Nettoyage'),
    docked: t('Sur sa base'),
    returning: t('Retour à la base'),
    idle: t('Inactif'),
    paused: t('En pause'),
    error: t('Erreur'),
  },
  camera: { idle: t('En veille'), recording: t('Enregistrement'), streaming: t('En direct') },
  alarm_control_panel: {
    disarmed: t('Désactivée'),
    armed_home: t('Activée (maison)'),
    armed_away: t('Activée (absence)'),
    armed_night: t('Activée (nuit)'),
    armed_vacation: t('Activée (vacances)'),
    arming: t('Activation…'),
    pending: t('En attente…'),
    triggered: t('Déclenchée !'),
  },
};

function binaryLabel(e: HomeEntity): string {
  const on = e.state === 'on';
  if (OPENING_CLASSES.has(e.deviceClass)) return on ? t('Ouverte') : t('Fermée');
  if (['motion', 'occupancy', 'presence'].includes(e.deviceClass))
    return on ? (e.deviceClass === 'motion' ? t('Mouvement détecté') : t('Présence')) : t('Aucun mouvement');
  if (ALERT_CLASSES.has(e.deviceClass)) return on ? t('Alerte !') : t('Normal');
  if (e.deviceClass === 'lock') return on ? t('Déverrouillé') : t('Verrouillé');
  if (e.deviceClass === 'light') return on ? t('Lumière') : t('Obscurité');
  if (e.deviceClass === 'vibration' || e.deviceClass === 'sound') return on ? t('Détecté') : t('Calme');
  return on ? t('Activé') : t('Désactivé');
}

/** Texte d'état en français (« Allumée · 80 % », « 19,5 °C », « Ouvert · 70 % »…). */
export function formatState(e: HomeEntity): string {
  if (e.state === 'unavailable') return t('Indisponible');
  const a = e.attrs;
  switch (e.domain) {
    case 'sensor':
      return e.state === 'unknown' ? '—' : formatValue(e.state, e.unit);
    case 'binary_sensor':
      return e.state === 'unknown' ? '—' : binaryLabel(e);
    case 'light': {
      const pct = brightnessPct(e);
      return pct !== null ? t('Allumée · {pct} %', { pct }) : (SIMPLE.light[e.state] ?? e.state);
    }
    case 'fan':
      return e.state === 'on' && typeof a.percentage === 'number' && a.percentage > 0
        ? t('En marche · {pct} %', { pct: Math.round(a.percentage) })
        : (SIMPLE.fan[e.state] ?? e.state);
    case 'cover':
    case 'valve': {
      const base = SIMPLE[e.domain][e.state] ?? e.state;
      return e.state === 'open' && typeof a.current_position === 'number' && a.current_position < 100
        ? t('{state} · {pct} %', { state: base, pct: a.current_position })
        : base;
    }
    case 'climate': {
      const current = typeof a.current_temperature === 'number' ? formatValue(a.current_temperature, '°C') : '';
      return [current, hvacLabel(e.state)].filter(Boolean).join(' · ');
    }
    case 'humidifier':
      return e.state === 'on' && typeof a.humidity === 'number'
        ? t('En marche · {pct} %', { pct: a.humidity })
        : (SIMPLE.humidifier[e.state] ?? e.state);
    case 'media_player': {
      const title = [a.media_title, a.media_artist].filter((x) => typeof x === 'string' && x).join(' — ');
      const base = SIMPLE.media_player[e.state] ?? e.state;
      return title && (e.state === 'playing' || e.state === 'paused') ? `${base} · ${title}` : base;
    }
    case 'vacuum':
      return typeof a.battery_level === 'number'
        ? t('{state} · batterie {pct} %', { state: SIMPLE.vacuum[e.state] ?? e.state, pct: a.battery_level })
        : (SIMPLE.vacuum[e.state] ?? e.state);
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
  { label: t('Blanc chaud'), kelvin: 2700 },
  { label: t('Blanc neutre'), kelvin: 4000 },
  { label: t('Blanc froid'), kelvin: 6000 },
  { label: t('Rouge'), rgb: [255, 40, 30] },
  { label: t('Orange'), rgb: [255, 140, 20] },
  { label: t('Jaune'), rgb: [255, 220, 40] },
  { label: t('Vert'), rgb: [60, 220, 90] },
  { label: t('Cyan'), rgb: [40, 200, 230] },
  { label: t('Bleu'), rgb: [50, 90, 255] },
  { label: t('Violet'), rgb: [150, 70, 255] },
  { label: t('Rose'), rgb: [255, 80, 180] },
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

/**
 * Regroupe par pièce (ordre alphabétique, appareils sans pièce à la fin). Dans une pièce : l'ordre choisi par
 * glisser-déposer, puis par type d'appareil et par nom.
 */
export function groupByArea(list: HomeEntity[], order: readonly string[] = []): [string, HomeEntity[]][] {
  const groups = new Map<string, HomeEntity[]>();
  for (const e of list) {
    const key = e.area || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const rank = new Map(order.map((id, i) => [id, i]));
  const kind = (e: HomeEntity) => CATEGORIES.findIndex((c) => c.key === categoryOf(e.domain));
  const compare = (a: HomeEntity, b: HomeEntity) => {
    const ra = rank.get(a.id) ?? Infinity;
    const rb = rank.get(b.id) ?? Infinity;
    if (ra !== rb) return ra - rb;
    return kind(a) - kind(b) || a.name.localeCompare(b.name, locale());
  };
  for (const items of groups.values()) items.sort(compare);
  return Array.from(groups.entries()).sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, locale())));
}

/** Enregistre l'ordre d'appareils affichés ensemble (une pièce, les résultats d'une recherche…) après un glisser-déposer. */
export function saveEntityOrder(doc: Y.Doc, all: HomeEntity[], shown: string[]) {
  updateHomeConfig(doc, (c) => {
    const full = groupByArea(all, c.order).flatMap(([, items]) => items.map((e) => e.id));
    return { ...c, order: reorderSubset(full, shown) };
  });
}

/** Nouvel ordre des favoris affichés (les favoris introuvables gardent leur place). */
export function saveFavoritesOrder(doc: Y.Doc, shown: string[]) {
  updateHomeConfig(doc, (c) => ({ ...c, favorites: reorderSubset(c.favorites, shown) }));
}

// ---------- Groupes ----------

export const isGroupId = (id: string) => id.startsWith('group:');
export const newGroupId = () => `group:${newId()}`;

const isCover = (e: HomeEntity) => e.domain === 'cover' || e.domain === 'valve';
/** Appareils qu'un groupe peut piloter : à interrupteur (lumières, prises, ventilateurs, chauffage…) ou volets et vannes. */
export const isGroupable = (e: HomeEntity) => isToggleable(e) || isCover(e);
export const isSwitchedOn = (e: HomeEntity) => (e.domain === 'climate' ? e.state !== 'off' : e.state === 'on');

export function groupMembers(g: HomeGroup, byId: Map<string, HomeEntity>): HomeEntity[] {
  return g.members.map((id) => byId.get(id)).filter((e): e is HomeEntity => Boolean(e));
}

/** Le groupe compte comme allumé (tuile colorée) dès qu'un de ses appareils l'est, ou qu'un volet est ouvert. */
export function isGroupActive(members: HomeEntity[]): boolean {
  return members.some((e) => !isUnavailable(e) && (isToggleable(e) ? isSwitchedOn(e) : isActive(e)));
}

export const groupHasSwitch = (members: HomeEntity[]) => members.some((e) => isToggleable(e));

/** Luminosité moyenne des lampes allumées qui la règlent (null : aucune). */
export function groupBrightness(members: HomeEntity[]): number | null {
  const values = members.map(brightnessPct).filter((v): v is number => v !== null);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

/** « 3 allumées sur 5 · 60 % », « Toutes éteintes », « Tous fermés »… */
export function groupLabel(members: HomeEntity[]): string {
  if (!members.length) return t('Aucun appareil');
  const available = members.filter((e) => !isUnavailable(e));
  if (!available.length) return t('Indisponible');
  const parts: string[] = [];
  const toggles = available.filter(isToggleable);
  if (toggles.length) {
    const on = toggles.filter(isSwitchedOn).length;
    const f = toggles.every((e) => e.domain === 'light'); // « les lampes » : accord au féminin
    const one = toggles.length === 1;
    if (on === 0) parts.push(one ? (f ? t('Éteinte') : t('Éteint')) : f ? t('Toutes éteintes') : t('Tous éteints'));
    else if (on === toggles.length) parts.push(one ? (f ? t('Allumée') : t('Allumé')) : f ? t('Toutes allumées') : t('Tous allumés'));
    else
      parts.push(
        f
          ? tn(on, '{n} allumée sur {total}', '{n} allumées sur {total}', { total: toggles.length })
          : tn(on, '{n} allumé sur {total}', '{n} allumés sur {total}', { total: toggles.length }),
      );
    const pct = groupBrightness(toggles);
    if (pct !== null) parts.push(t('{pct} %', { pct }));
  }
  const covers = available.filter(isCover);
  if (covers.length) {
    const open = covers.filter(isActive).length;
    const one = covers.length === 1;
    if (open === 0) parts.push(one ? t('Fermé') : t('Tous fermés'));
    else if (open === covers.length) parts.push(one ? t('Ouvert') : t('Tous ouverts'));
    else parts.push(tn(open, '{n} ouvert sur {total}', '{n} ouverts sur {total}', { total: covers.length }));
  }
  return parts.join(' · ');
}

/** Icône du groupe : celle choisie, sinon d'après ses appareils. */
export function groupIcon(g: HomeGroup, members: HomeEntity[]): IconName {
  if (g.icon && isIconName(g.icon)) return g.icon;
  return autoGroupIcon(members);
}

export function autoGroupIcon(members: HomeEntity[]): IconName {
  if (!members.length) return 'grid';
  const icons = new Set(members.map(entityIcon));
  return icons.size === 1 ? [...icons][0] : members.every((e) => e.domain === 'light') ? 'bulb' : 'grid';
}

/** Commande envoyée à plusieurs appareils du même type à la fois (le serveur la transmet en une seule fois). */
export type HomeCall = { ids: string[]; service: string; data?: Record<string, unknown>; optimistic?: Partial<HomeEntity> };

function byDomain(list: HomeEntity[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of list) {
    if (!out.has(e.domain)) out.set(e.domain, []);
    out.get(e.domain)!.push(e.id);
  }
  return out;
}

/** Tout allumer (on) ou tout éteindre : un appel par type d'appareil, le chauffage un par un (chacun son mode). */
export function groupSwitchCalls(members: HomeEntity[], on: boolean): HomeCall[] {
  const calls: HomeCall[] = [];
  const toggles = members.filter((e) => !isUnavailable(e) && isToggleable(e));
  for (const e of toggles.filter((x) => x.domain === 'climate')) {
    const modes = Array.isArray(e.attrs.hvac_modes) ? (e.attrs.hvac_modes as string[]) : [];
    const target = on ? (modes.find((m) => m !== 'off') ?? 'heat') : 'off';
    if ((e.state !== 'off') !== on) calls.push({ ids: [e.id], service: 'set_hvac_mode', data: { hvac_mode: target }, optimistic: { state: target } });
  }
  for (const [, ids] of byDomain(toggles.filter((x) => x.domain !== 'climate'))) {
    calls.push({ ids, service: on ? 'turn_on' : 'turn_off', optimistic: { state: on ? 'on' : 'off' } });
  }
  return calls;
}

export function groupBrightnessCalls(members: HomeEntity[], pct: number): HomeCall[] {
  const ids = members.filter((e) => e.domain === 'light' && !isUnavailable(e) && supportsBrightness(e)).map((e) => e.id);
  return ids.length ? [{ ids, service: 'turn_on', data: { brightness_pct: pct }, optimistic: { state: 'on', attrs: { brightness: Math.round((pct / 100) * 255) } } }] : [];
}

/** Même couleur pour toutes les lampes du groupe qui la gèrent (blancs : température de couleur quand elle existe). */
export function groupColorCalls(members: HomeEntity[], preset: { rgb?: [number, number, number]; kelvin?: number }): HomeCall[] {
  const lights = members.filter((e) => e.domain === 'light' && !isUnavailable(e));
  if (preset.rgb) {
    const ids = lights.filter(supportsColor).map((e) => e.id);
    return ids.length ? [{ ids, service: 'turn_on', data: { rgb_color: preset.rgb }, optimistic: { state: 'on', attrs: { rgb_color: preset.rgb } } }] : [];
  }
  const calls: HomeCall[] = [];
  const temp = lights.filter(supportsColorTemp).map((e) => e.id);
  const colorOnly = lights.filter((e) => !supportsColorTemp(e) && supportsColor(e)).map((e) => e.id);
  if (temp.length) calls.push({ ids: temp, service: 'turn_on', data: { color_temp_kelvin: preset.kelvin }, optimistic: { state: 'on', attrs: { color_temp_kelvin: preset.kelvin } } });
  if (colorOnly.length) calls.push({ ids: colorOnly, service: 'turn_on', data: { rgb_color: [255, 214, 170] }, optimistic: { state: 'on', attrs: { rgb_color: [255, 214, 170] } } });
  return calls;
}

/** Ouvrir, fermer ou arrêter tous les volets et vannes du groupe. */
export function groupCoverCalls(members: HomeEntity[], action: 'open' | 'close' | 'stop'): HomeCall[] {
  const feature = action === 'open' ? 'OPEN' : action === 'close' ? 'CLOSE' : 'STOP';
  const covers = members.filter((e) => isCover(e) && !isUnavailable(e) && coverSupports(e, feature));
  const optimistic = action === 'stop' ? undefined : { state: action === 'open' ? 'opening' : 'closing' };
  return [...byDomain(covers)].map(([domain, ids]) => ({ ids, service: `${action}_${domain}`, optimistic }));
}

export const groupHasCovers = (members: HomeEntity[]) => members.some(isCover);
export const groupHasLights = (members: HomeEntity[]) => members.some((e) => e.domain === 'light');

/** Nom proposé d'après les appareils choisis (« Lumières · Salon »…). */
export function suggestGroupName(members: HomeEntity[]): string {
  if (!members.length) return '';
  const cats = new Set(members.map((e) => categoryOf(e.domain)));
  const areas = new Set(members.map((e) => e.area).filter(Boolean));
  const cat = cats.size === 1 ? (CATEGORIES.find((c) => c.key === [...cats][0])?.label ?? t('Appareils')) : t('Appareils');
  return areas.size === 1 && members.every((e) => e.area) ? `${cat} · ${[...areas][0]}` : cat;
}
