import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

const TICK_SPACING = 14;

interface RulerSliderProps {
  /** Valeurs discrètes (crans) de la molette. */
  count: number;
  index: number;
  onChange(index: number): void;
}

/**
 * Molette-règle horizontale façon Final Cut Camera : on glisse la règle,
 * l'aiguille centrale fixe indique le cran sélectionné.
 */
export function RulerSlider({ count, index, onChange }: RulerSliderProps) {
  const startIndex = useRef(0);
  const latest = useRef({ count, index, onChange });
  latest.current = { count, index, onChange };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startIndex.current = latest.current.index;
      },
      onPanResponderMove: (_evt, gesture) => {
        const { count, index, onChange } = latest.current;
        const next = Math.min(
          Math.max(Math.round(startIndex.current - gesture.dx / TICK_SPACING), 0),
          count - 1
        );
        if (next !== index) onChange(next);
      },
    })
  ).current;

  const ticks = Array.from({ length: count }, (_, i) => i);

  return (
    <View style={styles.container} {...responder.panHandlers}>
      <View
        style={[
          styles.ticksRow,
          // La règle se déplace, l'aiguille est fixe au centre.
          { transform: [{ translateX: -index * TICK_SPACING }] },
        ]}
      >
        {ticks.map((i) => (
          <View
            key={i}
            style={[styles.tick, i % 3 === 0 && styles.tickMajor, { marginLeft: i === 0 ? 0 : TICK_SPACING - StyleSheet.hairlineWidth * 2 }]}
          />
        ))}
      </View>
      <View pointerEvents="none" style={styles.needle} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
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
