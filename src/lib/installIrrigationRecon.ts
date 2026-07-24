import { Map as MapLibreMap, type GeoJSONSource, type IControl } from 'maplibre-gl';
import type { Feature, FeatureCollection, GeoJsonProperties, LineString, MultiLineString } from 'geojson';
import { db } from './db';
import type { ProjectSegment, Ride, TravelStatus } from './types';

const PATCH_FLAG = '__bfidIrrigationReconPatchInstalled';
const MAP_FLAG = '__bfidIrrigationReconInitialized';
const STORAGE_KEY = 'bfid-usgs-irrigation-reference-visible';
const STYLE_ID = 'bfid-irrigation-recon-styles';
const SOURCE_ID = 'usgs-irrigation-reference';
const CASING_LAYER_ID = 'usgs-irrigation-reference-casing';
const LINE_LAYER_ID = 'usgs-irrigation-reference-line';
const SELECTED_LAYER_ID = 'usgs-irrigation-reference-selected';
const MIN_REFERENCE_ZOOM = 9.5;
const NHD_QUERY_URL = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query';
const NEW_RIDE_VALUE = '__new__';

type Coordinate = [number, number];
type ReconGeometry = LineString | MultiLineString;
type ReconFeature = Feature<ReconGeometry, GeoJsonProperties>;
type ReconCollection = FeatureCollection<ReconGeometry, GeoJsonProperties>;
type LineFeatureType = ProjectSegment['featureType'];
type LineSide = ProjectSegment['side'];

type ProjectStats = {
  segments: number;
  structures: number;
  unmowed: number;
  accessProblems: number;
};

type ReconState = {
  enabled: boolean;
  loading: boolean;
  status: string;
  collection: ReconCollection;
  featureByKey: Map<string, ReconFeature>;
  selectedKey: string | null;
  selected: ReconFeature | null;
  requestController: AbortController | null;
  requestTimer: number | null;
  projectStats: ProjectStats;
  control: IrrigationReconControl | null;
};

const stateByMap = new WeakMap<MapLibreMap, ReconState>();

function emptyCollection(): ReconCollection {
  return { type: 'FeatureCollection', features: [] };
}

function loadEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // The layer remains usable for the current session.
  }
}

function getState(map: MapLibreMap): ReconState {
  const existing = stateByMap.get(map);
  if (existing) return existing;

  const state: ReconState = {
    enabled: loadEnabled(),
    loading: false,
    status: 'Waiting for map load…',
    collection: emptyCollection(),
    featureByKey: new Map(),
    selectedKey: null,
    selected: null,
    requestController: null,
    requestTimer: null,
    projectStats: { segments: 0, structures: 0, unmowed: 0, accessProblems: 0 },
    control: null
  };
  stateByMap.set(map, state);
  return state;
}

function asString(properties: GeoJsonProperties, keys: string[]): string | undefined {
  if (!properties) return undefined;
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function coordinate(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return [longitude, latitude];
}

function lineParts(geometry: ReconGeometry): Coordinate[][] {
  if (geometry.type === 'LineString') {
    const line = geometry.coordinates.map(coordinate).filter((value): value is Coordinate => Boolean(value));
    return line.length >= 2 ? [line] : [];
  }

  return geometry.coordinates
    .map((part) => part.map(coordinate).filter((value): value is Coordinate => Boolean(value)))
    .filter((part) => part.length >= 2);
}

function distanceMeters(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const lat1 = a[1] * radians;
  const lat2 = b[1] * radians;
  const deltaLat = (b[1] - a[1]) * radians;
  const deltaLon = (b[0] - a[0]) * radians;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function featureLengthMiles(feature: ReconFeature): number {
  let meters = 0;
  for (const part of lineParts(feature.geometry)) {
    for (let index = 1; index < part.length; index += 1) meters += distanceMeters(part[index - 1], part[index]);
  }
  return meters / 1609.344;
}

function collectionLengthMiles(collection: ReconCollection): number {
  return collection.features.reduce((sum, feature) => sum + featureLengthMiles(feature), 0);
}

function featureName(feature: ReconFeature): string {
  return (
    asString(feature.properties, ['GNIS_NAME', 'GNIS_Name', 'gnis_name', 'GNISName', 'name', 'Name']) ??
    'Unnamed canal or ditch'
  );
}

function reachCode(feature: ReconFeature): string | undefined {
  return asString(feature.properties, ['REACHCODE', 'ReachCode', 'reachcode', 'Reach_Code']);
}

function permanentIdentifier(feature: ReconFeature): string | undefined {
  return asString(feature.properties, [
    'PERMANENT_IDENTIFIER',
    'Permanent_Identifier',
    'permanent_identifier',
    'NHDPLUSID',
    'NHDPlusID',
    'nhdplusid'
  ]);
}

function featureKey(feature: ReconFeature, index: number): string {
  return permanentIdentifier(feature) ?? reachCode(feature) ?? `view-feature-${index}`;
}

function setSelected(map: MapLibreMap, state: ReconState, key: string | null): void {
  state.selectedKey = key;
  state.selected = key ? state.featureByKey.get(key) ?? null : null;
  for (const feature of state.collection.features) {
    if (!feature.properties) feature.properties = {};
    feature.properties.__bfidSelected = feature.properties.__bfidKey === key;
  }
  (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(state.collection);
  state.control?.update();
}

function setReferenceVisibility(map: MapLibreMap, state: ReconState): void {
  const visibility = state.enabled ? 'visible' : 'none';
  for (const id of [CASING_LAYER_ID, LINE_LAYER_ID, SELECTED_LAYER_ID]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
  }
}

async function refreshProjectStats(state: ReconState): Promise<void> {
  const [segments, structures, unmowed, accessProblems] = await Promise.all([
    db.segments.count(),
    db.structures.count(),
    db.segments.where('mowStatus').equals('unmowed').count(),
    db.segments.filter((segment) => segment.travelStatus === 'blocked' || segment.travelStatus === 'seasonal').count()
  ]);
  state.projectStats = { segments, structures, unmowed, accessProblems };
  state.control?.update();
}

function normalizedFeatureCollection(payload: unknown): ReconCollection {
  if (!payload || typeof payload !== 'object') throw new Error('USGS returned an empty response.');
  const record = payload as Record<string, unknown>;
  if (record.error && typeof record.error === 'object') {
    const message = (record.error as Record<string, unknown>).message;
    throw new Error(typeof message === 'string' ? message : 'USGS query failed.');
  }
  if (record.type !== 'FeatureCollection' || !Array.isArray(record.features)) {
    throw new Error('USGS response was not GeoJSON.');
  }

  const features: ReconFeature[] = [];
  for (const candidate of record.features) {
    if (!candidate || typeof candidate !== 'object') continue;
    const feature = candidate as ReconFeature;
    if (feature.type !== 'Feature' || !feature.geometry) continue;
    if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') continue;
    if (!lineParts(feature.geometry).length) continue;
    features.push(feature);
  }
  return { type: 'FeatureCollection', features };
}

async function loadReferenceView(map: MapLibreMap, state: ReconState): Promise<void> {
  if (!state.enabled) {
    state.status = 'USGS irrigation reference is hidden.';
    state.control?.update();
    return;
  }

  if (map.getZoom() < MIN_REFERENCE_ZOOM) {
    state.requestController?.abort();
    state.collection = emptyCollection();
    state.featureByKey.clear();
    state.selected = null;
    state.selectedKey = null;
    (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(state.collection);
    state.status = 'Zoom in farther to load high-resolution canal and ditch references.';
    state.control?.update();
    return;
  }

  state.requestController?.abort();
  const controller = new AbortController();
  state.requestController = controller;
  state.loading = true;
  state.status = 'Loading USGS canal and ditch lines for this view…';
  state.control?.update();

  const bounds = map.getBounds();
  const query = new URL(NHD_QUERY_URL);
  query.searchParams.set('where', 'FTYPE = 336');
  query.searchParams.set('geometry', `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`);
  query.searchParams.set('geometryType', 'esriGeometryEnvelope');
  query.searchParams.set('inSR', '4326');
  query.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  query.searchParams.set(
    'outFields',
    'GNIS_NAME,GNIS_Name,REACHCODE,ReachCode,FCODE,FCode,FTYPE,FType,NHDPLUSID,NHDPlusID,PERMANENT_IDENTIFIER,Permanent_Identifier'
  );
  query.searchParams.set('returnGeometry', 'true');
  query.searchParams.set('outSR', '4326');
  query.searchParams.set('resultRecordCount', '2000');
  query.searchParams.set('f', 'geojson');

  try {
    const response = await fetch(query, { signal: controller.signal });
    if (!response.ok) throw new Error(`USGS service returned HTTP ${response.status}.`);
    const collection = normalizedFeatureCollection(await response.json());
    const featureByKey = new Map<string, ReconFeature>();
    collection.features.forEach((feature, index) => {
      const key = featureKey(feature, index);
      feature.id = key;
      feature.properties = { ...(feature.properties ?? {}), __bfidKey: key, __bfidSelected: false };
      featureByKey.set(key, feature);
    });

    state.collection = collection;
    state.featureByKey = featureByKey;
    state.selected = null;
    state.selectedKey = null;
    (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(collection);
    const miles = collectionLengthMiles(collection);
    state.status = `${collection.features.length.toLocaleString()} USGS canal/ditch lines · ${miles.toFixed(1)} reference miles in view.`;
  } catch (error) {
    if (controller.signal.aborted) return;
    state.collection = emptyCollection();
    state.featureByKey.clear();
    (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(state.collection);
    state.status = error instanceof Error ? `Reference load failed: ${error.message}` : 'Reference load failed.';
  } finally {
    if (state.requestController === controller) state.requestController = null;
    state.loading = false;
    state.control?.update();
  }
}

function scheduleReferenceLoad(map: MapLibreMap, state: ReconState, immediate = false): void {
  if (state.requestTimer !== null) window.clearTimeout(state.requestTimer);
  state.requestTimer = window.setTimeout(
    () => {
      state.requestTimer = null;
      void loadReferenceView(map, state);
    },
    immediate ? 0 : 450
  );
}

function addReferenceLayers(map: MapLibreMap, state: ReconState): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: state.collection });
  }

  const beforeId = map.getLayer('segments-casing') ? 'segments-casing' : undefined;
  if (!map.getLayer(CASING_LAYER_ID)) {
    map.addLayer(
      {
        id: CASING_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#061417', 'line-width': 6, 'line-opacity': 0.72 }
      },
      beforeId
    );
  }
  if (!map.getLayer(LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#43d4ef', 'line-width': 3, 'line-opacity': 0.82 }
      },
      beforeId
    );
  }
  if (!map.getLayer(SELECTED_LAYER_ID)) {
    map.addLayer(
      {
        id: SELECTED_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', '__bfidSelected'], true],
        paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 }
      },
      beforeId
    );
  }

  setReferenceVisibility(map, state);
  map.on('click', LINE_LAYER_ID, (event) => {
    const key = event.features?.[0]?.properties?.__bfidKey;
    if (typeof key === 'string') setSelected(map, state, key);
  });
  map.on('mouseenter', LINE_LAYER_ID, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', LINE_LAYER_ID, () => {
    map.getCanvas().style.cursor = '';
  });
  map.on('moveend', () => scheduleReferenceLoad(map, state));
  scheduleReferenceLoad(map, state, true);
}

async function resolveRide(rideId: string, newRideName: string): Promise<Ride | undefined> {
  const requestedName = newRideName.trim();
  if (requestedName) {
    const existing = await db.rides.filter((ride) => ride.name.toLowerCase() === requestedName.toLowerCase()).first();
    if (existing) return existing;
    const now = new Date().toISOString();
    const ride: Ride = { id: crypto.randomUUID(), name: requestedName, createdAt: now, updatedAt: now };
    await db.rides.add(ride);
    return ride;
  }
  if (!rideId || rideId === NEW_RIDE_VALUE) return undefined;
  return db.rides.get(rideId);
}

async function promoteSelectedFeature(
  state: ReconState,
  featureType: LineFeatureType,
  side: LineSide,
  travelStatus: TravelStatus,
  rideId: string,
  newRideName: string
): Promise<number> {
  const selected = state.selected;
  if (!selected) throw new Error('Select a blue USGS reference line first.');

  const parts = lineParts(selected.geometry);
  if (!parts.length) throw new Error('The selected reference has no usable line geometry.');
  const ride = await resolveRide(rideId, newRideName);
  const sourceIdentifier = permanentIdentifier(selected) ?? reachCode(selected) ?? String(selected.id ?? crypto.randomUUID());
  const sourcePrefix = `NHD-${sourceIdentifier}`;
  const duplicateCount = await db.segments.filter(
    (segment) => segment.systemId === sourcePrefix || segment.systemId.startsWith(`${sourcePrefix}:`)
  ).count();
  if (duplicateCount) throw new Error('This USGS reference line has already been promoted into the local project.');

  const name = featureName(selected);
  const reach = reachCode(selected);
  const now = new Date().toISOString();
  const segments: ProjectSegment[] = parts.map((part, index) => {
    const id = `nhd-${crypto.randomUUID()}`;
    const suffix = parts.length > 1 ? ` part ${index + 1}` : '';
    return {
      id,
      name: `${name}${suffix}`,
      systemId: parts.length > 1 ? `${sourcePrefix}:${index + 1}` : sourcePrefix,
      featureType,
      fromNodeId: `${id}-start`,
      toNodeId: `${id}-end`,
      side,
      travelStatus,
      verifiedEquipment: [],
      mowStatus: 'unmowed',
      lastVerifiedAt: travelStatus === 'verified' ? now : undefined,
      notes: [
        'Promoted from the USGS National Hydrography Dataset canal/ditch reference.',
        reach ? `ReachCode ${reach}.` : '',
        'Public-reference geometry: verify against BFID records and field conditions before operational use.'
      ]
        .filter(Boolean)
        .join(' '),
      geometry: { type: 'LineString', coordinates: part },
      rideId: ride?.id,
      captureMethod: 'imported'
    };
  });

  await db.segments.bulkAdd(segments);
  return segments.length;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .bfid-recon-control { position: relative; overflow: visible !important; }
    .bfid-recon-button { width: auto !important; min-width: 68px; padding: 0 10px !important; color: #152019; font: 700 13px/29px system-ui,sans-serif; }
    .bfid-recon-panel { position: absolute; top: 0; right: calc(100% + 7px); width: min(350px, calc(100vw - 92px)); max-height: calc(100vh - 70px); overflow-y: auto; display: grid; gap: 10px; padding: 13px; border: 1px solid #557565; border-radius: 9px; background: rgba(7,22,16,.98); color: #edf4ef; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
    .bfid-recon-panel[hidden] { display: none; }
    .bfid-recon-panel h3,.bfid-recon-panel h4 { margin: 0; font-family: system-ui,sans-serif; }
    .bfid-recon-panel h3 { font-size: 16px; }
    .bfid-recon-panel h4 { font-size: 13px; color: #d8e7dd; }
    .bfid-recon-source,.bfid-recon-note,.bfid-recon-status { color: #a9bbb0; font: 11px/1.4 system-ui,sans-serif; }
    .bfid-recon-status { min-height: 30px; color: #c6d8cd; }
    .bfid-recon-toggle { display: grid; grid-template-columns: 21px 1fr; gap: 8px; align-items: center; color: #e8f1eb; font: 600 12px system-ui,sans-serif; }
    .bfid-recon-toggle input { width: 18px; height: 18px; min-height: 0; accent-color: #43d4ef; }
    .bfid-recon-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .bfid-recon-metric { display: grid; gap: 2px; padding: 8px; border: 1px solid #365346; border-radius: 6px; background: #10261d; }
    .bfid-recon-metric strong { color: #fff; font: 700 17px/1 system-ui,sans-serif; }
    .bfid-recon-metric span { color: #a9bbb0; font: 10px/1.25 system-ui,sans-serif; }
    .bfid-recon-selected { display: grid; gap: 4px; padding: 9px; border: 1px solid #2e7180; border-radius: 7px; background: #0c2b31; }
    .bfid-recon-selected strong { font: 700 13px/1.3 system-ui,sans-serif; }
    .bfid-recon-selected span { color: #b9dce2; font: 11px/1.35 system-ui,sans-serif; }
    .bfid-recon-form { display: grid; gap: 7px; }
    .bfid-recon-form label { display: grid; gap: 3px; color: #bdcec4; font: 11px/1.3 system-ui,sans-serif; }
    .bfid-recon-form select,.bfid-recon-form input { width: 100%; min-height: 35px; padding: 5px 7px; border: 1px solid #456454; border-radius: 6px; background: #172b21; color: #edf4ef; }
    .bfid-recon-actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .bfid-recon-actions button { min-height: 38px; border: 1px solid #456454; border-radius: 6px; background: #24758a; color: #fff; font: 700 12px system-ui,sans-serif; }
    .bfid-recon-actions button.secondary { background: #172b21; }
    .bfid-recon-actions button:disabled { opacity: .55; }
  `;
  document.head.append(style);
}

function optionSelect<T extends string>(values: T[], selected: T): HTMLSelectElement {
  const select = document.createElement('select');
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value.replaceAll('-', ' ');
    option.selected = value === selected;
    select.append(option);
  }
  return select;
}

function field(labelText: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.append(labelText, control);
  return label;
}

class IrrigationReconControl implements IControl {
  private map: MapLibreMap;
  private state: ReconState;
  private container: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private toggle: HTMLInputElement | null = null;
  private status: HTMLDivElement | null = null;
  private selectedBox: HTMLDivElement | null = null;
  private statsGrid: HTMLDivElement | null = null;
  private rideSelect: HTMLSelectElement | null = null;
  private newRideName: HTMLInputElement | null = null;
  private featureType = optionSelect<LineFeatureType>(['canal', 'lateral', 'pipeline', 'drain', 'access-road'], 'canal');
  private side = optionSelect<LineSide>(['left', 'right', 'center', 'buried'], 'center');
  private travelStatus = optionSelect<TravelStatus>(
    ['unknown', 'visually-likely', 'verified', 'blocked', 'seasonal', 'foot-only'],
    'visually-likely'
  );
  private promoteButton: HTMLButtonElement | null = null;

  constructor(map: MapLibreMap, state: ReconState) {
    this.map = map;
    this.state = state;
  }

  private async populateRides(): Promise<void> {
    if (!this.rideSelect) return;
    const rides = await db.rides.orderBy('name').toArray();
    this.rideSelect.replaceChildren();
    const unassigned = document.createElement('option');
    unassigned.value = '';
    unassigned.textContent = 'Unassigned';
    this.rideSelect.append(unassigned);
    for (const ride of rides) {
      const option = document.createElement('option');
      option.value = ride.id;
      option.textContent = ride.name;
      this.rideSelect.append(option);
    }
    const createNew = document.createElement('option');
    createNew.value = NEW_RIDE_VALUE;
    createNew.textContent = 'Create new Ride below';
    this.rideSelect.append(createNew);
  }

  onAdd(): HTMLElement {
    ensureStyles();
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group bfid-recon-control';
    this.container = container;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bfid-recon-button';
    button.textContent = 'Recon';
    button.title = 'USGS irrigation reconnaissance and project promotion';
    button.setAttribute('aria-expanded', 'false');
    this.button = button;

    const panel = document.createElement('div');
    panel.className = 'bfid-recon-panel';
    panel.hidden = true;
    this.panel = panel;

    const heading = document.createElement('h3');
    heading.textContent = 'Irrigation reconnaissance';
    const source = document.createElement('div');
    source.className = 'bfid-recon-source';
    source.textContent = 'Live USGS high-resolution NHD Canal/Ditch reference. Blue lines are public reconnaissance data, not BFID-verified records.';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = this.state.enabled;
    this.toggle = toggle;
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'bfid-recon-toggle';
    toggleLabel.append(toggle, 'Show live canal/ditch reference');

    const status = document.createElement('div');
    status.className = 'bfid-recon-status';
    this.status = status;

    const scaleHeading = document.createElement('h4');
    scaleHeading.textContent = 'Belle Fourche Project scale';
    const scaleGrid = document.createElement('div');
    scaleGrid.className = 'bfid-recon-grid';
    for (const [value, label] of [
      ['57,068', 'irrigated acres'],
      ['94 mi', 'main canals'],
      ['450 mi', 'laterals'],
      ['232 mi', 'drains']
    ]) {
      const metric = document.createElement('div');
      metric.className = 'bfid-recon-metric';
      const strong = document.createElement('strong');
      strong.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      metric.append(strong, span);
      scaleGrid.append(metric);
    }

    const projectHeading = document.createElement('h4');
    projectHeading.textContent = 'Local project database';
    const statsGrid = document.createElement('div');
    statsGrid.className = 'bfid-recon-grid';
    this.statsGrid = statsGrid;

    const selectedHeading = document.createElement('h4');
    selectedHeading.textContent = 'Selected reference';
    const selectedBox = document.createElement('div');
    selectedBox.className = 'bfid-recon-selected';
    this.selectedBox = selectedBox;

    const rideSelect = document.createElement('select');
    this.rideSelect = rideSelect;
    const newRideName = document.createElement('input');
    newRideName.placeholder = 'Optional new Ride name';
    this.newRideName = newRideName;
    void this.populateRides();

    const form = document.createElement('div');
    form.className = 'bfid-recon-form';
    const formGrid = document.createElement('div');
    formGrid.className = 'bfid-recon-grid';
    formGrid.append(
      field('Promote as', this.featureType),
      field('Bank / side', this.side),
      field('Initial travel state', this.travelStatus),
      field('Assign to Ride', rideSelect)
    );
    form.append(formGrid, field('New Ride name', newRideName));

    const promoteButton = document.createElement('button');
    promoteButton.type = 'button';
    promoteButton.textContent = 'Promote into BFID project';
    this.promoteButton = promoteButton;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'secondary';
    closeButton.textContent = 'Close';
    const actions = document.createElement('div');
    actions.className = 'bfid-recon-actions';
    actions.append(promoteButton, closeButton);

    const note = document.createElement('div');
    note.className = 'bfid-recon-note';
    note.textContent = 'Promotion copies the selected geometry into the local editable project as unmowed. The source ReachCode is retained, and the line remains marked for BFID and field verification.';

    toggle.addEventListener('change', () => {
      this.state.enabled = toggle.checked;
      saveEnabled(this.state.enabled);
      setReferenceVisibility(this.map, this.state);
      if (this.state.enabled) scheduleReferenceLoad(this.map, this.state, true);
      else {
        this.state.status = 'USGS irrigation reference is hidden.';
        this.update();
      }
    });

    promoteButton.addEventListener('click', async () => {
      promoteButton.disabled = true;
      const previousText = promoteButton.textContent;
      promoteButton.textContent = 'Saving…';
      try {
        const count = await promoteSelectedFeature(
          this.state,
          this.featureType.value as LineFeatureType,
          this.side.value as LineSide,
          this.travelStatus.value as TravelStatus,
          this.rideSelect?.value ?? '',
          this.newRideName?.value ?? ''
        );
        this.state.status = `Promoted ${count} permanent project segment${count === 1 ? '' : 's'}. Reloading…`;
        this.update();
        window.setTimeout(() => location.reload(), 800);
      } catch (error) {
        this.state.status = error instanceof Error ? error.message : 'Feature promotion failed.';
        promoteButton.disabled = false;
        promoteButton.textContent = previousText;
        this.update();
      }
    });

    closeButton.addEventListener('click', () => {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    });
    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) {
        void refreshProjectStats(this.state);
        void this.populateRides();
      }
    });

    for (const eventName of ['click', 'dblclick', 'mousedown', 'touchstart', 'wheel']) {
      container.addEventListener(eventName, (event) => event.stopPropagation());
    }

    panel.append(
      heading,
      source,
      toggleLabel,
      status,
      scaleHeading,
      scaleGrid,
      projectHeading,
      statsGrid,
      selectedHeading,
      selectedBox,
      form,
      actions,
      note
    );
    container.append(button, panel);
    this.update();
    void refreshProjectStats(this.state);
    return container;
  }

  update(): void {
    if (this.toggle) this.toggle.checked = this.state.enabled;
    if (this.status) this.status.textContent = this.state.status;
    if (this.promoteButton) this.promoteButton.disabled = !this.state.selected || this.state.loading;

    if (this.statsGrid) {
      this.statsGrid.replaceChildren();
      for (const [value, label] of [
        [String(this.state.projectStats.segments), 'mapped project lines'],
        [String(this.state.projectStats.structures), 'structures / points'],
        [String(this.state.projectStats.unmowed), 'unmowed lines'],
        [String(this.state.projectStats.accessProblems), 'blocked / seasonal']
      ]) {
        const metric = document.createElement('div');
        metric.className = 'bfid-recon-metric';
        const strong = document.createElement('strong');
        strong.textContent = value;
        const span = document.createElement('span');
        span.textContent = label;
        metric.append(strong, span);
        this.statsGrid.append(metric);
      }
    }

    if (this.selectedBox) {
      this.selectedBox.replaceChildren();
      if (!this.state.selected) {
        const strong = document.createElement('strong');
        strong.textContent = 'No line selected';
        const span = document.createElement('span');
        span.textContent = 'Click a blue canal or ditch reference on the map.';
        this.selectedBox.append(strong, span);
      } else {
        const strong = document.createElement('strong');
        strong.textContent = featureName(this.state.selected);
        const span = document.createElement('span');
        const reach = reachCode(this.state.selected);
        span.textContent = `${featureLengthMiles(this.state.selected).toFixed(2)} mi${reach ? ` · ReachCode ${reach}` : ''}`;
        this.selectedBox.append(strong, span);
      }
    }
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
    this.panel = null;
    this.button = null;
    this.toggle = null;
    this.status = null;
    this.selectedBox = null;
    this.statsGrid = null;
    this.rideSelect = null;
    this.newRideName = null;
    this.promoteButton = null;
  }
}

export function installIrrigationReconPatch(): void {
  const prototype = MapLibreMap.prototype as any;
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_FLAG)) return;
  prototype[PATCH_FLAG] = true;

  const originalAddControl = prototype.addControl as (...args: any[]) => MapLibreMap;
  prototype.addControl = function patchedAddControl(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const mapWithFlag = this as any;
    const firstControl = !Object.prototype.hasOwnProperty.call(mapWithFlag, MAP_FLAG);
    if (firstControl) {
      mapWithFlag[MAP_FLAG] = true;
      const state = getState(this);
      this.once('load', () => {
        window.setTimeout(() => addReferenceLayers(this, state), 0);
      });
    }

    const result = originalAddControl.apply(this, args);
    if (firstControl) {
      const state = getState(this);
      const control = new IrrigationReconControl(this, state);
      state.control = control;
      originalAddControl.call(this, control, 'top-right');
    }
    return result;
  };
}
