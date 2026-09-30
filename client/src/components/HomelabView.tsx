import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { api, serverBase } from '../lib/api';
import {
  CATEGORIES,
  formatBytes,
  formatStat,
  formatUptime,
  clampCardHeight,
  clampCardWidth,
  deviceVisual,
  type CardSize,
  serviceVisual,
  type DeviceStatus,
  type Gauge,
  type HomelabStatus,
  type ServiceStatus,
  type StatValue,
} from '../lib/homelab';
import { AppTile, Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

type PanelProps = {
  compact?: boolean;
  refreshSeconds?: number;
  onConfigure?: () => void;
  configured: boolean;
  /** Taille de chaque module (largeur en %, hauteur en px ; absentes = automatiques), indexée par identifiant. */
  layout?: Record<string, CardSize>;
  /** Fourni quand les modules peuvent être redimensionnés depuis ce panneau. */
  onResize?: (id: string, size: CardSize) => void;
  onResetLayout?: () => void;
  /** Change quand la configuration change : le panneau se réactualise aussitôt. */
  refreshKey?: string;
};

const AUTO_SIZE: CardSize = {};

function barClass(percent: number | null | undefined): string {
  if (percent == null) return '';
  if (percent >= 90) return ' hl-bar--danger';
  if (percent >= 70) return ' hl-bar--warn';
  return '';
}

function GaugeBar({ label, gauge, hint, warn }: { label: string; gauge: Gauge | null | undefined; hint?: string; warn?: boolean }) {
  if (!gauge) return null;
  const pct = gauge.percent == null ? null : Math.max(0, Math.min(100, gauge.percent));
  const detail = hint ?? (gauge.total ? `${formatBytes(gauge.used)} / ${formatBytes(gauge.total)}` : pct != null ? `${pct.toFixed(0)} %` : '—');
  return (
    <div className="hl-gauge">
      <div className="hl-gauge-head">
        <span className="hl-gauge-label" title={label}>
          {warn ? <Icon name="alert" size={13} className="hl-warn-icon" title="Volume signalé en mauvais état" /> : null}
          {label}
        </span>
        <span className="hl-gauge-detail">{detail}{pct != null && gauge.total ? ` · ${pct.toFixed(0)} %` : ''}</span>
      </div>
      <div className={`hl-bar${barClass(pct)}`}>
        <div className="hl-bar-fill" style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

function VisualTile({ v, size }: { v: { name: IconName; src?: string; color: string }; size: number }) {
  return <AppTile name={v.name} color={v.color} src={v.src} size={size} />;
}

function StatChip({ s }: { s: StatValue }) {
  const warn = s.kind === 'warn-if-positive' && typeof s.value === 'number' && s.value > 0;
  return (
    <span className={`hl-chip${warn ? ' hl-chip--warn' : ''}`} title={s.label}>
      <span className="hl-chip-value">{formatStat(s)}</span>
      <span className="hl-chip-label">{s.label}</span>
    </span>
  );
}

/** Dimensions réelles d'un module : largeur en px, hauteur imposée en px (absente = selon le contenu). */
export type CardFit = { width: number; height?: number };

/** Hauteur d'une rangée de statistiques (pastille de 40 px + 6 px d'espacement). */
const CHIP_ROW = 46;

/** Masque les éléments coupés par le bas de la liste (ils resteraient à moitié visibles). */
function hideClipped(el: HTMLElement | null) {
  if (!el) return;
  const limit = el.clientHeight + 1;
  for (const child of Array.from(el.children) as HTMLElement[]) {
    child.style.visibility = child.offsetTop + child.offsetHeight > limit ? 'hidden' : '';
  }
}

/** Liste qui masque les éléments qui ne tiennent pas quand la hauteur du module est imposée ou limitée. */
function FitList({ className, maxHeight, children }: { className: string; maxHeight?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Après chaque rendu (statistiques mises à jour) et à chaque changement de taille.
  useLayoutEffect(() => hideClipped(ref.current));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => hideClipped(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`hl-fit ${className}`} style={maxHeight !== undefined ? { maxHeight } : undefined}>
      {children}
    </div>
  );
}

export function ServiceCard({ s, compact, fit, editing = false }: { s: ServiceStatus; compact?: boolean; fit?: CardFit; editing?: boolean }) {
  const open = () => !editing && s.url && window.open(s.url, '_blank', 'noopener');
  const fixed = fit?.height !== undefined;
  // Hauteur automatique : deux rangées de statistiques (une en vue compacte, si le module est assez large).
  // Hauteur imposée : autant de statistiques que la place le permet.
  const autoRows = compact ? ((fit?.width ?? 0) >= 300 ? 1 : 0) : 2;
  const showStats = s.stats.length > 0 && (fixed || autoRows > 0);
  return (
    <button
      type="button"
      className={`hl-card hl-service${s.ok ? '' : ' hl-service--down'}${compact ? ' hl-card--compact' : ''}${fixed ? ' hl-card--fixed' : ''}`}
      style={fixed ? { height: fit.height } : undefined}
      onClick={open}
      title={editing ? undefined : s.url}
      tabIndex={editing ? -1 : undefined}
    >
      <div className="hl-service-head">
        <VisualTile v={serviceVisual(s)} size={compact ? 26 : 32} />
        <span className="hl-service-name">{s.name || s.type}</span>
        <span className={`hl-dot${s.ok ? ' hl-dot--up' : ' hl-dot--down'}`} title={s.ok ? 'En ligne' : 'Hors ligne'} />
        {s.latency != null ? <span className="hl-latency">{s.latency} ms</span> : null}
      </div>
      {showStats ? (
        <FitList className="hl-chips" maxHeight={fixed ? undefined : autoRows * CHIP_ROW - 6}>
          {s.stats.map((st) => (
            <StatChip key={st.label} s={st} />
          ))}
        </FitList>
      ) : null}
      {s.error ? <div className="hl-error">{s.error}</div> : null}
      {(!compact || fixed) && s.version ? <div className="hl-version">v{s.version}</div> : null}
    </button>
  );
}

export function DeviceCard({ d, compact: compactView, fit }: { d: DeviceStatus; compact?: boolean; fit?: CardFit }) {
  const fixed = fit?.height !== undefined;
  // Vue compacte réduite tant que la hauteur est automatique ; une hauteur imposée affiche tout ce qui tient.
  const compact = Boolean(compactView) && !fixed;
  const cpuGauge: Gauge | null = d.cpu != null ? { total: 0, used: 0, percent: d.cpu } : null;
  return (
    <div className={`hl-card hl-device${d.ok ? '' : ' hl-device--down'}${fixed ? ' hl-card--fixed' : ''}`} style={fixed ? { height: fit.height } : undefined}>
      <div className="hl-service-head">
        <VisualTile v={deviceVisual(d)} size={compact ? 26 : 32} />
        <span className="hl-service-name">{d.name || d.hostname || d.type}</span>
        <span className={`hl-dot${d.ok ? ' hl-dot--up' : ' hl-dot--down'}`} />
      </div>
      {d.ok ? (
        <>
          <div className="hl-device-meta">
            {[d.hostname, d.model, d.os].filter(Boolean).join(' · ')}
            {d.cores ? ` · ${d.cores} cœurs` : ''}
          </div>
          <FitList className="hl-gauges">
            <GaugeBar label="CPU" gauge={cpuGauge} hint={d.cpu != null ? `${d.cpu.toFixed(0)} %${d.load?.length ? ` · charge ${d.load.slice(0, 3).join(' / ')}` : ''}` : undefined} />
            {d.cpu == null && d.load?.length ? <div className="hl-device-meta">Charge : {d.load.slice(0, 3).join(' / ')}</div> : null}
            <GaugeBar label="Mémoire" gauge={d.memory} hint={d.memory && !d.memory.total && d.memory.percent != null ? `${d.memory.percent.toFixed(0)} %` : undefined} />
            {!compact ? <GaugeBar label="Swap" gauge={d.swap && d.swap.total ? d.swap : null} /> : null}
            {(d.disks ?? []).slice(0, compact ? 2 : 24).map((disk) => (
              <GaugeBar key={disk.name} label={disk.name} gauge={disk.error ? null : disk} warn={disk.warn} />
            ))}
          </FitList>
          <div className="hl-device-foot">
            {d.uptime != null ? (
              <span title="Temps de fonctionnement">
                <Icon name="clock" size={13} /> {formatUptime(d.uptime)}
              </span>
            ) : null}
            {(d.temps ?? []).slice(0, compact ? 1 : 4).map((t) => (
              <span key={t.label} className={t.value >= 75 ? 'hl-temp--hot' : ''} title={t.label}>
                <Icon name="thermometer" size={13} /> {t.label.length > 14 ? `${t.label.slice(0, 14)}…` : t.label} {t.value.toFixed(0)} °C
              </span>
            ))}
            {d.network ? (
              <span title="Réseau">
                <Icon name="arrowDown" size={13} /> {formatBytes(d.network.rx)}/s <Icon name="arrowUp" size={13} /> {formatBytes(d.network.tx)}/s
              </span>
            ) : null}
            {(d.extra ?? []).map((e) => (
              <span key={e.label}>{e.label} : {formatStat(e)}</span>
            ))}
          </div>
        </>
      ) : (
        <div className="hl-error">{d.error || 'Indisponible'}</div>
      )}
    </div>
  );
}

/** Panneau autonome : interroge le serveur et affiche appareils + applications. */
export function HomelabPanel({ compact = false, refreshSeconds = 30, onConfigure, configured, layout, onResize, onResetLayout, refreshKey }: PanelProps) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<HomelabStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasServer = Boolean(serverBase());

  const refresh = useCallback(
    async (force = false) => {
      if (!hasServer) return;
      setLoading(true);
      try {
        setStatus(await api.homelabStatus(force));
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur');
      } finally {
        setLoading(false);
      }
    },
    [hasServer],
  );

  useEffect(() => {
    if (!configured) return;
    void refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    timer.current = setInterval(tick, Math.max(10, refreshSeconds) * 1000);
    const clock = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      clearInterval(clock);
    };
  }, [refresh, refreshSeconds, configured]);

  // Configuration modifiée (application ou appareil ajouté…) : nouvelle interrogation sans attendre l'intervalle.
  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === undefined || refreshKey === lastKey.current) return;
    lastKey.current = refreshKey;
    // Laisse le temps à la modification d'atteindre le serveur par la synchronisation.
    const t = setTimeout(() => void refresh(true), 700);
    return () => clearTimeout(t);
  }, [refreshKey, refresh]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ServiceStatus[]>();
    for (const s of status?.services ?? []) {
      const cat = s.category || 'Autres';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(s);
    }
    const order = (c: string) => (CATEGORIES.indexOf(c) === -1 ? 99 : CATEGORIES.indexOf(c));
    return Array.from(groups.entries()).sort(([a], [b]) => order(a) - order(b));
  }, [status]);

  if (!hasServer) {
    return (
      <div className="nb-notice">
        <p>Le tableau de bord interroge vos applications depuis le serveur Melo (accès au réseau local, pas de problème de CORS).</p>
        <p className="nb-muted">Configurez l’adresse du serveur dans les réglages, idéalement un serveur hébergé dans votre homelab.</p>
      </div>
    );
  }
  if (!configured) {
    return (
      <div className="nb-notice hl-empty">
        <p>Aucune application ni appareil configuré pour l’instant.</p>
        {onConfigure ? (
          <button type="button" className="nb-btn nb-btn--primary" onClick={onConfigure}>
            Configurer le homelab
          </button>
        ) : null}
      </div>
    );
  }

  const downCount = (status?.services ?? []).filter((s) => !s.ok).length + (status?.devices ?? []).filter((d) => !d.ok).length;
  const ago = status ? Math.max(0, Math.round((now - status.fetchedAt) / 1000)) : null;

  return (
    <div className={`hl-panel${compact ? ' hl-panel--compact' : ''}${editing ? ' hl-panel--editing' : ''}`}>
      {editing ? (
        <div className="hl-edit-hint">
          <Icon name="gripCorner" size={14} /> Tirez le bord droit, le bord inférieur ou le coin d’un module pour le redimensionner librement. Double-clic sur le
          coin : taille automatique.
        </div>
      ) : null}
      <div className="hl-toolbar">
        <span className="nb-muted">
          {status ? `Actualisé il y a ${ago} s` : loading ? 'Interrogation…' : ''}
          {status && downCount ? <span className="hl-down-count"> · {downCount} hors ligne</span> : null}
        </span>
        <span className="nb-row nb-gap hl-toolbar-actions">
          {onResize ? (
            <button
              type="button"
              className={`nb-btn nb-btn--sm${editing ? ' nb-btn--primary' : ''}`}
              onClick={() => setEditing((v) => !v)}
              title="Changer la taille des modules"
            >
              <Icon name={editing ? 'check' : 'resize'} size={14} /> {editing ? 'Terminer' : 'Redimensionner'}
            </button>
          ) : null}
          {editing && onResetLayout ? (
            <button type="button" className="nb-btn nb-btn--sm" onClick={onResetLayout}>
              Tailles par défaut
            </button>
          ) : null}
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => void refresh(true)} disabled={loading}>
            {loading ? '…' : 'Actualiser'}
          </button>
          {onConfigure ? (
            <button type="button" className="nb-btn nb-btn--sm" onClick={onConfigure}>
              Configurer
            </button>
          ) : null}
        </span>
      </div>
      {error ? <div className="nb-error">{error}</div> : null}
      {!status && loading ? <div className="hl-loading">Interrogation de vos appareils et applications…</div> : null}
      {status?.devices.length ? (
        <section className="hl-section">
          {!compact ? <h2>Appareils</h2> : null}
          <CardGrid
            className="hl-grid hl-grid--devices"
            compact={compact}
            minWidth={compact ? 240 : 300}
            editing={editing}
            items={status.devices.map((d) => ({
              id: d.id,
              size: layout?.[d.id] ?? AUTO_SIZE,
              render: (fit: CardFit) => <DeviceCard d={d} compact={compact} fit={fit} />,
            }))}
            onResize={onResize}
          />
        </section>
      ) : null}
      {grouped.map(([cat, list]) => (
        <section key={cat} className="hl-section">
          {!compact ? <h2>{cat}</h2> : null}
          <CardGrid
            className="hl-grid"
            compact={compact}
            minWidth={compact ? 170 : 230}
            editing={editing}
            items={list.map((s) => ({
              id: s.id,
              size: layout?.[s.id] ?? AUTO_SIZE,
              render: (fit: CardFit) => <ServiceCard s={s} compact={compact} fit={fit} editing={editing} />,
            }))}
            onResize={onResize}
          />
        </section>
      ))}
    </div>
  );
}

// ---------- Grille de modules redimensionnables ----------
// 120 colonnes (1/2, 1/3, 1/4, 1/5, 1/6 et 1/8 de rangée tombent juste) et des rangées de 4 px : la largeur (en % de la
// rangée) et la hauteur (en px) se règlent librement, et les modules s'emboîtent sans laisser de trou.

const COLS = 120;
const ROW = 4;
const DIVISORS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60, 120];
/** Largeurs « aimantées » (en colonnes) : quart, tiers, moitié… */
const SNAP_SPANS = [15, 20, 24, 30, 40, 48, 60, 72, 80, 90, 96, 120];
/** En dessous de cette largeur (téléphone), un module par ligne. */
const STACK_BELOW = 560;

type GridItem = { id: string; size: CardSize; render: (fit: CardFit) => ReactNode };
type Geometry = { colW: number; gap: number; stacked: boolean; autoSpan: number; minSpan: number };
type Live = { span?: number; h?: number };

function useElementWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function CardGrid({
  className,
  items,
  compact,
  minWidth,
  editing,
  onResize,
}: {
  className: string;
  items: GridItem[];
  compact: boolean;
  /** Largeur minimale d'un module en taille automatique (px). */
  minWidth: number;
  editing: boolean;
  onResize?: (id: string, size: CardSize) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // La grille déborde de l'espacement à droite : chaque cellule porte son espacement.
  const gridWidth = useElementWidth(ref);
  const gap = compact ? 6 : 10;
  const geo = useMemo<Geometry>(() => {
    const colW = gridWidth / COLS;
    const stacked = gridWidth < STACK_BELOW;
    const perRow = Math.max(1, Math.floor(gridWidth / (minWidth + gap)));
    const divisor = [...DIVISORS].reverse().find((d) => d <= perRow) ?? 1;
    const minPx = compact ? 120 : 150;
    return {
      colW,
      gap,
      stacked,
      autoSpan: stacked ? COLS : COLS / divisor,
      minSpan: colW > 0 ? Math.min(COLS, Math.ceil((minPx + gap) / colW)) : 1,
    };
  }, [gridWidth, gap, minWidth, compact]);
  return (
    <div className={className} ref={ref} style={{ '--hl-gap': `${gap}px` } as CSSProperties}>
      {gridWidth > 0
        ? items.map((it) => <CardCell key={it.id} item={it} geo={geo} editing={editing && Boolean(onResize)} onResize={onResize} />)
        : null}
    </div>
  );
}

function sizeLabel(pct: number | undefined, height: number | undefined): string {
  return `${pct === undefined ? 'auto' : `${pct} %`} × ${height === undefined ? 'auto' : `${height} px`}`;
}

function CardCell({ item, geo, editing, onResize }: { item: GridItem; geo: Geometry; editing: boolean; onResize?: (id: string, size: CardSize) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState(0);
  const [live, setLive] = useState<Live | null>(null);
  const liveRef = useRef<Live | null>(null);
  const drag = useRef<{ axis: 'x' | 'y' | 'xy'; x: number; y: number; span: number; h: number } | null>(null);

  const clampSpan = (n: number) => (geo.stacked ? COLS : Math.min(COLS, Math.max(geo.minSpan, Math.round(n))));
  const storedSpan = item.size.w !== undefined ? (item.size.w / 100) * COLS : geo.autoSpan;
  const span = clampSpan(live?.span ?? storedSpan);
  const fixedH = live?.h ?? item.size.h;
  const width = Math.max(0, span * geo.colW - geo.gap);

  // Hauteur naturelle du module (hauteur automatique) : détermine le nombre de rangées occupées.
  useLayoutEffect(() => {
    const el = boxRef.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const measure = () => setNatural(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rows = Math.max(1, Math.ceil(((fixedH ?? natural) + geo.gap) / ROW));

  const commit = (size: CardSize) => {
    if (size.w !== item.size.w || size.h !== item.size.h) onResize?.(item.id, size);
  };

  const start = (axis: 'x' | 'y' | 'xy') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { axis, x: e.clientX, y: e.clientY, span, h: fixedH ?? natural };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next: Live = {};
    if (d.axis !== 'y') {
      const raw = clampSpan(d.span + (e.clientX - d.x) / geo.colW);
      next.span = SNAP_SPANS.find((v) => v >= geo.minSpan && Math.abs(v - raw) <= 2) ?? raw;
    }
    if (d.axis !== 'x') next.h = clampCardHeight(Math.round((d.h + e.clientY - d.y) / ROW) * ROW);
    liveRef.current = next;
    setLive(next);
  };
  const end = () => {
    const d = drag.current;
    const next = liveRef.current;
    drag.current = null;
    liveRef.current = null;
    setLive(null);
    if (!d || !next) return;
    const size: CardSize = { ...item.size };
    if (next.span !== undefined && next.span !== d.span) size.w = clampCardWidth((next.span / COLS) * 100);
    if (next.h !== undefined && next.h !== d.h) size.h = next.h;
    commit(size);
  };
  // Clavier (poignée d'angle) : flèches = petits pas, Maj + flèches = grands pas.
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const big = e.shiftKey;
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !geo.stacked) {
      const s = clampSpan(span + (e.key === 'ArrowRight' ? 1 : -1) * (big ? 12 : 2));
      commit({ ...item.size, w: clampCardWidth((s / COLS) * 100) });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      commit({ ...item.size, h: clampCardHeight((fixedH ?? natural) + (e.key === 'ArrowDown' ? 1 : -1) * (big ? 40 : 8)) });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const reset = () => commit({});

  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  const pct = item.size.w === undefined && live?.span === undefined ? undefined : Math.round((span / COLS) * 100);
  return (
    <div
      className={`hl-cell${editing ? ' hl-cell--editing' : ''}${live ? ' hl-cell--resizing' : ''}`}
      style={{ gridColumn: `span ${span}`, gridRow: `span ${rows}` }}
      data-card-id={item.id}
    >
      <div className="hl-cell-box" ref={boxRef}>
        {item.render({ width, height: fixedH })}
        {editing ? (
          <>
            <div className="hl-size-badge">{sizeLabel(pct, fixedH)}</div>
            {!geo.stacked ? <div className="hl-rs hl-rs--x" title="Glisser pour changer la largeur" onPointerDown={start('x')} {...handlers} /> : null}
            <div className="hl-rs hl-rs--y" title="Glisser pour changer la hauteur" onPointerDown={start('y')} {...handlers} />
            <div
              className="hl-grip"
              role="button"
              tabIndex={0}
              aria-label={`Taille du module : ${sizeLabel(pct, fixedH)}. Flèches pour ajuster, double-clic pour la taille automatique.`}
              title="Glisser pour redimensionner · double-clic : taille automatique"
              onPointerDown={start(geo.stacked ? 'y' : 'xy')}
              onDoubleClick={reset}
              onKeyDown={onKey}
              {...handlers}
            >
              <Icon name="gripCorner" size={16} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
