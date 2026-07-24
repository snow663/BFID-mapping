import Dexie, { type EntityTable } from 'dexie';
import type { ProjectSegment, Ride, StructurePoint, TrackPoint, TrackSession } from './types';

export interface SettingRecord {
  key: string;
  value: string;
}

class BFIDDatabase extends Dexie {
  rides!: EntityTable<Ride, 'id'>;
  segments!: EntityTable<ProjectSegment, 'id'>;
  structures!: EntityTable<StructurePoint, 'id'>;
  trackSessions!: EntityTable<TrackSession, 'id'>;
  trackPoints!: EntityTable<TrackPoint, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor() {
    super('bfid-mapping');
    this.version(1).stores({
      segments: '&id, systemId, featureType, travelStatus, mowStatus',
      structures: '&id, structureType',
      trackSessions: '&id, activity, equipment, startedAt',
      trackPoints: '++id, sessionId, timestamp',
      settings: '&key'
    });
    this.version(2).stores({
      rides: '&id, name, createdAt, updatedAt',
      segments: '&id, systemId, rideId, featureType, travelStatus, mowStatus',
      structures: '&id, structureType',
      trackSessions: '&id, activity, equipment, rideId, startedAt',
      trackPoints: '++id, sessionId, timestamp',
      settings: '&key'
    });
  }
}

export const db = new BFIDDatabase();

/**
 * Earlier scaffold builds inserted fictional geometry into IndexedDB.
 * Remove only records explicitly marked as demo; preserve driven roads,
 * imported project data, raw tracks, Rides, and user settings.
 */
export async function ensureSeedData(): Promise<void> {
  await db.transaction('rw', [db.segments, db.structures], async () => {
    await Promise.all([
      db.segments.filter((segment) => segment.demo === true).delete(),
      db.structures.filter((structure) => structure.demo === true).delete()
    ]);
  });
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  return (await db.settings.get(key))?.value ?? fallback;
}

export async function putSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}
