import { type CaptureErrorCode, isCaptureErrorCode } from '@kenshiki/identity-capture';

/** React Native rejects a native command with `{code}`; the bridge maps every native failure to
 * one CaptureErrorCode. Capture failure events carry the same vocabulary. */
export function errorCode(error: unknown): CaptureErrorCode | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return isCaptureErrorCode(error.code) ? error.code : undefined;
}

/** Holder-facing text for the codes one screen can receive. Keys are checked against the closed
 * native vocabulary, so a renamed or removed code fails type checking instead of going silent. */
export type ErrorText = Partial<Record<CaptureErrorCode, string>>;

/** `otherwise` is that screen's own text for a code it does not name, never a second route. */
export function errorText(code: CaptureErrorCode | undefined, texts: ErrorText, otherwise: string): string {
  return (code === undefined ? undefined : texts[code]) ?? otherwise;
}

const moment = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const calendar = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

/** Native timestamps are ISO-8601 instants. Shown in the device's time zone. */
export function formatMoment(iso: string): string {
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? 'Time not recorded' : moment.format(value);
}

/** Date-only YYYY-MM-DD values keep their calendar day; no time-zone conversion. */
export function formatCalendarDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return 'Date not recorded';
  return calendar.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}
