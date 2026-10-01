import { useWorkspacePages, type WorkspaceStore } from '../lib/workspace';
import { Icon } from '../icons/Icon';
import { PageIcon } from '../icons/pageIcon';
import { t, locale } from '../lib/i18n';

type Props = { store: WorkspaceStore; onOpenPage: (id: string) => void };

export function TrashView({ store, onOpenPage }: Props) {
  useWorkspacePages(store);
  const items = store.trashed();
  return (
    <div className="nb-page nb-trash">
      <h1 className="nb-page-title-static">
        <Icon name="trash" size={34} /> {t('Corbeille')}
      </h1>
      <p className="nb-muted">{t('Les pages supprimées (et leurs sous-pages) restent ici jusqu’à suppression définitive.')}</p>
      {items.length === 0 ? (
        <div className="nb-empty">{t('La corbeille est vide.')}</div>
      ) : (
        <>
          <ul className="nb-trash-list">
            {items.map((p) => (
              <li key={p.id} className="nb-trash-item">
                <span className="nb-tree-icon">
                  <PageIcon icon={p.icon} size={16} />
                </span>
                <span className="nb-trash-title">{p.title || t('Sans titre')}</span>
                <span className="nb-muted nb-trash-date">{p.deletedAt ? new Date(p.deletedAt).toLocaleDateString(locale()) : ''}</span>
                <button
                  type="button"
                  className="nb-btn"
                  onClick={() => {
                    store.restore(p.id);
                    onOpenPage(p.id);
                  }}
                >
                  {t('Restaurer')}
                </button>
                <button
                  type="button"
                  className="nb-btn nb-btn--danger"
                  onClick={() => {
                    if (confirm(t('Supprimer définitivement « {title} » et ses sous-pages ?', { title: p.title || t('Sans titre') })))
                      store.destroy(p.id);
                  }}
                >
                  {t('Supprimer')}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="nb-btn nb-btn--danger"
            onClick={() => {
              if (confirm(t('Vider la corbeille ? Cette action est irréversible.'))) items.forEach((p) => store.destroy(p.id));
            }}
          >
            {t('Vider la corbeille')}
          </button>
        </>
      )}
    </div>
  );
}
