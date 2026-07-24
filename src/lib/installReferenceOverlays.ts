import { Map as MapLibreMap } from 'maplibre-gl';

const PATCH_FLAG = '__bfidReferenceOverlayPatchInstalled';
const MAP_FLAG = '__bfidReferenceOverlaysScheduled';

const SD_ROAD_LABEL_TILES =
  'https://arcgis.sd.gov/arcgis/rest/services/SD_All/Transportation_Roads/MapServer/tile/{z}/{y}/{x}';
const SD_PLSS_QUARTER_QUARTER_TILES =
  'https://arcgis.sd.gov/arcgis/rest/services/SD_All/Boundary_PLSS_QuarterQuarter/MapServer/tile/{z}/{y}/{x}';
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
    sourceId: 'reference-plss-grid',
    layerId: 'reference-plss-grid',
    tiles: SD_PLSS_QUARTER_QUARTER_TILES,
    opacity: 0.62,
    minzoom: 11,
    maxzoom: 17,
    attribution: 'SD BIT / BLM PLSS — approximate land grid, not surveyed parcel boundaries'
  },
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

/**
 * MapView owns the MapLibre instance. Hooking the first control addition lets us
 * register one post-load callback without exposing the map globally or coupling
 * the overlays to a specific basemap. The zero-delay callback runs after
 * MapView installs the selected aerial/terrain layer, keeping these overlays on top.
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
          } catch (error) {
            console.warn('Could not add map names and land-grid overlays', error);
          }
        }, 0);
      });
    }

    return originalAddControl.apply(this, args);
  };
}
