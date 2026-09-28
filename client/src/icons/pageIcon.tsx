// Icônes de pages : stockées sous la forme « svg:<nom>:<couleur> ».
import { Icon } from './Icon';
import { isIconName, type IconName } from './registry';
import { legacyEmojiIcon } from './legacy';

export const PAGE_COLORS = {
  default: { label: 'Par défaut', value: 'currentColor' },
  gray: { label: 'Gris', value: '#9b9b9b' },
  brown: { label: 'Marron', value: '#ba856f' },
  orange: { label: 'Orange', value: '#ffa344' },
  yellow: { label: 'Jaune', value: '#ffdc49' },
  green: { label: 'Vert', value: '#4dab9a' },
  blue: { label: 'Bleu', value: '#529cca' },
  purple: { label: 'Violet', value: '#9a6dd7' },
  pink: { label: 'Rose', value: '#e255a1' },
  red: { label: 'Rouge', value: '#ff7369' },
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
export const PAGE_ICON_CHOICES: { name: IconName; label: string }[] = ([
  { name: 'file', label: 'page document' },
  { name: 'note', label: 'note texte mémo' },
  { name: 'book', label: 'livre lecture' },
  { name: 'bookmark', label: 'marque-page favori' },
  { name: 'star', label: 'étoile favori' },
  { name: 'heart', label: 'cœur amour' },
  { name: 'sparkles', label: 'étincelles nouveau magie bienvenue' },
  { name: 'bulb', label: 'idée ampoule' },
  { name: 'flame', label: 'feu flamme urgent' },
  { name: 'zap', label: 'éclair énergie rapide' },
  { name: 'target', label: 'objectif cible' },
  { name: 'rocket', label: 'fusée projet lancement' },
  { name: 'flag', label: 'drapeau jalon' },
  { name: 'pin', label: 'épingle punaise' },
  { name: 'mapPin', label: 'lieu adresse localisation' },
  { name: 'calendar', label: 'calendrier agenda date' },
  { name: 'clock', label: 'horloge heure temps' },
  { name: 'checkSquare', label: 'tâche case à cocher' },
  { name: 'list', label: 'liste' },
  { name: 'folder', label: 'dossier classement' },
  { name: 'briefcase', label: 'travail valise bureau' },
  { name: 'home', label: 'maison accueil' },
  { name: 'globe', label: 'monde web internet voyage' },
  { name: 'map', label: 'carte voyage' },
  { name: 'compass', label: 'boussole exploration' },
  { name: 'music', label: 'musique' },
  { name: 'film', label: 'film cinéma' },
  { name: 'play', label: 'lecture vidéo' },
  { name: 'tv', label: 'télévision série' },
  { name: 'camera', label: 'photo appareil' },
  { name: 'image', label: 'image photo galerie' },
  { name: 'code', label: 'code développement programmation' },
  { name: 'terminal', label: 'terminal console' },
  { name: 'laptop', label: 'ordinateur portable' },
  { name: 'monitor', label: 'écran ordinateur' },
  { name: 'smartphone', label: 'téléphone mobile' },
  { name: 'server', label: 'serveur homelab' },
  { name: 'database', label: 'base de données' },
  { name: 'cloud', label: 'nuage cloud' },
  { name: 'sun', label: 'soleil été' },
  { name: 'moon', label: 'lune nuit' },
  { name: 'leaf', label: 'feuille nature plante' },
  { name: 'coffee', label: 'café pause' },
  { name: 'gift', label: 'cadeau anniversaire' },
  { name: 'trophy', label: 'trophée victoire' },
  { name: 'graduation', label: 'école diplôme études cours' },
  { name: 'wallet', label: 'portefeuille argent budget finances' },
  { name: 'cart', label: 'courses panier achat' },
  { name: 'lock', label: 'cadenas sécurité privé' },
  { name: 'key', label: 'clé mot de passe' },
  { name: 'bell', label: 'cloche notification rappel' },
  { name: 'message', label: 'message discussion' },
  { name: 'mail', label: 'e-mail courrier' },
  { name: 'user', label: 'personne profil contact' },
  { name: 'users', label: 'équipe groupe famille' },
  { name: 'tag', label: 'étiquette' },
  { name: 'wrench', label: 'outil réparation bricolage' },
  { name: 'gamepad', label: 'jeu manette gaming' },
  { name: 'ticket', label: 'billet ticket événement' },
  { name: 'shield', label: 'bouclier protection' },
  { name: 'chartBar', label: 'graphique statistiques' },
  { name: 'activity', label: 'activité santé sport' },
  { name: 'paperclip', label: 'trombone pièce jointe' },
  { name: 'smile', label: 'sourire humeur' },
] satisfies { name: IconName; label: string }[]).filter((c) => isIconName(c.name));
