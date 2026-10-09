import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { sensorConfig } from './SensorPresentation';

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
      accessibilityValue={{ min: minimum, max: maximum, now: draft, text: `${draft.toFixed(1)} seconds` }}
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
      style={{ height: 44, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: '#d1d1d6' }} />
      <View
        style={{
          position: 'absolute',
          height: 4,
          width: `${((draft - minimum) / (maximum - minimum)) * 100}%`,
          backgroundColor: '#007aff',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: `${((draft - minimum) / (maximum - minimum)) * 100}%`,
          marginLeft: -12,
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: '#fff',
          borderColor: '#ddd',
          borderWidth: 1,
        }}
      />
      <Text
        accessibilityElementsHidden
        style={{ position: 'absolute', right: 0, top: 30, fontSize: 10, color: '#60606a' }}
      >
        {draft.toFixed(1)} s
      </Text>
    </View>
  );
}
