// Apparence de l'application : thème de couleurs, couleur d'accent, fond d'écran, style des widgets, taille du texte,
// sections de la navigation. Réglages de l'espace (document Yjs, map « appearance ») : identiques sur tous les appareils
// reliés. Une copie locale permet d'afficher les bonnes couleurs dès le démarrage, avant la synchronisation.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { styleSystemBars } from './native';

export type ThemeId = 'dark' | 'black' | 'midnight' | 'forest' | 'light' | 'sepia' | 'lavender';

type Palette = {
  base: 'dark' | 'light';
  bg: string;
  sidebar: string;
  elevated: string;
  hover: string;
  active: string;
  border: string;
  borderStrong: string;
  text: string;
  strong: string;
  muted: string;
  faint: string;
  input: string;
};

export const THEMES: { id: ThemeId; label: string; palette: Palette }[] = [
  {
    id: 'dark',
    label: 'Sombre',
    palette: {
      base: 'dark', bg: '#191919', sidebar: '#202020', elevated: '#252525', hover: '#2c2c2c', active: '#373737', border: '#2f2f2f',
      borderStrong: '#3f3f3f', text: '#d4d4d4', strong: '#ffffff', muted: '#9b9b9b', faint: '#5a5a5a', input: '#1f1f1f',
    },
  },
  {
    id: 'black',
    label: 'Noir',
    palette: {
      base: 'dark', bg: '#000000', sidebar: '#0a0a0a', elevated: '#141414', hover: '#1c1c1c', active: '#262626', border: '#1f1f1f',
      borderStrong: '#2e2e2e', text: '#d6d6d6', strong: '#ffffff', muted: '#8f8f8f', faint: '#4d4d4d', input: '#0d0d0d',
    },
  },
  {
    id: 'midnight',
    label: 'Bleu nuit',
    palette: {
      base: 'dark', bg: '#0b1220', sidebar: '#0f1a2e', elevated: '#16233d', hover: '#1d2d4d', active: '#26395f', border: '#1f2c47',
      borderStrong: '#2b3b5c', text: '#d5dcec', strong: '#ffffff', muted: '#8d9ab5', faint: '#4d5a75', input: '#0e1728',
    },
  },
  {
    id: 'forest',
    label: 'Forêt',
    palette: {
      base: 'dark', bg: '#0f1a14', sidebar: '#13211a', elevated: '#1a2c22', hover: '#21382b', active: '#2a4636', border: '#22362b',
      borderStrong: '#2e4739', text: '#d4e3d8', strong: '#ffffff', muted: '#8fa697', faint: '#4f6457', input: '#111e17',
    },
  },
  {
    id: 'light',
    label: 'Clair',
    palette: {
      base: 'light', bg: '#ffffff', sidebar: '#f7f7f5', elevated: '#ffffff', hover: '#efefed', active: '#e6e6e3', border: '#e6e6e3',
      borderStrong: '#d4d4d1', text: '#37352f', strong: '#191919', muted: '#787774', faint: '#b4b4b0', input: '#ffffff',
    },
  },
  {
    id: 'sepia',
    label: 'Crème',
    palette: {
      base: 'light', bg: '#f7f3ea', sidebar: '#efe8da', elevated: '#fbf8f1', hover: '#ebe3d3', active: '#e2d8c4', border: '#e1d7c3',
      borderStrong: '#cfc2a8', text: '#3d3528', strong: '#1f1a12', muted: '#7d715e', faint: '#b3a78f', input: '#fffdf8',
    },
  },
  {
    id: 'lavender',
    label: 'Lavande',
    palette: {
      base: 'light', bg: '#f7f5fb', sidebar: '#efebf7', elevated: '#ffffff', hover: '#e9e3f3', active: '#ded6ee', border: '#e2dbef',
      borderStrong: '#cdc2e3', text: '#342e45', strong: '#1c1728', muted: '#7b7290', faint: '#b2a9c6', input: '#ffffff',
    },
  },
];

export const ACCENTS: { color: string; label: string }[] = [
  { color: '#2383e2', label: 'Bleu' },
  { color: '#7c5cff', label: 'Violet' },
  { color: '#c14c8a', label: 'Rose' },
  { color: '#e03e3e', label: 'Rouge' },
  { color: '#d9730d', label: 'Orange' },
  { color: '#dfab01', label: 'Jaune' },
  { color: '#2eaf7d', label: 'Vert' },
  { color: '#0ea5b7', label: 'Turquoise' },
  { color: '#787774', label: 'Gris' },
];

export type WallpaperKind = 'none' | 'color' | 'gradient' | 'image';

export type Wallpaper = {
  kind: WallpaperKind;
  /** Couleur (#rrggbb), identifiant de dégradé, ou adresse de l'image. */
  value: string;
  /** Flou de l'image (px) et assombrissement (%) pour garder le texte lisible. */
  blur: number;
  dim: number;
  /** Faux : seulement sur l'accueil ; vrai : derrière toute l'application. */
  everywhere: boolean;
};

export const GRADIENTS: { id: string; label: string; css: string }[] = [
  { id: 'aurora', label: 'Aurore', css: 'linear-gradient(135deg, #1e3a8a 0%, #7c3aed 50%, #db2777 100%)' },
  { id: 'ocean', label: 'Océan', css: 'linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)' },
  { id: 'sunset', label: 'Coucher de soleil', css: 'linear-gradient(135deg, #f97316 0%, #db2777 55%, #7c3aed 100%)' },
  { id: 'forest', label: 'Forêt', css: 'linear-gradient(160deg, #0b3d2e 0%, #14532d 55%, #3f6212 100%)' },
  { id: 'night', label: 'Nuit étoilée', css: 'radial-gradient(ellipse at top, #1b2735 0%, #090a0f 100%)' },
  { id: 'mist', label: 'Brume', css: 'linear-gradient(135deg, #e0e7ff 0%, #fae8ff 50%, #fef3c7 100%)' },
  { id: 'peach', label: 'Pêche', css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
  { id: 'mint', label: 'Menthe', css: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)' },
];

export type SectionId = 'home' | 'notes' | 'agenda' | 'smarthome' | 'cameras' | 'homelab' | 'pdf';

export const SECTION_IDS: SectionId[] = ['home', 'notes', 'agenda', 'smarthome', 'cameras', 'homelab', 'pdf'];

export type Appearance = {
  theme: ThemeId;
  accent: string;
  wallpaper: Wallpaper;
  /** Opacité du fond des widgets (%), flou derrière eux (px), arrondi des coins (px), espace entre eux (px). */
  widgetOpacity: number;
  widgetBlur: number;
  radius: number;
  gap: number;
  /** Taille du texte de l'interface (%). */
  textScale: number;
  /** Ordre des sections de la navigation, et celles masquées. */
  sections: SectionId[];
  hidden: SectionId[];
};

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'dark',
  accent: '#2383e2',
  wallpaper: { kind: 'none', value: '', blur: 0, dim: 20, everywhere: false },
  widgetOpacity: 88,
  widgetBlur: 14,
  radius: 14,
  gap: 12,
  textScale: 100,
  sections: SECTION_IDS,
  hidden: [],
};

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Réglages lus (valeurs manquantes ou invalides remplacées par celles par défaut). */
export function normalizeAppearance(raw: unknown): Appearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Appearance> & { wallpaper?: Partial<Wallpaper> };
  const d = DEFAULT_APPEARANCE;
  const w: Partial<Wallpaper> = r.wallpaper ?? {};
  const kind: WallpaperKind = ['none', 'color', 'gradient', 'image'].includes(String(w.kind)) ? (w.kind as WallpaperKind) : 'none';
  const known = (list: unknown) => (Array.isArray(list) ? list.filter((s): s is SectionId => SECTION_IDS.includes(s)) : []);
  const order = known(r.sections);
  // Nouvelle section ajoutée depuis : placée à la fin.
  const sections = [...new Set([...order, ...SECTION_IDS])];
  return {
    theme: THEMES.some((t) => t.id === r.theme) ? (r.theme as ThemeId) : d.theme,
    accent: isColor(r.accent) ? r.accent : d.accent,
    wallpaper: {
      kind,
      // Image envoyée sans serveur : gardée dans le document (adresse data:), d'où la limite large.
      value: typeof w.value === 'string' && w.value.length <= 6_000_000 ? w.value : '',
      blur: clamp(w.blur, 0, 30, d.wallpaper.blur),
      dim: clamp(w.dim, 0, 90, d.wallpaper.dim),
      everywhere: Boolean(w.everywhere),
    },
    widgetOpacity: clamp(r.widgetOpacity, 0, 100, d.widgetOpacity),
    widgetBlur: clamp(r.widgetBlur, 0, 40, d.widgetBlur),
    radius: clamp(r.radius, 0, 32, d.radius),
    gap: clamp(r.gap, 0, 40, d.gap),
    textScale: clamp(r.textScale, 80, 140, d.textScale),
    sections,
    // L'accueil reste toujours visible.
    hidden: known(r.hidden).filter((s) => s !== 'home'),
  };
}

const CACHE_KEY = 'notes.appearance.v1';

export function readAppearance(doc: Y.Doc): Appearance {
  try {
    return normalizeAppearance(JSON.parse(String(doc.getMap('appearance').get('config') ?? '{}')));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function updateAppearance(doc: Y.Doc, change: (a: Appearance) => Partial<Appearance>) {
  const current = readAppearance(doc);
  doc.getMap('appearance').set('config', JSON.stringify(normalizeAppearance({ ...current, ...change(current) })));
}

/** Réglages de l'espace, suivis en direct (et gardés sur l'appareil pour le prochain démarrage). */
export function useAppearance(doc: Y.Doc | null): Appearance {
  const [appearance, setAppearance] = useState<Appearance>(() => (doc ? readAppearance(doc) : cachedAppearance()));
  useEffect(() => {
    if (!doc) return;
    const map = doc.getMap('appearance');
    const read = () => setAppearance(readAppearance(doc));
    map.observe(read);
    read();
    return () => map.unobserve(read);
  }, [doc]);
  return appearance;
}

export function cachedAppearance(): Appearance {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export const themeOf = (a: Appearance) => THEMES.find((t) => t.id === a.theme) ?? THEMES[0];

/** Texte lisible (blanc ou presque noir) sur une couleur. */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff';
}

export function wallpaperCss(w: Wallpaper): string {
  if (w.kind === 'color' && isColor(w.value)) return w.value;
  if (w.kind === 'gradient') return GRADIENTS.find((g) => g.id === w.value)?.css ?? 'none';
  if (w.kind === 'image' && w.value) return `center / cover no-repeat url("${w.value.replace(/["\\\n]/g, '')}")`;
  return 'none';
}

let currentBase: 'dark' | 'light' = 'dark';
const baseListeners = new Set<() => void>();

/** Thème clair ou sombre en cours (éditeur, fenêtres de BlockNote…). */
export function useThemeBase(): 'dark' | 'light' {
  return useSyncExternalStore(
    (fn) => {
      baseListeners.add(fn);
      return () => {
        baseListeners.delete(fn);
      };
    },
    () => currentBase,
    () => currentBase,
  );
}

/** Applique les réglages à toute l'application (variables CSS de la racine). */
export function applyAppearance(a: Appearance) {
  const p = themeOf(a).palette;
  const root = document.documentElement;
  const vars: Record<string, string> = {
    '--bg': p.bg,
    '--bg-sidebar': p.sidebar,
    '--bg-elevated': p.elevated,
    '--bg-hover': p.hover,
    '--bg-active': p.active,
    '--border': p.border,
    '--border-strong': p.borderStrong,
    '--text': p.text,
    '--text-strong': p.strong,
    '--text-muted': p.muted,
    '--text-faint': p.faint,
    '--input-bg': p.input,
    '--border-soft': `${p.border}bf`,
    '--border-strong-soft': `${p.borderStrong}b3`,
    '--border-glass': `${p.border}99`,
    '--accent': a.accent,
    '--accent-hover': `color-mix(in srgb, ${a.accent} 82%, ${p.base === 'dark' ? '#ffffff' : '#000000'})`,
    '--accent-soft': `color-mix(in srgb, ${a.accent} 28%, transparent)`,
    '--on-accent': readableOn(a.accent),
    '--widget-bg': `color-mix(in srgb, ${p.elevated} ${a.widgetOpacity}%, transparent)`,
    '--widget-blur': `${a.widgetBlur}px`,
    '--widget-radius': `${a.radius}px`,
    '--widget-gap': `${a.gap}px`,
    '--ui-scale': String(a.textScale / 100),
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = p.base;
  root.style.colorScheme = p.base;
  if (p.base !== currentBase) {
    currentBase = p.base;
    styleSystemBars(p.base);
    baseListeners.forEach((l) => l());
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg);
  try {
    // Copie locale pour les couleurs du démarrage : sans une image de fond volumineuse (adresse data:).
    const light = a.wallpaper.value.length > 20_000 ? { ...a, wallpaper: { ...a.wallpaper, value: '' } } : a;
    localStorage.setItem(CACHE_KEY, JSON.stringify(light));
  } catch {
    /* stockage indisponible */
  }
}
