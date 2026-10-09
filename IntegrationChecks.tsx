import type { CaptureErrorCode, CaptureSession, Configuration } from '@kenshiki/identity-capture';
import { IdentityCapturePreview, IdentityCaptureSession } from '@kenshiki/identity-capture';
import { useEffect, useState } from 'react';
import { Button, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { errorCode } from './HolderText';

const rows: [[string], [string]] = [
  ['P<UTOSPECIMEN<<SYNTHETIC<<<<<<<<<<<<<<<<<<<<'],
  ['X1234567<7UTO8506151F3201015<<<<<<<<<<<<<<08'],
];
const messages = {
  presenting: 'Hold your phone against your passport.',
  authenticating: 'Connecting — {progress}%',
  reading: 'Reading {group} — {progress}%',
  activeAuthentication: 'Checking the chip.',
  transportFinishing: 'Read complete.',
  failure: 'The passport could not be read. Try again.',
};
/** Simulator Debug only (see AppDelegate). Uses its own isolated custody names, never the holder's stores. */
export function IntegrationChecks({ configuration }: { configuration: Configuration }) {
  const [session, setSession] = useState<CaptureSession>();
  const [status, setStatus] = useState('Ready');
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active: CaptureSession | undefined;
    let alive = true;
    IdentityCaptureSession.create().then(
      (value) => {
        active = value;
        if (alive) setSession(value);
        else value.release().catch(() => setStatus('Session release failed'));
      },
      (error) => setStatus(`Create failed: ${errorCode(error) ?? 'no code returned'}`),
    );
    return () => {
      alive = false;
      active?.release().catch(() => setStatus('Session release failed'));
    };
  }, []);

  async function run() {
    if (busy) return;
    setBusy(true);
    setResults([]);
    setStatus('Running');
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
      throw new Error(`Expected ${code}`);
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
      check(primary.id !== secondary.id, 'Independent native sessions');
      await rejects(() => secondary.listResults(), 'resultsNotConfigured');
      check((await primary.listResults()).length === 0, 'Isolated completed-result list starts empty');
      await rejects(
        () => primary.documentCheckRestore(),
        configuration.document?.check ? 'documentFrontRequired' : 'documentCheckNotConfigured',
      );
      await primary.eraseResults();
      check((await primary.listResults()).length === 0, 'Completed-result custody erasure');
      const parsed = await primary.parseMRZ(rows);
      check(
        parsed.documentNumber === 'X1234567' && parsed.completeness === 'complete',
        'Packaged MRZ parser',
      );
      const partial = await secondary.parseMRZ([rows[1]]);
      check(
        partial.completeness === 'partial' && partial.missingFields.includes('name'),
        'Partial read remains partial',
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
          reject(new Error('Missing camera failure event'));
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
      check((await cameraFailure) === 'cameraUnavailable', 'Simulator fails closed without TrueDepth');
      await primary.cancel();
      await primary.release();
      await rejects(() => primary.parseMRZ(rows), 'sessionUnavailable');
      check(
        (await secondary.parseMRZ(rows)).documentNumber === 'X1234567',
        'Release preserves the other session',
      );
      setStatus(`${checks.length} checks passed`);
    } catch (error) {
      setStatus(`FAILED: ${error instanceof Error ? error.message : 'Native command failed'}`);
    } finally {
      await first?.release();
      await second?.release();
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>SDK package integration</Text>
        <Text>React Native 0.87.1 · iOS · installed npm artifact</Text>
        <Button title="Run simulator checks" onPress={run} disabled={busy} testID="run-sdk-checks" />
        <Text testID="sdk-check-status" accessibilityLabel={status}>
          {status}
        </Text>
        {results.map((result) => (
          <Text key={result}>{result}</Text>
        ))}
        <Text>Native preview component (camera stopped)</Text>
        <View style={{ height: 180 }}>
          {session && <IdentityCapturePreview session={session} kind="mrz" style={{ flex: 1 }} />}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
