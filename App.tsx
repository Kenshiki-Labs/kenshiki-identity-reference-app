import React, {useEffect, useState} from 'react';
import {Button, SafeAreaView, ScrollView, Text, View} from 'react-native';
import {IdentityCaptureSession, IdentityCapturePreview} from '@kenshiki/identity-capture';
import type {Configuration} from '@kenshiki/identity-capture';
import {IdentityCaptureFlow} from './IdentityCaptureFlow';

const rows = [
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

const emptyConfiguration: Configuration = {};
export default function App({configuration = emptyConfiguration}: {configuration?: Configuration}) {
  const [flow, setFlow] = useState(false);
  return <SafeAreaView style={{flex: 1}}>{flow ?
    <IdentityCaptureFlow configuration={configuration} onExit={() => setFlow(false)} /> :
    <View style={{flex: 1}}>
      <Button title="Passport and face check" testID="open-capture-flow" onPress={() => setFlow(true)} />
      <IntegrationChecks />
    </View>}
  </SafeAreaView>;
}

function IntegrationChecks() {
  const [session, setSession] = useState<IdentityCaptureSession>();
  const [status, setStatus] = useState('Ready');
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active: IdentityCaptureSession | undefined;
    let alive = true;
    IdentityCaptureSession.create().then(value => {
      active = value;
      if (alive) setSession(value); else void value.release();
    }).catch(() => setStatus('Create failed'));
    return () => { alive = false; void active?.release(); };
  }, []);

  async function run() {
    if (busy) return;
    setBusy(true); setResults([]); setStatus('Running');
    const checks: string[] = [];
    let first: IdentityCaptureSession | undefined;
    let second: IdentityCaptureSession | undefined;
    const check = (condition: boolean, name: string) => {
      if (!condition) throw new Error(name);
      checks.push(name); setResults([...checks]);
    };
    async function rejects(operation: () => Promise<unknown>, code: string) {
      try { await operation(); } catch (error) {
        check((error as {code?: string}).code === code, code); return;
      }
      throw new Error(`Expected ${code}`);
    }
    try {
      first = await IdentityCaptureSession.create({trustAnchorsURL: 'file:///missing-test-anchors.pem'});
      second = await IdentityCaptureSession.create();
      check(first.id !== second.id, 'Independent native sessions');
      const parsed = await first.parseMRZ(rows);
      check(parsed.documentNumber === 'X1234567' && parsed.completeness === 'complete', 'Packaged MRZ parser');
      const partial = await second.parseMRZ([rows[1]]);
      check(partial.completeness === 'partial' && partial.missingFields.includes('name'), 'Partial read remains partial');
      await rejects(() => first!.parseMRZ([[rows[0][0]], [rows[1][0].slice(0, 43) + '9']]), 'incompleteMRZ');
      await rejects(() => first!.captureMRZ(), 'incompleteMRZ');
      await rejects(() => first!.compareFace(), 'referenceUnavailable');
      await rejects(() => first!.readPassport({...parsed, consent: true, messages}), 'unsupported');
      const cameraFailure = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { off(); reject(new Error('Missing camera failure event')); }, 5000);
        const off = first!.subscribe(event => {
          if (event.type === 'failure' && event.capability === 'selfie') {
            clearTimeout(timer); off(); resolve(event.code);
          }
        });
      });
      await first.startSelfie(true);
      check(await cameraFailure === 'unavailable', 'Simulator fails closed without TrueDepth');
      await first.cancel();
      await first.release();
      await rejects(() => first!.parseMRZ(rows), 'sessionUnavailable');
      check((await second.parseMRZ(rows)).documentNumber === 'X1234567', 'Release preserves the other session');
      setStatus(`${checks.length} checks passed`);
    } catch (error) {
      setStatus(`FAILED: ${(error as Error).message}`);
    } finally {
      await first?.release(); await second?.release(); setBusy(false);
    }
  }
  return <SafeAreaView style={{flex: 1}}><ScrollView contentContainerStyle={{padding: 24, gap: 16}}>
    <Text style={{fontSize: 24, fontWeight: 'bold'}}>SDK package integration</Text>
    <Text>React Native 0.87.1 · iOS · installed npm artifact</Text>
    <Button title="Run simulator checks" onPress={run} disabled={busy} testID="run-sdk-checks" />
    <Text testID="sdk-check-status" accessibilityLabel={status}>{status}</Text>
    {results.map((result, index) => <Text key={`${index}-${result}`}>{result}</Text>)}
    <Text>Native preview component (camera stopped)</Text>
    <View style={{height: 180}}>{session && <IdentityCapturePreview session={session} kind="mrz" style={{flex: 1}} />}</View>
  </ScrollView></SafeAreaView>;
}
