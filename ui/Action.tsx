import { IdentitySymbol } from '@kenshiki/identity-capture';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { t } from '../locales/i18n';
import { styles } from './styles';
import { size, symbol, symbolTint } from './tokens.generated';

export function Action({
  label,
  onPress,
  disabled = false,
  testID,
  secondary = false,
  destructive = false,
  back = false,
}: Readonly<{
  label: string;
  back?: boolean;
  onPress: () => unknown;
  disabled?: boolean | undefined;
  testID?: string | undefined;
  /** A plain tinted button, as iOS draws every action but the one prominent one. */
  secondary?: boolean | undefined;
  /** A plain red button: an action that deletes or discards. */
  destructive?: boolean | undefined;
}>) {
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
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        testID={testID}
        onPress={press}
        style={({ pressed }) => [
          secondary || destructive ? styles.plain : styles.action,
          back && { flexDirection: 'row', alignItems: 'center' },
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        {back && (
          <IdentitySymbol
            name={symbol.back}
            tint={symbolTint.back}
            style={{ width: size.iconGlyph, height: size.iconTile }}
          />
        )}
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
