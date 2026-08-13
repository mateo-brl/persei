import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PerseiCamera } from '../../modules/persei-camera';

/**
 * Histogramme de luminance temps réel (64 bins), abonné seul à l'événement
 * natif : ne re-rend jamais le reste de l'écran.
 */
export function Histogram() {
  const [bins, setBins] = useState<number[]>([]);

  useEffect(() => {
    const sub = PerseiCamera.addListener('onHistogram', (payload) => setBins(payload.bins));
    return () => sub.remove();
  }, []);

  if (!bins.length) return null;
  const maxBin = Math.max(...bins, 1);

  return (
    <View style={styles.container} pointerEvents="none">
      {bins.map((value, i) => (
        <View key={i} style={[styles.bar, { height: Math.max(1, (value / maxBin) * 40) }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    height: 44,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  bar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
  },
});
