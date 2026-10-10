import { Text } from 'react-native';
import { t } from '../locales/i18n';
import { Page } from './Page';
import { styles } from './styles';

/** A pending or refused connection can always be closed without having a live controller. */
export function ControllerStartup({
  title,
  failed,
  cancelStartup,
  onClose,
}: Readonly<{
  title: string;
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
      {failed && (
        <Text accessibilityRole="alert" style={styles.body}>
          {t('common.sessionRecovery')}
        </Text>
      )}
    </Page>
  );
}
