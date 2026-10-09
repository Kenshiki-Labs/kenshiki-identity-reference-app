import React, {useEffect, useRef, useState} from 'react';
import {Button, Pressable, SafeAreaView, ScrollView, Text, View} from 'react-native';
import {IdentityCaptureSession, IdentityCapturePreview} from '@kenshiki/identity-capture';
import type {CaptureErrorCode, Configuration} from '@kenshiki/identity-capture';
import {Action, CaptureResultDetails, IdentityCaptureFlow, styles} from './IdentityCaptureFlow';
import {CaptureFlowController, type CompletedCapture} from './CaptureFlowController';
import {DocumentResultDetails, DriverLicenseFlow, documentName} from './DriverLicenseFlow';
import {isCompleteDocument, type SavedDocumentCapture} from './DocumentFlowController';
import {SSNFlow, ssnSummary} from './SSNFlow';
import type {SavedSSNCheck} from './SSNFlowController';
import {DocumentCheckPanel} from './DocumentCheckPanel';
import {IdentitySheetHost} from './IdentitySheetHost';
import {PhoneFlow, phoneCheckStopped} from './PhoneFlow';
import type {SavedPhoneCheck} from './PhoneFlowController';
import {errorCode, errorText, type ErrorText} from './HolderText';
import {t} from './locales/i18n';

const rows = [
  ['P<UTOSPECIMEN<<SYNTHETIC<<<<<<<<<<<<<<<<<<<<'],
  ['X1234567<7UTO8506151F3201015<<<<<<<<<<<<<<08'],
];
/** Templates for the system NFC sheet, which fills in `{group}` and `{progress}` itself. */
const messages = {
  presenting: t('developer.nfc.presenting'),
  authenticating: t('developer.nfc.authenticating', {progress: '{progress}'}),
  reading: t('developer.nfc.reading', {group: '{group}', progress: '{progress}'}),
  activeAuthentication: t('developer.nfc.activeAuthentication'),
  transportFinishing: t('developer.nfc.transportFinishing'),
  failure: t('developer.nfc.failure'),
};
const clearErrors: ErrorText = {
  busy: t('hub.clearError.busy'),
  sessionUnavailable: t('hub.clearError.sessionUnavailable'),
  resultsNotConfigured: t('hub.clearError.resultsNotConfigured'),
  resultIntegrityFailure: t('hub.clearError.resultIntegrityFailure'),
  documentCustodyFailed: t('hub.clearError.documentCustodyFailed'),
  storageUnavailable: t('hub.clearError.storageUnavailable'),
};
const restoreErrors: ErrorText = {
  sessionUnavailable: t('hub.restoreError.sessionUnavailable'),
  busy: t('hub.restoreError.busy'),
};

const emptyConfiguration: Configuration = {};
/** `developerChecks` is passed only by the simulator Debug AppDelegate. `configurationIssue` names
 * a native configuration step that failed before React mounted. */
export default function App({configuration = emptyConfiguration, developerChecks = false, configurationIssue}: {
  configuration?: Configuration; developerChecks?: boolean; configurationIssue?: 'holderScopeUnreadable';
}) {
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
  const [restoreFailure, setRestoreFailure] = useState<string>();
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const releasing = useRef<Promise<unknown>>(Promise.resolve());
  // One configuration is one holder's custody. Before the next holder's saved results open,
  // release every session the previous holder's screens own and clear their personal state.
  useEffect(() => {
    const previous = [owned.current?.session, ownedDocument.current?.session, ownedSSN.current?.session, ownedPhone.current?.session];
    owned.current = undefined; ownedDocument.current = undefined; ownedSSN.current = undefined; ownedPhone.current = undefined;
    setResult(undefined); setDocument(undefined); setSSN(undefined); setPhone(undefined);
    setInput({}); setDocumentInput({}); setSSNInput(undefined); setPhoneInput(undefined);
    setClearSheet(undefined); setClearError(undefined); setSavedCount(0); setRestoreFailure(undefined); setScreen('identity');
    releasing.current = Promise.all(previous.map(session => session?.release()));
  }, [configuration]);
  useEffect(() => {
    if (!configuration.results) { setOpeningResults(false); return; }
    let active = true;
    const controller = new CaptureFlowController(IdentityCaptureSession.create, configuration, () => {});
    setOpeningResults(true);
    void (async () => {
      try {
        await releasing.current;
        if (!active) return;
        await controller.open();
        if (!active) return;
        const sheet = controller.state.sheet;
        if (sheet) { setRestoreFailure(sheet.message); return; }
        setSavedCount(controller.state.saved?.length ?? (controller.state.passport ? 1 : 0));
        if (controller.state.passport) {
          const restored = await controller.handoff();
          if (!active) { await restored.session.release(); return; }
          owned.current = restored; setResult(restored);
        }
        setRestoreFailure(undefined);
      } catch (error) {
        if (active) setRestoreFailure(errorText(errorCode(error), restoreErrors, t('hub.restoreError.other')));
      } finally { await controller.dispose(); if (active) setOpeningResults(false); }
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
  async function openSavedResults() {
    if (openingResults) return;
    setOpeningResults(true);
    try {
      await owned.current?.session.release();
      owned.current = undefined; setResult(undefined); setInput({}); setScreen('capture');
    } finally { setOpeningResults(false); }
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
        // An unreadable store has no review session; erase it through a session of its own.
        const review = owned.current?.session;
        const session = review ?? await IdentityCaptureSession.create(configuration);
        try { if (configuration.results) await session.eraseResults(); }
        catch (error) { if (!review) await session.release(); throw error; }
        await session.release(); owned.current = undefined; setResult(undefined); setSavedCount(0); setRestoreFailure(undefined);
      }
      setClearSheet(undefined); setScreen('identity');
    } catch (error) {
      setClearError(errorText(errorCode(error), clearErrors, t('hub.clearError.other')));
    } finally { setClearing(false); }
  }
  const passportReady = !!configuration.trustAnchorsURL;
  const faceReady = !!configuration.embedderURL && !!configuration.detectorURL;
  const blocked = openingResults || !!restoreFailure;
  const passportDisabled = blocked || (!passportReady && !result && !savedCount);
  const faceDisabled = blocked || !(result?.comparison || (faceReady && result?.passport.portraitAvailable) || (!result && savedCount > 0));
  const covered = !!clearSheet || !!restoreFailure;
  return <IdentitySheetHost><SafeAreaView style={styles.root}>
    {screen === 'capture' ? <IdentityCaptureFlow configuration={configuration} {...input}
      onComplete={accept} onExit={() => { setInput({}); setScreen('identity'); }} /> :
    screen === 'documentCapture' ? <DriverLicenseFlow configuration={configuration} {...documentInput}
      onComplete={acceptDocument} onExit={() => { setDocumentInput({}); setScreen('identity'); }} /> :
    screen === 'ssn' ? <SSNFlow configuration={configuration} saved={ssnInput}
      onComplete={acceptSSN} onExit={() => { setSSNInput(undefined); setScreen('identity'); }} /> :
    screen === 'phone' ? <PhoneFlow configuration={configuration} saved={phoneInput}
      onComplete={acceptPhone} onExit={() => { setPhoneInput(undefined); setScreen('identity'); }} /> :
    screen === 'checks' && developerChecks && __DEV__ ? <View style={{flex: 1}}><Action label={t('common.backToIdentity')} onPress={() => setScreen('identity')} /><IntegrationChecks configuration={configuration} /></View> :
    <ScrollView contentContainerStyle={styles.content} testID="identity-hub" accessibilityElementsHidden={covered}
      importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}>
      <Text accessibilityRole="header" style={styles.title}>{screen === 'result' ? t('hub.resultsTitle') : screen === 'documentResult' ? t('hub.licenseTitle') : t('hub.title')}</Text>
      {screen === 'identity' ? <>
        <Text style={styles.body}>{t('hub.intro')}</Text>
        {configurationIssue === 'holderScopeUnreadable' && <Text style={styles.body} testID="configuration-issue">
          {t('hub.configurationIssue')}</Text>}
        <Pressable accessibilityRole="button" style={styles.card} testID="open-driver-license"
          onPress={() => document && isCompleteDocument(document.document) ? setScreen('documentResult') : startDocument()}>
          <Text style={styles.sheetTitle}>{t('hub.license.title')}</Text>
          <Text style={styles.body}>{document ? isCompleteDocument(document.document)
            ? t('hub.license.viewResults', {name: documentName(document.document)}) : t('hub.license.continueBack') : t('hub.license.start')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{disabled: passportDisabled}} disabled={passportDisabled}
          style={[styles.card, passportDisabled && styles.disabled]} testID="open-capture-flow"
          onPress={() => { setFocus('passport'); if (result) setScreen('result'); else start(); }}>
          <Text style={styles.sheetTitle}>{t('hub.passport.title')}</Text>
          <Text style={styles.body}>{result ? t('hub.passport.viewResults', {givenNames: result.passport.givenNames, surname: result.passport.surname}) : openingResults ? t('common.openingSavedResults')
            : savedCount ? t('hub.passport.openSaved') : passportReady ? t('hub.passport.start')
              : t('hub.passport.notSetUp')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{disabled: faceDisabled}} disabled={faceDisabled}
          style={[styles.card, faceDisabled && styles.disabled]}
          testID="face-match-card" onPress={() => { setFocus('face'); if (result?.comparison) setScreen('result'); else start(result ? 'selfie' : undefined); }}>
          <Text style={styles.sheetTitle}>{t('hub.face.title')}</Text>
          <Text style={styles.body}>{result?.comparison ? t('hub.face.viewResults') : !result && savedCount ? t('hub.face.chooseSaved')
            : !faceReady ? t('hub.face.notSetUp') : result ? t('hub.face.start') : t('hub.face.needsPassport')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.card} testID="open-ssn" onPress={openSSN}>
          <Text style={styles.sheetTitle}>{t('common.socialSecurityNumber')}</Text>
          <Text style={styles.body}>{ssn?.snapshot.recoveryNeeded ? t('hub.ssn.needsAttention') : ssn?.snapshot.receipt
            ? t('hub.ssn.viewResult', {summary: ssnSummary(ssn.snapshot.receipt)}) : t('hub.ssn.start')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.card} testID="open-phone" onPress={openPhone}>
          <Text style={styles.sheetTitle}>{t('hub.phone.title')}</Text>
          <Text style={styles.body}>{phone?.snapshot.pending ? t('hub.phone.resume') : phone?.snapshot.receipt
            ? phoneCheckStopped(phone.snapshot.receipt) ? t('hub.phone.stopped')
              : t('hub.phone.viewResult') : t('hub.phone.start')}</Text>
        </Pressable>
        {configuration.results && result && <Action label={t('hub.action.openSavedPassportChecks')} secondary disabled={openingResults} onPress={openSavedResults} />}
        {configuration.results && result && <Text style={styles.label}>{t('hub.action.savedNotice')}</Text>}
        {result && <Action label={t('hub.action.eraseAll')} secondary onPress={() => requestClear('passport')} />}
        {document && <Action label={t('hub.action.deleteLicenseScans')} secondary onPress={() => requestClear('document')} />}
        {developerChecks && __DEV__ && <Action label={t('hub.action.developerChecks')} secondary onPress={() => setScreen('checks')} testID="open-sdk-checks" />}
      </> : screen === 'documentResult' && document ? <>
        <DocumentResultDetails result={document} />
        <DocumentCheckPanel key={document.document.front?.captureID} session={document.session} configured={!!configuration.document?.check} />
        <Action label={t('common.backToIdentity')} testID="document-result-back" onPress={() => setScreen('identity')} />
        <Action label={t('license.retake')} secondary testID="retake-saved-document" onPress={() => startDocument('front')} />
        <Action label={t('hub.action.deleteLicenseScans')} secondary onPress={() => requestClear('document')} />
      </> : result && <>
        <CaptureResultDetails result={result} focus={focus} />
        <Action label={t('common.backToIdentity')} onPress={() => setScreen('identity')} />
        <Action label={result.comparison ? t('passport.action.retakeSelfie') : t('passport.action.compareSelfie')} secondary
          disabled={!result.passport.portraitAvailable || !faceReady} onPress={() => start('selfie')} />
        {!faceReady && <Text style={styles.body}>{t('hub.face.notSetUp')}</Text>}
        <Action label={t('passport.action.readChipAgain')} secondary disabled={!passportReady} onPress={() => start('read')} />
        <Action label={t('hub.action.clearResults')} secondary onPress={() => requestClear('passport')} />
      </>}
    </ScrollView>}
    {restoreFailure && !clearSheet && <View style={styles.scrim}><View style={styles.sheet} accessibilityViewIsModal testID="restore-bottom-sheet">
      <View style={styles.sheetContent}><Text accessibilityRole="header" style={styles.sheetTitle}>{t('hub.restore.title')}</Text>
        <Text style={styles.body}>{t('hub.restore.body', {reason: restoreFailure})}</Text>
        <Action label={t('hub.restore.reopen')} disabled={openingResults} onPress={() => setRestoreAttempt(value => value + 1)} />
        {configuration.results && <Action label={t('hub.restore.erase')} secondary disabled={openingResults}
          testID="erase-unreadable-results" onPress={() => requestClear('passport')} />}
      </View>
    </View></View>}
    {clearSheet && <View style={styles.scrim}><View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.sheetContent}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>{clearError ? t('hub.clear.failedTitle') : clearSheet === 'document' ? t('hub.clear.licenseTitle') : t('hub.clear.passportTitle')}</Text>
        <Text style={styles.body}>{clearError ?? (clearSheet === 'document'
          ? t('hub.clear.licenseBody')
          : t('hub.clear.passportBody'))}</Text>
        <Action label={clearError ? t('common.tryAgain') : clearSheet === 'document' ? t('hub.clear.deleteLicenseScans') : t('hub.action.clearResults')} onPress={clear} disabled={clearing} />
        <Action label={t('hub.clear.keep')} secondary onPress={() => setClearSheet(undefined)} disabled={clearing} />
      </View>
    </View></View>}
  </SafeAreaView></IdentitySheetHost>;
}

/** Simulator Debug only (see AppDelegate). Uses its own isolated custody names, never the holder's stores. */
function IntegrationChecks({configuration}: {configuration: Configuration}) {
  const [session, setSession] = useState<IdentityCaptureSession>();
  const [status, setStatus] = useState(t('developer.status.ready'));
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active: IdentityCaptureSession | undefined;
    let alive = true;
    IdentityCaptureSession.create().then(value => {
      active = value;
      if (alive) setSession(value); else void value.release();
    }, error => setStatus(t('developer.status.createFailed', {code: errorCode(error) ?? t('developer.noCode')})));
    return () => { alive = false; void active?.release(); };
  }, []);

  async function run() {
    if (busy) return;
    setBusy(true); setResults([]); setStatus(t('developer.status.running'));
    const checks: string[] = [];
    let first: IdentityCaptureSession | undefined;
    let second: IdentityCaptureSession | undefined;
    const check = (condition: boolean, name: string) => {
      if (!condition) throw new Error(name);
      checks.push(name); setResults([...checks]);
    };
    async function rejects(operation: () => Promise<unknown>, code: CaptureErrorCode) {
      try { await operation(); } catch (error) {
        check(errorCode(error) === code, code); return;
      }
      throw new Error(t('developer.expected', {code}));
    }
    try {
      const isolated = <T extends {directoryURL: string; keychainService: string}>(value: T): T => ({...value,
        directoryURL: value.directoryURL + '-integration-checks', keychainService: value.keychainService + '.integration-checks'});
      // A configured resource that does not exist is refused when the session is created.
      await rejects(() => IdentityCaptureSession.create({trustAnchorsURL: 'file:///missing-test-anchors.pem'}),
        'invalidConfiguration');
      first = await IdentityCaptureSession.create({
        results: configuration.results && isolated(configuration.results),
        document: configuration.document && isolated(configuration.document)});
      second = await IdentityCaptureSession.create();
      check(first.id !== second.id, t('developer.check.independentSessions'));
      await rejects(() => second!.listResults(), 'resultsNotConfigured');
      check((await first.listResults()).length === 0, t('developer.check.emptyResults'));
      await rejects(() => first!.documentCheckRestore(), configuration.document?.check ? 'documentFrontRequired' : 'documentCheckNotConfigured');
      await first.eraseResults();
      check((await first.listResults()).length === 0, t('developer.check.resultErasure'));
      const parsed = await first.parseMRZ(rows);
      check(parsed.documentNumber === 'X1234567' && parsed.completeness === 'complete', t('developer.check.mrzParser'));
      const partial = await second.parseMRZ([rows[1]]);
      check(partial.completeness === 'partial' && partial.missingFields.includes('name'), t('developer.check.partialRead'));
      await rejects(() => first!.parseMRZ([[rows[0][0]], [rows[1][0].slice(0, 43) + '9']]), 'incompleteMRZ');
      await rejects(() => first!.captureMRZ(), 'incompleteMRZ');
      await rejects(() => first!.compareFace(), 'referenceUnavailable');
      await rejects(() => first!.ssnSnapshot(), 'ssnNotConfigured');
      await rejects(() => first!.ssnCancel(), 'ssnNotConfigured');
      await rejects(() => first!.phoneSnapshot(), 'phoneNotConfigured');
      await rejects(() => first!.phoneCancel(), 'phoneNotConfigured');
      await rejects(() => first!.readPassport({...parsed, consent: true, messages}), 'passportNotConfigured');
      const cameraFailure = new Promise<CaptureErrorCode>((resolve, reject) => {
        const timer = setTimeout(() => { off(); reject(new Error(t('developer.missingCameraFailure'))); }, 5000);
        const off = first!.subscribe(event => {
          if (event.type === 'failure' && event.capability === 'selfie') {
            clearTimeout(timer); off(); resolve(event.code);
          }
        });
      });
      await first.startSelfie(true);
      check(await cameraFailure === 'cameraUnavailable', t('developer.check.cameraFailsClosed'));
      await first.cancel();
      await first.release();
      await rejects(() => first!.parseMRZ(rows), 'sessionUnavailable');
      check((await second.parseMRZ(rows)).documentNumber === 'X1234567', t('developer.check.releaseIsolation'));
      setStatus(t('developer.status.passed', {count: checks.length}));
    } catch (error) {
      setStatus(t('developer.status.failed', {message: (error as Error).message}));
    } finally {
      await first?.release(); await second?.release(); setBusy(false);
    }
  }
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.developerContent}>
    <Text style={styles.developerTitle}>{t('developer.title')}</Text>
    <Text style={styles.body}>{t('developer.environment')}</Text>
    <Button title={t('developer.run')} onPress={run} disabled={busy} testID="run-sdk-checks" />
    <Text style={styles.body} testID="sdk-check-status" accessibilityLabel={status}>{status}</Text>
    {results.map((result, index) => <Text style={styles.body} key={`${index}-${result}`}>{result}</Text>)}
    <Text style={styles.body}>{t('developer.preview')}</Text>
    <View style={styles.developerPreview}>{session && <IdentityCapturePreview session={session} kind="mrz" style={{flex: 1}} />}</View>
  </ScrollView></SafeAreaView>;
}
