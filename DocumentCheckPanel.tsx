import { useEffect, useState } from 'react';
import { AppState, Text, TextInput, View } from 'react-native';
import type { DocumentCheckState } from './DocumentCheckController';
import { documentCheckAction } from './DocumentCheckRecovery';
import { correctionText, failures, fieldLabel, labels, snapshotFailures } from './DocumentCheckText';
import { errorCode, errorText, formatMoment } from './HolderText';
import { t } from './locales/i18n';
import { Action } from './ui/Action';
import { NativeSheet } from './ui/NativeSheet';
import { styles } from './ui/styles';
import { type DocumentCheckProps, useDocumentCheck } from './useDocumentCheck';

/** Remount the presentation when custody changes; no old holder state is rendered. */
export function DocumentCheckPanel(props: DocumentCheckProps) {
  return <DocumentCheckView key={`${props.session.id}:${props.configured}`} {...props} />;
}

function DocumentCheckView(props: DocumentCheckProps) {
  const check = useDocumentCheck(props);
  return <DocumentCheckContent {...props} check={check} />;
}

/** Presentation only; SDK commands and subscription lifetime belong to useDocumentCheck. */
export function DocumentCheckContent({
  configured,
  onRetake,
  check,
}: DocumentCheckProps & {
  check: ReturnType<typeof useDocumentCheck>;
}) {
  const { controller, state, failed } = check;
  const [correction, setCorrection] = useState(false);
  const [dismissedFailure, setDismissedFailure] = useState<DocumentCheckState['failure']>();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const sheet =
    state.failure && state.failure !== dismissedFailure ? 'failure' : correction ? 'correction' : undefined;
  const error = errorText(errorCode(state.failure?.cause), failures, t('documentCheck.failure.other'));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        setEdits({});
        setCorrection(false);
      }
    });
    return () => listener.remove();
  }, []);
  const { snapshot, busy } = state;
  const result = snapshot?.result;
  const nextAction = state.failure ? 'restore' : documentCheckAction(snapshot);
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
        {nextAction === 'check' && (
          <Action
            label={t('documentCheck.action.check')}
            testID="check-document-record"
            disabled={busy}
            onPress={() => controller?.check()}
          />
        )}
        {nextAction === 'askAgain' && (
          <Action
            label={t('documentCheck.action.askAgain')}
            disabled={busy}
            testID="document-check-ask-again"
            onPress={() => controller?.askAgain()}
          />
        )}
        {nextAction === 'correct' && (
          <Action
            label={t('documentCheck.action.reviewCorrections')}
            disabled={busy}
            onPress={() => {
              setEdits({});
              setCorrection(true);
            }}
          />
        )}
        {nextAction === 'readAgain' && (
          <Action
            label={t('documentCheck.action.readAgain')}
            disabled={busy}
            onPress={() => controller?.check()}
          />
        )}
        {nextAction === 'retake' && onRetake && (
          <Action
            label={t('documentCheck.action.retake')}
            testID="document-check-retake"
            disabled={busy}
            onPress={onRetake}
          />
        )}
        <Action
          testID={nextAction === 'restore' ? 'document-check-recover' : 'document-check-reopen'}
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
    setCorrection(false);
    setDismissedFailure(state.failure);
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
                onPress={async () => {
                  await controller?.correct(edits);
                  setEdits({});
                  setCorrection(false);
                }}
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
