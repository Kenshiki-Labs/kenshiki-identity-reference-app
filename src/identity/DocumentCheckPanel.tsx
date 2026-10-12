import { useState } from 'react';
import { Text } from 'react-native';
import type { DocumentCheckState } from './DocumentCheckController';
import { documentCheckAction } from './DocumentCheckRecovery';
import { failures, labels, snapshotFailures } from './DocumentCheckText';
import { errorCode, errorText, formatMoment } from '../app/HolderText';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { ContentRow, ListSection } from '../ui/List';
import { NativeSheet } from '../ui/NativeSheet';
import { styles } from '../ui/styles';
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
  const [dismissedFailure, setDismissedFailure] = useState<DocumentCheckState['failure']>();
  const sheet = state.failure && state.failure !== dismissedFailure;
  const error = errorText(errorCode(state.failure?.cause), failures, t('documentCheck.failure.other'));
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
        {nextAction === 'check' && (
          <Action
            grouped
            label={t('documentCheck.action.check')}
            testID="check-document-record"
            disabled={busy}
            onPress={() => controller?.check()}
          />
        )}
        {nextAction === 'askAgain' && (
          <Action
            grouped
            label={t('documentCheck.action.askAgain')}
            disabled={busy}
            testID="document-check-ask-again"
            onPress={() => controller?.askAgain()}
          />
        )}
        {nextAction === 'correct' && (
          <Action
            grouped
            label={t('documentCheck.action.reviewCorrections')}
            disabled={busy}
            onPress={() => controller?.correct()}
          />
        )}
        {nextAction === 'readAgain' && (
          <Action
            grouped
            label={t('documentCheck.action.readAgain')}
            disabled={busy}
            onPress={() => controller?.check()}
          />
        )}
        {nextAction === 'retake' && onRetake && (
          <Action
            grouped
            label={t('documentCheck.action.retake')}
            testID="document-check-retake"
            disabled={busy}
            onPress={onRetake}
          />
        )}
        <Action
          grouped
          testID={nextAction === 'restore' ? 'document-check-recover' : 'document-check-reopen'}
          label={t('documentCheck.action.reopenStatus')}
          secondary
          disabled={busy}
          onPress={() => controller?.restore()}
        />
      </>
    );
  }
  function renderCheckSheet() {
    if (!sheet) return null;
    const close = () => setDismissedFailure(state.failure);
    return (
      <NativeSheet
        title={t('common.checkNeedsAttention')}
        testID="document-check-bottom-sheet"
        onDismiss={busy ? undefined : close}
      >
        <Text style={styles.body}>{error}</Text>
        <Action
          grouped
          label={t('documentCheck.action.reopenSaved')}
          disabled={busy}
          onPress={() => controller?.restore()}
        />
        <Action label={t('common.backToResults')} secondary disabled={busy} onPress={close} />
      </NativeSheet>
    );
  }
  return (
    <ListSection header={t('documentCheck.title')} testID="document-check-panel">
      <ContentRow>{renderCheckStatus()}</ContentRow>
      {renderCheckSheet()}
    </ListSection>
  );
}
