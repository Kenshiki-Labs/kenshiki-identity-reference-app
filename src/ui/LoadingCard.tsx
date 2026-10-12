import { ActivityIndicator, Text, View } from 'react-native';
import { styles } from './styles';

/** A single loading surface until the screen can reveal its related evidence together. */
export function LoadingCard({ message, testID }: Readonly<{ message: string; testID?: string }>) {
  return (
    <View testID={testID} style={styles.card}>
      <ActivityIndicator />
      <Text accessibilityLiveRegion="polite" style={styles.body}>
        {message}
      </Text>
    </View>
  );
}
