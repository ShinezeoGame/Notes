import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, type AppContextValue, type CalendarImportResult } from './editor/context';
import { api, fileToDataUrl, ownerAuth, serverBase } from './lib/api';
import { useDocHandle, useMediaQuery } from './lib/hooks';
import { navigate, useRoute, type Route } from './lib/router';
import { getSettings, isNative, updateSettings, useSettings } from './lib/settings';
import { WorkspaceStore, useWorkspacePages } from './lib/workspace';
import { clearLocalDocs, pgRoom, useDocStatus, useDocSynced, wsRoom } from './lib/yjs';
import { applyAppearance, useAppearance, type Appearance, type SectionId } from './lib/appearance';
import { AgendaView } from './components/AgendaView';
import { AppNav, SECTIONS, statusLabel } from './components/AppNav';
import { AppearancePanel } from './components/AppearancePanel';
import { CalendarImportDialog } from './components/CalendarImportDialog';
import { Onboarding } from './components/Onboarding';
import { WelcomeDialog } from './components/Welcome';
import { PageEditorPane } from './components/PageEditorPane';
import { PagesPanel } from './components/PagesPanel';
import { SearchDialog } from './components/SearchDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { ShareDialog } from './components/ShareDialog';
import { SharedView } from './components/SharedView';
import { ToastHost, toast } from './components/Toast';
import { UpdateBanner } from './components/UpdateBanner';
import { Wallpaper } from './components/Wallpaper';
import { applyUpdate, startUpdateChecks } from './lib/updates';
import { TrashView } from './components/TrashView';
import { HomelabPanel } from './components/HomelabView';
import { SmartHomeView } from './components/SmartHomeView';
import { CamerasView } from './components/CamerasView';
import { InviteView, JoinDialog, PairView } from './components/LinkDevice';
import { HomelabConfigDialog } from './components/HomelabConfigDialog';
import { Dashboard } from './dashboard/Dashboard';
import { cardLayout, cardOrder, configStatusKey, resetCardSizes, saveCardOrder, saveCardSize, useHomelabConfig } from './lib/homelab';
import { Icon } from './icons/Icon';
import { PageIcon, encodePageIcon } from './icons/pageIcon';
import { MeloLogo } from './components/Logo';

// Atelier PDF : chargé seulement quand on l'ouvre (bibliothèques PDF volumineuses).
const PdfApp = lazy(() => import('./pdf/PdfApp'));

export default function App() {
  const route = useRoute();
  const settings = useSettings();
  let content;
  if (route.name === 'shared') content = <SharedView key={route.token} token={route.token} pageId={route.pageId} />;
  else if (route.name === 'join') content = <JoinView wsId={route.wsId} keyValue={route.key} />;
  else if (route.name === 'pair') content = <PairView code={route.code} />;
  else if (route.name === 'invite') content = <InviteView token={route.token} />;
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
        <MeloLogo size={48} className="nb-logo" />
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

/** Sections reliées au réseau du serveur, absentes d'un espace créé par une invitation. */
const HOST_SECTIONS: SectionId[] = ['smarthome', 'cameras', 'homelab'];

type Dialog =
  | null
  | { type: 'search' }
  | { type: 'settings' }
  | { type: 'share'; pageId: string }
  | { type: 'homelab' }
  | { type: 'link' }
  | { type: 'appearance' }
  | { type: 'tour' };

/** Section de la navigation à laquelle appartient une adresse. */
function sectionOf(route: Route): SectionId {
  switch (route.name) {
    case 'notes':
    case 'page':
    case 'trash':
      return 'notes';
    case 'agenda':
    case 'homelab':
    case 'smarthome':
    case 'cameras':
    case 'pdf':
      return route.name;
    default:
      return 'home';
  }
}

/** Téléphone : un champ de saisie a le focus (clavier affiché), la barre d'onglets est masquée. */
function useTyping(enabled: boolean): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const el = document.activeElement as HTMLElement | null;
      const field = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      setTyping(Boolean(field && !/^(checkbox|radio|range|button|color|file)$/.test((el as HTMLInputElement).type ?? '')));
    };
    const later = () => setTimeout(check, 0);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', later);
    };
  }, [enabled]);
  return enabled && typing;
}

function OwnerApp() {
  const settings = useSettings();
  const route = useRoute();
  const wsHandle = useDocHandle(wsRoom(settings.workspaceId), ownerAuth(), true);
  const store = useMemo(() => (wsHandle.handle ? new WorkspaceStore(wsHandle.handle.doc) : null), [wsHandle.handle]);
  const status = useDocStatus(wsHandle.handle);
  const synced = useDocSynced(wsHandle.handle);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const typing = useTyping(isMobile);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [calReq, setCalReq] = useState<{ initial?: { source?: string; title?: string }; resolve: (r: CalendarImportResult | null) => void } | null>(null);
  const pageId = route.name === 'page' ? route.pageId : null;
  const pdfId = route.name === 'pdf' ? route.pdfId : null;
  const section = sectionOf(route);

  // Apparence de l'espace (ou réglages en cours d'essai dans « Personnaliser »).
  const appearance = useAppearance(wsHandle.ready ? (store?.doc ?? null) : null);
  const [preview, setPreview] = useState<Appearance | null>(null);
  const look = preview ?? appearance;
  useEffect(() => applyAppearance(look), [look]);

  useEffect(() => {
    if (!serverBase()) return;
    api.claim(settings.workspaceId, settings.workspaceKey).then(
      // Espace créé par une invitation (sans maison, caméras ni homelab) : retenu pour les prochains démarrages.
      (r) => typeof r.guest === 'boolean' && r.guest !== getSettings().guest && updateSettings({ guest: r.guest }),
      (err: { status?: number; message: string }) => {
        if (err.status === 403) toast(err.message, 'error');
      },
    );
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

  // Section Notes : page de bienvenue dans un espace encore vide ; sur ordinateur, la dernière page ouverte (ou la
  // première) s'affiche à côté de la liste.
  useEffect(() => {
    if (!store || !wsHandle.ready || route.name !== 'notes') return;
    const last = getSettings().lastPageId;
    let target = last && store.get(last) && store.isVisible(last) ? last : store.roots()[0]?.id;
    if (!target && synced && !store.getSnapshot().length) {
      target = store.createPage('', 'Bienvenue');
      store.update(target, { icon: encodePageIcon('sparkles', 'yellow') });
    }
    if (target && !isMobile) navigate({ name: 'page', pageId: target }, { replace: true });
  }, [store, wsHandle.ready, route.name, isMobile, synced]);

  useEffect(() => {
    if (!pageId) return;
    const recent = [pageId, ...getSettings().recentPages.filter((id) => id !== pageId)].slice(0, 20);
    updateSettings({ lastPageId: pageId, recentPages: recent });
  }, [pageId]);

  const openPage = useCallback((id: string) => navigate({ name: 'page', pageId: id }), []);

  const createPage = useCallback(
    (parentId: string) => {
      if (!store) return;
      openPage(store.createPage(parentId, ''));
    },
    [store, openPage],
  );

  const deletePage = useCallback(
    (id: string) => {
      if (!store) return;
      store.softDelete(id);
      if (pageId && (pageId === id || store.ancestors(pageId).some((a) => a.id === id))) navigate('#/notes');
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
  const pdfName = usePdfName(wsHandle.handle?.doc ?? null, pdfId);

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
      openDashboard: () => navigate('#/homelab'),
      openSmartHome: () => navigate('#/maison'),
      openCameras: () => navigate('#/cameras'),
      homelabConfigured,
      workspaceDoc: store?.doc ?? null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, pageId, openPage, uploadFile, importCalendar, settings.serverUrl, homelabConfigured],
  );

  if (!store || !wsHandle.ready) {
    return <div className="nb-center nb-loading">Chargement de votre espace…</div>;
  }

  const goSection = (id: SectionId) => navigate(SECTIONS[id].hash);
  const wallpaper = look.wallpaper.kind !== 'none' && (section === 'home' || look.wallpaper.everywhere);
  const pagesColumn = section === 'notes' && !isMobile && !settings.pagesHidden;
  // Téléphone : liste des pages en plein écran (section Notes) ; accueil sans barre du haut.
  const mobileList = isMobile && route.name === 'notes';
  const showTopBar = section !== 'home' && !mobileList;
  const pagesPanel = (full: boolean) => (
    <PagesPanel
      store={store}
      currentPageId={pageId}
      full={full}
      onOpenPage={openPage}
      onNewPage={createPage}
      onOpenTrash={() => navigate('#/trash')}
      onOpenSearch={() => setDialog({ type: 'search' })}
      onShare={(id) => setDialog({ type: 'share', pageId: id })}
      onDelete={deletePage}
    />
  );

  let content;
  if (route.name === 'trash') content = <TrashView store={store} onOpenPage={openPage} />;
  else if (route.name === 'agenda') content = <AgendaView doc={store.doc} />;
  else if (route.name === 'homelab') content = <HomelabSection doc={store.doc} onConfigure={() => setDialog({ type: 'homelab' })} />;
  else if (route.name === 'smarthome') content = <SmartHomeView doc={store.doc} />;
  else if (route.name === 'cameras') content = <CamerasView doc={store.doc} />;
  else if (route.name === 'pdf')
    content = (
      <Suspense fallback={<div className="nb-center nb-loading">Chargement de l’atelier PDF…</div>}>
        <PdfApp doc={store.doc} pdfId={pdfId} />
      </Suspense>
    );
  else if (pageId) content = <OwnerPage key={pageId} store={store} pageId={pageId} onOpenPage={openPage} />;
  else if (mobileList) content = pagesPanel(true);
  else if (route.name === 'notes') content = <NotesEmpty store={store} onCreate={() => createPage('')} />;
  else
    content = (
      <Dashboard doc={store.doc} store={store} synced={synced} gap={look.gap} onCustomize={() => setDialog({ type: 'appearance' })} />
    );

  const nav = (
    <AppNav
      active={section}
      sections={look.sections}
      hidden={settings.guest ? [...look.hidden, ...HOST_SECTIONS] : look.hidden}
      status={status}
      mobile={isMobile}
      onNavigate={goSection}
      onSearch={() => setDialog({ type: 'search' })}
      onSettings={() => setDialog({ type: 'settings' })}
      onCustomize={() => setDialog({ type: 'appearance' })}
    />
  );

  return (
    <AppContext.Provider value={ctx}>
      <div className={`nb-app nb-app--${section}${wallpaper ? ' nb-app--wallpaper' : ''}${isMobile ? ' nb-app--mobile' : ''}`}>
        {wallpaper ? <Wallpaper appearance={look} /> : null}
        {!isMobile ? nav : null}
        {pagesColumn ? pagesPanel(false) : null}
        <main className="nb-main">
          {showTopBar ? (
            <TopBar
              store={store}
              route={route}
              section={section}
              pdfName={pdfName}
              status={status}
              mobile={isMobile}
              pagesHidden={settings.pagesHidden}
              onTogglePages={() => updateSettings({ pagesHidden: !getSettings().pagesHidden })}
              onShare={() => pageId && setDialog({ type: 'share', pageId })}
              onDelete={() => pageId && deletePage(pageId)}
              onOpenPage={openPage}
            />
          ) : null}
          {status === 'outdated' ? (
            <div className="nb-banner nb-banner--error">
              Cette page utilise une nouveauté de Melo (colonnes, caméras…) : mettez l’application à jour pour la synchroniser. Vos modifications restent
              sur l’appareil en attendant.
              <button type="button" className="nb-btn nb-btn--sm nb-btn--primary" onClick={() => void applyUpdate()}>
                Mettre à jour
              </button>
            </div>
          ) : null}
          {status === 'denied' ? (
            <div className="nb-banner nb-banner--error">
              Cet appareil n’est pas relié à l’espace de ce serveur : vos modifications restent sur l’appareil. Reliez‑le avec le code à 6 chiffres
              affiché dans les réglages d’un appareil déjà connecté.
              <button type="button" className="nb-btn nb-btn--sm nb-btn--primary" onClick={() => setDialog({ type: 'link' })}>
                Saisir un code
              </button>
            </div>
          ) : null}
          <div className="nb-content">{content}</div>
        </main>
        {isMobile && !typing ? nav : null}
      </div>

      {dialog?.type === 'search' ? <SearchDialog store={store} onClose={() => setDialog(null)} onOpen={openPage} /> : null}
      {dialog?.type === 'settings' ? <SettingsDialog onClose={() => setDialog(null)} onTour={() => setDialog({ type: 'tour' })} /> : null}
      {dialog?.type === 'homelab' ? <HomelabConfigDialog doc={store.doc} onClose={() => setDialog(null)} /> : null}
      {dialog?.type === 'link' ? <JoinDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.type === 'tour' ? <WelcomeDialog doc={store.doc} appearance={appearance} tourOnly onClose={() => setDialog(null)} /> : null}
      {settings.firstRun && !dialog ? <WelcomeDialog doc={store.doc} appearance={appearance} tourOnly={false} onClose={() => undefined} /> : null}
      {dialog?.type === 'appearance' ? (
        <AppearancePanel doc={store.doc} appearance={appearance} onPreview={setPreview} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.type === 'share' ? (
        <ShareDialog
          pageId={dialog.pageId}
          pageTitle={store.get(dialog.pageId)?.title ?? ''}
          onClose={() => setDialog(null)}
          onJoin={() => setDialog({ type: 'link' })}
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

/** Section Notes sans page ouverte (aucune page encore, ou liste masquée). */
function NotesEmpty({ store, onCreate }: { store: WorkspaceStore; onCreate: () => void }) {
  useWorkspacePages(store);
  useEffect(() => {
    document.title = 'Notes – Melo';
  }, []);
  return (
    <div className="nb-center-pane">
      <div className="nb-notice sh-empty">
        <Icon name="note" size={28} />
        <p>{store.roots().length ? 'Choisissez une page dans la liste.' : 'Aucune page pour l’instant : créez votre première page de notes.'}</p>
        <button type="button" className="nb-btn nb-btn--primary" onClick={onCreate}>
          <Icon name="plus" size={15} /> Nouvelle page
        </button>
      </div>
    </div>
  );
}

function TopBar(props: {
  store: WorkspaceStore;
  route: Route;
  section: SectionId;
  pdfName: string;
  status: ReturnType<typeof useDocStatus>;
  mobile: boolean;
  pagesHidden: boolean;
  onTogglePages: () => void;
  onShare: () => void;
  onDelete: () => void;
  onOpenPage: (id: string) => void;
}) {
  const { store, route, section } = props;
  useWorkspacePages(store);
  const [menuOpen, setMenuOpen] = useState(false);
  const pageId = route.name === 'page' ? route.pageId : null;
  const page = pageId ? store.get(pageId) : undefined;
  const crumbs = pageId ? store.ancestors(pageId) : [];

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const back = () => {
    const parent = crumbs[crumbs.length - 1];
    if (parent) props.onOpenPage(parent.id);
    else navigate('#/notes');
  };

  let title;
  if (route.name === 'trash') title = <span className="nb-crumb-current">Corbeille</span>;
  else if (route.name === 'pdf' && props.pdfName)
    title = (
      <>
        <button type="button" onClick={() => navigate('#/pdf')}>
          <Icon name="filePdf" size={15} /> PDF
        </button>
        <span className="nb-crumb-current">{props.pdfName}</span>
      </>
    );
  else if (section !== 'notes')
    title = (
      <span className="nb-crumb-current">
        <Icon name={SECTIONS[section].icon} size={15} /> {SECTIONS[section].label}
      </span>
    );
  else
    title = (
      <>
        {(props.mobile ? crumbs.slice(-1) : crumbs).map((c) => (
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
    );

  return (
    <header className="nb-topbar">
      {section === 'notes' && props.mobile ? (
        <button type="button" className="nb-icon-btn" onClick={back} aria-label="Retour">
          <Icon name="chevronLeft" size={20} />
        </button>
      ) : null}
      {section === 'notes' && !props.mobile ? (
        <button
          type="button"
          className="nb-icon-btn"
          onClick={props.onTogglePages}
          aria-label={props.pagesHidden ? 'Afficher la liste des pages' : 'Masquer la liste des pages'}
          title={props.pagesHidden ? 'Afficher la liste des pages' : 'Masquer la liste des pages'}
        >
          <Icon name="menu" size={18} />
        </button>
      ) : null}
      <nav className="nb-crumbs">{title}</nav>
      <div className="nb-topbar-right">
        <span className={`nb-status nb-status--${props.status} nb-only-mobile`} title={statusLabel(props.status)} />
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
    document.title = page ? `${page.title || 'Sans titre'} – Melo` : 'Melo';
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
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => navigate('#/notes')}>
            Retour aux notes
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

/** Nom d'un PDF de l'atelier (fil d'Ariane). */
function usePdfName(doc: import('yjs').Doc | null, id: string | null): string {
  const [name, setName] = useState('');
  useEffect(() => {
    if (!doc || !id) {
      setName('');
      return;
    }
    const map = doc.getMap('pdfs');
    const read = () => {
      const entry = map.get(id) as { get?: (k: string) => unknown } | undefined;
      setName(String(entry?.get?.('name') ?? ''));
    };
    map.observeDeep(read);
    read();
    return () => map.unobserveDeep(read);
  }, [doc, id]);
  return name;
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

/** Section Homelab : état des serveurs et applications. */
function HomelabSection({ doc, onConfigure }: { doc: import('yjs').Doc; onConfigure: () => void }) {
  const cfg = useHomelabConfig(doc);
  const configured = cfg.services.length > 0 || cfg.devices.length > 0;
  useEffect(() => {
    document.title = 'Homelab – Melo';
  }, []);
  return (
    <div className="nb-page hl-page">
      <h1 className="nb-page-title-static">
        <Icon name="server" size={34} /> Homelab
      </h1>
      <HomelabPanel
        refreshSeconds={cfg.refreshSeconds}
        onConfigure={onConfigure}
        configured={configured}
        layout={cardLayout(cfg)}
        onResize={(id, size) => saveCardSize(doc, id, size)}
        onResetLayout={() => resetCardSizes(doc)}
        order={cardOrder(cfg)}
        onReorder={(ids) => saveCardOrder(doc, ids)}
        refreshKey={configStatusKey(cfg)}
      />
    </div>
  );
}
