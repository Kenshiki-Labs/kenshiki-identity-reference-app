import { resolveLocale, t } from './i18n';
import { fallbackLocale, locales } from './strings.generated';

test('a message without placeholders is returned as written', () => {
  expect(t('hub.title')).toBe('Identity');
  expect(t('common.letsTryAgain')).toBe('Let’s try that again');
});

test('placeholders are filled from the values', () => {
  expect(t('hub.passport.viewResults', { givenNames: 'ANNA MARIA', surname: 'ERIKSSON' })).toBe(
    'ANNA MARIA ERIKSSON · View results',
  );
  expect(t('developer.status.failed', { message: 'Packaged MRZ parser' })).toBe(
    'FAILED: Packaged MRZ parser',
  );
});

test('plurals pick the CLDR category and # is the count', () => {
  expect(t('developer.status.passed', { count: 1 })).toBe('1 check passed');
  expect(t('developer.status.passed', { count: 19 })).toBe('19 checks passed');
  expect(t('documentCheck.providerChecks', { count: 1 })).toBe(
    'The checking service returned 1 individual check.',
  );
  expect(t('documentCheck.providerChecks', { count: 0 })).toBe(
    'The checking service returned 0 individual checks.',
  );
});

test('selects pick their branch, and other when no branch matches', () => {
  expect(
    t('passport.progress.reading', { hasGroup: 'yes', group: 'DG2', hasPercent: 'yes', percent: 62 }),
  ).toBe('Reading passport (DG2) — 62%. Keep your phone still.');
  expect(t('passport.progress.reading', { hasGroup: 'no', group: '', hasPercent: 'no', percent: 0 })).toBe(
    'Reading passport. Keep your phone still.',
  );
  expect(t('format.mrzDate', { day: 15, month: 'm06', year: '85' })).toBe('15 Jun ’85');
});

test('a placeholder can be passed through for the native NFC sheet to fill', () => {
  expect(t('passport.nfc.reading', { progress: '{progress}' })).toBe('Reading passport — {progress}%');
});

test('the device language picks its catalog, and English is the one declared fallback', () => {
  expect(fallbackLocale).toBe('en');
  expect(resolveLocale('en_US')).toEqual({ code: 'en', requested: 'en_US', declaredFallback: false });
  expect(resolveLocale('en-GB')).toEqual({ code: 'en', requested: 'en-GB', declaredFallback: false });
  expect(resolveLocale('fr-FR')).toEqual({ code: 'en', requested: 'fr-FR', declaredFallback: true });
  expect(Object.keys(locales)).toEqual(['en']);
});
