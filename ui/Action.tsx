import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { t } from '../locales/i18n';
import { styles } from './styles';

export function Action({
  label,
  onPress,
  disabled = false,
  testID,
  secondary = false,
  destructive = false,
}: {
  label: string;
  onPress: () => unknown;
  disabled?: boolean | undefined;
  testID?: string | undefined;
  /** A plain tinted button, as iOS draws every action but the one prominent one. */
  secondary?: boolean | undefined;
  /** A plain red button: an action that deletes or discards. */
  destructive?: boolean | undefined;
}) {
  const [failure, setFailure] = useState(false);
  const press = () => {
    setFailure(false);
    try {
      Promise.resolve(onPress()).catch(() => setFailure(true));
    } catch {
      setFailure(true);
    }
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        testID={testID}
        onPress={press}
        style={[secondary || destructive ? styles.plain : styles.action, disabled && styles.disabled]}
      >
        <Text
          style={[
            secondary || destructive ? styles.plainText : styles.actionText,
            destructive && styles.destructiveText,
          ]}
        >
          {label}
        </Text>
      </Pressable>
      {failure && (
        <Text accessibilityRole="alert" style={styles.body}>
          {t('common.actionFailed')}
        </Text>
      )}
    </>
  );
}
