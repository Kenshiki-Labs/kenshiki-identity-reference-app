import type { DocumentSideObservation } from '@kenshiki/identity-capture';
import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { documentCustodyPresentation } from './DocumentCustodyPresentation';
import type { SavedDocumentCapture } from './DocumentFlowController';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { ContentRow, ListSection } from '../ui/List';
import { styles } from '../ui/styles';

/** JavaScript renders only capture status. Native custody supplies the holder's detailed readout. */
export function DocumentResultDetails({
  result,
  disabled = false,
}: Readonly<{ result: SavedDocumentCapture; disabled?: boolean }>) {
  const { document, session } = result;
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  const openDetails = async () => {
    if (opening.current || disabled) return;
    opening.current = true;
    setBusy(true);
    try {
      await session.documentDetails(documentCustodyPresentation());
    } finally {
      opening.current = false;
      setBusy(false);
    }
  };
  if (!document.front && !document.back) return null;
  return (
    <ListSection header={t('documentEvidence.title')} testID="document-barcode-details">
      {document.back && (
        <ContentRow>
          <Text style={styles.body} testID="document-barcode-status">
            {barcodeStatus(document.back)}
          </Text>
        </ContentRow>
      )}
      <Action
        grouped
        label={t('license.result.showAll')}
        testID="document-native-details"
        onPress={openDetails}
        disabled={busy || disabled}
      />
    </ListSection>
  );
}

/** Decoder status is an observation, never issuer validation. Parser detail stays native. */
function barcodeStatus(back: DocumentSideObservation): string {
  switch (back.pdf417Status) {
    case 'notFound':
      return t('license.barcode.notFound');
    case 'ambiguous':
      return t('license.barcode.ambiguous');
    case 'failed':
      return t('license.barcode.failed');
    case 'notRequested':
      return t('license.barcode.notRequested');
    case 'readable':
      return t('license.barcode.detected');
  }
}
