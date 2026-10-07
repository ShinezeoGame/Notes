// Catalogue des widgets : nom, icône, description, barre de titre par défaut, contenu et réglages de chaque type.
import type { ComponentType } from 'react';
import type { IconName } from '../icons/registry';
import type { SectionId } from '../lib/appearance';
import type { WidgetType } from './model';
import type { SettingsProps, WidgetProps } from './types';
import { ClockSettings, ClockWidget } from './widgets/Clock';
import { WeatherSettings, WeatherWidget } from './widgets/Weather';
import { NOTE_COLORS, NoteSettings, NoteWidget } from './widgets/Note';
import { TasksSettings, TasksWidget } from './widgets/Tasks';
import { PageSettings, PageWidget } from './widgets/Page';
import { PagesSettings, PagesWidget } from './widgets/Pages';
import { AgendaSettings, AgendaWidget } from './widgets/Agenda';
import { CamerasSettings, CamerasWidget, HomelabWidget, SmartHomeSettings, SmartHomeWidget } from './widgets/Home';
import { LinksSettings, LinksWidget } from './widgets/Links';
import { ImageSettings, ImageWidget, WebSettings, WebWidget } from './widgets/Media';
import { SearchSettings, SearchWidget } from './widgets/Search';
import { WolSettings, WolWidget } from './widgets/Wol';
import { WifiSettings, WifiWidget } from './widgets/Wifi';
import { t } from '../lib/i18n';

export type WidgetDef = {
  label: string;
  icon: IconName;
  description: string;
  /** Barre de titre affichée par défaut. */
  showTitle: boolean;
  /** Catégorie dans le catalogue. */
  group: 'Essentiels' | 'Notes' | 'Maison' | 'Web et médias';
  Body: ComponentType<WidgetProps>;
  Settings?: ComponentType<SettingsProps>;
  /** Réglages d'un widget ajouté depuis le catalogue. */
  defaults?: Record<string, unknown>;
  /** Réglages à faire dès l'ajout (ville, page, site…). */
  setupFirst?: boolean;
  /** Couleur de fond propre au widget (post-it). */
  tint?: (config: Record<string, unknown>) => string | undefined;
  /** Section dont le widget montre le contenu : absent du catalogue quand elle est masquée (pas utilisée). */
  section?: SectionId;
  /** Fonctionne seulement avec un serveur Ostal : absent du catalogue sur un appareil seul. */
  needsServer?: boolean;
};

export const WIDGETS: Record<WidgetType, WidgetDef> = {
  clock: {
    label: t('Horloge'),
    icon: 'clock',
    description: t('Heure, date et salutation ; horloge du monde avec un autre fuseau horaire.'),
    showTitle: false,
    group: 'Essentiels',
    Body: ClockWidget,
    Settings: ClockSettings,
    defaults: { date: true },
  },
  weather: {
    label: t('Météo'),
    icon: 'cloudSun',
    description: t('Temps actuel et prévisions des prochains jours pour la ville de votre choix.'),
    showTitle: false,
    group: 'Essentiels',
    Body: WeatherWidget,
    Settings: WeatherSettings,
    setupFirst: true,
  },
  agenda: {
    label: t('Agenda'),
    icon: 'calendar',
    description: t('Prochains événements de vos agendas Google ou iCal, ou le mois en miniature.'),
    showTitle: true,
    group: 'Essentiels',
    Body: AgendaWidget,
    Settings: AgendaSettings,
    defaults: { days: 14 },
  },
  tasks: {
    label: t('Tâches'),
    icon: 'checkSquare',
    description: t('Liste de choses à faire, à cocher.'),
    showTitle: true,
    group: 'Essentiels',
    Body: TasksWidget,
    Settings: TasksSettings,
  },
  search: {
    label: t('Recherche'),
    icon: 'search',
    description: t('Barre de recherche sur le web (Google, DuckDuckGo, Qwant…) ou dans vos notes.'),
    showTitle: false,
    group: 'Essentiels',
    Body: SearchWidget,
    Settings: SearchSettings,
  },
  note: {
    label: t('Note rapide'),
    icon: 'pencil',
    description: t('Un bloc-notes façon post-it, enregistré à chaque frappe.'),
    showTitle: true,
    group: 'Notes',
    Body: NoteWidget,
    Settings: NoteSettings,
    tint: (c) => NOTE_COLORS.find((n) => n.id && n.id === c.color)?.color,
  },
  page: {
    label: t('Page de notes'),
    icon: 'note',
    description: t('Une de vos pages, affichée et modifiable directement sur l’accueil.'),
    showTitle: false,
    group: 'Notes',
    Body: PageWidget,
    Settings: PageSettings,
    setupFirst: true,
  },
  pages: {
    label: t('Pages'),
    icon: 'book',
    description: t('Accès rapide à vos pages ouvertes récemment, ou aux pages principales.'),
    showTitle: true,
    group: 'Notes',
    Body: PagesWidget,
    Settings: PagesSettings,
    defaults: { mode: 'recent' },
  },
  cameras: {
    label: t('Caméras'),
    icon: 'cctv',
    description: t('Vos caméras de surveillance en direct (toutes, ou une seule).'),
    showTitle: true,
    group: 'Maison',
    Body: CamerasWidget,
    Settings: CamerasSettings,
    section: 'cameras',
    needsServer: true,
  },
  smarthome: {
    label: t('Maison'),
    icon: 'bulb',
    description: t('Lumières, prises, volets, chauffage… de Home Assistant.'),
    showTitle: true,
    group: 'Maison',
    Body: SmartHomeWidget,
    Settings: SmartHomeSettings,
    defaults: { favoritesOnly: true },
    section: 'smarthome',
    needsServer: true,
  },
  homelab: {
    label: t('Homelab'),
    icon: 'server',
    description: t('État de vos serveurs et applications (en ligne, processeur, mémoire…).'),
    showTitle: true,
    group: 'Maison',
    Body: HomelabWidget,
    section: 'homelab',
    needsServer: true,
  },
  wol: {
    label: t('Allumer un PC'),
    icon: 'power',
    description: t('Allume un ordinateur à distance (Wake-on-LAN) et montre s’il est allumé.'),
    showTitle: false,
    group: 'Maison',
    Body: WolWidget,
    Settings: WolSettings,
    setupFirst: true,
    needsServer: true,
  },
  wifi: {
    label: t('Wi-Fi invités'),
    icon: 'wifi',
    description: t('Un QR code à scanner pour rejoindre votre Wi-Fi, sans dicter le mot de passe.'),
    showTitle: false,
    group: 'Maison',
    Body: WifiWidget,
    Settings: WifiSettings,
    setupFirst: true,
  },
  links: {
    label: t('Raccourcis'),
    icon: 'link',
    description: t('Vos sites préférés et pages de notes, en un clic.'),
    showTitle: true,
    group: 'Web et médias',
    Body: LinksWidget,
    Settings: LinksSettings,
    setupFirst: true,
  },
  image: {
    label: t('Image'),
    icon: 'image',
    description: t('Une photo ou une image, avec un lien facultatif.'),
    showTitle: false,
    group: 'Web et médias',
    Body: ImageWidget,
    Settings: ImageSettings,
    setupFirst: true,
  },
  web: {
    label: t('Site web'),
    icon: 'globe',
    description: t('Une page web intégrée (Grafana, Home Assistant, radar de pluie…).'),
    showTitle: true,
    group: 'Web et médias',
    Body: WebWidget,
    Settings: WebSettings,
    setupFirst: true,
  },
};

export const WIDGET_GROUPS: WidgetDef['group'][] = ['Essentiels', 'Notes', 'Maison', 'Web et médias']; // i18n-ignore

/** Titres des groupes du catalogue (les groupes sont identifiés par leur nom français). */
export const WIDGET_GROUP_LABELS: Record<WidgetDef['group'], string> = {
  Essentiels: t('Essentiels'),
  Notes: t('Notes'),
  Maison: t('Maison'),
  'Web et médias': t('Web et médias'),
};
