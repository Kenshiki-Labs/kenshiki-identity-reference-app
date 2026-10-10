import { IdentitySensorSymbol, type SensorBoardState } from '@kenshiki/identity-capture';
import { createContext, type ReactElement, type ReactNode, useContext } from 'react';
import { PixelRatio, View } from 'react-native';
import { t } from './locales/i18n';
import {
  copy,
  type MeasureKind,
  measure,
  moment,
  plain,
  prefix,
  type SensorPage,
  sensorConfig,
  swiftColor,
} from './SensorPresentation';
import { ListSection, TextRow, ValueRow } from './ui/List';

/** Whether this screen heads its sections with SensorHost's icon tiles, and the session that
 * draws them. A tab's root uses tiles; a pushed page, whose own title names its subject, does not. */
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
/** SensorHost's tile for a section, scaled with the text beside it, as `PageSectionHeader` does. */
function SectionIcon({ section }: Readonly<{ section: string }>) {
  const { sessionId, enabled } = useContext(SensorIconContext);
  const icon = icons[iconSections[section] ?? ''];
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
        backgroundColor: swiftColor(icon.color),
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

/** One of SensorHost's sections, as its SwiftUI List draws it: the tile and the title above the
 * cells, the rows inside, and the explanation in the footer. `section` is the copy prefix, such as
 * `export` or `motion`; the title and the footer are SensorHost's own words for it. A section with
 * `heading={false}` has no header, as a sensor's page shows its own section under its title. */
export function Section({
  section,
  heading = true,
  footer,
  children,
}: Readonly<{
  section: string;
  heading?: boolean;
  footer?: string | undefined;
  children: ReactNode;
}>) {
  const fromCopy = copy(`${section}.footer`, '');
  return (
    <ListSection
      header={heading ? copy(`${section}.header`) : undefined}
      headerIcon={<SectionIcon section={section} />}
      footer={footer ?? (fromCopy || undefined)}
    >
      {children}
    </ListSection>
  );
}

/** A label and its value. */
export function Row({ label, value }: Readonly<{ label: string; value: unknown }>) {
  return <ValueRow label={label} value={plain(value)} />;
}

/** Explanatory words inside a section; nothing at all when there are none. */
export function note(text: string | null | undefined, key?: string): ReactElement | null {
  return text ? <TextRow key={key ?? text} text={text} /> : null;
}

/** A warning inside a section, such as a failure the SDK reported by code. */
export function warning(text: string | null | undefined, key?: string): ReactElement | null {
  return text ? <TextRow key={key ?? text} text={text} tone="warning" alert /> : null;
}

type Field = [label: string, property: string, unit?: MeasureKind | 'time' | 'presence'];
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
    ['field', 'fieldMagnitudeMicrotesla', 'magneticField'],
    ['calibration', 'calibrationAccuracy'],
  ],
  motion: [
    ['userAcceleration', 'userAccelerationMagnitude', 'acceleration'],
    ['rotationRate', 'rotationRateMagnitude', 'rotationRate'],
    ['gravity', 'gravityMagnitude', 'acceleration'],
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
    ['batteryLevel', 'level', 'fraction'],
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
function fieldValue(value: unknown, unit: Field[2], board: SensorBoardState): string {
  if (unit === 'time') return moment(typeof value === 'string' ? value : null);
  if (unit === 'presence') return value ? copy('connectivity.value.present') : copy('common.none');
  if (unit === 'fraction')
    return typeof value === 'number' ? measure(value, unit, board) : copy('common.none');
  if (unit && typeof value === 'number') return measure(value, unit, board);
  return plain(value);
}

/** One sensor's rows, in SensorHost's order: what it says now, its status and the line under it,
 * its samples, then each value. One element per row. */
export function signalRows(board: SensorBoardState, page: SensorPage): ReactElement[] {
  const source = signal(board, page);
  if (!source) return [<TextRow key="waiting" text={t('sensors.waitingForReading')} />];
  const nowFields: Partial<Record<SensorPage, Field>> = {
    thermalAndPower: ['batteryLevel', 'level', 'fraction'],
    callActivity: ['activeCalls', 'activeCallCount'],
    deviceSurface: ['system', 'systemName'],
  };
  const first = nowFields[page] ?? (fields[page] ?? [])[0];
  const rows: (ReactElement | null)[] = [
    first ? (
      <Row key="now" label={copy('sensorGroup.now')} value={fieldValue(source[first[1]], first[2], board)} />
    ) : null,
    ...supportRows(source.support, board, page),
    'sampleCount' in source ? (
      <Row key="samples" label={copy('common.row.samples')} value={source.sampleCount} />
    ) : null,
    ...(fields[page] ?? []).map(([label, property, unit]) => (
      <Row
        key={property}
        label={copy(`${prefix(page)}.row.${label}`, label)}
        value={fieldValue(source[property], unit, board)}
      />
    )),
  ];
  return rows.filter((row): row is ReactElement => row !== null);
}

function supportRows(support: unknown, board: SensorBoardState, page: SensorPage): (ReactElement | null)[] {
  if (typeof support !== 'object' || support === null || !('status' in support)) return [];
  const status = String(support.status);
  const key = status.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  let hint = copy(`supportStatus.explanation.${key}`, '');
  if (key === 'notCollected' && page === 'magnetometer') hint = copy('supportStatus.hint.compassCalibration');
  if (key === 'notCollected' && page === 'barometer') {
    const permission = board.permissions.motion;
    const hints: Record<string, string> = { notRequested: 'motionNotAsked', refused: 'motionOff' };
    hint = copy(`supportStatus.hint.${hints[permission] ?? 'barometerSlow'}`);
  }
  return [
    <Row
      key="status"
      label={copy('common.row.status')}
      value={copy(`supportStatus.${key}`, plain(status))}
    />,
    note(hint, 'statusHint'),
  ];
}
