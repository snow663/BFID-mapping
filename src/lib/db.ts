import Dexie, { type EntityTable } from 'dexie';
import { demoSegments, demoStructures } from './demo';
import type { ProjectSegment, StructurePoint, TrackPoint, TrackSession } from './types';

export interface SettingRecord {
  key: string;
  value: string;
}

class BFIDDatabase extends Dexie {
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
  }
}

export const db = new BFIDDatabase();

export async function ensureSeedData(): Promise<void> {
  if ((await db.segments.count()) === 0) {
    await db.transaction('rw', db.segments, db.structures, async () => {
      await db.segments.bulkPut(demoSegments);
      await db.structures.bulkPut(demoStructures);
    });
  }
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  return (await db.settings.get(key))?.value ?? fallback;
}

export async function putSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}
