import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CameraCapabilities,
  ExposureUpdate,
  LensId,
  PerseiCamera,
  PerseiCameraView,
} from '../../modules/persei-camera';
import { RulerSlider } from '../components/ruler-slider';

const ACCENT = '#ffb800';

const LENS_LABELS: Record<LensId, string> = {
  ultraWide: '0,5×',
  wide: '1×',
  telephoto: '3×',
};

const ISO_BASE = [
  25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600,
  2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800,
];

const SHUTTER_BASE = [
  1 / 16000, 1 / 12800, 1 / 10000, 1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500,
  1 / 2000, 1 / 1600, 1 / 1250, 1 / 1000, 1 / 800, 1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250,
  1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40, 1 / 30, 1 / 25, 1 / 20,
  1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 0.4, 0.5, 0.6, 0.8, 1,
];

const FOCUS_STOPS = Array.from({ length: 101 }, (_, i) => i / 100);
const WB_STOPS = Array.from({ length: 56 }, (_, i) => 2500 + i * 100);

type ParamKey = 'iso' | 'shutter' | 'ev' | 'focus' | 'wb';

function nearestIndex(values: number[], target: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
  }
  return best;
}

function formatShutter(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds >= 0.4) return `${seconds.toFixed(1)}s`;
  return `1/${Math.round(1 / seconds)}`;
}

function formatFocus(position: number): string {
  return position >= 0.99 ? '∞' : position.toFixed(2);
}

export default function CameraScreen() {
  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [caps, setCaps] = useState<CameraCapabilities | null>(null);
  const [lens, setLens] = useState<LensId>('wide');
  const [raw, setRaw] = useState(false);
  const [live, setLive] = useState<ExposureUpdate | null>(null);

  const [exposureAuto, setExposureAuto] = useState(true);
  const [focusAuto, setFocusAuto] = useState(true);
  const [wbAuto, setWbAuto] = useState(true);
  const [isoIdx, setIsoIdx] = useState(0);
  const [shutterIdx, setShutterIdx] = useState(0);
  const [evIdx, setEvIdx] = useState(0);
  const [focusIdx, setFocusIdx] = useState(FOCUS_STOPS.length - 1);
  const [wbIdx, setWbIdx] = useState(30);

  const [activeParam, setActiveParam] = useState<ParamKey | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [thumbUri, setThumbUri] = useState<string | null>(null);

  const liveRef = useRef(live);
  liveRef.current = live;

  const isoStops = useMemo(
    () => (caps ? ISO_BASE.filter((v) => v >= caps.minIso && v <= caps.maxIso) : ISO_BASE),
    [caps]
  );
  const shutterStops = useMemo(
    () =>
      caps
        ? SHUTTER_BASE.filter((v) => v >= caps.minShutter && v <= caps.maxShutter)
        : SHUTTER_BASE,
    [caps]
  );
  const evStops = useMemo(() => {
    if (!caps) return [0];
    const stops: number[] = [];
    for (let v = caps.minExposureBias; v <= caps.maxExposureBias + 0.01; v += 1 / 3) {
      stops.push(Math.round(v * 10) / 10);
    }
    return stops;
  }, [caps]);

  useEffect(() => {
    (async () => {
      const granted = await PerseiCamera.requestPermission();
      setPermission(granted ? 'granted' : 'denied');
    })();
  }, []);

  useEffect(() => {
    const sub = PerseiCamera.addListener('onExposureUpdate', setLive);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (permission !== 'granted') return;
    (async () => {
      try {
        const capabilities = await PerseiCamera.start(lens);
        setCaps(capabilities);
      } catch (e) {
        setToast(`Erreur caméra : ${String(e)}`);
      }
    })();
  }, [permission, lens]);

  // Un changement d'objectif réinitialise le matériel : on réapplique les modes manuels.
  useEffect(() => {
    if (!caps) return;
    if (!exposureAuto) {
      PerseiCamera.setManualExposure(isoStops[isoIdx], shutterStops[shutterIdx]).catch(() => {});
    }
    if (!focusAuto) {
      PerseiCamera.setLensPosition(FOCUS_STOPS[focusIdx]).catch(() => {});
    }
    if (!wbAuto) {
      PerseiCamera.setWhiteBalanceKelvin(WB_STOPS[wbIdx]).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps]);

  const applyManualExposure = useCallback(
    (iso: number, shutter: number) => {
      PerseiCamera.setManualExposure(iso, shutter).catch(() => {});
    },
    []
  );

  const enterManualExposure = useCallback(() => {
    const current = liveRef.current;
    const iIdx = nearestIndex(isoStops, current?.iso ?? 100);
    const sIdx = nearestIndex(shutterStops, current?.shutter ?? 1 / 60);
    setIsoIdx(iIdx);
    setShutterIdx(sIdx);
    setExposureAuto(false);
    applyManualExposure(isoStops[iIdx], shutterStops[sIdx]);
  }, [isoStops, shutterStops, applyManualExposure]);

  const paramToAuto = useCallback(
    (param: ParamKey) => {
      if (param === 'iso' || param === 'shutter') {
        setExposureAuto(true);
        PerseiCamera.setAutoExposure().catch(() => {});
      } else if (param === 'focus') {
        setFocusAuto(true);
        PerseiCamera.setAutoFocus().catch(() => {});
      } else if (param === 'wb') {
        setWbAuto(true);
        PerseiCamera.setAutoWhiteBalance().catch(() => {});
      } else if (param === 'ev') {
        const zero = nearestIndex(evStops, 0);
        setEvIdx(zero);
        PerseiCamera.setExposureBias(0).catch(() => {});
      }
    },
    [evStops]
  );

  const onRulerChange = useCallback(
    (param: ParamKey, index: number) => {
      switch (param) {
        case 'iso':
          if (exposureAuto) enterManualExposure();
          setIsoIdx(index);
          applyManualExposure(isoStops[index], shutterStops[shutterIdx]);
          break;
        case 'shutter':
          if (exposureAuto) enterManualExposure();
          setShutterIdx(index);
          applyManualExposure(isoStops[isoIdx], shutterStops[index]);
          break;
        case 'ev':
          setEvIdx(index);
          PerseiCamera.setExposureBias(evStops[index]).catch(() => {});
          break;
        case 'focus':
          setFocusAuto(false);
          setFocusIdx(index);
          PerseiCamera.setLensPosition(FOCUS_STOPS[index]).catch(() => {});
          break;
        case 'wb':
          setWbAuto(false);
          setWbIdx(index);
          PerseiCamera.setWhiteBalanceKelvin(WB_STOPS[index]).catch(() => {});
          break;
      }
    },
    [exposureAuto, enterManualExposure, applyManualExposure, isoStops, shutterStops, isoIdx, shutterIdx, evStops]
  );

  const openParam = useCallback(
    (param: ParamKey) => {
      setActiveParam((prev) => (prev === param ? null : param));
      // Ouvre la molette sur la valeur courante du capteur.
      const current = liveRef.current;
      if (param === 'iso' && exposureAuto) setIsoIdx(nearestIndex(isoStops, current?.iso ?? 100));
      if (param === 'shutter' && exposureAuto)
        setShutterIdx(nearestIndex(shutterStops, current?.shutter ?? 1 / 60));
      if (param === 'focus' && focusAuto)
        setFocusIdx(nearestIndex(FOCUS_STOPS, current?.lensPosition ?? 1));
      if (param === 'wb' && wbAuto)
        setWbIdx(nearestIndex(WB_STOPS, current?.whiteBalanceKelvin || 5500));
    },
    [exposureAuto, focusAuto, wbAuto, isoStops, shutterStops]
  );

  const zoomBase = useRef(1);
  const rememberZoom = useCallback(() => {
    zoomBase.current = liveRef.current?.zoom ?? 1;
  }, []);
  const applyZoom = useCallback(
    (scale: number) => {
      const min = caps?.minZoom ?? 1;
      const max = Math.min(caps?.maxZoom ?? 6, 10);
      const next = Math.min(Math.max(zoomBase.current * scale, min), max);
      PerseiCamera.setZoom(next).catch(() => {});
    },
    [caps]
  );
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          'worklet';
          runOnJS(rememberZoom)();
        })
        .onUpdate((e) => {
          'worklet';
          runOnJS(applyZoom)(e.scale);
        }),
    [rememberZoom, applyZoom]
  );

  const capture = useCallback(async () => {
    setCapturing(true);
    try {
      const media = await MediaLibrary.requestPermissionsAsync();
      if (!media.granted) {
        setToast('Accès photothèque refusé');
        return;
      }
      const uris = await PerseiCamera.capturePhoto(raw && (caps?.supportsRaw ?? false));
      await Promise.all(uris.map((uri) => MediaLibrary.createAssetAsync(uri)));
      const heic = uris.find((u) => u.endsWith('.heic')) ?? uris[0];
      if (heic) setThumbUri(heic);
    } catch (e) {
      setToast(`Échec capture : ${String(e)}`);
    } finally {
      setCapturing(false);
    }
  }, [raw, caps]);

  if (permission === 'denied') {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.deniedText}>
          Persei a besoin de l'appareil photo. Autorise-le dans Réglages → Persei.
        </Text>
      </SafeAreaView>
    );
  }

  const zoomLabel = live ? `${(live.zoom ?? 1).toFixed(1).replace(/\.0$/, '')}×` : null;

  const chips: { key: ParamKey; label: string; value: string; manual: boolean }[] = [
    {
      key: 'iso',
      label: 'ISO',
      value: exposureAuto ? `${live ? Math.round(live.iso) : '—'}` : `${isoStops[isoIdx]}`,
      manual: !exposureAuto,
    },
    {
      key: 'shutter',
      label: 'VITESSE',
      value: exposureAuto ? formatShutter(live?.shutter ?? 0) : formatShutter(shutterStops[shutterIdx]),
      manual: !exposureAuto,
    },
    {
      key: 'ev',
      label: 'EV',
      value: `${evStops[evIdx] > 0 ? '+' : ''}${(evStops[evIdx] ?? 0).toFixed(1)}`,
      manual: (evStops[evIdx] ?? 0) !== 0,
    },
    {
      key: 'focus',
      label: 'FOCUS',
      value: focusAuto ? formatFocus(live?.lensPosition ?? 1) : formatFocus(FOCUS_STOPS[focusIdx]),
      manual: !focusAuto,
    },
    {
      key: 'wb',
      label: 'BDB',
      value: wbAuto
        ? `${live?.whiteBalanceKelvin ? Math.round(live.whiteBalanceKelvin) : '—'}K`
        : `${WB_STOPS[wbIdx]}K`,
      manual: !wbAuto,
    },
  ];

  const rulerFor = (param: ParamKey): { count: number; index: number } => {
    switch (param) {
      case 'iso':
        return { count: isoStops.length, index: isoIdx };
      case 'shutter':
        return { count: shutterStops.length, index: shutterIdx };
      case 'ev':
        return { count: evStops.length, index: evIdx };
      case 'focus':
        return { count: FOCUS_STOPS.length, index: focusIdx };
      case 'wb':
        return { count: WB_STOPS.length, index: wbIdx };
    }
  };

  const paramIsAuto = (param: ParamKey): boolean => {
    if (param === 'iso' || param === 'shutter') return exposureAuto;
    if (param === 'focus') return focusAuto;
    if (param === 'wb') return wbAuto;
    return (evStops[evIdx] ?? 0) === 0;
  };

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pinch}>
        <PerseiCameraView style={StyleSheet.absoluteFill} />
      </GestureDetector>

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <View style={styles.lensRow}>
            {(caps?.lenses ?? []).map((id) => (
              <Pressable
                key={id}
                style={[styles.lensPill, lens === id && styles.lensPillActive]}
                onPress={() => setLens(id)}
              >
                <Text style={[styles.lensText, lens === id && styles.lensTextActive]}>
                  {LENS_LABELS[id]}
                </Text>
              </Pressable>
            ))}
            {zoomLabel ? <Text style={styles.zoomText}>{zoomLabel}</Text> : null}
          </View>
          {caps?.supportsRaw ? (
            <Pressable
              style={[styles.rawBadge, raw && styles.rawBadgeActive]}
              onPress={() => setRaw(!raw)}
            >
              <Text style={[styles.rawText, raw && styles.rawTextActive]}>
                {caps.supportsProRaw ? 'ProRAW' : 'RAW'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.bottomArea}>
          {toast ? (
            <View style={styles.toast}>
              <Text style={styles.toastText} numberOfLines={3}>
                {toast}
              </Text>
            </View>
          ) : null}

          {activeParam ? (
            <View style={styles.rulerPanel}>
              <RulerSlider
                {...rulerFor(activeParam)}
                onChange={(i) => onRulerChange(activeParam, i)}
              />
              <Pressable
                style={[styles.autoButton, paramIsAuto(activeParam) && styles.autoButtonActive]}
                onPress={() => paramToAuto(activeParam)}
              >
                <Text
                  style={[styles.autoText, paramIsAuto(activeParam) && styles.autoTextActive]}
                >
                  AUTO
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.chipsRow}>
            {chips.map((chip) => (
              <Pressable
                key={chip.key}
                style={[styles.chip, activeParam === chip.key && styles.chipActive]}
                onPress={() => openParam(chip.key)}
              >
                <Text style={styles.chipLabel}>{chip.label}</Text>
                <Text style={[styles.chipValue, chip.manual && styles.chipValueManual]}>
                  {chip.manual ? chip.value : `A ${chip.value}`}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.shutterRow}>
            <View style={styles.thumbBox}>
              {thumbUri ? (
                <Image source={{ uri: thumbUri }} style={styles.thumb} contentFit="cover" />
              ) : null}
            </View>
            <Pressable
              style={({ pressed }) => [styles.shutterButton, pressed && styles.shutterPressed]}
              onPress={capture}
              disabled={capturing || !caps}
            >
              {capturing ? (
                <ActivityIndicator color="#000" />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </Pressable>
            <View style={styles.thumbBox} />
          </View>
        </View>
      </SafeAreaView>
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
  deniedText: {
    color: '#e8e8e8',
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
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  lensRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 20,
    padding: 4,
  },
  lensPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  lensPillActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  lensText: {
    color: '#9b9b9b',
    fontSize: 13,
    fontWeight: '600',
  },
  lensTextActive: {
    color: ACCENT,
  },
  zoomText: {
    color: '#e8e8e8',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginHorizontal: 8,
  },
  rawBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rawBadgeActive: {
    borderColor: ACCENT,
  },
  rawText: {
    color: '#9b9b9b',
    fontSize: 12,
    fontWeight: '700',
  },
  rawTextActive: {
    color: ACCENT,
  },
  bottomArea: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 8,
  },
  toast: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '92%',
  },
  toastText: {
    color: '#ffd60a',
    fontSize: 12,
    textAlign: 'center',
  },
  rulerPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  autoButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  autoButtonActive: {
    backgroundColor: ACCENT,
  },
  autoText: {
    color: '#e8e8e8',
    fontSize: 11,
    fontWeight: '700',
  },
  autoTextActive: {
    color: '#000',
  },
  chipsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  chipLabel: {
    color: '#9b9b9b',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  chipValue: {
    color: '#e8e8e8',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  chipValueManual: {
    color: ACCENT,
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  thumbBox: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: {
    opacity: 0.6,
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
  },
});
