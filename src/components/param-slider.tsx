import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

interface ParamSliderProps {
  value: number;
  min: number;
  max: number;
  /** Échelle logarithmique (ISO, vitesse) — min doit être > 0. */
  logarithmic?: boolean;
  disabled?: boolean;
  onChange(next: number): void;
}

function toRatio(value: number, min: number, max: number, log: boolean): number {
  if (max <= min) return 0;
  const ratio = log
    ? Math.log(value / min) / Math.log(max / min)
    : (value - min) / (max - min);
  return Math.min(Math.max(ratio, 0), 1);
}

function fromRatio(ratio: number, min: number, max: number, log: boolean): number {
  const t = Math.min(Math.max(ratio, 0), 1);
  return log ? min * Math.pow(max / min, t) : min + t * (max - min);
}

export function ParamSlider({ value, min, max, logarithmic = false, disabled = false, onChange }: ParamSliderProps) {
  const trackWidth = useRef(1);
  const latest = useRef({ min, max, logarithmic, disabled, onChange });
  latest.current = { min, max, logarithmic, disabled, onChange };

  const handleTouch = (locationX: number) => {
    const { min, max, logarithmic, disabled, onChange } = latest.current;
    if (disabled) return;
    onChange(fromRatio(locationX / trackWidth.current, min, max, logarithmic));
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleTouch(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => handleTouch(evt.nativeEvent.locationX),
    })
  ).current;

  const ratio = toRatio(value, min, max, logarithmic);

  return (
    <View
      style={[styles.track, disabled && styles.trackDisabled]}
      onLayout={(e) => {
        trackWidth.current = Math.max(e.nativeEvent.layout.width, 1);
      }}
      {...responder.panHandlers}
    >
      <View style={[styles.fill, { flex: ratio }]} />
      <View style={styles.thumb} />
      <View style={{ flex: 1 - ratio }} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  trackDisabled: {
    opacity: 0.35,
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#f5c518',
  },
  thumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
});
