import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, serverBase } from '../lib/api';
import {
  CATEGORIES,
  formatBytes,
  formatStat,
  formatUptime,
  deviceVisual,
  serviceVisual,
  type DeviceStatus,
  type Gauge,
  type HomelabStatus,
  type ServiceStatus,
  type StatValue,
} from '../lib/homelab';
import { AppTile, Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

type PanelProps = { compact?: boolean; refreshSeconds?: number; onConfigure?: () => void; configured: boolean };

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

export function ServiceCard({ s, compact }: { s: ServiceStatus; compact?: boolean }) {
  const open = () => s.url && window.open(s.url, '_blank', 'noopener');
  return (
    <button type="button" className={`hl-card hl-service${s.ok ? '' : ' hl-service--down'}${compact ? ' hl-card--compact' : ''}`} onClick={open} title={s.url}>
      <div className="hl-service-head">
        <VisualTile v={serviceVisual(s)} size={compact ? 26 : 32} />
        <span className="hl-service-name">{s.name || s.type}</span>
        <span className={`hl-dot${s.ok ? ' hl-dot--up' : ' hl-dot--down'}`} title={s.ok ? 'En ligne' : 'Hors ligne'} />
        {s.latency != null ? <span className="hl-latency">{s.latency} ms</span> : null}
      </div>
      {!compact && s.stats.length ? (
        <div className="hl-chips">
          {s.stats.slice(0, 4).map((st) => (
            <StatChip key={st.label} s={st} />
          ))}
        </div>
      ) : null}
      {s.error ? <div className="hl-error">{s.error}</div> : null}
      {!compact && s.version ? <div className="hl-version">v{s.version}</div> : null}
    </button>
  );
}

export function DeviceCard({ d, compact }: { d: DeviceStatus; compact?: boolean }) {
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
export function HomelabPanel({ compact = false, refreshSeconds = 30, onConfigure, configured }: PanelProps) {
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
    <div className={`hl-panel${compact ? ' hl-panel--compact' : ''}`}>
      <div className="hl-toolbar">
        <span className="nb-muted">
          {status ? `Actualisé il y a ${ago} s` : loading ? 'Interrogation…' : ''}
          {status && downCount ? <span className="hl-down-count"> · {downCount} hors ligne</span> : null}
        </span>
        <span className="nb-row nb-gap">
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
          <div className="hl-grid hl-grid--devices">
            {status.devices.map((d) => (
              <DeviceCard key={d.id} d={d} compact={compact} />
            ))}
          </div>
        </section>
      ) : null}
      {grouped.map(([cat, list]) => (
        <section key={cat} className="hl-section">
          {!compact ? <h2>{cat}</h2> : null}
          <div className="hl-grid">
            {list.map((s) => (
              <ServiceCard key={s.id} s={s} compact={compact} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
