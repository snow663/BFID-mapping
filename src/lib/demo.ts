import type { ProjectSegment, StructurePoint } from './types';

export const demoSegments: ProjectSegment[] = [
  {
    id: 'DEMO-NC-001-L',
    name: 'Demo North Canal — left bank',
    systemId: 'DEMO-NORTH-CANAL',
    featureType: 'canal',
    fromNodeId: 'DEMO-BOX-1',
    toNodeId: 'DEMO-BOX-2',
    side: 'left',
    travelStatus: 'verified',
    verifiedEquipment: ['mower', 'atv'],
    mowStatus: 'mowed',
    lastVerifiedAt: '2026-07-22T12:00:00.000Z',
    notes: 'Demonstration geometry only. Replace with district linework.',
    demo: true,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-103.4245, 44.7154],
        [-103.4188, 44.7172],
        [-103.4122, 44.7161]
      ]
    }
  },
  {
    id: 'DEMO-NC-002-L',
    name: 'Demo North Canal — left bank',
    systemId: 'DEMO-NORTH-CANAL',
    featureType: 'canal',
    fromNodeId: 'DEMO-BOX-2',
    toNodeId: 'DEMO-BOX-3',
    side: 'left',
    travelStatus: 'unknown',
    verifiedEquipment: [],
    mowStatus: 'unmowed',
    notes: 'Demonstration geometry only.',
    demo: true,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-103.4122, 44.7161],
        [-103.4055, 44.7134],
        [-103.3993, 44.7142]
      ]
    }
  },
  {
    id: 'DEMO-LAT-001',
    name: 'Demo pipeline lateral',
    systemId: 'DEMO-LATERAL-1',
    featureType: 'pipeline',
    fromNodeId: 'DEMO-BOX-2',
    toNodeId: 'DEMO-BOX-4',
    side: 'buried',
    travelStatus: 'visually-likely',
    verifiedEquipment: ['atv'],
    mowStatus: 'partial',
    notes: 'Demonstration geometry only.',
    demo: true,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-103.4122, 44.7161],
        [-103.4092, 44.7088],
        [-103.4058, 44.7035]
      ]
    }
  },
  {
    id: 'DEMO-DRAIN-001',
    name: 'Demo drain access',
    systemId: 'DEMO-DRAIN-1',
    featureType: 'drain',
    fromNodeId: 'DEMO-BOX-4',
    toNodeId: 'DEMO-DRAIN-END',
    side: 'right',
    travelStatus: 'blocked',
    verifiedEquipment: [],
    mowStatus: 'needs-return',
    notes: 'Demo obstruction near downstream crossing.',
    demo: true,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-103.4058, 44.7035],
        [-103.3986, 44.7002],
        [-103.3918, 44.6987]
      ]
    }
  }
];

export const demoStructures: StructurePoint[] = [
  {
    id: 'DEMO-BOX-1',
    name: 'Demo Box 1',
    structureType: 'box',
    coordinates: [-103.4245, 44.7154],
    demo: true
  },
  {
    id: 'DEMO-BOX-2',
    name: 'Demo Box 2 / check',
    structureType: 'check',
    coordinates: [-103.4122, 44.7161],
    demo: true
  },
  {
    id: 'DEMO-DROP-1',
    name: 'Demo mower drop-in',
    structureType: 'drop-in',
    coordinates: [-103.4067, 44.7094],
    notes: 'Demonstration point only.',
    demo: true
  }
];
