export const SPRAY_STATIONS = [
  { id: 'NISS2', name: 'Nisland Mesonet', detail: 'Nisland · Butte County', longitude: -103.560272, latitude: 44.678235, elevationFeet: 2905 },
  { id: 'NLMS2', name: 'Newell Mesonet', detail: 'Newell 13 NNW · Butte County', longitude: -103.488019, latitude: 44.900363, elevationFeet: 3133 }
] as const;

export type SprayStation = (typeof SPRAY_STATIONS)[number];
export type SnapshotReason = 'start' | 'interval' | 'manual' | 'end';
export type SprayRating = 'good' | 'marginal' | 'hold' | 'unknown';

export type SpraySettings = {
  stationMode: string;
  productName: string;
  applicationNotes: string;
  sprayEquipment: string;
  maxWindMph: number;
  maxGustMph: number;
  minHumidityPercent: number;
  minTemperatureF: number;
  maxTemperatureF: number;
  maxPrecipProbabilityPercent: number;
  requiredDryHours: number;
  minimumWindowHours: number;
};

export type SprayPosition = {
  longitude: number;
  latitude: number;
  accuracy?: number;
  altitude?: number | null;
  heading?: number | null;
  speed?: number | null;
  timestamp: number;
  source: 'gps';
};

export type WeatherSnapshot = {
  reason: SnapshotReason;
  stationId: string;
  stationName: string;
  stationLatitude: number;
  stationLongitude: number;
  observedAt: string | null;
  capturedAt: string;
  source: 'iem-current' | 'cached-iem-current';
  stale: boolean;
  position?: { longitude: number; latitude: number; accuracy?: number };
  temperatureF: number | null;
  dewpointF: number | null;
  relativeHumidityPercent: number | null;
  windSpeedMph: number | null;
  windGustMph: number | null;
  windDirectionDegrees: number | null;
  rainTodayInches: number | null;
  pressureInHg: number | null;
};

export type ForecastPeriod = {
  startTime: string;
  endTime: string;
  temperatureF: number | null;
  humidityPercent: number | null;
  precipitationProbabilityPercent: number | null;
  windSpeedMph: number | null;
  windDirection: string;
  shortForecast: string;
};

export type SprayWindow = {
  startTime: string;
  endTime: string;
  hours: number;
  minTemperatureF: number | null;
  maxTemperatureF: number | null;
  maxWindMph: number | null;
  minHumidityPercent: number | null;
  maxPrecipitationPercent: number | null;
};

export const DEFAULT_SPRAY_SETTINGS: SpraySettings = {
  stationMode: 'auto',
  productName: '',
  applicationNotes: '',
  sprayEquipment: 'pickup-sprayer',
  maxWindMph: 10,
  maxGustMph: 15,
  minHumidityPercent: 30,
  minTemperatureF: 40,
  maxTemperatureF: 90,
  maxPrecipProbabilityPercent: 20,
  requiredDryHours: 6,
  minimumWindowHours: 2
};

const IEM_CURRENT_URL = 'https://mesonet.agron.iastate.edu/json/current.py';
const NWS_POINTS_URL = 'https://api.weather.gov/points';
const CACHE_PREFIX = 'bfid-spray-weather-cache:';

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function observationNumber(observation: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = finiteNumber(observation[key]);
    if (value !== null) return value;
  }
  return null;
}

function relativeHumidity(tempF: number | null, dewpointF: number | null): number | null {
  if (tempF === null || dewpointF === null) return null;
  const tempC = (tempF - 32) * 5 / 9;
  const dewC = (dewpointF - 32) * 5 / 9;
  const humidity = 100 * Math.exp((17.625 * dewC) / (243.04 + dewC) - (17.625 * tempC) / (243.04 + tempC));
  return Math.max(0, Math.min(100, humidity));
}

function distanceMeters(a: { longitude: number; latitude: number }, b: { longitude: number; latitude: number }): number {
  const r = Math.PI / 180;
  const lat1 = a.latitude * r;
  const lat2 = b.latitude * r;
  const dLat = (b.latitude - a.latitude) * r;
  const dLon = (b.longitude - a.longitude) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function chooseSprayStation(mode: string, position: { longitude: number; latitude: number } | null): SprayStation {
  const explicit = SPRAY_STATIONS.find((station) => station.id === mode);
  if (explicit) return explicit;
  if (!position) return SPRAY_STATIONS[0];
  return [...SPRAY_STATIONS].sort((a, b) => distanceMeters(position, a) - distanceMeters(position, b))[0];
}

function cacheKey(station: SprayStation): string {
  return `${CACHE_PREFIX}${station.id}`;
}

function readCached(station: SprayStation, reason: SnapshotReason): WeatherSnapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(station)) || 'null') as WeatherSnapshot | null;
    return value ? { ...value, reason, source: 'cached-iem-current', stale: true, capturedAt: new Date().toISOString() } : null;
  } catch {
    return null;
  }
}

function saveCached(station: SprayStation, snapshot: WeatherSnapshot): void {
  try { localStorage.setItem(cacheKey(station), JSON.stringify(snapshot)); } catch { /* optional cache */ }
}

export async function fetchStationWeather(station: SprayStation, reason: SnapshotReason, position: SprayPosition | null): Promise<WeatherSnapshot> {
  try {
    const url = new URL(IEM_CURRENT_URL);
    url.searchParams.set('network', 'SD_DCP');
    url.searchParams.set('station', station.id);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Mesonet returned ${response.status}`);
    const observation = ((await response.json()) as { last_ob?: Record<string, unknown> | null }).last_ob;
    if (!observation) throw new Error('No Mesonet observation returned');

    const temperatureF = observationNumber(observation, ['airtemp[F]', 'tmpf', 'temperature[F]']);
    const dewpointF = observationNumber(observation, ['dewpointtemp[F]', 'dwpf', 'dewpoint[F]']);
    const windKnots = observationNumber(observation, ['windspeed[kt]', 'sknt', 'wind_speed[kt]']);
    const gustKnots = observationNumber(observation, ['windgust[kt]', 'gust[kt]', 'gust', 'max_wind_speed[kt]']);
    const observedAt = typeof observation.utc_valid === 'string' ? observation.utc_valid : null;
    const stale = observedAt ? Date.now() - new Date(observedAt).getTime() > 90 * 60 * 1000 : false;
    const snapshot: WeatherSnapshot = {
      reason,
      stationId: station.id,
      stationName: station.name,
      stationLatitude: station.latitude,
      stationLongitude: station.longitude,
      observedAt,
      capturedAt: new Date().toISOString(),
      source: 'iem-current',
      stale,
      position: position ? { longitude: position.longitude, latitude: position.latitude, accuracy: position.accuracy } : undefined,
      temperatureF,
      dewpointF,
      relativeHumidityPercent: observationNumber(observation, ['relativehumidity[%]', 'relh[%]', 'rh[%]']) ?? relativeHumidity(temperatureF, dewpointF),
      windSpeedMph: windKnots === null ? null : windKnots * 1.15078,
      windGustMph: gustKnots === null ? null : gustKnots * 1.15078,
      windDirectionDegrees: observationNumber(observation, ['winddirection[deg]', 'drct', 'wind_direction[deg]']),
      rainTodayInches: observationNumber(observation, ['precip_today[in]', 'precipitation_today[in]', 'rain_today[in]']),
      pressureInHg: observationNumber(observation, ['altimeter[in]', 'pressure[in]', 'mslp[in]'])
    };
    saveCached(station, snapshot);
    return snapshot;
  } catch (error) {
    const cached = readCached(station, reason);
    if (cached) return cached;
    throw error;
  }
}

function parseWind(value: unknown): number | null {
  if (typeof value !== 'string') return finiteNumber(value);
  const values = [...value.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

export async function fetchHourlyForecast(position: { longitude: number; latitude: number }): Promise<ForecastPeriod[]> {
  const points = await fetch(`${NWS_POINTS_URL}/${position.latitude.toFixed(4)},${position.longitude.toFixed(4)}`, {
    cache: 'no-store', headers: { Accept: 'application/geo+json' }
  });
  if (!points.ok) throw new Error(`NWS location lookup returned ${points.status}`);
  const hourlyUrl = ((await points.json()) as { properties?: { forecastHourly?: string } }).properties?.forecastHourly;
  if (!hourlyUrl) throw new Error('NWS hourly forecast endpoint unavailable');

  const forecast = await fetch(hourlyUrl, { cache: 'no-store', headers: { Accept: 'application/geo+json' } });
  if (!forecast.ok) throw new Error(`NWS hourly forecast returned ${forecast.status}`);
  const periods = ((await forecast.json()) as { properties?: { periods?: Array<Record<string, unknown>> } }).properties?.periods ?? [];
  return periods.slice(0, 72).map((period) => {
    const rawTemp = finiteNumber(period.temperature);
    return {
      startTime: String(period.startTime ?? ''),
      endTime: String(period.endTime ?? ''),
      temperatureF: rawTemp === null ? null : String(period.temperatureUnit ?? 'F').toUpperCase() === 'C' ? rawTemp * 9 / 5 + 32 : rawTemp,
      humidityPercent: finiteNumber((period.relativeHumidity as { value?: unknown } | undefined)?.value),
      precipitationProbabilityPercent: finiteNumber((period.probabilityOfPrecipitation as { value?: unknown } | undefined)?.value),
      windSpeedMph: parseWind(period.windSpeed),
      windDirection: String(period.windDirection ?? ''),
      shortForecast: String(period.shortForecast ?? '')
    };
  }).filter((period) => period.startTime && period.endTime);
}

export function rateCurrentWeather(snapshot: WeatherSnapshot | null, settings: SpraySettings): { rating: SprayRating; reasons: string[] } {
  if (!snapshot) return { rating: 'unknown', reasons: ['No station observation loaded'] };
  let rating: SprayRating = snapshot.stale ? 'marginal' : 'good';
  const reasons: string[] = snapshot.stale ? ['station reading is stale or cached'] : [];

  if (snapshot.windSpeedMph === null) { rating = 'marginal'; reasons.push('wind unavailable'); }
  else if (snapshot.windSpeedMph > settings.maxWindMph) { rating = 'hold'; reasons.push(`wind exceeds ${settings.maxWindMph} mph`); }
  else if (snapshot.windSpeedMph > settings.maxWindMph * 0.8) { rating = 'marginal'; reasons.push('wind near limit'); }

  if (snapshot.windGustMph !== null && snapshot.windGustMph > settings.maxGustMph) { rating = 'hold'; reasons.push(`gust exceeds ${settings.maxGustMph} mph`); }
  else if (snapshot.windGustMph !== null && snapshot.windGustMph > settings.maxGustMph * 0.8 && rating !== 'hold') { rating = 'marginal'; reasons.push('gust near limit'); }

  if (snapshot.relativeHumidityPercent !== null && snapshot.relativeHumidityPercent < settings.minHumidityPercent) { rating = 'hold'; reasons.push(`humidity below ${settings.minHumidityPercent}%`); }
  if (snapshot.temperatureF !== null && (snapshot.temperatureF < settings.minTemperatureF || snapshot.temperatureF > settings.maxTemperatureF)) {
    rating = 'hold'; reasons.push(`temperature outside ${settings.minTemperatureF}–${settings.maxTemperatureF}°F`);
  }
  if (!reasons.length) reasons.push('station values inside configured limits');
  return { rating, reasons };
}

function periodFits(period: ForecastPeriod, settings: SpraySettings): boolean {
  return period.windSpeedMph !== null && period.windSpeedMph <= settings.maxWindMph
    && period.temperatureF !== null && period.temperatureF >= settings.minTemperatureF && period.temperatureF <= settings.maxTemperatureF
    && period.humidityPercent !== null && period.humidityPercent >= settings.minHumidityPercent
    && (period.precipitationProbabilityPercent ?? 0) <= settings.maxPrecipProbabilityPercent;
}

function dryTimeFits(periods: ForecastPeriod[], index: number, settings: SpraySettings): boolean {
  if (settings.requiredDryHours <= 0) return true;
  const future = periods.slice(index, index + settings.requiredDryHours);
  return future.length >= settings.requiredDryHours
    && future.every((period) => (period.precipitationProbabilityPercent ?? 0) <= settings.maxPrecipProbabilityPercent);
}

function summarize(periods: ForecastPeriod[]): SprayWindow {
  const nums = <T>(values: Array<T | null>): number[] => values.filter((value): value is T & number => typeof value === 'number');
  const temp = nums(periods.map((period) => period.temperatureF));
  const wind = nums(periods.map((period) => period.windSpeedMph));
  const humidity = nums(periods.map((period) => period.humidityPercent));
  const precip = nums(periods.map((period) => period.precipitationProbabilityPercent));
  return {
    startTime: periods[0].startTime,
    endTime: periods.at(-1)!.endTime,
    hours: periods.length,
    minTemperatureF: temp.length ? Math.min(...temp) : null,
    maxTemperatureF: temp.length ? Math.max(...temp) : null,
    maxWindMph: wind.length ? Math.max(...wind) : null,
    minHumidityPercent: humidity.length ? Math.min(...humidity) : null,
    maxPrecipitationPercent: precip.length ? Math.max(...precip) : 0
  };
}

export function findSprayWindows(periods: ForecastPeriod[], settings: SpraySettings): SprayWindow[] {
  const usable = periods.map((period, index) => periodFits(period, settings) && dryTimeFits(periods, index, settings));
  const windows: SprayWindow[] = [];
  let start = -1;
  for (let index = 0; index <= usable.length; index += 1) {
    if (usable[index] && start < 0) start = index;
    if ((!usable[index] || index === usable.length) && start >= 0) {
      const group = periods.slice(start, index);
      if (group.length >= settings.minimumWindowHours) windows.push(summarize(group));
      start = -1;
    }
  }
  return windows.slice(0, 6);
}
