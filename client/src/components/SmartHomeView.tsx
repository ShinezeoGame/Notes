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
  groupByArea,
  hexToRgb,
  hvacLabel,
  isActive,
  isAlert,
  isHomeConfigured,
  isToggleable,
  isUnavailable,
  kelvinToCss,
  lightColor,
  rgbToHex,
  supportsBrightness,
  supportsColor,
  supportsColorTemp,
  toggleCommand,
  toggleInList,
  updateHomeConfig,
  useHomeConfig,
  type CategoryKey,
  type HomeEntity,
  type HomeStates,
} from '../lib/smarthome';
import { Icon } from '../icons/Icon';
import { Modal } from './Modal';
import { SmartHomeConfigDialog } from './SmartHomeConfigDialog';
import { toast } from './Toast';

type Run = (e: HomeEntity, service: string, data?: Record<string, unknown>, optimistic?: Partial<HomeEntity>) => Promise<boolean>;
type EntityPatch = Partial<HomeEntity> & { id: string };

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
      setError(err instanceof Error ? err.message : 'Serveur injoignable.');
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
        toast(err instanceof Error ? err.message : 'Commande impossible.', 'error');
        version.current++;
      }
      // Certains appareils confirment après coup : nouvelle lecture peu après.
      setTimeout(() => void refresh(), 1200);
      return ok;
    },
    [patch, refresh],
  );

  return { data, loading, error, refresh, run };
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
  return <Slider value={value} min={1} max={100} onChange={setValue} label={`Luminosité de ${e.name}`} />;
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
      <button type="button" className="sh-round" onClick={() => nudge(-step)} aria-label="Baisser la consigne" disabled={isUnavailable(e)}>
        <Icon name="minus" size={16} />
      </button>
      <span className="sh-temp-value" title="Consigne">
        {formatValue(value, '°C')}
      </span>
      <button type="button" className="sh-round" onClick={() => nudge(step)} aria-label="Monter la consigne" disabled={isUnavailable(e)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function CoverButtons({ e, run }: { e: HomeEntity; run: Run }) {
  const valve = e.domain === 'valve';
  const svc = (name: string) => (valve ? `${name}_valve` : `${name}_cover`);
  const off = isUnavailable(e);
  return (
    <div className="sh-buttons">
      {coverSupports(e, 'OPEN') ? (
        <button type="button" className="sh-round" onClick={() => void run(e, svc('open'), undefined, { state: 'opening' })} aria-label="Ouvrir" disabled={off}>
          <Icon name="chevronUp" size={16} />
        </button>
      ) : null}
      {coverSupports(e, 'STOP') ? (
        <button type="button" className="sh-round" onClick={() => void run(e, svc('stop'))} aria-label="Arrêter" disabled={off}>
          <Icon name="stop" size={14} />
        </button>
      ) : null}
      {coverSupports(e, 'CLOSE') ? (
        <button type="button" className="sh-round" onClick={() => void run(e, svc('close'), undefined, { state: 'closing' })} aria-label="Fermer" disabled={off}>
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
        aria-label={playing ? 'Pause' : 'Lecture'}
        disabled={off}
      >
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <button type="button" className="sh-round" onClick={() => void run(e, 'media_next_track')} aria-label="Titre suivant" disabled={off}>
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
        if (locked && !confirm(`Déverrouiller « ${e.name} » ?`)) return;
        void run(e, locked ? 'unlock' : 'lock', undefined, { state: locked ? 'unlocking' : 'locking' });
      }}
    >
      <Icon name={locked ? 'unlock' : 'lock'} size={14} /> {locked ? 'Déverrouiller' : 'Verrouiller'}
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
    <button type="button" className={`sh-camera${large ? ' sh-camera--large' : ''}`} onClick={onOpen} aria-label={`Voir ${e.name} en direct`}>
      {failed ? (
        <span className="sh-camera-empty">Image indisponible</span>
      ) : (
        <img src={`${base}${e.snapshot}&_=${tick}`} alt={e.name} onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
      )}
      <span className="sh-camera-live">
        <Icon name="play" size={14} /> Direct
      </span>
    </button>
  );
}

// ---------- Tuile d'un appareil ----------

function EntityCard({ e, run, onOpen, onLive, compact }: { e: HomeEntity; run: Run; onOpen: () => void; onLive: () => void; compact: boolean }) {
  const active = isActive(e);
  const alert = isAlert(e);
  const off = isUnavailable(e);
  const color = lightColor(e);
  const toggle = () => {
    const cmd = toggleCommand(e);
    void run(e, cmd.service, cmd.data, cmd.optimistic);
  };
  const quick = () => {
    if (e.domain === 'scene' || e.domain === 'script') void run(e, 'turn_on').then((ok) => ok && toast(`« ${e.name} » lancé.`));
    else if (e.domain === 'button' || e.domain === 'input_button') void run(e, 'press').then((ok) => ok && toast(`« ${e.name} » : appui envoyé.`));
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
    <div className={cls} style={style} data-entity={e.id}>
      <div className="sh-card-head">
        <button
          type="button"
          className="sh-tile"
          onClick={isToggleable(e) ? toggle : e.domain === 'camera' ? onLive : quick}
          disabled={off}
          aria-label={isToggleable(e) ? `${e.state === 'on' ? 'Éteindre' : 'Allumer'} ${e.name}` : e.name}
        >
          <Icon name={entityIcon(e)} size={20} />
        </button>
        <button type="button" className="sh-card-title" onClick={onOpen}>
          <span className="sh-name">{e.name}</span>
          <span className="sh-state">{formatState(e) || (e.domain === 'scene' ? 'Scène' : e.domain === 'script' ? 'Action' : 'Bouton')}</span>
        </button>
        {isToggleable(e) ? <Switch checked={e.domain === 'climate' ? e.state !== 'off' : e.state === 'on'} onChange={toggle} disabled={off} label={`${e.name} : marche / arrêt`} /> : null}
        {['scene', 'script', 'button', 'input_button'].includes(e.domain) ? (
          <button type="button" className="nb-btn nb-btn--sm" onClick={quick} disabled={off}>
            {e.domain === 'button' || e.domain === 'input_button' ? 'Appuyer' : 'Lancer'}
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
  return <Slider value={value} min={0} max={100} step={step > 1 ? Math.round(step) : 1} onChange={setValue} label={`Vitesse de ${e.name}`} />;
}

function VacuumButtons({ e, run }: { e: HomeEntity; run: Run }) {
  const cleaning = e.state === 'cleaning';
  const off = isUnavailable(e);
  return (
    <div className="sh-buttons">
      <button type="button" className="nb-btn nb-btn--sm" onClick={() => void run(e, cleaning ? 'pause' : 'start', undefined, { state: cleaning ? 'paused' : 'cleaning' })} disabled={off}>
        <Icon name={cleaning ? 'pause' : 'play'} size={14} /> {cleaning ? 'Pause' : 'Démarrer'}
      </button>
      <button type="button" className="nb-btn nb-btn--sm" onClick={() => void run(e, 'return_to_base', undefined, { state: 'returning' })} disabled={off}>
        <Icon name="home" size={14} /> Base
      </button>
    </div>
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
          <span>Luminosité</span>
          <BrightnessSlider e={e} run={run} />
        </div>
      ) : null}
      {supportsColorTemp(e) ? (
        <div className="sh-field">
          <span>Température de couleur</span>
          <Slider value={temp} min={minK} max={maxK} step={50} onChange={setTemp} label="Température de couleur" suffix="K" style={{ '--sh-track': `linear-gradient(90deg, ${kelvinToCss(minK)}, ${kelvinToCss(maxK)})` } as CSSProperties} />
        </div>
      ) : null}
      {presets.length ? (
        <div className="sh-field">
          <span>Couleur</span>
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
              <label className="sh-swatch sh-swatch--custom" title="Autre couleur">
                <Icon name="palette" size={15} />
                <input
                  type="color"
                  value={custom}
                  aria-label="Autre couleur"
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
          {typeof e.attrs.current_humidity === 'number' ? <span className="nb-muted"> · {e.attrs.current_humidity} %</span> : null}
        </div>
      ) : null}
      {e.state !== 'off' ? (
        <div className="sh-field">
          <span>Consigne</span>
          <TargetTemperature e={e} run={run} />
        </div>
      ) : null}
      {modes.length ? (
        <div className="sh-field">
          <span>Mode</span>
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
          <span>Ouverture</span>
          <Slider value={value} min={0} max={100} onChange={setValue} label="Ouverture" />
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
          <span>Volume</span>
          <Slider value={value} min={0} max={100} onChange={setValue} label="Volume" />
        </div>
      ) : null}
    </>
  );
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.round(s / 3600)} h`;
  return `le ${new Date(t).toLocaleDateString('fr-FR')}`;
}

function EntityDetail({ e, run, favorite, onFavorite, onHide, onLive, onClose }: { e: HomeEntity; run: Run; favorite: boolean; onFavorite: () => void; onHide: () => void; onLive: () => void; onClose: () => void }) {
  let controls: ReactNode = null;
  if (e.domain === 'light') controls = <LightControls e={e} run={run} />;
  else if (e.domain === 'climate') controls = <ClimateControls e={e} run={run} />;
  else if (e.domain === 'cover' || e.domain === 'valve') controls = <CoverControls e={e} run={run} />;
  else if (e.domain === 'media_player') controls = <MediaControls e={e} run={run} />;
  else if (e.domain === 'fan' && e.state === 'on') controls = (
    <div className="sh-field">
      <span>Vitesse</span>
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
          <button type="button" className="nb-btn nb-btn--sm" onClick={onHide} title="Ne plus afficher cet appareil dans la liste">
            <Icon name="eyeOff" size={14} /> Masquer
          </button>
          <button type="button" className={`nb-btn nb-btn--sm${favorite ? ' sh-fav--on' : ''}`} onClick={onFavorite} aria-pressed={favorite}>
            <Icon name="star" size={14} /> {favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
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
            <div className="sh-state-strong">{formatState(e) || 'Prêt'}</div>
            <div className="nb-muted">
              {[e.area, e.changedAt && !['scene', 'script', 'button', 'input_button'].includes(e.domain) ? `modifié ${timeAgo(e.changedAt)}` : ''].filter(Boolean).join(' · ')}
            </div>
          </div>
          {isToggleable(e) ? <Switch checked={e.domain === 'climate' ? e.state !== 'off' : e.state === 'on'} onChange={toggle} disabled={isUnavailable(e)} label={`${e.name} : marche / arrêt`} /> : null}
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
          <img ref={img} src={`${base}${e.stream}`} alt={`${e.name} en direct`} onError={() => setFailed(true)} />
        ) : (
          <div className="sh-camera-empty">Vidéo indisponible.</div>
        )}
      </div>
    </Modal>
  );
}

// ---------- Panneau principal (vue « Maison » et bloc dans une page) ----------

type Filter = 'all' | 'favorites' | CategoryKey;

export function SmartHomePanel({ doc, compact = false, favoritesOnly = false, canConfigure = true }: { doc: Y.Doc | null; compact?: boolean; favoritesOnly?: boolean; canConfigure?: boolean }) {
  const cfg = useHomeConfig(doc);
  const hasServer = Boolean(serverBase());
  const configured = isHomeConfigured(cfg);
  const { data, error, loading, run } = useHomeStates(hasServer && configured);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const onConfigure = canConfigure && doc ? () => setConfigOpen(true) : undefined;
  const configDialog = configOpen && doc ? <SmartHomeConfigDialog doc={doc} entities={data?.entities} onClose={() => setConfigOpen(false)} /> : null;

  const visible = useMemo(() => (data?.entities ?? []).filter((e) => !cfg.hidden.includes(e.id)), [data, cfg.hidden]);
  const favorites = useMemo(() => cfg.favorites.map((id) => visible.find((e) => e.id === id)).filter((e): e is HomeEntity => Boolean(e)), [cfg.favorites, visible]);
  const counts = useMemo(() => {
    const m = new Map<CategoryKey, number>();
    for (const e of visible) m.set(categoryOf(e.domain), (m.get(categoryOf(e.domain)) ?? 0) + 1);
    return m;
  }, [visible]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = favoritesOnly || filter === 'favorites' ? favorites : filter === 'all' ? visible : visible.filter((e) => categoryOf(e.domain) === filter);
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q) || e.area.toLowerCase().includes(q));
    return list;
  }, [favoritesOnly, filter, favorites, visible, query]);

  const detail = detailId ? visible.find((e) => e.id === detailId) ?? null : null;
  const live = liveId ? visible.find((e) => e.id === liveId) ?? null : null;

  if (!hasServer) {
    return (
      <div className="nb-notice">
        <p>La maison connectée passe par le serveur Notes, qui dialogue avec Home Assistant sur votre réseau local.</p>
        <p className="nb-muted">Configurez l’adresse du serveur dans les réglages.</p>
      </div>
    );
  }
  if (!configured) {
    return (
      <div className="nb-notice sh-empty">
        <Icon name="bulb" size={28} />
        <p>
          Reliez <b>Home Assistant</b> pour voir et piloter vos lumières, prises, volets, chauffage, caméras et capteurs, pièce par pièce.
        </p>
        {onConfigure ? (
          <button type="button" className="nb-btn nb-btn--primary" onClick={onConfigure}>
            Connecter Home Assistant
          </button>
        ) : null}
        {configDialog}
      </div>
    );
  }

  const problem = data?.error || error;
  const showFavoritesSection = !favoritesOnly && filter === 'all' && !query.trim() && favorites.length > 0;
  const renderGrid = (list: HomeEntity[]) => (
    <div className={`sh-grid${compact ? ' sh-grid--compact' : ''}`}>
      {list.map((e) => (
        <EntityCard key={e.id} e={e} run={run} compact={compact} onOpen={() => setDetailId(e.id)} onLive={() => setLiveId(e.id)} />
      ))}
    </div>
  );

  return (
    <div className={`sh-panel${compact ? ' sh-panel--compact' : ''}`}>
      {!favoritesOnly ? (
        <div className="sh-toolbar">
          <div className="sh-chips" role="toolbar" aria-label="Filtrer">
            <button type="button" className={`sh-chip${filter === 'all' ? ' sh-chip--active' : ''}`} onClick={() => setFilter('all')}>
              Tout
            </button>
            {favorites.length ? (
              <button type="button" className={`sh-chip${filter === 'favorites' ? ' sh-chip--active' : ''}`} onClick={() => setFilter('favorites')}>
                <Icon name="star" size={13} /> Favoris
              </button>
            ) : null}
            {CATEGORIES.filter((c) => counts.get(c.key)).map((c) => (
              <button key={c.key} type="button" className={`sh-chip${filter === c.key ? ' sh-chip--active' : ''}`} onClick={() => setFilter(c.key)}>
                <Icon name={c.icon} size={13} /> {c.label} <span className="sh-chip-count">{counts.get(c.key)}</span>
              </button>
            ))}
          </div>
          <div className="sh-toolbar-right">
            <input className="nb-input nb-input--sm sh-search" placeholder="Rechercher…" value={query} onChange={(ev) => setQuery(ev.target.value)} aria-label="Rechercher un appareil" />
            {onConfigure ? (
              <button type="button" className="nb-btn nb-btn--sm" onClick={onConfigure}>
                Configurer
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
      {!data && loading ? <div className="hl-loading">Connexion à Home Assistant…</div> : null}

      {showFavoritesSection ? (
        <section className="sh-section">
          <h2>
            <Icon name="star" size={13} /> Favoris
          </h2>
          {renderGrid(favorites)}
        </section>
      ) : null}
      {favoritesOnly || filter === 'favorites'
        ? shown.length
          ? renderGrid(shown)
          : data
            ? <p className="nb-muted">Aucun favori : ouvrez un appareil et touchez « Ajouter aux favoris ».</p>
            : null
        : groupByArea(shown).map(([area, list]) => (
            <section key={area || '—'} className="sh-section">
              <h2>{area || 'Sans pièce'}</h2>
              {renderGrid(list)}
            </section>
          ))}
      {data && !problem && !shown.length && !favoritesOnly && filter !== 'favorites' ? <p className="nb-muted">Aucun appareil ne correspond.</p> : null}

      {detail ? (
        <EntityDetail
          e={detail}
          run={run}
          favorite={cfg.favorites.includes(detail.id)}
          onFavorite={() => doc && updateHomeConfig(doc, (c) => ({ ...c, favorites: toggleInList(c.favorites, detail.id) }))}
          onHide={() => {
            if (doc) updateHomeConfig(doc, (c) => ({ ...c, hidden: toggleInList(c.hidden, detail.id), favorites: c.favorites.filter((f) => f !== detail.id) }));
            setDetailId(null);
            toast(`« ${detail.name} » est masqué (réaffichage : Configurer).`);
          }}
          onLive={() => {
            setDetailId(null);
            setLiveId(detail.id);
          }}
          onClose={() => setDetailId(null)}
        />
      ) : null}
      {live ? <CameraLive e={live} onClose={() => setLiveId(null)} /> : null}
      {configDialog}
    </div>
  );
}

/** Vue « Maison » (barre latérale). */
export function SmartHomeView({ doc }: { doc: Y.Doc }) {
  useEffect(() => {
    document.title = 'Maison – Notes';
  }, []);
  return (
    <div className="nb-page hl-page sh-page">
      <h1 className="nb-page-title-static">
        <Icon name="bulb" size={34} /> Maison
      </h1>
      <SmartHomePanel doc={doc} />
    </div>
  );
}
