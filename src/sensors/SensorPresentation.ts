import type { SensorBoardState } from '@kenshiki/identity-capture';
import { t } from '../locales/i18n';
import catalog from '../../assets/sensor-presentation/copy.json';
import documentation from '../../assets/sensor-presentation/pages.json';

export { default as sensorConfig } from '../../assets/sensor-presentation/config.json';

const words: Record<string, string> = catalog;
export function copy(key: string, fallback = key): string {
  return words[key] ?? fallback;
}
export const pages = [
  'status',
  'audioRoute',
  'barometer',
  'bluetooth',
  'callActivity',
  'connectivity',
  'deviceSurface',
  'location',
  'magnetometer',
  'motion',
  'telephony',
  'thermalAndPower',
  'weather',
] as const;
export type SensorPage = (typeof pages)[number];
const prefixes: Partial<Record<SensorPage, string>> = { status: 'collection', thermalAndPower: 'power' };
export function prefix(page: SensorPage): string {
  return prefixes[page] ?? page;
}
export function title(page: SensorPage): string {
  return copy(`${prefix(page)}.header`);
}
export function permissioned(page: SensorPage): boolean {
  return ['barometer', 'bluetooth', 'location', 'weather'].includes(page);
}
export type PageDoc = {
  apis: { symbol: string; framework: string; url: string; abstractKey?: string }[];
  checks: { symbol: string; url: string; quoteKey: string }[];
  usageKey?: { key: string; url: string; quoteKey: string };
  hardware?: { url: string; quoteKey: string };
  updates?: { url: string; quoteKey: string };
  algorithmKeys: string[];
  algorithmCode: string | null;
  noteKeys: string[];
  limitKeys: string[];
};
const docs: Record<string, PageDoc> = documentation.pages;
export function pageDoc(page: SensorPage): PageDoc | undefined {
  return docs[page];
}
/** Interpretation alone does not make an API reference destination. */
export function hasDocumentation(page: SensorPage): boolean {
  const doc = pageDoc(page);
  return !!doc && !!(doc.apis.length || doc.checks.length || doc.usageKey || doc.hardware || doc.updates);
}
const permissionWords: Record<string, string> = {
  given: t('sensors.permission.given'),
  refused: t('sensors.permission.refused'),
  notRequested: t('sensors.permission.notRequested'),
  unavailable: t('sensors.permission.unavailable'),
};
export function plain(value: unknown): string {
  if (value === null || value === undefined || value === '') return copy('common.none');
  if (typeof value === 'boolean') return copy(value ? 'common.yes' : 'common.no');
  if (typeof value === 'number')
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  if (Array.isArray(value)) return value.map(plain).join(t('common.listSeparator')) || copy('common.none');
  const text = String(value);
  if (permissionWords[text]) return permissionWords[text];
  const entry = Object.keys(words).find((key) => key.startsWith('sdkValue.') && key.endsWith(`.${text}`));
  if (entry) return words[entry] ?? text;
  return copy(
    `supportStatus.${text}`,
    copy(`permissions.state.${text}`, text.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')),
  );
}
export function moment(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : copy('common.none');
}
/** What a native value measures. The first four follow the board's unit choice. */
export type MeasureKind =
  | 'pressure'
  | 'distance'
  | 'speed'
  | 'temperature'
  | 'magneticField'
  | 'acceleration'
  | 'rotationRate'
  | 'degrees'
  | 'percentage'
  | 'fraction';
export function measure(
  value: number | null | undefined,
  kind: MeasureKind,
  board: SensorBoardState,
): string {
  if (value === null || value === undefined) return copy('common.none');
  const imperial = board.units === 'imperial' || (board.units === 'system' && board.systemUsesImperial);
  const conversions: Record<MeasureKind, [number, number, string]> = {
    pressure: imperial
      ? [0.295299875, 0, t('sensors.unit.inchesOfMercury')]
      : [10, 0, t('sensors.unit.hectopascals')],
    distance: imperial ? [3.280839895, 0, t('sensors.unit.feet')] : [1, 0, t('sensors.unit.metres')],
    speed: imperial
      ? [2.236936292, 0, t('sensors.unit.milesPerHour')]
      : [1, 0, t('sensors.unit.metresPerSecond')],
    temperature: imperial ? [1.8, 32, t('sensors.unit.fahrenheit')] : [1, 0, t('sensors.unit.celsius')],
    magneticField: [1, 0, t('sensors.unit.microtesla')],
    acceleration: [1, 0, t('sensors.unit.gravity')],
    rotationRate: [1, 0, t('sensors.unit.radiansPerSecond')],
    degrees: [1, 0, t('sensors.unit.degrees')],
    percentage: [1, 0, t('sensors.unit.percent')],
    // A 0–1 fraction, such as the battery level, shown as a percentage.
    fraction: [100, 0, t('sensors.unit.percent')],
  };
  const [factor, offset, unit] = conversions[kind];
  return t('sensors.measurement', { value: plain(value * factor + offset), unit });
}
/** The words for a reason the sensor board reported by code. SensorHost's own words where it has
 * them; a weather provider's own report, which is not one of these codes, is shown as it came. */
export function failureText(code: string): string {
  const words: Record<string, string> = {
    collectionFailed: copy('collection.failure'),
    saveFailed: t('sensors.failureCode.saveFailed'),
    exportFailed: copy('export.failed'),
    forgetFailed: t('sensors.failureCode.forgetFailed'),
    eraseFailed: copy('erase.outcome.failed'),
    readFailed: t('sensors.failureCode.readFailed'),
    noFixMeetsContract: t('sensors.failureCode.noFixMeetsContract'),
    locationUnavailable: t('sensors.failureCode.locationUnavailable'),
    noLocationFix: t('sensors.failureCode.noLocationFix'),
    providerFailed: copy('airCheck.absence.weatherProviderFailure'),
    providerNotConfigured: t('sensors.weather.notConfigured'),
  };
  return words[code] ?? code;
}
