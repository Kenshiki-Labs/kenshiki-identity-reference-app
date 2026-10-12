import { DocumentCheckContent } from './DocumentCheckPanel';
import { documentCheckAction } from './DocumentCheckRecovery';
import type { SavedDocumentCapture } from './DocumentFlowController';
import { DocumentInspection } from './DocumentInspection';
import { DocumentResultDetails } from './DocumentResultDetails';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { ListSection } from '../ui/List';
import { LoadingCard } from '../ui/LoadingCard';
import { type DocumentCheckProps, useDocumentCheck } from './useDocumentCheck';

type Props = Omit<DocumentCheckProps, 'session'> & { result: SavedDocumentCapture; onDelete?: () => void };

export function DocumentResult(props: Props) {
  const { session, document } = props.result;
  return (
    <LoadedDocumentResult
      key={JSON.stringify([
        session.id,
        document.workflowID,
        document.front?.captureID,
        document.front?.sha256,
        document.back?.captureID,
        document.back?.sha256,
        props.configured,
      ])}
      {...props}
    />
  );
}

/** Reveal the saved status and evidence together. Later explicit actions retain mounted images. */
function LoadedDocumentResult({ result, onDelete, ...props }: Props) {
  const connection = { ...props, session: result.session };
  const check = useDocumentCheck(connection);
  if (props.configured && !check.state.loaded && !check.failed) {
    return <LoadingCard message={t('license.loading')} testID="document-result-loading" />;
  }
  return (
    <>
      <DocumentCheckContent {...connection} check={check} />
      <DocumentResultDetails result={result} />
      <DocumentInspection result={result} />
      <ListSection>
        {props.onRetake &&
          !(
            props.configured &&
            !check.failed &&
            !check.state.failure &&
            documentCheckAction(check.state.snapshot) === 'retake'
          ) && (
            <Action
              grouped
              label={t('license.retake')}
              testID="retake-saved-document"
              disabled={check.state.busy}
              onPress={props.onRetake}
            />
          )}
        {onDelete && (
          <Action
            grouped
            label={t('hub.action.deleteLicenseScans')}
            destructive
            testID="delete-saved-document"
            disabled={check.state.busy}
            onPress={onDelete}
          />
        )}
      </ListSection>
    </>
  );
}
