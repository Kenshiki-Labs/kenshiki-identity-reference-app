import type { CaptureErrorCode, DocumentCheckFailureCode } from '@kenshiki/identity-capture';
import { useEffect, useState } from 'react';
import { AppState, ScrollView, Text, TextInput, View } from 'react-native';
import {
  DocumentCheckController,
  type DocumentCheckPort,
  type DocumentCheckState,
} from './DocumentCheckController';
import { type ErrorText, errorCode, errorText, formatMoment } from './HolderText';
import { Action, styles } from './IdentityCaptureFlow';
import { IdentitySheet } from './IdentitySheetHost';

const labels = {
  recordMatched: 'Issuing record matched',
  recordNotMatched: 'Issuing record did not match',
  pending: 'Check still pending',
  unavailable: 'No answer available',
  needsCorrection: 'Review the requested details',
  inconclusive: 'No conclusive record comparison',
};
/** Text shared by the snapshot's failure field and command rejections. */
const checkFailures = {
  readerUnbound:
    'The document reader is not set up for this check. Your photos and barcode details remain available.',
  requestRejected:
    'The checking service refused this request. Your photos and barcode details remain available.',
  serviceUnavailable:
    'The checking service did not answer. You can ask for this check’s answer later; no new check is started.',
  replyRejected: 'The checking service answered, but the answer could not be verified and was not accepted.',
  requestConflict:
    'The checking service already holds a different request for this license. Reopen the saved status.',
  nothingToAskAgain: 'There is no earlier request to ask about. Start the record check when you are ready.',
  correctionNotRequested: 'Only the details the checking service asked about can be corrected.',
  busy: 'The previous request is still finishing. Wait a moment, then try again.',
  cancelled: 'The check was stopped before it finished. Reopen its saved status.',
} satisfies Partial<Record<Extract<DocumentCheckFailureCode, CaptureErrorCode>, string>>;
/** `DocumentCheckSnapshot.failure` has its own closed vocabulary. */
const snapshotFailures: Partial<Record<DocumentCheckFailureCode, string>> = {
  ...checkFailures,
  custodyUnavailable: 'The saved check could not be opened on this phone. Reopen its saved status.',
};
/** Command rejections, by code. */
const failures: ErrorText = {
  ...checkFailures,
  consentRequired: 'Agree to the record check before it is sent.',
  documentCheckNotConfigured:
    'Record checking is not set up in this app. Your photos and barcode details remain available.',
  documentFrontRequired: 'Capture the front of the license before checking its record.',
  invalidArgument: 'Enter a value for each requested detail before submitting.',
  documentCustodyFailed:
    'The saved license photos could not be opened on this phone. Reopen the saved status.',
  sessionUnavailable:
    'This screen closed before the check finished. Open the license again to see its saved status.',
};
const fieldNames: Record<string, string> = {
  givenName: 'Given name',
  familyName: 'Family name',
  middleName: 'Middle name',
  birthDate: 'Date of birth',
  documentNumber: 'License number',
  expiryDate: 'Expiry date',
  issueDate: 'Issue date',
  addressLine1: 'Street address',
  addressLine2: 'Address line 2',
  city: 'City',
  region: 'State',
  postalCode: 'Postal code',
  issuingState: 'Issuing state',
};
const fieldLabel = (field: string) => fieldNames[field] ?? 'Other detail';
const correctionText: Record<string, string> = {
  required: 'This detail is required.',
  mismatch: 'This detail did not match the record.',
  invalid: 'This detail was not in a usable form.',
};

/** Remount the presentation when custody changes; no old holder state is rendered. */
export function DocumentCheckPanel(props: { session: DocumentCheckPort; configured: boolean }) {
  return <DocumentCheckView key={`${props.session.id}:${props.configured}`} {...props} />;
}

/** Reopening restores local status. Only holder actions can dispatch a check. */
function DocumentCheckView({ session, configured }: { session: DocumentCheckPort; configured: boolean }) {
  const [controller, setController] = useState<DocumentCheckController>();
  const [state, setState] = useState<DocumentCheckState>({
    snapshot: undefined,
    busy: false,
    failure: undefined,
  });
  const [sheet, setSheet] = useState<'failure' | 'correction'>();
  const [error, setError] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => {
    const active = new DocumentCheckController(session, (next) => {
      setState(next);
      if (next.failure) {
        setError(
          errorText(
            errorCode(next.failure.cause),
            failures,
            'The check could not finish. Reopen the saved status before sending another request.',
          ),
        );
        setSheet('failure');
      } else if (!next.busy) setSheet(undefined);
    });
    setController(active);
    setState(active.state);
    if (configured) active.restore().catch(active.fail);
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        setEdits({});
        setSheet(undefined);
        active.pause().catch(active.fail);
      }
    });
    return () => {
      active.dispose();
      listener.remove();
    };
  }, [session, configured]);
  const { snapshot, busy } = state;
  const result = snapshot?.result;
  const needsReply =
    snapshot?.state === 'unanswered' || result?.outcome === 'pending' || result?.outcome === 'unavailable';
  const failure = snapshot?.failure ? (snapshotFailures[snapshot.failure] ?? '') : '';
  function statusText() {
    if (busy) return 'Opening or checking the saved record…';
    if (result) return labels[result.outcome];
    switch (snapshot?.state) {
      case 'unanswered':
        return 'A request was sent. No answer is saved yet.';
      case 'readerUnavailable':
        return failure || 'The document reader could not complete this check.';
      case 'unreadable':
        return 'The saved image could not be read.';
      case 'unavailable':
        return failure || 'The check could not finish. Reopen its saved status.';
      default:
        return 'No record check has been made.';
    }
  }
  function renderCheckStatus() {
    if (!configured) {
      return (
        <Text style={styles.body}>
          Record checking is not configured for this app. Your saved photos and barcode details remain
          available.
        </Text>
      );
    }
    return (
      <>
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {statusText()}
        </Text>
        {snapshot?.checkedAt && <Text style={styles.body}>Checked {formatMoment(snapshot.checkedAt)}</Text>}
        {renderReturnedCheck()}
        {snapshot?.state === 'notStarted' && (
          <Action
            label="Check license record"
            testID="check-document-record"
            disabled={busy}
            onPress={() => controller?.check()}
          />
        )}
        {needsReply && (
          <Action
            label="Ask for the existing check’s answer"
            disabled={busy}
            testID="document-check-ask-again"
            onPress={() => controller?.askAgain()}
          />
        )}
        {result?.outcome === 'needsCorrection' && (
          <Action
            label="Review requested corrections"
            disabled={busy}
            onPress={() => {
              setEdits({});
              setSheet('correction');
            }}
          />
        )}
        {snapshot?.state === 'readerUnavailable' && (
          <Action
            label="Try reading the saved photo again"
            disabled={busy}
            onPress={() => controller?.check()}
          />
        )}
        <Action
          label="Reopen saved check status"
          secondary
          disabled={busy}
          onPress={() => controller?.restore()}
        />
      </>
    );
  }
  function renderCheckSheet() {
    if (sheet) {
      return (
        <View testID="document-check-bottom-sheet">
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <Text style={styles.sheetTitle}>
              {sheet === 'correction' ? 'Correct the requested details' : 'Check needs attention'}
            </Text>
            {sheet === 'correction' ? (
              <>
                {result?.correctable.map(({ field, code }) => (
                  <View key={field}>
                    <Text style={styles.label}>{fieldLabel(field)}</Text>
                    <Text style={styles.body}>
                      {correctionText[code] ?? 'The checking service asked you to review this detail.'}
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
                  label="Submit corrections"
                  disabled={busy || !Object.values(edits).some((value) => value.trim())}
                  onPress={() => controller?.correct(edits)}
                />
              </>
            ) : (
              <>
                <Text style={styles.body}>{error}</Text>
                <Action label="Reopen saved status" disabled={busy} onPress={() => controller?.restore()} />
              </>
            )}
            <Action
              label="Back to results"
              secondary
              disabled={busy}
              onPress={() => {
                setEdits({});
                setSheet(undefined);
              }}
            />
          </ScrollView>
        </View>
      );
    }
    return undefined;
  }
  function renderReturnedCheck() {
    if (!result) return null;
    return (
      <>
        <Text style={styles.body}>
          {result.providerChecks.length
            ? `The checking service returned ${result.providerChecks.length} individual ${result.providerChecks.length === 1 ? 'check' : 'checks'}.`
            : 'Individual checks were not returned.'}
        </Text>
        {result.submittedFields ? (
          <>
            <Text accessibilityRole="header" style={styles.label}>
              DETAILS SENT FOR THE CHECK
            </Text>
            {Object.entries(result.submittedFields).map(([field, value]) => (
              <View key={field} style={styles.detail}>
                <Text style={styles.label}>{fieldLabel(field)}</Text>
                <Text style={styles.body}>{value}</Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.body}>The details sent for the check were not returned.</Text>
        )}
        <Text style={styles.body}>
          {result.replayed
            ? 'The service returned the existing answer.'
            : 'The service returned a new answer.'}
        </Text>
        {result.receipt ? (
          <View style={styles.detail}>
            <Text style={styles.label}>Service receipt</Text>
            <Text style={styles.body}>Version: {result.receipt.serviceVersion}</Text>
            <Text style={styles.body}>Answered request: {result.receipt.answeredRequestSHA256}</Text>
            <Text style={styles.body}>Read observations: {result.receipt.observationSHA256}</Text>
          </View>
        ) : (
          <Text style={styles.body}>Service receipt was not returned.</Text>
        )}
        <Text style={styles.body}>Operation: {result.operationID}</Text>
        {result.verificationID && <Text style={styles.body}>Verification: {result.verificationID}</Text>}
      </>
    );
  }
  return (
    <View style={styles.card} testID="document-check-panel">
      <Text accessibilityRole="header" style={styles.sheetTitle}>
        License record check
      </Text>
      {renderCheckStatus()}
      <IdentitySheet>{renderCheckSheet()}</IdentitySheet>
    </View>
  );
}
