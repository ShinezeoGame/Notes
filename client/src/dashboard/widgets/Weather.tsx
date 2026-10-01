// Widget Météo : conditions actuelles et prévisions des prochains jours pour une ville (Open-Meteo).
import { useCallback, useEffect, useState } from 'react';
import { describeWeather, getForecast, searchPlaces, type Forecast, type Place } from '../../lib/weather';
import { Icon } from '../../icons/Icon';
import { num, type SettingsProps, type WidgetProps } from '../types';
import { t, locale } from '../../lib/i18n';

const round = (n: number) => `${Math.round(n)}°`;
const dayFmt = new Intl.DateTimeFormat(locale(), { weekday: 'short' });

function placeOf(v: unknown): Place | null {
  const p = v as Place | null;
  return p && typeof p.lat === 'number' && typeof p.lon === 'number' ? p : null;
}

export function WeatherWidget({ widget, openSettings, editing }: WidgetProps) {
  const place = placeOf(widget.config.place);
  const days = num(widget.config.days, 5);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(
    async (force = false) => {
      if (!place) return;
      try {
        setForecast(await getForecast(place.lat, place.lon, force));
        setError('');
      } catch (err) {
        setError(err instanceof Error && (err as { service?: boolean }).service ? err.message : t('Météo indisponible (connexion à Internet ?).'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [place?.lat, place?.lon],
  );

  useEffect(() => {
    setForecast(null);
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 15 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!place) {
    return (
      <div className="w-empty">
        <Icon name="cloudSun" size={26} />
        <button type="button" className="nb-btn nb-btn--sm" onClick={openSettings} disabled={editing}>
          {t('Choisir une ville')}
        </button>
      </div>
    );
  }
  if (!forecast) {
    return <div className="w-empty w-muted">{error || t('Chargement de la météo…')}</div>;
  }
  const now = describeWeather(forecast.current.code, forecast.current.isDay);
  const today = forecast.daily[0];
  return (
    <div className="w-weather" title={error || undefined}>
      <div className="w-weather-now">
        <Icon name={now.icon} size={44} className="w-weather-icon" />
        <div>
          <div className="w-weather-temp">{round(forecast.current.temp)}</div>
          <div className="w-weather-label">{now.label}</div>
        </div>
        <div className="w-weather-place">
          <b>{place.name}</b>
          {today ? (
            <span>
              {round(today.max)} / {round(today.min)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="w-weather-details">
        <span>
          {t('Ressenti')} {round(forecast.current.feels)}
        </span>
        <span>
          <Icon name="droplet" size={12} /> {t('{pct} %', { pct: Math.round(forecast.current.humidity) })}
        </span>
        <span>{t('Vent {speed} km/h', { speed: Math.round(forecast.current.wind) })}</span>
      </div>
      {days > 0 ? (
        <div className="w-weather-days">
          {forecast.daily.slice(1, days + 1).map((d) => {
            const info = describeWeather(d.code);
            return (
              <div key={d.date} className="w-weather-day" title={info.label}>
                <span className="w-weather-dayname">{dayFmt.format(new Date(`${d.date}T12:00:00`))}</span>
                <Icon name={info.icon} size={20} />
                <span>
                  <b>{round(d.max)}</b> <span className="w-muted">{round(d.min)}</span>
                </span>
                {d.rain != null && d.rain >= 20 ? <span className="w-weather-rain">{t('{pct} %', { pct: d.rain })}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function WeatherSettings({ config, set }: SettingsProps) {
  const place = placeOf(config.place);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const search = async () => {
    setBusy(true);
    setError('');
    try {
      const list = await searchPlaces(query);
      setResults(list);
      if (!list.length) setError(t('Aucune ville trouvée.'));
    } catch {
      setError(t('Recherche impossible (connexion à Internet ?).'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="nb-field">
        <span>{place ? t('Ville : {place}', { place: `${place.name}${place.detail ? ` (${place.detail})` : ''}` }) : t('Ville')}</span>
        <form
          className="nb-row nb-gap"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            className="nb-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Nom de la ville…')}
            autoFocus={!place}
          />
          <button type="submit" className="nb-btn" disabled={busy || !query.trim()}>
            {busy ? t('Recherche…') : t('Rechercher')}
          </button>
        </form>
        {error ? <div className="nb-error">{error}</div> : null}
        {results?.length ? (
          <div className="w-place-results">
            {results.map((r) => (
              <button
                key={`${r.lat},${r.lon}`}
                type="button"
                className={place && place.lat === r.lat && place.lon === r.lon ? 'w-place--on' : ''}
                onClick={() => {
                  set({ place: r });
                  setResults(null);
                  setQuery('');
                }}
              >
                <b>{r.name}</b> <span className="nb-muted">{r.detail}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <label className="nb-field">
        <span>{t('Prévisions')}</span>
        <select className="nb-input" value={num(config.days, 5)} onChange={(e) => set({ days: Number(e.target.value) })}>
          <option value={0}>{t('Aujourd’hui seulement')}</option>
          <option value={3}>{t('3 jours')}</option>
          <option value={5}>{t('5 jours')}</option>
          <option value={6}>{t('6 jours')}</option>
        </select>
      </label>
      <p className="nb-muted w-settings-hint">{t('Données météo : Open-Meteo.com (gratuit, sans compte).')}</p>
    </>
  );
}
