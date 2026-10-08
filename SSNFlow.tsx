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
  const [state, setState] = useState<SSNFlowState>({digits: '', busy: false, editing: false});
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
  const needsRecovery = snapshot?.recoveryNeeded;
  const saving = snapshot?.state === 'finishing';
  const confirmation = snapshot?.confirmation;
  const close = <Action label="Back to Identity" secondary testID="ssn-back-to-identity" onPress={finish} disabled={finishing} />;
  const recovery = state.sheet?.kind === 'recovery' ? state.sheet : undefined;
  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      accessibilityElementsHidden={!!state.sheet} importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}>
      <Text style={styles.eyebrow}>IDENTITY</Text>
      <Text accessibilityRole="header" style={styles.title}>Social Security number</Text>
      <Text style={styles.body}>Check whether your Social Security number was issued. This does not confirm who owns the number.</Text>
      {busy ? <Text accessibilityLiveRegion="polite" style={styles.body}>Checking…</Text> : saving ? <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>Save your result</Text>
        <Text style={styles.body}>The answer arrived but could not be saved on this phone. Saving again will not send another check.</Text>
        <Action label="Save result" testID="ssn-save-result" onPress={controller.recover} />
      </View> : needsRecovery && !state.editing ? <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>The result was not received</Text>
        <Text style={styles.body}>The previous check may have happened. You can leave this check here or review your number for a new request.</Text>
        <Action label="Enter number again" testID="ssn-new-attempt" onPress={controller.beginEntry} />
      </View> : state.editing ? <>
        <Text style={styles.label}>Social Security number</Text>
        <TextInput testID="ssn-entry" accessibilityLabel="Social Security number" keyboardType="number-pad"
          autoCorrect={false} autoCapitalize="none" autoComplete="off" importantForAutofill="no"
          value={formatNumber(state.digits)} onChangeText={controller.setDigits} editable={!busy}
          placeholder="000-00-0000" style={[styles.card, {fontSize: 28, color: '#112f59'}]} />
        <Text style={styles.body}>You will confirm every digit before the check starts. Your entered number is cleared when you leave this screen.</Text>
        <Action label="Review number" testID="ssn-review-number" disabled={busy || state.digits.length !== 9}
          onPress={() => { Keyboard.dismiss(); void controller.requestConfirmation(); }} />
      </> : !receipt ? <Action label="Enter SSN" testID="ssn-begin-entry" onPress={controller.beginEntry} disabled={busy || !snapshot} /> : null}
      {receipt && <>
        {needsRecovery && <Text style={styles.eyebrow}>PREVIOUS CHECK</Text>}
        <SSNResultDetails receipt={receipt} />
        {!needsRecovery && !state.editing && <>
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
          {confirmation.purpose === 'replacementAfterUnknownOutcome' && <Text style={styles.body} testID="ssn-replacement-warning">
            The previous check may have happened. Confirming sends a new request.
          </Text>}
          <Text style={styles.title} testID="ssn-confirmation-number">{formatNumber(confirmation.digits)}</Text>
          <Action label="Confirm and check" testID="ssn-confirm" onPress={controller.confirm} disabled={busy} />
          <Action label="Edit number" testID="ssn-edit" secondary onPress={controller.edit} disabled={busy} />
        </> : recovery ? <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{recovery.title}</Text>
          <Text style={styles.body}>{recovery.message}</Text>
          {recovery.recovery !== 'exit' && <Action label={recovery.recovery === 'localSave' ? 'Save result' : recovery.recovery === 'fresh' ? 'Enter number again' : 'Try again'}
            testID="ssn-retry" onPress={controller.retry} disabled={busy} />}
        </> : null}
        {close}
      </ScrollView>
    </View></View>}
  </View>;
}

export function ssnSummary(receipt: SSNVerificationReceipt): string {
  return receipt.issuance === 'issued' ? 'Issuance confirmed' : receipt.issuance === 'notIssued' ? 'Issuance not confirmed' : 'Issuance unavailable';
}
export function SSNResultDetails({receipt}: {receipt: SSNVerificationReceipt}) {
  const details = receipt.details;
  const reported = (value?: string | null) => value?.trim() || 'Not returned';
  return <View style={styles.card} testID="ssn-result">
    <Text accessibilityRole="header" style={styles.sheetTitle}>{ssnSummary(receipt)}</Text>
    <ResultRow label="Was the number issued?" value={receipt.issuance === 'issued' ? 'Yes' : receipt.issuance === 'notIssued' ? 'No' : 'Unavailable'} />
    {details ? <>
      <Text accessibilityRole="header" style={styles.sheetTitle}>Returned findings</Text>
      <ResultRow label="Issuing state" value={reported(details.region)} />
      <ResultRow label="Issuance period begins" value={reported(details.issueStart)} />
      <ResultRow label="Issuance period ends" value={reported(details.issueEnd)} />
      <ResultRow label="Provider classification" value={reported(details.codeDescription)} />
      <ResultRow label="Classification code" value={reported(details.code)} />
      <ResultRow label="Source" value={reported(details.source)} />
      <ResultRow label="Reported status" value={reported(details.reportedStatus)} />
      <ResultRow label="Response code" value={details.responseCode == null ? 'Not returned' : String(details.responseCode)} />
    </> : <Text style={styles.body}>This earlier check saved only the issuance result. Provider details were not retained. A new confirmed check is needed to obtain them.</Text>}
    <ResultRow label="Checked" value={receipt.checkedAt} />
    <Text style={styles.body}>This result does not establish that the number belongs to you.</Text>
  </View>;
}
function ResultRow({label, value}: {label: string; value: string}) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text selectable style={styles.body}>{value}</Text></View>;
}
export function formatNumber(digits: string): string {
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 9)].filter(Boolean).join('-');
}
