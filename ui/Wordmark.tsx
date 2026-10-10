import { StyleSheet, Text } from 'react-native';
import { t } from '../locales/i18n';
import { color, text } from './tokens.generated';

/** Brand text used only by Page, at the same position on every screen and sheet. */
export function Wordmark() {
  return (
    <Text testID="page-wordmark" allowFontScaling={false} style={wordmarkStyles.wordmark}>
      {t('brand.wordmark')}
    </Text>
  );
}

const wordmarkStyles = StyleSheet.create({
  wordmark: { ...text.wordmark, color: color.wordmark },
});
