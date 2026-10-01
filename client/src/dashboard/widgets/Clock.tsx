// Widget Horloge : heure (numérique ou à aiguilles), date, salutation, fuseau horaire au choix (horloge du monde).
import { useEffect, useMemo, useState } from 'react';
import { bool, str, type SettingsProps, type WidgetProps } from '../types';
import { t, locale } from '../../lib/i18n';

/** Date courante, mise à jour à chaque seconde ou à chaque minute (calée sur l'horloge). */
export function useNow(stepMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, stepMs - (Date.now() % stepMs) + 15);
    };
    setNow(new Date());
    schedule();
    return () => clearTimeout(timer);
  }, [stepMs]);
  return now;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Fuseau horaire connu de cet appareil, sinon celui de l'appareil (fuseau choisi sur un navigateur plus récent). */
function knownZone(tz: string): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}
const cityOf = (tz: string) => tz.split('/').pop()!.replace(/_/g, ' ');

/** Heures, minutes, secondes dans un fuseau horaire. */
function partsIn(date: Date, timeZone: string | undefined) {
  const parts = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', timeZone }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { h: get('hour'), m: get('minute'), s: get('second') };
}

function Analog({ date, timeZone, seconds }: { date: Date; timeZone?: string; seconds: boolean }) {
  const { h, m, s } = partsIn(date, timeZone);
  const hand = (deg: number, len: number, width: number, cls: string) => (
    <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} strokeWidth={width} className={cls} />
  );
  return (
    <svg className="w-clock-analog" viewBox="0 0 100 100" role="img" aria-label={`${h} h ${String(m).padStart(2, '0')}`}>
      <circle cx="50" cy="50" r="47" className="w-clock-face" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        const inner = i % 3 === 0 ? 36 : 39;
        return <line key={i} x1={50 + inner * Math.sin(a)} y1={50 - inner * Math.cos(a)} x2={50 + 43 * Math.sin(a)} y2={50 - 43 * Math.cos(a)} className="w-clock-tick" />;
      })}
      {hand(((h % 12) + m / 60) * 30, 24, 4.5, 'w-clock-hand')}
      {hand((m + s / 60) * 6, 34, 3, 'w-clock-hand')}
      {seconds ? hand(s * 6, 38, 1.2, 'w-clock-second') : null}
      <circle cx="50" cy="50" r="2.6" className="w-clock-center" />
    </svg>
  );
}

export function ClockWidget({ widget }: WidgetProps) {
  const c = widget.config;
  const seconds = bool(c.seconds);
  const analog = str(c.style) === 'analog';
  const timeZone = knownZone(str(c.timezone));
  const now = useNow(seconds ? 1000 : 60_000);
  const { h } = partsIn(now, timeZone);
  const name = str(c.name).trim();
  const hello = h >= 5 && h < 18 ? t('Bonjour') : t('Bonsoir');
  const greeting = bool(c.greeting) ? (name ? t('{hello}, {name}', { hello, name }) : hello) : '';
  const time = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined, timeZone }).format(
    now,
  );
  const date = capitalize(new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(now));
  return (
    <div className={`w-clock${analog ? ' w-clock--analog' : ''}${seconds ? ' w-clock--seconds' : ''}`}>
      {greeting ? <div className="w-clock-greeting">{greeting}</div> : null}
      {analog ? <Analog date={now} timeZone={timeZone} seconds={seconds} /> : <div className="w-clock-time">{time}</div>}
      {bool(c.date, true) ? <div className="w-clock-date">{date}</div> : null}
      {timeZone ? <div className="w-clock-city">{cityOf(timeZone)}</div> : null}
    </div>
  );
}

export function ClockSettings({ config, set }: SettingsProps) {
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  }, []);
  return (
    <>
      <label className="nb-field">
        <span>{t('Affichage')}</span>
        <select className="nb-input" value={str(config.style, 'digital')} onChange={(e) => set({ style: e.target.value })}>
          <option value="digital">{t('Numérique')}</option>
          <option value="analog">{t('À aiguilles')}</option>
        </select>
      </label>
      <label className="nb-check">
        <input type="checkbox" checked={bool(config.seconds)} onChange={(e) => set({ seconds: e.target.checked })} /> {t('Secondes')}
      </label>
      <label className="nb-check">
        <input type="checkbox" checked={bool(config.date, true)} onChange={(e) => set({ date: e.target.checked })} /> {t('Date')}
      </label>
      <label className="nb-check">
        <input type="checkbox" checked={bool(config.greeting)} onChange={(e) => set({ greeting: e.target.checked })} />{' '}
        {t('Salutation (« Bonjour », « Bonsoir »)')}
      </label>
      {bool(config.greeting) ? (
        <label className="nb-field">
          <span>{t('Votre prénom (facultatif)')}</span>
          <input className="nb-input" value={str(config.name)} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
        </label>
      ) : null}
      {zones.length ? (
        <label className="nb-field">
          <span>{t('Fuseau horaire')}</span>
          <select className="nb-input" value={str(config.timezone)} onChange={(e) => set({ timezone: e.target.value })}>
            <option value="">{t('Heure de cet appareil')}</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
