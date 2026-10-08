import React, {useEffect, useRef, useState} from 'react';
import {AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {IdentityCaptureImage, IdentityCapturePreview, IdentityCaptureSession} from '@kenshiki/identity-capture';
import type {Configuration, PassportObservation} from '@kenshiki/identity-capture';
import {CaptureFlowController, type CompletedCapture, type FlowState} from './CaptureFlowController';

/** Completion transfers the session to the adopter. Cancellation releases it. */
export function IdentityCaptureFlow({configuration, onExit, onComplete, completed, resume}: {
  configuration: Configuration; onExit: () => void; onComplete: (result: CompletedCapture) => void;
  completed?: CompletedCapture; resume?: 'selfie' | 'read';
}) {
  const [state, setState] = useState<FlowState>({phase: 'intro', busy: false, ready: false, preview: 0});
  const [controller, setController] = useState<CaptureFlowController>();
  const [width, setWidth] = useState(0);
  const handoffStarted = useRef(false);
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    const active = new CaptureFlowController(IdentityCaptureSession.create, configuration, setState, completed);
    setController(active); setState(active.state);
    if (resume === 'selfie') void active.selfie();
    if (resume === 'read') void active.read();
    if (!resume) void active.open();
    const listener = AppState.addEventListener('change', next => { if (next === 'background') void active.pause(); });
    return () => { listener.remove(); void active.dispose(); };
  }, [configuration, completed, resume]);
  if (!controller) return <View style={styles.root} />;
  const {phase, sheet} = state;
  const camera = phase === 'scanning' || phase === 'selfie';
  const finish = async () => {
    if (handoffStarted.current) return;
    handoffStarted.current = true; setFinishing(true);
    onComplete(await controller.handoff());
  };
  const title = phase === 'intro' ? 'Your passport' : phase === 'scanning' ? 'Scan your passport' :
    phase === 'review' ? 'Check the printed details' : phase === 'reading' ? 'Reading your passport' :
    phase === 'passport' || phase === 'result' ? 'Your results' :
    phase === 'comparing' || phase === 'captured' ? 'Comparing your photos' : 'Take a selfie';
  const action = (label: string, press: () => unknown, disabled = false, id?: string, secondary = false) =>
    <Action label={label} onPress={press} disabled={state.busy || finishing || disabled} testID={id} secondary={secondary} />;
  const result = state.session && state.passport ? {
    session: state.session, mrz: state.mrz, passport: state.passport, comparison: state.comparison,
  } : undefined;
  const close = <Action label={state.passport ? 'Back to Identity' : 'Close check'} secondary
    disabled={finishing || (!!state.passport && state.busy)} onPress={async () => {
      if (state.passport) await finish(); else { await controller.dispose(); onExit(); }
    }} />;
  return <View style={styles.root}>
    {camera ? <View style={styles.camera} accessibilityElementsHidden={!!sheet}
      importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      {state.session && <IdentityCapturePreview key={`${phase}-${state.preview}`} session={state.session}
        kind={phase === 'scanning' ? 'mrz' : 'selfie'} style={StyleSheet.absoluteFill} />}
      {phase === 'selfie' && <View pointerEvents="none" style={styles.guideCenter}>
        <View style={[styles.oval, {width: width * .68, height: width * .68 * 1.3}]} />
      </View>}
      <View style={styles.cameraTop}>
        <Text accessibilityRole="header" style={[styles.title, styles.white]}>{title}</Text>
        <Text style={[styles.body, styles.white]}>{phase === 'scanning'
          ? 'Put the two lines at the bottom of the photo page inside the clear band.' : state.hint}</Text>
      </View>
      <View style={styles.cameraBottom}>
        {phase === 'scanning' ? <>
          <Text style={[styles.body, styles.white]} accessibilityLiveRegion="polite">
            {state.mrz?.completeness === 'complete' ? 'Printed details found. Ready to capture.' :
              state.mrz ? 'Keep both lines in view.' : 'Hold the passport steady.'}</Text>
          {action('Capture details', controller.review, state.mrz?.completeness !== 'complete', 'capture-mrz')}
        </> : action('Capture selfie', controller.capture, !state.ready)}
        {close}
      </View>
    </View> : <ScrollView accessibilityElementsHidden={!!sheet}
      importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>IDENTITY</Text>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {phase === 'loading' && <Text style={styles.body}>Opening saved results…</Text>}
      {phase === 'saved' && <>
        <Text style={styles.body}>Choose a saved passport check.</Text>
        {state.saved?.map((record, index) => <View key={record.workflowID} style={styles.card}>
          <Text style={styles.body}>{record.recordedAt}</Text>
          {action('Open saved results', () => controller.recoverSaved(record.workflowID), false, `saved-passport-${index}`)}
        </View>)}
        {action('Scan another passport', controller.restart, false, 'new-passport', true)}
      </>}
      {phase === 'intro' && <>
        <Text style={styles.body}>Scan the photo page, then hold your phone against the passport to read its chip. You can review the passport and compare its photo with a selfie.</Text>
        <Text style={styles.body}>Your captures stay on this phone. Starting allows camera capture; reading the chip begins when you choose to continue.</Text>
        {action('Start passport scan', controller.scan, false, 'start-passport-scan')}
      </>}
      {phase === 'review' && state.mrz && <>
        <Text style={styles.body}>Check these details against your passport.</Text>
        <Details label="Name" value={`${state.mrz.givenNames} ${state.mrz.surname}`.replace(/<+/g, ' ')} />
        <Details label="Passport number" value={state.mrz.documentNumber} />
        <Details label="Date of birth" value={displayDate(state.mrz.birthDateYYMMDD)} />
        <Details label="Expiry date" value={displayDate(state.mrz.expiryDateYYMMDD)} />
        <Text style={styles.body}>Next, hold the top of your phone against the passport and keep it still.</Text>
        {action('Read passport chip', controller.read, false, 'read-passport')}
        {action('Scan again', controller.scan, false, undefined, true)}
      </>}
      {phase === 'reading' && <Text style={styles.body} accessibilityLiveRegion="polite">{state.progress}</Text>}
      {(phase === 'passport' || phase === 'result') && result && <>
        <CaptureResultDetails result={result} focus={phase === 'result' ? 'face' : 'passport'} />
        {action('Done', finish, false, 'finish-capture')}
        {action(state.comparison ? 'Retake selfie' : 'Compare with a selfie', controller.selfie,
          !state.passport?.portraitAvailable, 'retake-selfie', true)}
        {action('Read chip again', controller.read, false, 'reread-passport', true)}
      </>}
      {(phase === 'captured' || phase === 'comparing') && <Text style={styles.body} accessibilityLiveRegion="polite">Your selfie was captured. Comparing it with the passport photo…</Text>}
      {state.busy && phase !== 'comparing' && <Text accessibilityLiveRegion="polite" style={styles.body}>Please wait…</Text>}
      {phase !== 'intro' && <Action label="Scan a different passport" onPress={controller.requestRestart} secondary testID="restart-check" />}
      {close}
    </ScrollView>}
    {sheet && <View style={styles.scrim}>
      <View accessibilityViewIsModal style={styles.sheet} testID="capture-bottom-sheet">
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{sheet.kind === 'restart' ? 'Start a new passport check?' : 'Let’s try that again'}</Text>
          <Text style={styles.body}>{sheet.message}</Text>
          {sheet.kind === 'restart' ? <>
            {action('Start over', controller.restart, false, 'confirm-restart')}
            {action('Keep this check', controller.recover, false, undefined, true)}
          </> : <>
            {sheet.recovery === 'details' ? action(state.passport ? 'Back to results' : state.mrz ? 'Back to passport details' : 'Back to Identity',
              state.passport || state.mrz ? controller.recover : async () => { await controller.dispose(); onExit(); },
              false, 'back-to-details') : <>
              {sheet.recovery === 'settings' && action('Open Settings', () => Linking.openSettings(), false, 'open-camera-settings')}
              {action(sheet.recovery === 'save' ? 'Save completed result' : sheet.recovery === 'settings' ? 'Try camera again' : 'Try again', controller.recover, false, 'retry-capture')}
            </>}
            {state.passport && action('Keep passport results', finish, false, 'keep-passport', true)}
            {action('Start over', controller.restart, false, 'confirm-restart', true)}
          </>}
        </ScrollView>
      </View>
    </View>}
  </View>;
}

const protocolLabels: Record<keyof PassportObservation['protocols'], string> = {
  countrySigningChain: 'Issuer signing chain', documentSignature: 'Chip data signature',
  dataGroupHashes: 'Data integrity', activeAuthentication: 'Active authentication',
  chipAuthentication: 'Chip authentication', pace: 'PACE connection', basicAccessControl: 'BAC connection',
};
const correspondenceLabels = {documentNumber: 'Passport number', birthDate: 'Date of birth',
  expiryDate: 'Expiry date', surname: 'Surname', givenNames: 'Given names'};
const outcomeLabels: Record<string, string> = {pass: 'Photos match', fail: 'Photos did not match', manual_review: 'Needs another look'};

export function CaptureResultDetails({result, focus = 'passport'}: {result: CompletedCapture; focus?: 'passport' | 'face'}) {
  const {passport, comparison, session} = result;
  const [technical, setTechnical] = useState(false);
  const depth = comparison?.admissionReceipt.depthEvidence;
  const referenceSHA = comparison?.referenceSHA256 ?? passport.portraitSHA256;
  const faceCard = <View style={styles.card} testID="face-result">
    <Text accessibilityRole="header" style={styles.sheetTitle}>Face comparison</Text>
    <Text style={styles.body}>{comparison ? outcomeLabels[comparison.outcome] ?? comparison.outcome : 'Not taken yet'}</Text>
    {comparison && <>
      <Details label="TrueDepth liveness" value={depth ? 'Depth recorded with this selfie' : 'Depth evidence unavailable'} />
      <Details label="Expression" value={comparison.admissionReceipt.eyesOpen ? 'Blink completed; eyes reopened' : 'Not available'} />
    </>}
  </View>;
  return <>
    {focus === 'face' && faceCard}
    <View style={styles.card} testID="passport-result">
      <Text accessibilityRole="header" style={styles.sheetTitle}>Passport</Text>
      <View style={styles.portraits}>
        {referenceSHA && <View style={styles.portrait}>
          <IdentityCaptureImage key={referenceSHA} session={session} image="reference" sha256={referenceSHA}
            accessibilityLabel="Passport chip photo" style={styles.image} />
          <Text style={styles.label}>Passport photo</Text>
        </View>}
        {comparison && <View style={styles.portrait}>
          <IdentityCaptureImage key={comparison.selfieSHA256} session={session} image="selfie" sha256={comparison.selfieSHA256}
            accessibilityLabel="Compared selfie" style={styles.image} />
          <Text style={styles.label}>Your selfie</Text>
        </View>}
      </View>
      <Details label="Name" value={`${passport.givenNames} ${passport.surname}`.replace(/<+/g, ' ')} />
      <Details label="Passport number" value={passport.documentNumber} />
      <Details label="Date of birth" value={displayDate(passport.birthDateYYMMDD)} />
      <Details label="Expiry date" value={displayDate(passport.expiryDateYYMMDD)} />
      <Details label="Nationality" value={passport.nationality} />
      <Details label="Issued by" value={passport.issuingState} />
      {passport.placeOfBirth && <Details label="Place of birth" value={passport.placeOfBirth} />}
      {passport.issuingAuthority && <Details label="Issuing authority" value={passport.issuingAuthority} />}
      {passport.dateOfIssue && <Details label="Date of issue" value={passport.dateOfIssue} />}
      {!passport.portraitAvailable && <Text style={styles.body}>No usable chip photo was available. Read the chip again to try for a photo.</Text>}
      <Text accessibilityRole="header" style={styles.label}>PRINTED DETAILS AND CHIP</Text>
      {Object.entries(passport.correspondence).map(([field, observation]) => <Details key={field}
        label={correspondenceLabels[field as keyof typeof correspondenceLabels] ?? field}
        value={observation === 'matches' ? 'Matches' : observation === 'differs' ? 'Different — review this field' : 'Not compared'} />)}
      {!Object.keys(passport.correspondence).length && <Text style={styles.body}>Printed details were not compared with the chip.</Text>}
    </View>
    {focus === 'passport' && faceCard}
    <Action secondary label={technical ? 'Hide check details' : 'View check details'} onPress={() => setTechnical(!technical)} />
    {technical && <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.sheetTitle}>Check details</Text>
      <Details label="Sex recorded on the chip" value={passport.sex} />
      {passport.personalNumber && <Details label="Personal number" value={passport.personalNumber} />}
      {(Object.keys(protocolLabels) as Array<keyof typeof protocolLabels>).map(key => <Details key={key}
        label={protocolLabels[key]} value={{succeeded: 'Succeeded', failed: 'Failed', notPerformed: 'Not performed'}[passport.protocols[key]]} />)}
      {comparison && <>
        <Details label="Similarity" value={String(comparison.similarity)} />
        <Details label="Comparison route" value={comparison.route} />
        {depth && <>
          <Details label="Face relief (RMS, metres)" value={depth.measurement.residualRMS == null ? 'Unavailable' : String(depth.measurement.residualRMS)} />
          <Details label="Depth samples" value={String(depth.measurement.sampleCount)} />
          <Details label="Depth age (seconds)" value={String(depth.ageAtAdmission)} />
          <Details label="Depth smoothing" value={depth.filtered ? 'Filtered' : 'Unfiltered'} />
          <Details label="Depth policy" value={depth.measurement.policy.identifier} />
          <Details label="Minimum relief (metres)" value={String(depth.measurement.policy.minimumResidualRMS)} />
          <Details label="Minimum samples" value={String(depth.measurement.policy.minimumSamples)} />
          <Details label="Maximum depth age (seconds)" value={String(depth.measurement.policy.maximumDepthAge)} />
          <Details label="Depth window (metres)" value={`${depth.measurement.policy.nearLimit}–${depth.measurement.policy.farLimit}`} />
          <Details label="Samples per axis" value={String(depth.measurement.policy.samplesPerAxis)} />
        </>}
        <Details label="Blink age (seconds)" value={String(comparison.admissionReceipt.blinkAge)} />
        <Details label="Steady hold (seconds)" value={String(comparison.admissionReceipt.steadyHoldDuration)} />
        <Details label="Model loading (seconds)" value={String(comparison.modelLoadingSeconds)} />
        <Details label="Comparison time (seconds)" value={String(comparison.comparisonSeconds)} />
        <Details label="Reference SHA-256" value={comparison.referenceSHA256} />
        <Details label="Selfie SHA-256" value={comparison.selfieSHA256} />
      </>}
    </View>}
  </>;
}
function displayDate(raw: string): string {
  if (!/^\d{6}$/.test(raw)) return raw;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(raw.slice(2, 4)) - 1];
  return month ? `${Number(raw.slice(4))} ${month} ’${raw.slice(0, 2)}` : raw;
}
function Details({label, value}: {label: string; value: string}) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>;
}
export function Action({label, onPress, disabled = false, testID, secondary = false}: {
  label: string; onPress: () => unknown; disabled?: boolean; testID?: string; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} testID={testID}
    onPress={() => { void onPress(); }} style={[styles.action, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={[styles.actionText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}
export const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#f4f5f8'}, content: {padding: 24, gap: 20, paddingBottom: 48},
  eyebrow: {color: '#233c69', fontWeight: '700', letterSpacing: 2},
  title: {fontSize: 32, fontWeight: '700', color: '#122b54'}, body: {fontSize: 18, lineHeight: 26, color: '#252c39'},
  label: {fontSize: 14, fontWeight: '700', color: '#4d576a'}, detail: {gap: 4},
  card: {padding: 20, gap: 16, backgroundColor: '#fff', borderRadius: 20},
  portraits: {flexDirection: 'row', gap: 12}, portrait: {flex: 1, gap: 8}, image: {height: 180, width: '100%'},
  camera: {flex: 1, backgroundColor: '#152032'}, cameraTop: {padding: 24, gap: 12},
  cameraBottom: {position: 'absolute', bottom: 20, left: 24, right: 24, gap: 12}, white: {color: '#fff'},
  guideCenter: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center'},
  oval: {borderWidth: 3, borderColor: '#fff', borderRadius: 1000},
  action: {backgroundColor: '#173965', padding: 16, minHeight: 52, borderRadius: 14, alignItems: 'center'},
  actionText: {color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center'}, disabled: {opacity: .45},
  secondary: {backgroundColor: '#e5eaf3'}, secondaryText: {color: '#173965'},
  scrim: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#0008', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%'},
  sheetContent: {padding: 28, paddingBottom: 40, gap: 22}, sheetTitle: {fontSize: 26, fontWeight: '700', color: '#122b54'},
});
