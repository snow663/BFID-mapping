import { db } from './db';
import type { TrackPoint, TrackSession } from './types';

export type RouteCoordinate = [number, number];

export const MAX_COMPACT_HISTORY = 8;

export function haversineMiles(a: RouteCoordinate, b: RouteCoordinate): number {
  const radians = Math.PI / 180;
  const lat1 = a[1] * radians;
  const lat2 = b[1] * radians;
  const deltaLat = (b[1] - a[1]) * radians;
  const deltaLon = (b[0] - a[0]) * radians;
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return (6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))) / 1609.344;
}

export function cleanRoute(points: TrackPoint[], minimumSpacingFeet = 6): RouteCoordinate[] {
  const maximumAccuracyFeet = 100;
  const useful = points.filter((point) => point.accuracy === undefined || point.accuracy * 3.28084 <= maximumAccuracyFeet);
  const source = useful.length >= 2 ? useful : points;
  const coordinates: RouteCoordinate[] = [];
  const spacingMiles = minimumSpacingFeet / 5280;

  for (const point of source) {
    const coordinate: RouteCoordinate = [point.longitude, point.latitude];
    const previous = coordinates.at(-1);
    if (!previous || haversineMiles(previous, coordinate) >= spacingMiles) coordinates.push(coordinate);
  }

  const final = source.at(-1);
  if (final && coordinates.length) {
    const coordinate: RouteCoordinate = [final.longitude, final.latitude];
    if (haversineMiles(coordinates.at(-1)!, coordinate) > 0.25 / 5280) coordinates.push(coordinate);
  }

  return coordinates;
}

export function routeLengthMiles(coordinates: RouteCoordinate[]): number {
  let distance = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    distance += haversineMiles(coordinates[index - 1], coordinates[index]);
  }
  return distance;
}

export function completedDistanceMiles(
  outcome: 'completed' | 'needs-return' | 'partial',
  canonicalMiles: number,
  temporaryMiles: number
): number {
  if (outcome === 'completed' && canonicalMiles > 0) return canonicalMiles;
  if (canonicalMiles > 0) return Math.min(canonicalMiles, Math.max(0, temporaryMiles));
  return Math.max(0, temporaryMiles);
}

export async function discardSessionTrack(sessionId: string): Promise<void> {
  await db.trackPoints.where('sessionId').equals(sessionId).delete();
}

export async function retainRecentSessions(sessionIds: string[], limit = MAX_COMPACT_HISTORY): Promise<string[]> {
  const sessions = (await db.trackSessions.bulkGet(sessionIds))
    .filter((session): session is TrackSession => Boolean(session));
  const keep = sessions
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit)
    .map((session) => session.id);
  const keepSet = new Set(keep);

  for (const sessionId of sessionIds) {
    if (keepSet.has(sessionId)) continue;
    await discardSessionTrack(sessionId);
    await db.trackSessions.delete(sessionId);
  }

  return sessionIds.filter((sessionId) => keepSet.has(sessionId));
}
