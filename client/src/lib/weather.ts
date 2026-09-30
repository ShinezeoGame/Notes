// Météo du widget de l'accueil : Open-Meteo (gratuit, sans clé ni compte), interrogé directement par l'appareil.
// Prévisions gardées 15 minutes (mémoire et appareil) pour ne pas les redemander à chaque affichage.
import type { IconName } from '../icons/registry';

export type Place = { name: string; detail: string; lat: number; lon: number };

export type Forecast = {
  current: { temp: number; feels: number; code: number; isDay: boolean; wind: number; humidity: number };
  daily: { date: string; code: number; max: number; min: number; rain: number | null }[];
  fetchedAt: number;
};

const FRESH = 15 * 60_000;
const memory = new Map<string, Forecast>();
const cacheKey = (lat: number, lon: number) => `notes.weather.${lat.toFixed(2)},${lon.toFixed(2)}`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Service météo indisponible (${res.status}).`);
  return (await res.json()) as T;
}

/** Villes correspondant à un nom (« Lyon », « Paris 15 », « Genève »…). */
export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  type Res = { results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[] };
  const data = await getJson<Res>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=fr&format=json`);
  return (data.results ?? []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/** Conditions actuelles et prévisions sur 7 jours (depuis le cache s'il a moins de 15 minutes). */
export async function getForecast(lat: number, lon: number, force = false): Promise<Forecast> {
  const key = cacheKey(lat, lon);
  if (!force) {
    let cached = memory.get(key);
    if (!cached) {
      try {
        cached = JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined;
      } catch {
        cached = undefined;
      }
    }
    if (cached && Date.now() - cached.fetchedAt < FRESH) return cached;
  }
  type Res = {
    current: { temperature_2m: number; apparent_temperature: number; weather_code: number; is_day: number; wind_speed_10m: number; relative_humidity_2m: number };
    daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max?: (number | null)[] };
  };
  const d = await getJson<Res>(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7',
  );
  const forecast: Forecast = {
    current: {
      temp: d.current.temperature_2m,
      feels: d.current.apparent_temperature,
      code: d.current.weather_code,
      isDay: d.current.is_day !== 0,
      wind: d.current.wind_speed_10m,
      humidity: d.current.relative_humidity_2m,
    },
    daily: d.daily.time.map((date, i) => ({
      date,
      code: d.daily.weather_code[i],
      max: d.daily.temperature_2m_max[i],
      min: d.daily.temperature_2m_min[i],
      rain: d.daily.precipitation_probability_max?.[i] ?? null,
    })),
    fetchedAt: Date.now(),
  };
  memory.set(key, forecast);
  try {
    localStorage.setItem(key, JSON.stringify(forecast));
  } catch {
    /* stockage indisponible */
  }
  return forecast;
}

/** Libellé et icône d'un code météo (codes WMO utilisés par Open-Meteo). */
export function describeWeather(code: number, isDay = true): { label: string; icon: IconName } {
  if (code === 0) return { label: isDay ? 'Ensoleillé' : 'Ciel dégagé', icon: isDay ? 'sun' : 'moon' };
  if (code === 1) return { label: 'Plutôt dégagé', icon: isDay ? 'cloudSun' : 'moon' };
  if (code === 2) return { label: 'Partiellement nuageux', icon: 'cloudSun' };
  if (code === 3) return { label: 'Couvert', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Brouillard', icon: 'fog' };
  if (code >= 51 && code <= 55) return { label: 'Bruine', icon: 'rain' };
  if (code === 56 || code === 57) return { label: 'Bruine verglaçante', icon: 'rain' };
  if (code === 61) return { label: 'Pluie faible', icon: 'rain' };
  if (code === 63) return { label: 'Pluie', icon: 'rain' };
  if (code === 65) return { label: 'Forte pluie', icon: 'rain' };
  if (code === 66 || code === 67) return { label: 'Pluie verglaçante', icon: 'rain' };
  if (code === 71) return { label: 'Neige faible', icon: 'snow' };
  if (code === 73) return { label: 'Neige', icon: 'snow' };
  if (code === 75) return { label: 'Forte neige', icon: 'snow' };
  if (code === 77) return { label: 'Grains de neige', icon: 'snow' };
  if (code >= 80 && code <= 82) return { label: code === 82 ? 'Fortes averses' : 'Averses', icon: 'rain' };
  if (code === 85 || code === 86) return { label: 'Averses de neige', icon: 'snow' };
  if (code === 95) return { label: 'Orage', icon: 'thunder' };
  if (code === 96 || code === 99) return { label: 'Orage avec grêle', icon: 'thunder' };
  return { label: 'Temps inconnu', icon: 'cloud' };
}
