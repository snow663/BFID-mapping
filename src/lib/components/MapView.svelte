<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import maplibregl, {
    LngLatBounds,
    Map as MapLibreMap,
    Marker,
    type GeoJSONSource,
    type StyleSpecification
  } from 'maplibre-gl';
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
  let resizeObserver: ResizeObserver | null = null;
  let startupTimer: number | null = null;
  let loaded = false;
  let lastFitSignature = '';
  let centeredOnLivePosition = false;
  let renderError = '';
  let webglStatus = 'Testing graphics support…';
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

  function dataSignature(): string {
    return [
      segments.length,
      structures.length,
      segments[0]?.id ?? '',
      segments.at(-1)?.id ?? '',
      structures[0]?.id ?? '',
      structures.at(-1)?.id ?? ''
    ].join(':');
  }

  function fitOperationalData(force = false): void {
    if (!map || !loaded || (segments.length === 0 && structures.length === 0)) return;

    const signature = dataSignature();
    if (!force && signature === lastFitSignature) return;

    const bounds = new LngLatBounds();
    for (const segment of segments) {
      for (const coordinate of segment.geometry.coordinates) {
        bounds.extend([coordinate[0], coordinate[1]]);
      }
    }
    for (const structure of structures) bounds.extend(structure.coordinates);

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 72, right: 56, bottom: 72, left: 56 },
        maxZoom: 14,
        duration: 0
      });
      lastFitSignature = signature;
    }
  }

  function resizeMap(): void {
    window.requestAnimationFrame(() => {
      map?.resize();
      fitOperationalData();
    });
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
      centeredOnLivePosition = false;
      return;
    }

    const element = document.createElement('div');
    element.className = position.source === 'gps' ? 'position-marker live' : 'position-marker manual';
    marker?.remove();
    marker = new Marker({ element }).setLngLat([position.longitude, position.latitude]).addTo(map);

    if (position.source === 'gps' && !centeredOnLivePosition) {
      map.easeTo({ center: [position.longitude, position.latitude], zoom: Math.max(map.getZoom(), 15), duration: 500 });
      centeredOnLivePosition = true;
    }
  }

  function hasGraphicsContext(contextType: 'webgl2' | 'webgl'): boolean {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext(contextType, { failIfMajorPerformanceCaveat: false }));
    } catch {
      return false;
    }
  }

  function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown map-renderer error.';
    }
  }

  onMount(() => {
    const webgl2 = hasGraphicsContext('webgl2');
    const webgl1 = hasGraphicsContext('webgl');
    webglStatus = `WebGL 2: ${webgl2 ? 'yes' : 'no'} · WebGL 1: ${webgl1 ? 'yes' : 'no'}`;

    if (!webgl2 && !webgl1) {
      renderError = 'This browser did not provide a usable WebGL graphics context.';
      return;
    }

    try {
      maplibregl.addProtocol('pmtiles', protocol.tile);
      map = new MapLibreMap({
        container,
        style: blankStyle,
        center: [-103.409, 44.7105],
        zoom: 12.5,
        attributionControl: false,
        canvasContextAttributes: {
          contextType: webgl2 ? 'webgl2' : 'webgl',
          powerPreference: 'low-power',
          failIfMajorPerformanceCaveat: false,
          antialias: false,
          preserveDrawingBuffer: false
        }
      });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

      resizeObserver = new ResizeObserver(resizeMap);
      resizeObserver.observe(container);

      startupTimer = window.setTimeout(() => {
        if (!loaded) renderError = 'MapLibre did not reach its load event within 8 seconds.';
      }, 8000);

      map.on('error', (event) => {
        if (!loaded) renderError = errorMessage(event.error);
      });
      map.on('load', () => {
        loaded = true;
        renderError = '';
        if (startupTimer !== null) window.clearTimeout(startupTimer);
        startupTimer = null;
        webglStatus = `${webglStatus} · Map loaded`;
        addOperationalLayers();
        configurePmtilesBasemap();
        updatePosition();
        resizeMap();
        fitOperationalData(true);
      });
      map.on('click', (event) => {
        if (manualPlacement) {
          dispatch('manualPosition', { longitude: event.lngLat.lng, latitude: event.lngLat.lat });
        }
      });
    } catch (error) {
      renderError = errorMessage(error);
    }
  });

  $: if (loaded && map?.getSource('segments')) {
    (map.getSource('segments') as GeoJSONSource).setData(segmentCollection());
    fitOperationalData();
  }
  $: if (loaded && map?.getSource('structures')) {
    (map.getSource('structures') as GeoJSONSource).setData(structureCollection());
    fitOperationalData();
  }
  $: if (loaded) updatePosition();
  $: if (loaded) configurePmtilesBasemap();

  onDestroy(() => {
    if (startupTimer !== null) window.clearTimeout(startupTimer);
    resizeObserver?.disconnect();
    marker?.remove();
    map?.remove();
    maplibregl.removeProtocol('pmtiles');
  });
</script>

<div class:manual-placement={manualPlacement} class="map" bind:this={container}></div>

{#if renderError}
  <div class="map-diagnostic" role="alert">
    <strong>Map renderer did not start</strong>
    <span>{segments.length} demo segments and {structures.length} structures are loaded.</span>
    <span>{webglStatus}</span>
    <code>{renderError}</code>
    <small>Send a screenshot of this message; it identifies the renderer failure.</small>
  </div>
{:else if !loaded}
  <div class="map-loading">
    <strong>Starting map…</strong>
    <span>{segments.length} demo segments loaded</span>
    <small>{webglStatus}</small>
  </div>
{/if}
