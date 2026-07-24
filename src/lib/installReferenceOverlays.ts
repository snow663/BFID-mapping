import { Map as MapLibreMap, type IControl } from 'maplibre-gl';

const PATCH_FLAG = '__bfidReferenceOverlayPatchInstalled';
const MAP_FLAG = '__bfidReferenceOverlaysScheduled';
const STORAGE_KEY = 'bfid-map-layer-visibility-v1';
const STYLE_ID = 'bfid-layer-menu-styles';

const SD_ROAD_LABEL_TILES =
  'https://arcgis.sd.gov/arcgis/rest/services/SD_All/Transportation_Roads/MapServer/tile/{z}/{y}/{x}';
const USGS_NHD_TILES =
  'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show%3A2%2C4%2C6%2C7%2C9%2C10%2C12&f=image';
const ESRI_PLACE_LABEL_TILES =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

type ReferenceOverlay = {
  sourceId: string;
  layerId: string;
  tiles: string;
  opacity: number;
  minzoom: number;
  maxzoom: number;
  attribution: string;
};

const overlays: ReferenceOverlay[] = [
  {
    sourceId: 'reference-hydrography',
    layerId: 'reference-hydrography',
    tiles: USGS_NHD_TILES,
    opacity: 0.92,
    minzoom: 9,
    maxzoom: 19,
    attribution: 'USGS National Hydrography Dataset'
  },
  {
    sourceId: 'reference-road-labels',
    layerId: 'reference-road-labels',
    tiles: SD_ROAD_LABEL_TILES,
    opacity: 1,
    minzoom: 8,
    maxzoom: 17,
    attribution: 'South Dakota DOT / SD BIT'
  },
  {
    sourceId: 'reference-place-labels',
    layerId: 'reference-place-labels',
    tiles: ESRI_PLACE_LABEL_TILES,
    opacity: 1,
    minzoom: 0,
    maxzoom: 19,
    attribution: 'Esri, HERE, Garmin, OpenStreetMap contributors, GIS user community'
  }
];

const layerGroups = {
  project: [
    'segments-casing',
    'segments-unknown',
    'segments-verified',
    'segments-blocked',
    'segments-seasonal',
    'segments-foot-only',
    'segments-likely',
    'segments-selected'
  ],
  structures: ['structures-circle'],
  builder: ['builder-track-casing', 'builder-track-line'],
  roads: ['reference-road-labels'],
  hydrography: ['reference-hydrography'],
  places: ['reference-place-labels']
} as const;

type LayerKey = keyof typeof layerGroups;
type LayerVisibility = Record<LayerKey, boolean>;

const defaultVisibility: LayerVisibility = {
  project: true,
  structures: true,
  builder: true,
  roads: true,
  hydrography: true,
  places: true
};

const menuOptions: Array<{ key: LayerKey; label: string; detail: string }> = [
  { key: 'project', label: 'Mapped roads and canals', detail: 'Permanent BFID lines you create or import' },
  { key: 'structures', label: 'Structures and points', detail: 'Checks, boxes, gates, crossings and drop-ins' },
  { key: 'builder', label: 'Active recording line', detail: 'Yellow road-building trace while recording' },
  { key: 'roads', label: 'Roads and road names', detail: 'South Dakota transportation reference' },
  { key: 'hydrography', label: 'Waterways and water names', detail: 'USGS rivers, canals, ditches and water bodies' },
  { key: 'places', label: 'Towns and place names', detail: 'Cities, communities and general place labels' }
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
    // The controls still work for the current session if storage is unavailable.
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
}

function addReferenceOverlays(map: MapLibreMap): void {
  for (const overlay of overlays) {
    if (!map.getSource(overlay.sourceId)) {
      map.addSource(overlay.sourceId, {
        type: 'raster',
        tiles: [overlay.tiles],
        tileSize: 256,
        minzoom: overlay.minzoom,
        maxzoom: overlay.maxzoom,
        attribution: overlay.attribution
      });
    }

    if (!map.getLayer(overlay.layerId)) {
      map.addLayer({
        id: overlay.layerId,
        type: 'raster',
        source: overlay.sourceId,
        minzoom: overlay.minzoom,
        maxzoom: overlay.maxzoom,
        paint: {
          'raster-opacity': overlay.opacity,
          'raster-fade-duration': 0
        }
      });
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
      width: min(270px, calc(100vw - 92px));
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid #557565;
      border-radius: 9px;
      background: rgba(7, 22, 16, 0.97);
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
    note.textContent = 'Aerial, hillshade, slope and offline imagery are selected in the Map layers section below the map.';
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

/**
 * MapView owns the MapLibre instance. Hooking the first control addition lets us
 * register one post-load callback without exposing the map globally. The delayed
 * callback runs after MapView installs the selected aerial/terrain layer, keeping
 * the road, hydrography and place overlays above the imagery.
 */
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
            addReferenceOverlays(this);
            this.addControl(new LayerMenuControl(), 'top-right');
            applyVisibility(this, loadVisibility());
          } catch (error) {
            console.warn('Could not add map reference layers or layer menu', error);
          }
        }, 0);
      });
    }

    return originalAddControl.apply(this, args);
  };
}
