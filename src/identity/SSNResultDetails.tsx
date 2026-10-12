import type { CaptureSession, SSNVerificationReceipt } from '@kenshiki/identity-capture';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { formatMoment } from '../app/HolderText';
import { t } from '../locales/i18n';
import { ssnCustodyPresentation } from './SSNCustodyPresentation';
import { ssnReceiptSatisfied } from './SSNPolicy';
import { Action } from '../ui/Action';
import { ListSection, TextRow, ValueRow } from '../ui/List';
import { styles } from '../ui/styles';

/** Present the aggregate independently of the issuance observation. */
export function ssnSummary(receipt: SSNVerificationReceipt): string {
  if (receipt.reportKind !== 'fiveChecks') return t('ssn.summary.historical');
  return ssnReceiptSatisfied(receipt)
    ? t('ssn.summary.fiveSatisfied')
    : receipt.reportedOutcome === 'negative'
      ? t('ssn.summary.fiveNotSatisfied')
      : t('ssn.summary.fiveIncomplete');
}
export function SSNResultDetails({
  receipt,
  session,
  disabled = false,
}: Readonly<{
  receipt: SSNVerificationReceipt;
  session?: Pick<CaptureSession, 'ssnDetails'>;
  disabled?: boolean;
}>) {
  const [opening, setOpening] = useState(false);
  const pending = useRef(false);
  async function details() {
    if (!session || disabled || pending.current) return;
    pending.current = true;
    setOpening(true);
    try {
      await session.ssnDetails(ssnCustodyPresentation());
    } finally {
      pending.current = false;
      setOpening(false);
    }
  }
  return (
    <View style={styles.list} testID="ssn-result">
      <ListSection header={ssnSummary(receipt)}>
        <TextRow text={t('ssn.result.ownership')} />
        {!receipt.fiveChecks && (
          <TextRow
            text={
              receipt.reportKind === 'fiveChecks' ? t('ssn.result.noReport') : t('ssn.result.issuanceOnly')
            }
          />
        )}
      </ListSection>
      <ListSection header={t('ssn.result.checksTitle')}>
        <ValueRow
          label={receipt.fiveChecks ? t('ssn.result.check.issuance') : t('ssn.result.reportedLabel')}
          value={
            receipt.issuance === 'issued'
              ? t('ssn.result.issued')
              : receipt.issuance === 'notIssued'
                ? t('ssn.result.notIssued')
                : t('ssn.result.unavailable')
          }
        />
        {receipt.fiveChecks && [
          <ValueRow
            key="death"
            label={t('ssn.result.check.deathMasterFile')}
            value={t(`ssn.result.deathOutcome.${receipt.fiveChecks.checks.death_master_file.outcome}`)}
          />,
          <ValueRow
            key="name"
            label={t('ssn.result.check.name')}
            value={t(`ssn.result.outcome.${receipt.fiveChecks.checks.ssn_name_association.outcome}`)}
          />,
          <ValueRow
            key="address"
            label={t('ssn.result.check.address')}
            value={t(`ssn.result.outcome.${receipt.fiveChecks.checks.ssn_address_association.outcome}`)}
          />,
          <ValueRow
            key="phone"
            label={t('ssn.result.check.phone')}
            value={t(`ssn.result.outcome.${receipt.fiveChecks.checks.ssn_phone_association.outcome}`)}
          />,
        ]}
      </ListSection>
      <ListSection header={t('ssn.result.diagnostics')}>
        <ValueRow label={t('ssn.result.checked')} value={formatMoment(receipt.checkedAt)} />
        {session && (
          <Action
            grouped
            label={t('license.result.showAll')}
            testID="ssn-native-details"
            onPress={details}
            disabled={disabled || opening}
          />
        )}
      </ListSection>
    </View>
  );
}
