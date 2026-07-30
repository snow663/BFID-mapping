import { db, getSetting, putSetting } from './db';
import type { MowStatus, PositionFix } from './types';

const TRACK_EVENT = 'bfid:mowing-track';
const TRACK_STATE_KEY = '__bfidMowingTrackState';
const WORK_ITEMS_KEY = 'mowingWorkItems';

export type MowingOutcome = 'completed' | 'needs-return' | 'partial';
export type MowingWorkStatus = 'open' | 'needs-return' | 'completed';

export type MowingEquipmentProfile = {
  id: string;
  name: string;
  machine: string;
  cuttingWidthFeet: number | null;
  notes: string;
};

export type MowingSettings = {
  selectedEquipmentId: string;
  equipmentProfiles: MowingEquipmentProfile[];
  followUpDays: number;
  sessionNotes: string;
};

export const DEFAULT_MOWING_SETTINGS: MowingSettings = {
  selectedEquipmentId: 'primary-mower',
  equipmentProfiles: [{
    id: 'primary-mower',
    name: 'Primary mower',
    machine: 'District mowing machine',
    cuttingWidthFeet: null,
    notes: ''
  }],
  followUpDays: 30,
  sessionNotes: ''
};

export type MowingWorkItem = {
  id: string;
  label: string;
  segmentId?: string;
  segmentName?: string;
  anchor: { longitude: number; latitude: number };
  createdAt: string;
  updatedAt: string;
  status: MowingWorkStatus;
  sessionIds: string[];
  completedAt?: string;
  nextReturnAt?: string;
  followUpAt?: string;
  followUpAcknowledgedAt?: string;
  lastEquipmentName?: string;
};

export type MowingSessionRecord = {
  id: string;
  activity: 'mowing';
  equipment: string;
  startedAt: string;
  endedAt?: string;
  workItemId: string;
  sequence: number;
  segmentId?: string;
  segmentName?: string;
  equipmentProfileId?: string;
  equipmentProfileName?: string;
  equipmentProfile?: MowingEquipmentProfile;
  workNotes?: string;
  outcome?: MowingOutcome;
};

export type MowingSessionState = {
  active: boolean;
  session: MowingSessionRecord | null;
  workItem: MowingWorkItem | null;
  position: PositionFix | null;
  pointCount: number;
  coordinates: [number, number][];
};

export type RecentMowingSession = MowingSessionRecord & {
  durationMinutes: number;
  pointCount: number;
};

export type MowingReminder = {
  workItem: MowingWorkItem;
  kind: 'return' | 'follow-up';
  dueAt: string;
};

let state: MowingSessionState = {
  active: false,
  session: null,
  workItem: null,
  position: null,
  pointCount: 0,
  coordinates: []
};
let watchId: number | null = null;
let settings: MowingSettings | null = null;
let listener: ((state: MowingSessionState) => void) | null = null;
let stopping = false;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeEquipmentProfile(value: Partial<MowingEquipmentProfile>, index: number): MowingEquipmentProfile {
  const width = Number(value.cuttingWidthFeet);
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `mower-${index + 1}`,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : `Mower ${index + 1}`,
    machine: typeof value.machine === 'string' ? value.machine : '',
    cuttingWidthFeet: Number.isFinite(width) && width > 0 ? width : null,
    notes: typeof value.notes === 'string' ? value.notes : ''
  };
}

export function normalizeMowingSettings(value: Partial<MowingSettings> = {}): MowingSettings {
  const profiles = Array.isArray(value.equipmentProfiles) && value.equipmentProfiles.length
    ? value.equipmentProfiles.map(normalizeEquipmentProfile)
    : DEFAULT_MOWING_SETTINGS.equipmentProfiles.map((profile) => ({ ...profile }));
  const selectedEquipmentId = profiles.some((profile) => profile.id === value.selectedEquipmentId)
    ? value.selectedEquipmentId!
    : profiles[0].id;
  return {
    selectedEquipmentId,
    equipmentProfiles: profiles,
    followUpDays: clamp(Math.round(Number(value.followUpDays) || DEFAULT_MOWING_SETTINGS.followUpDays), 1, 365),
    sessionNotes: typeof value.sessionNotes === 'string' ? value.sessionNotes : ''
  };
}

export function selectedMowingEquipment(value: MowingSettings): MowingEquipmentProfile {
  return value.equipmentProfiles.find((profile) => profile.id === value.selectedEquipmentId) ?? value.equipmentProfiles[0];
}

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

function getFix(): Promise<PositionFix> {
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

function workLabel(segmentName: string | null, fix: PositionFix): string {
  if (segmentName?.trim()) return segmentName.trim();
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date());
  return `Mowing site ${date} · ${fix.latitude.toFixed(4)}, ${fix.longitude.toFixed(4)}`;
}

function normalizeWorkItem(value: Partial<MowingWorkItem>): MowingWorkItem | null {
  if (!value.id || !value.anchor || typeof value.anchor.longitude !== 'number' || typeof value.anchor.latitude !== 'number') return null;
  const createdAt = value.createdAt || new Date().toISOString();
  return {
    id: value.id,
    label: value.label || 'Mowing work item',
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
    lastEquipmentName: value.lastEquipmentName
  };
}

export async function loadMowingWorkItems(): Promise<MowingWorkItem[]> {
  try {
    const raw = await getSetting(WORK_ITEMS_KEY, '[]');
    const parsed = JSON.parse(raw) as Array<Partial<MowingWorkItem>>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeWorkItem).filter((item): item is MowingWorkItem => Boolean(item));
  } catch {
    return [];
  }
}

async function saveMowingWorkItems(items: MowingWorkItem[]): Promise<void> {
  await putSetting(WORK_ITEMS_KEY, JSON.stringify(items));
}

async function updateWorkItem(item: MowingWorkItem): Promise<void> {
  const items = await loadMowingWorkItems();
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) items[index] = item;
  else items.push(item);
  await saveMowingWorkItems(items);
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

async function savePoint(position: PositionFix): Promise<void> {
  if (!state.session) return;
  await db.trackPoints.add({ ...position, sessionId: state.session.id });
  state = {
    ...state,
    position,
    pointCount: state.pointCount + 1,
    coordinates: [...state.coordinates, [position.longitude, position.latitude]]
  };
  publish();
}

export async function startMowingSession(
  nextSettings: MowingSettings,
  segmentId: string | null,
  segmentName: string | null,
  appendWorkItemId: string | null,
  onChange: (state: MowingSessionState) => void
): Promise<MowingSessionState> {
  if (state.active) return state;
  settings = normalizeMowingSettings(nextSettings);
  listener = onChange;
  const firstFix = await getFix();
  const equipmentProfile = selectedMowingEquipment(settings);
  const items = await loadMowingWorkItems();
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

  const session: MowingSessionRecord = {
    id: crypto.randomUUID(),
    activity: 'mowing',
    equipment: equipmentProfile.name,
    startedAt: now,
    workItemId: workItem.id,
    sequence: workItem.sessionIds.length + 1,
    segmentId: segmentId || workItem.segmentId,
    segmentName: segmentName || workItem.segmentName,
    equipmentProfileId: equipmentProfile.id,
    equipmentProfileName: equipmentProfile.name,
    equipmentProfile: { ...equipmentProfile },
    workNotes: settings.sessionNotes || undefined
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
    lastEquipmentName: equipmentProfile.name
  };

  await db.trackSessions.add(session as any);
  await updateWorkItem(workItem);
  state = {
    active: true,
    session,
    workItem,
    position: firstFix,
    pointCount: 0,
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

  publish();
  return state;
}

export async function stopMowingSession(outcome: MowingOutcome): Promise<MowingSessionState> {
  if (!state.session || !state.workItem || stopping) return state;
  stopping = true;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;

  const endedAt = new Date().toISOString();
  await db.trackSessions.update(state.session.id, { endedAt, outcome } as any);

  const followUpDays = settings?.followUpDays ?? 30;
  const workItem: MowingWorkItem = {
    ...state.workItem,
    updatedAt: endedAt,
    status: outcome === 'completed' ? 'completed' : outcome === 'needs-return' ? 'needs-return' : 'open',
    completedAt: outcome === 'completed' ? endedAt : state.workItem.completedAt,
    nextReturnAt: outcome === 'needs-return' ? tomorrowAtWorkStart(new Date(endedAt)) : undefined,
    followUpAt: outcome === 'completed' ? daysAfter(endedAt, followUpDays) : undefined,
    followUpAcknowledgedAt: undefined
  };
  await updateWorkItem(workItem);

  if (state.session.segmentId) {
    const mowStatus: MowStatus = outcome === 'completed' ? 'mowed' : outcome === 'needs-return' ? 'needs-return' : 'partial';
    await db.segments.update(state.session.segmentId, { mowStatus });
  }

  state = {
    active: false,
    session: null,
    workItem: null,
    position: state.position,
    pointCount: 0,
    coordinates: []
  };
  stopping = false;
  publish();
  listener = null;
  settings = null;
  return state;
}

export function getMowingSessionState(): MowingSessionState {
  return { ...state, coordinates: [...state.coordinates] };
}

export async function getRecentMowingSessions(limit = 12): Promise<RecentMowingSession[]> {
  const sessions = (
    await db.trackSessions.where('activity').equals('mowing').toArray() as unknown as MowingSessionRecord[]
  )
    .filter((session) => Boolean(session.workItemId))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);
  return Promise.all(sessions.map(async (session) => {
    const pointCount = await db.trackPoints.where('sessionId').equals(session.id).count();
    const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
    const durationMinutes = Math.max(0, Math.round((end - new Date(session.startedAt).getTime()) / 60000));
    return { ...session, pointCount, durationMinutes };
  }));
}

export async function getDueMowingReminders(now = new Date()): Promise<MowingReminder[]> {
  const time = now.getTime();
  const reminders: MowingReminder[] = [];
  for (const item of await loadMowingWorkItems()) {
    if (item.status === 'needs-return' && item.nextReturnAt && new Date(item.nextReturnAt).getTime() <= time) {
      reminders.push({ workItem: item, kind: 'return', dueAt: item.nextReturnAt });
    }
    if (item.status === 'completed' && item.followUpAt && new Date(item.followUpAt).getTime() <= time) {
      reminders.push({ workItem: item, kind: 'follow-up', dueAt: item.followUpAt });
    }
  }
  return reminders.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
}

export async function acknowledgeMowingFollowUp(workItemId: string, followUpDays = 30): Promise<void> {
  const items = await loadMowingWorkItems();
  const index = items.findIndex((item) => item.id === workItemId);
  if (index < 0) return;
  const now = new Date().toISOString();
  items[index] = {
    ...items[index],
    updatedAt: now,
    followUpAcknowledgedAt: now,
    followUpAt: daysAfter(now, followUpDays)
  };
  await saveMowingWorkItems(items);
}

export async function getSegmentMowingStatus(segmentId: string): Promise<MowStatus> {
  const segment = await db.segments.get(segmentId);
  return segment?.mowStatus ?? 'unmowed';
}

export async function setSegmentMowingStatus(segmentId: string, status: MowStatus): Promise<void> {
  await db.segments.update(segmentId, { mowStatus: status });
}
