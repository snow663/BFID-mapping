<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import maplibregl, { Map as MapLibreMap, Marker, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';
  import type { FeatureCollection, LineString, Point } from 'geojson';
  import type { PositionFix, ProjectSegment, StructurePoint } from '../types';

  export let segments: ProjectSegment[] = [];
  export let structures: StructurePoint[] = [];
  export let selectedSegmentId: string | null = null;
  export let position: PositionFix | null = null;
  export let manualPlacement = false;
  export let rasterPmtilesUrl = '';

  const dispatch = createEventDispatcher<{
    selectSegment: { id: string };
    manualPosition: { longitude: number; latitude: number };
  }>();

  let container: HTMLDivElement;
  let map: MapLibreMap | null = null;
  let marker: Marker | null = null;
  let loaded = false;
  const protocol = new Protocol();

  const blankStyle: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#18251f' }
      }
    ]
  };

  function segmentCollection(): FeatureCollection<LineString> {
    return {
      type: 'FeatureCollection',
      features: segments.map((segment) => ({
        type: 'Feature',
        id: segment.id,
        geometry: segment.geometry,
        properties: {
          id: segment.id,
          name: segment.name,
          travelStatus: segment.travelStatus,
          mowStatus: segment.mowStatus,
          selected: segment.id === selectedSegmentId
        }
      }))
    };
  }

  function structureCollection(): FeatureCollection<Point> {
    return {
      type: 'FeatureCollection',
      features: structures.map((structure) => ({
        type: 'Feature',
        id: structure.id,
        geometry: { type: 'Point', coordinates: structure.coordinates },
        properties: {
          id: structure.id,
          name: structure.name,
          structureType: structure.structureType
        }
      }))
    };
  }

  function addOperationalLayers(): void {
    if (!map) return;
    map.addSource('segments', { type: 'geojson', data: segmentCollection() });
    map.addLayer({
      id: 'segments-casing',
      type: 'line',
      source: 'segments',
      paint: {
        'line-color': '#0a0d0b',
        'line-width': ['case', ['get', 'selected'], 10, 7],
        'line-opacity': 0.75
      }
    });
    map.addLayer({
      id: 'segments-line',
      type: 'line',
      source: 'segments',
      paint: {
        'line-color': [
          'match',
          ['get', 'travelStatus'],
          'verified', '#43c270',
          'blocked', '#ef5b5b',
          'seasonal', '#e3a646',
          'foot-only', '#b887e8',
          'visually-likely', '#5bc0de',
          '#aeb7b1'
        ],
        'line-width': ['case', ['get', 'selected'], 7, 4],
        'line-dasharray': ['case', ['==', ['get', 'travelStatus'], 'unknown'], ['literal', [2, 2]], ['literal', [1, 0]]]
      }
    });

    map.addSource('structures', { type: 'geojson', data: structureCollection() });
    map.addLayer({
      id: 'structures-circle',
      type: 'circle',
      source: 'structures',
      paint: {
        'circle-radius': ['match', ['get', 'structureType'], 'drop-in', 8, 6],
        'circle-color': ['match', ['get', 'structureType'], 'drop-in', '#f4b942', 'check', '#54a7d8', '#e7eee9'],
        'circle-stroke-color': '#102019',
        'circle-stroke-width': 2
      }
    });

    map.on('click', 'segments-line', (event) => {
      const id = event.features?.[0]?.properties?.id as string | undefined;
      if (id) dispatch('selectSegment', { id });
    });
    map.on('mouseenter', 'segments-line', () => map?.getCanvas().classList.add('map-pointer'));
    map.on('mouseleave', 'segments-line', () => map?.getCanvas().classList.remove('map-pointer'));
  }

  function configurePmtilesBasemap(): void {
    if (!map) return;
    if (map.getLayer('offline-raster')) map.removeLayer('offline-raster');
    if (map.getSource('offline-raster')) map.removeSource('offline-raster');
    if (!rasterPmtilesUrl.trim()) return;
    map.addSource('offline-raster', {
      type: 'raster',
      url: `pmtiles://${rasterPmtilesUrl.trim()}`,
      tileSize: 256
    });
    map.addLayer(
      { id: 'offline-raster', type: 'raster', source: 'offline-raster', paint: { 'raster-opacity': 1 } },
      'segments-casing'
    );
  }

  function updatePosition(): void {
    if (!map) return;
    if (!position) {
      marker?.remove();
      marker = null;
      return;
    }
    const element = document.createElement('div');
    element.className = position.source === 'gps' ? 'position-marker live' : 'position-marker manual';
    marker?.remove();
    marker = new Marker({ element }).setLngLat([position.longitude, position.latitude]).addTo(map);
  }

  onMount(() => {
    maplibregl.addProtocol('pmtiles', protocol.tile);
    map = new MapLibreMap({
      container,
      style: blankStyle,
      center: [-103.409, 44.7105],
      zoom: 12.5,
      attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    map.on('load', () => {
      loaded = true;
      addOperationalLayers();
      configurePmtilesBasemap();
      updatePosition();
    });
    map.on('click', (event) => {
      if (manualPlacement) {
        dispatch('manualPosition', { longitude: event.lngLat.lng, latitude: event.lngLat.lat });
      }
    });
  });

  $: if (loaded && map?.getSource('segments')) {
    (map.getSource('segments') as GeoJSONSource).setData(segmentCollection());
  }
  $: if (loaded && map?.getSource('structures')) {
    (map.getSource('structures') as GeoJSONSource).setData(structureCollection());
  }
  $: if (loaded) updatePosition();
  $: if (loaded) configurePmtilesBasemap();

  onDestroy(() => {
    marker?.remove();
    map?.remove();
    maplibregl.removeProtocol('pmtiles');
  });
</script>

<div class:manual-placement={manualPlacement} class="map" bind:this={container}></div>
