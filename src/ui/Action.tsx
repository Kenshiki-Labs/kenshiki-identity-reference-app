import { IdentitySymbol } from '@kenshiki/identity-capture';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { t } from '../locales/i18n';
import { ButtonRow, TextRow } from './List';
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
  grouped = false,
}: Readonly<{
  label: string;
  grouped?: boolean;
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
  if (grouped)
    return (
      <>
        <ButtonRow
          label={label}
          onPress={press}
          disabled={disabled}
          destructive={destructive}
          testID={testID}
        />
        {failure && <TextRow text={t('common.actionFailed')} tone="warning" alert />}
      </>
    );
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
