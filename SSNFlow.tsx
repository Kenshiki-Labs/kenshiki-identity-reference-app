import React, {useEffect, useRef, useState} from 'react';
import {AppState, Keyboard, ScrollView, Text, TextInput, View} from 'react-native';
import {IdentityCaptureSession} from '@kenshiki/identity-capture';
import type {Configuration, SSNVerificationReceipt} from '@kenshiki/identity-capture';
import {Action, styles} from './IdentityCaptureFlow';
import {SSNFlowController, type SavedSSNCheck, type SSNFlowState} from './SSNFlowController';
import {formatCalendarDate, formatMoment} from './HolderText';
import {t} from './locales/i18n';

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
    catch (error) {
      // Ownership stays here; the failure is shown in this screen's sheet.
      finishingRef.current = false; setFinishing(false);
      if (!controller.state.sheet) controller.fail(error);
    }
  };
  const busy = state.busy || finishing;
  const snapshot = state.snapshot;
  const receipt = snapshot?.receipt;
  const needsRecovery = snapshot?.recoveryNeeded;
  const saving = snapshot?.state === 'finishing';
  const confirmation = snapshot?.confirmation;
  const close = <Action label={t('common.backToIdentity')} secondary testID="ssn-back-to-identity" onPress={finish} disabled={finishing} />;
  const recovery = state.sheet?.kind === 'recovery' ? state.sheet : undefined;
  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      accessibilityElementsHidden={!!state.sheet} importantForAccessibility={state.sheet ? 'no-hide-descendants' : 'auto'}>
      <Text style={styles.eyebrow}>{t('common.eyebrow')}</Text>
      <Text accessibilityRole="header" style={styles.title}>{t('common.socialSecurityNumber')}</Text>
      <Text style={styles.body}>{t('ssn.intro')}</Text>
      {busy ? <Text accessibilityLiveRegion="polite" style={styles.body}>{t('ssn.checking')}</Text> : saving ? <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>{t('common.saveYourResult')}</Text>
        <Text style={styles.body}>{t('ssn.saveBody')}</Text>
        <Action label={t('common.saveResult')} testID="ssn-save-result" onPress={controller.recover} />
      </View> : needsRecovery && !state.editing ? <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>{t('ssn.notReceivedTitle')}</Text>
        <Text style={styles.body}>{t('ssn.notReceivedBody')}</Text>
        <Action label={t('ssn.enterAgain')} testID="ssn-new-attempt" onPress={controller.beginEntry} />
      </View> : state.editing ? <>
        <Text style={styles.label}>{t('common.socialSecurityNumber')}</Text>
        <TextInput testID="ssn-entry" accessibilityLabel={t('common.socialSecurityNumber')} keyboardType="number-pad"
          autoCorrect={false} autoCapitalize="none" autoComplete="off" importantForAutofill="no"
          value={state.digits} onChangeText={controller.setDigits} editable={!busy}
          placeholder={t('ssn.placeholder')} style={[styles.card, styles.entry]} />
        <Text style={styles.body}>{t('ssn.entryNotice')}</Text>
        <Action label={t('ssn.reviewNumber')} testID="ssn-review-number" disabled={busy || state.digits.length !== 9}
          onPress={() => { Keyboard.dismiss(); void controller.requestConfirmation(); }} />
      </> : !receipt ? <Action label={t('ssn.enter')} testID="ssn-begin-entry" onPress={controller.beginEntry} disabled={busy || !snapshot} /> : null}
      {receipt && <>
        {needsRecovery && <Text style={styles.eyebrow}>{t('common.previousCheck')}</Text>}
        <SSNResultDetails receipt={receipt} />
        {!needsRecovery && !state.editing && <>
          <Action label={t('common.done')} testID="finish-ssn" onPress={finish} disabled={busy} />
          <Action label={t('common.runNewCheck')} secondary testID="ssn-check-again" onPress={controller.edit} disabled={busy} />
        </>}
      </>}
      {snapshot && <Action label={t('ssn.erase')} secondary testID="ssn-erase" onPress={controller.askErase} disabled={busy} />}
      {close}
    </ScrollView>
    {state.sheet && <View style={styles.scrim}><View style={styles.sheet} accessibilityViewIsModal testID="ssn-bottom-sheet">
      <ScrollView contentContainerStyle={styles.sheetContent}>
        {state.sheet.kind === 'confirmation' && confirmation ? <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{t('ssn.confirm.title')}</Text>
          <Text style={styles.body}>{t('ssn.confirm.body')}</Text>
          {confirmation.purpose === 'replacementAfterUnknownOutcome' && <Text style={styles.body} testID="ssn-replacement-warning">
            {t('ssn.confirm.replacement')}
          </Text>}
          <Text style={styles.title} testID="ssn-confirmation-number">{formatNumber(confirmation.digits)}</Text>
          <Action label={t('ssn.confirm.action')} testID="ssn-confirm" onPress={controller.confirm} disabled={busy} />
          <Action label={t('ssn.confirm.edit')} testID="ssn-edit" secondary onPress={controller.edit} disabled={busy} />
        </> : state.sheet.kind === 'erase' ? <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{t('ssn.eraseSheet.title')}</Text>
          <Text style={styles.body}>{t('ssn.eraseSheet.body')}</Text>
          <Action label={t('common.eraseChecks')} testID="ssn-confirm-erase" onPress={controller.erase} disabled={busy} />
          <Action label={t('ssn.eraseSheet.keep')} secondary onPress={controller.dismiss} disabled={busy} />
        </> : recovery ? <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{recovery.title}</Text>
          <Text style={styles.body}>{recovery.message}</Text>
          {recovery.recovery !== 'exit' && <Action label={recovery.recovery === 'localSave' ? t('common.saveResult') : recovery.recovery === 'fresh' ? t('ssn.enterAgain') : t('common.tryAgain')}
            testID="ssn-retry" onPress={controller.retry} disabled={busy} />}
        </> : null}
        {close}
      </ScrollView>
    </View></View>}
  </View>;
}

/** States what the checking service reported. Issuance is never presented as verification. */
export function ssnSummary(receipt: SSNVerificationReceipt): string {
  return receipt.issuance === 'issued' ? t('ssn.summary.issued') : receipt.issuance === 'notIssued' ? t('ssn.summary.notIssued') : t('ssn.summary.unavailable');
}
export function SSNResultDetails({receipt}: {receipt: SSNVerificationReceipt}) {
  const details = receipt.details;
  const reported = (value?: string | null) => value?.trim() || t('common.notReturned');
  return <View style={styles.card} testID="ssn-result">
    <Text accessibilityRole="header" style={styles.sheetTitle}>{ssnSummary(receipt)}</Text>
    <ResultRow label={t('ssn.result.reportedLabel')} value={receipt.issuance === 'issued' ? t('ssn.result.issued')
      : receipt.issuance === 'notIssued' ? t('ssn.result.notIssued') : t('ssn.result.unavailable')} />
    {details ? <>
      <Text accessibilityRole="header" style={styles.sheetTitle}>{t('ssn.result.findings')}</Text>
      <ResultRow label={t('ssn.result.region')} value={reported(details.region)} />
      <ResultRow label={t('ssn.result.issueStart')} value={details.issueStart ? formatCalendarDate(details.issueStart) : t('common.notReturned')} />
      <ResultRow label={t('ssn.result.issueEnd')} value={details.issueEnd ? formatCalendarDate(details.issueEnd) : t('common.notReturned')} />
      <ResultRow label={t('ssn.result.classification')} value={reported(details.codeDescription)} />
      <ResultRow label={t('ssn.result.classificationCode')} value={reported(details.code)} />
      <ResultRow label={t('ssn.result.reportedStatus')} value={reported(details.reportedStatus)} />
      <ResultRow label={t('ssn.result.responseCode')} value={details.responseCode == null ? t('common.notReturned') : String(details.responseCode)} />
    </> : <Text style={styles.body}>{t('ssn.result.issuanceOnly')}</Text>}
    <ResultRow label={t('ssn.result.checked')} value={formatMoment(receipt.checkedAt)} />
    <Text style={styles.body}>{t('ssn.result.ownership')}</Text>
  </View>;
}
function ResultRow({label, value}: {label: string; value: string}) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text style={styles.body}>{value}</Text></View>;
}
export function formatNumber(digits: string): string {
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 9)].filter(Boolean).join('-');
}
