import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from './locales/i18n';
import { sensorConfig } from './SensorPresentation';
import { border, color, opacity, radius, size, text } from './ui/tokens.generated';

const {
  minimumSeconds: minimum,
  maximumSeconds: maximum,
  stepSeconds: step,
} = sensorConfig.captureWindowSlider;
function bounded(value: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value / step) * step));
}
/** Commit once at the end of a drag; VoiceOver adjustments each commit one step. */
export function SensorWindowSlider({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const position = (x: number) => bounded(minimum + (x / width) * (maximum - minimum));
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{
        min: minimum,
        max: maximum,
        now: draft,
        text: t('sensors.secondsSpoken', { value: draft.toFixed(1) }),
      }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (!disabled)
          onCommit(bounded(value + (event.nativeEvent.actionName === 'increment' ? step : -step)));
      }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderGrant={(event) => setDraft(position(event.nativeEvent.locationX))}
      onResponderMove={(event) => setDraft(position(event.nativeEvent.locationX))}
      onResponderRelease={(event) => onCommit(position(event.nativeEvent.locationX))}
      onResponderTerminate={() => setDraft(value)}
      style={[sliderStyles.slider, disabled && sliderStyles.disabled]}
    >
      <View style={sliderStyles.track} />
      <View style={[sliderStyles.fill, { width: `${((draft - minimum) / (maximum - minimum)) * 100}%` }]} />
      <View style={[sliderStyles.thumb, { left: `${((draft - minimum) / (maximum - minimum)) * 100}%` }]} />
      <Text accessibilityElementsHidden style={sliderStyles.value}>
        {t('sensors.seconds', { value: draft.toFixed(1) })}
      </Text>
    </View>
  );
}
const sliderStyles = StyleSheet.create({
  slider: { height: size.touchTarget, justifyContent: 'center' },
  disabled: { opacity: opacity.disabled },
  track: { height: size.sliderTrack, borderRadius: radius.sliderTrack, backgroundColor: color.sliderTrack },
  fill: { position: 'absolute', height: size.sliderTrack, backgroundColor: color.tint },
  thumb: {
    position: 'absolute',
    marginLeft: -size.sliderThumb / 2,
    width: size.sliderThumb,
    height: size.sliderThumb,
    borderRadius: radius.full,
    backgroundColor: color.sliderThumb,
    borderColor: color.sliderThumbBorder,
    borderWidth: border.hairline,
  },
  value: {
    ...text.caption,
    position: 'absolute',
    right: 0,
    top: size.sliderValueOffset,
    color: color.secondaryText,
  },
});
