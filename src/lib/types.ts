import type { LineString } from 'geojson';

export type TravelStatus =
  | 'unknown'
  | 'visually-likely'
  | 'verified'
  | 'blocked'
  | 'seasonal'
  | 'foot-only';

export type MowStatus = 'unmowed' | 'partial' | 'mowed' | 'needs-return' | 'skipped';
export type Equipment = 'mower' | 'atv' | 'pickup' | 'tractor';
export type Activity = 'travel' | 'mowing';
export type LocationMode = 'none' | 'manual' | 'live';

export interface ProjectSegment {
  id: string;
  name: string;
  systemId: string;
  featureType: 'canal' | 'lateral' | 'pipeline' | 'drain' | 'access-road';
  fromNodeId: string;
  toNodeId: string;
  side: 'left' | 'right' | 'center' | 'buried';
  travelStatus: TravelStatus;
  verifiedEquipment: Equipment[];
  mowStatus: MowStatus;
  lastVerifiedAt?: string;
  notes?: string;
  geometry: LineString;
  demo?: boolean;
}

export interface StructurePoint {
  id: string;
  name: string;
  structureType: 'box' | 'check' | 'gate' | 'bridge' | 'crossing' | 'drop-in';
  coordinates: [number, number];
  notes?: string;
  demo?: boolean;
}

export interface PositionFix {
  longitude: number;
  latitude: number;
  accuracy?: number;
  altitude?: number | null;
  heading?: number | null;
  speed?: number | null;
  timestamp: number;
  source: 'gps' | 'manual';
}

export interface TrackSession {
  id: string;
  activity: Activity;
  equipment: Equipment;
  startedAt: string;
  endedAt?: string;
}

export interface TrackPoint extends PositionFix {
  id?: number;
  sessionId: string;
}

export interface AppBackup {
  schemaVersion: 1;
  exportedAt: string;
  segments: ProjectSegment[];
  structures: StructurePoint[];
  trackSessions: TrackSession[];
  trackPoints: TrackPoint[];
  settings: Array<{ key: string; value: string }>;
}
