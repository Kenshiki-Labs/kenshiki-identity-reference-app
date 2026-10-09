import React, {useEffect, useRef, useState} from 'react';
import {AppState, ScrollView, Text, TextInput, View} from 'react-native';
import type {CaptureErrorCode, DocumentCheckFailureCode, DocumentCheckSnapshot, IdentityCaptureSession} from '@kenshiki/identity-capture';
import {IdentitySheet} from './IdentitySheetHost';
import {Action, styles} from './IdentityCaptureFlow';
import {errorCode, errorText, formatMoment, type ErrorText} from './HolderText';
import {t} from './locales/i18n';

const labels = {recordMatched: t('documentCheck.outcome.recordMatched'), recordNotMatched: t('documentCheck.outcome.recordNotMatched'),
  pending: t('documentCheck.outcome.pending'), unavailable: t('documentCheck.outcome.unavailable'),
  needsCorrection: t('documentCheck.outcome.needsCorrection'), inconclusive: t('documentCheck.outcome.inconclusive')};
/** Text shared by the snapshot's failure field and command rejections. */
const checkFailures = {
  readerUnbound: t('documentCheck.failure.readerUnbound'),
  requestRejected: t('documentCheck.failure.requestRejected'),
  serviceUnavailable: t('documentCheck.failure.serviceUnavailable'),
  replyRejected: t('documentCheck.failure.replyRejected'),
  requestConflict: t('documentCheck.failure.requestConflict'),
  nothingToAskAgain: t('documentCheck.failure.nothingToAskAgain'),
  correctionNotRequested: t('documentCheck.failure.correctionNotRequested'),
  busy: t('documentCheck.failure.busy'),
  cancelled: t('documentCheck.failure.cancelled'),
} satisfies Partial<Record<Extract<DocumentCheckFailureCode, CaptureErrorCode>, string>>;
/** `DocumentCheckSnapshot.failure` has its own closed vocabulary. */
const snapshotFailures: Partial<Record<DocumentCheckFailureCode, string>> = {
  ...checkFailures,
  custodyUnavailable: t('documentCheck.failure.custodyUnavailable'),
};
/** Command rejections, by code. */
const failures: ErrorText = {
  ...checkFailures,
  consentRequired: t('documentCheck.failure.consentRequired'),
  documentCheckNotConfigured: t('documentCheck.failure.documentCheckNotConfigured'),
  documentFrontRequired: t('documentCheck.failure.documentFrontRequired'),
  invalidArgument: t('documentCheck.failure.invalidArgument'),
  documentCustodyFailed: t('documentCheck.failure.documentCustodyFailed'),
  sessionUnavailable: t('documentCheck.failure.sessionUnavailable'),
};
const fieldNames: Record<string, string> = {
  givenName: t('documentCheck.field.givenName'), familyName: t('documentCheck.field.familyName'),
  middleName: t('documentCheck.field.middleName'), birthDate: t('documentCheck.field.birthDate'),
  documentNumber: t('documentCheck.field.documentNumber'), expiryDate: t('documentCheck.field.expiryDate'),
  issueDate: t('documentCheck.field.issueDate'), addressLine1: t('documentCheck.field.addressLine1'),
  addressLine2: t('documentCheck.field.addressLine2'), city: t('documentCheck.field.city'), region: t('documentCheck.field.region'),
  postalCode: t('documentCheck.field.postalCode'), issuingState: t('documentCheck.field.issuingState'),
};
const fieldLabel = (field: string) => fieldNames[field] ?? t('common.otherDetail');
const correctionText: Record<string, string> = {
  required: t('documentCheck.correction.required'), mismatch: t('documentCheck.correction.mismatch'),
  invalid: t('documentCheck.correction.invalid'),
};

/** No request runs on mount or reopening. Only explicit holder actions can dispatch a check. */
export function DocumentCheckPanel({session, configured}: {session: IdentityCaptureSession; configured: boolean}) {
  const [snapshot, setSnapshot] = useState<DocumentCheckSnapshot>();
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'failure' | 'correction'>();
  const [error, setError] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const alive = useRef(true);
  const occupied = useRef(false);
  const run = async (action: () => Promise<DocumentCheckSnapshot>) => {
    if (occupied.current) return;
    occupied.current = true; setBusy(true);
    try {
      const result = await action();
      if (alive.current) { setSnapshot(result); setSheet(undefined); }
    } catch (failure) {
      if (alive.current) {
        setError(errorText(errorCode(failure), failures, t('documentCheck.failure.other')));
        setSheet('failure');
      }
    } finally { occupied.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    alive.current = true;
    if (configured) void run(() => session.documentCheckRestore());
    const listener = AppState.addEventListener('change', next => {
      if (next === 'background') { setEdits({}); setSheet(undefined); void session.cancel(); }
    });
    return () => { alive.current = false; listener.remove(); };
  }, [session, configured]);
  const result = snapshot?.result;
  const needsReply = snapshot?.state === 'unanswered' || result?.outcome === 'pending' || result?.outcome === 'unavailable';
  const failure = snapshot?.failure ? snapshotFailures[snapshot.failure] ?? '' : '';
  return <View style={styles.card} testID="document-check-panel">
    <Text accessibilityRole="header" style={styles.sheetTitle}>{t('documentCheck.title')}</Text>
    {!configured ? <Text style={styles.body}>{t('documentCheck.notConfigured')}</Text> : <>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{busy ? t('documentCheck.busy') : result ? labels[result.outcome] :
        snapshot?.state === 'unanswered' ? t('documentCheck.state.unanswered') :
        snapshot?.state === 'readerUnavailable' ? failure || t('documentCheck.state.readerUnavailable') :
        snapshot?.state === 'unreadable' ? t('documentCheck.state.unreadable') :
        snapshot?.state === 'unavailable' ? failure || t('documentCheck.state.unavailable') : t('documentCheck.state.notStarted')}</Text>
      {snapshot?.checkedAt && <Text style={styles.body}>{t('documentCheck.checkedAt', {moment: formatMoment(snapshot.checkedAt)})}</Text>}
      {result && <>
        <Text style={styles.body}>{result.providerChecks.length
          ? t('documentCheck.providerChecks', {count: result.providerChecks.length})
          : t('documentCheck.noProviderChecks')}</Text>
        {result.submittedFields ? <>
          <Text accessibilityRole="header" style={styles.label}>{t('documentCheck.submittedHeading')}</Text>
          {Object.entries(result.submittedFields).map(([field, value]) => <View key={field} style={styles.detail}>
            <Text style={styles.label}>{fieldLabel(field)}</Text><Text style={styles.body}>{value}</Text>
          </View>)}
        </> : <Text style={styles.body}>{t('documentCheck.noSubmitted')}</Text>}
        <Text style={styles.body}>{result.replayed ? t('documentCheck.replayed') : t('documentCheck.fresh')}</Text>
        {result.receipt ? <View style={styles.detail}>
          <Text style={styles.label}>{t('documentCheck.receipt.title')}</Text>
          <Text style={styles.body}>{t('documentCheck.receipt.version', {value: result.receipt.serviceVersion})}</Text>
          <Text style={styles.body}>{t('documentCheck.receipt.answeredRequest', {value: result.receipt.answeredRequestSHA256})}</Text>
          <Text style={styles.body}>{t('documentCheck.receipt.observations', {value: result.receipt.observationSHA256})}</Text>
        </View> : <Text style={styles.body}>{t('documentCheck.receipt.missing')}</Text>}
        <Text style={styles.body}>{t('documentCheck.operation', {value: result.operationID})}</Text>
        {result.verificationID && <Text style={styles.body}>{t('documentCheck.verification', {value: result.verificationID})}</Text>}
      </>}
      {snapshot?.state === 'notStarted' && <Action label={t('documentCheck.action.check')} testID="check-document-record" disabled={busy}
        onPress={() => run(() => session.documentCheck(true))} />}
      {needsReply && <Action label={t('documentCheck.action.askAgain')} disabled={busy} testID="document-check-ask-again"
        onPress={() => run(() => session.documentCheckAskAgain(true))} />}
      {result?.outcome === 'needsCorrection' && <Action label={t('documentCheck.action.reviewCorrections')} disabled={busy}
        onPress={() => { setEdits({}); setSheet('correction'); }} />}
      {snapshot?.state === 'readerUnavailable' && <Action label={t('documentCheck.action.readAgain')} disabled={busy}
        onPress={() => run(() => session.documentCheck(true))} />}
      <Action label={t('documentCheck.action.reopenStatus')} secondary disabled={busy} onPress={() => run(() => session.documentCheckRestore())} />
    </>}
    <IdentitySheet>{sheet ? <View testID="document-check-bottom-sheet">
      <ScrollView contentContainerStyle={styles.sheetContent}>
        <Text style={styles.sheetTitle}>{sheet === 'correction' ? t('documentCheck.sheet.correctionTitle') : t('common.checkNeedsAttention')}</Text>
        {sheet === 'correction' ? <>
          {result?.correctable.map(({field, code}) => <View key={field}>
            <Text style={styles.label}>{fieldLabel(field)}</Text>
            <Text style={styles.body}>{correctionText[code] ?? t('documentCheck.correction.other')}</Text>
            <TextInput accessibilityLabel={fieldLabel(field)} value={edits[field] ?? ''} autoCorrect={false}
              onChangeText={value => setEdits(previous => ({...previous, [field]: value}))} style={styles.body} />
          </View>)}
          <Action label={t('documentCheck.action.submitCorrections')} disabled={busy || !Object.values(edits).some(value => value.trim())}
            onPress={() => run(() => session.documentCheckCorrect(edits, true))} />
        </> : <><Text style={styles.body}>{error}</Text><Action label={t('documentCheck.action.reopenSaved')} disabled={busy}
          onPress={() => run(() => session.documentCheckRestore())} /></>}
        <Action label={t('common.backToResults')} secondary disabled={busy} onPress={() => { setEdits({}); setSheet(undefined); }} />
      </ScrollView>
    </View> : undefined}</IdentitySheet>
  </View>;
}
