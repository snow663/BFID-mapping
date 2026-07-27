import { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';

const PATCH_FLAG = '__bfidMesonetPatchInstalled';
const MAP_FLAG = '__bfidMesonetInitialized';
const VISIBILITY_KEY = 'bfid-mesonet-stations-visible-v1';
const STYLE_ID = 'bfid-mesonet-styles';
const MENU_OPTION_ID = 'bfid-mesonet-layer-option';
const IEM_CURRENT_URL = 'https://mesonet.agron.iastate.edu/json/current.py';

type MesonetStation = {
  id: string;
  name: string;
  detail: string;
  longitude: number;
  latitude: number;
  elevationFeet: number;
  dashboardUrl: string;
  fieldNote?: string;
};

type MesonetState = {
  markers: Marker[];
  visible: boolean;
};

const stations: MesonetStation[] = [
  {
    id: 'NISS2',
    name: 'Nisland Mesonet',
    detail: 'Nisland · Butte County',
    longitude: -103.560272,
    latitude: 44.678235,
    elevationFeet: 2905,
    dashboardUrl: 'https://climate.sdstate.edu/weather/?num=70',
    fieldNote: 'Highway 212 station at the former BFID ditch-rider residence property.'
  },
  {
    id: 'NLMS2',
    name: 'Newell Mesonet',
    detail: 'Newell 13 NNW · Butte County',
    longitude: -103.488019,
    latitude: 44.900363,
    elevationFeet: 3133,
    dashboardUrl: 'https://climate.sdstate.edu/weather/?num=701'
  }
];

function getState(map: MapLibreMap): MesonetState {
  const mapWithState = map as any;
  if (!mapWithState.__bfidMesonetState) {
    mapWithState.__bfidMesonetState = {
      markers: [],
      visible: loadVisibility()
    } satisfies MesonetState;
  }
  return mapWithState.__bfidMesonetState as MesonetState;
}

function loadVisibility(): boolean {
  try {
    const raw = window.localStorage.getItem(VISIBILITY_KEY);
    return raw === null ? true : raw !== 'false';
  } catch {
    return true;
  }
}

function saveVisibility(visible: boolean): void {
  try {
    window.localStorage.setItem(VISIBILITY_KEY, String(visible));
  } catch {
    // The control remains functional for this session.
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .bfid-mesonet-marker {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 2px solid #f7fbf8;
      border-radius: 50% 50% 50% 12%;
      background: #1875c8;
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.58);
      transform: rotate(-45deg);
      cursor: pointer;
    }
    .bfid-mesonet-marker:hover,
    .bfid-mesonet-marker:focus-visible {
      background: #2499ed;
      outline: 3px solid rgba(36, 153, 237, 0.35);
    }
    .bfid-mesonet-marker svg {
      width: 20px;
      height: 20px;
      transform: rotate(45deg);
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .bfid-mesonet-popup .maplibregl-popup-content {
      width: min(310px, calc(100vw - 52px));
      padding: 0;
      overflow: hidden;
      border: 1px solid #4f7461;
      border-radius: 10px;
      background: #0d2118;
      color: #edf4ef;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
    }
    .bfid-mesonet-popup .maplibregl-popup-tip { border-top-color: #0d2118; }
    .bfid-mesonet-popup .maplibregl-popup-close-button {
      width: 34px;
      height: 34px;
      color: #edf4ef;
      font-size: 22px;
    }
    .bfid-mesonet-card { display: grid; gap: 10px; padding: 14px; }
    .bfid-mesonet-heading { display: grid; gap: 2px; padding-right: 28px; }
    .bfid-mesonet-heading strong { font: 700 16px/1.2 system-ui, sans-serif; }
    .bfid-mesonet-heading span,
    .bfid-mesonet-meta { color: #aec1b6; font: 12px/1.35 system-ui, sans-serif; }
    .bfid-mesonet-note {
      padding: 8px 9px;
      border-left: 3px solid #d7a53d;
      border-radius: 4px;
      background: #1a3025;
      color: #e9d9ad;
      font: 12px/1.4 system-ui, sans-serif;
    }
    .bfid-mesonet-status { color: #b9c9c0; font: 12px/1.4 system-ui, sans-serif; }
    .bfid-mesonet-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
    }
    .bfid-mesonet-reading {
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: 8px;
      border: 1px solid #345344;
      border-radius: 7px;
      background: #122a1f;
    }
    .bfid-mesonet-reading small { color: #9fb4a8; font: 10px/1.2 system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.04em; }
    .bfid-mesonet-reading b { overflow-wrap: anywhere; font: 700 14px/1.25 system-ui, sans-serif; }
    .bfid-mesonet-actions { display: grid; grid-template-columns: 1fr auto; gap: 7px; }
    .bfid-mesonet-actions a,
    .bfid-mesonet-actions button {
      min-height: 36px;
      display: grid;
      place-items: center;
      padding: 7px 10px;
      border: 1px solid #507765;
      border-radius: 6px;
      background: #183426;
      color: #edf4ef;
      font: 600 12px system-ui, sans-serif;
      text-decoration: none;
      cursor: pointer;
    }
    .bfid-mesonet-actions a:hover,
    .bfid-mesonet-actions button:hover { background: #28543e; }
  `;
  document.head.append(style);
}

function setVisible(map: MapLibreMap, visible: boolean): void {
  const state = getState(map);
  state.visible = visible;
  saveVisibility(visible);
  for (const marker of state.markers) {
    marker.getElement().style.display = visible ? 'grid' : 'none';
  }
}

function numericValue(observation: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = observation[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function cardinalDirection(degrees: number | null): string {
  if (degrees === null) return '—';
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return directions[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

function relativeHumidity(tempF: number | null, dewpointF: number | null): number | null {
  if (tempF === null || dewpointF === null) return null;
  const tempC = (tempF - 32) * (5 / 9);
  const dewC = (dewpointF - 32) * (5 / 9);
  const a = 17.625;
  const b = 243.04;
  const humidity = 100 * Math.exp((a * dewC) / (b + dewC) - (a * tempC) / (b + tempC));
  return Math.max(0, Math.min(100, humidity));
}

function formatNumber(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits);
}

function formatObservationTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Observation time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function reading(label: string, value: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'bfid-mesonet-reading';
  const small = document.createElement('small');
  small.textContent = label;
  const bold = document.createElement('b');
  bold.textContent = value;
  item.append(small, bold);
  return item;
}

async function renderCurrentConditions(station: MesonetStation, body: HTMLElement): Promise<void> {
  body.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'bfid-mesonet-status';
  loading.textContent = 'Loading current observation…';
  body.append(loading);

  try {
    const url = new URL(IEM_CURRENT_URL);
    url.searchParams.set('network', 'SD_DCP');
    url.searchParams.set('station', station.id);
    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Observation service returned ${response.status}`);

    const payload = (await response.json()) as { last_ob?: Record<string, unknown> | null };
    const observation = payload.last_ob;
    if (!observation) throw new Error('No recent observation was returned');

    const temp = numericValue(observation, ['airtemp[F]', 'tmpf', 'temperature[F]']);
    const dewpoint = numericValue(observation, ['dewpointtemp[F]', 'dwpf', 'dewpoint[F]']);
    const humidity = numericValue(observation, ['relativehumidity[%]', 'relh[%]', 'rh[%]']) ?? relativeHumidity(temp, dewpoint);
    const windKnots = numericValue(observation, ['windspeed[kt]', 'sknt', 'wind_speed[kt]']);
    const gustKnots = numericValue(observation, ['windgust[kt]', 'gust[kt]', 'gust', 'max_wind_speed[kt]']);
    const direction = numericValue(observation, ['winddirection[deg]', 'drct', 'wind_direction[deg]']);
    const rain = numericValue(observation, ['precip_today[in]', 'precipitation_today[in]', 'rain_today[in]']);
    const pressure = numericValue(observation, ['altimeter[in]', 'pressure[in]', 'mslp[in]']);
    const windMph = windKnots === null ? null : windKnots * 1.15078;
    const gustMph = gustKnots === null ? null : gustKnots * 1.15078;

    const grid = document.createElement('div');
    grid.className = 'bfid-mesonet-grid';
    grid.append(
      reading('Temperature', `${formatNumber(temp)} °F`),
      reading('Humidity', `${formatNumber(humidity)}%`),
      reading('Wind', windMph === null ? '—' : `${cardinalDirection(direction)} ${formatNumber(windMph)} mph`),
      reading('Gust', gustMph === null ? '—' : `${formatNumber(gustMph)} mph`),
      reading('Rain today', rain === null ? '—' : `${formatNumber(rain, 2)} in`),
      reading('Pressure', pressure === null ? '—' : `${formatNumber(pressure, 2)} inHg`)
    );

    const meta = document.createElement('div');
    meta.className = 'bfid-mesonet-meta';
    meta.textContent = `${formatObservationTime(observation.utc_valid)} · provisional current observation via Iowa Environmental Mesonet`;
    body.replaceChildren(grid, meta);
  } catch (error) {
    const failed = document.createElement('div');
    failed.className = 'bfid-mesonet-status';
    failed.textContent = error instanceof Error
      ? `${error.message}. Open the official SDSU dashboard below.`
      : 'Current conditions are unavailable. Open the official SDSU dashboard below.';
    body.replaceChildren(failed);
  }
}

function buildPopup(station: MesonetStation): { popup: Popup; conditions: HTMLElement } {
  const card = document.createElement('div');
  card.className = 'bfid-mesonet-card';

  const heading = document.createElement('div');
  heading.className = 'bfid-mesonet-heading';
  const title = document.createElement('strong');
  title.textContent = station.name;
  const detail = document.createElement('span');
  detail.textContent = `${station.detail} · ${station.id} · ${station.elevationFeet.toLocaleString('en-US')} ft`;
  heading.append(title, detail);
  card.append(heading);

  if (station.fieldNote) {
    const note = document.createElement('div');
    note.className = 'bfid-mesonet-note';
    note.textContent = station.fieldNote;
    card.append(note);
  }

  const conditions = document.createElement('div');
  card.append(conditions);

  const actions = document.createElement('div');
  actions.className = 'bfid-mesonet-actions';
  const dashboard = document.createElement('a');
  dashboard.href = station.dashboardUrl;
  dashboard.target = '_blank';
  dashboard.rel = 'noopener noreferrer';
  dashboard.textContent = 'Open SDSU dashboard';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh';
  refresh.addEventListener('click', () => void renderCurrentConditions(station, conditions));
  actions.append(dashboard, refresh);
  card.append(actions);

  const popup = new Popup({ offset: 28, closeButton: true, closeOnClick: true, className: 'bfid-mesonet-popup' })
    .setDOMContent(card);
  popup.on('open', () => void renderCurrentConditions(station, conditions));
  return { popup, conditions };
}

function createMarker(map: MapLibreMap, station: MesonetStation): Marker {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'bfid-mesonet-marker';
  element.title = `${station.name} — open current conditions`;
  element.setAttribute('aria-label', element.title);
  element.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v4M5.6 5.6l2.8 2.8M3 12h4M5.6 18.4l2.8-2.8M12 17v4M18.4 18.4l-2.8-2.8M17 12h4M18.4 5.6l-2.8 2.8"></path>
      <circle cx="12" cy="12" r="3.6"></circle>
    </svg>
  `;

  const { popup } = buildPopup(station);
  return new Marker({ element, anchor: 'bottom' })
    .setLngLat([station.longitude, station.latitude])
    .setPopup(popup)
    .addTo(map);
}

function installLayerMenuOption(map: MapLibreMap, attempt = 0): void {
  const menu = map.getContainer().querySelector('.bfid-layer-menu');
  if (!(menu instanceof HTMLElement)) {
    if (attempt < 30) window.setTimeout(() => installLayerMenuOption(map, attempt + 1), 150);
    return;
  }
  if (menu.querySelector(`#${MENU_OPTION_ID}`)) return;

  const state = getState(map);
  const option = document.createElement('label');
  option.id = MENU_OPTION_ID;
  option.className = 'bfid-layer-option';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = state.visible;
  input.addEventListener('change', () => setVisible(map, input.checked));

  const text = document.createElement('span');
  const title = document.createElement('b');
  title.textContent = 'Mesonet stations';
  const detail = document.createElement('small');
  detail.textContent = 'Nisland and Newell station locations with current observations';
  text.append(title, detail);
  option.append(input, text);

  const actions = menu.querySelector('.bfid-layer-actions');
  menu.insertBefore(option, actions);

  if (actions) {
    for (const button of actions.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        const visible = button.textContent?.trim() === 'Show all';
        input.checked = visible;
        setVisible(map, visible);
      });
    }
  }
}

function initializeMesonet(map: MapLibreMap): void {
  ensureStyles();
  const state = getState(map);
  state.markers = stations.map((station) => createMarker(map, station));
  setVisible(map, state.visible);
  installLayerMenuOption(map);

  map.once('remove', () => {
    for (const marker of state.markers) marker.remove();
    state.markers = [];
  });
}

export function installMesonetStationsPatch(): void {
  const prototype = MapLibreMap.prototype as any;
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_FLAG)) return;
  prototype[PATCH_FLAG] = true;

  const originalAddControl = prototype.addControl as (...args: any[]) => MapLibreMap;
  prototype.addControl = function patchedAddControl(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const mapWithFlag = this as any;
    if (!Object.prototype.hasOwnProperty.call(mapWithFlag, MAP_FLAG)) {
      mapWithFlag[MAP_FLAG] = true;
      this.once('load', () => window.setTimeout(() => initializeMesonet(this), 300));
    }
    return originalAddControl.apply(this, args);
  };
}
