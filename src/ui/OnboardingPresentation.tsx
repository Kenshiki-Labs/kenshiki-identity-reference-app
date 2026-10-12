import { Image, type ImageSourcePropType, StyleSheet, Text, View } from 'react-native';
import { color, radius, size, spacing, text } from './tokens.generated';

/** Decorative design artwork; the adjacent lead supplies the screen's accessible meaning. */
export function OnboardingHero({
  source,
  width,
  height,
  panelHeight,
}: Readonly<{
  source: ImageSourcePropType;
  width: number;
  height: number;
  panelHeight: number;
}>) {
  return (
    <View style={[styles.hero, { minHeight: panelHeight }]} accessible={false}>
      <Image source={source} style={{ width, height }} accessible={false} />
    </View>
  );
}

/** Instructions grow with Dynamic Type; artwork stays decorative and keeps its design geometry. */
export function OnboardingInstructions({
  items,
}: Readonly<{
  items: readonly {
    key: string;
    source: ImageSourcePropType;
    width: number;
    height: number;
    label: string;
  }[];
}>) {
  return (
    <View style={styles.instructions}>
      {items.map((item) => (
        <View key={item.key} style={styles.row}>
          <View style={styles.well} accessible={false}>
            <Image
              source={item.source}
              style={{ width: item.width, height: item.height }}
              accessible={false}
            />
          </View>
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.hero,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructions: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  well: {
    width: size.well,
    height: size.well,
    borderRadius: radius.well,
    backgroundColor: color.tintSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...text.rowTitle, color: color.text, flex: 1 },
});
