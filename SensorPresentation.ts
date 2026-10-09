import type { SensorBoardState } from '@kenshiki/identity-capture';
import catalog from './sensor-presentation/copy.json';
import documentation from './sensor-presentation/pages.json';

export { default as sensorConfig } from './sensor-presentation/config.json';

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
export function plain(value: unknown): string {
  if (value === null || value === undefined || value === '') return copy('common.none', '—');
  if (typeof value === 'boolean') return copy(value ? 'common.yes' : 'common.no', value ? 'Yes' : 'No');
  if (typeof value === 'number')
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  if (Array.isArray(value)) return value.map(plain).join(', ') || '—';
  const text = String(value);
  const permissionWords: Record<string, string> = {
    given: 'Allowed',
    refused: 'Denied',
    notRequested: 'Not asked yet',
    unavailable: 'Unavailable',
  };
  if (permissionWords[text]) return permissionWords[text];
  const entry = Object.keys(words).find((key) => key.startsWith('sdkValue.') && key.endsWith(`.${text}`));
  if (entry) return words[entry] ?? text;
  return copy(
    `supportStatus.${text}`,
    copy(`permissions.state.${text}`, text.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')),
  );
}
export function moment(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—';
}
export function measure(value: number | null | undefined, kind: string, board: SensorBoardState): string {
  if (value === null || value === undefined) return '—';
  const imperial = board.units === 'imperial' || (board.units === 'system' && board.systemUsesImperial);
  const conversions: Record<string, [number, number, string]> = {
    pressure: imperial ? [0.295299875, 0, 'inHg'] : [10, 0, 'hPa'],
    distance: imperial ? [3.280839895, 0, 'ft'] : [1, 0, 'm'],
    speed: imperial ? [2.236936292, 0, 'mph'] : [1, 0, 'm/s'],
    temperature: imperial ? [1.8, 32, '°F'] : [1, 0, '°C'],
  };
  const [factor, offset, unit] = conversions[kind] ?? [1, 0, kind];
  return `${plain(value * factor + offset)} ${unit}`;
}
