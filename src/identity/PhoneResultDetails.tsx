import type { CaptureSession, PhoneCheckReceipt } from '@kenshiki/identity-capture';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { formatMoment } from '../app/HolderText';
import { t } from '../locales/i18n';
import { phoneCustodyPresentation } from './PhoneCustodyPresentation';
import { phoneCheckStopped } from './PhonePolicy';
import { subscriberEvaluationStatus, subscriberFailures } from './SubscriberResultDetails';
import { Action } from '../ui/Action';
import { ListSection, TextRow, ValueRow } from '../ui/List';
import { styles } from '../ui/styles';

/** Status stays in React; the number and provider readout remain in native custody. */
export function PhoneResultDetails({
  receipt,
  session,
  disabled = false,
}: Readonly<{
  receipt: PhoneCheckReceipt;
  session?: Pick<CaptureSession, 'phoneDetails'>;
  disabled?: boolean;
}>) {
  const stopped = phoneCheckStopped(receipt);
  const [opening, setOpening] = useState(false);
  const pending = useRef(false);
  const details = async () => {
    if (!session || disabled || pending.current) return;
    pending.current = true;
    setOpening(true);
    try {
      await session.phoneDetails(phoneCustodyPresentation());
    } finally {
      pending.current = false;
      setOpening(false);
    }
  };
  return (
    <View testID="phone-result" style={styles.list}>
      <ListSection header={stopped ? t('phone.result.stoppedTitle') : t('phone.result.confirmedTitle')}>
        <TextRow
          text={stopped ? t('phone.result.stoppedBody') : t('phone.result.possessionOnly')}
          tone={stopped ? 'warning' : undefined}
        />
        <ValueRow label={t('phone.result.received')} value={formatMoment(receipt.receivedAt)} />
        <ValueRow label={t('phone.result.completed')} value={formatMoment(receipt.completedAt)} />
        {session && (
          <Action
            grouped
            label={t('license.result.showAll')}
            testID="phone-native-details"
            onPress={details}
            disabled={disabled || opening}
          />
        )}
      </ListSection>
      <ListSection header={t('phone.result.comparisonTitle')}>
        <ValueRow label={t('common.reportedOutcome')} value={comparisonText(receipt)} />
        {receipt.subscriberFailure && <TextRow text={subscriberFailures[receipt.subscriberFailure]} />}
        {receipt.subjectComparison && (
          <ValueRow label={t('common.compared')} value={formatMoment(receipt.subjectComparison.checkedAt)} />
        )}
      </ListSection>
    </View>
  );
}

const comparisonStatus = {
  agreed: t('phone.comparison.agreed'),
  singleSource: t('phone.comparison.singleSource'),
  contradicted: t('phone.comparison.contradicted'),
  unavailable: t('phone.comparison.unavailable'),
  notCompared: t('phone.comparison.notCompared'),
};

function comparisonText(receipt: PhoneCheckReceipt) {
  if (receipt.subscriberComparison)
    return subscriberEvaluationStatus[receipt.subscriberComparison.evaluation.status];
  if (receipt.subjectComparison) return comparisonStatus[receipt.subjectComparison.status];
  return t('phone.result.noComparison');
}
