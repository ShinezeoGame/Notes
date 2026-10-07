// Widget « Papiers à renouveler » : passeport, contrôle technique, assurance… dont l'échéance est passée ou proche,
// du plus urgent au moins urgent ; sinon la prochaine échéance.
import { navigate } from '../../lib/router';
import { Icon } from '../../icons/Icon';
import { category, paperStatus, papersToRenew, usePapers } from '../../papers/model';
import { DueBadge, formatDate } from '../../papers/due';
import type { WidgetProps } from '../types';
import { t } from '../../lib/i18n';

export function PapersWidget({ doc, editing }: WidgetProps) {
  const papers = usePapers(doc);
  if (!papers.length) {
    return (
      <div className="w-empty">
        <Icon name="papers" size={24} />
        <span className="w-muted">{t('Rangez vos papiers importants : vous serez prévenu avant chaque échéance.')}</span>
        <button type="button" className="nb-btn nb-btn--sm" onClick={() => navigate('#/papiers/nouveau')} disabled={editing}>
          {t('Ajouter un papier')}
        </button>
      </div>
    );
  }
  const renew = papersToRenew(papers);
  const next = papers.filter((p) => paperStatus(p).kind === 'ok').sort((a, b) => a.expires.localeCompare(b.expires))[0];
  return (
    <div className="w-papers">
      {renew.length ? (
        renew.map((p) => (
          <button key={p.id} type="button" className="w-paper" onClick={() => navigate(`#/papiers/${p.id}`)} disabled={editing}>
            <Icon name={category(p.category).icon} size={16} />
            <span className="w-paper-body">
              <b>{p.person ? `${p.title} · ${p.person}` : p.title}</b>
              <DueBadge paper={p} />
            </span>
          </button>
        ))
      ) : (
        <p className="w-muted w-papers-none">
          <Icon name="checkCircle" size={16} /> {t('Rien à renouveler dans les prochains mois.')}
          {next ? <> {t('Prochaine échéance : {name}, le {date}.', { name: next.title, date: formatDate(next.expires) })}</> : null}
        </p>
      )}
      <button type="button" className="w-link-btn" onClick={() => navigate('#/papiers')}>
        {t('Ouvrir les papiers')} <Icon name="chevronRight" size={14} />
      </button>
    </div>
  );
}
