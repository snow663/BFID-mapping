<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import MapView from './lib/components/MapView.svelte';
  import { downloadBackup, restoreBackup } from './lib/backup';
  import { db, ensureSeedData, getSetting, putSetting } from './lib/db';
  import type {
    Activity,
    Equipment,
    LocationMode,
    MowStatus,
    PositionFix,
    ProjectSegment,
    StructurePoint,
    TrackPoint,
    TrackSession,
    TravelStatus
  } from './lib/types';

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
  let rasterPmtilesUrl = '';
  let notification = '';
  let importInput: HTMLInputElement;

  $: selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? null;

  async function refresh(): Promise<void> {
    segments = await db.segments.toArray();
    structures = await db.structures.toArray();
  }

  onMount(async () => {
    await ensureSeedData();
    rasterPmtilesUrl = await getSetting('rasterPmtilesUrl');
    await refresh();
  });

  onDestroy(() => stopGps());

  function showNotification(message: string): void {
    notification = message;
    window.setTimeout(() => {
      if (notification === message) notification = '';
    }, 4000);
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
    if (!activeSession) return;
    const trackPoint: TrackPoint = { ...fix, sessionId: activeSession.id };
    await db.trackPoints.add(trackPoint);
    activePointCount += 1;
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
        position = {
          longitude: result.coords.longitude,
          latitude: result.coords.latitude,
          accuracy: result.coords.accuracy,
          altitude: result.coords.altitude,
          heading: result.coords.heading,
          speed: result.coords.speed,
          timestamp: result.timestamp,
          source: 'gps'
        };
        gpsMessage = `GPS ±${Math.round(result.coords.accuracy * 3.28084)} ft`;
        void persistTrackPoint(position);
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
    stopGps();
    locationMode = 'manual';
    gpsMessage = 'Click the map to set a working position.';
  }

  function setManualPosition(longitude: number, latitude: number): void {
    position = { longitude, latitude, timestamp: Date.now(), source: 'manual' };
    gpsMessage = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }

  function clearPosition(): void {
    stopGps();
    locationMode = 'none';
    position = null;
  }

  async function startRecording(activity: Activity): Promise<void> {
    if (locationMode !== 'live') {
      showNotification('Start live GPS before recording a field track.');
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
    await db.trackSessions.add(activeSession);
  }

  async function stopRecording(): Promise<void> {
    if (!activeSession) return;
    const endedAt = new Date().toISOString();
    await db.trackSessions.update(activeSession.id, { endedAt });
    showNotification(`Saved ${activePointCount} GPS points.`);
    activeSession = null;
    activePointCount = 0;
  }

  async function saveBasemap(): Promise<void> {
    await putSetting('rasterPmtilesUrl', rasterPmtilesUrl.trim());
    showNotification(rasterPmtilesUrl.trim() ? 'Offline raster PMTiles path saved.' : 'Basemap path cleared.');
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
      {activeSession ? `${activeSession.activity.toUpperCase()} · ${activePointCount} points` : gpsMessage}
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
      <h2>Field recording</h2>
      <label>
        Equipment
        <select bind:value={equipment}>
          <option value="mower">Mower</option>
          <option value="atv">ATV</option>
          <option value="pickup">Pickup</option>
          <option value="tractor">Tractor</option>
        </select>
      </label>
      {#if activeSession}
        <button class="danger wide" onclick={() => void stopRecording()}>Stop and save track</button>
      {:else}
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
      <h2>Offline raster map</h2>
      <label>
        Raster PMTiles URL or packaged path
        <input bind:value={rasterPmtilesUrl} placeholder="/maps/aerial.pmtiles" />
      </label>
      <button class="wide" onclick={() => void saveBasemap()}>Apply map path</button>
      <p class="hint">The initial repository does not include large aerial or LiDAR files.</p>
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
      {rasterPmtilesUrl}
      manualPlacement={locationMode === 'manual'}
      on:selectSegment={(event) => (selectedSegmentId = event.detail.id)}
      on:manualPosition={(event) => setManualPosition(event.detail.longitude, event.detail.latitude)}
    />
    <div class="legend">
      <span><i class="verified"></i>Verified</span>
      <span><i class="unknown"></i>Unknown</span>
      <span><i class="blocked"></i>Blocked</span>
      <span><i class="likely"></i>Likely</span>
    </div>
    {#if notification}<div class="notification">{notification}</div>{/if}
  </main>
</div>
