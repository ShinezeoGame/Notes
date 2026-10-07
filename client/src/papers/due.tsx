// Échéance d'un papier, en mots et en pastille de couleur (section Papiers, widget de l'accueil).
import { paperStatus, type Paper } from './model';
import { t, tn, locale } from '../lib/i18n';

const dateFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
/** Date d'un jour AAAA-MM-JJ (« 12 mars 2027 »). */
export const formatDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
};

/** Texte de l'échéance d'un papier (« Expire dans 3 mois », « Expiré depuis le… »). */
export function dueLabel(p: Paper): string {
  const s = paperStatus(p);
  if (s.kind === 'none') return '';
  if (s.kind === 'expired') return t('Expiré depuis le {date}', { date: formatDate(p.expires) });
  if (s.days === 0) return t('Expire aujourd’hui');
  if (s.days === 1) return t('Expire demain');
  if (s.kind === 'ok') return t('Expire le {date}', { date: formatDate(p.expires) });
  if (s.days < 60) return tn(s.days, 'Expire dans {n} jour', 'Expire dans {n} jours');
  const months = Math.round(s.days / 30);
  return tn(months, 'Expire dans {n} mois', 'Expire dans {n} mois');
}

/** Pastille de l'échéance (couleur selon l'urgence). */
export function DueBadge({ paper }: { paper: Paper }) {
  const s = paperStatus(paper);
  if (s.kind === 'none') return null;
  return <span className={`pp-due pp-due--${s.kind}`}>{dueLabel(paper)}</span>;
}

