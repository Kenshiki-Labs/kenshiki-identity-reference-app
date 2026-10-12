import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../locales/i18n';
import { sensorConfig } from './SensorPresentation';
import { border, color, opacity, radius, size } from '../ui/tokens.generated';

const {
  minimumSeconds: minimum,
  maximumSeconds: maximum,
  stepSeconds: step,
} = sensorConfig.captureWindowSlider;
function bounded(value: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value / step) * step));
}
/** Commit once at the end of a drag; VoiceOver adjustments each commit one step. The row it sits in
 * shows the value, as a SwiftUI slider row does. */
export function SensorWindowSlider({
  label,
  value,
  disabled,
  onCommit,
}: Readonly<{
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}>) {
  const [width, setWidth] = useState(1);
  const [draft, setDraft] = useState<number>();
  const shown = draft ?? value;
  const position = (x: number) => bounded(minimum + (x / width) * (maximum - minimum));
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{
        min: minimum,
        max: maximum,
        now: shown,
        text: t('sensors.secondsSpoken', { value: shown.toFixed(1) }),
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
      onResponderRelease={(event) => {
        setDraft(undefined);
        onCommit(position(event.nativeEvent.locationX));
      }}
      onResponderTerminate={() => setDraft(undefined)}
      style={[sliderStyles.slider, disabled && sliderStyles.disabled]}
    >
      <View style={sliderStyles.track} />
      <View style={[sliderStyles.fill, { width: `${((shown - minimum) / (maximum - minimum)) * 100}%` }]} />
      <View style={[sliderStyles.thumb, { left: `${((shown - minimum) / (maximum - minimum)) * 100}%` }]} />
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
});
