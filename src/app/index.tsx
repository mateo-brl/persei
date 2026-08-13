import * as MediaLibrary from 'expo-media-library';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraCapabilities, LensId, PerseiCamera, PerseiCameraView } from '../../modules/persei-camera';
import { ParamSlider } from '../components/param-slider';

const LENS_LABELS: Record<LensId, string> = {
  ultraWide: '0,5×',
  wide: '1×',
  telephoto: 'Télé',
};

function formatShutter(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(1)} s`;
  return `1/${Math.round(1 / seconds)}`;
}

export default function CameraScreen() {
  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [caps, setCaps] = useState<CameraCapabilities | null>(null);
  const [lens, setLens] = useState<LensId>('wide');
  const [raw, setRaw] = useState(false);

  const [autoExposure, setAutoExposure] = useState(true);
  const [iso, setIso] = useState(100);
  const [shutter, setShutter] = useState(1 / 60);
  const [autoFocus, setAutoFocus] = useState(true);
  const [focusPosition, setFocusPosition] = useState(1);
  const [autoWb, setAutoWb] = useState(true);
  const [kelvin, setKelvin] = useState(5500);

  const [capturing, setCapturing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const granted = await PerseiCamera.requestPermission();
      setPermission(granted ? 'granted' : 'denied');
    })();
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return;
    (async () => {
      try {
        const capabilities = await PerseiCamera.start(lens);
        setCaps(capabilities);
      } catch (e) {
        setStatusMessage(`Erreur caméra : ${String(e)}`);
      }
    })();
  }, [permission, lens]);

  const applyExposure = useCallback(
    (nextAuto: boolean, nextIso: number, nextShutter: number) => {
      if (nextAuto) {
        PerseiCamera.setAutoExposure().catch(() => {});
      } else {
        PerseiCamera.setManualExposure(nextIso, nextShutter).catch(() => {});
      }
    },
    []
  );

  const applyFocus = useCallback((nextAuto: boolean, nextPosition: number) => {
    if (nextAuto) {
      PerseiCamera.setAutoFocus().catch(() => {});
    } else {
      PerseiCamera.setLensPosition(nextPosition).catch(() => {});
    }
  }, []);

  const applyWb = useCallback((nextAuto: boolean, nextKelvin: number) => {
    if (nextAuto) {
      PerseiCamera.setAutoWhiteBalance().catch(() => {});
    } else {
      PerseiCamera.setWhiteBalanceKelvin(nextKelvin).catch(() => {});
    }
  }, []);

  const capture = useCallback(async () => {
    setCapturing(true);
    setStatusMessage(null);
    try {
      const media = await MediaLibrary.requestPermissionsAsync();
      if (!media.granted) {
        setStatusMessage('Accès photothèque refusé');
        return;
      }
      const uris = await PerseiCamera.capturePhoto(raw);
      await Promise.all(uris.map((uri) => MediaLibrary.createAssetAsync(uri)));
      setStatusMessage(raw ? 'Enregistrée (RAW + HEIC) ✓' : 'Enregistrée ✓');
    } catch (e) {
      setStatusMessage(`Échec capture : ${String(e)}`);
    } finally {
      setCapturing(false);
    }
  }, [raw]);

  if (permission === 'denied') {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.text}>
          Persei a besoin de l'appareil photo. Autorise-le dans Réglages → Persei.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <PerseiCameraView style={StyleSheet.absoluteFill} />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <View style={styles.lensRow}>
            {(caps?.lenses ?? []).map((id) => (
              <Pressable
                key={id}
                style={[styles.chip, lens === id && styles.chipActive]}
                onPress={() => setLens(id)}
              >
                <Text style={styles.chipText}>{LENS_LABELS[id]}</Text>
              </Pressable>
            ))}
          </View>
          {caps?.supportsRaw ? (
            <Pressable style={[styles.chip, raw && styles.chipActive]} onPress={() => setRaw(!raw)}>
              <Text style={styles.chipText}>{caps.supportsProRaw ? 'ProRAW' : 'RAW'}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.bottomPanel}>
          {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}

          <ControlRow
            label={`ISO ${autoExposure ? 'A' : Math.round(iso)}`}
            auto={autoExposure}
            onToggleAuto={() => {
              const next = !autoExposure;
              setAutoExposure(next);
              applyExposure(next, iso, shutter);
            }}
          >
            <ParamSlider
              value={iso}
              min={caps?.minIso ?? 32}
              max={caps?.maxIso ?? 12800}
              logarithmic
              disabled={autoExposure}
              onChange={(v) => {
                setIso(v);
                applyExposure(false, v, shutter);
              }}
            />
          </ControlRow>

          <ControlRow label={`Vitesse ${autoExposure ? 'A' : formatShutter(shutter)}`} auto={autoExposure}>
            <ParamSlider
              value={shutter}
              min={caps?.minShutter ?? 1 / 16000}
              max={caps?.maxShutter ?? 1}
              logarithmic
              disabled={autoExposure}
              onChange={(v) => {
                setShutter(v);
                applyExposure(false, iso, v);
              }}
            />
          </ControlRow>

          <ControlRow
            label={`Focus ${autoFocus ? 'A' : focusPosition.toFixed(2)}`}
            auto={autoFocus}
            onToggleAuto={() => {
              const next = !autoFocus;
              setAutoFocus(next);
              applyFocus(next, focusPosition);
            }}
          >
            <ParamSlider
              value={focusPosition}
              min={0}
              max={1}
              disabled={autoFocus}
              onChange={(v) => {
                setFocusPosition(v);
                applyFocus(false, v);
              }}
            />
          </ControlRow>

          <ControlRow
            label={`BdB ${autoWb ? 'A' : `${Math.round(kelvin)} K`}`}
            auto={autoWb}
            onToggleAuto={() => {
              const next = !autoWb;
              setAutoWb(next);
              applyWb(next, kelvin);
            }}
          >
            <ParamSlider
              value={kelvin}
              min={2500}
              max={8000}
              disabled={autoWb}
              onChange={(v) => {
                setKelvin(v);
                applyWb(false, v);
              }}
            />
          </ControlRow>

          <Pressable style={styles.shutterButton} onPress={capture} disabled={capturing || !caps}>
            {capturing ? <ActivityIndicator color="#000" /> : <View style={styles.shutterInner} />}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function ControlRow({
  label,
  auto,
  onToggleAuto,
  children,
}: {
  label: string;
  auto: boolean;
  onToggleAuto?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.controlRow}>
      <Pressable style={styles.controlLabelBox} onPress={onToggleAuto} disabled={!onToggleAuto}>
        <Text style={[styles.controlLabel, !auto && styles.controlLabelManual]}>{label}</Text>
      </Pressable>
      <View style={styles.controlSlider}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  lensRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  chipActive: {
    backgroundColor: 'rgba(245, 197, 24, 0.85)',
  },
  chipText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  bottomPanel: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  status: {
    color: '#f5c518',
    textAlign: 'center',
    fontSize: 13,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  controlLabelBox: {
    width: 110,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  controlLabel: {
    color: '#9aa0a6',
    fontSize: 12,
    fontWeight: '600',
  },
  controlLabelManual: {
    color: '#f5c518',
  },
  controlSlider: {
    flex: 1,
  },
  shutterButton: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    borderColor: '#000',
    backgroundColor: '#fff',
  },
});
