import { Map as MapLibreMap, type GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';

const PATCH_FLAG = '__bfidSprayTrackLayerInstalled';
const MAP_FLAG = '__bfidSprayTrackLayerInitialized';
const SOURCE_ID = 'bfid-active-spray-track';
const CASING_LAYER_ID = 'bfid-active-spray-track-casing';
const LINE_LAYER_ID = 'bfid-active-spray-track-line';
const EVENT_NAME = 'bfid:spray-track';

type SprayTrackDetail = {
  active: boolean;
  coordinates: [number, number][];
};

function collection(coordinates: [number, number][]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: coordinates.length >= 2
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }]
      : []
  };
}

function initialize(map: MapLibreMap): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: collection([]) });
  }
  if (!map.getLayer(CASING_LAYER_ID)) {
    map.addLayer({
      id: CASING_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
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
    source?.setData(collection(detail?.active ? detail.coordinates ?? [] : []));
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
