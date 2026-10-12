import type { SensorBoardState, SensorSnapshot } from '@kenshiki/identity-capture';

export function sensorBoardFixture(): SensorBoardState {
  return {
    fusion: { airCheck: { state: 'idle' }, continuity: { state: 'idle' }, receipt: null },
    reading: null,
    mediaOutput: null,
    collection: { collectedAt: null, failure: null, paused: false, sequence: 0 },
    permissions: {
      motion: 'notRequested',
      bluetooth: 'notRequested',
      location: 'notRequested',
      always: false,
      precise: false,
    },
    windows: { motion: 1.5, magnetometer: 1.5, barometer: 1.5, sharedMotion: 1.5 },
    units: 'system',
    systemUsesImperial: false,
    location: {
      fix: null,
      trail: [],
      estimateID: null,
      answeredAt: null,
      deliveredCount: 0,
      permissionAtDelivery: null,
      precisionAtDelivery: null,
      failure: null,
    },
    weather: {
      state: 'notConfigured',
      readAt: null,
      observedAt: null,
      pressureKPa: null,
      temperatureC: null,
      humidityPercent: null,
      stationName: null,
      stationID: null,
      distanceMeters: null,
      stationElevationMeters: null,
      quality: null,
      source: null,
      failure: null,
      details: [],
    },
    evidence: { count: 0, failure: null, exportURL: null, receipt: null },
    storage: { trackers: [], eraseResults: [], erasedAt: null },
    environment: {
      defaultsSuiteName: 'test.sensors',
      directoryURL: 'file:///test/sensors',
      applicationIdentifier: 'test.app',
      unconfiguredDefaultsSuiteName: null,
      unconfiguredDirectoryURL: 'file:///test/defaults',
      unconfiguredApplicationIdentifier: 'test.app',
    },
    batteryProvider: { reads: 0, monitoringEnables: 0 },
  };
}

/** Complete sensor snapshot with explicit absent observations and a few numeric sentinels. */
export function sensorSnapshotFixture(): SensorSnapshot {
  const missing = { status: 'not_collected' } as const;
  return {
    startedAt: '',
    endedAt: '',
    durationMilliseconds: 0,
    battery: { support: { status: 'available' }, level: 0 },
    motion: { support: missing, sampleCount: 0 },
    magnetometer: { support: missing, sampleCount: 0 },
    barometer: { support: { status: 'available' }, pressureKilopascals: 100 },
    connectivity: {
      support: missing,
      interfaceTypes: [],
      availableInterfaceTypes: [],
      perInterfacePathStatuses: {},
    },
    bluetooth: { support: missing },
    deviceSurface: { support: missing, platform: 'ios', systemName: 'iOS', simulator: false },
    telephony: { support: { status: 'available' }, radioGenerations: [], activeCallCount: 0 },
  };
}
