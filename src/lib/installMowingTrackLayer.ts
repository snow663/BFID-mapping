import { Map as MapLibreMap, type GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';

const PATCH_FLAG = '__bfidMowingTrackLayerInstalled';
const MAP_FLAG = '__bfidMowingTrackLayerInitialized';
const SOURCE_ID = 'bfid-active-mowing-track';
const CASING_LAYER_ID = 'bfid-active-mowing-track-casing';
const LINE_LAYER_ID = 'bfid-active-mowing-track-line';
const EVENT_NAME = 'bfid:mowing-track';
const STATE_KEY = '__bfidMowingTrackState';

type MowingTrackDetail = {
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

function currentTrack(): MowingTrackDetail {
  const value = (window as unknown as Record<string, unknown>)[STATE_KEY] as MowingTrackDetail | undefined;
  return value?.active && Array.isArray(value.coordinates)
    ? { active: true, coordinates: value.coordinates }
    : { active: false, coordinates: [] };
}

function initialize(map: MapLibreMap): void {
  const initial = currentTrack();
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: collection(initial.active ? initial.coordinates : [])
    });
  }
  if (!map.getLayer(CASING_LAYER_ID)) {
    map.addLayer({
      id: CASING_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': '#101806',
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
        'line-color': '#a3e635',
        'line-width': 6,
        'line-opacity': 0.98
      }
    });
  }

  const update = (event: Event): void => {
    const detail = (event as CustomEvent<MowingTrackDetail>).detail;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(collection(detail?.active ? detail.coordinates ?? [] : []));
  };

  window.addEventListener(EVENT_NAME, update);
  map.once('remove', () => window.removeEventListener(EVENT_NAME, update));
}

export function installMowingTrackLayer(): void {
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
