import { Map as MapLibreMap, type IControl } from 'maplibre-gl';

const PATCH_FLAG = '__bfidReferenceOverlayPatchInstalled';
const MAP_FLAG = '__bfidReferenceOverlaysScheduled';
const STORAGE_KEY = 'bfid-map-layer-visibility-v2';
const STYLE_ID = 'bfid-layer-menu-styles';

const SD_ROADS_SERVICE =
  'https://arcgis.sd.gov/arcgis/rest/services/SD_All/Transportation_Roads/MapServer';
const SD_CITIES_SERVICE =
  'https://arcgis.sd.gov/arcgis/rest/services/SD_All/Location_Cities/MapServer';
const USGS_NHD_SERVICE =
  'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer';

const ROAD_TILES = `${SD_ROADS_SERVICE}/tile/{z}/{y}/{x}`;
const HYDROGRAPHY_TILES =
  `${USGS_NHD_SERVICE}/export?bbox={bbox-epsg-3857}` +
  '&bboxSR=3857&imageSR=3857&size=256,256&dpi=96' +
  '&format=png32&transparent=true&layers=show:2,4,6,7,9,10,12&f=image';
const PLACE_TILES =
  `${SD_CITIES_SERVICE}/export?bbox={bbox-epsg-3857}` +
  '&bboxSR=3857&imageSR=3857&size=256,256&dpi=96' +
  '&format=png32&transparent=true&layers=show:0&f=image';

type LayerKey = 'project' | 'structures' | 'builder' | 'roads' | 'hydrography' | 'places';
type LayerVisibility = Record<LayerKey, boolean>;

type ReferenceOverlay = {
  sourceId: string;
  layerId: string;
  tiles: string;
  attribution: string;
  maxzoom: number;
};

const overlays: ReferenceOverlay[] = [
  {
    sourceId: 'reference-hydrography',
    layerId: 'reference-hydrography',
    tiles: HYDROGRAPHY_TILES,
    attribution: 'USGS National Hydrography Dataset',
    maxzoom: 20
  },
  {
    sourceId: 'reference-road-labels',
    layerId: 'reference-road-labels',
    tiles: ROAD_TILES,
    attribution: 'South Dakota DOT / SD BIT',
    maxzoom: 17
  },
  {
    sourceId: 'reference-place-labels',
    layerId: 'reference-place-labels',
    tiles: PLACE_TILES,
    attribution: 'South Dakota BIT',
    maxzoom: 20
  }
];

const layerGroups: Record<LayerKey, readonly string[]> = {
  project: [
    'segments-casing',
    'segments-unknown',
    'segments-verified',
    'segments-blocked',
    'segments-seasonal',
    'segments-foot-only',
    'segments-likely',
    'segments-selected',
    'segments-labels'
  ],
  structures: ['structures-circle', 'structures-labels'],
  builder: ['builder-track-casing', 'builder-track-line'],
  roads: ['reference-road-labels'],
  hydrography: ['reference-hydrography', 'usgs-irrigation-reference-labels'],
  places: ['reference-place-labels']
};

const defaultVisibility: LayerVisibility = {
  project: true,
  structures: true,
  builder: true,
  roads: true,
  hydrography: true,
  places: true
};

const menuOptions: Array<{ key: LayerKey; label: string; detail: string }> = [
  { key: 'project', label: 'Mapped BFID lines and names', detail: 'Canals, laterals, drains, pipelines and access roads stored in the project' },
  { key: 'structures', label: 'Structures and names', detail: 'Checks, boxes, gates, crossings and drop-ins' },
  { key: 'builder', label: 'Active recording line', detail: 'Current road-building or work trace' },
  { key: 'roads', label: 'Roads and road names', detail: 'South Dakota DOT road overlay; local names appear when zoomed in' },
  { key: 'hydrography', label: 'Water lines and names', detail: 'USGS streams, canals, ditches, reservoirs and named water features' },
  { key: 'places', label: 'Town and place names', detail: 'South Dakota cities and communities' }
];

function loadVisibility(): LayerVisibility {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultVisibility };
    const parsed = JSON.parse(raw) as Partial<LayerVisibility>;
    const result = { ...defaultVisibility };
    for (const key of Object.keys(defaultVisibility) as LayerKey[]) {
      if (typeof parsed[key] === 'boolean') result[key] = parsed[key]!;
    }
    return result;
  } catch {
    return { ...defaultVisibility };
  }
}

function saveVisibility(visibility: LayerVisibility): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // Visibility remains functional for the current session.
  }
}

function setGroupVisibility(map: MapLibreMap, key: LayerKey, visible: boolean): void {
  const value = visible ? 'visible' : 'none';
  for (const layerId of layerGroups[key]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', value);
  }
}

function applyVisibility(map: MapLibreMap, visibility: LayerVisibility): void {
  for (const key of Object.keys(layerGroups) as LayerKey[]) {
    setGroupVisibility(map, key, visibility[key]);
  }
  syncIrrigationLabelVisibility(map);
}

function addOperationalLabels(map: MapLibreMap): void {
  if (map.getSource('segments') && !map.getLayer('segments-labels')) {
    map.addLayer({
      id: 'segments-labels',
      type: 'symbol',
      source: 'segments',
      minzoom: 9.5,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name'], ''],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9.5, 10, 13, 13, 17, 16],
        'symbol-spacing': 260,
        'text-padding': 4,
        'text-max-angle': 40,
        'text-keep-upright': true,
        'text-letter-spacing': 0.02,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#fff4bd',
        'text-halo-color': 'rgba(4, 12, 8, 0.98)',
        'text-halo-width': 2.2,
        'text-halo-blur': 0.4
      }
    } as any);
  }

  if (map.getSource('structures') && !map.getLayer('structures-labels')) {
    map.addLayer({
      id: 'structures-labels',
      type: 'symbol',
      source: 'structures',
      minzoom: 12,
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ''],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 14],
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-padding': 3,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(4, 12, 8, 0.98)',
        'text-halo-width': 2
      }
    } as any);
  }
}

function addIrrigationReferenceLabels(map: MapLibreMap): void {
  if (!map.getSource('usgs-irrigation-reference') || map.getLayer('usgs-irrigation-reference-labels')) return;

  map.addLayer({
    id: 'usgs-irrigation-reference-labels',
    type: 'symbol',
    source: 'usgs-irrigation-reference',
    minzoom: 10.5,
    layout: {
      'symbol-placement': 'line',
      'text-field': [
        'coalesce',
        ['get', 'GNIS_NAME'],
        ['get', 'GNIS_Name'],
        ['get', 'name'],
        ''
      ],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 10, 15, 14],
      'symbol-spacing': 300,
      'text-padding': 4,
      'text-max-angle': 40,
      'text-keep-upright': true,
      'text-allow-overlap': false
    },
    paint: {
      'text-color': '#a9efff',
      'text-halo-color': 'rgba(3, 14, 18, 0.98)',
      'text-halo-width': 2.2
    }
  } as any);

  syncIrrigationLabelVisibility(map);
}

function syncIrrigationLabelVisibility(map: MapLibreMap): void {
  if (!map.getLayer('usgs-irrigation-reference-labels')) return;
  const lineVisibility = map.getLayer('usgs-irrigation-reference-line')
    ? map.getLayoutProperty('usgs-irrigation-reference-line', 'visibility')
    : 'visible';
  const hydroVisible = loadVisibility().hydrography;
  map.setLayoutProperty(
    'usgs-irrigation-reference-labels',
    'visibility',
    hydroVisible && lineVisibility !== 'none' ? 'visible' : 'none'
  );
}

function addReferenceOverlays(map: MapLibreMap): void {
  const beforeId = map.getLayer('segments-casing') ? 'segments-casing' : undefined;

  for (const overlay of overlays) {
    try {
      if (!map.getSource(overlay.sourceId)) {
        map.addSource(overlay.sourceId, {
          type: 'raster',
          tiles: [overlay.tiles],
          tileSize: 256,
          minzoom: 0,
          maxzoom: overlay.maxzoom,
          attribution: overlay.attribution
        });
      }

      if (!map.getLayer(overlay.layerId)) {
        map.addLayer(
          {
            id: overlay.layerId,
            type: 'raster',
            source: overlay.sourceId,
            paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 }
          },
          beforeId
        );
      }
    } catch (error) {
      console.warn(`Could not add ${overlay.layerId}`, error);
    }
  }
}

function ensureMenuStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .bfid-layer-control { position: relative; overflow: visible !important; }
    .bfid-layer-button {
      width: auto !important;
      min-width: 72px;
      padding: 0 10px !important;
      color: #152019;
      font: 700 13px/29px system-ui, sans-serif;
      white-space: nowrap;
    }
    .bfid-layer-menu {
      position: absolute;
      top: 0;
      right: calc(100% + 7px);
      width: min(290px, calc(100vw - 92px));
      max-height: calc(100vh - 80px);
      overflow-y: auto;
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid #557565;
      border-radius: 9px;
      background: rgba(7, 22, 16, 0.98);
      color: #edf4ef;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
      text-align: left;
    }
    .bfid-layer-menu[hidden] { display: none; }
    .bfid-layer-menu strong { font: 700 14px/1.2 system-ui, sans-serif; }
    .bfid-layer-option {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      column-gap: 8px;
      align-items: start;
      padding: 7px 5px;
      border-radius: 6px;
      cursor: pointer;
    }
    .bfid-layer-option:hover { background: #193126; }
    .bfid-layer-option input {
      width: 18px;
      height: 18px;
      min-height: 0;
      margin: 1px 0 0;
      accent-color: #43c270;
    }
    .bfid-layer-option span { display: grid; gap: 2px; }
    .bfid-layer-option b { font: 600 13px/1.25 system-ui, sans-serif; }
    .bfid-layer-option small,
    .bfid-layer-note { color: #a9bbb0; font: 11px/1.35 system-ui, sans-serif; }
    .bfid-layer-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .bfid-layer-actions button {
      min-height: 34px;
      border: 1px solid #456454;
      border-radius: 6px;
      background: #172b21;
      color: #edf4ef;
      font: 600 12px system-ui, sans-serif;
      cursor: pointer;
    }
    .bfid-layer-actions button:hover { background: #28543e; }
  `;
  document.head.append(style);
}

class LayerMenuControl implements IControl {
  private map: MapLibreMap | null = null;
  private container: HTMLDivElement | null = null;
  private visibility: LayerVisibility = loadVisibility();

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    ensureMenuStyles();

    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group bfid-layer-control';
    this.container = container;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bfid-layer-button';
    button.textContent = 'Layers';
    button.title = 'Show or hide map layers';
    button.setAttribute('aria-label', 'Show or hide map layers');
    button.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('div');
    panel.className = 'bfid-layer-menu';
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Map layer visibility');

    const heading = document.createElement('strong');
    heading.textContent = 'Visible map elements';
    panel.append(heading);

    const inputs = new Map<LayerKey, HTMLInputElement>();
    const updateAll = (next: LayerVisibility): void => {
      this.visibility = next;
      saveVisibility(next);
      applyVisibility(map, next);
      for (const [key, input] of inputs) input.checked = next[key];
    };

    for (const option of menuOptions) {
      const label = document.createElement('label');
      label.className = 'bfid-layer-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = this.visibility[option.key];
      inputs.set(option.key, input);
      input.addEventListener('change', () => {
        updateAll({ ...this.visibility, [option.key]: input.checked });
      });

      const text = document.createElement('span');
      const title = document.createElement('b');
      title.textContent = option.label;
      const detail = document.createElement('small');
      detail.textContent = option.detail;
      text.append(title, detail);
      label.append(input, text);
      panel.append(label);
    }

    const actions = document.createElement('div');
    actions.className = 'bfid-layer-actions';
    const allOn = document.createElement('button');
    allOn.type = 'button';
    allOn.textContent = 'Show all';
    allOn.addEventListener('click', () => updateAll({ ...defaultVisibility }));
    const allOff = document.createElement('button');
    allOff.type = 'button';
    allOff.textContent = 'Hide all';
    allOff.addEventListener('click', () => {
      updateAll({ project: false, structures: false, builder: false, roads: false, hydrography: false, places: false });
    });
    actions.append(allOn, allOff);
    panel.append(actions);

    const note = document.createElement('div');
    note.className = 'bfid-layer-note';
    note.textContent = 'BFID names come from the local project. Public road and water names come from South Dakota and USGS services.';
    panel.append(note);

    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
    });

    for (const eventName of ['click', 'dblclick', 'mousedown', 'touchstart', 'wheel']) {
      container.addEventListener(eventName, (event) => event.stopPropagation());
    }

    container.append(button, panel);
    applyVisibility(map, this.visibility);
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
    this.map = null;
  }
}

function initializeMapNames(map: MapLibreMap): void {
  addReferenceOverlays(map);
  addOperationalLabels(map);
  addIrrigationReferenceLabels(map);

  const ensureDynamicLabels = (): void => {
    try {
      addOperationalLabels(map);
      addIrrigationReferenceLabels(map);
      applyVisibility(map, loadVisibility());
    } catch (error) {
      console.warn('Could not refresh map-name layers', error);
    }
  };

  map.on('sourcedata', ensureDynamicLabels);
  map.on('styledata', ensureDynamicLabels);
  map.on('idle', () => syncIrrigationLabelVisibility(map));
  map.once('remove', () => {
    map.off('sourcedata', ensureDynamicLabels);
    map.off('styledata', ensureDynamicLabels);
  });

  map.addControl(new LayerMenuControl(), 'top-right');
  applyVisibility(map, loadVisibility());
}

export function installReferenceOverlayPatch(): void {
  const prototype = MapLibreMap.prototype as any;
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_FLAG)) return;
  prototype[PATCH_FLAG] = true;

  const originalAddControl = prototype.addControl as (...args: any[]) => MapLibreMap;
  prototype.addControl = function patchedAddControl(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const mapWithFlag = this as any;
    if (!Object.prototype.hasOwnProperty.call(mapWithFlag, MAP_FLAG)) {
      mapWithFlag[MAP_FLAG] = true;
      this.once('load', () => {
        window.setTimeout(() => {
          try {
            initializeMapNames(this);
          } catch (error) {
            console.warn('Could not add map names or layer menu', error);
          }
        }, 0);
      });
    }

    return originalAddControl.apply(this, args);
  };
}
