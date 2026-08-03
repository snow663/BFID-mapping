import { Map as MapLibreMap, type GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString } from 'geojson';

const PATCH_FLAG = '__bfidSprayTrackLayerInstalled';
const MAP_FLAG = '__bfidSprayTrackLayerInitialized';
const SOURCE_ID = 'bfid-active-spray-track';
const ROUTE_LAYER_ID = 'bfid-canonical-spray-route';
const CASING_LAYER_ID = 'bfid-active-spray-track-casing';
const LINE_LAYER_ID = 'bfid-active-spray-track-line';
const EVENT_NAME = 'bfid:spray-track';
const STATE_KEY = '__bfidSprayTrackState';

type SprayTrackDetail = {
  active: boolean;
  coordinates: [number, number][];
  routeCoordinates?: [number, number][];
};

function line(kind: 'route' | 'live', coordinates: [number, number][]): Feature<LineString> | null {
  return coordinates.length >= 2
    ? { type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates } }
    : null;
}

function collection(detail: SprayTrackDetail): FeatureCollection<LineString> {
  const features = [
    line('route', detail.routeCoordinates ?? []),
    detail.active ? line('live', detail.coordinates ?? []) : null
  ].filter((feature): feature is Feature<LineString> => Boolean(feature));
  return { type: 'FeatureCollection', features };
}

function currentTrack(): SprayTrackDetail {
  const value = (window as unknown as Record<string, unknown>)[STATE_KEY] as SprayTrackDetail | undefined;
  return {
    active: Boolean(value?.active),
    coordinates: Array.isArray(value?.coordinates) ? value.coordinates : [],
    routeCoordinates: Array.isArray(value?.routeCoordinates) ? value.routeCoordinates : []
  };
}

function initialize(map: MapLibreMap): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: collection(currentTrack()) });
  }
  if (!map.getLayer(ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'route'],
      paint: {
        'line-color': '#a5f3fc',
        'line-width': 4,
        'line-opacity': 0.78,
        'line-dasharray': [2, 1.5]
      }
    });
  }
  if (!map.getLayer(CASING_LAYER_ID)) {
    map.addLayer({
      id: CASING_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'live'],
      paint: {
        'line-color': '#06151d',
        'line-width': 10,
        'line-opacity': 0.92
      }
    });
  }
  if (!map.getLayer(LINE_LAYER_ID)) {
    map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'live'],
      paint: {
        'line-color': '#22d3ee',
        'line-width': 6,
        'line-opacity': 0.98
      }
    });
  }

  const update = (event: Event): void => {
    const detail = (event as CustomEvent<SprayTrackDetail>).detail;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(collection({
      active: Boolean(detail?.active),
      coordinates: detail?.coordinates ?? [],
      routeCoordinates: detail?.routeCoordinates ?? []
    }));
  };

  window.addEventListener(EVENT_NAME, update);
  map.once('remove', () => window.removeEventListener(EVENT_NAME, update));
}

export function installSprayTrackLayer(): void {
  const prototype = MapLibreMap.prototype as any;
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_FLAG)) return;
  prototype[PATCH_FLAG] = true;

  const originalAddControl = prototype.addControl as (...args: any[]) => MapLibreMap;
  prototype.addControl = function patchedAddControl(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const mapWithFlag = this as any;
    if (!Object.prototype.hasOwnProperty.call(mapWithFlag, MAP_FLAG)) {
      mapWithFlag[MAP_FLAG] = true;
      this.once('load', () => initialize(this));
    }
    return originalAddControl.apply(this, args);
  };
}
