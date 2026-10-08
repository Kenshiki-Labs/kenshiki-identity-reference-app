import React, {useEffect, useRef, useState} from 'react';
import {Button, Pressable, SafeAreaView, ScrollView, Text, View} from 'react-native';
import {IdentityCaptureSession, IdentityCapturePreview} from '@kenshiki/identity-capture';
import type {Configuration} from '@kenshiki/identity-capture';
import {Action, CaptureResultDetails, IdentityCaptureFlow, styles} from './IdentityCaptureFlow';
import type {CompletedCapture} from './CaptureFlowController';

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
  const [screen, setScreen] = useState<'identity' | 'result' | 'capture' | 'checks'>('identity');
  const [result, setResult] = useState<CompletedCapture>();
  const [focus, setFocus] = useState<'passport' | 'face'>('passport');
  const owned = useRef<CompletedCapture | undefined>(undefined);
  const [input, setInput] = useState<{completed?: CompletedCapture; resume?: 'read' | 'selfie'}>({});
  const [clearSheet, setClearSheet] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => () => { void owned.current?.session.release(); }, []);
  function accept(completed: CompletedCapture) {
    owned.current = completed; setResult(completed); setInput({}); setScreen('identity');
  }
  function start(resume?: 'read' | 'selfie') {
    const completed = result;
    owned.current = undefined; setResult(undefined);
    setInput({completed, resume}); setScreen('capture');
  }
  async function clear() {
    if (clearing) return;
    setClearing(true);
    await owned.current?.session.release();
    owned.current = undefined; setResult(undefined); setClearSheet(false); setClearing(false); setScreen('identity');
  }
  return <SafeAreaView style={styles.root}>
    {screen === 'capture' ? <IdentityCaptureFlow configuration={configuration} {...input}
      onComplete={accept} onExit={() => { setInput({}); setScreen('identity'); }} /> :
    screen === 'checks' ? <View style={{flex: 1}}><Action label="Back to Identity" onPress={() => setScreen('identity')} /><IntegrationChecks /></View> :
    <ScrollView contentContainerStyle={styles.content} accessibilityElementsHidden={clearSheet}>
      <Text accessibilityRole="header" style={styles.title}>{screen === 'result' ? 'Your results' : 'Identity'}</Text>
      {screen === 'identity' ? <>
        <Text style={styles.body}>Your documents and face check, together in one place.</Text>
        <Pressable accessibilityRole="button" style={styles.card} testID="open-capture-flow"
          onPress={() => { setFocus('passport'); if (result) setScreen('result'); else start(); }}>
          <Text style={styles.sheetTitle}>Passport</Text>
          <Text style={styles.body}>{result ? `${result.passport.givenNames} ${result.passport.surname} · View results` : 'Scan and read your passport'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{disabled: !result?.passport.portraitAvailable}}
          disabled={!result?.passport.portraitAvailable} style={[styles.card, !result?.passport.portraitAvailable && styles.disabled]}
          testID="face-match-card" onPress={() => { setFocus('face'); if (result?.comparison) setScreen('result'); else start('selfie'); }}>
          <Text style={styles.sheetTitle}>Face match</Text>
          <Text style={styles.body}>{result?.comparison ? 'Comparison complete · View results' : result ? 'Compare a selfie with your passport photo' : 'Read a passport to add its photo first'}</Text>
        </Pressable>
        {result && <Text style={styles.label}>Available while this app stays open. Clear results when you are finished.</Text>}
        {result && <Action label="Clear results" secondary onPress={() => setClearSheet(true)} />}
        <Action label="Developer checks" secondary onPress={() => setScreen('checks')} testID="open-sdk-checks" />
      </> : result && <>
        <CaptureResultDetails result={result} focus={focus} />
        <Action label="Back to Identity" onPress={() => setScreen('identity')} />
        <Action label={result.comparison ? 'Retake selfie' : 'Compare with a selfie'} secondary
          disabled={!result.passport.portraitAvailable} onPress={() => start('selfie')} />
        <Action label="Read chip again" secondary onPress={() => start('read')} />
        <Action label="Clear results" secondary onPress={() => setClearSheet(true)} />
      </>}
    </ScrollView>}
    {clearSheet && <View style={styles.scrim}><View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.sheetContent}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>Clear these results?</Text>
        <Text style={styles.body}>This removes the passport, photos and comparison from this check.</Text>
        <Action label="Clear results" onPress={clear} disabled={clearing} />
        <Action label="Keep results" secondary onPress={() => setClearSheet(false)} disabled={clearing} />
      </View>
    </View></View>}
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
