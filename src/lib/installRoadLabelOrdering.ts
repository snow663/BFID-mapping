import { Map as MapLibreMap } from 'maplibre-gl';

const PATCH_FLAG = '__bfidRoadLabelOrderingInstalled';
const ROAD_LAYER_ID = 'sd-road-label-overlay';
const PROJECT_LAYER_ID = 'segments-casing';

function restoreRoadLabelOrder(map: MapLibreMap): void {
  if (!map.getLayer(ROAD_LAYER_ID) || !map.getLayer(PROJECT_LAYER_ID)) return;

  // Keep the transparent road/label overlay above aerial, slope and hillshade
  // rasters, but below BFID operational lines and symbols.
  map.moveLayer(ROAD_LAYER_ID, PROJECT_LAYER_ID);
}

export function installRoadLabelOrderingPatch(): void {
  const prototype = MapLibreMap.prototype as any;
  if (Object.prototype.hasOwnProperty.call(prototype, PATCH_FLAG)) return;
  prototype[PATCH_FLAG] = true;

  const originalAddLayer = prototype.addLayer as (...args: any[]) => MapLibreMap;
  prototype.addLayer = function patchedAddLayer(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const result = originalAddLayer.apply(this, args);
    queueMicrotask(() => {
      try {
        restoreRoadLabelOrder(this);
      } catch (error) {
        console.warn('Could not restore road-label layer order', error);
      }
    });
    return result;
  };

  const originalSetStyle = prototype.setStyle as (...args: any[]) => MapLibreMap;
  prototype.setStyle = function patchedSetStyle(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const result = originalSetStyle.apply(this, args);
    this.once('idle', () => restoreRoadLabelOrder(this));
    return result;
  };
}
