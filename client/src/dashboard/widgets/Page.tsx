// Widget Page : une page de notes affichée et modifiable directement sur l'accueil (même éditeur que la section Notes).
import { useMemo } from 'react';
import { AppContext, useAppCtx } from '../../editor/context';
import { Editor } from '../../editor/Editor';
import { ownerAuth } from '../../lib/api';
import { useDocHandle } from '../../lib/hooks';
import { useSettings } from '../../lib/settings';
import { useWorkspacePages, type WorkspaceStore } from '../../lib/workspace';
import { pgRoom } from '../../lib/yjs';
import { Icon } from '../../icons/Icon';
import { PageIcon } from '../../icons/pageIcon';
import { str, type SettingsProps, type WidgetProps } from '../types';
import { t } from '../../lib/i18n';

/** Pages de l'espace (hors corbeille) dans l'ordre de l'arborescence, avec leur profondeur. */
export function pageOptions(store: WorkspaceStore): { id: string; title: string; depth: number }[] {
  const out: { id: string; title: string; depth: number }[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const p of store.children(parentId)) {
      out.push({ id: p.id, title: p.title || t('Sans titre'), depth });
      walk(p.id, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

export function PageWidget({ widget, store, openSettings, editing }: WidgetProps) {
  useWorkspacePages(store);
  const ctx = useAppCtx();
  const settings = useSettings();
  const pageId = str(widget.config.pageId);
  const page = pageId ? store.get(pageId) : undefined;
  const visible = Boolean(page && store.isVisible(pageId));
  const { handle, ready } = useDocHandle(visible ? pgRoom(settings.workspaceId, pageId) : null, ownerAuth(), true);
  // Liens et sous-pages créés depuis ce widget : rattachés à la page affichée.
  const pageCtx = useMemo(() => ({ ...ctx, currentPageId: pageId }), [ctx, pageId]);

  if (!visible) {
    return (
      <div className="w-empty">
        <Icon name="note" size={26} />
        {pageId ? <span className="w-muted">{t('Cette page a été supprimée.')}</span> : null}
        <button type="button" className="nb-btn nb-btn--sm" onClick={openSettings} disabled={editing}>
          {t('Choisir une page')}
        </button>
      </div>
    );
  }
  return (
    <div className="w-page">
      <div className="w-page-head">
        <button type="button" className="w-page-title" onClick={() => ctx.openPage(pageId)} title={t('Ouvrir dans Notes')}>
          <PageIcon icon={page!.icon} size={18} />
          <span>{page!.title || t('Sans titre')}</span>
        </button>
        <button
          type="button"
          className="nb-icon-btn nb-icon-btn--sm"
          onClick={() => ctx.openPage(pageId)}
          aria-label={t('Ouvrir dans Notes')}
          title={t('Ouvrir dans Notes')}
        >
          <Icon name="externalLink" size={14} />
        </button>
      </div>
      <div className="w-page-body">
        {handle && ready ? (
          <AppContext.Provider value={pageCtx}>
            <Editor key={handle.room} handle={handle} editable />
          </AppContext.Provider>
        ) : (
          <div className="w-muted w-page-loading">{t('Chargement…')}</div>
        )}
      </div>
    </div>
  );
}

export function PageSettings({ config, set, store }: SettingsProps) {
  useWorkspacePages(store);
  const options = pageOptions(store);
  return (
    <>
      <label className="nb-field">
        <span>{t('Page affichée')}</span>
        <select className="nb-input" value={str(config.pageId)} onChange={(e) => set({ pageId: e.target.value })}>
          <option value="">{t('Choisir…')}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {'  '.repeat(o.depth)}
              {o.title}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="nb-btn nb-btn--sm" onClick={() => set({ pageId: store.createPage('', t('Note de l’accueil')) })}>
        <Icon name="plus" size={14} /> {t('Nouvelle page')}
      </button>
    </>
  );
}
