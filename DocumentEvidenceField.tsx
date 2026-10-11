import type { DocumentComparison, DocumentFieldReadout } from '@kenshiki/identity-capture';
import { StyleSheet, Text, View } from 'react-native';
import { fieldLabel } from './DocumentCheckText';
import { t } from './locales/i18n';
import { styles } from './ui/styles';
import { color, radius, spacing, text } from './ui/tokens.generated';

const comparisons: Record<DocumentComparison, string> = {
  matched: t('documentEvidence.dolMatched'),
  partial: t('documentEvidence.dolPartial'),
  mismatched: t('documentEvidence.dolMismatch'),
  unavailable: t('documentEvidence.dolUnavailable'),
  pending: t('documentEvidence.dolPending'),
  notReported: t('documentEvidence.dolNotReported'),
};
/** One attribute, one value when sources agree. Different values stay explicitly attributed in
 * the same row. Chips describe independent evidence; there is no synthetic overall verified flag. */
export function DocumentEvidenceField({
  row,
  label,
}: Readonly<{ row: DocumentFieldReadout; label?: string | undefined }>) {
  const values = [row.frontValue, row.licenseValue, row.submittedValue].filter(
    (value): value is string => !!value,
  );
  const differs = new Set(values).size > 1;
  const name = label ?? (row.key === 'address' ? t('license.result.address') : fieldLabel(row.key));
  return (
    <View style={layout.row} testID={`document-field-${row.key}`}>
      <Text style={styles.label}>{name}</Text>
      <EvidenceValues row={row} values={values} differs={differs} />
      <View style={layout.chips}>
        <Chip
          label={frontLabel(row)}
          tone={
            row.front === 'matched'
              ? 'good'
              : ['partial', 'mismatched'].includes(row.front)
                ? 'attention'
                : 'neutral'
          }
        />
        <Chip
          label={
            differs
              ? t('documentEvidence.submittedComparison', { status: comparisons[row.comparison] })
              : comparisons[row.comparison]
          }
          tone={
            row.comparison === 'matched'
              ? 'good'
              : ['partial', 'mismatched'].includes(row.comparison)
                ? 'attention'
                : 'neutral'
          }
        />
      </View>
      {!!row.frontMissing?.length && (
        <Text style={styles.label}>
          {t('documentEvidence.frontMissing', {
            fields: row.frontMissing.map(fieldLabel).join(t('common.listSeparator')),
          })}
        </Text>
      )}
    </View>
  );
}
function Chip({ label, tone }: Readonly<{ label: string; tone: 'good' | 'attention' | 'neutral' }>) {
  const ink =
    tone === 'good' ? color.evidenceMatch : tone === 'attention' ? color.warning : color.secondaryText;
  return (
    <Text style={[layout.chip, { color: ink }]}>
      {tone === 'good' ? '✓ ' : tone === 'attention' ? '! ' : ''}
      {label}
    </Text>
  );
}
const layout = StyleSheet.create({
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.separator,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    ...text.note,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.separator,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
});

function EvidenceValues({
  row,
  values,
  differs,
}: Readonly<{ row: DocumentFieldReadout; values: string[]; differs: boolean }>) {
  return (
    <>
      {differs ? (
        <>
          {row.frontValue && (
            <Text style={styles.body}>
              {t(
                row.frontValue === row.submittedValue
                  ? 'documentEvidence.frontSubmittedValue'
                  : 'documentEvidence.frontValue',
                { value: row.frontValue },
              )}
            </Text>
          )}
          {row.licenseValue && (
            <Text style={styles.body}>
              {t(
                row.licenseValue === row.submittedValue
                  ? 'documentEvidence.barcodeSubmittedValue'
                  : 'documentEvidence.barcodeValue',
                { value: row.licenseValue },
              )}
            </Text>
          )}
          {row.submittedValue &&
            row.submittedValue !== row.frontValue &&
            row.submittedValue !== row.licenseValue && (
              <Text style={styles.body}>
                {t('documentEvidence.submittedValue', { value: row.submittedValue })}
              </Text>
            )}
        </>
      ) : (
        <Text style={styles.body}>{values[0]}</Text>
      )}
    </>
  );
}

function frontLabel(row: DocumentFieldReadout): string {
  switch (row.front) {
    case 'matched':
      return t('documentEvidence.frontMatched');
    case 'partial':
      return t('documentEvidence.frontPartial');
    case 'mismatched':
      return t('documentEvidence.frontMismatch');
    case 'notReported':
      if (row.frontValue) return t('documentEvidence.frontRead');
      return row.licenseValue ? t('documentEvidence.barcodeRead') : t('documentEvidence.submittedOnly');
  }
}
