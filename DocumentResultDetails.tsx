import {
  type DocumentCheckResult,
  type DocumentSideObservation,
  documentFieldReadout,
} from '@kenshiki/identity-capture';
import { Text, View } from 'react-native';
import { DocumentEvidenceField } from './DocumentEvidenceField';
import type { SavedDocumentCapture } from './DocumentFlowController';
import { DocumentInspection } from './DocumentInspection';
import { t } from './locales/i18n';
import { styles } from './ui/styles';

export function DocumentResultDetails({
  result,
  checkResult,
}: Readonly<{ result: SavedDocumentCapture; checkResult?: DocumentCheckResult | null | undefined }>) {
  const { document } = result;
  const barcode = document.back?.pdf417;
  const rows = documentFieldReadout(document, checkResult);
  return (
    <>
      {(document.back || rows.length > 0) && (
        <View style={styles.card} testID="document-barcode-details">
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('documentEvidence.title')}
          </Text>
          <Text style={styles.body} testID="document-barcode-status">
            {document.back ? barcodeStatus(document.back) : ''}
          </Text>
          {rows.map((row) => (
            <DocumentEvidenceField
              key={row.key}
              row={row}
              label={Object.hasOwn(fieldLabels, row.key) ? fieldLabels[row.key] : undefined}
            />
          ))}
          {!!barcode?.missingRequiredElements.length && (
            <Detail
              label={t('license.result.missingElements')}
              value={barcode.missingRequiredElements
                .map((field) => fieldLabels[field] ?? field)
                .join(t('common.listSeparator'))}
            />
          )}
        </View>
      )}
      <DocumentInspection result={result} />
    </>
  );
}
const fieldLabels: Record<string, string> = {
  DAA: t('license.field.DAA'),
  DCS: t('license.field.DCS'),
  DAC: t('license.field.DAC'),
  DAD: t('license.field.DAD'),
  DAQ: t('license.field.DAQ'),
  DBB: t('license.field.DBB'),
  DBA: t('license.field.DBA'),
  DBD: t('license.field.DBD'),
  DAG: t('license.field.DAG'),
  DAH: t('license.field.DAH'),
  DAI: t('license.field.DAI'),
  DAJ: t('license.field.DAJ'),
  DAK: t('license.field.DAK'),
  DCG: t('license.field.DCG'),
  DBC: t('license.field.DBC'),
  DAY: t('license.field.DAY'),
  DAU: t('license.field.DAU'),
  DAW: t('license.field.DAW'),
  DCA: t('license.field.DCA'),
  DCB: t('license.field.DCB'),
  DCD: t('license.field.DCD'),
  DCF: t('license.field.DCF'),
  DDA: t('license.field.DDA'),
  DDB: t('license.field.DDB'),
};
/** Each decoder and parser state has its own text; none of them is issuer validation. */
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
      switch (back.pdf417?.status) {
        case 'readable':
          return back.pdf417.missingRequiredElements.length
            ? t('license.barcode.readableMissing')
            : t('license.barcode.readable');
        case 'malformed':
          return t('license.barcode.malformed');
        case 'unsupported':
          return t('license.barcode.unsupported');
        case undefined:
          return t('license.barcode.unread');
      }
  }
}
function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}
