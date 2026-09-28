import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, type AppContextValue, type CalendarImportResult } from './editor/context';
import { api, fileToDataUrl, ownerAuth, serverBase } from './lib/api';
import { useDocHandle, useMediaQuery } from './lib/hooks';
import { navigate, useRoute } from './lib/router';
import { getSettings, isNative, updateSettings, useSettings } from './lib/settings';
import { WorkspaceStore, useWorkspacePages } from './lib/workspace';
import { clearLocalDocs, pgRoom, useDocStatus, wsRoom } from './lib/yjs';
import { CalendarImportDialog } from './components/CalendarImportDialog';
import { Onboarding } from './components/Onboarding';
import { PageEditorPane } from './components/PageEditorPane';
import { SearchDialog } from './components/SearchDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { ShareDialog } from './components/ShareDialog';
import { SharedView } from './components/SharedView';
import { Sidebar, STATUS_LABEL } from './components/Sidebar';
import { ToastHost, toast } from './components/Toast';
import { TrashView } from './components/TrashView';

export default function App() {
  const route = useRoute();
  const settings = useSettings();
  let content;
  if (route.name === 'shared') content = <SharedView key={route.token} token={route.token} pageId={route.pageId} />;
  else if (route.name === 'join') content = <JoinView wsId={route.wsId} keyValue={route.key} />;
  else if (!settings.onboarded) content = <Onboarding />;
  else content = <OwnerApp />;
  return (
    <>
      {content}
      <ToastHost />
    </>
  );
}

function JoinView({ wsId, keyValue }: { wsId: string; keyValue: string }) {
  const apply = async () => {
    await clearLocalDocs();
    updateSettings({
      serverUrl: isNative() ? getSettings().serverUrl : location.origin,
      workspaceId: wsId,
      workspaceKey: keyValue,
      onboarded: true,
      lastPageId: null,
      expanded: {},
    });
    location.hash = '#/';
    location.reload();
  };
  return (
    <div className="nb-center">
      <div className="nb-card">
        <div className="nb-logo">N</div>
        <h1>Lier cet appareil</h1>
        <p className="nb-muted">
          Ce lien connecte cet appareil à un espace de travail existant. Les pages locales actuelles ne seront plus affichées ici.
        </p>
        <div className="nb-row nb-gap nb-end">
          <button type="button" className="nb-btn" onClick={() => navigate('#/')}>
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void apply()}>
            Lier cet appareil
          </button>
        </div>
      </div>
    </div>
  );
}

type Dialog = null | { type: 'search' } | { type: 'settings' } | { type: 'share'; pageId: string };

function OwnerApp() {
  const settings = useSettings();
  const route = useRoute();
  const wsHandle = useDocHandle(wsRoom(settings.workspaceId), ownerAuth(), true);
  const store = useMemo(() => (wsHandle.handle ? new WorkspaceStore(wsHandle.handle.doc) : null), [wsHandle.handle]);
  const status = useDocStatus(wsHandle.handle);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [calReq, setCalReq] = useState<{ initial?: { source?: string; title?: string }; resolve: (r: CalendarImportResult | null) => void } | null>(null);
  const pageId = route.name === 'page' ? route.pageId : null;

  useEffect(() => {
    if (!serverBase()) return;
    api.claim(settings.workspaceId, settings.workspaceKey).catch((err: { status?: number; message: string }) => {
      if (err.status === 403) toast(err.message, 'error');
    });
  }, [settings.workspaceId, settings.workspaceKey, settings.serverUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDialog({ type: 'search' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!store || !wsHandle.ready || route.name !== 'home') return;
    const last = getSettings().lastPageId;
    if (last && store.get(last) && store.isVisible(last)) {
      navigate({ name: 'page', pageId: last });
      return;
    }
    const roots = store.roots();
    if (roots.length) {
      navigate({ name: 'page', pageId: roots[0].id });
      return;
    }
    const id = store.createPage('', 'Bienvenue');
    store.update(id, { icon: '👋' });
    navigate({ name: 'page', pageId: id });
  }, [store, wsHandle.ready, route.name]);

  useEffect(() => {
    if (pageId) updateSettings({ lastPageId: pageId });
  }, [pageId]);

  const openPage = useCallback((id: string) => navigate({ name: 'page', pageId: id }), []);

  const createPage = useCallback(
    (parentId: string) => {
      if (!store) return;
      const id = store.createPage(parentId, '');
      openPage(id);
      setSidebarOpen(false);
    },
    [store, openPage],
  );

  const deletePage = useCallback(
    (id: string) => {
      if (!store) return;
      store.softDelete(id);
      if (pageId && (pageId === id || store.ancestors(pageId).some((a) => a.id === id))) navigate('#/');
      toast('Page déplacée dans la corbeille.');
    },
    [store, pageId],
  );

  const importCalendar = useCallback(
    (initial?: { source?: string; title?: string }) =>
      new Promise<CalendarImportResult | null>((resolve) => setCalReq({ initial, resolve })),
    [],
  );

  const uploadFile = useCallback(async (file: File) => {
    if (serverBase()) return (await api.upload(file, ownerAuth())).url;
    if (file.size > 15 * 1024 * 1024) {
      throw new Error('Fichier trop volumineux en mode hors ligne (15 Mo max). Configurez un serveur pour des fichiers plus lourds.');
    }
    return fileToDataUrl(file);
  }, []);

  const ctx: AppContextValue = useMemo(
    () => ({
      mode: 'owner',
      canEdit: true,
      currentPageId: pageId ?? '',
      getPage: (id) => {
        const p = store?.get(id);
        return p && !p.deleted ? { id, title: p.title, icon: p.icon } : undefined;
      },
      openPage,
      createSubpage: store ? async (parentId, title = '') => store.createPage(parentId, title) : null,
      uploadFile,
      fetchIcs: serverBase() ? (url) => api.fetchIcs(url, ownerAuth()).then((r) => r.text) : null,
      importCalendar,
      notify: toast,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, pageId, openPage, uploadFile, importCalendar, settings.serverUrl],
  );

  if (!store || !wsHandle.ready) {
    return <div className="nb-center nb-loading">Chargement de votre espace…</div>;
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="nb-app">
        <Sidebar
          store={store}
          currentPageId={pageId}
          status={status}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenPage={(id) => {
            openPage(id);
            setSidebarOpen(false);
          }}
          onNewPage={createPage}
          onOpenTrash={() => {
            navigate('#/trash');
            setSidebarOpen(false);
          }}
          onOpenSearch={() => setDialog({ type: 'search' })}
          onOpenSettings={() => setDialog({ type: 'settings' })}
          onShare={(id) => setDialog({ type: 'share', pageId: id })}
          onDelete={deletePage}
        />
        <main className="nb-main">
          <TopBar
            store={store}
            pageId={pageId}
            isTrash={route.name === 'trash'}
            status={status}
            showMenuButton={isMobile}
            onMenu={() => setSidebarOpen(true)}
            onShare={() => pageId && setDialog({ type: 'share', pageId })}
            onDelete={() => pageId && deletePage(pageId)}
            onOpenPage={openPage}
          />
          <div className="nb-content">
            {route.name === 'trash' ? (
              <TrashView store={store} onOpenPage={openPage} />
            ) : pageId ? (
              <OwnerPage key={pageId} store={store} pageId={pageId} onOpenPage={openPage} />
            ) : (
              <div className="nb-center nb-loading">Ouverture…</div>
            )}
          </div>
        </main>
      </div>

      {dialog?.type === 'search' ? <SearchDialog store={store} onClose={() => setDialog(null)} onOpen={openPage} /> : null}
      {dialog?.type === 'settings' ? <SettingsDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.type === 'share' ? (
        <ShareDialog
          pageId={dialog.pageId}
          pageTitle={store.get(dialog.pageId)?.title ?? ''}
          onClose={() => setDialog(null)}
          onOpenSettings={() => setDialog({ type: 'settings' })}
        />
      ) : null}
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

function TopBar(props: {
  store: WorkspaceStore;
  pageId: string | null;
  isTrash: boolean;
  status: ReturnType<typeof useDocStatus>;
  showMenuButton: boolean;
  onMenu: () => void;
  onShare: () => void;
  onDelete: () => void;
  onOpenPage: (id: string) => void;
}) {
  const { store, pageId } = props;
  useWorkspacePages(store);
  const [menuOpen, setMenuOpen] = useState(false);
  const page = pageId ? store.get(pageId) : undefined;
  const crumbs = pageId ? store.ancestors(pageId) : [];

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <header className="nb-topbar">
      {props.showMenuButton ? (
        <button type="button" className="nb-icon-btn" onClick={props.onMenu} aria-label="Menu">
          ☰
        </button>
      ) : null}
      <nav className="nb-crumbs">
        {props.isTrash ? (
          <span className="nb-crumb-current">Corbeille</span>
        ) : (
          <>
            {crumbs.map((c) => (
              <button key={c.id} type="button" onClick={() => props.onOpenPage(c.id)}>
                {c.icon ? `${c.icon} ` : ''}
                {c.title || 'Sans titre'}
              </button>
            ))}
            {page ? (
              <span className="nb-crumb-current">
                {page.icon ? `${page.icon} ` : ''}
                {page.title || 'Sans titre'}
              </span>
            ) : null}
          </>
        )}
      </nav>
      <div className="nb-topbar-right">
        <span className={`nb-status nb-status--${props.status} nb-only-mobile`} title={STATUS_LABEL[props.status]} />
        {page ? (
          <>
            <button type="button" className="nb-btn nb-btn--sm" onClick={props.onShare}>
              Partager
            </button>
            <div className="nb-menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
              <button type="button" className="nb-icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Plus d’options">
                ⋯
              </button>
              {menuOpen ? (
                <div className="nb-menu nb-menu--right">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/p/${page.id}`);
                      toast('Lien interne copié.');
                      setMenuOpen(false);
                    }}
                  >
                    📋 Copier le lien interne
                  </button>
                  <button
                    type="button"
                    className="nb-menu-danger"
                    onClick={() => {
                      props.onDelete();
                      setMenuOpen(false);
                    }}
                  >
                    🗑️ Supprimer la page
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}

function OwnerPage({ store, pageId, onOpenPage }: { store: WorkspaceStore; pageId: string; onOpenPage: (id: string) => void }) {
  useWorkspacePages(store);
  const settings = useSettings();
  const page = store.get(pageId);
  const { handle, ready } = useDocHandle(pgRoom(settings.workspaceId, pageId), ownerAuth(), true);

  useEffect(() => {
    document.title = page ? `${page.title || 'Sans titre'} – Notes` : 'Notes';
  }, [page?.title, page]);

  if (!page) {
    return (
      <div className="nb-center">
        <div className="nb-card">
          <h1>Page introuvable</h1>
          <p className="nb-muted">Cette page n’existe pas ou a été supprimée définitivement.</p>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => navigate('#/')}>
            Retour à l’accueil
          </button>
        </div>
      </div>
    );
  }

  const inTrash = !store.isVisible(pageId);
  const setTitle = (t: string) => {
    store.update(pageId, { title: t });
    handle?.doc.getMap('meta').set('title', t);
  };
  const setIcon = (i: string) => {
    store.update(pageId, { icon: i });
    handle?.doc.getMap('meta').set('icon', i);
  };
  const subpages = store.children(pageId).map((p) => ({ id: p.id, title: p.title, icon: p.icon }));

  return (
    <>
      {inTrash ? (
        <div className="nb-banner">
          Cette page est dans la corbeille.
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => store.restore(pageId)}>
            Restaurer
          </button>
        </div>
      ) : null}
      <PageEditorPane
        handle={handle}
        ready={ready}
        title={page.title}
        icon={page.icon}
        editable={!inTrash}
        onTitleChange={setTitle}
        onIconChange={setIcon}
        subpages={subpages}
        onOpenPage={onOpenPage}
        onCreateSubpage={() => {
          const id = store.createPage(pageId, '');
          onOpenPage(id);
        }}
      />
    </>
  );
}
