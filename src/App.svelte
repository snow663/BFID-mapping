<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import MapView from './lib/components/MapView.svelte';
  import { downloadBackup, restoreBackup } from './lib/backup';
  import { db, ensureSeedData, getSetting, putSetting } from './lib/db';
  import type {
    Activity,
    BaseLayerMode,
    Equipment,
    LocationMode,
    MowStatus,
    PositionFix,
    ProjectSegment,
    Ride,
    StructurePoint,
    TrackPoint,
    TrackSession,
    TravelStatus
  } from './lib/types';

  const NEW_RIDE_VALUE = '__new__';
  const MAX_BUILDER_ACCURACY_METERS = 30;
  const MIN_BUILDER_POINT_SPACING_METERS = 2;

  let rides: Ride[] = [];
  let segments: ProjectSegment[] = [];
  let structures: StructurePoint[] = [];
  let selectedSegmentId: string | null = null;
  let locationMode: LocationMode = 'none';
  let position: PositionFix | null = null;
  let gpsWatchId: number | null = null;
  let gpsMessage = 'Location inactive';
  let equipment: Equipment = 'mower';
  let activeSession: TrackSession | null = null;
  let activePointCount = 0;
  let activeTrackCoordinates: [number, number][] = [];
  let baseLayerMode: BaseLayerMode = 'naip-hillshade';
  let hillshadeOpacity = 0.38;
  let rasterPmtilesUrl = '';
  let builderRoadName = '';
  let builderRideId = NEW_RIDE_VALUE;
  let newRideName = '';
  let notification = '';
  let importInput: HTMLInputElement;

  $: selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? null;
  $: selectedRide = selectedSegment?.rideId ? rides.find((ride) => ride.id === selectedSegment.rideId) ?? null : null;
  $: mappingActive = activeSession?.activity === 'mapping';

  async function refresh(): Promise<void> {
    rides = await db.rides.orderBy('name').toArray();
    segments = await db.segments.toArray();
    structures = await db.structures.toArray();
    if (builderRideId !== NEW_RIDE_VALUE && !rides.some((ride) => ride.id === builderRideId)) {
      builderRideId = rides[0]?.id ?? NEW_RIDE_VALUE;
    }
  }

  onMount(async () => {
    await ensureSeedData();
    rasterPmtilesUrl = await getSetting('rasterPmtilesUrl');
    baseLayerMode = (await getSetting('baseLayerMode', 'naip-hillshade')) as BaseLayerMode;
    const savedOpacity = Number(await getSetting('hillshadeOpacity', '0.38'));
    hillshadeOpacity = Number.isFinite(savedOpacity) ? Math.max(0, Math.min(1, savedOpacity)) : 0.38;
    await refresh();
    builderRideId = rides[0]?.id ?? NEW_RIDE_VALUE;
  });

  onDestroy(() => stopGps());

  function showNotification(message: string): void {
    notification = message;
    window.setTimeout(() => {
      if (notification === message) notification = '';
    }, 5000);
  }

  function distanceMeters(a: [number, number], b: [number, number]): number {
    const radians = Math.PI / 180;
    const lat1 = a[1] * radians;
    const lat2 = b[1] * radians;
    const deltaLat = (b[1] - a[1]) * radians;
    const deltaLon = (b[0] - a[0]) * radians;
    const sinLat = Math.sin(deltaLat / 2);
    const sinLon = Math.sin(deltaLon / 2);
    const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function cleanDrivenCoordinates(points: TrackPoint[]): [number, number][] {
    const accuracyFiltered = points.filter(
      (point) => point.accuracy === undefined || point.accuracy <= MAX_BUILDER_ACCURACY_METERS
    );
    const source = accuracyFiltered.length >= 2 ? accuracyFiltered : points;
    const cleaned: [number, number][] = [];

    for (const point of source) {
      const coordinate: [number, number] = [point.longitude, point.latitude];
      const previous = cleaned.at(-1);
      if (!previous || distanceMeters(previous, coordinate) >= MIN_BUILDER_POINT_SPACING_METERS) {
        cleaned.push(coordinate);
      }
    }

    const finalPoint = source.at(-1);
    if (finalPoint && cleaned.length > 0) {
      const finalCoordinate: [number, number] = [finalPoint.longitude, finalPoint.latitude];
      if (distanceMeters(cleaned.at(-1)!, finalCoordinate) > 0.25) cleaned.push(finalCoordinate);
    }

    return cleaned;
  }

  async function updateTravelStatus(status: TravelStatus): Promise<void> {
    if (!selectedSegment) return;
    await db.segments.update(selectedSegment.id, {
      travelStatus: status,
      lastVerifiedAt: status === 'verified' ? new Date().toISOString() : selectedSegment.lastVerifiedAt,
      verifiedEquipment:
        status === 'verified'
          ? Array.from(new Set([...selectedSegment.verifiedEquipment, equipment]))
          : selectedSegment.verifiedEquipment
    });
    await refresh();
  }

  async function updateMowStatus(status: MowStatus): Promise<void> {
    if (!selectedSegment) return;
    await db.segments.update(selectedSegment.id, { mowStatus: status });
    await refresh();
  }

  async function persistTrackPoint(fix: PositionFix): Promise<void> {
    const session = activeSession;
    if (!session) return;
    const trackPoint: TrackPoint = { ...fix, sessionId: session.id };
    await db.trackPoints.add(trackPoint);
    activePointCount += 1;
    activeTrackCoordinates = [...activeTrackCoordinates, [fix.longitude, fix.latitude]];
  }

  function startGps(): void {
    if (!('geolocation' in navigator)) {
      gpsMessage = 'This device does not expose location services.';
      return;
    }
    stopGps();
    locationMode = 'live';
    gpsMessage = 'Waiting for GPS fix…';
    gpsWatchId = navigator.geolocation.watchPosition(
      (result) => {
        const fix: PositionFix = {
          longitude: result.coords.longitude,
          latitude: result.coords.latitude,
          accuracy: result.coords.accuracy,
          altitude: result.coords.altitude,
          heading: result.coords.heading,
          speed: result.coords.speed,
          timestamp: result.timestamp,
          source: 'gps'
        };
        position = fix;
        gpsMessage = `GPS ±${Math.round(result.coords.accuracy * 3.28084)} ft`;
        void persistTrackPoint(fix);
      },
      (error) => {
        gpsMessage = error.message;
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  function stopGps(): void {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    if (locationMode === 'live') locationMode = 'none';
    gpsMessage = 'Location inactive';
  }

  function beginManualPlacement(): void {
    if (activeSession) {
      showNotification('Finish the active recording before switching to manual position.');
      return;
    }
    stopGps();
    locationMode = 'manual';
    gpsMessage = 'Click the map to set a working position.';
  }

  function setManualPosition(longitude: number, latitude: number): void {
    position = { longitude, latitude, timestamp: Date.now(), source: 'manual' };
    gpsMessage = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }

  function clearPosition(): void {
    if (activeSession) {
      showNotification('Finish the active recording before clearing GPS.');
      return;
    }
    stopGps();
    locationMode = 'none';
    position = null;
  }

  async function startRecording(activity: Exclude<Activity, 'mapping'>): Promise<void> {
    if (locationMode !== 'live' || position?.source !== 'gps') {
      showNotification('Start live GPS and wait for a fix before recording a field track.');
      return;
    }
    if (activeSession) return;
    activeSession = {
      id: crypto.randomUUID(),
      activity,
      equipment,
      startedAt: new Date().toISOString()
    };
    activePointCount = 0;
    activeTrackCoordinates = [];
    await db.trackSessions.add(activeSession);
    await persistTrackPoint(position);
  }

  async function resolveBuilderRide(): Promise<Ride | null> {
    if (builderRideId !== NEW_RIDE_VALUE) {
      return rides.find((ride) => ride.id === builderRideId) ?? null;
    }

    const name = newRideName.trim();
    if (!name) return null;
    const existing = rides.find((ride) => ride.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      builderRideId = existing.id;
      return existing;
    }

    const now = new Date().toISOString();
    const ride: Ride = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now
    };
    await db.rides.add(ride);
    rides = [...rides, ride].sort((a, b) => a.name.localeCompare(b.name));
    builderRideId = ride.id;
    newRideName = '';
    return ride;
  }

  async function startMapBuilder(): Promise<void> {
    if (locationMode !== 'live' || position?.source !== 'gps') {
      showNotification('Start live GPS and wait for a fix before building a road.');
      return;
    }
    if (activeSession) return;

    const roadName = builderRoadName.trim();
    if (!roadName) {
      showNotification('Enter a road name before starting map builder.');
      return;
    }

    const ride = await resolveBuilderRide();
    if (!ride) {
      showNotification('Select a Ride or enter a new Ride name.');
      return;
    }

    activeSession = {
      id: crypto.randomUUID(),
      activity: 'mapping',
      equipment,
      startedAt: new Date().toISOString(),
      name: roadName,
      rideId: ride.id
    };
    activePointCount = 0;
    activeTrackCoordinates = [];
    await db.trackSessions.add(activeSession);
    await persistTrackPoint(position);
    showNotification(`Building ${roadName} for Ride ${ride.name}.`);
  }

  async function saveMappedRoad(session: TrackSession): Promise<boolean> {
    const points = await db.trackPoints.where('sessionId').equals(session.id).sortBy('timestamp');
    const coordinates = cleanDrivenCoordinates(points);
    if (coordinates.length < 2) return false;

    const roadId = `road-${crypto.randomUUID()}`;
    const mappedAt = new Date().toISOString();
    const segment: ProjectSegment = {
      id: roadId,
      name: session.name ?? 'Driven access road',
      systemId: session.rideId ?? 'unassigned-ride',
      featureType: 'access-road',
      fromNodeId: `${roadId}-start`,
      toNodeId: `${roadId}-end`,
      side: 'center',
      travelStatus: 'verified',
      verifiedEquipment: [session.equipment],
      mowStatus: 'unmowed',
      lastVerifiedAt: mappedAt,
      notes: `Permanently mapped by driving. Raw evidence track: ${session.id}.`,
      geometry: { type: 'LineString', coordinates },
      rideId: session.rideId,
      sourceTrackSessionId: session.id,
      captureMethod: 'driven'
    };

    await db.segments.add(segment);
    selectedSegmentId = segment.id;
    await refresh();
    return true;
  }

  async function stopRecording(): Promise<void> {
    const session = activeSession;
    if (!session) return;

    const endedAt = new Date().toISOString();
    await db.trackSessions.update(session.id, { endedAt });

    let savedRoad = false;
    if (session.activity === 'mapping') savedRoad = await saveMappedRoad(session);

    const pointCount = activePointCount;
    activeSession = null;
    activePointCount = 0;
    activeTrackCoordinates = [];

    if (session.activity === 'mapping') {
      showNotification(
        savedRoad
          ? `Permanent road saved from ${pointCount} GPS points.`
          : `Track saved, but no road was created because it had fewer than two usable points.`
      );
    } else {
      showNotification(`Saved ${pointCount} GPS points.`);
    }
  }

  async function saveLayerSettings(): Promise<void> {
    await Promise.all([
      putSetting('baseLayerMode', baseLayerMode),
      putSetting('hillshadeOpacity', hillshadeOpacity.toString()),
      putSetting('rasterPmtilesUrl', rasterPmtilesUrl.trim())
    ]);
  }

  async function handleImport(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      await restoreBackup(file);
      await refresh();
      showNotification('Project backup restored.');
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Backup import failed.');
    } finally {
      importInput.value = '';
    }
  }
</script>

<svelte:head>
  <meta name="theme-color" content="#102b1f" />
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <div>
      <strong>BFID Mapping</strong>
      <span class="subtitle">Local-first field access and mowing map</span>
    </div>
    <div class:recording={Boolean(activeSession)} class="status-pill">
      {activeSession
        ? `${activeSession.activity.toUpperCase()} · ${activePointCount} points`
        : gpsMessage}
    </div>
  </header>

  <aside class="sidebar">
    <section>
      <h2>Position</h2>
      <div class="button-grid">
        <button class:active={locationMode === 'live'} onclick={startGps}>Live GPS</button>
        <button class:active={locationMode === 'manual'} onclick={beginManualPlacement}>Set manually</button>
        <button onclick={clearPosition}>Clear</button>
      </div>
      <p class="hint">The app remains usable when location permission is denied or no GPS hardware exists.</p>
    </section>

    <section>
      <h2>Map layers</h2>
      <label>
        Reference layer
        <select bind:value={baseLayerMode} onchange={() => void saveLayerSettings()}>
          <option value="naip-hillshade">NAIP aerial + 3DEP hillshade</option>
          <option value="naip">NAIP aerial</option>
          <option value="hillshade">3DEP multidirectional hillshade</option>
          <option value="slope">3DEP slope</option>
          <option value="custom">Custom offline PMTiles</option>
          <option value="none">No reference layer</option>
        </select>
      </label>
      {#if baseLayerMode === 'naip-hillshade'}
        <label>
          Hillshade overlay {Math.round(hillshadeOpacity * 100)}%
          <input
            class="range-input"
            type="range"
            min="0"
            max="0.8"
            step="0.05"
            bind:value={hillshadeOpacity}
            onchange={() => void saveLayerSettings()}
          />
        </label>
      {/if}
      {#if baseLayerMode === 'custom'}
        <label>
          Raster PMTiles URL or packaged path
          <input bind:value={rasterPmtilesUrl} placeholder="/maps/aerial.pmtiles" />
        </label>
        <button class="wide" onclick={() => void saveLayerSettings()}>Apply offline map path</button>
      {/if}
      <p class="hint">NAIP and 3DEP cover the district online. A packaged offline district map remains a separate download.</p>
    </section>

    <section class:mapping-section={mappingActive}>
      <h2>Map builder</h2>
      {#if mappingActive}
        <div class="builder-active">
          <strong>{activeSession?.name}</strong>
          <span>{activePointCount} raw GPS points</span>
          <span>The yellow line is the road being built.</span>
        </div>
        <button class="danger wide" onclick={() => void stopRecording()}>Finish and save permanent road</button>
      {:else}
        <label>
          Road name
          <input bind:value={builderRoadName} placeholder="North Canal bank road" />
        </label>
        <label>
          Assign to Ride
          <select bind:value={builderRideId}>
            {#each rides as ride}
              <option value={ride.id}>{ride.name}</option>
            {/each}
            <option value={NEW_RIDE_VALUE}>Create new Ride…</option>
          </select>
        </label>
        {#if builderRideId === NEW_RIDE_VALUE}
          <label>
            New Ride name
            <input bind:value={newRideName} placeholder="North Canal west ride" />
          </label>
        {/if}
        <button class="builder-button wide" disabled={Boolean(activeSession)} onclick={() => void startMapBuilder()}>
          Start building road
        </button>
      {/if}
      <p class="hint">Map builder preserves the raw GPS track, filters poor and duplicate points, and creates a permanent verified access road when stopped.</p>
    </section>

    <section>
      <h2>Field recording</h2>
      <label>
        Equipment
        <select bind:value={equipment} disabled={Boolean(activeSession)}>
          <option value="mower">Mower</option>
          <option value="atv">ATV</option>
          <option value="pickup">Pickup</option>
          <option value="tractor">Tractor</option>
        </select>
      </label>
      {#if activeSession && !mappingActive}
        <button class="danger wide" onclick={() => void stopRecording()}>Stop and save track</button>
      {:else if !activeSession}
        <div class="button-grid two">
          <button onclick={() => void startRecording('travel')}>Record travel</button>
          <button onclick={() => void startRecording('mowing')}>Record mowing</button>
        </div>
      {/if}
    </section>

    <section>
      <h2>Selected segment</h2>
      {#if selectedSegment}
        <div class="segment-card">
          <strong>{selectedSegment.name}</strong>
          <code>{selectedSegment.id}</code>
          <span>{selectedSegment.featureType} · {selectedSegment.side}</span>
          {#if selectedRide}<span>Ride: {selectedRide.name}</span>{/if}
          {#if selectedSegment.captureMethod}<span>Source: {selectedSegment.captureMethod}</span>{/if}
          {#if selectedSegment.demo}<span class="demo-warning">Demonstration geometry</span>{/if}
        </div>
        <label>
          Travel state
          <select value={selectedSegment.travelStatus} onchange={(event) => void updateTravelStatus(event.currentTarget.value as TravelStatus)}>
            <option value="unknown">Unknown</option>
            <option value="visually-likely">Visually likely</option>
            <option value="verified">Verified</option>
            <option value="blocked">Blocked</option>
            <option value="seasonal">Seasonal</option>
            <option value="foot-only">Foot only</option>
          </select>
        </label>
        <label>
          Mowing state
          <select value={selectedSegment.mowStatus} onchange={(event) => void updateMowStatus(event.currentTarget.value as MowStatus)}>
            <option value="unmowed">Unmowed</option>
            <option value="partial">Partial</option>
            <option value="mowed">Mowed</option>
            <option value="needs-return">Needs return</option>
            <option value="skipped">Skipped</option>
          </select>
        </label>
        <p class="notes">{selectedSegment.notes ?? 'No notes.'}</p>
      {:else}
        <p class="hint">Select a colored project segment on the map.</p>
      {/if}
    </section>

    <section>
      <h2>Portable data</h2>
      <div class="button-grid two">
        <button onclick={() => void downloadBackup()}>Export backup</button>
        <button onclick={() => importInput.click()}>Import backup</button>
      </div>
      <input
        class="hidden-input"
        type="file"
        accept="application/json,.json"
        bind:this={importInput}
        onchange={(event) => void handleImport(event.currentTarget.files?.[0])}
      />
    </section>
  </aside>

  <main class="map-panel">
    <MapView
      {segments}
      {structures}
      {selectedSegmentId}
      {position}
      {baseLayerMode}
      {hillshadeOpacity}
      {rasterPmtilesUrl}
      builderTrackCoordinates={activeTrackCoordinates}
      manualPlacement={locationMode === 'manual'}
      on:selectSegment={(event) => (selectedSegmentId = event.detail.id)}
      on:manualPosition={(event) => setManualPosition(event.detail.longitude, event.detail.latitude)}
    />
    <div class="legend">
      <span><i class="verified"></i>Verified</span>
      <span><i class="unknown"></i>Unknown</span>
      <span><i class="blocked"></i>Blocked</span>
      <span><i class="likely"></i>Likely</span>
      {#if mappingActive}<span><i class="building"></i>Building</span>{/if}
    </div>
    {#if notification}<div class="notification">{notification}</div>{/if}
  </main>
</div>
