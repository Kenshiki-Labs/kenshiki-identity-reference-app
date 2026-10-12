import type { SensorBoardState } from '@kenshiki/identity-capture';
import type { ReactElement, ReactNode } from 'react';
import { t } from '../locales/i18n';
import {
  copy,
  type MeasureKind,
  measure,
  moment,
  plain,
  prefix,
  type SensorPage,
} from './SensorPresentation';
import { ListSection, TextRow, ValueRow } from '../ui/List';

/** Shared grouped section with a quiet heading and the catalog's explanatory footer. */
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

const enumCategories = {
  path: 'path',
  familiarity: 'wifi',
  radio: 'radio',
  cellular: 'cellular',
  battery: 'battery',
  thermal: 'thermal',
  bluetooth: 'bluetooth',
} as const;
type EnumFormat = keyof typeof enumCategories;
type Field = [
  label: string,
  property: string,
  unit?: MeasureKind | 'time' | 'presence' | 'verbatim' | 'generations' | EnumFormat,
];
function isEnumFormat(value: Field[2]): value is EnumFormat {
  return value !== undefined && value in enumCategories;
}

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
    ['radioState', 'radioState', 'bluetooth'],
    ['authorization', 'authorization', 'bluetooth'],
    ['audioRouteClass', 'audioRouteClass'],
    ['routeConnected', 'audioRouteConnected'],
    ['routeChanges', 'audioRouteChangeCount'],
  ],
  callActivity: [
    ['activeCalls', 'activeCallCount'],
    ['connectedCalls', 'connectedCallCount'],
    ['heldCalls', 'heldCallCount'],
    ['events', 'callEventCount'],
    ['lastEvent', 'lastCallEventAt', 'time'],
    ['observerStarted', 'callObserverStartedAt', 'time'],
  ],
  connectivity: [
    ['pathStatus', 'pathStatus', 'path'],
    ['unsatisfiedReason', 'unsatisfiedReason', 'path'],
    ['interfaces', 'interfaceTypes'],
    ['expensive', 'expensive'],
    ['constrained', 'constrained'],
    ['wifiName', 'wifiSSID', 'verbatim'],
    ['wifiFamiliarity', 'wifiFamiliarity', 'familiarity'],
    ['wifiToken', 'wifiNetworkHash', 'presence'],
  ],
  deviceSurface: [
    ['system', 'systemName', 'verbatim'],
    ['majorVersion', 'systemMajorVersion'],
    ['idiom', 'interfaceIdiom'],
    ['platform', 'platform', 'verbatim'],
    ['bundleIdentifier', 'bundleIdentifier', 'verbatim'],
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
    ['radioGenerations', 'radioGenerations', 'generations'],
    ['radioVisibility', 'radioVisibility', 'radio'],
    ['serviceCount', 'serviceCount'],
    ['cellularData', 'cellularDataRestricted', 'cellular'],
    ['dataServiceVisible', 'dataServiceAvailable'],
    ['dataServiceChanges', 'dataServiceChangeCount'],
    ['simInserted', 'simInserted'],
  ],
  thermalAndPower: [
    ['batteryLevel', 'level', 'fraction'],
    ['batteryState', 'state', 'battery'],
    ['lowPowerMode', 'lowPowerModeEnabled'],
    ['thermalState', 'thermalState', 'thermal'],
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
const textFormats = ['generations', 'verbatim', 'time', 'presence'] as const;
type TextFormat = (typeof textFormats)[number];
function isTextFormat(value: Field[2]): value is TextFormat {
  return textFormats.some((format) => format === value);
}

function fieldValue(value: unknown, unit: Field[2], board: SensorBoardState): string {
  if (unit === undefined) return plain(value);
  if (isEnumFormat(unit)) return enumValue(value, unit);
  if (isTextFormat(unit)) return textValue(value, unit);
  if (typeof value === 'number') return measure(value, unit, board);
  return unit === 'fraction' ? copy('common.none') : plain(value);
}

function textValue(value: unknown, format: TextFormat): string {
  switch (format) {
    case 'generations':
      return radioGenerations(value);
    case 'verbatim':
      return typeof value === 'string' && value ? value : copy('common.none');
    case 'time':
      return moment(typeof value === 'string' ? value : null);
    case 'presence':
      return value ? copy('connectivity.value.present') : copy('common.none');
  }
}

function enumValue(value: unknown, kind: EnumFormat): string {
  if (typeof value !== 'string' || !value) return copy('common.none');
  if (value === 'unknown') return copy('common.unknown');
  const key =
    value === 'hidden_by_ios'
      ? 'hiddenByIOS'
      : value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return copy(`sdkValue.${enumCategories[kind]}.${key}`, plain(value));
}

function radioGenerations(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return copy('common.none');
  return value
    .map((entry: unknown) =>
      typeof entry === 'string' && /^[2345]g$/i.test(entry) ? entry.toUpperCase() : plain(entry),
    )
    .join(t('common.listSeparator'));
}

/** A missing or unsupported reading must never look like an observed zero. */
export function signalSummary(board: SensorBoardState, page: SensorPage): string {
  const source = signal(board, page);
  if (!source) return t('sensors.waitingForReading');
  const support = source.support;
  if (
    typeof support === 'object' &&
    support !== null &&
    'status' in support &&
    support.status !== 'available'
  ) {
    const key = String(support.status).replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return copy(`supportStatus.${key}`, plain(support.status));
  }
  const first = fields[page]?.[0];
  if (!first) return copy('common.none');
  const value = source[first[1]];
  if (typeof value === 'number' && !Number.isFinite(value)) return copy('common.notValid');
  return t('common.labelAndStatus', {
    label: copy(`${prefix(page)}.row.${first[0]}`, first[0]),
    status: fieldValue(value, first[2], board),
  });
}

/** Observations appear once, before their support context. */
export function signalRows(board: SensorBoardState, page: SensorPage): ReactElement[] {
  const source = signal(board, page);
  if (!source) return [<TextRow key="waiting" text={t('sensors.waitingForReading')} />];
  return [
    ...observationRows(source, board, page),
    'sampleCount' in source ? (
      <Row key="samples" label={copy('common.row.samples')} value={source.sampleCount} />
    ) : null,
    ...supportRows(source.support, board, page),
  ].filter((row): row is ReactElement => row !== null);
}

/** Aggregate telephony support does not establish current call-observer coverage. */
export function callActivityRows(board: SensorBoardState): ReactElement[] {
  const source = board.reading?.telephony;
  return source
    ? observationRows(source, board, 'callActivity')
    : [<TextRow key="waiting" text={t('sensors.waitingForReading')} />];
}

/** A reason describes an unsatisfied path, never a connected one. */
export function connectivityRows(board: SensorBoardState): ReactElement[] {
  const source = board.reading?.connectivity;
  if (!source) return [<TextRow key="waiting" text={t('sensors.waitingForReading')} />];
  const entries = (fields.connectivity ?? []).filter(
    ([, property]) => property !== 'unsatisfiedReason' || source.pathStatus === 'unsatisfied',
  );
  return [
    ...observationRows(source, board, 'connectivity', entries),
    ...supportRows(source.support, board, 'connectivity'),
  ].filter((row): row is ReactElement => row !== null);
}

function observationRows(
  source: Record<string, unknown>,
  board: SensorBoardState,
  page: SensorPage,
  entries = fields[page] ?? [],
) {
  return entries.map(([label, property, unit]) => (
    <ValueRow
      key={property}
      label={copy(`${prefix(page)}.row.${label}`, label)}
      value={fieldValue(source[property], unit, board)}
    />
  ));
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
