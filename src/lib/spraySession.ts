import { db, getSetting, putSetting } from './db';
import {
  chooseSprayStation,
  fetchStationWeather,
  selectedRig,
  type SnapshotReason,
  type SprayPosition,
  type SprayRigProfile,
  type SpraySettings,
  type WeatherSnapshot
} from './sprayWeather';

const TRACK_EVENT = 'bfid:spray-track';
const TRACK_STATE_KEY = '__bfidSprayTrackState';
const WORK_ITEMS_KEY = 'sprayWorkItems';

export type SprayStatus = 'unsprayed' | 'partial' | 'sprayed' | 'needs-return' | 'skipped';
export type SprayOutcome = 'completed' | 'needs-return' | 'partial';
export type SprayWorkStatus = 'open' | 'needs-return' | 'completed';

export type SprayWorkItem = {
  id: string;
  label: string;
  segmentId?: string;
  segmentName?: string;
  anchor: { longitude: number; latitude: number };
  createdAt: string;
  updatedAt: string;
  status: SprayWorkStatus;
  sessionIds: string[];
  completedAt?: string;
  nextReturnAt?: string;
  followUpAt?: string;
  followUpAcknowledgedAt?: string;
  lastProductName?: string;
  lastRigProfileName?: string;
};

export type SpraySessionRecord = {
  id: string;
  activity: 'spraying';
  equipment: string;
  startedAt: string;
  endedAt?: string;
  workItemId: string;
  sequence: number;
  segmentId?: string;
  segmentName?: string;
  productName?: string;
  applicationNotes?: string;
  weatherStationMode?: string;
  rigProfileId?: string;
  rigProfileName?: string;
  rigProfile?: SprayRigProfile;
  outcome?: SprayOutcome;
  weatherSnapshots?: WeatherSnapshot[];
  startWeather?: WeatherSnapshot;
  endWeather?: WeatherSnapshot;
};

export type SpraySessionState = {
  active: boolean;
  session: SpraySessionRecord | null;
  workItem: SprayWorkItem | null;
  position: SprayPosition | null;
  pointCount: number;
  weatherCount: number;
  coordinates: [number, number][];
};

export type RecentSpraySession = SpraySessionRecord & {
  durationMinutes: number;
  pointCount: number;
};

export type SprayReminder = {
  workItem: SprayWorkItem;
  kind: 'return' | 'follow-up';
  dueAt: string;
};

let state: SpraySessionState = {
  active: false,
  session: null,
  workItem: null,
  position: null,
  pointCount: 0,
  weatherCount: 0,
  coordinates: []
};
let watchId: number | null = null;
let settings: SpraySettings | null = null;
let listener: ((state: SpraySessionState) => void) | null = null;
let stopping = false;

function publish(): void {
  const snapshot = { ...state, coordinates: [...state.coordinates] };
  listener?.(snapshot);
  (window as unknown as Record<string, unknown>)[TRACK_STATE_KEY] = {
    active: state.active,
    coordinates: [...state.coordinates]
  };
  window.dispatchEvent(new CustomEvent(TRACK_EVENT, {
    detail: { active: state.active, coordinates: [...state.coordinates] }
  }));
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

function workLabel(segmentName: string | null, fix: SprayPosition): string {
  if (segmentName?.trim()) return segmentName.trim();
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date());
  return `Spray site ${date} · ${fix.latitude.toFixed(4)}, ${fix.longitude.toFixed(4)}`;
}

function normalizeWorkItem(value: Partial<SprayWorkItem>): SprayWorkItem | null {
  if (!value.id || !value.anchor || typeof value.anchor.longitude !== 'number' || typeof value.anchor.latitude !== 'number') return null;
  const createdAt = value.createdAt || new Date().toISOString();
  return {
    id: value.id,
    label: value.label || 'Spray work item',
    segmentId: value.segmentId,
    segmentName: value.segmentName,
    anchor: value.anchor,
    createdAt,
    updatedAt: value.updatedAt || createdAt,
    status: value.status === 'needs-return' || value.status === 'completed' ? value.status : 'open',
    sessionIds: Array.isArray(value.sessionIds) ? value.sessionIds.filter((id): id is string => typeof id === 'string') : [],
    completedAt: value.completedAt,
    nextReturnAt: value.nextReturnAt,
    followUpAt: value.followUpAt,
    followUpAcknowledgedAt: value.followUpAcknowledgedAt,
    lastProductName: value.lastProductName,
    lastRigProfileName: value.lastRigProfileName
  };
}

export async function loadSprayWorkItems(): Promise<SprayWorkItem[]> {
  try {
    const raw = await getSetting(WORK_ITEMS_KEY, '[]');
    const parsed = JSON.parse(raw) as Array<Partial<SprayWorkItem>>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeWorkItem).filter((item): item is SprayWorkItem => Boolean(item));
  } catch {
    return [];
  }
}

async function saveSprayWorkItems(items: SprayWorkItem[]): Promise<void> {
  await putSetting(WORK_ITEMS_KEY, JSON.stringify(items));
}

async function updateWorkItem(item: SprayWorkItem): Promise<void> {
  const items = await loadSprayWorkItems();
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) items[index] = item;
  else items.push(item);
  await saveSprayWorkItems(items);
}

function tomorrowAtWorkStart(now = new Date()): string {
  const due = new Date(now);
  due.setDate(due.getDate() + 1);
  due.setHours(6, 30, 0, 0);
  return due.toISOString();
}

function daysAfter(value: string, days: number): string {
  const due = new Date(value);
  due.setDate(due.getDate() + Math.max(1, days));
  due.setHours(6, 30, 0, 0);
  return due.toISOString();
}

async function savePoint(position: SprayPosition): Promise<void> {
  if (!state.session) return;
  await db.trackPoints.add({ ...position, sessionId: state.session.id } as any);
  state = {
    ...state,
    position,
    pointCount: state.pointCount + 1,
    coordinates: [...state.coordinates, [position.longitude, position.latitude]]
  };
  publish();
}

async function appendWeather(snapshot: WeatherSnapshot): Promise<void> {
  if (!state.session) return;
  const stored = await db.trackSessions.get(state.session.id) as unknown as SpraySessionRecord | undefined;
  const weatherSnapshots = [...(stored?.weatherSnapshots ?? []), snapshot];
  const weatherFields = snapshot.reason === 'start'
    ? { startWeather: snapshot }
    : snapshot.reason === 'end'
      ? { endWeather: snapshot }
      : {};
  await db.trackSessions.update(state.session.id, { weatherSnapshots, ...weatherFields } as any);
  state = {
    ...state,
    weatherCount: weatherSnapshots.length,
    session: { ...state.session, weatherSnapshots, ...weatherFields }
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
  segmentName: string | null,
  appendWorkItemId: string | null,
  onChange: (state: SpraySessionState) => void
): Promise<SpraySessionState> {
  if (state.active) return state;
  settings = nextSettings;
  listener = onChange;
  const firstFix = await getFix();
  const rig = selectedRig(nextSettings);
  const items = await loadSprayWorkItems();
  let workItem = appendWorkItemId ? items.find((item) => item.id === appendWorkItemId) ?? null : null;
  const now = new Date().toISOString();

  if (!workItem) {
    workItem = {
      id: crypto.randomUUID(),
      label: workLabel(segmentName, firstFix),
      segmentId: segmentId || undefined,
      segmentName: segmentName || undefined,
      anchor: { longitude: firstFix.longitude, latitude: firstFix.latitude },
      createdAt: now,
      updatedAt: now,
      status: 'open',
      sessionIds: []
    };
  }

  const session: SpraySessionRecord = {
    id: crypto.randomUUID(),
    activity: 'spraying',
    equipment: rig.name,
    startedAt: now,
    workItemId: workItem.id,
    sequence: workItem.sessionIds.length + 1,
    segmentId: segmentId || workItem.segmentId,
    segmentName: segmentName || workItem.segmentName,
    productName: nextSettings.productName || undefined,
    applicationNotes: nextSettings.applicationNotes || undefined,
    weatherStationMode: nextSettings.stationMode,
    rigProfileId: rig.id,
    rigProfileName: rig.name,
    rigProfile: { ...rig },
    weatherSnapshots: []
  };

  workItem = {
    ...workItem,
    segmentId: session.segmentId,
    segmentName: session.segmentName,
    updatedAt: now,
    status: 'open',
    nextReturnAt: undefined,
    followUpAt: undefined,
    sessionIds: [...workItem.sessionIds, session.id],
    lastProductName: session.productName,
    lastRigProfileName: rig.name
  };

  await db.trackSessions.add(session as any);
  await updateWorkItem(workItem);
  state = {
    active: true,
    session,
    workItem,
    position: firstFix,
    pointCount: 0,
    weatherCount: 0,
    coordinates: []
  };
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

  try { await captureSprayWeather('start'); } catch { /* GPS record remains useful if weather is unavailable */ }
  publish();
  return state;
}

export async function stopSpraySession(outcome: SprayOutcome): Promise<SpraySessionState> {
  if (!state.session || !state.workItem || stopping) return state;
  stopping = true;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  try { await captureSprayWeather('end'); } catch { /* preserve session if end weather is unavailable */ }

  const endedAt = new Date().toISOString();
  await db.trackSessions.update(state.session.id, { endedAt, outcome } as any);

  const followUpDays = settings?.followUpDays ?? 30;
  const workItem: SprayWorkItem = {
    ...state.workItem,
    updatedAt: endedAt,
    status: outcome === 'completed' ? 'completed' : outcome === 'needs-return' ? 'needs-return' : 'open',
    completedAt: outcome === 'completed' ? endedAt : state.workItem.completedAt,
    nextReturnAt: outcome === 'needs-return' ? tomorrowAtWorkStart(new Date(endedAt)) : undefined,
    followUpAt: outcome === 'completed' ? daysAfter(endedAt, followUpDays) : undefined,
    followUpAcknowledgedAt: undefined
  };
  await updateWorkItem(workItem);

  const segmentId = state.session.segmentId;
  if (segmentId) {
    const status: SprayStatus = outcome === 'completed' ? 'sprayed' : outcome === 'needs-return' ? 'needs-return' : 'partial';
    await db.segments.update(segmentId, { sprayStatus: status } as any);
  }

  state = {
    active: false,
    session: null,
    workItem: null,
    position: state.position,
    pointCount: 0,
    weatherCount: 0,
    coordinates: []
  };
  stopping = false;
  publish();
  listener = null;
  settings = null;
  return state;
}

export function getSpraySessionState(): SpraySessionState {
  return { ...state, coordinates: [...state.coordinates] };
}

export async function getRecentSpraySessions(limit = 12): Promise<RecentSpraySession[]> {
  const sessions = (
    await db.trackSessions.where('activity').equals('spraying').toArray() as unknown as SpraySessionRecord[]
  )
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);
  return Promise.all(sessions.map(async (session) => {
    const pointCount = await db.trackPoints.where('sessionId').equals(session.id).count();
    const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
    const durationMinutes = Math.max(0, Math.round((end - new Date(session.startedAt).getTime()) / 60000));
    return { ...session, pointCount, durationMinutes };
  }));
}

export async function getDueSprayReminders(now = new Date()): Promise<SprayReminder[]> {
  const time = now.getTime();
  const reminders: SprayReminder[] = [];
  for (const item of await loadSprayWorkItems()) {
    if (item.status === 'needs-return' && item.nextReturnAt && new Date(item.nextReturnAt).getTime() <= time) {
      reminders.push({ workItem: item, kind: 'return', dueAt: item.nextReturnAt });
    }
    if (item.status === 'completed' && item.followUpAt && new Date(item.followUpAt).getTime() <= time) {
      reminders.push({ workItem: item, kind: 'follow-up', dueAt: item.followUpAt });
    }
  }
  return reminders.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
}

export async function acknowledgeSprayFollowUp(workItemId: string, followUpDays = 30): Promise<void> {
  const items = await loadSprayWorkItems();
  const index = items.findIndex((item) => item.id === workItemId);
  if (index < 0) return;
  const now = new Date().toISOString();
  items[index] = {
    ...items[index],
    updatedAt: now,
    followUpAcknowledgedAt: now,
    followUpAt: daysAfter(now, followUpDays)
  };
  await saveSprayWorkItems(items);
}

export async function getSegmentSprayStatus(segmentId: string): Promise<SprayStatus> {
  const segment = await db.segments.get(segmentId) as any;
  return (segment?.sprayStatus as SprayStatus | undefined) ?? 'unsprayed';
}

export async function setSegmentSprayStatus(segmentId: string, status: SprayStatus): Promise<void> {
  await db.segments.update(segmentId, { sprayStatus: status } as any);
}
