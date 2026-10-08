import React, {useEffect, useRef, useState} from 'react';
import {AppState, Keyboard, ScrollView, Text, TextInput, View} from 'react-native';
import {IdentityCaptureSession} from '@kenshiki/identity-capture';
import type {Configuration, SSNVerificationReceipt} from '@kenshiki/identity-capture';
import {Action, styles} from './IdentityCaptureFlow';
import {SSNFlowController, type SavedSSNCheck, type SSNFlowState} from './SSNFlowController';

export function SSNFlow({configuration, saved, onComplete, onExit}: {
  configuration: Configuration; saved?: SavedSSNCheck;
  onComplete: (value: SavedSSNCheck) => void; onExit: () => void;
}) {
  const [controller, setController] = useState<SSNFlowController>();
  const [state, setState] = useState<SSNFlowState>({digits: '', busy: false, editing: true});
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  useEffect(() => {
    const active = new SSNFlowController(IdentityCaptureSession.create, configuration, setState, saved);
    setController(active); setState(active.state); void active.open();
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') { Keyboard.dismiss(); void active.pause(); }
    });
    return () => { subscription.remove(); void active.dispose(); };
  }, [configuration, saved]);
  if (!controller) return <View style={styles.root} />;
  const finish = async () => {
    if (finishingRef.current) return;
    Keyboard.dismiss(); finishingRef.current = true; setFinishing(true);
    try { const result = await controller.handoff(); if (result) onComplete(result); else onExit(); }
    catch { finishingRef.current = false; setFinishing(false); }
  };
  const busy = state.busy || finishing;
  const snapshot = state.snapshot;
  const receipt = snapshot?.receipt;
  const pending = snapshot?.recoveryNeeded;
  const confirmation = snapshot?.confirmation;
  const close = <Action label="Back to Identity" secondary testID="ssn-back-to-identity" onPress={finish} disabled={finishing} />;
  const recovery = state.sheet?.kind === 'recovery' ? state.sheet : undefined;
  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      accessibilityElementsHidden={!!state.sheet} importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}>
      <Text style={styles.eyebrow}>IDENTITY</Text>
      <Text accessibilityRole="header" style={styles.title}>Social Security number</Text>
      <Text style={styles.body}>Check whether your Social Security number was issued. This does not confirm who owns the number.</Text>
      {busy ? <Text accessibilityLiveRegion="polite" style={styles.body}>Checking…</Text> : pending ? <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>Check in progress</Text>
        <Text style={styles.body}>Your request is saved. Check its status to continue.</Text>
        <Action label="Check status" testID="ssn-check-status" onPress={controller.recover} />
      </View> : state.editing ? <>
        <Text style={styles.label}>Social Security number</Text>
        <TextInput testID="ssn-entry" accessibilityLabel="Social Security number" keyboardType="number-pad"
          autoCorrect={false} autoCapitalize="none" autoComplete="off" importantForAutofill="no"
          value={formatNumber(state.digits)} onChangeText={controller.setDigits} editable={!busy}
          placeholder="000-00-0000" style={[styles.card, {fontSize: 28, color: '#112f59'}]} />
        <Text style={styles.body}>You will confirm every digit before the check starts. Your entered number is cleared when you leave this screen.</Text>
        <Action label="Review number" testID="ssn-review-number" disabled={busy || state.digits.length !== 9}
          onPress={() => { Keyboard.dismiss(); void controller.requestConfirmation(); }} />
      </> : null}
      {receipt && <>
        {pending && <Text style={styles.eyebrow}>PREVIOUS CHECK</Text>}
        <SSNResultDetails receipt={receipt} />
        {!pending && !state.editing && <>
          <Action label="Done" testID="finish-ssn" onPress={finish} disabled={busy} />
          <Action label="Check another number" secondary testID="ssn-check-again" onPress={controller.edit} disabled={busy} />
        </>}
      </>}
      {close}
    </ScrollView>
    {state.sheet && <View style={styles.scrim}><View style={styles.sheet} accessibilityViewIsModal testID="ssn-bottom-sheet">
      <ScrollView contentContainerStyle={styles.sheetContent}>
        {state.sheet.kind === 'confirmation' && confirmation ? <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>Confirm your number</Text>
          <Text style={styles.body}>Check every digit. This is the number that will be sent for the issuance check.</Text>
          <Text style={styles.title} testID="ssn-confirmation-number">{formatNumber(confirmation.digits)}</Text>
          <Action label="Confirm and check" testID="ssn-confirm" onPress={controller.confirm} disabled={busy} />
          <Action label="Edit number" testID="ssn-edit" secondary onPress={controller.edit} disabled={busy} />
        </> : recovery ? <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{recovery.title}</Text>
          <Text style={styles.body}>{recovery.message}</Text>
          {recovery.recovery !== 'exit' && <Action label={recovery.recovery === 'status' ? 'Check status' : 'Try again'}
            testID="ssn-retry" onPress={controller.retry} disabled={busy} />}
        </> : null}
        {close}
      </ScrollView>
    </View></View>}
  </View>;
}

export function ssnSummary(receipt: SSNVerificationReceipt): string {
  if (receipt.reportKind === 'historicalComposite') return 'Earlier check available';
  return receipt.issuance === 'issued' ? 'Issuance confirmed' : receipt.issuance === 'notIssued' ? 'Issuance not confirmed' : 'Issuance unavailable';
}
export function SSNResultDetails({receipt}: {receipt: SSNVerificationReceipt}) {
  return <View style={styles.card} testID="ssn-result">
    <Text accessibilityRole="header" style={styles.sheetTitle}>{ssnSummary(receipt)}</Text>
    {receipt.reportKind === 'historicalComposite' && <>
      <Text style={styles.body}>This earlier report included other checks. Its overall answer is shown separately.</Text>
      <ResultRow label="Earlier overall answer" value={receipt.reportedOutcome === 'affirmative' ? 'Affirmative' : receipt.reportedOutcome === 'negative' ? 'Negative' : 'Unavailable'} />
    </>}
    <ResultRow label="Was the number issued?" value={receipt.issuance === 'issued' ? 'Yes' : receipt.issuance === 'notIssued' ? 'No' : 'Unavailable'} />
    <ResultRow label="Checked" value={receipt.checkedAt} />
    <Text style={styles.body}>This result does not establish that the number belongs to you.</Text>
    {receipt.details?.region && <ResultRow label="Issuance region" value={receipt.details.region} />}
    {receipt.details?.issueStart && <ResultRow label="Issuance period starts" value={receipt.details.issueStart} />}
    {receipt.details?.issueEnd && <ResultRow label="Issuance period ends" value={receipt.details.issueEnd} />}
    {receipt.details?.codeDescription && <ResultRow label="Reported detail" value={receipt.details.codeDescription} />}
  </View>;
}
function ResultRow({label, value}: {label: string; value: string}) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>;
}
export function formatNumber(digits: string): string {
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 9)].filter(Boolean).join('-');
}
