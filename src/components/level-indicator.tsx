import { Accelerometer } from 'expo-sensors';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Niveau à bulle : ligne horizontale qui suit l'inclinaison du téléphone
 * (portrait), verte quand l'horizon est droit à ±1°.
 */
export function LevelIndicator() {
  const [roll, setRoll] = useState(0);

  useEffect(() => {
    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener(({ x, y }) => {
      setRoll((Math.atan2(-x, -y) * 180) / Math.PI);
    });
    return () => sub.remove();
  }, []);

  const isLevel = Math.abs(roll) < 1;

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.reference} />
      <View
        style={[
          styles.line,
          isLevel && styles.lineLevel,
          { transform: [{ rotate: `${-roll}deg` }] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reference: {
    position: 'absolute',
    width: 160,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  line: {
    width: 120,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  lineLevel: {
    backgroundColor: '#30d158',
    width: 160,
  },
});
