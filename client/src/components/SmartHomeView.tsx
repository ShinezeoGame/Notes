import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { api, serverBase } from '../lib/api';
import {
  CATEGORIES,
  LIGHT_PRESETS,
  brightnessPct,
  categoryOf,
  coverSupports,
  entityIcon,
  formatState,
  formatValue,
  groupBrightness,
  groupBrightnessCalls,
  groupByArea,
  groupColorCalls,
  groupCoverCalls,
  groupHasCovers,
  groupHasSwitch,
  groupIcon,
  groupLabel,
  groupMembers,
  groupSwitchCalls,
  hexToRgb,
  hvacLabel,
  isActive,
  isAlert,
  isGroupActive,
  isGroupId,
  isHomeConfigured,
  isSwitchedOn,
  isToggleable,
  isUnavailable,
  kelvinToCss,
  lightColor,
  rgbToHex,
  saveEntityOrder,
  saveFavoritesOrder,
  supportsBrightness,
  supportsColor,
  supportsColorTemp,
  toggleCommand,
  toggleInList,
  updateHomeConfig,
  useHomeConfig,
  type CategoryKey,
  type HomeCall,
  type HomeEntity,
  type HomeGroup,
  type HomeStates,
} from '../lib/smarthome';
import { reorderSubset, useSortable, type SortItemProps } from '../lib/sortable';
import { Icon } from '../icons/Icon';
import { Modal } from './Modal';
import { SmartHomeConfigDialog } from './SmartHomeConfigDialog';
import { SmartHomeGroupDialog } from './SmartHomeGroupDialog';
import { toast } from './Toast';
import { t, tn, tx, tServer, locale } from '../lib/i18n';

type Run = (e: HomeEntity, service: string, data?: Record<string, unknown>, optimistic?: Partial<HomeEntity>) => Promise<boolean>;
/** Commandes de groupe : plusieurs appareils à la fois (un appel par type d'appareil). */
type RunMany = (calls: HomeCall[]) => Promise<boolean>;
type EntityPatch = Partial<HomeEntity> & { id: string };

/** Classe de l'élément racine, complétée de celle du glisser-déposer. */
const withSort = (cls: string, sort?: SortItemProps) => (sort?.className ? `${cls} ${sort.className}` : cls);

// ---------- États : interrogation régulière + commandes avec affichage immédiat ----------

function useHomeStates(enabled: boolean) {
  const [data, setData] = useState<HomeStates | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Chaque commande incrémente la version : une réponse lancée avant elle est ignorée (pas de retour en arrière visible).
  const version = useRef(0);

  const refresh = useCallback(async () => {
    const v = version.current;
    setLoading(true);
    try {
      const r = await api.homeStates();
      if (v !== version.current) return;
      setData(r);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Serveur injoignable.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 4000);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  const patch = useCallback((changes: EntityPatch[]) => {
    setData((prev) => {
      if (!prev) return prev;
      const byId = new Map(changes.map((c) => [c.id, c]));
      return { ...prev, entities: prev.entities.map((e) => (byId.has(e.id) ? { ...e, ...byId.get(e.id), attrs: { ...e.attrs, ...(byId.get(e.id)!.attrs ?? {}) } } : e)) };
    });
  }, []);

  const run: Run = useCallback(
    async (e, service, data, optimistic) => {
      version.current++;
      if (optimistic) patch([{ ...optimistic, id: e.id }]);
      let ok = true;
      try {
        const res = await api.homeCall(e.id, service, data);
        version.current++;
        if (res.entities.length) patch(res.entities);
      } catch (err) {
        ok = false;
        toast(err instanceof Error ? err.message : t('Commande impossible.'), 'error');
        version.current++;
      }
      // Certains appareils confirment après coup : nouvelle lecture peu après.
      setTimeout(() => void refresh(), 1200);
      return ok;
    },
    [patch, refresh],
  );

  const runMany: RunMany = useCallback(
    async (calls) => {
      if (!calls.length) return true;
      version.current++;
      patch(calls.flatMap((c) => (c.optimistic ? c.ids.map((id) => ({ ...c.optimistic, id })) : [])));
      const results = await Promise.allSettled(calls.map((c) => api.homeCall(c.ids, c.service, c.data)));
      version.current++;
      const changed = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.entities : []));
      if (changed.length) patch(changed);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) toast(failed.reason instanceof Error ? failed.reason.message : t('Commande impossible.'), 'error');
      setTimeout(() => void refresh(), 1200);
      return !failed;
    },
    [patch, refresh],
  );

  return { data, loading, error, refresh, run, runMany };
}

/** Valeur de curseur envoyée après une courte pause (pas une commande par pixel). */
function useSlider(value: number, commit: (v: number) => void, delay = 350) {
  const [local, setLocal] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const onChange = (v: number) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      commit(v);
      setTimeout(() => setLocal(null), 1500);
    }, delay);
  };
  return [local ?? value, onChange] as const;
}

// ---------- Éléments d'interface ----------

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`sh-switch${checked ? ' sh-switch--on' : ''}`}
      onClick={(ev) => {
        ev.stopPropagation();
        onChange();
      }}
      disabled={disabled}
    />
  );
}

function Slider({ value, min, max, step = 1, onChange, label, suffix = '%', style }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; suffix?: string; style?: CSSProperties }) {
  // Piste remplie jusqu'à la valeur (sauf dégradé fourni, ex. température de couleur).
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const track = { '--sh-track': `linear-gradient(90deg, var(--accent) ${pct}%, var(--bg-active) ${pct}%)`, ...style } as CSSProperties;
  return (
    <label className="sh-slider" style={track}>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(ev) => onChange(Number(ev.target.value))} />
      <span className="sh-slider-value">
        {formatValue(value)}
        {suffix ? ` ${suffix}` : ''}
      </span>
    </label>
  );
}

function BrightnessSlider({ e, run }: { e: HomeEntity; run: Run }) {
  const pct = brightnessPct(e) ?? 100;
  const [value, setValue] = useSlider(pct, (v) => void run(e, 'turn_on', { brightness_pct: v }, { state: 'on', attrs: { brightness: Math.round((v / 100) * 255) } }));
  return <Slider value={value} min={1} max={100} onChange={setValue} label={t('Luminosité de {name}', { name: e.name })} />;
}

function TargetTemperature({ e, run }: { e: HomeEntity; run: Run }) {
  const a = e.attrs;
  const step = typeof a.target_temp_step === 'number' ? a.target_temp_step : 0.5;
  const min = typeof a.min_temp === 'number' ? a.min_temp : 7;
  const max = typeof a.max_temp === 'number' ? a.max_temp : 30;
  const target = typeof a.temperature === 'number' ? a.temperature : null;
  const [value, setValue] = useSlider(target ?? 20, (v) => void run(e, 'set_temperature', { temperature: v }, { attrs: { temperature: v } }), 700);
  if (target === null) return null;
  const nudge = (d: number) => setValue(Math.min(max, Math.max(min, Math.round((value + d) / step) * step)));
  return (
    <div className="sh-temp">
      <button type="button" className="sh-round" onClick={() => nudge(-step)} aria-label={t('Baisser la consigne')} disabled={isUnavailable(e)}>
        <Icon name="minus" size={16} />
      </button>
      <span className="sh-temp-value" title={t('Consigne')}>
        {formatValue(value, '°C')}
      </span>
      <button type="button" className="sh-round" onClick={() => nudge(step)} aria-label={t('Monter la consigne')} disabled={isUnavailable(e)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function CoverButtons({ e, run }: { e: HomeEntity; run: Run }) {
  const valve = e.domain === 'valve';
  const svc = (name: string) => (valve ? `${name}_valve` : `${name}_cover`); // i18n-ignore : services de Home Assistant
  const off = isUnavailable(e);
  return (
    <div className="sh-buttons">
      {coverSupports(e, 'OPEN') ? (
        <button
          type="button"
          className="sh-round"
          onClick={() => void run(e, svc('open'), undefined, { state: 'opening' })}
          aria-label={t('Ouvrir')}
          disabled={off}
        >
          <Icon name="chevronUp" size={16} />
        </button>
      ) : null}
      {coverSupports(e, 'STOP') ? (
        <button type="button" className="sh-round" onClick={() => void run(e, svc('stop'))} aria-label={t('Arrêter')} disabled={off}>
          <Icon name="stop" size={14} />
        </button>
      ) : null}
      {coverSupports(e, 'CLOSE') ? (
        <button
          type="button"
          className="sh-round"
          onClick={() => void run(e, svc('close'), undefined, { state: 'closing' })}
          aria-label={t('Fermer')}
          disabled={off}
        >
          <Icon name="chevronDown" size={16} />
        </button>
      ) : null}
    </div>
  );
}

function MediaButtons({ e, run }: { e: HomeEntity; run: Run }) {
  const off = isUnavailable(e) || e.state === 'off';
  const playing = e.state === 'playing';
  return (
    <div className="sh-buttons">
      <button
        type="button"
        className="sh-round"
        onClick={() => void run(e, 'media_play_pause', undefined, { state: playing ? 'paused' : 'playing' })}
        aria-label={playing ? t('Pause') : t('Lecture')}
        disabled={off}
      >
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <button type="button" className="sh-round" onClick={() => void run(e, 'media_next_track')} aria-label={t('Titre suivant')} disabled={off}>
        <Icon name="skipNext" size={16} />
      </button>
    </div>
  );
}

function LockButton({ e, run }: { e: HomeEntity; run: Run }) {
  const locked = e.state === 'locked';
  return (
    <button
      type="button"
      className="nb-btn nb-btn--sm"
      disabled={isUnavailable(e)}
      onClick={() => {
        if (locked && !confirm(t('Déverrouiller « {name} » ?', { name: e.name }))) return;
        void run(e, locked ? 'unlock' : 'lock', undefined, { state: locked ? 'unlocking' : 'locking' });
      }}
    >
      <Icon name={locked ? 'unlock' : 'lock'} size={14} /> {locked ? t('Déverrouiller') : t('Verrouiller')}
    </button>
  );
}

function CameraImage({ e, onOpen, large = false }: { e: HomeEntity; onOpen?: () => void; large?: boolean }) {
  const base = serverBase() ?? '';
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  if (!e.snapshot) return null;
  return (
    <button
      type="button"
      className={`sh-camera${large ? ' sh-camera--large' : ''}`}
      onClick={onOpen}
      aria-label={t('Voir {name} en direct', { name: e.name })}
    >
      {failed ? (
        <span className="sh-camera-empty">{t('Image indisponible')}</span>
      ) : (
        <img src={`${base}${e.snapshot}&_=${tick}`} alt={e.name} onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
      )}
      <span className="sh-camera-live">
        <Icon name="play" size={14} /> {t('Direct')}
      </span>
    </button>
  );
}

// ---------- Tuile d'un appareil ----------

function EntityCard({ e, run, onOpen, onLive, compact, sort }: { e: HomeEntity; run: Run; onOpen: () => void; onLive: () => void; compact: boolean; sort?: SortItemProps }) {
  const active = isActive(e);
  const alert = isAlert(e);
  const off = isUnavailable(e);
  const color = lightColor(e);
  const toggle = () => {
    const cmd = toggleCommand(e);
    void run(e, cmd.service, cmd.data, cmd.optimistic);
  };
  const quick = () => {
    if (e.domain === 'scene' || e.domain === 'script') void run(e, 'turn_on').then((ok) => ok && toast(t('« {name} » lancé.', { name: e.name })));
    else if (e.domain === 'button' || e.domain === 'input_button')
      void run(e, 'press').then((ok) => ok && toast(t('« {name} » : appui envoyé.', { name: e.name })));
  };
  const style = color ? ({ '--sh-glow': color } as CSSProperties) : undefined;
  const cls = `sh-card sh-card--${e.domain}${active ? ' sh-card--on' : ''}${alert ? ' sh-card--alert' : ''}${off ? ' sh-card--unavailable' : ''}${color ? ' sh-card--colored' : ''}`;

  let body: ReactNode = null;
  if (!compact || e.domain === 'camera') {
    if (e.domain === 'light' && e.state === 'on' && supportsBrightness(e)) body = <BrightnessSlider e={e} run={run} />;
    else if (e.domain === 'fan' && e.state === 'on' && typeof e.attrs.percentage === 'number') body = <FanSlider e={e} run={run} />;
    else if (e.domain === 'cover' || e.domain === 'valve') body = <CoverButtons e={e} run={run} />;
    else if (e.domain === 'climate' && e.state !== 'off') body = <TargetTemperature e={e} run={run} />;
    else if (e.domain === 'media_player' && e.state !== 'off') body = <MediaButtons e={e} run={run} />;
    else if (e.domain === 'lock') body = <LockButton e={e} run={run} />;
    else if (e.domain === 'camera') body = <CameraImage e={e} onOpen={onLive} />;
    else if (e.domain === 'vacuum') body = <VacuumButtons e={e} run={run} />;
  }

  return (
    <div {...sort} className={withSort(cls, sort)} style={style} data-entity={e.id}>
      <div className="sh-card-head">
        <button
          type="button"
          className="sh-tile"
          onClick={isToggleable(e) ? toggle : e.domain === 'camera' ? onLive : quick}
          disabled={off}
          aria-label={isToggleable(e) ? `${e.state === 'on' ? t('Éteindre') : t('Allumer')} ${e.name}` : e.name}
        >
          <Icon name={entityIcon(e)} size={20} />
        </button>
        <button type="button" className="sh-card-title" onClick={onOpen}>
          <span className="sh-name">{e.name}</span>
          <span className="sh-state">
            {formatState(e) || (e.domain === 'scene' ? t('Scène') : e.domain === 'script' ? t('Action') : t('Bouton'))}
          </span>
        </button>
        {isToggleable(e) ? (
          <Switch
            checked={e.domain === 'climate' ? e.state !== 'off' : e.state === 'on'}
            onChange={toggle}
            disabled={off}
            label={t('{name} : marche / arrêt', { name: e.name })}
          />
        ) : null}
        {['scene', 'script', 'button', 'input_button'].includes(e.domain) ? (
          <button type="button" className="nb-btn nb-btn--sm" onClick={quick} disabled={off}>
            {e.domain === 'button' || e.domain === 'input_button' ? t('Appuyer') : t('Lancer')}
          </button>
        ) : null}
      </div>
      {body ? <div className="sh-card-body">{body}</div> : null}
    </div>
  );
}

function FanSlider({ e, run }: { e: HomeEntity; run: Run }) {
  const pct = typeof e.attrs.percentage === 'number' ? e.attrs.percentage : 0;
  const step = typeof e.attrs.percentage_step === 'number' && e.attrs.percentage_step > 1 ? e.attrs.percentage_step : 1;
  const [value, setValue] = useSlider(Math.round(pct), (v) => void run(e, 'set_percentage', { percentage: v }, { attrs: { percentage: v } }));
  return (
    <Slider
      value={value}
      min={0}
      max={100}
      step={step > 1 ? Math.round(step) : 1}
      onChange={setValue}
      label={t('Vitesse de {name}', { name: e.name })}
    />
  );
}

function VacuumButtons({ e, run }: { e: HomeEntity; run: Run }) {
  const cleaning = e.state === 'cleaning';
  const off = isUnavailable(e);
  return (
    <div className="sh-buttons">
      <button type="button" className="nb-btn nb-btn--sm" onClick={() => void run(e, cleaning ? 'pause' : 'start', undefined, { state: cleaning ? 'paused' : 'cleaning' })} disabled={off}>
        <Icon name={cleaning ? 'pause' : 'play'} size={14} /> {cleaning ? t('Pause') : t('Démarrer')}
      </button>
      <button
        type="button"
        className="nb-btn nb-btn--sm"
        onClick={() => void run(e, 'return_to_base', undefined, { state: 'returning' })}
        disabled={off}
      >
        <Icon name="home" size={14} /> {t('Base')}
      </button>
    </div>
  );
}

// ---------- Groupes ----------

function GroupBrightness({ members, runMany }: { members: HomeEntity[]; runMany: RunMany }) {
  const [value, setValue] = useSlider(groupBrightness(members) ?? 100, (v) => void runMany(groupBrightnessCalls(members, v)));
  return <Slider value={value} min={1} max={100} onChange={setValue} label={t('Luminosité du groupe')} />;
}

function GroupCoverButtons({ members, runMany }: { members: HomeEntity[]; runMany: RunMany }) {
  return (
    <div className="sh-buttons">
      <button
        type="button"
        className="sh-round"
        onClick={() => void runMany(groupCoverCalls(members, 'open'))}
        aria-label={t('Tout ouvrir')}
        title={t('Tout ouvrir')}
      >
        <Icon name="chevronUp" size={16} />
      </button>
      <button
        type="button"
        className="sh-round"
        onClick={() => void runMany(groupCoverCalls(members, 'stop'))}
        aria-label={t('Tout arrêter')}
        title={t('Tout arrêter')}
      >
        <Icon name="stop" size={14} />
      </button>
      <button
        type="button"
        className="sh-round"
        onClick={() => void runMany(groupCoverCalls(members, 'close'))}
        aria-label={t('Tout fermer')}
        title={t('Tout fermer')}
      >
        <Icon name="chevronDown" size={16} />
      </button>
    </div>
  );
}

const anyOn = (members: HomeEntity[]) => members.some((e) => !isUnavailable(e) && isToggleable(e) && isSwitchedOn(e));

/** Tuile d'un groupe : l'interrupteur allume tout (ou éteint tout dès qu'un appareil est allumé). */
function GroupCard({ g, members, runMany, onOpen, compact, sort }: { g: HomeGroup; members: HomeEntity[]; runMany: RunMany; onOpen: () => void; compact: boolean; sort?: SortItemProps }) {
  const available = members.some((e) => !isUnavailable(e));
  const hasSwitch = groupHasSwitch(members);
  const on = anyOn(members);
  const toggle = () => void runMany(groupSwitchCalls(members, !on));
  const color = members.map(lightColor).find(Boolean) ?? null;
  let body: ReactNode = null;
  if (!compact) {
    if (members.some((e) => e.domain === 'light' && e.state === 'on' && supportsBrightness(e))) body = <GroupBrightness members={members} runMany={runMany} />;
    else if (groupHasCovers(members)) body = <GroupCoverButtons members={members} runMany={runMany} />;
  }
  const cls = `sh-card sh-card--group${isGroupActive(members) ? ' sh-card--on' : ''}${available ? '' : ' sh-card--unavailable'}${color ? ' sh-card--colored' : ''}`;
  return (
    <div {...sort} className={withSort(cls, sort)} style={color ? ({ '--sh-glow': color } as CSSProperties) : undefined} data-group={g.id}>
      <div className="sh-card-head">
        <button
          type="button"
          className="sh-tile"
          onClick={hasSwitch ? toggle : onOpen}
          disabled={!available}
          aria-label={hasSwitch ? t('{action} : {name}', { action: on ? t('Tout éteindre') : t('Tout allumer'), name: g.name }) : g.name}
        >
          <Icon name={groupIcon(g, members)} size={20} />
          <span className="sh-group-badge" aria-hidden="true">
            {members.length}
          </span>
        </button>
        <button type="button" className="sh-card-title" onClick={onOpen}>
          <span className="sh-name">{g.name}</span>
          <span className="sh-state">{groupLabel(members)}</span>
        </button>
        {hasSwitch ? (
          <Switch checked={on} onChange={toggle} disabled={!available} label={t('{name} : tout allumer ou tout éteindre', { name: g.name })} />
        ) : null}
      </div>
      {body ? <div className="sh-card-body">{body}</div> : null}
    </div>
  );
}

function GroupDetail({
  g,
  members,
  run,
  runMany,
  favorite,
  onFavorite,
  onEdit,
  onDelete,
  onOpenEntity,
  onLive,
  onClose,
}: {
  g: HomeGroup;
  members: HomeEntity[];
  run: Run;
  runMany: RunMany;
  favorite: boolean;
  onFavorite?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenEntity: (id: string) => void;
  onLive: (id: string) => void;
  onClose: () => void;
}) {
  const hasSwitch = groupHasSwitch(members);
  const on = anyOn(members);
  const lights = members.filter((e) => e.domain === 'light' && !isUnavailable(e));
  const presets = LIGHT_PRESETS.filter((p) => (p.rgb ? lights.some(supportsColor) : lights.some((e) => supportsColorTemp(e) || supportsColor(e))));
  const missing = g.members.length - members.length;
  const rooms = [...new Set(members.map((e) => e.area).filter(Boolean))];
  return (
    <Modal
      title={g.name}
      onClose={onClose}
      width={640}
      footer={
        <>
          {onDelete ? (
            <button type="button" className="nb-btn nb-btn--sm nb-btn--danger sh-footer-start" onClick={onDelete}>
              <Icon name="trash" size={14} /> {t('Supprimer')}
            </button>
          ) : null}
          {onEdit ? (
            <button type="button" className="nb-btn nb-btn--sm" onClick={onEdit}>
              <Icon name="pencil" size={14} /> {t('Modifier')}
            </button>
          ) : null}
          {onFavorite ? (
            <button type="button" className={`nb-btn nb-btn--sm${favorite ? ' sh-fav--on' : ''}`} onClick={onFavorite} aria-pressed={favorite}>
              <Icon name="star" size={14} /> {favorite ? t('Retirer des favoris') : t('Ajouter aux favoris')}
            </button>
          ) : null}
        </>
      }
    >
      <div className="sh-detail">
        <div className="sh-detail-head">
          <span className={`sh-tile sh-tile--static${isGroupActive(members) ? ' sh-tile--on' : ''}`}>
            <Icon name={groupIcon(g, members)} size={22} />
          </span>
          <div className="sh-detail-title">
            <div className="sh-state-strong">{groupLabel(members)}</div>
            <div className="nb-muted">{[tn(members.length, '{n} appareil', '{n} appareils'), rooms.join(', ')].filter(Boolean).join(' · ')}</div>
          </div>
          {hasSwitch ? (
            <Switch
              checked={on}
              onChange={() => void runMany(groupSwitchCalls(members, !on))}
              label={t('{name} : tout allumer ou tout éteindre', { name: g.name })}
            />
          ) : null}
        </div>
        {hasSwitch ? (
          <div className="sh-buttons">
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => void runMany(groupSwitchCalls(members, true))}>
              <Icon name="bulb" size={14} /> {t('Tout allumer')}
            </button>
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => void runMany(groupSwitchCalls(members, false))}>
              <Icon name="power" size={14} /> {t('Tout éteindre')}
            </button>
          </div>
        ) : null}
        {lights.some(supportsBrightness) ? (
          <div className="sh-field">
            <span>{t('Luminosité de toutes les lampes')}</span>
            <GroupBrightness members={members} runMany={runMany} />
          </div>
        ) : null}
        {presets.length ? (
          <div className="sh-field">
            <span>{t('Couleur de toutes les lampes')}</span>
            <div className="sh-swatches">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="sh-swatch"
                  title={p.label}
                  aria-label={p.label}
                  style={{ background: p.rgb ? `rgb(${p.rgb.join(',')})` : kelvinToCss(p.kelvin!) }}
                  onClick={() => void runMany(groupColorCalls(members, p))}
                />
              ))}
            </div>
          </div>
        ) : null}
        {groupHasCovers(members) ? (
          <div className="sh-field">
            <span>{t('Volets')}</span>
            <GroupCoverButtons members={members} runMany={runMany} />
          </div>
        ) : null}
        <div className="sh-field">
          <span>{t('Appareils du groupe')}</span>
          <div className="sh-grid sh-grid--compact">
            {members.map((e) => (
              <EntityCard key={e.id} e={e} run={run} compact onOpen={() => onOpenEntity(e.id)} onLive={() => onLive(e.id)} />
            ))}
          </div>
          {missing > 0 ? (
            <p className="nb-muted">
              {tn(missing, '{n} appareil du groupe introuvable dans Home Assistant.', '{n} appareils du groupe introuvables dans Home Assistant.')}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

// ---------- Fiche détaillée ----------

function LightControls({ e, run }: { e: HomeEntity; run: Run }) {
  const [custom, setCustom] = useState(rgbToHex(e.attrs.rgb_color));
  const minK = typeof e.attrs.min_color_temp_kelvin === 'number' ? e.attrs.min_color_temp_kelvin : 2000;
  const maxK = typeof e.attrs.max_color_temp_kelvin === 'number' ? e.attrs.max_color_temp_kelvin : 6500;
  const kelvin = typeof e.attrs.color_temp_kelvin === 'number' ? e.attrs.color_temp_kelvin : Math.round((minK + maxK) / 2);
  const [temp, setTemp] = useSlider(kelvin, (k) => void run(e, 'turn_on', { color_temp_kelvin: k }, { state: 'on', attrs: { color_temp_kelvin: k } }));
  const presets = LIGHT_PRESETS.filter((p) => (p.rgb ? supportsColor(e) : supportsColorTemp(e) || supportsColor(e)));
  return (
    <>
      {supportsBrightness(e) ? (
        <div className="sh-field">
          <span>{t('Luminosité')}</span>
          <BrightnessSlider e={e} run={run} />
        </div>
      ) : null}
      {supportsColorTemp(e) ? (
        <div className="sh-field">
          <span>{t('Température de couleur')}</span>
          <Slider
            value={temp}
            min={minK}
            max={maxK}
            step={50}
            onChange={setTemp}
            label={t('Température de couleur')}
            suffix="K"
            style={{ '--sh-track': `linear-gradient(90deg, ${kelvinToCss(minK)}, ${kelvinToCss(maxK)})` } as CSSProperties}
          />
        </div>
      ) : null}
      {presets.length ? (
        <div className="sh-field">
          <span>{t('Couleur')}</span>
          <div className="sh-swatches">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className="sh-swatch"
                title={p.label}
                aria-label={p.label}
                style={{ background: p.rgb ? `rgb(${p.rgb.join(',')})` : kelvinToCss(p.kelvin!) }}
                onClick={() =>
                  void run(
                    e,
                    'turn_on',
                    p.rgb ? { rgb_color: p.rgb } : supportsColorTemp(e) ? { color_temp_kelvin: p.kelvin } : { rgb_color: [255, 214, 170] },
                    { state: 'on', attrs: p.rgb ? { rgb_color: p.rgb } : {} },
                  )
                }
              />
            ))}
            {supportsColor(e) ? (
              <label className="sh-swatch sh-swatch--custom" title={t('Autre couleur')}>
                <Icon name="palette" size={15} />
                <input
                  type="color"
                  value={custom}
                  aria-label={t('Autre couleur')}
                  onChange={(ev) => {
                    setCustom(ev.target.value);
                    const rgb = hexToRgb(ev.target.value);
                    if (rgb) void run(e, 'turn_on', { rgb_color: rgb }, { state: 'on', attrs: { rgb_color: rgb } });
                  }}
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ClimateControls({ e, run }: { e: HomeEntity; run: Run }) {
  const modes = Array.isArray(e.attrs.hvac_modes) ? (e.attrs.hvac_modes as string[]) : [];
  return (
    <>
      {typeof e.attrs.current_temperature === 'number' ? (
        <div className="sh-big">
          {formatValue(e.attrs.current_temperature, '°C')}
          {typeof e.attrs.current_humidity === 'number' ? (
            <span className="nb-muted"> · {t('{pct} %', { pct: e.attrs.current_humidity })}</span>
          ) : null}
        </div>
      ) : null}
      {e.state !== 'off' ? (
        <div className="sh-field">
          <span>{t('Consigne')}</span>
          <TargetTemperature e={e} run={run} />
        </div>
      ) : null}
      {modes.length ? (
        <div className="sh-field">
          <span>{t('Mode')}</span>
          <div className="sh-chips">
            {modes.map((m) => (
              <button key={m} type="button" className={`sh-chip${e.state === m ? ' sh-chip--active' : ''}`} onClick={() => void run(e, 'set_hvac_mode', { hvac_mode: m }, { state: m })}>
                {hvacLabel(m)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function CoverControls({ e, run }: { e: HomeEntity; run: Run }) {
  const pos = typeof e.attrs.current_position === 'number' ? e.attrs.current_position : null;
  const valve = e.domain === 'valve';
  const [value, setValue] = useSlider(pos ?? 0, (v) =>
    void run(e, valve ? 'set_valve_position' : 'set_cover_position', { position: v }, { attrs: { current_position: v } }),
  );
  return (
    <>
      <CoverButtons e={e} run={run} />
      {pos !== null && coverSupports(e, 'SET_POSITION') ? (
        <div className="sh-field">
          <span>{t('Ouverture')}</span>
          <Slider value={value} min={0} max={100} onChange={setValue} label={t('Ouverture')} />
        </div>
      ) : null}
    </>
  );
}

function MediaControls({ e, run }: { e: HomeEntity; run: Run }) {
  const vol = typeof e.attrs.volume_level === 'number' ? Math.round(e.attrs.volume_level * 100) : null;
  const [value, setValue] = useSlider(vol ?? 0, (v) => void run(e, 'volume_set', { volume_level: v / 100 }, { attrs: { volume_level: v / 100 } }));
  return (
    <>
      <MediaButtons e={e} run={run} />
      {vol !== null ? (
        <div className="sh-field">
          <span>{t('Volume')}</span>
          <Slider value={value} min={0} max={100} onChange={setValue} label={t('Volume')} />
        </div>
      ) : null}
    </>
  );
}

function timeAgo(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return t('à l’instant');
  if (s < 3600) return t('il y a {n} min', { n: Math.round(s / 60) });
  if (s < 86_400) return t('il y a {n} h', { n: Math.round(s / 3600) });
  return t('le {date}', { date: new Date(at).toLocaleDateString(locale()) });
}

function EntityDetail({
  e,
  run,
  favorite,
  hidden,
  onFavorite,
  onHide,
  onLive,
  onClose,
}: {
  e: HomeEntity;
  run: Run;
  favorite: boolean;
  hidden: boolean;
  onFavorite: () => void;
  onHide: () => void;
  onLive: () => void;
  onClose: () => void;
}) {
  let controls: ReactNode = null;
  if (e.domain === 'light') controls = <LightControls e={e} run={run} />;
  else if (e.domain === 'climate') controls = <ClimateControls e={e} run={run} />;
  else if (e.domain === 'cover' || e.domain === 'valve') controls = <CoverControls e={e} run={run} />;
  else if (e.domain === 'media_player') controls = <MediaControls e={e} run={run} />;
  else if (e.domain === 'fan' && e.state === 'on')
    controls = (
      <div className="sh-field">
        <span>{t('Vitesse')}</span>
        <FanSlider e={e} run={run} />
      </div>
    );
  else if (e.domain === 'lock') controls = <LockButton e={e} run={run} />;
  else if (e.domain === 'vacuum') controls = <VacuumButtons e={e} run={run} />;
  else if (e.domain === 'camera') controls = <CameraImage e={e} onOpen={onLive} large />;
  else if (e.domain === 'sensor' || e.domain === 'binary_sensor') controls = <div className="sh-big">{formatState(e)}</div>;

  const toggle = () => {
    const cmd = toggleCommand(e);
    void run(e, cmd.service, cmd.data, cmd.optimistic);
  };
  return (
    <Modal
      title={e.name}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button
            type="button"
            className="nb-btn nb-btn--sm"
            onClick={onHide}
            title={hidden ? t('Afficher de nouveau cet appareil dans la liste') : t('Ne plus afficher cet appareil dans la liste')}
          >
            <Icon name={hidden ? 'eye' : 'eyeOff'} size={14} /> {hidden ? t('Réafficher') : t('Masquer')}
          </button>
          <button type="button" className={`nb-btn nb-btn--sm${favorite ? ' sh-fav--on' : ''}`} onClick={onFavorite} aria-pressed={favorite}>
            <Icon name="star" size={14} /> {favorite ? t('Retirer des favoris') : t('Ajouter aux favoris')}
          </button>
        </>
      }
    >
      <div className="sh-detail">
        <div className="sh-detail-head">
          <span className={`sh-tile sh-tile--static${isActive(e) ? ' sh-tile--on' : ''}${isAlert(e) ? ' sh-tile--alert' : ''}`} style={lightColor(e) ? ({ '--sh-glow': lightColor(e) } as CSSProperties) : undefined}>
            <Icon name={entityIcon(e)} size={22} />
          </span>
          <div className="sh-detail-title">
            <div className="sh-state-strong">{formatState(e) || t('Prêt')}</div>
            <div className="nb-muted">
              {[
                e.area,
                e.changedAt && !['scene', 'script', 'button', 'input_button'].includes(e.domain)
                  ? t('modifié {ago}', { ago: timeAgo(e.changedAt) })
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          {isToggleable(e) ? (
            <Switch
              checked={e.domain === 'climate' ? e.state !== 'off' : e.state === 'on'}
              onChange={toggle}
              disabled={isUnavailable(e)}
              label={t('{name} : marche / arrêt', { name: e.name })}
            />
          ) : null}
        </div>
        {controls}
      </div>
    </Modal>
  );
}

const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function CameraLive({ e, onClose }: { e: HomeEntity; onClose: () => void }) {
  const base = serverBase() ?? '';
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // Le navigateur garde le flux vidéo ouvert après la fermeture si l'image n'est pas vidée explicitement.
  useEffect(() => {
    const el = img.current;
    return () => {
      if (el) el.src = BLANK_IMAGE;
    };
  }, []);
  return (
    <Modal title={e.name} onClose={onClose} width={960}>
      <div className="sh-live">
        {e.stream && !failed ? (
          <img ref={img} src={`${base}${e.stream}`} alt={t('{name} en direct', { name: e.name })} onError={() => setFailed(true)} />
        ) : (
          <div className="sh-camera-empty">{t('Vidéo indisponible.')}</div>
        )}
      </div>
    </Modal>
  );
}

// ---------- Panneau principal (vue « Maison » et bloc dans une page) ----------

type Filter = 'all' | 'favorites' | CategoryKey;

/** Élément d'une grille : un appareil ou un groupe d'appareils. */
type Item = { id: string; kind: 'entity'; e: HomeEntity } | { id: string; kind: 'group'; g: HomeGroup; members: HomeEntity[] };

/** Grille d'appareils et de groupes, réordonnables par glisser-déposer quand `onReorder` est fourni. */
function TileGrid({ items, compact, onReorder, render }: { items: Item[]; compact: boolean; onReorder?: (ids: string[]) => void; render: (item: Item, sort: SortItemProps) => ReactNode }) {
  const ids = items.map((it) => it.id);
  const { order, itemProps } = useSortable(ids, (next) => onReorder?.(next), Boolean(onReorder));
  const byId = new Map(items.map((it) => [it.id, it]));
  return (
    <div className={`sh-grid${compact ? ' sh-grid--compact' : ''}`}>
      {order.map((id) => {
        const it = byId.get(id);
        return it ? render(it, itemProps(id)) : null;
      })}
    </div>
  );
}

export function SmartHomePanel({ doc, compact = false, favoritesOnly = false, canConfigure = true }: { doc: Y.Doc | null; compact?: boolean; favoritesOnly?: boolean; canConfigure?: boolean }) {
  const cfg = useHomeConfig(doc);
  const hasServer = Boolean(serverBase());
  const configured = isHomeConfigured(cfg);
  const { data, error, loading, run, runMany } = useHomeStates(hasServer && configured);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState<HomeGroup | 'new' | null>(null);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const onConfigure = canConfigure && doc ? () => setConfigOpen(true) : undefined;
  const configDialog = configOpen && doc ? <SmartHomeConfigDialog doc={doc} entities={data?.entities} onClose={() => setConfigOpen(false)} /> : null;

  const all = useMemo(() => data?.entities ?? [], [data]);
  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);
  const visible = useMemo(() => all.filter((e) => !cfg.hidden.includes(e.id)), [all, cfg.hidden]);
  const groups = useMemo(() => cfg.groups.map((g): Item => ({ id: g.id, kind: 'group', g, members: groupMembers(g, byId) })), [cfg.groups, byId]);
  const q = query.trim().toLowerCase();
  const matches = (it: Item) =>
    !q || (it.kind === 'group' ? it.g.name.toLowerCase().includes(q) : it.e.name.toLowerCase().includes(q) || it.e.area.toLowerCase().includes(q));
  const favorites = useMemo(() => {
    const visibleIds = new Set(visible.map((e) => e.id));
    const groupsById = new Map(groups.map((it) => [it.id, it]));
    return cfg.favorites
      .map((id): Item | undefined => (isGroupId(id) ? groupsById.get(id) : visibleIds.has(id) ? { id, kind: 'entity', e: byId.get(id)! } : undefined))
      .filter((it): it is Item => Boolean(it));
  }, [cfg.favorites, groups, visible, byId]);
  const counts = useMemo(() => {
    const m = new Map<CategoryKey, number>();
    for (const e of visible) m.set(categoryOf(e.domain), (m.get(categoryOf(e.domain)) ?? 0) + 1);
    return m;
  }, [visible]);
  const shown = useMemo(() => {
    let list = filter === 'all' || filter === 'favorites' ? visible : visible.filter((e) => categoryOf(e.domain) === filter);
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q) || e.area.toLowerCase().includes(q));
    return list;
  }, [filter, visible, q]);
  // Groupes : dans « Tout », et dans une catégorie quand tous leurs appareils en font partie (lumières…).
  const shownGroups = groups.filter(
    (it) => it.kind === 'group' && matches(it) && (filter === 'all' || (filter !== 'favorites' && it.members.length > 0 && it.members.every((e) => categoryOf(e.domain) === filter))),
  );

  const detail = detailId ? byId.get(detailId) ?? null : null;
  const live = liveId ? byId.get(liveId) ?? null : null;
  const group = groupId ? groups.find((it) => it.id === groupId) ?? null : null;

  if (!hasServer) {
    return (
      <div className="nb-notice">
        <p>{t('La maison connectée passe par le serveur Melo, qui dialogue avec Home Assistant sur votre réseau local.')}</p>
        <p className="nb-muted">{t('Configurez l’adresse du serveur dans les réglages.')}</p>
      </div>
    );
  }
  if (!configured) {
    return (
      <div className="nb-notice sh-empty">
        <Icon name="bulb" size={28} />
        <p>
          {tx('Reliez <b>Home Assistant</b> pour voir et piloter vos lumières, prises, volets, chauffage, caméras et capteurs, pièce par pièce.', {
            b: (s) => <b>{s}</b>,
          })}
        </p>
        {onConfigure ? (
          <button type="button" className="nb-btn nb-btn--primary" onClick={onConfigure}>
            {t('Connecter Home Assistant')}
          </button>
        ) : null}
        {configDialog}
      </div>
    );
  }

  const problem = (data?.error ? tServer(data.error) : '') || error;
  const favoritesView = favoritesOnly || filter === 'favorites';
  const favoritesShown = favorites.filter(matches);
  const showFavoritesSection = !favoritesView && filter === 'all' && !q && favorites.length > 0;
  const render = (it: Item, sort: SortItemProps) =>
    it.kind === 'group' ? (
      <GroupCard key={it.id} g={it.g} members={it.members} runMany={runMany} compact={compact} sort={sort} onOpen={() => setGroupId(it.id)} />
    ) : (
      <EntityCard key={it.id} e={it.e} run={run} compact={compact} sort={sort} onOpen={() => setDetailId(it.e.id)} onLive={() => setLiveId(it.e.id)} />
    );
  const entityItems = (list: HomeEntity[]) => list.map((e): Item => ({ id: e.id, kind: 'entity', e }));
  const reorderFavorites = doc ? (ids: string[]) => saveFavoritesOrder(doc, ids) : undefined;
  const reorderGroups = doc
    ? (ids: string[]) =>
        updateHomeConfig(doc, (c) => {
          const next = reorderSubset(
            c.groups.map((g) => g.id),
            ids,
          );
          const byGroup = new Map(c.groups.map((g) => [g.id, g]));
          return { ...c, groups: next.map((id) => byGroup.get(id)!) };
        })
    : undefined;
  const reorderEntities = doc ? (ids: string[]) => saveEntityOrder(doc, all, ids) : undefined;

  return (
    <div className={`sh-panel${compact ? ' sh-panel--compact' : ''}`}>
      {!favoritesOnly ? (
        <div className="sh-toolbar">
          <div className="sh-chips" role="toolbar" aria-label={t('Filtrer')}>
            <button type="button" className={`sh-chip${filter === 'all' ? ' sh-chip--active' : ''}`} onClick={() => setFilter('all')}>
              {t('Tout')}
            </button>
            {favorites.length ? (
              <button type="button" className={`sh-chip${filter === 'favorites' ? ' sh-chip--active' : ''}`} onClick={() => setFilter('favorites')}>
                <Icon name="star" size={13} /> {t('Favoris')}
              </button>
            ) : null}
            {CATEGORIES.filter((c) => counts.get(c.key)).map((c) => (
              <button key={c.key} type="button" className={`sh-chip${filter === c.key ? ' sh-chip--active' : ''}`} onClick={() => setFilter(c.key)}>
                <Icon name={c.icon} size={13} /> {c.label} <span className="sh-chip-count">{counts.get(c.key)}</span>
              </button>
            ))}
          </div>
          <div className="sh-toolbar-right">
            <input
              className="nb-input nb-input--sm sh-search"
              placeholder={t('Rechercher…')}
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              aria-label={t('Rechercher un appareil')}
            />
            {onConfigure ? (
              <button
                type="button"
                className="nb-btn nb-btn--sm"
                onClick={() => setEditGroup('new')}
                title={t('Piloter plusieurs appareils ensemble (toutes les lumières d’une pièce…)')}
              >
                <Icon name="plus" size={14} /> {t('Nouveau groupe')}
              </button>
            ) : null}
            {onConfigure ? (
              <button type="button" className="nb-btn nb-btn--sm" onClick={onConfigure}>
                {t('Configurer')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {problem ? (
        <div className="nb-error sh-problem">
          <Icon name="alert" size={15} /> {problem}
        </div>
      ) : null}
      {!data && loading ? <div className="hl-loading">{t('Connexion à Home Assistant…')}</div> : null}

      {!favoritesView && shownGroups.length ? (
        <section className="sh-section">
          <h2>
            <Icon name="grid" size={13} /> {t('Groupes')}
          </h2>
          <TileGrid items={shownGroups} compact={compact} onReorder={reorderGroups} render={render} />
        </section>
      ) : null}
      {showFavoritesSection ? (
        <section className="sh-section">
          <h2>
            <Icon name="star" size={13} /> {t('Favoris')}
          </h2>
          <TileGrid items={favorites} compact={compact} onReorder={reorderFavorites} render={render} />
        </section>
      ) : null}
      {favoritesView ? (
        favoritesShown.length ? (
          <TileGrid items={favoritesShown} compact={compact} onReorder={reorderFavorites} render={render} />
        ) : data ? (
          <p className="nb-muted">{t('Aucun favori : ouvrez un appareil ou un groupe et touchez « Ajouter aux favoris ».')}</p>
        ) : null
      ) : (
        groupByArea(shown, cfg.order).map(([area, list]) => (
          <section key={area || '—'} className="sh-section">
            <h2>{area || t('Sans pièce')}</h2>
            <TileGrid items={entityItems(list)} compact={compact} onReorder={reorderEntities} render={render} />
          </section>
        ))
      )}
      {data && !problem && !shown.length && !shownGroups.length && !favoritesView ? (
        <p className="nb-muted">{t('Aucun appareil ne correspond.')}</p>
      ) : null}

      {detail ? (
        <EntityDetail
          e={detail}
          run={run}
          favorite={cfg.favorites.includes(detail.id)}
          hidden={cfg.hidden.includes(detail.id)}
          onFavorite={() => doc && updateHomeConfig(doc, (c) => ({ ...c, favorites: toggleInList(c.favorites, detail.id) }))}
          onHide={() => {
            const wasHidden = cfg.hidden.includes(detail.id);
            if (doc) updateHomeConfig(doc, (c) => ({ ...c, hidden: toggleInList(c.hidden, detail.id), favorites: wasHidden ? c.favorites : c.favorites.filter((f) => f !== detail.id) }));
            setDetailId(null);
            toast(
              wasHidden
                ? t('« {name} » est de nouveau affiché.', { name: detail.name })
                : t('« {name} » est masqué (réaffichage : Configurer).', { name: detail.name }),
            );
          }}
          onLive={() => {
            setDetailId(null);
            setLiveId(detail.id);
          }}
          onClose={() => setDetailId(null)}
        />
      ) : null}
      {group && group.kind === 'group' ? (
        <GroupDetail
          g={group.g}
          members={group.members}
          run={run}
          runMany={runMany}
          favorite={cfg.favorites.includes(group.id)}
          onFavorite={doc ? () => updateHomeConfig(doc, (c) => ({ ...c, favorites: toggleInList(c.favorites, group.id) })) : undefined}
          onEdit={
            doc && canConfigure
              ? () => {
                  setGroupId(null);
                  setEditGroup(group.g);
                }
              : undefined
          }
          onDelete={
            doc && canConfigure
              ? () => {
                  if (!confirm(t('Supprimer le groupe « {name} » ? Ses appareils ne sont pas modifiés.', { name: group.g.name }))) return;
                  updateHomeConfig(doc, (c) => ({ ...c, groups: c.groups.filter((x) => x.id !== group.id), favorites: c.favorites.filter((f) => f !== group.id) }));
                  setGroupId(null);
                  toast(t('Groupe « {name} » supprimé.', { name: group.g.name }));
                }
              : undefined
          }
          onOpenEntity={(id) => {
            setGroupId(null);
            setDetailId(id);
          }}
          onLive={(id) => {
            setGroupId(null);
            setLiveId(id);
          }}
          onClose={() => setGroupId(null)}
        />
      ) : null}
      {editGroup && doc ? <SmartHomeGroupDialog doc={doc} group={editGroup === 'new' ? null : editGroup} entities={all} onClose={() => setEditGroup(null)} /> : null}
      {live ? <CameraLive e={live} onClose={() => setLiveId(null)} /> : null}
      {configDialog}
    </div>
  );
}

/** Vue « Maison » (barre latérale). */
export function SmartHomeView({ doc }: { doc: Y.Doc }) {
  useEffect(() => {
    document.title = t('Objets connectés – Melo');
  }, []);
  return (
    <div className="nb-page hl-page sh-page">
      <h1 className="nb-page-title-static">
        <Icon name="bulb" size={34} /> {t('Objets connectés')}
      </h1>
      <SmartHomePanel doc={doc} />
    </div>
  );
}
