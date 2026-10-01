// Icônes de pages : stockées sous la forme « svg:<nom>:<couleur> ».
import { Icon } from './Icon';
import { isIconName, type IconName } from './registry';
import { legacyEmojiIcon } from './legacy';
import { t } from '../lib/i18n';

export const PAGE_COLORS = {
  default: { label: t('Par défaut'), value: 'currentColor' },
  gray: { label: t('Gris'), value: '#9b9b9b' },
  brown: { label: t('Marron'), value: '#ba856f' },
  orange: { label: t('Orange'), value: '#ffa344' },
  yellow: { label: t('Jaune'), value: '#ffdc49' },
  green: { label: t('Vert'), value: '#4dab9a' },
  blue: { label: t('Bleu'), value: '#529cca' },
  purple: { label: t('Violet'), value: '#9a6dd7' },
  pink: { label: t('Rose'), value: '#e255a1' },
  red: { label: t('Rouge'), value: '#ff7369' },
} as const;

export type PageColor = keyof typeof PAGE_COLORS;

export const isPageColor = (c: string): c is PageColor => Object.prototype.hasOwnProperty.call(PAGE_COLORS, c);

export type ResolvedPageIcon = { kind: 'svg'; name: IconName; color: PageColor } | { kind: 'img'; src: string } | { kind: 'none' };

export function encodePageIcon(name: IconName, color: PageColor = 'default'): string {
  return `svg:${name}:${color}`;
}

export function resolvePageIcon(value: string | null | undefined): ResolvedPageIcon {
  const v = (value ?? '').trim();
  if (!v) return { kind: 'none' };
  if (v.startsWith('svg:')) {
    const [, name = '', color = 'default'] = v.split(':');
    return isIconName(name) ? { kind: 'svg', name, color: isPageColor(color) ? color : 'default' } : { kind: 'svg', name: 'file', color: 'default' };
  }
  if (/^(https?:\/\/|data:image\/)/.test(v)) return { kind: 'img', src: v };
  if (isIconName(v)) return { kind: 'svg', name: v, color: 'default' };
  const legacy = legacyEmojiIcon(v);
  if (legacy) return { kind: 'svg', name: legacy[0], color: legacy[1] ?? 'default' };
  return { kind: 'svg', name: 'file', color: 'default' };
}

type Props = {
  icon: string | null | undefined;
  size?: number;
  /** Icône affichée quand la page n'en a pas (null = rien). */
  fallback?: IconName | null;
  className?: string;
};

/** Affiche l'icône d'une page (SVG coloré, image, ou icône de document par défaut). */
export function PageIcon({ icon, size = 16, fallback = 'file', className }: Props) {
  const res = resolvePageIcon(icon);
  if (res.kind === 'img') {
    return <img className={`nb-page-img-icon${className ? ` ${className}` : ''}`} src={res.src} alt="" width={size} height={size} />;
  }
  if (res.kind === 'none') {
    return fallback ? <Icon name={fallback} size={size} className={`nb-icon-muted${className ? ` ${className}` : ''}`} /> : null;
  }
  return <Icon name={res.name} size={size} className={className} style={{ color: PAGE_COLORS[res.color].value }} />;
}

/** Icônes proposées dans le sélecteur de page, avec mots-clés de recherche. */
export const PAGE_ICON_CHOICES: { name: IconName; label: string }[] = (
  [
    { name: 'file', label: t('page document') },
    { name: 'note', label: t('note texte mémo') },
    { name: 'book', label: t('livre lecture') },
    { name: 'bookmark', label: t('marque-page favori') },
    { name: 'star', label: t('étoile favori') },
    { name: 'heart', label: t('cœur amour') },
    { name: 'sparkles', label: t('étincelles nouveau magie bienvenue') },
    { name: 'bulb', label: t('idée ampoule') },
    { name: 'flame', label: t('feu flamme urgent') },
    { name: 'zap', label: t('éclair énergie rapide') },
    { name: 'target', label: t('objectif cible') },
    { name: 'rocket', label: t('fusée projet lancement') },
    { name: 'flag', label: t('drapeau jalon') },
    { name: 'pin', label: t('épingle punaise') },
    { name: 'mapPin', label: t('lieu adresse localisation') },
    { name: 'calendar', label: t('calendrier agenda date') },
    { name: 'clock', label: t('horloge heure temps') },
    { name: 'checkSquare', label: t('tâche case à cocher') },
    { name: 'list', label: t('liste') },
    { name: 'folder', label: t('dossier classement') },
    { name: 'briefcase', label: t('travail valise bureau') },
    { name: 'home', label: t('maison accueil') },
    { name: 'globe', label: t('monde web internet voyage') },
    { name: 'map', label: t('carte voyage') },
    { name: 'compass', label: t('boussole exploration') },
    { name: 'music', label: t('musique') },
    { name: 'film', label: t('film cinéma') },
    { name: 'play', label: t('lecture vidéo') },
    { name: 'tv', label: t('télévision série') },
    { name: 'camera', label: t('photo appareil') },
    { name: 'image', label: t('image photo galerie') },
    { name: 'code', label: t('code développement programmation') },
    { name: 'terminal', label: t('terminal console') },
    { name: 'laptop', label: t('ordinateur portable') },
    { name: 'monitor', label: t('écran ordinateur') },
    { name: 'smartphone', label: t('téléphone mobile') },
    { name: 'server', label: t('serveur homelab') },
    { name: 'database', label: t('base de données') },
    { name: 'cloud', label: t('nuage cloud') },
    { name: 'sun', label: t('soleil été') },
    { name: 'moon', label: t('lune nuit') },
    { name: 'leaf', label: t('feuille nature plante') },
    { name: 'coffee', label: t('café pause') },
    { name: 'gift', label: t('cadeau anniversaire') },
    { name: 'trophy', label: t('trophée victoire') },
    { name: 'graduation', label: t('école diplôme études cours') },
    { name: 'wallet', label: t('portefeuille argent budget finances') },
    { name: 'cart', label: t('courses panier achat') },
    { name: 'lock', label: t('cadenas sécurité privé') },
    { name: 'key', label: t('clé mot de passe') },
    { name: 'bell', label: t('cloche notification rappel') },
    { name: 'message', label: t('message discussion') },
    { name: 'mail', label: t('e-mail courrier') },
    { name: 'user', label: t('personne profil contact') },
    { name: 'users', label: t('équipe groupe famille') },
    { name: 'tag', label: t('étiquette') },
    { name: 'wrench', label: t('outil réparation bricolage') },
    { name: 'gamepad', label: t('jeu manette gaming') },
    { name: 'ticket', label: t('billet ticket événement') },
    { name: 'shield', label: t('bouclier protection') },
    { name: 'chartBar', label: t('graphique statistiques') },
    { name: 'activity', label: t('activité santé sport') },
    { name: 'paperclip', label: t('trombone pièce jointe') },
    { name: 'smile', label: t('sourire humeur') },
  ] satisfies { name: IconName; label: string }[]
).filter((c) => isIconName(c.name));
