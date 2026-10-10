import type { CaptureErrorCode, DocumentCheckFailureCode } from '@kenshiki/identity-capture';
import { useCallback, useState } from 'react';
import { AppState, Text, TextInput, View } from 'react-native';
import {
  DocumentCheckController,
  type DocumentCheckPort,
  type DocumentCheckState,
} from './DocumentCheckController';
import { type ErrorText, errorCode, errorText, formatMoment } from './HolderText';
import { t } from './locales/i18n';
import { Action } from './ui/Action';
import { NativeSheet } from './ui/NativeSheet';
import { styles } from './ui/styles';
import { useControllerState } from './ui/useControllerState';

const labels = {
  recordMatched: t('documentCheck.outcome.recordMatched'),
  recordNotMatched: t('documentCheck.outcome.recordNotMatched'),
  pending: t('documentCheck.outcome.pending'),
  unavailable: t('documentCheck.outcome.unavailable'),
  needsCorrection: t('documentCheck.outcome.needsCorrection'),
  inconclusive: t('documentCheck.outcome.inconclusive'),
};
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
  givenName: t('documentCheck.field.givenName'),
  familyName: t('documentCheck.field.familyName'),
  middleName: t('documentCheck.field.middleName'),
  birthDate: t('documentCheck.field.birthDate'),
  documentNumber: t('documentCheck.field.documentNumber'),
  expiryDate: t('documentCheck.field.expiryDate'),
  issueDate: t('documentCheck.field.issueDate'),
  addressLine1: t('documentCheck.field.addressLine1'),
  addressLine2: t('documentCheck.field.addressLine2'),
  city: t('documentCheck.field.city'),
  region: t('documentCheck.field.region'),
  postalCode: t('documentCheck.field.postalCode'),
  issuingState: t('documentCheck.field.issuingState'),
};
const fieldLabel = (field: string) => fieldNames[field] ?? t('common.otherDetail');
const correctionText: Record<string, string> = {
  required: t('documentCheck.correction.required'),
  mismatch: t('documentCheck.correction.mismatch'),
  invalid: t('documentCheck.correction.invalid'),
};

/** Remount the presentation when custody changes; no old holder state is rendered. */
export function DocumentCheckPanel(props: { session: DocumentCheckPort; configured: boolean }) {
  return <DocumentCheckView key={`${props.session.id}:${props.configured}`} {...props} />;
}

const initialState: DocumentCheckState = { snapshot: undefined, busy: false, failure: undefined };

/** Reopening restores local status. Only holder actions can dispatch a check. */
function DocumentCheckView({ session, configured }: { session: DocumentCheckPort; configured: boolean }) {
  const [sheet, setSheet] = useState<'failure' | 'correction'>();
  const [error, setError] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const connect = useCallback(
    (publish: (state: DocumentCheckState) => void) => {
      const active = new DocumentCheckController(session, (next) => {
        publish(next);
        if (next.failure) {
          setError(errorText(errorCode(next.failure.cause), failures, t('documentCheck.failure.other')));
          setSheet('failure');
        } else if (!next.busy) setSheet(undefined);
      });
      if (configured) active.restore().catch(active.fail);
      const listener = AppState.addEventListener('change', (next) => {
        if (next === 'background') {
          setEdits({});
          setSheet(undefined);
          active.pause().catch(active.fail);
        }
      });
      return {
        controller: active,
        initialState: active.state,
        dispose: (): undefined => {
          active.dispose();
          listener.remove();
        },
      };
    },
    [session, configured],
  );
  const { controller, state, failed } = useControllerState(initialState, connect);
  const { snapshot, busy } = state;
  const result = snapshot?.result;
  const needsReply =
    snapshot?.state === 'unanswered' || result?.outcome === 'pending' || result?.outcome === 'unavailable';
  const failure = snapshot?.failure ? (snapshotFailures[snapshot.failure] ?? '') : '';
  function statusText() {
    if (busy) return t('documentCheck.busy');
    if (result) return labels[result.outcome];
    switch (snapshot?.state) {
      case 'unanswered':
        return t('documentCheck.state.unanswered');
      case 'readerUnavailable':
        return failure || t('documentCheck.state.readerUnavailable');
      case 'unreadable':
        return t('documentCheck.state.unreadable');
      case 'unavailable':
        return failure || t('documentCheck.state.unavailable');
      default:
        return t('documentCheck.state.notStarted');
    }
  }
  function renderCheckStatus() {
    if (failed)
      return (
        <Text accessibilityRole="alert" style={styles.body}>
          {t('common.sessionRecovery')}
        </Text>
      );
    if (!configured) {
      return <Text style={styles.body}>{t('documentCheck.notConfigured')}</Text>;
    }
    return (
      <>
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {statusText()}
        </Text>
        {snapshot?.checkedAt && (
          <Text style={styles.body}>
            {t('documentCheck.checkedAt', { moment: formatMoment(snapshot.checkedAt) })}
          </Text>
        )}
        {renderReturnedCheck()}
        {snapshot?.state === 'notStarted' && (
          <Action
            label={t('documentCheck.action.check')}
            testID="check-document-record"
            disabled={busy}
            onPress={() => controller?.check()}
          />
        )}
        {needsReply && (
          <Action
            label={t('documentCheck.action.askAgain')}
            disabled={busy}
            testID="document-check-ask-again"
            onPress={() => controller?.askAgain()}
          />
        )}
        {result?.outcome === 'needsCorrection' && (
          <Action
            label={t('documentCheck.action.reviewCorrections')}
            disabled={busy}
            onPress={() => {
              setEdits({});
              setSheet('correction');
            }}
          />
        )}
        {snapshot?.state === 'readerUnavailable' && (
          <Action
            label={t('documentCheck.action.readAgain')}
            disabled={busy}
            onPress={() => controller?.check()}
          />
        )}
        <Action
          label={t('documentCheck.action.reopenStatus')}
          secondary
          disabled={busy}
          onPress={() => controller?.restore()}
        />
      </>
    );
  }
  const closeSheet = () => {
    setEdits({});
    setSheet(undefined);
  };
  function renderCheckSheet() {
    if (sheet) {
      return (
        <NativeSheet
          title={
            sheet === 'correction'
              ? t('documentCheck.sheet.correctionTitle')
              : t('common.checkNeedsAttention')
          }
          testID="document-check-bottom-sheet"
          onDismiss={busy ? undefined : closeSheet}
        >
          {sheet === 'correction' ? (
            <>
              {result?.correctable.map(({ field, code }) => (
                <View key={field}>
                  <Text style={styles.label}>{fieldLabel(field)}</Text>
                  <Text style={styles.body}>
                    {correctionText[code] ?? t('documentCheck.correction.other')}
                  </Text>
                  <TextInput
                    accessibilityLabel={fieldLabel(field)}
                    value={edits[field] ?? ''}
                    autoCorrect={false}
                    onChangeText={(value) => setEdits((previous) => ({ ...previous, [field]: value }))}
                    style={styles.body}
                  />
                </View>
              ))}
              <Action
                label={t('documentCheck.action.submitCorrections')}
                disabled={busy || !Object.values(edits).some((value) => value.trim())}
                onPress={() => controller?.correct(edits)}
              />
            </>
          ) : (
            <>
              <Text style={styles.body}>{error}</Text>
              <Action
                label={t('documentCheck.action.reopenSaved')}
                disabled={busy}
                onPress={() => controller?.restore()}
              />
            </>
          )}
          <Action label={t('common.backToResults')} secondary disabled={busy} onPress={closeSheet} />
        </NativeSheet>
      );
    }
    return null;
  }
  function renderReturnedCheck() {
    if (!result) return null;
    return (
      <>
        <Text style={styles.body}>
          {result.providerChecks.length
            ? t('documentCheck.providerChecks', { count: result.providerChecks.length })
            : t('documentCheck.noProviderChecks')}
        </Text>
        {result.submittedFields ? (
          <>
            <Text accessibilityRole="header" style={styles.label}>
              {t('documentCheck.submittedHeading')}
            </Text>
            {Object.entries(result.submittedFields).map(([field, value]) => (
              <View key={field} style={styles.detail}>
                <Text style={styles.label}>{fieldLabel(field)}</Text>
                <Text style={styles.body}>{value}</Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.body}>{t('documentCheck.noSubmitted')}</Text>
        )}
        <Text style={styles.body}>
          {result.replayed ? t('documentCheck.replayed') : t('documentCheck.fresh')}
        </Text>
        {result.receipt ? (
          <View style={styles.detail}>
            <Text style={styles.label}>{t('documentCheck.receipt.title')}</Text>
            <Text style={styles.body}>
              {t('documentCheck.receipt.version', { value: result.receipt.serviceVersion })}
            </Text>
            <Text style={styles.body}>
              {t('documentCheck.receipt.answeredRequest', { value: result.receipt.answeredRequestSHA256 })}
            </Text>
            <Text style={styles.body}>
              {t('documentCheck.receipt.observations', { value: result.receipt.observationSHA256 })}
            </Text>
          </View>
        ) : (
          <Text style={styles.body}>{t('documentCheck.receipt.missing')}</Text>
        )}
        <Text style={styles.body}>{t('documentCheck.operation', { value: result.operationID })}</Text>
        {result.verificationID && (
          <Text style={styles.body}>{t('documentCheck.verification', { value: result.verificationID })}</Text>
        )}
      </>
    );
  }
  return (
    <View style={styles.card} testID="document-check-panel">
      <Text accessibilityRole="header" style={styles.sheetTitle}>
        {t('documentCheck.title')}
      </Text>
      {renderCheckStatus()}
      {renderCheckSheet()}
    </View>
  );
}
