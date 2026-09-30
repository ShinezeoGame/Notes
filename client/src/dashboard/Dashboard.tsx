// Accueil : tableau de bord de widgets. « Modifier » passe en mode modification : glisser un widget pour le déplacer,
// tirer son coin pour le redimensionner, ajouter depuis le catalogue, régler ou retirer chaque widget.
import { Component, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Responsive, useContainerWidth, type ResponsiveLayouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import type * as Y from 'yjs';
import { Modal } from '../components/Modal';
import { useMediaQuery } from '../lib/hooks';
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
  saveLayouts,
  updateWidget,
  useDashboard,
  type Breakpoint,
  type Layouts,
  type Widget,
  type WidgetType,
} from './model';
import { WIDGETS, WIDGET_GROUPS } from './registry';

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
  editing: boolean;
  /** Écran tactile : déplacement par la poignée seulement (le reste du widget laisse défiler la page). */
  touch: boolean;
  onSettings: (id: string) => void;
  onRemove: (id: string) => void;
};

function WidgetFrame({ widget, doc, store, editing, touch, onSettings, onRemove }: FrameProps) {
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
    <section className={cls} style={tint ? ({ '--tint': tint } as CSSProperties) : undefined} aria-label={title}>
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
      {!editing && def.Settings ? (
        <button type="button" className="dash-quick nb-icon-btn nb-icon-btn--sm" onClick={openSettings} aria-label={`Réglages : ${title}`} title="Réglages">
          <Icon name="settings" size={14} />
        </button>
      ) : null}
      {editing ? (
        <div className={`dash-edit${touch ? '' : ' dash-drag'}`}>
          <div className="dash-edit-actions dash-nodrag">
            <button type="button" className="dash-edit-btn" onClick={openSettings} aria-label={`Réglages : ${title}`} title="Réglages">
              <Icon name="settings" size={16} />
            </button>
            <button type="button" className="dash-edit-btn dash-edit-btn--danger" onClick={() => onRemove(widget.id)} aria-label={`Retirer : ${title}`} title="Retirer">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="dash-edit-center">
            {touch ? (
              <span className="dash-grip dash-drag" role="button" aria-label={`Déplacer : ${title}`}>
                <Icon name="move" size={22} />
              </span>
            ) : (
              <Icon name="move" size={20} />
            )}
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
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const touch = useMediaQuery('(pointer: coarse)');
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });

  useEffect(() => {
    document.title = 'Accueil – Notes';
  }, []);

  useEffect(() => {
    if (!editing) return;
    // Texte sélectionné avant la modification : le glisser déplacerait ce texte au lieu du widget.
    window.getSelection()?.removeAllRanges();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !catalog && !settingsId && setEditing(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, catalog, settingsId]);

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

  const onLayoutChange = useCallback(
    (_layout: unknown, all: ResponsiveLayouts<Breakpoint>) => {
      if (editing) saveLayouts(doc, all as Layouts);
    },
    [doc, editing],
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
    setEditing(true);
    if (def.setupFirst) setSettingsId(id);
    setTimeout(() => document.querySelector(`[data-widget="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  };

  const dragConfig = useMemo(() => ({ enabled: editing, handle: '.dash-drag', cancel: '.dash-nodrag', threshold: 4 }), [editing]);
  const resizeConfig = useMemo(() => ({ enabled: editing, handles: touch ? (['se'] as const) : (['se', 'e', 's'] as const) }), [editing, touch]);
  const margin = useMemo(() => [gap, gap] as const, [gap]);
  const settingsWidget = settingsId ? data.widgets.find((w) => w.id === settingsId) : undefined;

  return (
    <div className={`dash-page${editing ? ' dash-page--editing' : ''}`}>
      <div className="dash-toolbar">
        {editing ? (
          <>
            <span className="dash-toolbar-hint">
              {touch ? 'Déplacez un widget avec sa poignée, tirez le coin pour l’agrandir.' : 'Glissez un widget pour le déplacer, tirez un bord ou le coin pour le redimensionner.'}
            </span>
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
            <button type="button" className="dash-tool" onClick={onCustomize} title="Thème, couleurs et fond d’écran">
              <Icon name="palette" size={16} /> <span>Personnaliser</span>
            </button>
            <button type="button" className="dash-tool" onClick={() => setEditing(true)} title="Déplacer, redimensionner, ajouter des widgets">
              <Icon name="pencil" size={16} /> <span>Modifier</span>
            </button>
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
            onLayoutChange={onLayoutChange}
          >
            {data.widgets.map((w) => (
              <div key={w.id} data-widget={w.id} className="dash-item">
                <WidgetFrame widget={w} doc={doc} store={store} editing={editing} touch={touch} onSettings={setSettingsId} onRemove={remove} />
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
