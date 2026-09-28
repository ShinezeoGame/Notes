import { useWorkspacePages, type WorkspaceStore } from '../lib/workspace';
import { Icon } from '../icons/Icon';
import { PageIcon } from '../icons/pageIcon';

type Props = { store: WorkspaceStore; onOpenPage: (id: string) => void };

export function TrashView({ store, onOpenPage }: Props) {
  useWorkspacePages(store);
  const items = store.trashed();
  return (
    <div className="nb-page nb-trash">
      <h1 className="nb-page-title-static">
        <Icon name="trash" size={34} /> Corbeille
      </h1>
      <p className="nb-muted">Les pages supprimées (et leurs sous-pages) restent ici jusqu’à suppression définitive.</p>
      {items.length === 0 ? (
        <div className="nb-empty">La corbeille est vide.</div>
      ) : (
        <>
          <ul className="nb-trash-list">
            {items.map((p) => (
              <li key={p.id} className="nb-trash-item">
                <span className="nb-tree-icon">
                  <PageIcon icon={p.icon} size={16} />
                </span>
                <span className="nb-trash-title">{p.title || 'Sans titre'}</span>
                <span className="nb-muted nb-trash-date">
                  {p.deletedAt ? new Date(p.deletedAt).toLocaleDateString('fr-FR') : ''}
                </span>
                <button
                  type="button"
                  className="nb-btn"
                  onClick={() => {
                    store.restore(p.id);
                    onOpenPage(p.id);
                  }}
                >
                  Restaurer
                </button>
                <button
                  type="button"
                  className="nb-btn nb-btn--danger"
                  onClick={() => {
                    if (confirm(`Supprimer définitivement « ${p.title || 'Sans titre'} » et ses sous-pages ?`)) store.destroy(p.id);
                  }}
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="nb-btn nb-btn--danger"
            onClick={() => {
              if (confirm('Vider la corbeille ? Cette action est irréversible.')) items.forEach((p) => store.destroy(p.id));
            }}
          >
            Vider la corbeille
          </button>
        </>
      )}
    </div>
  );
}
