import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { SymbolView } from 'expo-symbols';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CameraCapabilities,
  CameraPosition,
  ExposureUpdate,
  FlashMode,
  PerseiCamera,
  PerseiCameraView,
  QualityPrioritization,
  StackMode,
  ZoomPreset,
} from '../../modules/persei-camera';
import { Histogram } from '../components/histogram';
import { LevelIndicator } from '../components/level-indicator';
import { RulerSlider } from '../components/ruler-slider';

const ACCENT = '#ffb800';

function formatZoomFactor(factor: number): string {
  return `${(Math.round(factor * 10) / 10).toString().replace('.', ',')}×`;
}

/** Durées de pose proposées (secondes) — aucun plafond matériel, c'est de l'empilement. */
const POSE_DURATIONS = [10, 30, 60, 300, 900, 1800];
const POSE_DURATION_LABELS = ['10 s', '30 s', '1 min', '5 min', '15 min', '30 min'];

/** Presets scénario : un tap règle exposition, focus, durée et style de pose. */
interface ScenePreset {
  id: string;
  emoji: string;
  label: string;
  description: string;
  duration: number;
  style: StackMode;
  /** ISO manuel (trames de 1 s), ou null pour empiler des trames auto (jour). */
  iso: number | null;
  /** Position de focus manuelle (1 = ∞), ou null pour laisser l'autofocus. */
  focus: number | null;
}

const SCENE_PRESETS: ScenePreset[] = [
  {
    id: 'meteors',
    emoji: '🌠',
    label: 'Étoiles filantes',
    description:
      "Une minute de pose en mode Les deux. La fusion max garde les traînées, la moyenne donne un ciel propre. ISO 1600, focus sur ∞, capteur principal 1×. Cale bien le téléphone.",
    duration: 60,
    style: 'both',
    iso: 1600,
    focus: 1,
  },
  {
    id: 'startrails',
    emoji: '⭐',
    label: 'Star trails',
    description:
      "Trente minutes de pose en fusion max. Les étoiles tracent des arcs autour du pôle. ISO 800, focus sur ∞. Pense à la batterie.",
    duration: 1800,
    style: 'max',
    iso: 800,
    focus: 1,
  },
  {
    id: 'water',
    emoji: '💧',
    label: "Filé d'eau",
    description:
      "Dix secondes en moyenne, exposition automatique : les trames courtes s'empilent et l'eau devient soyeuse, même en plein jour.",
    duration: 10,
    style: 'mean',
    iso: null,
    focus: null,
  },
  {
    id: 'fireworks',
    emoji: '🎆',
    label: "Feux d'artifice",
    description:
      "Dix secondes en fusion max. Toutes les gerbes du bouquet s'accumulent sur une seule image. ISO 100, focus sur ∞.",
    duration: 10,
    style: 'max',
    iso: 100,
    focus: 1,
  },
  {
    id: 'lighttrails',
    emoji: '🌃',
    label: 'Light trails',
    description:
      "Trente secondes en fusion max. Les phares dessinent des rubans de lumière dans la ville. ISO 50.",
    duration: 30,
    style: 'max',
    iso: 50,
    focus: null,
  },
];

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
const TINT_STOPS = Array.from({ length: 61 }, (_, i) => -150 + i * 5);
const TORCH_STOPS = Array.from({ length: 21 }, (_, i) => i / 20);

type ParamKey = 'iso' | 'shutter' | 'ev' | 'focus' | 'wb' | 'tint';

/** Explications pédagogiques : effet de chaque réglage sur la photo. */
const HELP_TEXTS: Record<string, string> = {
  iso: "Sensibilité du capteur. En bas de la plage (25 à 100), l'image est propre mais sombre. Plus tu montes, plus elle s'éclaircit et plus le grain apparaît. Pour les étoiles, vise 1600 à 3200.",
  shutter:
    "Temps pendant lequel le capteur reçoit la lumière. Une vitesse rapide (1/500) fige le mouvement. Une vitesse lente capte plus de lumière, mais le moindre tremblement floute l'image. Pour les étoiles, 1 s sur trépied.",
  ev: "Correction d'exposition en mode auto. Vers + la photo s'éclaircit, vers − elle s'assombrit. Les autres réglages ne bougent pas.",
  focus:
    "Mise au point manuelle. 0 fait le net tout près, ∞ au loin. Pour un ciel étoilé ou un paysage, mets ∞.",
  wb: "Température de couleur en kelvins. 2500 K tire vers le bleu, 8000 K vers l'orangé. Sert à corriger la couleur de la lumière ambiante.",
  tint: "Complète la température sur l'axe vert-magenta. Utile sous les néons ou les LED qui verdissent l'image.",
  flash: "Éclair au déclenchement. En auto, il ne part que si la scène est sombre.",
  torch:
    "Lampe allumée en continu pendant la visée, avec intensité réglable. Pratique en vidéo ou pour faire le point la nuit.",
  resolution:
    "En 48 MP tu gardes un maximum de détails et tu peux recadrer large, mais les fichiers pèsent environ quatre fois plus. Le 12 MP fusionne les pixels : fichiers légers et meilleur rendu en basse lumière.",
  quality:
    "Niveau de traitement appliqué par l'iPhone. Max fusionne plusieurs images, c'est plus net mais un peu plus lent. Vitesse capture immédiatement avec un traitement minimal, au rendu plus brut.",
  bracket:
    "Trois photos d'affilée : une sombre, une normale, une claire. Tu choisis la bonne ensuite, ou tu les fusionnes en HDR.",
  livePhoto: "Enregistre environ 1,5 s de vidéo autour de la photo, sauvée dans un fichier séparé.",
  depth: "Enregistre la carte de profondeur avec la photo, pour les effets portrait en retouche.",
  timer: "Retarde le déclenchement. Le temps de caler le téléphone ou d'entrer dans le cadre.",
  grid: "Grille des tiers. Place ton sujet sur une ligne ou une intersection, la composition respire mieux.",
  nightVision:
    "Passe toute l'interface en rouge sombre. Tes yeux mettent 20 à 30 minutes à se réhabituer au noir après un écran lumineux, le rouge évite de perdre cette adaptation.",
  peaking:
    "Surligne en vert les zones nettes de l'image. C'est le plus simple pour réussir une mise au point manuelle, surtout la nuit.",
  zebras:
    "Marque en rouge les zones surexposées. Si une zone importante se raye, baisse l'ISO ou accélère la vitesse.",
  histogram:
    "Répartition des luminosités, ombres à gauche, hautes lumières à droite. Un paquet collé à droite signale une photo cramée, collé à gauche une photo bouchée.",
  level:
    "La ligne suit l'inclinaison du téléphone et devient verte quand l'horizon est droit.",
  align:
    "Recale chaque image sur la première pendant la pose. Permet de poser sans trépied si tu restes à peu près stable.",
  meteorFilter:
    "Ne garde pour la fusion max que les images où quelque chose est passé dans le ciel. Les traînées ressortent sur un fond plus propre.",
  autoNight:
    "Quand la scène est sombre et que tu es en photo simple, le déclencheur lance automatiquement une pose alignée de 10 s au lieu d'un cliché bruité. L'équivalent du mode Nuit d'Apple, en mieux réglable.",
};

function formatError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err?.message) return err.code ? `${err.code} ${err.message}` : err.message;
  return String(e);
}

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
  const [front, setFront] = useState(false);
  const [raw, setRaw] = useState(false);
  const [captureMode, setCaptureMode] = useState<'photo' | 'pose'>('photo');
  const [poseDuration, setPoseDuration] = useState(30);
  const [poseStyle, setPoseStyle] = useState<StackMode>('both');
  const [posing, setPosing] = useState(false);
  const [poseProgress, setPoseProgress] = useState<{ frame: number; total: number } | null>(null);

  const [exposureAuto, setExposureAuto] = useState(true);
  const [focusAuto, setFocusAuto] = useState(true);
  const [wbAuto, setWbAuto] = useState(true);
  const [isoIdx, setIsoIdx] = useState(0);
  const [shutterIdx, setShutterIdx] = useState(0);
  const [evIdx, setEvIdx] = useState(0);
  const [focusIdx, setFocusIdx] = useState(FOCUS_STOPS.length - 1);
  const [wbIdx, setWbIdx] = useState(30);
  const [tintIdx, setTintIdx] = useState(30);

  // Réglages secondaires (tiroir).
  const [showSettings, setShowSettings] = useState(false);
  const [flash, setFlash] = useState<FlashMode>('off');
  const [torch, setTorch] = useState(0);
  const [livePhoto, setLivePhoto] = useState(false);
  const [depth, setDepth] = useState(false);
  const [highRes, setHighRes] = useState(true);
  const [quality, setQuality] = useState<QualityPrioritization>('quality');
  const [bracketEv, setBracketEv] = useState(0);
  const [timerSecs, setTimerSecs] = useState(0);
  const [grid, setGrid] = useState(false);
  const [autoNight, setAutoNight] = useState(true);

  const [activeParam, setActiveParam] = useState<ParamKey | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [nightVision, setNightVision] = useState(false);
  const [peaking, setPeaking] = useState(false);
  const [zebras, setZebras] = useState(false);
  const [histogramOn, setHistogramOn] = useState(false);
  const [levelOn, setLevelOn] = useState(false);
  const [poseAlign, setPoseAlign] = useState(false);
  const [poseMeteor, setPoseMeteor] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [thumbUri, setThumbUri] = useState<string | null>(null);
  const [lastUris, setLastUris] = useState<string[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);

  // Lecture capteur en ref uniquement : pas de re-render du parent à 10 Hz.
  const liveRef = useRef<ExposureUpdate | null>(null);

  const position: CameraPosition = front ? 'front' : 'back';

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
    const sub = PerseiCamera.addListener('onExposureUpdate', (u) => {
      liveRef.current = u;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = PerseiCamera.addListener('onLongExposureProgress', setPoseProgress);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // La molette EV démarre à 0, pas au minimum de la plage.
  useEffect(() => {
    setEvIdx(nearestIndex(evStops, 0));
  }, [evStops]);

  // Les plages rétrécissent en passant sur la frontale : reclamper les
  // indices, sinon isoStops[isoIdx] devient undefined et part au natif.
  useEffect(() => {
    setIsoIdx((i) => Math.min(i, isoStops.length - 1));
  }, [isoStops]);
  useEffect(() => {
    setShutterIdx((i) => Math.min(i, shutterStops.length - 1));
  }, [shutterStops]);

  // Aides de visée natives + loupe automatique pendant le réglage du focus.
  useEffect(() => {
    PerseiCamera.setAssistOptions(peaking, zebras, histogramOn).catch(() => {});
  }, [peaking, zebras, histogramOn, caps]);

  useEffect(() => {
    PerseiCamera.setLoupeEnabled(activeParam === 'focus').catch(() => {});
  }, [activeParam]);

  // Vérifie et télécharge les mises à jour OTA, puis propose de les appliquer.
  useEffect(() => {
    if (__DEV__) return;
    (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          setUpdateReady(true);
        }
      } catch {
        // Hors ligne ou serveur indisponible : on réessaiera au prochain lancement.
      }
    })();
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return;
    (async () => {
      try {
        const capabilities = await PerseiCamera.start(position);
        setCaps(capabilities);
      } catch (e) {
        setToast(`Erreur caméra : ${formatError(e)}`);
      }
    })();
  }, [permission, position]);

  // Un changement d'objectif réinitialise le matériel : on réapplique l'état.
  useEffect(() => {
    if (!caps) return;
    if (!exposureAuto) {
      PerseiCamera.setManualExposure(isoStops[isoIdx], shutterStops[shutterIdx]).catch(() => {});
    }
    if (!focusAuto) {
      PerseiCamera.setLensPosition(FOCUS_STOPS[focusIdx]).catch(() => {});
    }
    if (!wbAuto) {
      PerseiCamera.setWhiteBalance(WB_STOPS[wbIdx], TINT_STOPS[tintIdx]).catch(() => {});
    }
    if (torch > 0 && caps.hasTorch) {
      PerseiCamera.setTorchLevel(torch).catch(() => {});
    }
    PerseiCamera.setFlashMode(flash).catch(() => {});
    PerseiCamera.setQualityPrioritization(quality).catch(() => {});
    PerseiCamera.setHighResolution(highRes).catch(() => {});
    PerseiCamera.setLivePhotoEnabled(livePhoto).catch(() => {});
    PerseiCamera.setDepthEnabled(depth).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps]);

  const applyManualExposure = useCallback((iso: number, shutter: number) => {
    PerseiCamera.setManualExposure(iso, shutter).catch(() => {});
  }, []);

  const applyWb = useCallback((kelvinIdx: number, tIdx: number) => {
    PerseiCamera.setWhiteBalance(WB_STOPS[kelvinIdx], TINT_STOPS[tIdx]).catch(() => {});
  }, []);

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
      } else if (param === 'wb' || param === 'tint') {
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
          applyWb(index, tintIdx);
          break;
        case 'tint':
          setWbAuto(false);
          setTintIdx(index);
          applyWb(wbIdx, index);
          break;
      }
    },
    [
      exposureAuto,
      enterManualExposure,
      applyManualExposure,
      applyWb,
      isoStops,
      shutterStops,
      isoIdx,
      shutterIdx,
      evStops,
      wbIdx,
      tintIdx,
    ]
  );

  const openParam = useCallback(
    (param: ParamKey) => {
      setActiveParam((prev) => (prev === param ? null : param));
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
      const next = Math.min(Math.max(zoomBase.current * scale, min), Math.min(max, 50));
      PerseiCamera.setZoom(next).catch(() => {});
    },
    [caps]
  );

  /** Applique un preset scénario : exposition, focus, durée et style de pose. */
  const applyPreset = useCallback(
    (preset: ScenePreset) => {
      setCaptureMode('pose');
      setPoseDuration(preset.duration);
      setPoseStyle(preset.style);
      if (preset.iso != null) {
        const iIdx = nearestIndex(isoStops, preset.iso);
        const sIdx = nearestIndex(shutterStops, 1);
        setIsoIdx(iIdx);
        setShutterIdx(sIdx);
        setExposureAuto(false);
        PerseiCamera.setManualExposure(isoStops[iIdx], shutterStops[sIdx]).catch(() => {});
      } else {
        setExposureAuto(true);
        PerseiCamera.setAutoExposure().catch(() => {});
      }
      if (preset.focus != null) {
        const fIdx = nearestIndex(FOCUS_STOPS, preset.focus);
        setFocusAuto(false);
        setFocusIdx(fIdx);
        PerseiCamera.setLensPosition(FOCUS_STOPS[fIdx]).catch(() => {});
        // Scènes de ciel : cadrer sur le capteur principal (1×), le meilleur.
        const wide = caps?.zoomPresets.find((z) => z.factor === 1);
        if (wide) PerseiCamera.setZoom(wide.zoom).catch(() => {});
      } else {
        setFocusAuto(true);
        PerseiCamera.setAutoFocus().catch(() => {});
      }
      setShowPresets(false);
      setToast(`${preset.emoji} Preset « ${preset.label} » appliqué`);
    },
    [isoStops, shutterStops, caps]
  );

  const startPose = useCallback(async () => {
    setPosing(true);
    setPoseProgress(null);
    activateKeepAwakeAsync('pose').catch(() => {});
    try {
      const media = await MediaLibrary.requestPermissionsAsync();
      if (!media.granted) {
        setToast('Accès photothèque refusé');
        return;
      }
      // ISO de pose : la valeur manuelle si définie, sinon 1600 (ciel étoilé).
      // Manuel (nuit) : trames de 1 s à l'ISO choisi. Auto (jour) : trames
      // auto courtes empilées — le bon rendu pose longue en pleine lumière.
      const iso = exposureAuto ? 1600 : isoStops[isoIdx];
      const uris = await PerseiCamera.startLongExposure(
        poseDuration,
        iso,
        poseStyle,
        poseAlign,
        poseMeteor && poseStyle !== 'mean',
        !exposureAuto
      );
      setLastUris(uris);
      await Promise.all(uris.map((uri) => MediaLibrary.createAssetAsync(uri)));
      if (uris[0]) setThumbUri(uris[0]);
      setToast('Pose enregistrée ✓');
    } catch (e) {
      setToast(`Échec pose : ${formatError(e)}`);
    } finally {
      setPosing(false);
      setPoseProgress(null);
      deactivateKeepAwake('pose').catch(() => {});
      // Le natif repasse en exposition auto à la fin d'une pose : si
      // l'utilisateur était en manuel, on réapplique ses réglages.
      if (!exposureAuto) {
        applyManualExposure(isoStops[isoIdx], shutterStops[shutterIdx]);
      }
    }
  }, [
    exposureAuto,
    isoStops,
    isoIdx,
    shutterStops,
    shutterIdx,
    applyManualExposure,
    poseDuration,
    poseStyle,
    poseAlign,
    poseMeteor,
  ]);
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

  const shoot = useCallback(async () => {
    setCapturing(true);
    try {
      const media = await MediaLibrary.requestPermissionsAsync();
      if (!media.granted) {
        setToast('Accès photothèque refusé');
        return;
      }
      const useRaw = raw && (caps?.supportsRaw ?? false);
      const bracketStops =
        !useRaw && bracketEv > 0 ? [-bracketEv, 0, bracketEv] : undefined;
      const uris = await PerseiCamera.capturePhoto({ raw: useRaw, bracketStops });
      await Promise.all(uris.map((uri) => MediaLibrary.createAssetAsync(uri)));
      setLastUris(uris);
      const heic = uris.find((u) => u.endsWith('.heic')) ?? uris[0];
      if (heic) setThumbUri(heic);
    } catch (e) {
      setToast(`Échec capture : ${formatError(e)}`);
    } finally {
      setCapturing(false);
    }
  }, [raw, caps, bracketEv]);

  /** Mode nuit auto : pose alignée de 10 s à la place d'un cliché bruité. */
  const captureNightShot = useCallback(async () => {
    setPosing(true);
    setPoseProgress(null);
    setToast('Scène sombre : pose de 10 s alignée. Reste stable.');
    activateKeepAwakeAsync('pose').catch(() => {});
    try {
      const media = await MediaLibrary.requestPermissionsAsync();
      if (!media.granted) {
        setToast('Accès photothèque refusé');
        return;
      }
      const uris = await PerseiCamera.startLongExposure(10, 1600, 'mean', true, false, true);
      await Promise.all(uris.map((uri) => MediaLibrary.createAssetAsync(uri)));
      setLastUris(uris);
      if (uris[0]) setThumbUri(uris[0]);
      setToast('Photo de nuit enregistrée ✓');
    } catch (e) {
      setToast(`Échec pose : ${formatError(e)}`);
    } finally {
      setPosing(false);
      setPoseProgress(null);
      deactivateKeepAwake('pose').catch(() => {});
    }
  }, []);

  const capture = useCallback(() => {
    if (timerSecs === 0) {
      shoot();
      return;
    }
    let remaining = timerSecs;
    setCountdown(remaining);
    const interval = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        shoot();
      }
    }, 1000);
  }, [timerSecs, shoot]);

  const triggerShutter = useCallback(() => {
    if (capturing || countdown > 0 || !caps) return;
    if (captureMode === 'pose' && !front) {
      if (posing) {
        PerseiCamera.cancelLongExposure().catch(() => {});
      } else {
        startPose();
      }
      return;
    }
    // Mode nuit auto : scène sombre détectée sur le capteur (l'auto pousse
    // ISO et vitesse à fond) → pose alignée au lieu d'un cliché bruité.
    const live = liveRef.current;
    const darkScene = live != null && live.iso > 1500 && live.shutter > 1 / 35;
    if (autoNight && exposureAuto && !front && timerSecs === 0 && darkScene) {
      if (!posing) captureNightShot();
      return;
    }
    capture();
  }, [
    capturing,
    countdown,
    caps,
    captureMode,
    front,
    posing,
    startPose,
    capture,
    autoNight,
    exposureAuto,
    timerSecs,
    captureNightShot,
  ]);

  // Boutons volume / Camera Control = déclencheur physique.
  const shutterRef = useRef(triggerShutter);
  shutterRef.current = triggerShutter;
  useEffect(() => {
    const sub = PerseiCamera.addListener('onShutterButton', () => shutterRef.current());
    return () => sub.remove();
  }, []);

  if (permission === 'denied') {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.deniedText}>
          Persei a besoin de l'appareil photo. Autorise-le dans Réglages → Persei.
        </Text>
      </SafeAreaView>
    );
  }

  const hasFront = caps?.hasFrontCamera ?? false;

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
      case 'tint':
        return { count: TINT_STOPS.length, index: tintIdx };
    }
  };

  const paramIsAuto = (param: ParamKey): boolean => {
    if (param === 'iso' || param === 'shutter') return exposureAuto;
    if (param === 'focus') return focusAuto;
    if (param === 'wb' || param === 'tint') return wbAuto;
    return (evStops[evIdx] ?? 0) === 0;
  };

  return (
    <View style={styles.root}>
      {/* GestureDetector exige une vue native en enfant direct. */}
      <GestureDetector gesture={pinch}>
        <View style={StyleSheet.absoluteFill}>
          <PerseiCameraView style={StyleSheet.absoluteFill} />
        </View>
      </GestureDetector>

      {grid ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[styles.gridLine, { left: '33.33%', width: 1, height: '100%' }]} />
          <View style={[styles.gridLine, { left: '66.66%', width: 1, height: '100%' }]} />
          <View style={[styles.gridLine, { top: '33.33%', height: 1, width: '100%' }]} />
          <View style={[styles.gridLine, { top: '66.66%', height: 1, width: '100%' }]} />
        </View>
      ) : null}

      {levelOn ? <LevelIndicator /> : null}

      {histogramOn ? (
        <View pointerEvents="none" style={styles.histogramBox}>
          <Histogram />
        </View>
      ) : null}

      {countdown > 0 ? (
        <View pointerEvents="none" style={styles.countdownOverlay}>
          <Text style={styles.countdownText}>{countdown}</Text>
        </View>
      ) : null}

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          {!front ? (
            <ZoomPresetPills presets={caps?.zoomPresets ?? []} />
          ) : (
            <View style={styles.lensRow}>
              <Text style={[styles.lensText, styles.lensTextActive, { paddingHorizontal: 10 }]}>
                Selfie
              </Text>
            </View>
          )}
          <View style={styles.topRight}>
            <Pressable
              style={[styles.rawBadge, showPresets && styles.rawBadgeActive]}
              onPress={() => setShowPresets(!showPresets)}
            >
              <SymbolView
                name="sparkles"
                size={15}
                tintColor={showPresets ? ACCENT : '#9b9b9b'}
              />
            </Pressable>
            <Pressable
              style={[styles.rawBadge, nightVision && styles.rawBadgeActive]}
              onPress={() => setNightVision(!nightVision)}
            >
              <SymbolView
                name="moon.stars.fill"
                size={15}
                tintColor={nightVision ? ACCENT : '#9b9b9b'}
              />
            </Pressable>
            {caps?.supportsRaw && !front ? (
              <Pressable
                style={[styles.rawBadge, raw && styles.rawBadgeActive]}
                onPress={() => setRaw(!raw)}
              >
                <Text style={[styles.rawText, raw && styles.rawTextActive]}>RAW</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.rawBadge, showSettings && styles.rawBadgeActive]}
              onPress={() => setShowSettings(!showSettings)}
            >
              <SymbolView
                name="gearshape.fill"
                size={15}
                tintColor={showSettings ? ACCENT : '#9b9b9b'}
              />
            </Pressable>
          </View>
        </View>

        <View style={styles.bottomArea}>
          {toast ? (
            <View style={styles.toast}>
              <Text style={styles.toastText} numberOfLines={3}>
                {toast}
              </Text>
            </View>
          ) : null}

          {updateReady ? (
            <Pressable style={styles.updateBanner} onPress={() => Updates.reloadAsync()}>
              <Text style={styles.updateText}>Mise à jour prête. Touche pour l'appliquer.</Text>
            </Pressable>
          ) : null}

          {showPresets ? (
            <ScrollView style={styles.settingsPanel} contentContainerStyle={styles.settingsContent}>
              {SCENE_PRESETS.map((p) => (
                <Pressable key={p.id} style={styles.presetCard} onPress={() => applyPreset(p)}>
                  <Text style={styles.presetTitle}>
                    {p.emoji} {p.label}
                  </Text>
                  <Text style={styles.helpText}>{p.description}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {showSettings ? (
            <ScrollView style={styles.settingsPanel} contentContainerStyle={styles.settingsContent}>
              {caps?.hasFlash ? (
                <SettingRow label="Flash" helpKey="flash">
                  <Segmented
                    options={['off', 'auto', 'on']}
                    labels={['Off', 'Auto', 'On']}
                    value={flash}
                    onChange={(v) => {
                      setFlash(v as FlashMode);
                      PerseiCamera.setFlashMode(v as FlashMode).catch(() => {});
                    }}
                  />
                </SettingRow>
              ) : null}
              {caps?.hasTorch ? (
                <SettingRow label={`Torche ${torch > 0 ? `${Math.round(torch * 100)}%` : 'off'}`} helpKey="torch">
                  <RulerSlider
                    count={TORCH_STOPS.length}
                    index={nearestIndex(TORCH_STOPS, torch)}
                    onChange={(i) => {
                      setTorch(TORCH_STOPS[i]);
                      PerseiCamera.setTorchLevel(TORCH_STOPS[i]).catch(() => {});
                    }}
                  />
                </SettingRow>
              ) : null}
              {caps && caps.maxMegapixels > 20 ? (
                <SettingRow label="Résolution" helpKey="resolution">
                  <Segmented
                    options={['12', '48']}
                    labels={['12 MP', `${Math.round(caps.maxMegapixels)} MP`]}
                    value={highRes ? '48' : '12'}
                    onChange={(v) => {
                      const enabled = v === '48';
                      setHighRes(enabled);
                      PerseiCamera.setHighResolution(enabled).catch(() => {});
                    }}
                  />
                </SettingRow>
              ) : null}
              <SettingRow label="Qualité" helpKey="quality">
                <Segmented
                  options={['speed', 'balanced', 'quality']}
                  labels={['Vitesse', 'Équilibré', 'Max']}
                  value={quality}
                  onChange={(v) => {
                    setQuality(v as QualityPrioritization);
                    PerseiCamera.setQualityPrioritization(v as QualityPrioritization).catch(
                      () => {}
                    );
                  }}
                />
              </SettingRow>
              {caps && caps.maxBracketCount >= 3 ? (
                <SettingRow label="Bracketing" helpKey="bracket">
                  <Segmented
                    options={['0', '1', '2']}
                    labels={['Off', '±1 EV', '±2 EV']}
                    value={`${bracketEv}`}
                    onChange={(v) => setBracketEv(Number(v))}
                  />
                </SettingRow>
              ) : null}
              {caps?.supportsLivePhoto ? (
                <SettingRow label="Live Photo (vidéo séparée)" helpKey="livePhoto">
                  <Segmented
                    options={['off', 'on']}
                    labels={['Off', 'On']}
                    value={livePhoto ? 'on' : 'off'}
                    onChange={(v) => {
                      const enabled = v === 'on';
                      setLivePhoto(enabled);
                      PerseiCamera.setLivePhotoEnabled(enabled).catch(() => {});
                    }}
                  />
                </SettingRow>
              ) : null}
              {caps?.supportsDepth ? (
                <SettingRow label="Profondeur" helpKey="depth">
                  <Segmented
                    options={['off', 'on']}
                    labels={['Off', 'On']}
                    value={depth ? 'on' : 'off'}
                    onChange={(v) => {
                      const enabled = v === 'on';
                      setDepth(enabled);
                      PerseiCamera.setDepthEnabled(enabled).catch(() => {});
                    }}
                  />
                </SettingRow>
              ) : null}
              <SettingRow label="Mode nuit auto" helpKey="autoNight">
                <Segmented
                  options={['off', 'on']}
                  labels={['Off', 'On']}
                  value={autoNight ? 'on' : 'off'}
                  onChange={(v) => setAutoNight(v === 'on')}
                />
              </SettingRow>
              <SettingRow label="Retardateur" helpKey="timer">
                <Segmented
                  options={['0', '3', '10']}
                  labels={['Off', '3 s', '10 s']}
                  value={`${timerSecs}`}
                  onChange={(v) => setTimerSecs(Number(v))}
                />
              </SettingRow>
              <SettingRow label="Grille" helpKey="grid">
                <Segmented
                  options={['off', 'on']}
                  labels={['Off', 'On']}
                  value={grid ? 'on' : 'off'}
                  onChange={(v) => setGrid(v === 'on')}
                />
              </SettingRow>
              <SettingRow label="Focus peaking" helpKey="peaking">
                <Segmented
                  options={['off', 'on']}
                  labels={['Off', 'On']}
                  value={peaking ? 'on' : 'off'}
                  onChange={(v) => setPeaking(v === 'on')}
                />
              </SettingRow>
              <SettingRow label="Zebras (surexposition)" helpKey="zebras">
                <Segmented
                  options={['off', 'on']}
                  labels={['Off', 'On']}
                  value={zebras ? 'on' : 'off'}
                  onChange={(v) => setZebras(v === 'on')}
                />
              </SettingRow>
              <SettingRow label="Histogramme" helpKey="histogram">
                <Segmented
                  options={['off', 'on']}
                  labels={['Off', 'On']}
                  value={histogramOn ? 'on' : 'off'}
                  onChange={(v) => setHistogramOn(v === 'on')}
                />
              </SettingRow>
              <SettingRow label="Niveau à bulle" helpKey="level">
                <Segmented
                  options={['off', 'on']}
                  labels={['Off', 'On']}
                  value={levelOn ? 'on' : 'off'}
                  onChange={(v) => setLevelOn(v === 'on')}
                />
              </SettingRow>
            </ScrollView>
          ) : null}

          {activeParam && showHelp ? (
            <View style={styles.helpCard}>
              <Text style={styles.helpText}>{HELP_TEXTS[activeParam]}</Text>
            </View>
          ) : null}

          {activeParam ? (
            <View style={styles.rulerPanel}>
              <Pressable
                style={[styles.infoButton, showHelp && styles.infoButtonActive]}
                onPress={() => setShowHelp(!showHelp)}
              >
                <Text style={[styles.infoText, showHelp && styles.infoTextActive]}>i</Text>
              </Pressable>
              <RulerSlider
                {...rulerFor(activeParam)}
                onChange={(i) => onRulerChange(activeParam, i)}
              />
              <Pressable
                style={[styles.autoButton, paramIsAuto(activeParam) && styles.autoButtonActive]}
                onPress={() => paramToAuto(activeParam)}
              >
                <Text style={[styles.autoText, paramIsAuto(activeParam) && styles.autoTextActive]}>
                  AUTO
                </Text>
              </Pressable>
            </View>
          ) : null}

          {posing ? (
            <View style={styles.toast}>
              <Text style={styles.toastText}>
                {`Pose en cours (${poseProgress ? `${poseProgress.frame}/${poseProgress.total} s` : 'préparation'}). Ne bouge pas le téléphone.`}
                {liveRef.current
                  ? `\nCapteur : ISO ${Math.round(liveRef.current.iso)} · ${formatShutter(liveRef.current.shutter)}`
                  : ''}
              </Text>
            </View>
          ) : null}

          {!front && !posing ? (
            <Segmented
              options={['photo', 'pose']}
              labels={['PHOTO', 'POSE LONGUE']}
              value={captureMode}
              onChange={(v) => setCaptureMode(v as 'photo' | 'pose')}
            />
          ) : null}

          {captureMode === 'pose' && !front && !posing ? (
            <View style={styles.poseBar}>
              <Segmented
                options={POSE_DURATIONS.map(String)}
                labels={POSE_DURATION_LABELS}
                value={`${poseDuration}`}
                onChange={(v) => setPoseDuration(Number(v))}
              />
              <Segmented
                options={['max', 'mean', 'both']}
                labels={['Étoiles', 'Lueur', 'Les deux']}
                value={poseStyle}
                onChange={(v) => setPoseStyle(v as StackMode)}
              />
              <SettingRow label="Main levée (alignement)" helpKey="align">
                <Segmented
                  options={['off', 'on']}
                  labels={['Off', 'On']}
                  value={poseAlign ? 'on' : 'off'}
                  onChange={(v) => setPoseAlign(v === 'on')}
                />
              </SettingRow>
              {poseStyle !== 'mean' ? (
                <SettingRow label="Filtre météores" helpKey="meteorFilter">
                  <Segmented
                    options={['off', 'on']}
                    labels={['Off', 'On']}
                    value={poseMeteor ? 'on' : 'off'}
                    onChange={(v) => setPoseMeteor(v === 'on')}
                  />
                </SettingRow>
              ) : null}
            </View>
          ) : null}

          <ChipsRow
            activeParam={activeParam}
            openParam={openParam}
            exposureAuto={exposureAuto}
            focusAuto={focusAuto}
            wbAuto={wbAuto}
            isoValue={isoStops[isoIdx]}
            shutterValue={shutterStops[shutterIdx]}
            evValue={evStops[evIdx] ?? 0}
            focusValue={FOCUS_STOPS[focusIdx]}
            wbValue={WB_STOPS[wbIdx]}
            tintValue={TINT_STOPS[tintIdx]}
          />

          <View style={styles.shutterRow}>
            <Pressable
              style={styles.thumbBox}
              onPress={() => {
                if (lastUris.length) setViewerOpen(true);
              }}
            >
              {thumbUri ? (
                <Image source={{ uri: thumbUri }} style={styles.thumb} contentFit="cover" />
              ) : null}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.shutterButton, pressed && styles.shutterPressed]}
              onPress={triggerShutter}
              disabled={capturing || countdown > 0 || !caps}
            >
              {posing ? (
                <View style={styles.stopSquare} />
              ) : capturing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </Pressable>
            {hasFront ? (
              <Pressable style={styles.flipButton} onPress={() => setFront(!front)}>
                <SymbolView
                  name="arrow.triangle.2.circlepath.camera"
                  size={19}
                  tintColor="#e8e8e8"
                />
              </Pressable>
            ) : (
              <View style={styles.thumbBox} />
            )}
          </View>
        </View>
      </SafeAreaView>

      {viewerOpen ? (
        <Pressable style={styles.viewer} onPress={() => setViewerOpen(false)}>
          <ScrollView contentContainerStyle={styles.viewerContent}>
            {lastUris.map((uri) => (
              <View key={uri} style={styles.viewerItem}>
                <Text style={styles.viewerLabel}>
                  {uri.includes('-lueur')
                    ? 'Lueur (moyenne)'
                    : uri.includes('-etoiles')
                      ? 'Étoiles (fusion max)'
                      : uri.endsWith('.dng')
                        ? 'RAW'
                        : uri.endsWith('.mov')
                          ? 'Live Photo (vidéo)'
                          : 'Photo'}
                </Text>
                {!uri.endsWith('.mov') ? (
                  <Image source={{ uri }} style={styles.viewerImage} contentFit="contain" />
                ) : null}
              </View>
            ))}
            <Text style={styles.viewerHint}>
              Enregistrée dans Photos. Touche l'écran pour fermer.
            </Text>
          </ScrollView>
        </Pressable>
      ) : null}

      {nightVision ? <View pointerEvents="none" style={styles.nightOverlay} /> : null}
    </View>
  );
}

function SettingRow({
  label,
  helpKey,
  children,
}: {
  label: string;
  helpKey?: string;
  children: React.ReactNode;
}) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingHeader}>
        <Text style={styles.settingLabel}>{label}</Text>
        {helpKey ? (
          <Pressable
            style={[styles.infoButtonSmall, showHelp && styles.infoButtonActive]}
            onPress={() => setShowHelp(!showHelp)}
          >
            <Text style={[styles.infoText, showHelp && styles.infoTextActive]}>i</Text>
          </Pressable>
        ) : null}
      </View>
      {helpKey && showHelp ? <Text style={styles.helpText}>{HELP_TEXTS[helpKey]}</Text> : null}
      <View style={styles.settingControl}>{children}</View>
    </View>
  );
}

/**
 * Pastilles de zoom façon app Apple (0,5× / 1× / 2× / 5× selon le matériel).
 * Abonnées seules à la lecture capteur : la pastille active suit le zoom réel,
 * y compris pendant un pincement.
 */
function ZoomPresetPills({ presets }: { presets: ZoomPreset[] }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const sub = PerseiCamera.addListener('onExposureUpdate', (u) => setZoom(u.zoom));
    return () => sub.remove();
  }, []);
  if (!presets.length) return null;

  let activeIndex = 0;
  for (let i = 0; i < presets.length; i++) {
    if (zoom >= presets[i].zoom - 0.01) activeIndex = i;
  }
  // Zoom affiché relatif au 1× (le videoZoomFactor du device virtuel compte
  // depuis l'ultra grand-angle).
  const wideZoom = presets.find((p) => p.factor === 1)?.zoom ?? 1;
  const displayZoom = zoom / wideZoom;
  // Badge du zoom courant seulement en position intermédiaire (pincement) —
  // sinon il ressemble à une pastille en double.
  const onPreset = presets.some((p) => Math.abs(displayZoom - p.factor) < 0.06);

  return (
    <View style={styles.lensRow}>
      {presets.map((p, i) => (
        <Pressable
          key={p.factor}
          style={[styles.lensPill, i === activeIndex && styles.lensPillActive]}
          onPress={() => PerseiCamera.setZoom(p.zoom).catch(() => {})}
        >
          <Text style={[styles.lensText, i === activeIndex && styles.lensTextActive]}>
            {formatZoomFactor(p.factor)}
          </Text>
        </Pressable>
      ))}
      {!onPreset ? <Text style={styles.zoomText}>{formatZoomFactor(displayZoom)}</Text> : null}
    </View>
  );
}

/** Bandeau de valeurs : seul composant re-rendu à 10 Hz par la lecture capteur. */
function ChipsRow({
  activeParam,
  openParam,
  exposureAuto,
  focusAuto,
  wbAuto,
  isoValue,
  shutterValue,
  evValue,
  focusValue,
  wbValue,
  tintValue,
}: {
  activeParam: ParamKey | null;
  openParam(param: ParamKey): void;
  exposureAuto: boolean;
  focusAuto: boolean;
  wbAuto: boolean;
  isoValue: number;
  shutterValue: number;
  evValue: number;
  focusValue: number;
  wbValue: number;
  tintValue: number;
}) {
  const [live, setLive] = useState<ExposureUpdate | null>(null);
  useEffect(() => {
    const sub = PerseiCamera.addListener('onExposureUpdate', setLive);
    return () => sub.remove();
  }, []);

  const chips: { key: ParamKey; label: string; value: string; manual: boolean }[] = [
    {
      key: 'iso',
      label: 'ISO',
      value: exposureAuto ? `${live ? Math.round(live.iso) : '—'}` : `${isoValue}`,
      manual: !exposureAuto,
    },
    {
      key: 'shutter',
      label: 'VITESSE',
      value: exposureAuto ? formatShutter(live?.shutter ?? 0) : formatShutter(shutterValue),
      manual: !exposureAuto,
    },
    {
      key: 'ev',
      label: 'EV',
      value: `${evValue > 0 ? '+' : ''}${evValue.toFixed(1)}`,
      manual: evValue !== 0,
    },
    {
      key: 'focus',
      label: 'FOCUS',
      value: focusAuto ? formatFocus(live?.lensPosition ?? 1) : formatFocus(focusValue),
      manual: !focusAuto,
    },
    {
      key: 'wb',
      label: 'BDB',
      value: wbAuto
        ? `${live?.whiteBalanceKelvin ? Math.round(live.whiteBalanceKelvin) : '—'}K`
        : `${wbValue}K`,
      manual: !wbAuto,
    },
    {
      key: 'tint',
      label: 'TEINTE',
      value: wbAuto ? '0' : `${tintValue > 0 ? '+' : ''}${tintValue}`,
      manual: !wbAuto,
    },
  ];

  return (
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
  );
}

function Segmented({
  options,
  labels,
  value,
  onChange,
}: {
  options: string[];
  labels: string[];
  value: string;
  onChange(next: string): void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt, i) => (
        <Pressable
          key={opt}
          style={[styles.segment, value === opt && styles.segmentActive]}
          onPress={() => onChange(opt)}
        >
          <Text style={[styles.segmentText, value === opt && styles.segmentTextActive]}>
            {labels[i]}
          </Text>
        </Pressable>
      ))}
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
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  countdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    color: '#fff',
    fontSize: 96,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  topRight: {
    flexDirection: 'row',
    gap: 6,
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
    paddingHorizontal: 9,
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
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 34,
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
  updateBanner: {
    alignSelf: 'center',
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  updateText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '700',
  },
  settingsPanel: {
    maxHeight: 300,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 14,
  },
  settingsContent: {
    padding: 10,
    gap: 10,
  },
  settingRow: {
    gap: 6,
  },
  settingLabel: {
    color: '#9b9b9b',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  settingControl: {},
  segmented: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  segmentText: {
    color: '#9b9b9b',
    fontSize: 12,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: ACCENT,
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
  helpCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderLeftWidth: 2,
    borderLeftColor: ACCENT,
  },
  helpText: {
    color: '#d8d8d8',
    fontSize: 12,
    lineHeight: 17,
  },
  infoButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  infoButtonSmall: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  infoButtonActive: {
    backgroundColor: ACCENT,
  },
  infoText: {
    color: '#e8e8e8',
    fontSize: 12,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  infoTextActive: {
    color: '#000',
  },
  settingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  flipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  flipText: {
    color: '#e8e8e8',
    fontSize: 20,
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
  poseBar: {
    gap: 6,
  },
  presetCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  presetTitle: {
    color: '#e8e8e8',
    fontSize: 14,
    fontWeight: '700',
  },
  histogramBox: {
    position: 'absolute',
    top: 110,
    left: 12,
  },
  viewer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.96)',
  },
  viewerContent: {
    paddingVertical: 70,
    paddingHorizontal: 12,
    gap: 18,
  },
  viewerItem: {
    gap: 6,
  },
  viewerLabel: {
    color: '#9b9b9b',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  viewerImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    backgroundColor: '#111',
  },
  viewerHint: {
    color: '#6f6f6f',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  nightOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(170, 15, 0, 0.4)',
  },
  stopSquare: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#ff453a',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
  },
});
