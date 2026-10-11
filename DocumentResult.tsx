import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { DocumentCheckContent } from './DocumentCheckPanel';
import type { SavedDocumentCapture } from './DocumentFlowController';
import { DocumentResultDetails } from './DocumentResultDetails';
import { t } from './locales/i18n';
import { styles } from './ui/styles';
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
    return (
      <View testID="document-result-loading" style={styles.card}>
        <ActivityIndicator />
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {t('license.loading')}
        </Text>
      </View>
    );
  }
  return (
    <>
      <DocumentCheckContent {...connection} check={check} />
      <DocumentResultDetails result={result} />
      {children}
    </>
  );
}
