import { Map as MapLibreMap } from 'maplibre-gl';

const PATCH_FLAG = '__bfidMapPolishInstalled';
const MAP_FLAG = '__bfidMapPolishScheduled';
const STYLE_ID = 'bfid-map-polish-styles';
const ROAD_SOURCE_ID = 'reference-road-labels';
const ROAD_LAYER_ID = 'reference-road-labels';
const SEGMENT_LABEL_LAYER_ID = 'segments-labels';
const STRUCTURE_LABEL_LAYER_ID = 'structures-labels';
const RECON_LABEL_LAYER_ID = 'usgs-irrigation-reference-labels';
const RECON_SOURCE_ID = 'usgs-irrigation-reference';
const RECON_LINE_LAYER_ID = 'usgs-irrigation-reference-line';
const ROAD_TILE_URL =
  'https://arcgis.sd.gov/arcgis/rest/services/SD_All/Transportation_Roads/MapServer/tile/{z}/{y}/{x}';

const PANEL_SELECTOR = '.bfid-recon-panel,.bfid-layer-menu,.bfid-import-panel';
const BUTTON_SELECTOR = '.bfid-recon-button,.bfid-layer-button,.bfid-import-button';
const CONTROL_SELECTOR = '.bfid-recon-control,.bfid-layer-control,.bfid-import-control';

let panelManagerInstalled = false;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ${PANEL_SELECTOR} {
      scrollbar-color: #527161 #0b1d15;
      overscroll-behavior: contain;
    }

    @media (max-width: 900px), (pointer: coarse) and (max-width: 1200px) {
      ${PANEL_SELECTOR} {
        position: fixed !important;
        top: calc(60px + env(safe-area-inset-top, 0px)) !important;
        right: 10px !important;
        bottom: calc(10px + env(safe-area-inset-bottom, 0px)) !important;
        left: 10px !important;
        width: auto !important;
        max-width: none !important;
        max-height: none !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        z-index: 10000 !important;
        border-radius: 11px !important;
        box-shadow: 0 14px 45px rgba(0,0,0,.62) !important;
      }

      .bfid-recon-grid,
      .bfid-import-grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media (max-width: 390px) {
      .bfid-recon-grid,
      .bfid-import-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.append(style);
}

function closePanelsExcept(exception: Element | null = null): void {
  for (const panel of document.querySelectorAll<HTMLElement>(PANEL_SELECTOR)) {
    const control = panel.closest(CONTROL_SELECTOR);
    if (exception && control === exception) continue;
    panel.hidden = true;
    const button = control?.querySelector<HTMLButtonElement>(BUTTON_SELECTOR);
    button?.setAttribute('aria-expanded', 'false');
  }
}

function installPanelManager(): void {
  if (panelManagerInstalled) return;
  panelManagerInstalled = true;

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const button = target.closest(BUTTON_SELECTOR);
      if (button) {
        closePanelsExcept(button.closest(CONTROL_SELECTOR));
        return;
      }

      if (target.closest(PANEL_SELECTOR)) return;
      closePanelsExcept();
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanelsExcept();
  });
}

function addReliableRoadOverlay(map: MapLibreMap): void {
  if (!map.getSource(ROAD_SOURCE_ID)) {
    map.addSource(ROAD_SOURCE_ID, {
      type: 'raster',
      tiles: [ROAD_TILE_URL],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 17,
      attribution: 'South Dakota Department of Transportation'
    });
  }

  if (!map.getLayer(ROAD_LAYER_ID)) {
    map.addLayer({
      id: ROAD_LAYER_ID,
      type: 'raster',
      source: ROAD_SOURCE_ID,
      paint: {
        'raster-opacity': 0.96,
        'raster-fade-duration': 0
      }
    });
  }
}

function addOperationalLabels(map: MapLibreMap): void {
  if (map.getSource('segments') && !map.getLayer(SEGMENT_LABEL_LAYER_ID)) {
    map.addLayer({
      id: SEGMENT_LABEL_LAYER_ID,
      type: 'symbol',
      source: 'segments',
      minzoom: 10.5,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 300,
        'text-field': ['get', 'name'],
        'text-font': ['Arial'],
        'text-size': 12,
        'text-max-angle': 35,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-allow-overlap': false,
        'text-ignore-placement': false
      },
      paint: {
        'text-color': '#f4faf6',
        'text-halo-color': '#07120d',
        'text-halo-width': 2,
        'text-halo-blur': 0.4
      }
    });
  }

  if (map.getSource('structures') && !map.getLayer(STRUCTURE_LABEL_LAYER_ID)) {
    map.addLayer({
      id: STRUCTURE_LABEL_LAYER_ID,
      type: 'symbol',
      source: 'structures',
      minzoom: 13,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Arial'],
        'text-size': 11,
        'text-offset': [0, 1.25],
        'text-anchor': 'top',
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#fff3c2',
        'text-halo-color': '#07120d',
        'text-halo-width': 2,
        'text-halo-blur': 0.4
      }
    });
  }

  if (map.getSource(RECON_SOURCE_ID) && !map.getLayer(RECON_LABEL_LAYER_ID)) {
    map.addLayer({
      id: RECON_LABEL_LAYER_ID,
      type: 'symbol',
      source: RECON_SOURCE_ID,
      minzoom: 10.5,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 360,
        'text-field': [
          'coalesce',
          ['get', 'gnis_name'],
          ['get', 'GNIS_NAME'],
          ['get', 'GNIS_Name'],
          ''
        ],
        'text-font': ['Arial'],
        'text-size': 11,
        'text-max-angle': 35,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#bceeff',
        'text-halo-color': '#061417',
        'text-halo-width': 2,
        'text-halo-blur': 0.4
      }
    });
  }

  for (const id of [ROAD_LAYER_ID, SEGMENT_LABEL_LAYER_ID, STRUCTURE_LABEL_LAYER_ID, RECON_LABEL_LAYER_ID]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

function scheduleLabels(map: MapLibreMap): void {
  const refresh = (): void => {
    try {
      addReliableRoadOverlay(map);
      addOperationalLabels(map);
    } catch (error) {
      console.warn('Could not restore map labels', error);
    }
  };

  refresh();
  for (const delay of [100, 400, 1000, 2200]) window.setTimeout(refresh, delay);
}

export function installMapPolishPatch(): void {
  if (typeof document !== 'undefined') {
    ensureStyles();
    installPanelManager();
  }

  const prototype = MapLibreMap.prototype as any;
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_FLAG)) return;
  prototype[PATCH_FLAG] = true;

  const originalSetLayoutProperty = prototype.setLayoutProperty as (...args: any[]) => MapLibreMap;
  prototype.setLayoutProperty = function patchedSetLayoutProperty(
    this: MapLibreMap,
    layerId: string,
    propertyName: string,
    value: unknown,
    ...rest: any[]
  ): MapLibreMap {
    const result = originalSetLayoutProperty.call(this, layerId, propertyName, value, ...rest);
    if (propertyName !== 'visibility') return result;

    const mirror = (targetId: string): void => {
      if (this.getLayer(targetId)) originalSetLayoutProperty.call(this, targetId, propertyName, value, ...rest);
    };

    if (layerId.startsWith('segments-')) mirror(SEGMENT_LABEL_LAYER_ID);
    if (layerId === 'structures-circle') mirror(STRUCTURE_LABEL_LAYER_ID);
    if (layerId === RECON_LINE_LAYER_ID) mirror(RECON_LABEL_LAYER_ID);
    return result;
  };

  const originalAddControl = prototype.addControl as (...args: any[]) => MapLibreMap;
  prototype.addControl = function patchedAddControl(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const mapWithFlag = this as any;
    const firstControl = !Object.prototype.hasOwnProperty.call(mapWithFlag, MAP_FLAG);
    if (firstControl) {
      mapWithFlag[MAP_FLAG] = true;
      this.once('load', () => scheduleLabels(this));
    }
    return originalAddControl.apply(this, args);
  };
}
