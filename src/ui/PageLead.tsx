import { StyleSheet, Text, View } from 'react-native';
import { color, spacing, text } from './tokens.generated';

/** Content introduction below native navigation. Page owns the outer insets and section gaps. */
export function PageLead({ title, description }: Readonly<{ title: string; description?: string }>) {
  return (
    <View style={styles.lead}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { gap: spacing.xs },
  title: { ...text.screenTitle, color: color.text },
  description: { ...text.body, color: color.secondaryText },
});
