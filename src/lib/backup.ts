import { db } from './db';
import type { AppBackup } from './types';

export async function createBackup(): Promise<AppBackup> {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
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
  const candidate = JSON.parse(await file.text()) as Partial<AppBackup>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.segments)) {
    throw new Error('This is not a supported BFID Mapping backup.');
  }

  await db.transaction(
    'rw',
    db.segments,
    db.structures,
    db.trackSessions,
    db.trackPoints,
    db.settings,
    async () => {
      await Promise.all([
        db.segments.clear(),
        db.structures.clear(),
        db.trackSessions.clear(),
        db.trackPoints.clear(),
        db.settings.clear()
      ]);
      await db.segments.bulkPut(candidate.segments ?? []);
      await db.structures.bulkPut(candidate.structures ?? []);
      await db.trackSessions.bulkPut(candidate.trackSessions ?? []);
      await db.trackPoints.bulkPut(candidate.trackPoints ?? []);
      await db.settings.bulkPut(candidate.settings ?? []);
    }
  );
}
