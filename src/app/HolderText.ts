import { type CaptureErrorCode, isCaptureErrorCode } from '@kenshiki/identity-capture';
import { formatLocale, t } from '../locales/i18n';

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

const moment = new Intl.DateTimeFormat(formatLocale, { dateStyle: 'medium', timeStyle: 'short' });

/** Native timestamps are ISO-8601 instants. Shown in the device's time zone. */
export function formatMoment(iso: string): string {
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? t('format.timeNotRecorded') : moment.format(value);
}
