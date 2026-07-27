import { Map as MapLibreMap, type GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection, GeoJsonProperties, LineString, MultiLineString } from 'geojson';

const PATCH_FLAG = '__bfidMapPolishInstalled';
const MAP_FLAG = '__bfidMapPolishScheduled';
const STYLE_ID = 'bfid-map-polish-styles';
const GLYPH_URL = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

const LEGACY_ROAD_LAYER_ID = 'reference-road-labels';
const ROAD_SOURCE_ID = 'sd-road-label-overlay-source';
const ROAD_LAYER_ID = 'sd-road-label-overlay';
const SEGMENT_LABEL_LAYER_ID = 'segments-labels';
const STRUCTURE_LABEL_LAYER_ID = 'structures-labels';
const RECON_LABEL_LAYER_ID = 'usgs-irrigation-reference-labels';
const RECON_FALLBACK_LABEL_LAYER_ID = 'usgs-irrigation-reference-fallback-labels';
const RECON_SOURCE_ID = 'usgs-irrigation-reference';
const RECON_LINE_LAYER_ID = 'usgs-irrigation-reference-line';
const WATER_LABEL_SOURCE_ID = 'usgs-named-water-label-source';
const WATER_LABEL_LAYER_ID = 'usgs-named-water-labels';
const LEGACY_WATER_LAYER_ID = 'reference-hydrography';
const ROAD_TILE_URL =
  'https://arcgis.sd.gov/arcgis/rest/services/SD_All/Transportation_Roads/MapServer/tile/{z}/{y}/{x}';
const WATER_QUERY_URL = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/2/query';

const PANEL_SELECTOR = '.bfid-recon-panel,.bfid-layer-menu,.bfid-import-panel';
const BUTTON_SELECTOR = '.bfid-recon-button,.bfid-layer-button,.bfid-import-button';
const CONTROL_SELECTOR = '.bfid-recon-control,.bfid-layer-control,.bfid-import-control';

const workspaceSections = [
  { key: 'position', heading: 'Position', label: 'GPS' },
  { key: 'layers', heading: 'Map layers', label: 'Map' },
  { key: 'builder', heading: 'Map builder', label: 'Build' },
  { key: 'recording', heading: 'Field recording', label: 'Track' },
  { key: 'segment', heading: 'Selected segment', label: 'Segment' },
  { key: 'data', heading: 'Portable data', label: 'Data' }
] as const;

type WorkspaceKey = (typeof workspaceSections)[number]['key'];
type WaterGeometry = LineString | MultiLineString;
type WaterFeature = Feature<WaterGeometry, GeoJsonProperties>;
type WaterCollection = FeatureCollection<WaterGeometry, GeoJsonProperties>;

type PortalRecord = {
  control: HTMLElement;
  parent: Node;
  nextSibling: ChildNode | null;
};

type WaterState = {
  controller: AbortController | null;
  timer: number | null;
};

const portalRecords = new WeakMap<HTMLElement, PortalRecord>();
const portaledPanels = new Set<HTMLElement>();
const roadInstalled = new WeakSet<MapLibreMap>();
const waterStates = new WeakMap<MapLibreMap, WaterState>();
let panelManagerInstalled = false;
let workspaceInstalled = false;

function emptyWaterCollection(): WaterCollection {
  return { type: 'FeatureCollection', features: [] };
}

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 900px), (pointer: coarse) and (max-width: 1200px)').matches;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ${PANEL_SELECTOR} {
      scrollbar-color: #527161 #0b1d15;
      overscroll-behavior: contain;
    }

    .bfid-quick-toolbar,
    .bfid-mobile-sheet-header {
      display: none;
    }

    @media (max-width: 900px), (pointer: coarse) and (max-width: 1200px) {
      .app-shell {
        grid-template-columns: minmax(0, 1fr) !important;
        grid-template-rows: 52px minmax(0, 1fr) !important;
      }

      .topbar {
        grid-column: 1 !important;
        grid-row: 1 !important;
      }

      .map-panel {
        grid-column: 1 !important;
        grid-row: 2 !important;
        min-height: 0 !important;
      }

      .sidebar {
        position: fixed !important;
        z-index: 8500 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: calc(64px + env(safe-area-inset-bottom, 0px)) !important;
        width: 100% !important;
        height: min(64dvh, 690px) !important;
        min-height: 250px !important;
        padding: 0 13px 18px !important;
        overflow-y: auto !important;
        overscroll-behavior: contain !important;
        border: 1px solid #496756 !important;
        border-bottom: 0 !important;
        border-radius: 16px 16px 0 0 !important;
        background: rgba(8, 24, 17, .985) !important;
        box-shadow: 0 -15px 42px rgba(0, 0, 0, .55) !important;
        transform: translateY(calc(100% + 24px));
        transition: transform 180ms ease-out;
        visibility: hidden;
      }

      .sidebar.bfid-sidebar-open {
        transform: translateY(0);
        visibility: visible;
      }

      .sidebar > section.bfid-workspace-section {
        display: none !important;
        padding: 13px 3px 18px !important;
      }

      .sidebar > section.bfid-workspace-section.bfid-workspace-active {
        display: grid !important;
      }

      .bfid-mobile-sheet-header {
        position: sticky;
        z-index: 3;
        top: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 54px;
        margin: 0 -13px;
        padding: 8px 13px;
        border-bottom: 1px solid #385246;
        background: rgba(11, 31, 22, .99);
      }

      .bfid-mobile-sheet-header strong {
        font: 700 15px/1.2 system-ui, sans-serif;
        color: #edf4ef;
      }

      .bfid-mobile-sheet-header button {
        width: auto;
        min-height: 36px;
        padding: 4px 12px;
        border-radius: 999px;
        font-size: 12px;
      }

      .bfid-quick-toolbar {
        position: fixed;
        z-index: 9000;
        left: 0;
        right: 0;
        bottom: 0;
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 1px;
        min-height: calc(64px + env(safe-area-inset-bottom, 0px));
        padding: 5px 5px calc(5px + env(safe-area-inset-bottom, 0px));
        border-top: 1px solid #456052;
        background: rgba(7, 22, 16, .99);
        box-shadow: 0 -8px 28px rgba(0, 0, 0, .45);
      }

      .bfid-quick-toolbar button {
        display: grid;
        place-items: center;
        min-width: 0;
        min-height: 50px;
        padding: 4px 2px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #b9c9c0;
        font: 650 11px/1.1 system-ui, sans-serif;
      }

      .bfid-quick-toolbar button.bfid-toolbar-active {
        background: #28543e;
        color: #fff;
        box-shadow: inset 0 0 0 1px #6aa981;
      }

      .maplibregl-ctrl-bottom-left,
      .maplibregl-ctrl-bottom-right {
        bottom: 66px !important;
      }

      ${PANEL_SELECTOR}.bfid-portaled-panel {
        position: fixed !important;
        z-index: 11000 !important;
        top: calc(62px + env(safe-area-inset-top, 0px)) !important;
        right: 9px !important;
        bottom: calc(72px + env(safe-area-inset-bottom, 0px)) !important;
        left: 9px !important;
        width: auto !important;
        max-width: 620px !important;
        max-height: none !important;
        margin: 0 auto !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        border-radius: 13px !important;
        box-shadow: 0 18px 55px rgba(0, 0, 0, .72) !important;
      }

      body.bfid-map-sheet-open::before {
        content: '';
        position: fixed;
        z-index: 10990;
        inset: 0;
        background: rgba(0, 0, 0, .36);
        pointer-events: none;
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

      .bfid-quick-toolbar button {
        font-size: 10px;
      }
    }
  `;
  document.head.append(style);
}

function panelControl(panel: HTMLElement): HTMLElement | null {
  return panel.closest<HTMLElement>(CONTROL_SELECTOR) ?? portalRecords.get(panel)?.control ?? null;
}

function restorePanel(panel: HTMLElement): void {
  const record = portalRecords.get(panel);
  if (!record) return;
  if (record.nextSibling && record.nextSibling.parentNode === record.parent) {
    record.parent.insertBefore(panel, record.nextSibling);
  } else {
    record.parent.appendChild(panel);
  }
  panel.classList.remove('bfid-portaled-panel');
  portalRecords.delete(panel);
  portaledPanels.delete(panel);
}

function portalPanel(panel: HTMLElement, control: HTMLElement): void {
  if (!isMobileViewport() || portalRecords.has(panel)) return;
  const parent = panel.parentNode;
  if (!parent) return;
  portalRecords.set(panel, { control, parent, nextSibling: panel.nextSibling });
  portaledPanels.add(panel);
  panel.classList.add('bfid-portaled-panel');
  document.body.appendChild(panel);
}

function allPanels(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(PANEL_SELECTOR));
}

function syncPanelPortals(): void {
  for (const panel of allPanels()) {
    const control = panelControl(panel);
    if (panel.hidden || !isMobileViewport()) {
      restorePanel(panel);
    } else if (control) {
      portalPanel(panel, control);
    }
  }
  document.body.classList.toggle(
    'bfid-map-sheet-open',
    Array.from(portaledPanels).some((panel) => !panel.hidden)
  );
}

function closePanelsExcept(exception: Element | null = null): void {
  for (const panel of allPanels()) {
    const control = panelControl(panel);
    if (exception && control === exception) continue;
    panel.hidden = true;
    const button = control?.querySelector<HTMLButtonElement>(BUTTON_SELECTOR);
    button?.setAttribute('aria-expanded', 'false');
    restorePanel(panel);
  }
  syncPanelPortals();
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
        queueMicrotask(syncPanelPortals);
        return;
      }

      if (target.closest(PANEL_SELECTOR)) {
        queueMicrotask(syncPanelPortals);
        return;
      }

      closePanelsExcept();
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanelsExcept();
  });
  window.addEventListener('resize', () => queueMicrotask(syncPanelPortals));
}

function installMobileWorkspace(): void {
  if (workspaceInstalled) return;

  const setup = (): boolean => {
    const appShell = document.querySelector<HTMLElement>('.app-shell');
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    if (!appShell || !sidebar || appShell.querySelector('.bfid-quick-toolbar')) return Boolean(appShell && sidebar);

    workspaceInstalled = true;
    const sections = Array.from(sidebar.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'SECTION'
    );
    const sectionByKey = new Map<WorkspaceKey, HTMLElement>();

    for (const definition of workspaceSections) {
      const section = sections.find(
        (candidate) => candidate.querySelector('h2')?.textContent?.trim().toLowerCase() === definition.heading.toLowerCase()
      );
      if (!section) continue;
      section.classList.add('bfid-workspace-section');
      section.dataset.workspace = definition.key;
      sectionByKey.set(definition.key, section);
    }

    const header = document.createElement('div');
    header.className = 'bfid-mobile-sheet-header';
    const title = document.createElement('strong');
    title.textContent = 'Field controls';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    header.append(title, close);
    sidebar.prepend(header);

    const toolbar = document.createElement('nav');
    toolbar.className = 'bfid-quick-toolbar';
    toolbar.setAttribute('aria-label', 'Quick field controls');
    const buttons = new Map<WorkspaceKey, HTMLButtonElement>();
    let active: WorkspaceKey | null = null;

    const setWorkspace = (key: WorkspaceKey | null): void => {
      active = key;
      sidebar.classList.toggle('bfid-sidebar-open', Boolean(key));
      for (const [sectionKey, section] of sectionByKey) {
        section.classList.toggle('bfid-workspace-active', sectionKey === key);
      }
      for (const [buttonKey, button] of buttons) {
        button.classList.toggle('bfid-toolbar-active', buttonKey === key);
        button.setAttribute('aria-expanded', String(buttonKey === key));
      }
      title.textContent = workspaceSections.find((definition) => definition.key === key)?.heading ?? 'Field controls';
    };

    for (const definition of workspaceSections) {
      if (!sectionByKey.has(definition.key)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = definition.label;
      button.setAttribute('aria-controls', `bfid-workspace-${definition.key}`);
      button.setAttribute('aria-expanded', 'false');
      sectionByKey.get(definition.key)!.id = `bfid-workspace-${definition.key}`;
      button.addEventListener('click', () => setWorkspace(active === definition.key ? null : definition.key));
      toolbar.append(button);
      buttons.set(definition.key, button);
    }

    close.addEventListener('click', () => setWorkspace(null));
    appShell.append(toolbar);
    setWorkspace(null);
    return true;
  };

  if (setup()) return;
  const observer = new MutationObserver(() => {
    if (setup()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function addReliableRoadOverlay(map: MapLibreMap): void {
  if (roadInstalled.has(map)) return;
  roadInstalled.add(map);

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
    map.addLayer(
      {
        id: ROAD_LAYER_ID,
        type: 'raster',
        source: ROAD_SOURCE_ID,
        paint: {
          'raster-opacity': 1,
          'raster-fade-duration': 0
        }
      },
      map.getLayer('segments-casing') ? 'segments-casing' : undefined
    );
  }

  if (map.getLayer(LEGACY_ROAD_LAYER_ID)) map.setLayoutProperty(LEGACY_ROAD_LAYER_ID, 'visibility', 'none');
}

function namedWaterCollection(payload: unknown): WaterCollection {
  if (!payload || typeof payload !== 'object') return emptyWaterCollection();
  const record = payload as Record<string, unknown>;
  if (record.type !== 'FeatureCollection' || !Array.isArray(record.features)) return emptyWaterCollection();

  const features: WaterFeature[] = [];
  for (const candidate of record.features) {
    if (!candidate || typeof candidate !== 'object') continue;
    const feature = candidate as WaterFeature;
    if (feature.type !== 'Feature' || !feature.geometry) continue;
    if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') continue;
    const properties = feature.properties ?? {};
    const label = properties.gnis_name ?? properties.GNIS_NAME ?? properties.GNIS_Name;
    if (typeof label !== 'string' || !label.trim()) continue;
    features.push({
      ...feature,
      properties: { ...properties, __bfidWaterLabel: label.trim() }
    });
  }
  return { type: 'FeatureCollection', features };
}

function getWaterState(map: MapLibreMap): WaterState {
  const existing = waterStates.get(map);
  if (existing) return existing;
  const state: WaterState = { controller: null, timer: null };
  waterStates.set(map, state);
  return state;
}

async function loadNamedWaterLabels(map: MapLibreMap): Promise<void> {
  const state = getWaterState(map);
  const source = map.getSource(WATER_LABEL_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;

  if (map.getZoom() < 9.5) {
    source.setData(emptyWaterCollection());
    return;
  }

  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const bounds = map.getBounds();
  const query = new URL(WATER_QUERY_URL);
  query.searchParams.set('where', "gnis_name IS NOT NULL AND gnis_name <> ''");
  query.searchParams.set('geometry', `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`);
  query.searchParams.set('geometryType', 'esriGeometryEnvelope');
  query.searchParams.set('inSR', '4326');
  query.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  query.searchParams.set('outFields', 'gnis_name,permanent_identifier');
  query.searchParams.set('returnGeometry', 'true');
  query.searchParams.set('outSR', '4326');
  query.searchParams.set('resultRecordCount', '2000');
  query.searchParams.set('f', 'geojson');

  try {
    const response = await fetch(query, { signal: controller.signal });
    if (!response.ok) throw new Error(`USGS named-water query returned ${response.status}`);
    source.setData(namedWaterCollection(await response.json()));
  } catch (error) {
    if (!controller.signal.aborted) console.warn('Could not load named water labels', error);
  } finally {
    if (state.controller === controller) state.controller = null;
  }
}

function scheduleWaterLabels(map: MapLibreMap, immediate = false): void {
  const state = getWaterState(map);
  if (state.timer !== null) window.clearTimeout(state.timer);
  state.timer = window.setTimeout(
    () => {
      state.timer = null;
      void loadNamedWaterLabels(map);
    },
    immediate ? 0 : 450
  );
}

function addOperationalLabels(map: MapLibreMap): void {
  const commonLineLayout = {
    'symbol-placement': 'line' as const,
    'text-font': ['Open Sans Regular'],
    'text-max-angle': 40,
    'text-rotation-alignment': 'map' as const,
    'text-pitch-alignment': 'viewport' as const,
    'text-allow-overlap': false,
    'text-ignore-placement': false
  };

  if (map.getSource('segments') && !map.getLayer(SEGMENT_LABEL_LAYER_ID)) {
    map.addLayer({
      id: SEGMENT_LABEL_LAYER_ID,
      type: 'symbol',
      source: 'segments',
      minzoom: 10,
      layout: {
        ...commonLineLayout,
        'symbol-spacing': 260,
        'text-field': ['get', 'name'],
        'text-size': 12
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
      minzoom: 12.5,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Regular'],
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
      minzoom: 10,
      layout: {
        ...commonLineLayout,
        'symbol-spacing': 330,
        'text-field': [
          'coalesce',
          ['get', 'gnis_name'],
          ['get', 'GNIS_NAME'],
          ['get', 'GNIS_Name'],
          ''
        ],
        'text-size': 11
      },
      paint: {
        'text-color': '#bceeff',
        'text-halo-color': '#061417',
        'text-halo-width': 2,
        'text-halo-blur': 0.4
      }
    });
  }

  if (map.getSource(RECON_SOURCE_ID) && !map.getLayer(RECON_FALLBACK_LABEL_LAYER_ID)) {
    map.addLayer({
      id: RECON_FALLBACK_LABEL_LAYER_ID,
      type: 'symbol',
      source: RECON_SOURCE_ID,
      minzoom: 12,
      filter: [
        'all',
        ['!', ['has', 'gnis_name']],
        ['!', ['has', 'GNIS_NAME']],
        ['!', ['has', 'GNIS_Name']]
      ],
      layout: {
        ...commonLineLayout,
        'symbol-spacing': 520,
        'text-field': 'Canal / ditch',
        'text-size': 9
      },
      paint: {
        'text-color': '#8ed8e8',
        'text-halo-color': '#061417',
        'text-halo-width': 1.5,
        'text-opacity': 0.78
      }
    });
  }

  if (!map.getSource(WATER_LABEL_SOURCE_ID)) {
    map.addSource(WATER_LABEL_SOURCE_ID, { type: 'geojson', data: emptyWaterCollection() });
  }
  if (!map.getLayer(WATER_LABEL_LAYER_ID)) {
    map.addLayer({
      id: WATER_LABEL_LAYER_ID,
      type: 'symbol',
      source: WATER_LABEL_SOURCE_ID,
      minzoom: 9.5,
      layout: {
        ...commonLineLayout,
        'symbol-spacing': 420,
        'text-field': ['get', '__bfidWaterLabel'],
        'text-size': 11
      },
      paint: {
        'text-color': '#c7edff',
        'text-halo-color': '#07120d',
        'text-halo-width': 2,
        'text-halo-blur': 0.35
      }
    });
    map.on('moveend', () => scheduleWaterLabels(map));
    scheduleWaterLabels(map, true);
  }

  for (const id of [
    SEGMENT_LABEL_LAYER_ID,
    STRUCTURE_LABEL_LAYER_ID,
    RECON_LABEL_LAYER_ID,
    RECON_FALLBACK_LABEL_LAYER_ID,
    WATER_LABEL_LAYER_ID
  ]) {
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
    installMobileWorkspace();
  }

  const prototype = MapLibreMap.prototype as any;
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_FLAG)) return;
  prototype[PATCH_FLAG] = true;

  const originalSetStyle = prototype.setStyle as (...args: any[]) => MapLibreMap;
  prototype.setStyle = function patchedSetStyle(this: MapLibreMap, style: unknown, ...rest: any[]): MapLibreMap {
    const normalizedStyle =
      style && typeof style === 'object' && !Array.isArray(style) && !('glyphs' in (style as Record<string, unknown>))
        ? { ...(style as Record<string, unknown>), glyphs: GLYPH_URL }
        : style;
    return originalSetStyle.call(this, normalizedStyle, ...rest);
  };

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

    if (layerId.startsWith('segments-') && layerId !== SEGMENT_LABEL_LAYER_ID) mirror(SEGMENT_LABEL_LAYER_ID);
    if (layerId === 'structures-circle') mirror(STRUCTURE_LABEL_LAYER_ID);
    if (layerId === RECON_LINE_LAYER_ID) {
      mirror(RECON_LABEL_LAYER_ID);
      mirror(RECON_FALLBACK_LABEL_LAYER_ID);
    }
    if (layerId === LEGACY_ROAD_LAYER_ID) {
      mirror(ROAD_LAYER_ID);
      if (this.getLayer(LEGACY_ROAD_LAYER_ID)) {
        originalSetLayoutProperty.call(this, LEGACY_ROAD_LAYER_ID, propertyName, 'none', ...rest);
      }
    }
    if (layerId === LEGACY_WATER_LAYER_ID) mirror(WATER_LABEL_LAYER_ID);
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
