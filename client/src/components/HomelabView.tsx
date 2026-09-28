import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { api, serverBase } from '../lib/api';
import {
  CATEGORIES,
  formatBytes,
  formatStat,
  formatUptime,
  MAX_CARD_H,
  MAX_CARD_W,
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
  /** Taille de chaque module (colonnes × hauteur), indexée par identifiant. */
  layout?: Record<string, CardSize>;
  /** Fourni quand les modules peuvent être redimensionnés depuis ce panneau. */
  onResize?: (id: string, size: CardSize) => void;
  onResetLayout?: () => void;
  /** Change quand la configuration change : le panneau se réactualise aussitôt. */
  refreshKey?: string;
};

const DEFAULT_SIZE: CardSize = { w: 1, h: 1 };

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

export function ServiceCard({ s, compact, size = DEFAULT_SIZE, editing = false }: { s: ServiceStatus; compact?: boolean; size?: CardSize; editing?: boolean }) {
  const open = () => !editing && s.url && window.open(s.url, '_blank', 'noopener');
  const area = size.w * size.h;
  // Un module agrandi affiche plus de statistiques.
  const maxStats = compact ? (area > 1 ? 4 * area : 0) : area > 1 ? 12 : 4;
  return (
    <button
      type="button"
      className={`hl-card hl-service${s.ok ? '' : ' hl-service--down'}${compact ? ' hl-card--compact' : ''}`}
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
      {maxStats > 0 && s.stats.length ? (
        <div className="hl-chips">
          {s.stats.slice(0, maxStats).map((st) => (
            <StatChip key={st.label} s={st} />
          ))}
        </div>
      ) : null}
      {s.error ? <div className="hl-error">{s.error}</div> : null}
      {(!compact || area > 1) && s.version ? <div className="hl-version">v{s.version}</div> : null}
    </button>
  );
}

export function DeviceCard({ d, compact: compactView, size = DEFAULT_SIZE }: { d: DeviceStatus; compact?: boolean; size?: CardSize }) {
  const compact = compactView && size.w * size.h === 1;
  const cpuGauge: Gauge | null = d.cpu != null ? { total: 0, used: 0, percent: d.cpu } : null;
  return (
    <div className={`hl-card hl-device${d.ok ? '' : ' hl-device--down'}`}>
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
          <GaugeBar label="CPU" gauge={cpuGauge} hint={d.cpu != null ? `${d.cpu.toFixed(0)} %${d.load?.length ? ` · charge ${d.load.slice(0, 3).join(' / ')}` : ''}` : undefined} />
          {d.cpu == null && d.load?.length ? <div className="hl-device-meta">Charge : {d.load.slice(0, 3).join(' / ')}</div> : null}
          <GaugeBar label="Mémoire" gauge={d.memory} hint={d.memory && !d.memory.total && d.memory.percent != null ? `${d.memory.percent.toFixed(0)} %` : undefined} />
          {!compact ? <GaugeBar label="Swap" gauge={d.swap && d.swap.total ? d.swap : null} /> : null}
          {(d.disks ?? []).slice(0, compact ? 2 : 12).map((disk) => (
            <GaugeBar key={disk.name} label={disk.name} gauge={disk.error ? null : disk} warn={disk.warn} />
          ))}
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
        <p>Le tableau de bord interroge vos applications depuis le serveur Notes (accès au réseau local, pas de problème de CORS).</p>
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
          <Icon name="gripCorner" size={14} /> Tirez le coin inférieur droit d’un module pour changer sa largeur et sa hauteur.
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
            editing={editing}
            items={status.devices.map((d) => ({
              id: d.id,
              size: layout?.[d.id] ?? DEFAULT_SIZE,
              render: (size: CardSize) => <DeviceCard d={d} compact={compact} size={size} />,
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
            editing={editing}
            items={list.map((s) => ({
              id: s.id,
              size: layout?.[s.id] ?? DEFAULT_SIZE,
              render: (size: CardSize) => <ServiceCard s={s} compact={compact} size={size} editing={editing} />,
            }))}
            onResize={onResize}
          />
        </section>
      ))}
    </div>
  );
}

// ---------- Grille de modules redimensionnables ----------

type GridItem = { id: string; size: CardSize; render: (size: CardSize) => ReactNode };
type Metrics = { cols: number; colWidth: number; gap: number };

/** Mesure la grille réelle (nombre de colonnes, largeur d'une colonne, espacement). */
function useGridMetrics(ref: React.RefObject<HTMLDivElement | null>): Metrics {
  const [m, setM] = useState<Metrics>({ cols: 1, colWidth: 230, gap: 10 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const tracks = cs.gridTemplateColumns.split(' ').filter((t) => t.endsWith('px'));
      const next = { cols: Math.max(1, tracks.length), colWidth: parseFloat(tracks[0] ?? '230') || 230, gap: parseFloat(cs.columnGap) || 0 };
      setM((prev) => (prev.cols === next.cols && Math.abs(prev.colWidth - next.colWidth) < 1 && prev.gap === next.gap ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return m;
}

function CardGrid({ className, items, compact, editing, onResize }: { className: string; items: GridItem[]; compact: boolean; editing: boolean; onResize?: (id: string, size: CardSize) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const metrics = useGridMetrics(ref);
  const rowUnit = compact ? 96 : 150;
  return (
    <div className={className} ref={ref}>
      {items.map((it) => (
        <CardCell key={it.id} item={it} metrics={metrics} rowUnit={rowUnit} editing={editing && Boolean(onResize)} onResize={onResize} />
      ))}
    </div>
  );
}

const clampInt = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

function CardCell({ item, metrics, rowUnit, editing, onResize }: { item: GridItem; metrics: Metrics; rowUnit: number; editing: boolean; onResize?: (id: string, size: CardSize) => void }) {
  const [live, setLive] = useState<CardSize | null>(null);
  const liveRef = useRef<CardSize | null>(null);
  const drag = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const maxW = Math.min(MAX_CARD_W, metrics.cols);
  const size = live ?? item.size;
  const w = clampInt(size.w, 1, maxW);
  const h = clampInt(size.h, 1, MAX_CARD_H);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { x: e.clientX, y: e.clientY, w, h };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = {
      w: clampInt(d.w + (e.clientX - d.x) / (metrics.colWidth + metrics.gap), 1, maxW),
      h: clampInt(d.h + (e.clientY - d.y) / (rowUnit + metrics.gap), 1, MAX_CARD_H),
    };
    liveRef.current = next;
    setLive((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    const next = liveRef.current;
    liveRef.current = null;
    setLive(null);
    if (d && next && (next.w !== d.w || next.h !== d.h)) onResize?.(item.id, next);
  };

  const style = {
    gridColumn: `span ${w}`,
    minHeight: h > 1 ? h * rowUnit + (h - 1) * metrics.gap : undefined,
  };
  return (
    <div className={`hl-cell${editing ? ' hl-cell--editing' : ''}${live ? ' hl-cell--resizing' : ''}`} style={style}>
      {item.render({ w, h })}
      {editing ? (
        <>
          <div className="hl-size-badge">
            {w} × {h}
          </div>
          <div
            className="hl-grip"
            role="slider"
            aria-label="Taille du module"
            aria-valuetext={`${w} colonne(s), hauteur ${h}`}
            title="Glisser pour redimensionner"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            <Icon name="gripCorner" size={16} />
          </div>
        </>
      ) : null}
    </div>
  );
}
