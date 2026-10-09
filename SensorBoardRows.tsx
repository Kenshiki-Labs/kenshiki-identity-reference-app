import { IdentitySensorSymbol, type SensorBoardState } from '@kenshiki/identity-capture';
import { createContext, type ReactNode, useContext } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import { copy, measure, moment, plain, prefix, type SensorPage, sensorConfig } from './SensorPresentation';
export const boardStyles = StyleSheet.create({
  section: { backgroundColor: '#ffffff', borderRadius: 12, padding: 16, gap: 10, marginVertical: 8 },
  heading: { fontSize: 20, fontWeight: '600', color: '#161616' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, paddingVertical: 5 },
  label: { fontSize: 16, color: '#171717', flex: 1 },
  value: { fontSize: 16, color: '#60606a', textAlign: 'right', flex: 1, fontVariant: ['tabular-nums'] },
  note: { fontSize: 13, color: '#60606a', lineHeight: 19 },
  warning: { fontSize: 14, color: '#994700' },
  group: { fontSize: 23, fontWeight: '600', marginTop: 20, color: '#171717' },
});
export const SensorIconContext = createContext<{ sessionId: string | null; enabled: boolean }>({
  sessionId: null,
  enabled: false,
});
const iconSections: Record<string, string> = {
  collection: 'status',
  audioRoute: 'audioRoute',
  barometer: 'barometer',
  bluetooth: 'bluetooth',
  callActivity: 'calls',
  connectivity: 'network',
  deviceSurface: 'device',
  location: 'location',
  magnetometer: 'compass',
  motion: 'motion',
  telephony: 'mobileNetwork',
  power: 'power',
  weather: 'weather',
  export: 'export',
  units: 'units',
  permissions: 'permissions',
  captureWindows: 'readingTime',
  erase: 'erase',
  persisted: 'saved',
  environment: 'whereKept',
  batterySeam: 'batteryReader',
  gaps: 'limits',
};
const icons: Record<string, { symbol: string; color: string }> = sensorConfig.sections;
function SectionIcon({ title }: { title: string }) {
  const { sessionId, enabled } = useContext(SensorIconContext);
  const key = Object.keys(iconSections).find((key) => copy(`${key}.header`) === title);
  const icon = key ? icons[iconSections[key] ?? ''] : undefined;
  if (!enabled || !sessionId || !icon) return null;
  const scale = PixelRatio.getFontScale();
  const size = sensorConfig.sectionIcon.size * scale;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: sensorConfig.sectionIcon.cornerRadius * scale,
        backgroundColor: icon.color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <IdentitySensorSymbol
        sessionId={sessionId}
        name={icon.symbol}
        style={{
          width: sensorConfig.sectionIcon.glyphSize * scale,
          height: sensorConfig.sectionIcon.glyphSize * scale,
        }}
      />
    </View>
  );
}
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={boardStyles.section}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: sensorConfig.layout.headerIconSpacing }}
      >
        <SectionIcon title={title} />
        <Text accessibilityRole="header" style={boardStyles.heading}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}
export function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <View style={boardStyles.row}>
      <Text style={boardStyles.label}>{label}</Text>
      <Text style={boardStyles.value}>{plain(value)}</Text>
    </View>
  );
}
export function Note({ text }: { text: string }) {
  return text ? <Text style={boardStyles.note}>{text}</Text> : null;
}
type Field = [label: string, property: string, unit?: string];
const fields: Partial<Record<SensorPage, Field[]>> = {
  audioRoute: [
    ['routeClass', 'routeClass'],
    ['external', 'external'],
    ['otherAudioPlaying', 'otherAudioPlaying'],
    ['routeChanges', 'routeChangeCount'],
    ['externalRouteChanges', 'externalRouteChangeCount'],
  ],
  barometer: [
    ['pressure', 'pressureKilopascals', 'pressure'],
    ['relativeAltitude', 'relativeAltitudeMeters', 'distance'],
  ],
  bluetooth: [
    ['authorization', 'authorization'],
    ['radioState', 'radioState'],
    ['scanAvailable', 'scanAvailable'],
    ['audioRouteClass', 'audioRouteClass'],
    ['routeConnected', 'audioRouteConnected'],
    ['routeChanges', 'audioRouteChangeCount'],
  ],
  callActivity: [
    ['events', 'callEventCount'],
    ['lastEvent', 'lastCallEventAt', 'time'],
    ['activeCalls', 'activeCallCount'],
    ['connectedCalls', 'connectedCallCount'],
    ['heldCalls', 'heldCallCount'],
    ['observerStarted', 'callObserverStartedAt', 'time'],
  ],
  connectivity: [
    ['pathStatus', 'pathStatus'],
    ['unsatisfiedReason', 'unsatisfiedReason'],
    ['interfaces', 'interfaceTypes'],
    ['expensive', 'expensive'],
    ['constrained', 'constrained'],
    ['wifiName', 'wifiSSID'],
    ['wifiFamiliarity', 'wifiFamiliarity'],
    ['wifiToken', 'wifiNetworkHash', 'presence'],
  ],
  deviceSurface: [
    ['platform', 'platform'],
    ['system', 'systemName'],
    ['majorVersion', 'systemMajorVersion'],
    ['idiom', 'interfaceIdiom'],
    ['bundleIdentifier', 'bundleIdentifier'],
    ['simulator', 'simulator'],
  ],
  magnetometer: [
    ['field', 'fieldMagnitudeMicrotesla', 'µT'],
    ['calibration', 'calibrationAccuracy'],
  ],
  motion: [
    ['userAcceleration', 'userAccelerationMagnitude', 'g'],
    ['rotationRate', 'rotationRateMagnitude', 'rad/s'],
    ['gravity', 'gravityMagnitude', 'g'],
  ],
  telephony: [
    ['radioGenerations', 'radioGenerations'],
    ['radioVisibility', 'radioVisibility'],
    ['serviceCount', 'serviceCount'],
    ['simInserted', 'simInserted'],
    ['cellularData', 'cellularDataRestricted'],
    ['dataServiceVisible', 'dataServiceAvailable'],
    ['dataServiceChanges', 'dataServiceChangeCount'],
  ],
  thermalAndPower: [
    ['thermalState', 'thermalState'],
    ['batteryLevel', 'level', 'percent'],
    ['batteryState', 'state'],
    ['lowPowerMode', 'lowPowerModeEnabled'],
  ],
};
function signal(board: SensorBoardState, page: SensorPage): Record<string, unknown> | null {
  const reading = board.reading;
  if (page === 'audioRoute') return board.mediaOutput;
  if (!reading) return null;
  const sources: Partial<Record<SensorPage, Record<string, unknown>>> = {
    ...reading,
    thermalAndPower: reading.battery,
    callActivity: reading.telephony,
  };
  return sources[page] ?? null;
}
function fieldValue(value: unknown, unit: string | undefined, board: SensorBoardState): string {
  if (unit === 'time') return moment(typeof value === 'string' ? value : null);
  if (unit === 'presence') return value ? copy('connectivity.value.present', 'Made') : '—';
  if (unit === 'percent') return typeof value === 'number' ? `${plain(value * 100)} %` : '—';
  if (unit && typeof value === 'number') return measure(value, unit, board);
  return plain(value);
}
export function SignalRows({ board, page }: { board: SensorBoardState; page: SensorPage }) {
  const source = signal(board, page);
  if (!source) return <Note text="Waiting for a reading." />;
  const support = source.support;
  const nowFields: Partial<Record<SensorPage, Field>> = {
    thermalAndPower: ['batteryLevel', 'level', 'percent'],
    callActivity: ['activeCalls', 'activeCallCount'],
    deviceSurface: ['system', 'systemName'],
  };
  const first = nowFields[page] ?? (fields[page] ?? [])[0];
  return (
    <>
      {first && <Row label="Now" value={fieldValue(source[first[1]], first[2], board)} />}
      {typeof support === 'object' && support !== null && 'status' in support && (
        <SupportRows status={String(support.status)} board={board} page={page} />
      )}
      {'sampleCount' in source && (
        <Row label={copy('common.samples', 'Samples')} value={source.sampleCount} />
      )}
      {(fields[page] ?? []).map(([label, property, unit]) => (
        <Row
          key={property}
          label={copy(`${prefix(page)}.row.${label}`, label)}
          value={fieldValue(source[property], unit, board)}
        />
      ))}
    </>
  );
}

function SupportRows({ status, board, page }: { status: string; board: SensorBoardState; page: SensorPage }) {
  const key = status.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  let hint = copy(`supportStatus.explanation.${key}`, '');
  if (key === 'notCollected' && page === 'magnetometer') hint = copy('supportStatus.hint.compassCalibration');
  if (key === 'notCollected' && page === 'barometer') {
    const permission = board.permissions.motion;
    const hints: Record<string, string> = { notRequested: 'motionNotAsked', refused: 'motionOff' };
    hint = copy(`supportStatus.hint.${hints[permission] ?? 'barometerSlow'}`);
  }
  return (
    <>
      <Row label={copy('common.status', 'Status')} value={copy(`supportStatus.${key}`, plain(status))} />
      <Note text={hint} />
    </>
  );
}
