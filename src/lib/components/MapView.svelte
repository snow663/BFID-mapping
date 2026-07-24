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
  let mapCanvas: HTMLCanvasElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let startupTimer: number | null = null;
  let postLoadTimers: number[] = [];
  let loaded = false;
  let lastFitSignature = '';
  let centeredOnLivePosition = false;
  let configuredBasemapUrl = '';
  let renderError = '';
  let mapStage = 'component mounted';
  let canvasStatus = 'canvas not created';
  const protocol = new Protocol();

  function segmentCollection(
    currentSegments: ProjectSegment[] = segments,
    currentSelectedId: string | null = selectedSegmentId
  ): FeatureCollection<LineString> {
    return {
      type: 'FeatureCollection',
      features: currentSegments.map((segment) => ({
        type: 'Feature',
        id: segment.id,
        geometry: segment.geometry,
        properties: {
          id: segment.id,
          name: segment.name,
          travelStatus: segment.travelStatus,
          mowStatus: segment.mowStatus,
          selected: segment.id === currentSelectedId
        }
      }))
    };
  }

  function structureCollection(currentStructures: StructurePoint[] = structures): FeatureCollection<Point> {
    return {
      type: 'FeatureCollection',
      features: currentStructures.map((structure) => ({
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

  function operationalStyle(): StyleSpecification {
    return {
      version: 8,
      sources: {
        segments: { type: 'geojson', data: segmentCollection() },
        structures: { type: 'geojson', data: structureCollection() }
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#18251f' }
        },
        {
          id: 'segments-casing',
          type: 'line',
          source: 'segments',
          paint: { 'line-color': '#070b09', 'line-width': 8, 'line-opacity': 0.9 }
        },
        {
          id: 'segments-unknown',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'travelStatus'], 'unknown'],
          paint: { 'line-color': '#aeb7b1', 'line-width': 5 }
        },
        {
          id: 'segments-verified',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'travelStatus'], 'verified'],
          paint: { 'line-color': '#43c270', 'line-width': 5 }
        },
        {
          id: 'segments-blocked',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'travelStatus'], 'blocked'],
          paint: { 'line-color': '#ef5b5b', 'line-width': 5 }
        },
        {
          id: 'segments-seasonal',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'travelStatus'], 'seasonal'],
          paint: { 'line-color': '#e3a646', 'line-width': 5 }
        },
        {
          id: 'segments-foot-only',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'travelStatus'], 'foot-only'],
          paint: { 'line-color': '#b887e8', 'line-width': 5 }
        },
        {
          id: 'segments-likely',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'travelStatus'], 'visually-likely'],
          paint: { 'line-color': '#5bc0de', 'line-width': 5 }
        },
        {
          id: 'segments-selected',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'selected'], true],
          paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.35 }
        },
        {
          id: 'structures-circle',
          type: 'circle',
          source: 'structures',
          paint: {
            'circle-radius': 7,
            'circle-color': '#e7eee9',
            'circle-stroke-color': '#102019',
            'circle-stroke-width': 2
          }
        }
      ]
    };
  }

  function dataSignature(currentSegments: ProjectSegment[], currentStructures: StructurePoint[]): string {
    return [
      currentSegments.length,
      currentStructures.length,
      currentSegments[0]?.id ?? '',
      currentSegments.at(-1)?.id ?? '',
      currentStructures[0]?.id ?? '',
      currentStructures.at(-1)?.id ?? ''
    ].join(':');
  }

  function updateCanvasStatus(): void {
    if (!map) {
      canvasStatus = 'canvas not created';
      return;
    }

    const canvas = map.getCanvas();
    const bounds = canvas.getBoundingClientRect();
    canvasStatus = `buffer ${canvas.width}×${canvas.height} · css ${Math.round(bounds.width)}×${Math.round(bounds.height)}`;
  }

  function fitOperationalData(
    currentSegments: ProjectSegment[] = segments,
    currentStructures: StructurePoint[] = structures,
    force = false
  ): void {
    if (!map || !loaded || position?.source === 'gps') return;
    if (currentSegments.length === 0 && currentStructures.length === 0) return;

    const signature = dataSignature(currentSegments, currentStructures);
    if (!force && signature === lastFitSignature) return;

    const bounds = new LngLatBounds();
    for (const segment of currentSegments) {
      for (const coordinate of segment.geometry.coordinates) bounds.extend([coordinate[0], coordinate[1]]);
    }
    for (const structure of currentStructures) bounds.extend(structure.coordinates);

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 72, right: 56, bottom: 72, left: 56 },
        maxZoom: 14,
        duration: 0
      });
      lastFitSignature = signature;
      mapStage = 'project data fitted';
      updateCanvasStatus();
    }
  }

  function updateSources(
    currentSegments: ProjectSegment[],
    currentStructures: StructurePoint[],
    currentSelectedId: string | null
  ): void {
    if (!map || !loaded) return;

    const segmentSource = map.getSource('segments') as GeoJSONSource | undefined;
    const structureSource = map.getSource('structures') as GeoJSONSource | undefined;
    segmentSource?.setData(segmentCollection(currentSegments, currentSelectedId));
    structureSource?.setData(structureCollection(currentStructures));
  }

  function centerOnLivePosition(fix: PositionFix, animateFirstFix = false): void {
    if (!map || fix.source !== 'gps') return;

    const camera = {
      center: [fix.longitude, fix.latitude] as [number, number],
      zoom: Math.max(map.getZoom(), 15)
    };

    if (animateFirstFix && !centeredOnLivePosition) {
      map.easeTo({ ...camera, duration: 500 });
    } else {
      map.jumpTo(camera);
    }
    centeredOnLivePosition = true;
  }

  function resizeMap(forceFit = false): void {
    window.requestAnimationFrame(() => {
      map?.resize();
      updateCanvasStatus();

      if (position?.source === 'gps') {
        centerOnLivePosition(position);
      } else {
        fitOperationalData(segments, structures, forceFit);
      }
    });
  }

  function configurePmtilesBasemap(requestedValue: string): void {
    if (!map || !loaded) return;

    const requestedUrl = requestedValue.trim();
    if (requestedUrl === configuredBasemapUrl) return;

    try {
      if (map.getLayer('offline-raster')) map.removeLayer('offline-raster');
      if (map.getSource('offline-raster')) map.removeSource('offline-raster');
      configuredBasemapUrl = requestedUrl;

      if (!requestedUrl) return;

      map.addSource('offline-raster', {
        type: 'raster',
        url: `pmtiles://${requestedUrl}`,
        tileSize: 256
      });
      map.addLayer(
        { id: 'offline-raster', type: 'raster', source: 'offline-raster', paint: { 'raster-opacity': 1 } },
        'segments-casing'
      );
    } catch (error) {
      renderError = `Basemap setup: ${errorMessage(error)}`;
      mapStage = 'basemap setup error';
    }
  }

  function updatePosition(fix: PositionFix | null): void {
    if (!map) return;

    if (!fix) {
      const wasFollowingGps = centeredOnLivePosition;
      marker?.remove();
      marker = null;
      centeredOnLivePosition = false;

      if (wasFollowingGps) {
        lastFitSignature = '';
        fitOperationalData(segments, structures, true);
      }
      return;
    }

    if (!marker) {
      const element = document.createElement('div');
      marker = new Marker({ element }).setLngLat([fix.longitude, fix.latitude]).addTo(map);
    }

    const element = marker.getElement();
    element.className = fix.source === 'gps' ? 'position-marker live' : 'position-marker manual';
    marker.setLngLat([fix.longitude, fix.latitude]);

    if (fix.source === 'gps') {
      centerOnLivePosition(fix, true);
    } else {
      centeredOnLivePosition = false;
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

  function handleContextLost(event: Event): void {
    event.preventDefault();
    renderError = 'The MapLibre WebGL context was lost after startup.';
    mapStage = 'WebGL context lost';
  }

  function handleContextRestored(): void {
    renderError = '';
    mapStage = 'WebGL context restored';
    resizeMap(true);
  }

  function registerSegmentEvents(): void {
    if (!map) return;
    map.on('click', 'segments-casing', (event) => {
      const id = event.features?.[0]?.properties?.id as string | undefined;
      if (id) dispatch('selectSegment', { id });
    });
    map.on('mouseenter', 'segments-casing', () => map?.getCanvas().classList.add('map-pointer'));
    map.on('mouseleave', 'segments-casing', () => map?.getCanvas().classList.remove('map-pointer'));
  }

  onMount(() => {
    try {
      mapStage = 'constructing MapLibre';
      maplibregl.addProtocol('pmtiles', protocol.tile);
      map = new MapLibreMap({
        container,
        style: operationalStyle(),
        center: [-103.409, 44.7105],
        zoom: 12.5,
        attributionControl: false
      });
      mapStage = 'map object created';

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

      mapCanvas = map.getCanvas();
      mapCanvas.addEventListener('webglcontextlost', handleContextLost, false);
      mapCanvas.addEventListener('webglcontextrestored', handleContextRestored, false);
      updateCanvasStatus();

      resizeObserver = new ResizeObserver(() => resizeMap());
      resizeObserver.observe(container);

      startupTimer = window.setTimeout(() => {
        if (!loaded) {
          renderError = 'MapLibre did not reach its load event within 8 seconds.';
          mapStage = 'load timeout';
          updateCanvasStatus();
        }
      }, 8000);

      map.on('error', (event) => {
        renderError = errorMessage(event.error);
        mapStage = loaded ? 'runtime map error' : 'startup map error';
        updateCanvasStatus();
      });

      map.on('load', () => {
        loaded = true;
        renderError = '';
        mapStage = 'style loaded';
        if (startupTimer !== null) window.clearTimeout(startupTimer);
        startupTimer = null;

        registerSegmentEvents();
        updateSources(segments, structures, selectedSegmentId);
        configurePmtilesBasemap(rasterPmtilesUrl);
        updatePosition(position);
        resizeMap(true);

        postLoadTimers.push(
          window.setTimeout(() => resizeMap(true), 250),
          window.setTimeout(() => resizeMap(true), 1000)
        );
      });

      map.on('idle', updateCanvasStatus);

      map.on('click', (event) => {
        if (manualPlacement) {
          dispatch('manualPosition', { longitude: event.lngLat.lng, latitude: event.lngLat.lat });
        }
      });
    } catch (error) {
      renderError = errorMessage(error);
      mapStage = 'constructor exception';
      updateCanvasStatus();
    }
  });

  $: if (loaded) {
    updateSources(segments, structures, selectedSegmentId);
    if (position?.source !== 'gps') fitOperationalData(segments, structures);
  }
  $: if (loaded && position !== undefined) updatePosition(position);
  $: if (loaded && rasterPmtilesUrl !== undefined) configurePmtilesBasemap(rasterPmtilesUrl);

  onDestroy(() => {
    if (startupTimer !== null) window.clearTimeout(startupTimer);
    for (const timer of postLoadTimers) window.clearTimeout(timer);
    postLoadTimers = [];
    resizeObserver?.disconnect();
    mapCanvas?.removeEventListener('webglcontextlost', handleContextLost);
    mapCanvas?.removeEventListener('webglcontextrestored', handleContextRestored);
    marker?.remove();
    map?.remove();
    maplibregl.removeProtocol('pmtiles');
  });
</script>

<div class:manual-placement={manualPlacement} class="map" bind:this={container}></div>

{#if renderError}
  <div class="map-stage failed" role="alert">
    <strong>{mapStage}</strong>
    <span>{segments.length} segments · {structures.length} structures</span>
    <small>{canvasStatus}</small>
    <code>{renderError}</code>
  </div>
{/if}
