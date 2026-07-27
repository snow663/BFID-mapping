import { Map as MapLibreMap, type IControl } from 'maplibre-gl';
import { db } from './db';
import type {
  MowStatus,
  ProjectSegment,
  Ride,
  StructurePoint,
  TravelStatus
} from './types';

const PATCH_FLAG = '__bfidProjectImportPatchInstalled';
const MAP_FLAG = '__bfidProjectImportControlAdded';
const STYLE_ID = 'bfid-project-import-styles';
const NEW_RIDE_VALUE = '__new__';

type LineFeatureType = ProjectSegment['featureType'];
type LineSide = ProjectSegment['side'];
type StructureType = StructurePoint['structureType'];
type Coordinate = [number, number];

type ImportDefaults = {
  featureType: LineFeatureType;
  side: LineSide;
  structureType: StructureType;
  travelStatus: TravelStatus;
  mowStatus: MowStatus;
  rideId?: string;
};

type RawLine = { coordinates: Coordinate[]; properties: Record<string, unknown> };
type RawPoint = { coordinate: Coordinate; properties: Record<string, unknown> };
type ParsedProject = { lines: RawLine[]; points: RawPoint[]; ignored: number };
type SavedProject = { segments: number; structures: number; ignored: number; rideName?: string };

const lineFeatureTypes: LineFeatureType[] = ['canal', 'lateral', 'pipeline', 'drain', 'access-road'];
const lineSides: LineSide[] = ['left', 'right', 'center', 'buried'];
const structureTypes: StructureType[] = ['box', 'check', 'gate', 'bridge', 'crossing', 'drop-in'];
const travelStatuses: TravelStatus[] = ['unknown', 'visually-likely', 'verified', 'blocked', 'seasonal', 'foot-only'];
const mowStatuses: MowStatus[] = ['unmowed', 'partial', 'mowed', 'needs-return', 'skipped'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstString(properties: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s_]+/g, '-') : '';
}

function normalizeFeatureType(value: unknown, fallback: LineFeatureType): LineFeatureType {
  const token = normalizeToken(value);
  if (lineFeatureTypes.includes(token as LineFeatureType)) return token as LineFeatureType;
  if (['road', 'access', 'accessroad', 'bank-road', 'trail'].includes(token)) return 'access-road';
  if (['ditch', 'wasteway'].includes(token)) return 'drain';
  return fallback;
}

function normalizeSide(value: unknown, fallback: LineSide): LineSide {
  const token = normalizeToken(value);
  if (lineSides.includes(token as LineSide)) return token as LineSide;
  if (token === 'l' || token === 'left-bank') return 'left';
  if (token === 'r' || token === 'right-bank') return 'right';
  if (token === 'centre' || token === 'road-centerline') return 'center';
  if (token === 'underground') return 'buried';
  return fallback;
}

function normalizeStructureType(value: unknown, fallback: StructureType): StructureType {
  const token = normalizeToken(value);
  if (structureTypes.includes(token as StructureType)) return token as StructureType;
  if (token === 'weir-box' || token === 'turnout-box') return 'box';
  if (token === 'dropin' || token === 'access-point') return 'drop-in';
  return fallback;
}

function normalizeTravelStatus(value: unknown, fallback: TravelStatus): TravelStatus {
  const token = normalizeToken(value);
  return travelStatuses.includes(token as TravelStatus) ? (token as TravelStatus) : fallback;
}

function normalizeMowStatus(value: unknown, fallback: MowStatus): MowStatus {
  const token = normalizeToken(value);
  return mowStatuses.includes(token as MowStatus) ? (token as MowStatus) : fallback;
}

function validCoordinate(value: unknown): value is Coordinate {
  if (!Array.isArray(value) || value.length < 2) return false;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

function cleanLine(value: unknown): Coordinate[] {
  if (!Array.isArray(value)) return [];
  const result: Coordinate[] = [];
  for (const item of value) {
    if (!validCoordinate(item)) continue;
    const coordinate: Coordinate = [Number(item[0]), Number(item[1])];
    const previous = result.at(-1);
    if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) result.push(coordinate);
  }
  return result.length >= 2 ? result : [];
}

function addGeoJsonGeometry(
  geometry: Record<string, unknown>,
  properties: Record<string, unknown>,
  output: ParsedProject
): void {
  const type = String(geometry.type ?? '');
  const coordinates = geometry.coordinates;

  if (type === 'LineString') {
    const line = cleanLine(coordinates);
    if (line.length) output.lines.push({ coordinates: line, properties });
    else output.ignored += 1;
    return;
  }

  if (type === 'MultiLineString' && Array.isArray(coordinates)) {
    for (const candidate of coordinates) {
      const line = cleanLine(candidate);
      if (line.length) output.lines.push({ coordinates: line, properties });
      else output.ignored += 1;
    }
    return;
  }

  if (type === 'Point') {
    if (validCoordinate(coordinates)) output.points.push({ coordinate: [Number(coordinates[0]), Number(coordinates[1])], properties });
    else output.ignored += 1;
    return;
  }

  if (type === 'MultiPoint' && Array.isArray(coordinates)) {
    for (const candidate of coordinates) {
      if (validCoordinate(candidate)) output.points.push({ coordinate: [Number(candidate[0]), Number(candidate[1])], properties });
      else output.ignored += 1;
    }
    return;
  }

  if (type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
    for (const child of geometry.geometries) {
      if (isRecord(child)) addGeoJsonGeometry(child, properties, output);
      else output.ignored += 1;
    }
    return;
  }

  output.ignored += 1;
}

function parseGeoJson(text: string): ParsedProject {
  const root = JSON.parse(text) as unknown;
  const output: ParsedProject = { lines: [], points: [], ignored: 0 };

  const addFeature = (feature: unknown): void => {
    if (!isRecord(feature)) {
      output.ignored += 1;
      return;
    }
    const properties = isRecord(feature.properties) ? feature.properties : {};
    if (isRecord(feature.geometry)) addGeoJsonGeometry(feature.geometry, properties, output);
    else output.ignored += 1;
  };

  if (isRecord(root) && root.type === 'FeatureCollection' && Array.isArray(root.features)) {
    for (const feature of root.features) addFeature(feature);
  } else if (isRecord(root) && root.type === 'Feature') {
    addFeature(root);
  } else if (isRecord(root)) {
    addGeoJsonGeometry(root, {}, output);
  } else {
    throw new Error('The JSON file is not a GeoJSON object.');
  }

  return output;
}

function parseXml(text: string): XMLDocument {
  const documentNode = new DOMParser().parseFromString(text, 'application/xml');
  if (documentNode.getElementsByTagName('parsererror').length) throw new Error('The XML file is not valid.');
  return documentNode;
}

function directChildText(element: Element, localName: string): string | undefined {
  for (const child of Array.from(element.children)) {
    if (child.localName === localName) {
      const value = child.textContent?.trim();
      if (value) return value;
    }
  }
  return undefined;
}

function xmlProperties(element: Element): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const key of ['name', 'desc', 'description', 'type', 'cmt']) {
    const value = directChildText(element, key);
    if (value) properties[key] = value;
  }
  for (const data of Array.from(element.getElementsByTagNameNS('*', 'Data'))) {
    const name = data.getAttribute('name')?.trim();
    const value = data.getElementsByTagNameNS('*', 'value')[0]?.textContent?.trim();
    if (name && value) properties[name] = value;
  }
  for (const data of Array.from(element.getElementsByTagNameNS('*', 'SimpleData'))) {
    const name = data.getAttribute('name')?.trim();
    const value = data.textContent?.trim();
    if (name && value) properties[name] = value;
  }
  return properties;
}

function parseGpx(text: string): ParsedProject {
  const documentNode = parseXml(text);
  const output: ParsedProject = { lines: [], points: [], ignored: 0 };

  const parsePointElement = (element: Element): Coordinate | null => {
    const lat = Number(element.getAttribute('lat'));
    const lon = Number(element.getAttribute('lon'));
    return validCoordinate([lon, lat]) ? [lon, lat] : null;
  };

  for (const track of Array.from(documentNode.getElementsByTagNameNS('*', 'trk'))) {
    const properties = xmlProperties(track);
    for (const segment of Array.from(track.getElementsByTagNameNS('*', 'trkseg'))) {
      const coordinates = Array.from(segment.getElementsByTagNameNS('*', 'trkpt'))
        .map(parsePointElement)
        .filter((value): value is Coordinate => Boolean(value));
      const line = cleanLine(coordinates);
      if (line.length) output.lines.push({ coordinates: line, properties });
      else output.ignored += 1;
    }
  }

  for (const route of Array.from(documentNode.getElementsByTagNameNS('*', 'rte'))) {
    const coordinates = Array.from(route.getElementsByTagNameNS('*', 'rtept'))
      .map(parsePointElement)
      .filter((value): value is Coordinate => Boolean(value));
    const line = cleanLine(coordinates);
    if (line.length) output.lines.push({ coordinates: line, properties: xmlProperties(route) });
    else output.ignored += 1;
  }

  for (const waypoint of Array.from(documentNode.getElementsByTagNameNS('*', 'wpt'))) {
    const coordinate = parsePointElement(waypoint);
    if (coordinate) output.points.push({ coordinate, properties: xmlProperties(waypoint) });
    else output.ignored += 1;
  }

  return output;
}

function parseKmlCoordinates(text: string | null): Coordinate[] {
  if (!text) return [];
  return cleanLine(
    text
      .trim()
      .split(/\s+/)
      .map((token) => token.split(',').slice(0, 2).map(Number))
  );
}

function parseKml(text: string): ParsedProject {
  const documentNode = parseXml(text);
  const output: ParsedProject = { lines: [], points: [], ignored: 0 };

  for (const placemark of Array.from(documentNode.getElementsByTagNameNS('*', 'Placemark'))) {
    const properties = xmlProperties(placemark);

    for (const lineString of Array.from(placemark.getElementsByTagNameNS('*', 'LineString'))) {
      const line = parseKmlCoordinates(lineString.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ?? null);
      if (line.length) output.lines.push({ coordinates: line, properties });
      else output.ignored += 1;
    }

    for (const track of Array.from(placemark.getElementsByTagNameNS('*', 'Track'))) {
      const line = cleanLine(
        Array.from(track.getElementsByTagNameNS('*', 'coord')).map((coord) =>
          (coord.textContent ?? '').trim().split(/\s+/).slice(0, 2).map(Number)
        )
      );
      if (line.length) output.lines.push({ coordinates: line, properties });
      else output.ignored += 1;
    }

    for (const point of Array.from(placemark.getElementsByTagNameNS('*', 'Point'))) {
      const raw = point.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent?.trim().split(',').slice(0, 2).map(Number);
      if (validCoordinate(raw)) output.points.push({ coordinate: [Number(raw[0]), Number(raw[1])], properties });
      else output.ignored += 1;
    }
  }

  return output;
}

async function parseProjectFile(file: File): Promise<ParsedProject> {
  const text = await file.text();
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (extension === 'gpx') return parseGpx(text);
  if (extension === 'kml') return parseKml(text);
  if (extension === 'geojson' || extension === 'json') return parseGeoJson(text);
  throw new Error('Supported project files are GeoJSON, GPX, and KML.');
}

function sourceNotes(fileName: string, properties: Record<string, unknown>): string {
  const sourceId = firstString(properties, ['id', 'ID', 'fid', 'FID', 'objectid', 'OBJECTID']);
  const description = firstString(properties, ['notes', 'description', 'desc', 'cmt']);
  return [`Imported from ${fileName}.`, sourceId ? `Source feature: ${sourceId}.` : '', description ?? '']
    .filter(Boolean)
    .join(' ');
}

async function resolveRide(rideId: string | undefined, newRideName: string): Promise<Ride | undefined> {
  const requestedName = newRideName.trim();
  if (requestedName) {
    const existing = await db.rides.filter((ride) => ride.name.toLowerCase() === requestedName.toLowerCase()).first();
    if (existing) return existing;
    const now = new Date().toISOString();
    const ride: Ride = { id: crypto.randomUUID(), name: requestedName, createdAt: now, updatedAt: now };
    await db.rides.add(ride);
    return ride;
  }
  return rideId ? await db.rides.get(rideId) : undefined;
}

async function saveProjectFile(
  file: File,
  parsed: ParsedProject,
  defaults: ImportDefaults,
  newRideName: string
): Promise<SavedProject> {
  const ride = await resolveRide(defaults.rideId, newRideName);
  const now = new Date().toISOString();
  const fileBase = file.name.replace(/\.[^.]+$/, '') || 'Imported feature';

  const segments: ProjectSegment[] = parsed.lines.map((line, index) => {
    const id = `import-${crypto.randomUUID()}`;
    const properties = line.properties;
    const travelStatus = normalizeTravelStatus(properties.travelStatus ?? properties.travel_state, defaults.travelStatus);
    return {
      id,
      name: firstString(properties, ['name', 'Name', 'title', 'label']) ?? `${fileBase} line ${index + 1}`,
      systemId: firstString(properties, ['systemId', 'system_id', 'system']) ?? ride?.id ?? `import-${fileBase}`,
      featureType: normalizeFeatureType(properties.featureType ?? properties.feature_type ?? properties.type, defaults.featureType),
      fromNodeId: `${id}-start`,
      toNodeId: `${id}-end`,
      side: normalizeSide(properties.side ?? properties.bank, defaults.side),
      travelStatus,
      verifiedEquipment: [],
      mowStatus: normalizeMowStatus(properties.mowStatus ?? properties.mow_status, defaults.mowStatus),
      lastVerifiedAt: travelStatus === 'verified' ? now : undefined,
      notes: sourceNotes(file.name, properties),
      geometry: { type: 'LineString', coordinates: line.coordinates },
      rideId: ride?.id,
      captureMethod: 'imported'
    };
  });

  const structures: StructurePoint[] = parsed.points.map((point, index) => ({
    id: `structure-${crypto.randomUUID()}`,
    name: firstString(point.properties, ['name', 'Name', 'title', 'label']) ?? `${fileBase} point ${index + 1}`,
    structureType: normalizeStructureType(
      point.properties.structureType ?? point.properties.structure_type ?? point.properties.type,
      defaults.structureType
    ),
    coordinates: point.coordinate,
    notes: sourceNotes(file.name, point.properties)
  }));

  await db.transaction('rw', [db.segments, db.structures], async () => {
    if (segments.length) await db.segments.bulkAdd(segments);
    if (structures.length) await db.structures.bulkAdd(structures);
  });

  return { segments: segments.length, structures: structures.length, ignored: parsed.ignored, rideName: ride?.name };
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .bfid-import-control { position: relative; overflow: visible !important; }
    .bfid-import-button { width: auto !important; min-width: 68px; padding: 0 10px !important; color: #152019; font: 700 13px/29px system-ui,sans-serif; }
    .bfid-import-panel { position: absolute; top: 0; right: calc(100% + 7px); width: min(310px, calc(100vw - 92px)); max-height: calc(100vh - 90px); overflow-y: auto; display: grid; gap: 9px; padding: 12px; border: 1px solid #557565; border-radius: 9px; background: rgba(7,22,16,.98); color: #edf4ef; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
    .bfid-import-panel[hidden] { display: none; }
    .bfid-import-panel h3 { margin: 0; font: 700 15px/1.2 system-ui,sans-serif; }
    .bfid-import-panel label { display: grid; gap: 3px; color: #c5d4cb; font: 12px/1.3 system-ui,sans-serif; }
    .bfid-import-panel select,.bfid-import-panel input { width: 100%; min-height: 36px; padding: 6px 7px; border: 1px solid #456454; border-radius: 6px; background: #172b21; color: #edf4ef; }
    .bfid-import-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .bfid-import-actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .bfid-import-actions button { min-height: 38px; border: 1px solid #456454; border-radius: 6px; background: #28543e; color: #fff; font: 700 12px system-ui,sans-serif; }
    .bfid-import-actions button.secondary { background: #172b21; }
    .bfid-import-status { min-height: 18px; color: #b9c9bf; font: 12px/1.35 system-ui,sans-serif; }
    .bfid-import-note { color: #9fb0a6; font: 11px/1.35 system-ui,sans-serif; }
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

class ProjectImportControl implements IControl {
  private container: HTMLDivElement | null = null;

  onAdd(): HTMLElement {
    ensureStyles();
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group bfid-import-control';
    this.container = container;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bfid-import-button';
    button.textContent = 'Import';
    button.title = 'Import GeoJSON, GPX, or KML project data';

    const panel = document.createElement('div');
    panel.className = 'bfid-import-panel';
    panel.hidden = true;
    const heading = document.createElement('h3');
    heading.textContent = 'Import project features';

    const featureType = optionSelect(lineFeatureTypes, 'access-road');
    const side = optionSelect(lineSides, 'center');
    const structureType = optionSelect(structureTypes, 'crossing');
    const travelStatus = optionSelect(travelStatuses, 'unknown');
    const mowStatus = optionSelect(mowStatuses, 'unmowed');
    const rideSelect = document.createElement('select');
    const newRideName = document.createElement('input');
    newRideName.placeholder = 'Optional new Ride name';

    const populateRides = async (): Promise<void> => {
      const rides = await db.rides.orderBy('name').toArray();
      rideSelect.replaceChildren();
      const unassigned = document.createElement('option');
      unassigned.value = '';
      unassigned.textContent = 'Unassigned';
      rideSelect.append(unassigned);
      for (const ride of rides) {
        const option = document.createElement('option');
        option.value = ride.id;
        option.textContent = ride.name;
        rideSelect.append(option);
      }
      const createNew = document.createElement('option');
      createNew.value = NEW_RIDE_VALUE;
      createNew.textContent = 'Create new Ride below';
      rideSelect.append(createNew);
    };
    void populateRides();

    const defaultsGrid = document.createElement('div');
    defaultsGrid.className = 'bfid-import-grid';
    defaultsGrid.append(
      field('Default line type', featureType),
      field('Default side/bank', side),
      field('Default point type', structureType),
      field('Travel state', travelStatus),
      field('Mowing state', mowStatus),
      field('Assign lines to Ride', rideSelect)
    );

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.geojson,.json,.gpx,.kml,application/geo+json,application/json,application/gpx+xml,application/vnd.google-earth.kml+xml';
    const status = document.createElement('div');
    status.className = 'bfid-import-status';

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.textContent = 'Import permanently';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'secondary';
    closeButton.textContent = 'Close';
    const actions = document.createElement('div');
    actions.className = 'bfid-import-actions';
    actions.append(importButton, closeButton);

    const note = document.createElement('div');
    note.className = 'bfid-import-note';
    note.textContent = 'Recognized feature properties override these defaults. Unsupported polygons are counted but not imported. Imported data is included in JSON backups.';

    importButton.addEventListener('click', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        status.textContent = 'Choose a project file first.';
        return;
      }
      importButton.disabled = true;
      status.textContent = `Reading ${file.name}…`;
      try {
        const parsed = await parseProjectFile(file);
        if (!parsed.lines.length && !parsed.points.length) throw new Error('No usable lines or points were found.');
        const defaults: ImportDefaults = {
          featureType: featureType.value as LineFeatureType,
          side: side.value as LineSide,
          structureType: structureType.value as StructureType,
          travelStatus: travelStatus.value as TravelStatus,
          mowStatus: mowStatus.value as MowStatus,
          rideId: rideSelect.value && rideSelect.value !== NEW_RIDE_VALUE ? rideSelect.value : undefined
        };
        const result = await saveProjectFile(file, parsed, defaults, newRideName.value);
        status.textContent = `Saved ${result.segments} lines and ${result.structures} points${result.ignored ? `; ignored ${result.ignored}` : ''}${result.rideName ? `; Ride ${result.rideName}` : ''}. Reloading map…`;
        window.setTimeout(() => location.reload(), 900);
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Project import failed.';
        importButton.disabled = false;
      }
    });

    closeButton.addEventListener('click', () => {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    });
    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
    });

    for (const eventName of ['click', 'dblclick', 'mousedown', 'touchstart', 'wheel']) {
      container.addEventListener(eventName, (event) => event.stopPropagation());
    }

    panel.append(
      heading,
      field('Project file', fileInput),
      defaultsGrid,
      field('New Ride name', newRideName),
      actions,
      status,
      note
    );
    container.append(button, panel);
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }
}

export function installProjectImportPatch(): void {
  const prototype = MapLibreMap.prototype as any;
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_FLAG)) return;
  prototype[PATCH_FLAG] = true;

  const originalAddControl = prototype.addControl as (...args: any[]) => MapLibreMap;
  prototype.addControl = function patchedAddControl(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const mapWithFlag = this as any;
    const firstControl = !Object.prototype.hasOwnProperty.call(mapWithFlag, MAP_FLAG);
    if (firstControl) mapWithFlag[MAP_FLAG] = true;
    const result = originalAddControl.apply(this, args);
    if (firstControl) originalAddControl.call(this, new ProjectImportControl(), 'top-right');
    return result;
  };
}
