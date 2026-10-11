import type { ReactNode } from 'react';
import { DocumentCheckContent } from './DocumentCheckPanel';
import { DocumentCheckReceipt } from './DocumentCheckReceipt';
import type { SavedDocumentCapture } from './DocumentFlowController';
import { DocumentResultDetails } from './DocumentResultDetails';
import { t } from './locales/i18n';
import { LoadingCard } from './ui/LoadingCard';
import { type DocumentCheckProps, useDocumentCheck } from './useDocumentCheck';

type Props = Omit<DocumentCheckProps, 'session'> & { result: SavedDocumentCapture; children?: ReactNode };

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
function LoadedDocumentResult({ result, children, ...props }: Props) {
  const connection = { ...props, session: result.session };
  const check = useDocumentCheck(connection);
  if (props.configured && !check.state.loaded && !check.failed) {
    return <LoadingCard message={t('license.loading')} testID="document-result-loading" />;
  }
  return (
    <>
      <DocumentCheckContent {...connection} check={check} summaryOnly />
      <DocumentResultDetails result={result} checkResult={check.state.snapshot?.result} />
      {children}
      {check.state.snapshot?.result && <DocumentCheckReceipt result={check.state.snapshot.result} />}
    </>
  );
}
