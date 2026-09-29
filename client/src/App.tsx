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
import { UpdateBanner } from './components/UpdateBanner';
import { startUpdateChecks } from './lib/updates';
import { TrashView } from './components/TrashView';
import { HomelabPanel } from './components/HomelabView';
import { SmartHomeView } from './components/SmartHomeView';
import { HomelabConfigDialog } from './components/HomelabConfigDialog';
import { cardLayout, configStatusKey, resetCardSizes, saveCardSize, useHomelabConfig } from './lib/homelab';
import { Icon } from './icons/Icon';
import { PageIcon, encodePageIcon } from './icons/pageIcon';

export default function App() {
  const route = useRoute();
  const settings = useSettings();
  let content;
  if (route.name === 'shared') content = <SharedView key={route.token} token={route.token} pageId={route.pageId} />;
  else if (route.name === 'join') content = <JoinView wsId={route.wsId} keyValue={route.key} />;
  else if (!settings.onboarded) content = <Onboarding />;
  else content = <OwnerApp />;
  useEffect(() => startUpdateChecks(), []);
  return (
    <>
      {content}
      <UpdateBanner />
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

type Dialog = null | { type: 'search' } | { type: 'settings' } | { type: 'share'; pageId: string } | { type: 'homelab' };

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
    store.update(id, { icon: encodePageIcon('sparkles', 'yellow') });
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

  const homelabConfigured = useHomelabConfiguredFlag(wsHandle.handle?.doc ?? null);

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
      openDashboard: () => navigate('#/dashboard'),
      openSmartHome: () => navigate('#/maison'),
      homelabConfigured,
      workspaceDoc: store?.doc ?? null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, pageId, openPage, uploadFile, importCalendar, settings.serverUrl, homelabConfigured],
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
          onOpenDashboard={() => {
            navigate('#/dashboard');
            setSidebarOpen(false);
          }}
          onOpenSmartHome={() => {
            navigate('#/maison');
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
            isDashboard={route.name === 'dashboard'}
            isSmartHome={route.name === 'smarthome'}
            status={status}
            showMenuButton={isMobile}
            onMenu={() => setSidebarOpen(true)}
            onShare={() => pageId && setDialog({ type: 'share', pageId })}
            onDelete={() => pageId && deletePage(pageId)}
            onOpenPage={openPage}
          />
          {status === 'denied' ? (
            <div className="nb-banner nb-banner--error">
              Cet appareil n’est pas relié à l’espace de ce serveur : vos modifications restent sur l’appareil. Ouvrez le lien « Lier un
              autre appareil » copié depuis un appareil déjà connecté.
              <button type="button" className="nb-btn nb-btn--sm" onClick={() => setDialog({ type: 'settings' })}>
                Réglages
              </button>
            </div>
          ) : null}
          <div className="nb-content">
            {route.name === 'trash' ? (
              <TrashView store={store} onOpenPage={openPage} />
            ) : route.name === 'dashboard' ? (
              <DashboardView doc={store.doc} onConfigure={() => setDialog({ type: 'homelab' })} />
            ) : route.name === 'smarthome' ? (
              <SmartHomeView doc={store.doc} />
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
      {dialog?.type === 'homelab' ? <HomelabConfigDialog doc={store.doc} onClose={() => setDialog(null)} /> : null}
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
  isDashboard?: boolean;
  isSmartHome?: boolean;
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
          <Icon name="menu" size={18} />
        </button>
      ) : null}
      <nav className="nb-crumbs">
        {props.isTrash ? (
          <span className="nb-crumb-current">Corbeille</span>
        ) : props.isSmartHome ? (
          <span className="nb-crumb-current">
            <Icon name="bulb" size={15} /> Maison
          </span>
        ) : props.isDashboard ? (
          <span className="nb-crumb-current">
            <Icon name="home" size={15} /> Homelab
          </span>
        ) : (
          <>
            {crumbs.map((c) => (
              <button key={c.id} type="button" onClick={() => props.onOpenPage(c.id)}>
                <PageIcon icon={c.icon} size={15} fallback={null} />
                {c.title || 'Sans titre'}
              </button>
            ))}
            {page ? (
              <span className="nb-crumb-current">
                <PageIcon icon={page.icon} size={15} fallback={null} />
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
                <Icon name="dots" size={18} />
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
                    <Icon name="copy" size={16} /> Copier le lien interne
                  </button>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={!page.narrow}
                    onClick={() => store.update(page.id, { narrow: !page.narrow })}
                  >
                    <Icon name="width" size={16} /> Pleine largeur
                    <span className={`nb-switch${page.narrow ? '' : ' nb-switch--on'}`} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="nb-menu-danger"
                    onClick={() => {
                      props.onDelete();
                      setMenuOpen(false);
                    }}
                  >
                    <Icon name="trash" size={16} /> Supprimer la page
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

  // Les invités d'un lien de partage lisent la largeur dans le document de la page.
  const narrowFlag = Boolean(page?.narrow);
  useEffect(() => {
    const meta = ready ? handle?.doc.getMap('meta') : undefined;
    if (meta && Boolean(meta.get('narrow')) !== narrowFlag) meta.set('narrow', narrowFlag);
  }, [handle, ready, narrowFlag]);

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
        narrow={page.narrow}
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

function useHomelabConfiguredFlag(doc: import('yjs').Doc | null): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    if (!doc) return;
    const map = doc.getMap('homelab');
    const read = () => {
      try {
        const cfg = JSON.parse(String(map.get('config') ?? '{}')) as { services?: unknown[]; devices?: unknown[] };
        setFlag(Boolean(cfg.services?.length || cfg.devices?.length));
      } catch {
        setFlag(false);
      }
    };
    map.observe(read);
    read();
    return () => map.unobserve(read);
  }, [doc]);
  return flag;
}

function DashboardView({ doc, onConfigure }: { doc: import('yjs').Doc; onConfigure: () => void }) {
  const cfg = useHomelabConfig(doc);
  const configured = cfg.services.length > 0 || cfg.devices.length > 0;
  useEffect(() => {
    document.title = 'Homelab – Notes';
  }, []);
  return (
    <div className="nb-page hl-page">
      <h1 className="nb-page-title-static">
        <Icon name="home" size={34} /> Homelab
      </h1>
      <HomelabPanel
        refreshSeconds={cfg.refreshSeconds}
        onConfigure={onConfigure}
        configured={configured}
        layout={cardLayout(cfg)}
        onResize={(id, size) => saveCardSize(doc, id, size)}
        onResetLayout={() => resetCardSizes(doc)}
        refreshKey={configStatusKey(cfg)}
      />
    </div>
  );
}
