import type { DocumentCheckResult } from '@kenshiki/identity-capture';
import { Text, View } from 'react-native';
import { DocumentProviderChecks } from './DocumentProviderChecks';
import { t } from './locales/i18n';
import { styles } from './ui/styles';

export function DocumentCheckReceipt({ result }: Readonly<{ result: DocumentCheckResult }>) {
  return (
    <View style={styles.card} testID="document-check-receipt">
      <Text style={styles.body}>
        {result.replayed ? t('documentCheck.replayed') : t('documentCheck.fresh')}
      </Text>
      {result.receipt ? (
        <View style={styles.detail}>
          <Text style={styles.label}>{t('documentCheck.receipt.title')}</Text>
          <Text style={styles.body}>
            {t('documentCheck.receipt.version', { value: result.receipt.serviceVersion })}
          </Text>
          <Text style={styles.body}>
            {t('documentCheck.receipt.answeredRequest', { value: result.receipt.answeredRequestSHA256 })}
          </Text>
          <Text style={styles.body}>
            {t('documentCheck.receipt.observations', { value: result.receipt.observationSHA256 })}
          </Text>
        </View>
      ) : (
        <Text style={styles.body}>{t('documentCheck.receipt.missing')}</Text>
      )}
      <Text style={styles.body}>{t('documentCheck.operation', { value: result.operationID })}</Text>
      {result.verificationID && (
        <Text style={styles.body}>{t('documentCheck.verification', { value: result.verificationID })}</Text>
      )}
      <DocumentProviderChecks checks={result.providerChecks} />
    </View>
  );
}
