import type { SSNVerificationReceipt } from '@kenshiki/identity-capture';
import { Text, View } from 'react-native';
import { formatCalendarDate, formatMoment } from './HolderText';
import { t } from './locales/i18n';
import { styles } from './ui/styles';

/** Present the aggregate independently of the issuance observation. */
export function ssnSummary(receipt: SSNVerificationReceipt): string {
  if (receipt.reportKind !== 'fiveChecks') return t('ssn.summary.historical');
  return receipt.reportedOutcome === 'affirmative'
    ? t('ssn.summary.fiveSatisfied')
    : receipt.reportedOutcome === 'negative'
      ? t('ssn.summary.fiveNotSatisfied')
      : t('ssn.summary.fiveIncomplete');
}
export function SSNResultDetails({ receipt }: Readonly<{ receipt: SSNVerificationReceipt }>) {
  const details = receipt.details;
  const reported = (value?: string | null) => value?.trim() || t('common.notReturned');
  return (
    <View style={styles.card} testID="ssn-result">
      <Text accessibilityRole="header" style={styles.sheetTitle}>
        {ssnSummary(receipt)}
      </Text>
      {receipt.fiveChecks && (
        <>
          <ResultRow
            label={t('ssn.result.check.deathMasterFile')}
            value={t(`ssn.result.outcome.${receipt.fiveChecks.checks.death_master_file.outcome}`)}
          />
          <ResultRow
            label={t('ssn.result.check.name')}
            value={t(`ssn.result.outcome.${receipt.fiveChecks.checks.ssn_name_association.outcome}`)}
          />
          <ResultRow
            label={t('ssn.result.check.address')}
            value={t(`ssn.result.outcome.${receipt.fiveChecks.checks.ssn_address_association.outcome}`)}
          />
          <ResultRow
            label={t('ssn.result.check.phone')}
            value={t(`ssn.result.outcome.${receipt.fiveChecks.checks.ssn_phone_association.outcome}`)}
          />
        </>
      )}
      <ResultRow
        label={receipt.fiveChecks ? t('ssn.result.check.issuance') : t('ssn.result.reportedLabel')}
        value={
          receipt.issuance === 'issued'
            ? t('ssn.result.issued')
            : receipt.issuance === 'notIssued'
              ? t('ssn.result.notIssued')
              : t('ssn.result.unavailable')
        }
      />
      {details ? (
        <>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('ssn.result.findings')}
          </Text>
          <ResultRow label={t('ssn.result.region')} value={reported(details.region)} />
          <ResultRow
            label={t('ssn.result.issueStart')}
            value={details.issueStart ? formatCalendarDate(details.issueStart) : t('common.notReturned')}
          />
          <ResultRow
            label={t('ssn.result.issueEnd')}
            value={details.issueEnd ? formatCalendarDate(details.issueEnd) : t('common.notReturned')}
          />
          <ResultRow label={t('ssn.result.classification')} value={reported(details.codeDescription)} />
          <ResultRow label={t('ssn.result.classificationCode')} value={reported(details.code)} />
          <ResultRow label={t('ssn.result.reportedStatus')} value={reported(details.reportedStatus)} />
          <ResultRow
            label={t('ssn.result.responseCode')}
            value={details.responseCode == null ? t('common.notReturned') : String(details.responseCode)}
          />
        </>
      ) : !receipt.fiveChecks ? (
        <Text style={styles.body}>
          {receipt.reportKind === 'fiveChecks' ? t('ssn.result.noReport') : t('ssn.result.issuanceOnly')}
        </Text>
      ) : null}
      <ResultRow label={t('ssn.result.checked')} value={formatMoment(receipt.checkedAt)} />
      <Text style={styles.body}>{t('ssn.result.ownership')}</Text>
    </View>
  );
}
function ResultRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}
