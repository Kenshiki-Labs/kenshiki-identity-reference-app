import React, {useEffect, useRef, useState} from 'react';
import {AppState, ScrollView, Text, View} from 'react-native';
import {IdentityCaptureSession} from '@kenshiki/identity-capture';
import type {Configuration, PhoneCheckReceipt, PhoneProviderObservation} from '@kenshiki/identity-capture';
import {Action, styles} from './IdentityCaptureFlow';
import {PhoneFlowController, type PhoneFlowState, type SavedPhoneCheck} from './PhoneFlowController';
import {SubscriberResultDetails} from './SubscriberResultDetails';
import {formatMoment} from './HolderText';

/** A receipt whose subscriber comparison contradicts the checked ID stops the phone step. The
 * holder may start a new check; the stopped receipt is never offered as a completed result. */
export function phoneCheckStopped(receipt: PhoneCheckReceipt): boolean {
  return receipt.subjectComparison?.status === 'contradicted' || receipt.subscriberComparison?.evaluation.status === 'notSatisfied';
}

export function PhoneFlow({configuration, saved, onComplete, onExit}: {
  configuration: Configuration; saved?: SavedPhoneCheck;
  onComplete: (value: SavedPhoneCheck) => void; onExit: () => void;
}) {
  const [controller, setController] = useState<PhoneFlowController>();
  const [state, setState] = useState<PhoneFlowState>({busy: false, paused: false});
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const leavingRef = useRef(false);
  useEffect(() => {
    const active = new PhoneFlowController(IdentityCaptureSession.create, configuration, setState, saved);
    setController(active); setState(active.state); void active.open();
    const subscription = AppState.addEventListener('change', next => {
      // Apple's message composer can make the app inactive. Only backgrounding cancels it.
      if (next === 'background') active.pause().catch(active.fail);
    });
    return () => { subscription.remove(); void active.dispose(); };
  }, [configuration, saved]);
  useEffect(() => {
    if (!state.snapshot?.sendAgainAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.snapshot?.sendAgainAt]);
  if (!controller) return <View style={styles.root} />;
  const finish = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true; setLeaving(true);
    try { const result = await controller.handoff(); if (result) onComplete(result); else onExit(); }
    catch (error) {
      // Ownership stays here; the failure is shown in this screen's sheet.
      leavingRef.current = false; setLeaving(false);
      if (!controller.state.sheet) controller.fail(error);
    }
  };
  const snapshot = state.snapshot;
  const busy = state.busy || leaving;
  const waiting = snapshot?.stage === 'waiting';
  const saving = snapshot?.stage === 'finishing';
  const terminal = ['expired', 'unknownChallenge', 'conflict', 'refused'].includes(snapshot?.failure ?? '');
  const stopped = !!snapshot?.receipt && phoneCheckStopped(snapshot.receipt);
  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.content} accessibilityElementsHidden={!!state.sheet}
      importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}>
      <Text style={styles.eyebrow}>IDENTITY</Text>
      <Text accessibilityRole="header" style={styles.title}>Phone</Text>
      {saving ? <View style={styles.card}>
        <Text style={styles.sheetTitle}>Save your result</Text>
        <Text style={styles.body}>The answer arrived. Saving again will not send another text or run another comparison.</Text>
        <Action label="Save result" onPress={controller.save} disabled={busy} testID="phone-save" />
      </View> : waiting ? <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>{state.paused ? 'Check paused' : 'Waiting for your text'}</Text>
        <Text style={styles.body}>We are checking for the text from your number. Sending it alone does not complete this check.</Text>
        {(state.paused || snapshot?.failure) && <Action label="Resume check" onPress={controller.resume} disabled={busy} testID="phone-resume" />}
        {snapshot?.sendAgainAt && <Text style={styles.label}>Another send is available after {formatMoment(snapshot.sendAgainAt)}. It uses the same challenge.</Text>}
        <Action label="Send text again" secondary onPress={controller.send}
          disabled={busy || (!!snapshot?.sendAgainAt && now < Date.parse(snapshot.sendAgainAt))} testID="phone-send-again" />
      </View> : (!snapshot?.receipt || snapshot.pending) && !terminal ? <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>Send one text from this phone</Text>
        <Text style={styles.body}>A message opens here with the number and code filled in. Tap Send, then return here for the result.</Text>
        <Text style={styles.body}>By continuing, you agree to have the sending number checked and its subscriber details compared with your checked ID. Your carrier may charge for the text.</Text>
        <Action label="Send text" onPress={controller.send} disabled={busy || !snapshot} testID="phone-send" />
        {snapshot?.challengeReserved && <Action label="Check for existing text" secondary onPress={controller.resume} disabled={busy} testID="phone-check-existing" />}
      </View> : null}
      {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>Please wait…</Text>}
      {terminal && <Action label="Start a new check" onPress={() => controller.ask('restart')} disabled={busy} />}
      {snapshot?.receipt && <>
        {snapshot.pending && <Text style={styles.eyebrow}>PREVIOUS CHECK</Text>}
        <PhoneResultDetails receipt={snapshot.receipt} />
        {stopped ? !snapshot.pending && <View testID="phone-stopped" style={{gap: 12}}>
          <Action label="Try again" onPress={() => controller.ask('restart')} disabled={busy} testID="phone-retry" />
        </View> : <>
          <Action label="Done" onPress={finish} disabled={leaving} testID="phone-done" />
          {!snapshot.pending && <Action label="Run a new check" secondary onPress={() => controller.ask('restart')} disabled={busy} testID="phone-new" />}
        </>}
      </>}
      <Action label="Back to Identity" secondary onPress={finish} disabled={leaving} testID="phone-back" />
      {snapshot && <Action label="Erase saved phone checks" secondary onPress={() => controller.ask('erase')} disabled={busy} testID="phone-erase" />}
    </ScrollView>
    {state.sheet && <View style={styles.scrim}><View style={styles.sheet} accessibilityViewIsModal testID="phone-bottom-sheet">
      <ScrollView contentContainerStyle={styles.sheetContent}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>{state.sheet.kind === 'error' ? 'Check needs attention' : state.sheet.kind === 'erase' ? 'Erase saved phone checks?' : 'Start a new phone check?'}</Text>
        <Text style={styles.body}>{state.sheet.kind === 'error' ? state.sheet.message : state.sheet.kind === 'erase'
          ? 'This removes saved phone receipts and pending checks from this app. It does not recall a text already sent.'
          : 'Your previous result stays available until the new check completes. You will choose when to send the next text.'}</Text>
        {state.sheet.kind !== 'error' && <Action label={state.sheet.kind === 'erase' ? 'Erase checks' : 'Start new check'} onPress={controller.confirm} disabled={busy} testID="phone-confirm" />}
        <Action label={state.sheet.kind === 'error' ? 'Back to check' : 'Keep current check'} secondary onPress={controller.dismiss} disabled={busy} />
        <Action label="Back to Identity" secondary onPress={finish} disabled={leaving} testID="phone-sheet-back" />
      </ScrollView>
    </View></View>}
  </View>;
}

export function PhoneResultDetails({receipt}: {receipt: PhoneCheckReceipt}) {
  const [showReceipt, setShowReceipt] = useState(false);
  const comparison = receipt.subjectComparison;
  const evidence = comparison?.evidence;
  const stopped = phoneCheckStopped(receipt);
  return <View testID="phone-result" style={styles.card}>
    <Text accessibilityRole="header" style={styles.sheetTitle}>{stopped ? 'Subscriber details differ from your ID' : 'Phone possession confirmed'}</Text>
    {stopped && <Text style={styles.body}>Your text was received, but the subscriber details held for this number do not match your checked ID. This check stops here and its result cannot be used. You can start a new check.</Text>}
    <Row label={stopped ? 'Number that sent the text' : 'Confirmed number'} value={'+' + receipt.sender} />
    <Row label="Text received" value={formatMoment(receipt.receivedAt)} />
    <Row label="Check completed" value={formatMoment(receipt.completedAt)} />
    {!stopped && <Text style={styles.body}>The service received a text from this number. Subscriber agreement is a separate finding.</Text>}
    <Text accessibilityRole="header" style={styles.sheetTitle}>Comparison with your ID</Text>
    {receipt.subscriberComparison || receipt.subscriberFailure
      ? <SubscriberResultDetails result={receipt.subscriberComparison} failure={receipt.subscriberFailure} />
      : <>
    <Row label="Reported outcome" value={comparison ? {agreed: 'Subscriber details agree', singleSource: 'One source reports agreement',
      contradicted: 'Subscriber details differ', unavailable: 'Comparison unavailable', notCompared: 'Not compared'}[comparison.status] : 'No comparison returned'} />
    {comparison && <>
      <Row label="Fields counted" value={comparison.fieldsCompared.map(fieldLabel).join(', ') || 'None reported'} />
      <Row label="Compared" value={formatMoment(comparison.checkedAt)} />
    </>}
    {evidence ? <>
      {evidence.fields.map((field, index) => <Row key={index} label={fieldLabel(field.field)} value={gradeLabel(field.grade)} />)}
      {!evidence.fields.length && <Text style={styles.body}>No individual field grades were returned.</Text>}
      {!evidence.providers.length && <Text style={styles.body}>No number checks were returned.</Text>}
      {evidence.providers.map((provider, index) => <NumberCheck key={index} index={index} provider={provider} />)}
    </> : <Text style={styles.body}>Number check details are not present in this saved receipt. Opening it does not run another check.</Text>}
    </>}
    <Action label={showReceipt ? 'Hide receipt details' : 'Show receipt details'} secondary
      onPress={() => setShowReceipt(value => !value)} testID="phone-receipt-details" />
    {showReceipt && <>
      <Row label="Challenge reference" value={receipt.challengeID} />
      <Row label="Message digest" value={receipt.messageHash} />
      <Row label="Number check request reference" value={evidence?.requestID} />
      {receipt.subscriberComparison && <>
        <Row label="Comparison reference" value={receipt.subscriberComparison.operationID} />
        <Row label="Policy version" value={receipt.subscriberComparison.evaluation.policyVersion} />
        <Row label="Profile version" value={receipt.subscriberComparison.profileVersion} />
      </>}
    </>}
  </View>;
}
/** Observations are labelled by what they measure. Rows appear only for values a check returned. */
function NumberCheck({provider, index}: {provider: PhoneProviderObservation; index: number}) {
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.sheetTitle}>{`Number check ${index + 1}`}</Text>
    <Row label="Answered" value={provider.answered} />
    {provider.failure != null && <Row label="Reported a failure" value={true} />}
    {provider.carrier != null && <Row label="Carrier" value={provider.carrier} />}
    {provider.lineType != null && <Row label="Line type" value={provider.lineType} />}
    {provider.originalCarrier != null && <Row label="Original carrier" value={provider.originalCarrier} />}
    {provider.carrierChanged != null && <Row label="Carrier change reported" value={provider.carrierChanged} />}
    {provider.risk != null && <Row label="Reported risk" value={provider.risk} />}
    {provider.smsFraudRiskScore != null && <Row label="Message fraud risk score" value={provider.smsFraudRiskScore} />}
    {provider.riskAdvisorScore != null && <Row label="Number risk score" value={provider.riskAdvisorScore} />}
    {provider.numberValid != null && <Row label="Number valid" value={provider.numberValid} />}
    {provider.formatValid != null && <Row label="Number format valid" value={provider.formatValid} />}
  </View>;
}
function Row({label, value}: {label: string; value?: string | number | boolean | null}) {
  const text = value == null || value === '' ? 'Not returned' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text style={styles.body}>{text}</Text></View>;
}
const fieldNames: Record<string, string> = {givenName: 'Given name', given_name: 'Given name', familyName: 'Family name', family_name: 'Family name',
  birthdate: 'Date of birth', address: 'Street address', locality: 'City', region: 'State or region', postalCode: 'Postal code', postal_code: 'Postal code', country: 'Country', idDocument: 'ID document'};
const grades: Record<string, string> = {match: 'Matches', no_match: 'Does not match', partial: 'Partial result', no_data: 'No data', unknown: 'Unrecognized result'};
function fieldLabel(value: string) { return fieldNames[value] ?? 'Other detail'; }
function gradeLabel(value: string) { return grades[value] ?? 'Unrecognized result'; }
