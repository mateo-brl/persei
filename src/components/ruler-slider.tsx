import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const TICK_SPACING = 14;

interface RulerSliderProps {
  /** Nombre de crans de la molette. */
  count: number;
  index: number;
  onChange(index: number): void;
}

const Ticks = memo(function Ticks({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.tick,
            i % 3 === 0 && styles.tickMajor,
            { marginLeft: i === 0 ? 0 : TICK_SPACING - StyleSheet.hairlineWidth * 2 },
          ]}
        />
      ))}
    </>
  );
});

/**
 * Molette-règle horizontale façon Final Cut Camera. Le geste et la translation
 * du rail restent sur le thread UI (Reanimated) ; seul le changement de cran
 * repasse côté JS.
 */
export function RulerSlider({ count, index, onChange }: RulerSliderProps) {
  const offset = useSharedValue(index * TICK_SPACING);
  const startOffset = useSharedValue(0);
  const lastIndex = useSharedValue(index);
  const dragging = useSharedValue(false);

  useEffect(() => {
    // Resynchronise sur ouverture/seed externe, jamais pendant un glissement.
    if (!dragging.value) {
      offset.value = index * TICK_SPACING;
      lastIndex.value = index;
    }
  }, [index, count, offset, lastIndex, dragging]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          'worklet';
          dragging.value = true;
          startOffset.value = offset.value;
        })
        .onUpdate((e) => {
          'worklet';
          const max = (count - 1) * TICK_SPACING;
          const next = Math.min(Math.max(startOffset.value - e.translationX, 0), max);
          offset.value = next;
          const idx = Math.round(next / TICK_SPACING);
          if (idx !== lastIndex.value) {
            lastIndex.value = idx;
            runOnJS(onChange)(idx);
          }
        })
        .onFinalize(() => {
          'worklet';
          dragging.value = false;
          offset.value = withTiming(lastIndex.value * TICK_SPACING, { duration: 80 });
        }),
    [count, onChange, offset, startOffset, lastIndex, dragging]
  );

  const railStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -offset.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.container}>
        <Animated.View style={[styles.ticksRow, railStyle]}>
          <Ticks count={count} />
        </Animated.View>
        <View pointerEvents="none" style={styles.needle} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    // flex: 1 obligatoire : le rail est en position absolue et ne donne
    // aucune largeur intrinsèque au conteneur.
    flex: 1,
    height: 44,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  ticksRow: {
    position: 'absolute',
    left: '50%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  tick: {
    width: StyleSheet.hairlineWidth * 2,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  tickMajor: {
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  needle: {
    position: 'absolute',
    alignSelf: 'center',
    width: 2,
    height: 30,
    borderRadius: 1,
    backgroundColor: '#ffb800',
  },
});
