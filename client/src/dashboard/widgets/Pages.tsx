// Widget Pages : accès rapide aux pages de notes (ouvertes récemment sur cet appareil, ou pages principales).
import { useAppCtx } from '../../editor/context';
import { useSettings } from '../../lib/settings';
import { useWorkspacePages } from '../../lib/workspace';
import { navigate } from '../../lib/router';
import { Icon } from '../../icons/Icon';
import { PageIcon } from '../../icons/pageIcon';
import { str, type SettingsProps, type WidgetProps } from '../types';

export function PagesWidget({ widget, store }: WidgetProps) {
  useWorkspacePages(store);
  const ctx = useAppCtx();
  const settings = useSettings();
  const mode = str(widget.config.mode, 'recent');
  const visible = (id: string) => Boolean(store.get(id)) && store.isVisible(id);
  let pages = mode === 'recent' ? settings.recentPages.filter(visible).map((id) => store.get(id)!) : store.roots();
  // Aucune page récente sur cet appareil : pages principales.
  if (mode === 'recent' && !pages.length) pages = store.roots();

  return (
    <div className="w-pages">
      <ul className="w-pages-list">
        {pages.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => ctx.openPage(p.id)}>
              <PageIcon icon={p.icon} size={17} />
              <span>{p.title || 'Sans titre'}</span>
            </button>
          </li>
        ))}
      </ul>
      {!pages.length ? <p className="w-muted w-tasks-empty">Aucune page pour l’instant.</p> : null}
      <div className="w-pages-foot">
        <button
          type="button"
          className="w-link-btn"
          onClick={() => {
            const id = store.createPage('', '');
            ctx.openPage(id);
          }}
        >
          <Icon name="plus" size={14} /> Nouvelle page
        </button>
        <button type="button" className="w-link-btn" onClick={() => navigate('#/notes')}>
          Toutes les notes <Icon name="chevronRight" size={14} />
        </button>
      </div>
    </div>
  );
}

export function PagesSettings({ config, set }: SettingsProps) {
  return (
    <label className="nb-field">
      <span>Pages affichées</span>
      <select className="nb-input" value={str(config.mode, 'recent')} onChange={(e) => set({ mode: e.target.value })}>
        <option value="recent">Ouvertes récemment (sur cet appareil)</option>
        <option value="roots">Pages principales</option>
      </select>
    </label>
  );
}
