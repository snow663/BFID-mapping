import { db } from './db';
import type { AppBackup, ProjectSegment, Ride, StructurePoint, TrackPoint, TrackSession } from './types';

type LegacyBackup = {
  schemaVersion?: number;
  exportedAt?: string;
  rides?: Ride[];
  segments?: ProjectSegment[];
  structures?: StructurePoint[];
  trackSessions?: TrackSession[];
  trackPoints?: TrackPoint[];
  settings?: Array<{ key: string; value: string }>;
};

export async function createBackup(): Promise<AppBackup> {
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    rides: await db.rides.toArray(),
    segments: await db.segments.toArray(),
    structures: await db.structures.toArray(),
    trackSessions: await db.trackSessions.toArray(),
    trackPoints: await db.trackPoints.toArray(),
    settings: await db.settings.toArray()
  };
}

export async function downloadBackup(): Promise<void> {
  const backup = await createBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `bfid-mapping-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function restoreBackup(file: File): Promise<void> {
  const candidate = JSON.parse(await file.text()) as LegacyBackup;
  if (![1, 2].includes(candidate.schemaVersion ?? 0) || !Array.isArray(candidate.segments)) {
    throw new Error('This is not a supported BFID Mapping backup.');
  }

  await db.transaction(
    'rw',
    db.rides,
    db.segments,
    db.structures,
    db.trackSessions,
    db.trackPoints,
    db.settings,
    async () => {
      await Promise.all([
        db.rides.clear(),
        db.segments.clear(),
        db.structures.clear(),
        db.trackSessions.clear(),
        db.trackPoints.clear(),
        db.settings.clear()
      ]);
      await db.rides.bulkPut(candidate.rides ?? []);
      await db.segments.bulkPut(candidate.segments ?? []);
      await db.structures.bulkPut(candidate.structures ?? []);
      await db.trackSessions.bulkPut(candidate.trackSessions ?? []);
      await db.trackPoints.bulkPut(candidate.trackPoints ?? []);
      await db.settings.bulkPut(candidate.settings ?? []);
    }
  );
}
