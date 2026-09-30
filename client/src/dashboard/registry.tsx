// Catalogue des widgets : nom, icône, description, barre de titre par défaut, contenu et réglages de chaque type.
import type { ComponentType } from 'react';
import type { IconName } from '../icons/registry';
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
};

export const WIDGETS: Record<WidgetType, WidgetDef> = {
  clock: {
    label: 'Horloge',
    icon: 'clock',
    description: 'Heure, date et salutation ; horloge du monde avec un autre fuseau horaire.',
    showTitle: false,
    group: 'Essentiels',
    Body: ClockWidget,
    Settings: ClockSettings,
    defaults: { date: true },
  },
  weather: {
    label: 'Météo',
    icon: 'cloudSun',
    description: 'Temps actuel et prévisions des prochains jours pour la ville de votre choix.',
    showTitle: false,
    group: 'Essentiels',
    Body: WeatherWidget,
    Settings: WeatherSettings,
    setupFirst: true,
  },
  agenda: {
    label: 'Agenda',
    icon: 'calendar',
    description: 'Prochains événements de vos agendas Google ou iCal, ou le mois en miniature.',
    showTitle: true,
    group: 'Essentiels',
    Body: AgendaWidget,
    Settings: AgendaSettings,
    defaults: { days: 14 },
  },
  tasks: {
    label: 'Tâches',
    icon: 'checkSquare',
    description: 'Liste de choses à faire, à cocher.',
    showTitle: true,
    group: 'Essentiels',
    Body: TasksWidget,
    Settings: TasksSettings,
  },
  search: {
    label: 'Recherche',
    icon: 'search',
    description: 'Barre de recherche sur le web (Google, DuckDuckGo, Qwant…) ou dans vos notes.',
    showTitle: false,
    group: 'Essentiels',
    Body: SearchWidget,
    Settings: SearchSettings,
  },
  note: {
    label: 'Note rapide',
    icon: 'pencil',
    description: 'Un bloc-notes façon post-it, enregistré à chaque frappe.',
    showTitle: true,
    group: 'Notes',
    Body: NoteWidget,
    Settings: NoteSettings,
    tint: (c) => NOTE_COLORS.find((n) => n.id && n.id === c.color)?.color,
  },
  page: {
    label: 'Page de notes',
    icon: 'note',
    description: 'Une de vos pages, affichée et modifiable directement sur l’accueil.',
    showTitle: false,
    group: 'Notes',
    Body: PageWidget,
    Settings: PageSettings,
    setupFirst: true,
  },
  pages: {
    label: 'Pages',
    icon: 'book',
    description: 'Accès rapide à vos pages ouvertes récemment, ou aux pages principales.',
    showTitle: true,
    group: 'Notes',
    Body: PagesWidget,
    Settings: PagesSettings,
    defaults: { mode: 'recent' },
  },
  cameras: {
    label: 'Caméras',
    icon: 'cctv',
    description: 'Vos caméras de surveillance en direct (toutes, ou une seule).',
    showTitle: true,
    group: 'Maison',
    Body: CamerasWidget,
    Settings: CamerasSettings,
  },
  smarthome: {
    label: 'Maison',
    icon: 'bulb',
    description: 'Lumières, prises, volets, chauffage… de Home Assistant.',
    showTitle: true,
    group: 'Maison',
    Body: SmartHomeWidget,
    Settings: SmartHomeSettings,
    defaults: { favoritesOnly: true },
  },
  homelab: {
    label: 'Homelab',
    icon: 'server',
    description: 'État de vos serveurs et applications (en ligne, processeur, mémoire…).',
    showTitle: true,
    group: 'Maison',
    Body: HomelabWidget,
  },
  links: {
    label: 'Raccourcis',
    icon: 'link',
    description: 'Vos sites préférés et pages de notes, en un clic.',
    showTitle: true,
    group: 'Web et médias',
    Body: LinksWidget,
    Settings: LinksSettings,
    setupFirst: true,
  },
  image: {
    label: 'Image',
    icon: 'image',
    description: 'Une photo ou une image, avec un lien facultatif.',
    showTitle: false,
    group: 'Web et médias',
    Body: ImageWidget,
    Settings: ImageSettings,
    setupFirst: true,
  },
  web: {
    label: 'Site web',
    icon: 'globe',
    description: 'Une page web intégrée (Grafana, Home Assistant, radar de pluie…).',
    showTitle: true,
    group: 'Web et médias',
    Body: WebWidget,
    Settings: WebSettings,
    setupFirst: true,
  },
};

export const WIDGET_GROUPS: WidgetDef['group'][] = ['Essentiels', 'Notes', 'Maison', 'Web et médias'];
