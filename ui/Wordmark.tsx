import { StyleSheet, Text } from 'react-native';
import { t } from '../locales/i18n';
import { color, text } from './tokens.generated';

/** The brand's wordmark, for the Identity tab's navigation bar. It sits in the bar's row, above the
 * large title, so the title stays the screen's heading. A bar row has a fixed height, so the
 * wordmark keeps its size at every text size, as the bar's own title does. */
export function Wordmark() {
  return (
    <Text allowFontScaling={false} style={wordmarkStyles.wordmark}>
      {t('brand.wordmark')}
    </Text>
  );
}

const wordmarkStyles = StyleSheet.create({
  wordmark: { ...text.wordmark, color: color.wordmark },
});
