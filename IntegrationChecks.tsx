import type { CaptureErrorCode, CaptureSession, Configuration } from '@kenshiki/identity-capture';
import { IdentityCapturePreview, IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useEffect, useState } from 'react';
import { Button, ScrollView, Text, View } from 'react-native';
import { errorCode } from './HolderText';
import { styles } from './IdentityCaptureFlow';
import { t } from './locales/i18n';

const rows: [[string], [string]] = [
  ['P<UTOSPECIMEN<<SYNTHETIC<<<<<<<<<<<<<<<<<<<<'],
  ['X1234567<7UTO8506151F3201015<<<<<<<<<<<<<<08'],
];
/** Templates for the system NFC sheet, which fills in `{group}` and `{progress}` itself. */
const messages = {
  presenting: t('developer.nfc.presenting'),
  authenticating: t('developer.nfc.authenticating', { progress: '{progress}' }),
  reading: t('developer.nfc.reading', { group: '{group}', progress: '{progress}' }),
  activeAuthentication: t('developer.nfc.activeAuthentication'),
  transportFinishing: t('developer.nfc.transportFinishing'),
  failure: t('developer.nfc.failure'),
};
/** Simulator Debug only (see AppDelegate). Uses its own isolated custody names, never the holder's stores. */
export function IntegrationChecks({ configuration }: { configuration: Configuration }) {
  const [session, setSession] = useState<CaptureSession>();
  const [status, setStatus] = useState(t('developer.status.ready'));
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active: CaptureSession | undefined;
    let alive = true;
    IdentityCaptureSession.create().then(
      (value) => {
        active = value;
        if (alive) setSession(value);
        else value.release().catch(() => setStatus(t('developer.status.releaseFailed')));
      },
      (error) =>
        setStatus(t('developer.status.createFailed', { code: errorCode(error) ?? t('developer.noCode') })),
    );
    return () => {
      alive = false;
      active?.release().catch(() => setStatus(t('developer.status.releaseFailed')));
    };
  }, []);

  async function run() {
    if (busy) return;
    setBusy(true);
    setResults([]);
    setStatus(t('developer.status.running'));
    const checks: string[] = [];
    let first: CaptureSession | undefined;
    let second: CaptureSession | undefined;
    const check = (condition: boolean, name: string) => {
      if (!condition) throw new Error(name);
      checks.push(name);
      setResults([...checks]);
    };
    async function rejects(operation: () => Promise<unknown>, code: CaptureErrorCode) {
      try {
        await operation();
      } catch (error) {
        check(errorCode(error) === code, code);
        return;
      }
      throw new Error(t('developer.expected', { code }));
    }
    try {
      const isolated = <T extends { directoryURL: string; keychainService: string }>(value: T): T => ({
        ...value,
        directoryURL: value.directoryURL + '-integration-checks',
        keychainService: value.keychainService + '.integration-checks',
      });
      // A configured resource that does not exist is refused when the session is created.
      await rejects(
        () => IdentityCaptureSession.create({ trustAnchorsURL: 'file:///missing-test-anchors.pem' }),
        'invalidConfiguration',
      );
      const primary = await IdentityCaptureSession.create({
        ...(configuration.results ? { results: isolated(configuration.results) } : {}),
        ...(configuration.document ? { document: isolated(configuration.document) } : {}),
      });
      first = primary;
      const secondary = await IdentityCaptureSession.create();
      second = secondary;
      check(primary.id !== secondary.id, t('developer.check.independentSessions'));
      await rejects(() => secondary.listResults(), 'resultsNotConfigured');
      check((await primary.listResults()).length === 0, t('developer.check.emptyResults'));
      await rejects(
        () => primary.documentCheckRestore(),
        configuration.document?.check ? 'documentFrontRequired' : 'documentCheckNotConfigured',
      );
      await primary.eraseResults();
      check((await primary.listResults()).length === 0, t('developer.check.resultErasure'));
      const parsed = await primary.parseMRZ(rows);
      check(
        parsed.documentNumber === 'X1234567' && parsed.completeness === 'complete',
        t('developer.check.mrzParser'),
      );
      const partial = await secondary.parseMRZ([rows[1]]);
      check(
        partial.completeness === 'partial' && partial.missingFields.includes('name'),
        t('developer.check.partialRead'),
      );
      await rejects(() => primary.parseMRZ([[rows[0][0]], [rows[1][0].slice(0, 43) + '9']]), 'incompleteMRZ');
      await rejects(() => primary.captureMRZ(), 'incompleteMRZ');
      await rejects(() => primary.compareFace(), 'referenceUnavailable');
      await rejects(() => primary.ssnSnapshot(), 'ssnNotConfigured');
      await rejects(() => primary.ssnCancel(), 'ssnNotConfigured');
      await rejects(() => primary.phoneSnapshot(), 'phoneNotConfigured');
      await rejects(() => primary.phoneCancel(), 'phoneNotConfigured');
      await rejects(
        () => primary.readPassport({ ...parsed, consent: true, messages }),
        'passportNotConfigured',
      );
      const cameraFailure = new Promise<CaptureErrorCode>((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error(t('developer.missingCameraFailure')));
        }, 5000);
        const off = primary.subscribe((event) => {
          if (event.type === 'failure' && event.capability === 'selfie') {
            clearTimeout(timer);
            off();
            resolve(event.code);
          }
        });
      });
      await primary.startSelfie(true);
      check((await cameraFailure) === 'cameraUnavailable', t('developer.check.cameraFailsClosed'));
      await primary.cancel();
      await primary.release();
      await rejects(() => primary.parseMRZ(rows), 'sessionUnavailable');
      check(
        (await secondary.parseMRZ(rows)).documentNumber === 'X1234567',
        t('developer.check.releaseIsolation'),
      );
      setStatus(t('developer.status.passed', { count: checks.length }));
    } catch (error) {
      setStatus(
        t('developer.status.failed', {
          message: error instanceof Error ? error.message : t('developer.nativeCommandFailed'),
        }),
      );
    } finally {
      await first?.release();
      await second?.release();
      setBusy(false);
    }
  }
  return (
    <View style={styles.root}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.developerContent}>
        <Text style={styles.developerTitle}>{t('developer.title')}</Text>
        <Text style={styles.body}>{t('developer.environment')}</Text>
        <Button title={t('developer.run')} onPress={run} disabled={busy} testID="run-sdk-checks" />
        <Text style={styles.body} testID="sdk-check-status" accessibilityLabel={status}>
          {status}
        </Text>
        {results.map((result) => (
          <Text style={styles.body} key={result}>
            {result}
          </Text>
        ))}
        <Text style={styles.body}>{t('developer.preview')}</Text>
        <View style={styles.developerPreview}>
          {session && <IdentityCapturePreview session={session} kind="mrz" style={{ flex: 1 }} />}
        </View>
      </ScrollView>
    </View>
  );
}
