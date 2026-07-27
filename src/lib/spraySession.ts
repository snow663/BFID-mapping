import { db } from './db';
import { chooseSprayStation, fetchStationWeather, type SnapshotReason, type SprayPosition, type SpraySettings, type WeatherSnapshot } from './sprayWeather';

const WEATHER_INTERVAL_MS = 15 * 60 * 1000;

export type SprayStatus = 'unsprayed' | 'partial' | 'sprayed' | 'needs-return' | 'skipped';

export type SpraySessionRecord = {
  id: string;
  activity: 'spraying';
  equipment: string;
  startedAt: string;
  endedAt?: string;
  segmentId?: string;
  productName?: string;
  applicationNotes?: string;
  weatherStationMode?: string;
  weatherSnapshots?: WeatherSnapshot[];
};

export type SpraySessionState = {
  active: boolean;
  session: SpraySessionRecord | null;
  position: SprayPosition | null;
  pointCount: number;
  weatherCount: number;
};

export type RecentSpraySession = SpraySessionRecord & {
  durationMinutes: number;
  pointCount: number;
};

let state: SpraySessionState = { active: false, session: null, position: null, pointCount: 0, weatherCount: 0 };
let watchId: number | null = null;
let weatherTimer: number | null = null;
let settings: SpraySettings | null = null;
let listener: ((state: SpraySessionState) => void) | null = null;
let stopping = false;

function publish(): void {
  listener?.({ ...state });
}

function getFix(): Promise<SprayPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device does not expose location services.'));
    navigator.geolocation.getCurrentPosition(
      (result) => resolve({
        longitude: result.coords.longitude,
        latitude: result.coords.latitude,
        accuracy: result.coords.accuracy,
        altitude: result.coords.altitude,
        heading: result.coords.heading,
        speed: result.coords.speed,
        timestamp: result.timestamp,
        source: 'gps'
      }),
      reject,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  });
}

async function savePoint(position: SprayPosition): Promise<void> {
  if (!state.session) return;
  await db.trackPoints.add({ ...position, sessionId: state.session.id } as any);
  state = { ...state, position, pointCount: state.pointCount + 1 };
  publish();
}

async function appendWeather(snapshot: WeatherSnapshot): Promise<void> {
  if (!state.session) return;
  const stored = await db.trackSessions.get(state.session.id) as unknown as SpraySessionRecord | undefined;
  const weatherSnapshots = [...(stored?.weatherSnapshots ?? []), snapshot];
  await db.trackSessions.update(state.session.id, { weatherSnapshots } as any);
  state = {
    ...state,
    weatherCount: weatherSnapshots.length,
    session: { ...state.session, weatherSnapshots }
  };
  publish();
}

export async function captureSprayWeather(reason: SnapshotReason): Promise<WeatherSnapshot> {
  if (!state.session || !settings) throw new Error('No spraying session is active.');
  const station = chooseSprayStation(settings.stationMode, state.position);
  const snapshot = await fetchStationWeather(station, reason, state.position);
  await appendWeather(snapshot);
  return snapshot;
}

export async function startSpraySession(
  nextSettings: SpraySettings,
  segmentId: string | null,
  onChange: (state: SpraySessionState) => void
): Promise<SpraySessionState> {
  if (state.active) return state;
  settings = nextSettings;
  listener = onChange;
  const firstFix = await getFix();
  const session: SpraySessionRecord = {
    id: crypto.randomUUID(),
    activity: 'spraying',
    equipment: nextSettings.sprayEquipment,
    startedAt: new Date().toISOString(),
    segmentId: segmentId ?? undefined,
    productName: nextSettings.productName || undefined,
    applicationNotes: nextSettings.applicationNotes || undefined,
    weatherStationMode: nextSettings.stationMode,
    weatherSnapshots: []
  };
  await db.trackSessions.add(session as any);
  state = { active: true, session, position: firstFix, pointCount: 0, weatherCount: 0 };
  await savePoint(firstFix);

  watchId = navigator.geolocation.watchPosition(
    (result) => void savePoint({
      longitude: result.coords.longitude,
      latitude: result.coords.latitude,
      accuracy: result.coords.accuracy,
      altitude: result.coords.altitude,
      heading: result.coords.heading,
      speed: result.coords.speed,
      timestamp: result.timestamp,
      source: 'gps'
    }),
    () => publish(),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );

  try { await captureSprayWeather('start'); } catch { /* GPS record continues offline */ }
  weatherTimer = window.setInterval(() => void captureSprayWeather('interval').catch(() => undefined), WEATHER_INTERVAL_MS);
  publish();
  return state;
}

export async function stopSpraySession(): Promise<SpraySessionState> {
  if (!state.session || stopping) return state;
  stopping = true;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (weatherTimer !== null) window.clearInterval(weatherTimer);
  watchId = null;
  weatherTimer = null;
  try { await captureSprayWeather('end'); } catch { /* preserve session without end weather */ }
  await db.trackSessions.update(state.session.id, { endedAt: new Date().toISOString() } as any);
  state = { active: false, session: null, position: state.position, pointCount: 0, weatherCount: 0 };
  stopping = false;
  publish();
  listener = null;
  settings = null;
  return state;
}

export function getSpraySessionState(): SpraySessionState {
  return { ...state };
}

export async function getRecentSpraySessions(limit = 5): Promise<RecentSpraySession[]> {
  const sessions = (await db.trackSessions.where('activity').equals('spraying').toArray() as unknown as SpraySessionRecord[])
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);
  return Promise.all(sessions.map(async (session) => {
    const pointCount = await db.trackPoints.where('sessionId').equals(session.id).count();
    const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
    const durationMinutes = Math.max(0, Math.round((end - new Date(session.startedAt).getTime()) / 60000));
    return { ...session, pointCount, durationMinutes };
  }));
}

export async function getSegmentSprayStatus(segmentId: string): Promise<SprayStatus> {
  const segment = await db.segments.get(segmentId) as any;
  return (segment?.sprayStatus as SprayStatus | undefined) ?? 'unsprayed';
}

export async function setSegmentSprayStatus(segmentId: string, status: SprayStatus): Promise<void> {
  await db.segments.update(segmentId, { sprayStatus: status } as any);
}
