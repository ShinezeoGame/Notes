import { useEffect, useState } from 'react';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { useWorkspacePages, type PageMeta, type WorkspaceStore } from '../lib/workspace';
import type { ConnStatus } from '../lib/yjs';

type Props = {
  store: WorkspaceStore;
  currentPageId: string | null;
  status: ConnStatus;
  open: boolean;
  onClose: () => void;
  onOpenPage: (id: string) => void;
  onNewPage: (parentId: string) => void;
  onOpenTrash: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onShare: (pageId: string) => void;
  onDelete: (pageId: string) => void;
};

type DropHint = { id: string; pos: 'before' | 'after' | 'inside' } | null;
type Menu = { pageId: string; x: number; y: number } | null;

export const STATUS_LABEL: Record<ConnStatus, string> = {
  offline: 'Hors ligne (appareil seul)',
  connecting: 'Connexion au serveur…',
  connected: 'Synchronisé',
  disconnected: 'Déconnecté – nouvelle tentative…',
  denied: 'Accès refusé par le serveur',
};

export function Sidebar(props: Props) {
  const { store, currentPageId, status, open, onClose } = props;
  useWorkspacePages(store);
  const settings = useSettings();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);
  const [menu, setMenu] = useState<Menu>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const toggleExpanded = (id: string, force?: boolean) => {
    const expanded = { ...getSettings().expanded };
    expanded[id] = force ?? !expanded[id];
    updateSettings({ expanded });
  };

  const handleDrop = (target: PageMeta, pos: NonNullable<DropHint>['pos']) => {
    if (!dragId || dragId === target.id) return;
    if (pos === 'inside') {
      store.move(dragId, target.id, null);
      toggleExpanded(target.id, true);
    } else if (pos === 'before') {
      store.move(dragId, target.parentId, target.id);
    } else {
      const siblings = store.children(target.parentId);
      const idx = siblings.findIndex((s) => s.id === target.id);
      store.move(dragId, target.parentId, siblings[idx + 1]?.id ?? null);
    }
  };

  const renderNode = (page: PageMeta, depth: number) => {
    const children = store.children(page.id);
    const expanded = Boolean(settings.expanded[page.id]);
    const active = page.id === currentPageId;
    const hint = dropHint?.id === page.id ? dropHint.pos : null;
    return (
      <div key={page.id}>
        <div
          className={`nb-tree-row${active ? ' nb-tree-row--active' : ''}${hint ? ` nb-tree-row--drop-${hint}` : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e) => {
            setDragId(page.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', page.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropHint(null);
          }}
          onDragOver={(e) => {
            if (!dragId || dragId === page.id) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - r.top;
            const pos = y < r.height * 0.25 ? 'before' : y > r.height * 0.75 ? 'after' : 'inside';
            if (dropHint?.id !== page.id || dropHint.pos !== pos) setDropHint({ id: page.id, pos });
          }}
          onDragLeave={() => {
            if (dropHint?.id === page.id) setDropHint(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dropHint) handleDrop(page, dropHint.pos);
            setDragId(null);
            setDropHint(null);
          }}
          onClick={() => {
            props.onOpenPage(page.id);
            onClose();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ pageId: page.id, x: e.clientX, y: e.clientY });
          }}
        >
          <button
            type="button"
            className={`nb-tree-toggle${children.length ? '' : ' nb-tree-toggle--empty'}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(page.id);
            }}
            aria-label={expanded ? 'Replier' : 'Déplier'}
          >
            {expanded ? '▾' : '▸'}
          </button>
          <span className="nb-tree-icon">{page.icon || '📄'}</span>
          <span className="nb-tree-title">{page.title || 'Sans titre'}</span>
          <span className="nb-tree-actions">
            <button
              type="button"
              className="nb-icon-btn nb-icon-btn--sm"
              title="Options"
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ pageId: page.id, x: r.left, y: r.bottom + 4 });
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              ⋯
            </button>
            <button
              type="button"
              className="nb-icon-btn nb-icon-btn--sm"
              title="Ajouter une sous-page"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(page.id, true);
                props.onNewPage(page.id);
              }}
            >
              +
            </button>
          </span>
        </div>
        {expanded && children.length ? children.map((c) => renderNode(c, depth + 1)) : null}
        {expanded && !children.length ? (
          <div className="nb-tree-empty" style={{ paddingLeft: 30 + depth * 14 }}>
            Aucune sous-page
          </div>
        ) : null}
      </div>
    );
  };

  const roots = store.roots();

  return (
    <>
      {open ? <div className="nb-sidebar-backdrop" onClick={onClose} /> : null}
      <aside className={`nb-sidebar${open ? ' nb-sidebar--open' : ''}`}>
        <div className="nb-sidebar-head">
          <div className="nb-workspace">
            <span className="nb-workspace-avatar">N</span>
            <span className="nb-workspace-name">Mes notes</span>
            <span className={`nb-status nb-status--${status}`} title={STATUS_LABEL[status]} />
          </div>
          <div className="nb-sidebar-tools">
            <button type="button" className="nb-icon-btn" title="Rechercher (Ctrl+K)" onClick={props.onOpenSearch}>
              🔍
            </button>
            <button type="button" className="nb-icon-btn" title="Réglages" onClick={props.onOpenSettings}>
              ⚙️
            </button>
            <button type="button" className="nb-icon-btn nb-only-mobile" title="Fermer" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="nb-sidebar-section">Pages</div>
        <nav className="nb-tree">
          {roots.length === 0 ? <div className="nb-tree-empty">Aucune page pour l’instant.</div> : roots.map((p) => renderNode(p, 0))}
          <div
            className={`nb-tree-rootdrop${dragId ? ' nb-tree-rootdrop--visible' : ''}${dropHint?.id === '__root__' ? ' nb-tree-rootdrop--over' : ''}`}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              if (dropHint?.id !== '__root__') setDropHint({ id: '__root__', pos: 'inside' });
            }}
            onDragLeave={() => dropHint?.id === '__root__' && setDropHint(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) store.move(dragId, '', null);
              setDragId(null);
              setDropHint(null);
            }}
          >
            Déposer ici pour placer à la racine
          </div>
        </nav>

        <div className="nb-sidebar-foot">
          <button type="button" className="nb-sidebar-link" onClick={() => props.onNewPage('')}>
            <span>＋</span> Nouvelle page
          </button>
          <button type="button" className="nb-sidebar-link" onClick={props.onOpenTrash}>
            <span>🗑️</span> Corbeille
          </button>
        </div>
      </aside>

      {menu ? (
        <div
          className="nb-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 200) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { props.onNewPage(menu.pageId); toggleExpanded(menu.pageId, true); setMenu(null); }}>
            ＋ Ajouter une sous-page
          </button>
          <button type="button" onClick={() => { props.onShare(menu.pageId); setMenu(null); }}>
            🔗 Partager
          </button>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/p/${menu.pageId}`); setMenu(null); }}>
            📋 Copier le lien interne
          </button>
          <div className="nb-menu-sep" />
          <button type="button" className="nb-menu-danger" onClick={() => { props.onDelete(menu.pageId); setMenu(null); }}>
            🗑️ Supprimer
          </button>
        </div>
      ) : null}
    </>
  );
}
