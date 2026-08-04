import { Map as MapLibreMap } from 'maplibre-gl';

const PATCH_FLAG = '__bfidRoadLabelOrderingInstalled';
const REFERENCE_LAYER_IDS = [
  'reference-hydrography',
  'reference-road-labels',
  'reference-place-labels'
] as const;
const PROJECT_LAYER_ID = 'segments-casing';

function restoreReferenceOrder(map: MapLibreMap): void {
  if (!map.getLayer(PROJECT_LAYER_ID)) return;

  // Public raster overlays remain above the aerial imagery but below local
  // BFID operational lines and the local line-name symbol layer.
  for (const layerId of REFERENCE_LAYER_IDS) {
    if (map.getLayer(layerId)) map.moveLayer(layerId, PROJECT_LAYER_ID);
  }
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
        restoreReferenceOrder(this);
      } catch (error) {
        console.warn('Could not restore reference-label layer order', error);
      }
    });
    return result;
  };

  const originalSetStyle = prototype.setStyle as (...args: any[]) => MapLibreMap;
  prototype.setStyle = function patchedSetStyle(this: MapLibreMap, ...args: any[]): MapLibreMap {
    const result = originalSetStyle.apply(this, args);
    this.once('idle', () => restoreReferenceOrder(this));
    return result;
  };
}
