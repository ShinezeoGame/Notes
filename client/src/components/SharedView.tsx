import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, type AppContextValue, type CalendarImportResult } from '../editor/context';
import { api, type ShareTree } from '../lib/api';
import { useDocHandle, usePageMeta } from '../lib/hooks';
import { navigate } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { pgRoom, useDocStatus } from '../lib/yjs';
import { CalendarImportDialog } from './CalendarImportDialog';
import { PageEditorPane } from './PageEditorPane';
import { STATUS_LABEL } from './Sidebar';
import { toast } from './Toast';

type Props = { token: string; pageId: string | null };

export function SharedView({ token, pageId }: Props) {
  const settings = useSettings();
  const [tree, setTree] = useState<ShareTree | null>(null);
  const [error, setError] = useState('');
  const [calReq, setCalReq] = useState<{ initial?: { source?: string; title?: string }; resolve: (r: CalendarImportResult | null) => void } | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      setTree(await api.getShare(token));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lien indisponible.');
    }
  }, [token]);

  useEffect(() => {
    void refreshTree();
    const timer = setInterval(() => void refreshTree(), 30_000);
    return () => clearInterval(timer);
  }, [refreshTree]);

  const currentId = pageId ?? tree?.pageId ?? null;
  const room = tree && currentId ? pgRoom(tree.wsId, currentId) : null;
  const { handle, ready } = useDocHandle(room, { share: token }, false);
  const meta = usePageMeta(handle?.doc ?? null);
  const status = useDocStatus(handle);
  const canEdit = tree?.mode === 'edit' && status !== 'denied';
  const pageInfo = tree?.pages.find((p) => p.id === currentId);
  const title = meta.title || pageInfo?.title || '';
  const icon = meta.icon || pageInfo?.icon || '';

  useEffect(() => {
    document.title = `${title || 'Sans titre'} – Notes (partagé)`;
  }, [title]);

  const importCalendar = useCallback(
    (initial?: { source?: string; title?: string }) =>
      new Promise<CalendarImportResult | null>((resolve) => setCalReq({ initial, resolve })),
    [],
  );

  const ctx: AppContextValue = useMemo(
    () => ({
      mode: 'shared',
      canEdit,
      currentPageId: currentId ?? '',
      getPage: (id) => {
        const p = tree?.pages.find((x) => x.id === id);
        return p ? { id, title: p.title, icon: p.icon } : undefined;
      },
      openPage: (id) => navigate({ name: 'shared', token, pageId: id }),
      createSubpage: canEdit
        ? async (parentId, t = '') => {
            try {
              const { id } = await api.createSharedPage(token, parentId, t);
              await refreshTree();
              return id;
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Création impossible.', 'error');
              return null;
            }
          }
        : null,
      uploadFile: async (file) => (await api.upload(file, { share: token })).url,
      fetchIcs: canEdit ? (url) => api.fetchIcs(url, { share: token }).then((r) => r.text) : null,
      importCalendar,
      notify: toast,
    }),
    [canEdit, currentId, tree, token, refreshTree, importCalendar],
  );

  if (error) {
    return (
      <div className="nb-center">
        <div className="nb-card">
          <h1>Lien indisponible</h1>
          <p className="nb-muted">{error}</p>
          <a className="nb-btn nb-btn--primary" href="#/">
            Ouvrir mes notes
          </a>
        </div>
      </div>
    );
  }
  if (!tree) return <div className="nb-center nb-loading">Chargement de la page partagée…</div>;
  if (!pageInfo || !currentId) {
    return (
      <div className="nb-center">
        <div className="nb-card">
          <h1>Page introuvable</h1>
          <p className="nb-muted">Cette page ne fait pas (ou plus) partie du partage.</p>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => navigate({ name: 'shared', token, pageId: null })}>
            Revenir à la page partagée
          </button>
        </div>
      </div>
    );
  }

  const setTitle = (t: string) => {
    handle?.doc.getMap('meta').set('title', t);
    setTree((prev) => prev && { ...prev, pages: prev.pages.map((p) => (p.id === currentId ? { ...p, title: t } : p)) });
  };
  const setIcon = (i: string) => {
    handle?.doc.getMap('meta').set('icon', i);
    setTree((prev) => prev && { ...prev, pages: prev.pages.map((p) => (p.id === currentId ? { ...p, icon: i } : p)) });
  };

  const subpages = tree.pages
    .filter((p) => p.parentId === currentId)
    .sort((a, b) => a.order - b.order)
    .map((p) => ({ id: p.id, title: p.title, icon: p.icon }));

  const crumbs: { id: string; title: string }[] = [];
  let cur = pageInfo;
  let guard = 0;
  while (cur && cur.parentId && guard++ < 50) {
    const parent = tree.pages.find((p) => p.id === cur!.parentId);
    if (!parent) break;
    crumbs.unshift({ id: parent.id, title: parent.title || 'Sans titre' });
    cur = parent;
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="nb-app nb-app--shared">
        <main className="nb-main">
          <header className="nb-topbar">
            <nav className="nb-crumbs">
              {crumbs.map((c) => (
                <button key={c.id} type="button" onClick={() => navigate({ name: 'shared', token, pageId: c.id })}>
                  {c.title}
                </button>
              ))}
              <span className="nb-crumb-current">{title || 'Sans titre'}</span>
            </nav>
            <div className="nb-topbar-right">
              <span className={`nb-badge nb-badge--${tree.mode}`}>{tree.mode === 'edit' ? 'Modification en direct' : 'Lecture seule'}</span>
              <span className={`nb-status nb-status--${status}`} title={STATUS_LABEL[status]} />
              <input
                className="nb-input nb-input--sm nb-only-desktop"
                title="Votre nom (visible par les autres participants)"
                value={settings.userName}
                onChange={(e) => updateSettings({ userName: e.target.value })}
                maxLength={40}
              />
              <a className="nb-btn nb-btn--sm" href="#/" title="Créer mon propre espace de notes">
                Mes notes
              </a>
            </div>
          </header>
          {status === 'denied' ? <div className="nb-banner">Le serveur a refusé l’accès à cette page (lien révoqué ?).</div> : null}
          <div className="nb-content">
            <PageEditorPane
              handle={handle}
              ready={ready}
              title={title}
              icon={icon}
              narrow={meta.narrow}
              editable={canEdit}
              onTitleChange={setTitle}
              onIconChange={setIcon}
              subpages={subpages}
              onOpenPage={(id) => navigate({ name: 'shared', token, pageId: id })}
              onCreateSubpage={
                canEdit
                  ? () => {
                      void ctx.createSubpage?.(currentId, '').then((id) => id && navigate({ name: 'shared', token, pageId: id }));
                    }
                  : null
              }
            />
          </div>
        </main>
      </div>
      {calReq ? (
        <CalendarImportDialog
          initial={calReq.initial}
          onClose={() => {
            calReq.resolve(null);
            setCalReq(null);
          }}
          onResult={(res) => calReq.resolve(res)}
        />
      ) : null}
    </AppContext.Provider>
  );
}
