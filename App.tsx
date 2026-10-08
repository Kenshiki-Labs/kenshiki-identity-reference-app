import React, {useEffect, useRef, useState} from 'react';
import {Button, Pressable, SafeAreaView, ScrollView, Text, View} from 'react-native';
import {IdentityCaptureSession, IdentityCapturePreview} from '@kenshiki/identity-capture';
import type {Configuration} from '@kenshiki/identity-capture';
import {Action, CaptureResultDetails, IdentityCaptureFlow, styles} from './IdentityCaptureFlow';
import {CaptureFlowController, type CompletedCapture} from './CaptureFlowController';
import {DocumentResultDetails, DriverLicenseFlow, documentName} from './DriverLicenseFlow';
import {isCompleteDocument, type SavedDocumentCapture} from './DocumentFlowController';
import {SSNFlow, ssnSummary} from './SSNFlow';
import type {SavedSSNCheck} from './SSNFlowController';
import {DocumentCheckPanel} from './DocumentCheckPanel';
import {IdentitySheetHost} from './IdentitySheetHost';
import {PhoneFlow} from './PhoneFlow';
import type {SavedPhoneCheck} from './PhoneFlowController';

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
  const [screen, setScreen] = useState<'identity' | 'result' | 'capture' | 'checks' | 'documentCapture' | 'documentResult' | 'ssn' | 'phone'>('identity');
  const [result, setResult] = useState<CompletedCapture>();
  const [focus, setFocus] = useState<'passport' | 'face'>('passport');
  const owned = useRef<CompletedCapture | undefined>(undefined);
  const [input, setInput] = useState<{completed?: CompletedCapture; resume?: 'read' | 'selfie'}>({});
  const [document, setDocument] = useState<SavedDocumentCapture>();
  const ownedDocument = useRef<SavedDocumentCapture | undefined>(undefined);
  const [documentInput, setDocumentInput] = useState<{saved?: SavedDocumentCapture; resume?: 'front' | 'back'}>({});
  const [ssn, setSSN] = useState<SavedSSNCheck>();
  const ownedSSN = useRef<SavedSSNCheck | undefined>(undefined);
  const [ssnInput, setSSNInput] = useState<SavedSSNCheck>();
  const [phone, setPhone] = useState<SavedPhoneCheck>();
  const ownedPhone = useRef<SavedPhoneCheck | undefined>(undefined);
  const [phoneInput, setPhoneInput] = useState<SavedPhoneCheck>();
  const [clearSheet, setClearSheet] = useState<'passport' | 'document'>();
  const [clearError, setClearError] = useState<string>();
  const [clearing, setClearing] = useState(false);
  const [openingResults, setOpeningResults] = useState(!!configuration.results);
  const [savedCount, setSavedCount] = useState(0);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  useEffect(() => {
    if (!configuration.results) { setOpeningResults(false); return; }
    let active = true;
    const controller = new CaptureFlowController(IdentityCaptureSession.create, configuration, () => {});
    setOpeningResults(true);
    void (async () => {
      try {
        await controller.open();
        if (!active) return;
        if (controller.state.sheet) { setRestoreError(true); return; }
        setSavedCount(controller.state.saved?.length ?? (controller.state.passport ? 1 : 0));
        if (controller.state.passport) {
          const restored = await controller.handoff();
          if (!active) { await restored.session.release(); return; }
          owned.current = restored; setResult(restored);
        }
        setRestoreError(false);
      } catch { if (active) setRestoreError(true); }
      finally { await controller.dispose(); if (active) setOpeningResults(false); }
    })();
    return () => { active = false; void controller.dispose(); };
  }, [configuration, restoreAttempt]);
  useEffect(() => () => {
    void owned.current?.session.release(); void ownedDocument.current?.session.release(); void ownedSSN.current?.session.release();
    void ownedPhone.current?.session.release();
  }, []);
  function accept(completed: CompletedCapture) {
    owned.current = completed; setResult(completed); setInput({}); setScreen('identity');
  }
  function start(resume?: 'read' | 'selfie') {
    const completed = result;
    owned.current = undefined; setResult(undefined);
    setInput({completed, resume}); setScreen('capture');
  }
  function acceptDocument(saved: SavedDocumentCapture) {
    ownedDocument.current = saved; setDocument(saved); setDocumentInput({}); setScreen('identity');
  }
  function startDocument(resume?: 'front' | 'back') {
    const saved = document;
    ownedDocument.current = undefined; setDocument(undefined);
    setDocumentInput({saved, resume}); setScreen('documentCapture');
  }
  function openSSN() {
    ownedSSN.current = undefined; setSSNInput(ssn); setSSN(undefined); setScreen('ssn');
  }
  function acceptSSN(value: SavedSSNCheck) {
    ownedSSN.current = value; setSSN(value); setSSNInput(undefined); setScreen('identity');
  }
  function openPhone() {
    ownedPhone.current = undefined; setPhoneInput(phone); setPhone(undefined); setScreen('phone');
  }
  function acceptPhone(value: SavedPhoneCheck) {
    ownedPhone.current = value; setPhone(value); setPhoneInput(undefined); setScreen('identity');
  }
  function requestClear(target: 'passport' | 'document') { setClearError(undefined); setClearSheet(target); }
  async function clear() {
    if (clearing) return;
    setClearing(true);
    try {
      if (clearSheet === 'document') {
        await ownedDocument.current?.session.eraseDocuments();
        await ownedDocument.current?.session.release();
        ownedDocument.current = undefined; setDocument(undefined);
      } else {
        if (configuration.results) await owned.current?.session.eraseResults();
        await owned.current?.session.release(); owned.current = undefined; setResult(undefined); setSavedCount(0);
      }
      setClearSheet(undefined); setScreen('identity');
    } catch { setClearError('The saved scans could not be deleted. They have not been removed from this screen. Try again.'); }
    finally { setClearing(false); }
  }
  return <IdentitySheetHost><SafeAreaView style={styles.root}>
    {screen === 'capture' ? <IdentityCaptureFlow configuration={configuration} {...input}
      onComplete={accept} onExit={() => { setInput({}); setScreen('identity'); }} /> :
    screen === 'documentCapture' ? <DriverLicenseFlow configuration={configuration} {...documentInput}
      onComplete={acceptDocument} onExit={() => { setDocumentInput({}); setScreen('identity'); }} /> :
    screen === 'ssn' ? <SSNFlow configuration={configuration} saved={ssnInput}
      onComplete={acceptSSN} onExit={() => { setSSNInput(undefined); setScreen('identity'); }} /> :
    screen === 'phone' ? <PhoneFlow configuration={configuration} saved={phoneInput}
      onComplete={acceptPhone} onExit={() => { setPhoneInput(undefined); setScreen('identity'); }} /> :
    screen === 'checks' ? <View style={{flex: 1}}><Action label="Back to Identity" onPress={() => setScreen('identity')} /><IntegrationChecks configuration={configuration} /></View> :
    <ScrollView contentContainerStyle={styles.content} accessibilityElementsHidden={!!clearSheet}>
      <Text accessibilityRole="header" style={styles.title}>{screen === 'result' ? 'Your results' : screen === 'documentResult' ? 'Your driver’s license' : 'Identity'}</Text>
      {screen === 'identity' ? <>
        <Text style={styles.body}>Your identity checks, together in one place.</Text>
        <Pressable accessibilityRole="button" style={styles.card} testID="open-driver-license"
          onPress={() => document && isCompleteDocument(document.document) ? setScreen('documentResult') : startDocument()}>
          <Text style={styles.sheetTitle}>Driver’s license</Text>
          <Text style={styles.body}>{document ? isCompleteDocument(document.document)
            ? `${documentName(document.document)} · View results` : 'Front saved · Continue with the back' : 'Scan your license or open a saved scan'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.card} testID="open-capture-flow" disabled={openingResults || restoreError}
          onPress={() => { setFocus('passport'); if (result) setScreen('result'); else start(); }}>
          <Text style={styles.sheetTitle}>Passport</Text>
          <Text style={styles.body}>{result ? `${result.passport.givenNames} ${result.passport.surname} · View results` : openingResults ? 'Opening saved results…' : savedCount ? 'Open saved passport results' : 'Scan and read your passport'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{disabled: openingResults || restoreError || (!result?.passport.portraitAvailable && !savedCount)}}
          disabled={openingResults || restoreError || (!result?.passport.portraitAvailable && !savedCount)} style={[styles.card, !result?.passport.portraitAvailable && styles.disabled]}
          testID="face-match-card" onPress={() => { setFocus('face'); if (result?.comparison) setScreen('result'); else start(result ? 'selfie' : undefined); }}>
          <Text style={styles.sheetTitle}>Face match</Text>
          <Text style={styles.body}>{result?.comparison ? 'Comparison complete · View results' : result ? 'Compare a selfie with your passport photo' : savedCount ? 'Choose a saved passport to view its face check' : 'Read a passport to add its photo first'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.card} testID="open-ssn" onPress={openSSN}>
          <Text style={styles.sheetTitle}>Social Security number</Text>
          <Text style={styles.body}>{ssn?.snapshot.recoveryNeeded ? 'Check needs attention · Open' : ssn?.snapshot.receipt
            ? `${ssnSummary(ssn.snapshot.receipt)} · View result` : 'Check whether your number was issued'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.card} testID="open-phone" onPress={openPhone}>
          <Text style={styles.sheetTitle}>Phone</Text>
          <Text style={styles.body}>{phone?.snapshot.pending ? 'Check in progress · Resume' : phone?.snapshot.receipt
            ? 'Result available · View receipt and comparison' : 'Send a text and compare subscriber details with your checked ID'}</Text>
        </Pressable>
        {result && <Text style={styles.label}>Saved passport and face results stay on this phone until you erase them.</Text>}
        {result && <Action label="Erase all passport and face results" secondary onPress={() => requestClear('passport')} />}
        {document && <Action label="Delete saved license scans" secondary onPress={() => requestClear('document')} />}
        <Action label="Developer checks" secondary onPress={() => setScreen('checks')} testID="open-sdk-checks" />
      </> : screen === 'documentResult' && document ? <>
        <DocumentResultDetails result={document} />
        <DocumentCheckPanel key={document.document.front?.captureID} session={document.session} configured={!!configuration.document?.check} />
        <Action label="Back to Identity" testID="document-result-back" onPress={() => setScreen('identity')} />
        <Action label="Retake this license" secondary testID="retake-saved-document" onPress={() => startDocument('front')} />
        <Action label="Delete saved license scans" secondary onPress={() => requestClear('document')} />
      </> : result && <>
        <CaptureResultDetails result={result} focus={focus} />
        <Action label="Back to Identity" onPress={() => setScreen('identity')} />
        <Action label={result.comparison ? 'Retake selfie' : 'Compare with a selfie'} secondary
          disabled={!result.passport.portraitAvailable} onPress={() => start('selfie')} />
        <Action label="Read chip again" secondary onPress={() => start('read')} />
        <Action label="Clear results" secondary onPress={() => requestClear('passport')} />
      </>}
    </ScrollView>}
    {restoreError && <View style={styles.scrim}><View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.sheetContent}><Text style={styles.sheetTitle}>Saved results could not be opened</Text>
        <Text style={styles.body}>Try reopening them. Nothing has been erased.</Text>
        <Action label="Reopen saved results" disabled={openingResults} onPress={() => setRestoreAttempt(value => value + 1)} />
      </View>
    </View></View>}
    {clearSheet && <View style={styles.scrim}><View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.sheetContent}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>{clearError ? 'Deletion could not finish' : clearSheet === 'document' ? 'Delete all saved license scans?' : 'Erase all passport and face results?'}</Text>
        <Text style={styles.body}>{clearError ?? (clearSheet === 'document'
          ? 'This deletes every saved driver’s license scan from this app, including its photos and read details.'
          : 'This deletes all saved passport and face results from this app, including their photos.')}</Text>
        <Action label={clearError ? 'Try again' : clearSheet === 'document' ? 'Delete all license scans' : 'Clear results'} onPress={clear} disabled={clearing} />
        <Action label="Keep results" secondary onPress={() => setClearSheet(undefined)} disabled={clearing} />
      </View>
    </View></View>}
  </SafeAreaView></IdentitySheetHost>;
}

function IntegrationChecks({configuration}: {configuration: Configuration}) {
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
      const isolated = <T extends {directoryURL: string; keychainService: string}>(value: T): T => ({...value,
        directoryURL: value.directoryURL + '-integration-checks', keychainService: value.keychainService + '.integration-checks'});
      first = await IdentityCaptureSession.create({trustAnchorsURL: 'file:///missing-test-anchors.pem',
        results: configuration.results && isolated(configuration.results),
        document: configuration.document && isolated(configuration.document)});
      second = await IdentityCaptureSession.create();
      check(first.id !== second.id, 'Independent native sessions');
      await rejects(() => second!.listResults(), 'resultsNotConfigured');
      check((await first.listResults()).length === 0, 'Encrypted completed-result discovery');
      await rejects(() => first!.documentCheckRestore(), configuration.document?.check ? 'documentFrontRequired' : 'documentCheckNotConfigured');
      await first.eraseResults();
      check((await first.listResults()).length === 0, 'Completed-result custody erasure');
      const parsed = await first.parseMRZ(rows);
      check(parsed.documentNumber === 'X1234567' && parsed.completeness === 'complete', 'Packaged MRZ parser');
      const partial = await second.parseMRZ([rows[1]]);
      check(partial.completeness === 'partial' && partial.missingFields.includes('name'), 'Partial read remains partial');
      await rejects(() => first!.parseMRZ([[rows[0][0]], [rows[1][0].slice(0, 43) + '9']]), 'incompleteMRZ');
      await rejects(() => first!.captureMRZ(), 'incompleteMRZ');
      await rejects(() => first!.compareFace(), 'referenceUnavailable');
      await rejects(() => first!.ssnSnapshot(), 'ssnNotConfigured');
      await rejects(() => first!.ssnCancel(), 'ssnNotConfigured');
      await rejects(() => first!.phoneSnapshot(), 'phoneNotConfigured');
      await rejects(() => first!.phoneCancel(), 'phoneNotConfigured');
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
