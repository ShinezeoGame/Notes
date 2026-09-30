// Accueil : tableau de bord de widgets. À la souris, un widget se déplace en le glissant et se redimensionne en tirant
// l'un de ses coins, sans mode particulier ; ses réglages et son retrait apparaissent au survol. Sur écran tactile, où
// glisser fait défiler la page, un appui long sur un widget (ou « Modifier ») passe en mode modification : poignée pour
// déplacer, coin pour redimensionner, réglages et retrait sur chaque widget.
import { Component, useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Responsive, getBreakpointFromWidth, useContainerWidth, type Layout, type ResponsiveLayouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type * as Y from 'yjs';
import { Modal } from '../components/Modal';
import { useMediaQuery } from '../lib/hooks';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import type { WorkspaceStore } from '../lib/workspace';
import { Icon } from '../icons/Icon';
import {
  BREAKPOINTS,
  COLS,
  ROW_HEIGHT,
  SIZES,
  addWidget,
  removeWidget,
  resetDashboard,
  saveLayout,
  updateWidget,
  useDashboard,
  type Breakpoint,
  type GridItem,
  type Layouts,
  type Widget,
  type WidgetType,
} from './model';
import { WIDGETS, WIDGET_GROUPS } from './registry';

/** Parties d'un widget qui gardent leur propre comportement : y appuyer ne déplace pas le widget. */
const NO_DRAG = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  'label',
  'audio',
  'video[controls]',
  '[contenteditable]',
  '.bn-container',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="textbox"]',
  '[role="menuitem"]',
  '.dash-nodrag',
  '[data-nodrag]',
  // Éléments réordonnables à l'intérieur du widget (appareils, caméras, raccourcis…) : ils se déplacent eux-mêmes.
  '[data-sort-id]',
].join(', ');

/** Appui sur la barre de défilement d'une zone du widget : elle fait défiler, le widget ne bouge pas. */
function markScrollbarPress(e: ReactMouseEvent) {
  const el = e.target;
  if (!(el instanceof HTMLElement) || (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)) return;
  const r = el.getBoundingClientRect();
  if (e.clientX < r.left + el.clientLeft + el.clientWidth && e.clientY < r.top + el.clientTop + el.clientHeight) return;
  el.setAttribute('data-nodrag', '');
  setTimeout(() => el.removeAttribute('data-nodrag'), 0);
}

/** Après un déplacement, le clic du relâchement n'active rien dans le widget (lien, case à cocher…). */
function swallowNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 80);
}

/** Un widget en erreur n'empêche pas d'afficher les autres. */
class WidgetBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? <div className="w-empty w-muted">Ce widget n’a pas pu s’afficher.</div> : this.props.children;
  }
}

type FrameProps = {
  widget: Widget;
  doc: Y.Doc;
  store: WorkspaceStore;
  /** Mode modification (écran tactile). */
  editing: boolean;
  /** Souris : déplacement et redimensionnement directs, actions au survol. */
  direct: boolean;
  onSettings: (id: string) => void;
  onRemove: (id: string) => void;
};

function WidgetFrame({ widget, doc, store, editing, direct, onSettings, onRemove }: FrameProps) {
  const def = WIDGETS[widget.type];
  const title = widget.title?.trim() || def.label;
  const showTitle = widget.showTitle ?? def.showTitle;
  const tint = def.tint?.(widget.config);
  const setConfig = useCallback(
    (patch: Record<string, unknown>) => updateWidget(doc, widget.id, (w) => ({ ...w, config: { ...w.config, ...patch } })),
    [doc, widget.id],
  );
  const openSettings = useCallback(() => onSettings(widget.id), [onSettings, widget.id]);
  const cls = ['dash-widget', `dash-widget--${widget.type}`, widget.transparent ? 'dash-widget--bare' : '', tint ? 'dash-widget--tinted' : ''].filter(Boolean).join(' ');
  return (
    <section
      className={cls}
      style={tint ? ({ '--tint': tint } as CSSProperties) : undefined}
      aria-label={title}
      onMouseDownCapture={direct ? markScrollbarPress : undefined}
    >
      {showTitle ? (
        <header className="dash-widget-head">
          <Icon name={def.icon} size={15} />
          <span className="dash-widget-title">{title}</span>
        </header>
      ) : null}
      <div className="dash-widget-body" inert={editing || undefined}>
        <WidgetBoundary>
          <def.Body widget={widget} doc={doc} store={store} editing={editing} setConfig={setConfig} openSettings={openSettings} />
        </WidgetBoundary>
      </div>
      {direct ? (
        <>
          <div className="dash-grab" title="Glisser pour déplacer" aria-hidden="true" />
          <div className="dash-quick">
            <button type="button" className="dash-quick-btn" onClick={openSettings} aria-label={`Réglages : ${title}`} title="Réglages">
              <Icon name="settings" size={14} />
            </button>
            <button type="button" className="dash-quick-btn dash-quick-btn--danger" onClick={() => onRemove(widget.id)} aria-label={`Retirer : ${title}`} title="Retirer">
              <Icon name="close" size={14} />
            </button>
          </div>
        </>
      ) : null}
      {editing ? (
        <div className="dash-edit">
          <div className="dash-edit-actions dash-nodrag">
            <button type="button" className="dash-edit-btn" onClick={openSettings} aria-label={`Réglages : ${title}`} title="Réglages">
              <Icon name="settings" size={16} />
            </button>
            <button type="button" className="dash-edit-btn dash-edit-btn--danger" onClick={() => onRemove(widget.id)} aria-label={`Retirer : ${title}`} title="Retirer">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="dash-edit-center">
            <span className="dash-grip dash-drag" role="button" aria-label={`Déplacer : ${title}`}>
              <Icon name="move" size={22} />
            </span>
            <span className="dash-edit-label">{title}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Catalog({ onAdd, onClose, onReset }: { onAdd: (type: WidgetType) => void; onClose: () => void; onReset: () => void }) {
  return (
    <Modal
      title="Ajouter un widget"
      onClose={onClose}
      width={760}
      footer={
        <button type="button" className="nb-btn nb-btn--sm dash-reset" onClick={onReset}>
          <Icon name="refresh" size={14} /> Revenir à l’accueil de départ
        </button>
      }
    >
      {WIDGET_GROUPS.map((group) => (
        <section key={group} className="dash-catalog-group">
          <h3>{group}</h3>
          <div className="dash-catalog">
            {(Object.entries(WIDGETS) as [WidgetType, (typeof WIDGETS)[WidgetType]][])
              .filter(([, d]) => d.group === group)
              .map(([type, d]) => (
                <button key={type} type="button" className="dash-catalog-item" onClick={() => onAdd(type)}>
                  <span className="dash-catalog-icon">
                    <Icon name={d.icon} size={22} />
                  </span>
                  <span>
                    <b>{d.label}</b>
                    <span className="nb-muted">{d.description}</span>
                  </span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </Modal>
  );
}

function SettingsDialog({ widget, doc, store, onClose, onRemove }: { widget: Widget; doc: Y.Doc; store: WorkspaceStore; onClose: () => void; onRemove: () => void }) {
  const def = WIDGETS[widget.type];
  const [title, setTitle] = useState(widget.title ?? '');
  const [showTitle, setShowTitle] = useState(widget.showTitle ?? def.showTitle);
  const [transparent, setTransparent] = useState(Boolean(widget.transparent));
  const [config, setConfig] = useState(widget.config);
  const set = useCallback((patch: Record<string, unknown>) => setConfig((c) => ({ ...c, ...patch })), []);
  const save = () => {
    updateWidget(doc, widget.id, (w) => ({ ...w, title: title.trim() || undefined, showTitle, transparent: transparent || undefined, config }));
    onClose();
  };
  return (
    <Modal
      title={`Réglages : ${def.label}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="nb-btn nb-btn--danger dash-settings-remove" onClick={onRemove}>
            <Icon name="trash" size={15} /> Retirer
          </button>
          <button type="button" className="nb-btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={save}>
            Enregistrer
          </button>
        </>
      }
    >
      {def.Settings ? (
        <div className="dash-settings-specific">
          <def.Settings config={config} set={set} doc={doc} store={store} />
        </div>
      ) : null}
      <label className="nb-field">
        <span>Titre</span>
        <input className="nb-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={def.label} maxLength={60} />
      </label>
      <label className="nb-check">
        <input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} /> Afficher la barre de titre
      </label>
      <label className="nb-check">
        <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Sans fond (posé sur le fond d’écran)
      </label>
    </Modal>
  );
}

type Props = {
  doc: Y.Doc;
  store: WorkspaceStore;
  /** Document synchronisé avec le serveur (ou pas de serveur) : l'accueil de départ peut être enregistré. */
  synced: boolean;
  /** Espace entre les widgets (px). */
  gap: number;
  onCustomize: () => void;
};

export function Dashboard({ doc, store, synced, gap, onCustomize }: Props) {
  const data = useDashboard(doc, synced);
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const touch = useMediaQuery('(pointer: coarse)');
  const direct = !touch;
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  // Même calcul que la grille : la disposition modifiée est celle de cette taille d'écran.
  const breakpoint = getBreakpointFromWidth(BREAKPOINTS, width) as Breakpoint;

  useEffect(() => {
    document.title = 'Accueil – Melo';
  }, []);

  useEffect(() => {
    if (!touch) setEditing(false);
  }, [touch]);

  useEffect(() => {
    if (!editing) return;
    // Texte sélectionné avant la modification : le glisser déplacerait ce texte au lieu du widget.
    window.getSelection()?.removeAllRanges();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !catalog && !settingsId && setEditing(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, catalog, settingsId]);

  // Écran tactile : un appui long sur un widget passe en mode modification, comme l'écran d'accueil d'un téléphone.
  useEffect(() => {
    const wrap = containerRef.current;
    if (!touch || editing || !wrap) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    // Champs de saisie et éléments réordonnables du widget : l'appui long leur revient.
    const editable = (t: Element) => t.closest('input, textarea, select, [contenteditable], .bn-container, [data-sort-id]');
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (e.pointerType === 'mouse' || !t.closest('.dash-item') || editable(t)) return;
      start = { x: e.clientX, y: e.clientY };
      clearTimeout(timer);
      timer = setTimeout(() => {
        start = null;
        navigator.vibrate?.(12);
        setEditing(true);
      }, 500);
    };
    const move = (e: PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    };
    // Pas de menu (copier, ouvrir le lien…) à l'appui long sur un widget.
    const menu = (e: Event) => {
      const t = e.target as Element;
      if (t.closest('.dash-item') && !editable(t)) e.preventDefault();
    };
    wrap.addEventListener('pointerdown', down);
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('contextmenu', menu);
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('scroll', cancel, true);
    return () => {
      cancel();
      wrap.removeEventListener('pointerdown', down);
      wrap.removeEventListener('pointermove', move);
      wrap.removeEventListener('contextmenu', menu);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('scroll', cancel, true);
    };
  }, [touch, editing, containerRef, mounted, data.widgets.length]);

  // Tailles minimales ajoutées à la disposition enregistrée (non enregistrées elles-mêmes).
  const layouts = useMemo(() => {
    const types = new Map(data.widgets.map((w) => [w.id, w.type]));
    const out: ResponsiveLayouts<Breakpoint> = {};
    for (const [bp, items] of Object.entries(data.layouts) as [Breakpoint, NonNullable<Layouts[Breakpoint]>][]) {
      out[bp] = items
        .filter((it) => types.has(it.i))
        .map((it) => {
          const s = SIZES[types.get(it.i)!];
          return { ...it, minW: Math.min(s.minW, COLS[bp]), minH: s.minH };
        });
    }
    return out;
  }, [data]);

  // Enregistré seulement après un geste de l'utilisateur (pas quand la grille s'adapte à la largeur de l'écran).
  const save = useCallback(
    (layout: Layout) => {
      saveLayout(doc, breakpoint, layout as readonly GridItem[]);
      if (!getSettings().dashTipSeen) updateSettings({ dashTipSeen: true });
    },
    [doc, breakpoint],
  );
  const onDragStop = useCallback(
    (layout: Layout) => {
      swallowNextClick();
      save(layout);
    },
    [save],
  );

  const remove = useCallback(
    (id: string) => {
      const w = data.widgets.find((x) => x.id === id);
      if (!w) return;
      const label = w.title?.trim() || WIDGETS[w.type].label;
      if (!confirm(`Retirer le widget « ${label} » de l’accueil ?`)) return;
      removeWidget(doc, id);
      setSettingsId(null);
    },
    [doc, data.widgets],
  );

  const add = (type: WidgetType) => {
    const def = WIDGETS[type];
    const id = addWidget(doc, type, { ...def.defaults });
    setCatalog(false);
    setFresh(id);
    setTimeout(() => setFresh((f) => (f === id ? null : f)), 1800);
    if (def.setupFirst) setSettingsId(id);
    setTimeout(() => document.querySelector(`[data-widget="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  };

  const dragConfig = useMemo(
    () =>
      direct
        ? { enabled: true, cancel: NO_DRAG, threshold: 6 }
        : { enabled: editing, handle: '.dash-drag', cancel: '.dash-nodrag', threshold: 4 },
    [direct, editing],
  );
  const resizeConfig = useMemo(
    () => ({ enabled: direct || editing, handles: direct ? (['se', 'sw', 'ne', 'nw'] as const) : (['se'] as const) }),
    [direct, editing],
  );
  const margin = useMemo(() => [gap, gap] as const, [gap]);
  const settingsWidget = settingsId ? data.widgets.find((w) => w.id === settingsId) : undefined;

  const pageCls = ['dash-page', editing ? 'dash-page--editing' : '', direct ? 'dash-page--direct' : 'dash-page--touch'].filter(Boolean).join(' ');
  return (
    <div className={pageCls}>
      <div className="dash-toolbar">
        {editing ? (
          <>
            <span className="dash-toolbar-hint">Déplacez un widget avec sa poignée, tirez le coin pour l’agrandir.</span>
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => setCatalog(true)}>
              <Icon name="plus" size={15} /> Ajouter un widget
            </button>
            <button type="button" className="nb-btn nb-btn--sm" onClick={onCustomize}>
              <Icon name="palette" size={15} /> <span className="dash-hide-narrow">Personnaliser</span>
            </button>
            <button type="button" className="nb-btn nb-btn--sm nb-btn--primary" onClick={() => setEditing(false)}>
              <Icon name="check" size={15} /> Terminé
            </button>
          </>
        ) : (
          <>
            {direct && !settings.dashTipSeen && data.widgets.length > 0 ? (
              <span className="dash-tip">
                <Icon name="move" size={14} />
                <span>Glissez un widget pour le déplacer, tirez un de ses coins pour le redimensionner.</span>
                <button type="button" className="dash-tip-close" onClick={() => updateSettings({ dashTipSeen: true })} aria-label="Masquer l’astuce" title="Masquer">
                  <Icon name="close" size={12} />
                </button>
              </span>
            ) : null}
            <button type="button" className="dash-tool" onClick={onCustomize} title="Thème, couleurs et fond d’écran">
              <Icon name="palette" size={16} /> <span>Personnaliser</span>
            </button>
            {direct ? (
              <button type="button" className="dash-tool" onClick={() => setCatalog(true)} title="Ajouter un widget à l’accueil">
                <Icon name="plus" size={16} /> <span>Ajouter un widget</span>
              </button>
            ) : (
              <button type="button" className="dash-tool" onClick={() => setEditing(true)} title="Déplacer, redimensionner, ajouter des widgets (ou appui long sur un widget)">
                <Icon name="pencil" size={16} /> <span>Modifier</span>
              </button>
            )}
          </>
        )}
      </div>

      <div ref={containerRef} className="dash-grid-wrap">
        {data.widgets.length === 0 ? (
          <div className="dash-empty">
            <Icon name="dashboard" size={34} />
            <p>Votre accueil est vide.</p>
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => setCatalog(true)}>
              <Icon name="plus" size={15} /> Ajouter un widget
            </button>
          </div>
        ) : mounted ? (
          <Responsive
            className="dash-grid"
            width={width}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            layouts={layouts}
            rowHeight={ROW_HEIGHT}
            margin={margin}
            containerPadding={[0, 0]}
            dragConfig={dragConfig}
            resizeConfig={resizeConfig}
            onDragStop={onDragStop}
            onResizeStop={save}
          >
            {data.widgets.map((w) => (
              <div key={w.id} data-widget={w.id} className={`dash-item${fresh === w.id ? ' dash-item--fresh' : ''}`}>
                <WidgetFrame widget={w} doc={doc} store={store} editing={editing} direct={direct} onSettings={setSettingsId} onRemove={remove} />
              </div>
            ))}
          </Responsive>
        ) : null}
      </div>

      {catalog ? (
        <Catalog
          onAdd={add}
          onClose={() => setCatalog(false)}
          onReset={() => {
            if (!confirm('Remplacer tous les widgets par ceux de l’accueil de départ ?')) return;
            resetDashboard(doc);
            setCatalog(false);
          }}
        />
      ) : null}
      {settingsWidget ? (
        <SettingsDialog
          key={settingsWidget.id}
          widget={settingsWidget}
          doc={doc}
          store={store}
          onClose={() => setSettingsId(null)}
          onRemove={() => remove(settingsWidget.id)}
        />
      ) : null}
    </div>
  );
}
