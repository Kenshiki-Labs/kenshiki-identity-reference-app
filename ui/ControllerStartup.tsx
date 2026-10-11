import { Text } from 'react-native';
import { t } from '../locales/i18n';
import { LoadingCard } from './LoadingCard';
import { Page } from './Page';
import { styles } from './styles';

/** A pending or refused connection can always be closed without having a live controller. */
export function ControllerStartup({
  title,
  failed,
  cancelStartup,
  onClose,
  loadingMessage,
}: Readonly<{
  title: string;
  loadingMessage?: string;
  failed: boolean;
  cancelStartup: () => void;
  onClose: () => void;
}>) {
  return (
    <Page
      title={title}
      onClose={() => {
        cancelStartup();
        onClose();
      }}
    >
      {!failed && loadingMessage && <LoadingCard message={loadingMessage} testID="controller-loading" />}
      {failed && (
        <Text accessibilityRole="alert" style={styles.body}>
          {t('common.sessionRecovery')}
        </Text>
      )}
    </Page>
  );
}
