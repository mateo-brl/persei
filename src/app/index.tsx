import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { SymbolView } from 'expo-symbols';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CameraCapabilities,
  CameraPosition,
  ExposureUpdate,
  FlashMode,
  PerseiCamera,
  PerseiCameraView,
  QualityPrioritization,
  RecordingProgress,
  StackMode,
  VideoCapabilities,
  VideoCodec,
  VideoRange,
  VideoSettings,
  VideoStabilization,
  ZoomPreset,
} from '../../modules/persei-camera';
import { Histogram } from '../components/histogram';
import { LevelIndicator } from '../components/level-indicator';
import { RulerSlider } from '../components/ruler-slider';
import {
  describeCapture,
  formatBytes,
  formatDuration,
  formatError,
  formatFocus,
  formatShutter,
  formatZoomFactor,
} from '../lib/format';
import { HELP_TEXTS } from '../lib/help';
import { shouldAutoNight } from '../lib/night';
import { planPreset, SCENE_PRESETS, type ScenePreset } from '../lib/presets';
import {
  evStopsFor,
  FOCUS_STOPS,
  isoStopsFor,
  nearestIndex,
  shutterStopsFor,
  TINT_STOPS,
  TORCH_STOPS,
  WB_STOPS,
} from '../lib/scales';
import {
  apertureStops,
  clampVideoSettings,
  DEFAULT_VIDEO,
  describeFallback,
  describeVideoMode,
  explainStop,
  explainVideoError,
  frameRatesFor,
  remainingSeconds,
} from '../lib/video';
import { pickThumbnail } from '../lib/capture';
import { describeCode, isOpenableUrl } from '../lib/codes';
import { modeFromUrl } from '../lib/launch';
import { activeZoomIndex, displayZoom, isOnPreset, pinchZoom } from '../lib/zoom';

const ACCENT = '#ffb800';

/** Durées de pose proposées (secondes). Pas de plafond, c'est de l'empilement. */
const POSE_DURATIONS = [10, 30, 60, 300, 900, 1800];
const POSE_DURATION_LABELS = ['10 s', '30 s', '1 min', '5 min', '15 min', '30 min'];

type ParamKey = 'iso' | 'shutter' | 'ev' | 'focus' | 'wb' | 'tint';

type CaptureMode = 'photo' | 'pose' | 'video';

export default function CameraScreen() {
  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [caps, setCaps] = useState<CameraCapabilities | null>(null);
  const [front, setFront] = useState(false);
  const [raw, setRaw] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const [videoCaps, setVideoCaps] = useState<VideoCapabilities | null>(null);
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(DEFAULT_VIDEO);
  const [recording, setRecording] = useState(false);
  const [recPaused, setRecPaused] = useState(false);
  const [poseDuration, setPoseDuration] = useState(30);
  const [poseStyle, setPoseStyle] = useState<StackMode>('both');
  const [posing, setPosing] = useState(false);
  const [poseProgress, setPoseProgress] = useState<{ frame: number; total: number } | null>(null);

  // Les réglages manuels sont gardés en valeur, jamais en index de molette.
  // Quand les plages changent (frontale, autre objectif), la valeur reste
  // juste et sa position sur la molette se recalcule ; un index conservé d'une
  // plage à l'autre pointait dans le vide et partait en NaN au capteur.
  const [exposureAuto, setExposureAuto] = useState(true);
  const [focusAuto, setFocusAuto] = useState(true);
  const [wbAuto, setWbAuto] = useState(true);
  const [isoValue, setIsoValue] = useState(100);
  const [shutterValue, setShutterValue] = useState(1 / 60);
  const [evValue, setEvValue] = useState(0);
  const [focusValue, setFocusValue] = useState(1);
  const [wbKelvin, setWbKelvin] = useState(5500);
  const [tintValue, setTintValue] = useState(0);

  // Réglages secondaires (tiroir).
  const [showSettings, setShowSettings] = useState(false);
  const [flash, setFlash] = useState<FlashMode>('off');
  const [torch, setTorch] = useState(0);
  const [livePhoto, setLivePhoto] = useState(false);
  const [depth, setDepth] = useState(false);
  // Définition photo en mégapixels ; 0 = la plus grande que le format offre.
  const [photoMp, setPhotoMp] = useState(0);
  const [quality, setQuality] = useState<QualityPrioritization>('quality');
  const [bracketEv, setBracketEv] = useState(0);
  const [timerSecs, setTimerSecs] = useState(0);
  const [grid, setGrid] = useState(false);
  const [autoNight, setAutoNight] = useState(true);
  const [codeScan, setCodeScan] = useState(true);

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
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Fichiers temporaires de la dernière prise, encore lus par la visionneuse. */
  const tempFilesRef = useRef<string[]>([]);

  /**
   * Rend l'espace des prises précédentes, en gardant celle qui est encore
   * affichée dans la visionneuse. Sans ce ménage, une séance de cent photos
   * laissait cent fichiers dans le dossier temporaire, en plus de la
   * photothèque — et le garde-fou d'espace libre les ignorait tous.
   */
  const purgerTemporaires = useCallback((garder: string[]) => {
    const aRendre = tempFilesRef.current.filter((uri) => !garder.includes(uri));
    tempFilesRef.current = garder;
    aRendre.forEach((uri) => PerseiCamera.discardTempFile(uri).catch(() => {}));
  }, []);
  const [toast, setToast] = useState<string | null>(null);
  const [thumbUri, setThumbUri] = useState<string | null>(null);
  const [lastUris, setLastUris] = useState<string[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [code, setCode] = useState<{ value: string; type: string } | null>(null);
  const [crashReport, setCrashReport] = useState<string | null>(null);

  // Lecture capteur en ref uniquement : pas de re-render du parent à 10 Hz.
  const liveRef = useRef<ExposureUpdate | null>(null);

  const position: CameraPosition = front ? 'front' : 'back';

  const isoStops = useMemo(() => isoStopsFor(caps), [caps]);
  const shutterStops = useMemo(() => shutterStopsFor(caps), [caps]);
  const evStops = useMemo(() => evStopsFor(caps), [caps]);

  // Position des molettes, déduite des valeurs courantes.
  const isoIdx = nearestIndex(isoStops, isoValue);
  const shutterIdx = nearestIndex(shutterStops, shutterValue);
  const evIdx = nearestIndex(evStops, evValue);
  const focusIdx = nearestIndex(FOCUS_STOPS, focusValue);
  const wbIdx = nearestIndex(WB_STOPS, wbKelvin);
  const tintIdx = nearestIndex(TINT_STOPS, tintValue);

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

  // Trace du plantage précédent, s'il y en a eu un : une exception native tue
  // l'app sans rien afficher, c'est le seul moyen de savoir ce qui a cassé.
  useEffect(() => {
    PerseiCamera.consumeLastCrash().then(setCrashReport).catch(() => {});
  }, []);

  // Codes QR et codes-barres lus dans la préview, comme l'app Camera.
  useEffect(() => {
    const sub = PerseiCamera.addListener('onCodeDetected', setCode);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!code) return;
    const t = setTimeout(() => setCode(null), 6000);
    return () => clearTimeout(t);
  }, [code]);

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

  /**
   * Le moteur renvoie ses capacités chaque fois qu'il change d'objectif —
   * ce qui arrive tout seul dès qu'un réglage manuel est posé, puisque le
   * device virtuel ne sait pas les appliquer. Sans cette écoute, les molettes
   * gardaient les bornes d'un capteur qui n'est plus dans la session, et
   * proposaient des valeurs qu'il refuse.
   */
  useEffect(() => {
    const sub = PerseiCamera.addListener('onCapabilities', setCaps);
    return () => sub.remove();
  }, []);

  // Un changement d'objectif réinitialise le matériel : on réapplique l'état.
  useEffect(() => {
    if (!caps) return;
    if (!exposureAuto) {
      PerseiCamera.setManualExposure(isoValue, shutterValue).catch(() => {});
    }
    if (!focusAuto) {
      PerseiCamera.setLensPosition(focusValue).catch(() => {});
    }
    if (!wbAuto) {
      PerseiCamera.setWhiteBalance(wbKelvin, tintValue).catch(() => {});
    }
    if (torch > 0 && caps.hasTorch) {
      PerseiCamera.setTorchLevel(torch).catch(() => {});
    }
    PerseiCamera.setFlashMode(flash).catch(() => {});
    PerseiCamera.setQualityPrioritization(quality).catch(() => {});
    PerseiCamera.setPhotoResolution(photoMp).catch(() => {});
    PerseiCamera.setLivePhotoEnabled(livePhoto).catch(() => {});
    PerseiCamera.setDepthEnabled(depth).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps]);

  const applyManualExposure = useCallback((iso: number, shutter: number) => {
    PerseiCamera.setManualExposure(iso, shutter).catch(() => {});
  }, []);

  const applyWb = useCallback((kelvin: number, tint: number) => {
    PerseiCamera.setWhiteBalance(kelvin, tint).catch(() => {});
  }, []);

  /** Passage en manuel : on part des valeurs que le capteur affiche déjà. */
  const enterManualExposure = useCallback(() => {
    const current = liveRef.current;
    const iso = isoStops[nearestIndex(isoStops, current?.iso ?? 100)];
    const shutter = shutterStops[nearestIndex(shutterStops, current?.shutter ?? 1 / 60)];
    setIsoValue(iso);
    setShutterValue(shutter);
    setExposureAuto(false);
    applyManualExposure(iso, shutter);
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
        setEvValue(0);
        PerseiCamera.setExposureBias(0).catch(() => {});
      }
    },
    []
  );

  const onRulerChange = useCallback(
    (param: ParamKey, index: number) => {
      switch (param) {
        case 'iso': {
          if (exposureAuto) enterManualExposure();
          const iso = isoStops[index];
          setIsoValue(iso);
          applyManualExposure(iso, shutterValue);
          break;
        }
        case 'shutter': {
          if (exposureAuto) enterManualExposure();
          const shutter = shutterStops[index];
          setShutterValue(shutter);
          applyManualExposure(isoValue, shutter);
          break;
        }
        case 'ev': {
          const ev = evStops[index];
          setEvValue(ev);
          PerseiCamera.setExposureBias(ev).catch(() => {});
          break;
        }
        case 'focus': {
          const focus = FOCUS_STOPS[index];
          setFocusAuto(false);
          setFocusValue(focus);
          PerseiCamera.setLensPosition(focus).catch(() => {});
          break;
        }
        case 'wb': {
          const kelvin = WB_STOPS[index];
          setWbAuto(false);
          setWbKelvin(kelvin);
          applyWb(kelvin, tintValue);
          break;
        }
        case 'tint': {
          const tint = TINT_STOPS[index];
          setWbAuto(false);
          setTintValue(tint);
          applyWb(wbKelvin, tint);
          break;
        }
      }
    },
    [
      exposureAuto,
      enterManualExposure,
      applyManualExposure,
      applyWb,
      isoStops,
      shutterStops,
      isoValue,
      shutterValue,
      evStops,
      wbKelvin,
      tintValue,
    ]
  );

  const openParam = useCallback(
    (param: ParamKey) => {
      setActiveParam((prev) => (prev === param ? null : param));
      // La molette s'ouvre là où le capteur est, pas au début de l'échelle.
      const current = liveRef.current;
      if (param === 'iso' && exposureAuto) setIsoValue(current?.iso ?? 100);
      if (param === 'shutter' && exposureAuto) setShutterValue(current?.shutter ?? 1 / 60);
      if (param === 'focus' && focusAuto) setFocusValue(current?.lensPosition ?? 1);
      if (param === 'wb' && wbAuto) setWbKelvin(current?.whiteBalanceKelvin || 5500);
    },
    [exposureAuto, focusAuto, wbAuto]
  );

  const zoomBase = useRef(1);
  const rememberZoom = useCallback(() => {
    zoomBase.current = liveRef.current?.zoom ?? 1;
  }, []);
  const applyZoom = useCallback(
    (scale: number) => {
      const next = pinchZoom(zoomBase.current, scale, caps?.minZoom ?? 1, caps?.maxZoom ?? 6);
      PerseiCamera.setZoom(next).catch(() => {});
    },
    [caps]
  );

  /** Applique un preset scénario : exposition, focus, durée et style de pose. */
  const applyPreset = useCallback(
    (preset: ScenePreset) => {
      const plan = planPreset(preset, {
        isoStops,
        shutterStops,
        zoomPresets: caps?.zoomPresets ?? [],
      });
      setCaptureMode('pose');
      setPoseDuration(plan.duration);
      setPoseStyle(plan.style);

      // Le zoom d'abord, et c'est un ordre qui compte. Régler l'exposition
      // manuelle bascule la session sur la caméra physique, où l'échelle du
      // zoom n'est plus la même : le 1× du device virtuel y devient un
      // recadrage 2×, qui interdit au passage le RAW Bayer. Posé avant, il
      // est traduit correctement au moment de la bascule.
      if (plan.zoom != null) PerseiCamera.setZoom(plan.zoom).catch(() => {});

      if (plan.exposure.mode === 'manual') {
        const iso = isoStops[plan.exposure.isoIndex];
        const shutter = shutterStops[plan.exposure.shutterIndex];
        setIsoValue(iso);
        setShutterValue(shutter);
        setExposureAuto(false);
        PerseiCamera.setManualExposure(iso, shutter).catch(() => {});
      } else {
        setExposureAuto(true);
        PerseiCamera.setAutoExposure().catch(() => {});
      }

      if (plan.focus.mode === 'locked') {
        const focus = FOCUS_STOPS[plan.focus.focusIndex];
        setFocusAuto(false);
        setFocusValue(focus);
        PerseiCamera.setLensPosition(focus).catch(() => {});
      } else {
        setFocusAuto(true);
        PerseiCamera.setAutoFocus().catch(() => {});
      }

      setShowPresets(false);
      setToast(`${preset.emoji} Preset « ${preset.label} » appliqué`);
    },
    [isoStops, shutterStops, caps]
  );

  /**
   * Mode réclamé par un raccourci Siri ou le bouton Action. Le natif l'écrit
   * avant que l'app s'ouvre, on le consomme une fois arrivé.
   */
  const applyLaunchMode = useCallback(
    (mode: string | null) => {
      if (!mode || mode === 'photo') return;
      if (mode === 'video') {
        setCaptureMode('video');
        return;
      }
      const preset = SCENE_PRESETS.find((p) => p.id === mode);
      if (preset) applyPreset(preset);
    },
    [applyPreset]
  );

  useEffect(() => {
    if (!caps) return;
    PerseiCamera.consumeLaunchMode().then(applyLaunchMode).catch(() => {});
  }, [caps, applyLaunchMode]);

  // Bouton du Centre de contrôle ou de l'écran verrouillé : il ouvre l'app par
  // une URL, la seule chose qu'une extension puisse nous transmettre sans
  // groupe d'app partagé.
  useEffect(() => {
    const traiter = (url: string | null | undefined) => {
      const mode = modeFromUrl(url);
      if (mode) applyLaunchMode(mode);
    };
    Linking.getInitialURL().then(traiter).catch(() => {});
    const sub = Linking.addEventListener('url', (event) => traiter(event.url));
    return () => sub.remove();
  }, [applyLaunchMode]);

  // App déjà lancée : le raccourci écrit le mode puis nous ramène au premier plan.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      PerseiCamera.consumeLaunchMode().then(applyLaunchMode).catch(() => {});
    });
    return () => sub.remove();
  }, [applyLaunchMode]);

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
      // auto courtes empilées, le bon rendu pose longue en pleine lumière.
      const iso = exposureAuto ? 1600 : isoValue;
      const uris = await PerseiCamera.startLongExposure(
        poseDuration,
        iso,
        poseStyle,
        poseAlign,
        poseMeteor && poseStyle !== 'mean',
        !exposureAuto
      );
      await Promise.all(uris.map((uri) => MediaLibrary.createAssetAsync(uri)));
      purgerTemporaires(uris);
      setLastUris(uris);
      const vignette = pickThumbnail(uris);
      if (vignette) setThumbUri(vignette);
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
        applyManualExposure(isoValue, shutterValue);
      }
    }
  }, [
    exposureAuto,
    isoValue,
    shutterValue,
    applyManualExposure,
    poseDuration,
    poseStyle,
    poseAlign,
    poseMeteor,
    purgerTemporaires,
  ]);

  // Le pincement pilote un réglage matériel asynchrone : inutile de le tenir
  // sur le thread UI, tout repasse côté JS de toute façon.
  /* eslint-disable react-hooks/refs -- le zoom de départ est lu quand le doigt
     se pose, pas au rendu : la lecture vit dans le callback du geste. */
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        // Zoomer pendant une pose change le cadrage entre deux trames — et
        // peut même faire changer d'objectif au milieu de l'empilement, ce qui
        // rend l'alignement impossible et perd le RAW en route.
        .enabled(!posing)
        .onStart(rememberZoom)
        .onUpdate((e) => applyZoom(e.scale)),
    [rememberZoom, applyZoom, posing]
  );
  /* eslint-enable react-hooks/refs */

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
      // La visionneuse lit les fichiers de la dernière prise : on ne peut pas
      // les effacer tout de suite. On rend en revanche ceux d'avant, sinon
      // chaque déclenchement laissait sa copie sur le disque pour la séance.
      purgerTemporaires(uris);
      setLastUris(uris);
      const vignette = pickThumbnail(uris, bracketStops);
      if (vignette) setThumbUri(vignette);
    } catch (e) {
      setToast(`Échec capture : ${formatError(e)}`);
    } finally {
      setCapturing(false);
    }
  }, [raw, caps, bracketEv, purgerTemporaires]);

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
      // Dernier argument à false : c'est le moteur qui mesure la scène et en
      // déduit durée et ISO. Un ISO imposé ici surexposait de plusieurs
      // diaphragmes dès que la scène n'était pas complètement noire — au
      // seuil de déclenchement, justement, où le mode se déclenche le plus.
      // L'ISO passé n'est plus lu, il ne reste que pour la forme du contrat.
      const uris = await PerseiCamera.startLongExposure(10, 1600, 'mean', true, false, false);
      await Promise.all(uris.map((uri) => MediaLibrary.createAssetAsync(uri)));
      purgerTemporaires(uris);
      setLastUris(uris);
      const vignette = pickThumbnail(uris);
      if (vignette) setThumbUri(vignette);
      setToast('Photo de nuit enregistrée ✓');
    } catch (e) {
      setToast(`Échec pose : ${formatError(e)}`);
    } finally {
      setPosing(false);
      setPoseProgress(null);
      deactivateKeepAwake('pose').catch(() => {});
    }
  }, [purgerTemporaires]);

  // MARK: vidéo

  const videoSettingsRef = useRef(videoSettings);
  useEffect(() => {
    videoSettingsRef.current = videoSettings;
  }, [videoSettings]);

  /** La caméra a répondu au moins une fois : booléen stable, contrairement aux
   *  capacités, réémises à chaque changement d'objectif. */
  const cameraPrete = caps != null;

  // Entrer en vidéo reconfigure la session (format explicite, micro, sortie
  // fichier). On n'y touche que sur demande, et on en ressort en quittant.
  useEffect(() => {
    if (!cameraPrete) return;
    let cancelled = false;
    (async () => {
      try {
        if (captureMode === 'video') {
          await PerseiCamera.requestMicrophonePermission();
          const capabilities = await PerseiCamera.setVideoMode(true);
          if (cancelled) return;
          setVideoCaps(capabilities);
          const settings = clampVideoSettings(videoSettingsRef.current, capabilities);
          setVideoSettings(settings);
          await PerseiCamera.configureVideo(settings);
        } else {
          await PerseiCamera.setVideoMode(false);
          if (!cancelled) setVideoCaps(null);
        }
      } catch (e) {
        if (!cancelled) setToast(explainVideoError(formatError(e)));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Volontairement `cameraPrete` et non `caps` : les capacités sont
    // réémises à chaque bascule d'objectif, et rejouer cette séquence-là
    // reclampait les réglages vidéo en silence à chaque réglage manuel. Le
    // format vidéo, lui, est réappliqué côté natif après la bascule.
  }, [captureMode, cameraPrete]);

  const updateVideoSettings = useCallback(
    (patch: Partial<VideoSettings>) => {
      // Retenu avant l'appel : la ref suit l'état, elle vaudrait déjà `next`
      // au moment où un refus arrive, et le retour en arrière serait sans effet.
      const precedent = videoSettingsRef.current;
      const next = clampVideoSettings({ ...precedent, ...patch }, videoCaps);
      setVideoSettings(next);
      // Le flou cinématique interdit tout réglage manuel côté matériel : on
      // remet l'écran en accord avec ce que la caméra va faire.
      if (next.cinematic) {
        setExposureAuto(true);
        setFocusAuto(true);
        setWbAuto(true);
        setActiveParam(null);
      }
      PerseiCamera.configureVideo(next)
        .then((servi) => {
          setVideoCaps(servi);
          // Le matériel a le dernier mot : s'il a changé quelque chose, ça se
          // dit. Le silence sur ces replis était le pire mensonge d'état de
          // toute la vidéo.
          const ecart = describeFallback(next, servi.applied);
          if (ecart) setToast(ecart);
        })
        .catch((e) => {
          // Réglage refusé : l'écran revient à ce que la caméra fait vraiment,
          // au lieu de garder la valeur demandée.
          setVideoSettings(precedent);
          setToast(explainVideoError(formatError(e)));
        });
    },
    [videoCaps]
  );

  const saveRecording = useCallback(async (uri: string) => {
    try {
      const media = await MediaLibrary.requestPermissionsAsync();
      if (!media.granted) {
        setToast('Accès photothèque refusé, la vidéo reste dans l’app');
        return;
      }
      await MediaLibrary.createAssetAsync(uri);
      setLastUris([uri]);
      // La copie est faite : le fichier temporaire doit partir tout de suite.
      // Une vidéo 4K pèse plusieurs gigaoctets, et tant qu'elle restait en
      // double le garde-fou d'espace libre comptait une place déjà prise.
      // La visionneuse renvoie vers Photos pour les vidéos, elle n'a pas
      // besoin du fichier.
      PerseiCamera.discardTempFile(uri).catch(() => {});
    } catch (e) {
      setToast(`Sauvegarde vidéo : ${formatError(e)}`);
    }
  }, []);

  const beginRecording = useCallback(async () => {
    activateKeepAwakeAsync('video').catch(() => {});
    try {
      await PerseiCamera.startRecording();
      setRecording(true);
      setRecPaused(false);
    } catch (e) {
      deactivateKeepAwake('video').catch(() => {});
      setToast(explainVideoError(formatError(e)));
    }
  }, []);

  const endRecording = useCallback(async () => {
    try {
      const uri = await PerseiCamera.stopRecording();
      setRecording(false);
      setRecPaused(false);
      await saveRecording(uri);
      setToast('Vidéo enregistrée ✓');
    } catch (e) {
      setRecording(false);
      setRecPaused(false);
      setToast(explainVideoError(formatError(e)));
    } finally {
      deactivateKeepAwake('video').catch(() => {});
    }
  }, [saveRecording]);

  // Arrêt subi (surchauffe, appel entrant, disque plein) : le natif ferme le
  // fichier proprement, il reste à le sauver et à le dire.
  useEffect(() => {
    const sub = PerseiCamera.addListener('onRecordingStopped', (payload) => {
      setRecording(false);
      setRecPaused(false);
      deactivateKeepAwake('video').catch(() => {});
      setToast(explainStop(payload.reason));
      if (payload.uri) saveRecording(payload.uri);
    });
    return () => sub.remove();
  }, [saveRecording]);

  useEffect(() => {
    const sub = PerseiCamera.addListener('onSystemPressure', (payload) => {
      if (payload.level === 'serious') {
        setToast('Le téléphone chauffe. Baisse la résolution ou la cadence si ça continue.');
      } else if (payload.level === 'critical' || payload.level === 'shutdown') {
        setRecording(false);
        setToast(
          'Trop chaud : la caméra a été allégée et l’enregistrement arrêté. Laisse refroidir une minute.'
        );
      } else if (payload.level === 'nominal') {
        // Le moteur a rallumé ce qu'il avait coupé : sans ce message, l'écran
        // gardait l'avertissement de chaleur jusqu'au redémarrage de l'app.
        setToast('Température revenue à la normale. Les aides sont réactivées.');
      } else if (payload.level === 'sessionError') {
        setToast(payload.message ?? 'Erreur de session caméra (P12). La caméra a redémarré.');
      }
    });
    return () => sub.remove();
  }, []);

  const toggleRecordingPause = useCallback(() => {
    if (recPaused) {
      PerseiCamera.resumeRecording().catch(() => {});
      setRecPaused(false);
    } else {
      PerseiCamera.pauseRecording().catch(() => {});
      setRecPaused(true);
    }
  }, [recPaused]);

  /** Arrête un décompte en cours. Sans effet s'il n'y en a pas. */
  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(0);
  }, []);

  /**
   * Exécute une action après le retardateur.
   *
   * L'intervalle est retenu dans une ref parce qu'il ne l'était pas : changer
   * de mode pendant le décompte laissait le minuteur courir, puis déclencher
   * tout seul dans un mode qui n'était plus celui affiché. Il était aussi
   * impossible à annuler, le déclencheur étant désactivé pendant le décompte.
   */
  const afterTimer = useCallback(
    (action: () => void) => {
      if (timerSecs === 0) {
        action();
        return;
      }
      cancelCountdown();
      let remaining = timerSecs;
      setCountdown(remaining);
      countdownRef.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          cancelCountdown();
          action();
        }
      }, 1000);
    },
    [timerSecs, cancelCountdown]
  );

  const capture = useCallback(() => afterTimer(shoot), [afterTimer, shoot]);

  // Changer de mode, ou quitter l'écran, arrête le décompte.
  useEffect(() => cancelCountdown, [captureMode, cancelCountdown]);

  const triggerShutter = useCallback(() => {
    // Un décompte en cours se coupe au déclencheur : c'est le geste attendu, et
    // il n'existait pas — le bouton était simplement inerte jusqu'au bout.
    if (countdown > 0) {
      cancelCountdown();
      setToast('Retardateur annulé');
      return;
    }
    if (capturing || !caps) return;
    if (captureMode === 'video') {
      if (recording) {
        endRecording();
      } else {
        beginRecording();
      }
      return;
    }
    if (captureMode === 'pose' && !front) {
      if (posing) {
        PerseiCamera.cancelLongExposure().catch(() => {});
      } else {
        // Le retardateur vaut aussi pour la pose : c'est même là qu'il sert le
        // plus, puisqu'il évite de bouger l'appareil au moment du départ.
        afterTimer(startPose);
      }
      return;
    }
    // Mode nuit auto : scène sombre lue au capteur (l'auto pousse ISO et
    // vitesse à fond), donc pose alignée au lieu d'un cliché bruité.
    if (
      shouldAutoNight({ autoNight, exposureAuto, front, timerSecs, posing, live: liveRef.current })
    ) {
      captureNightShot();
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
    afterTimer,
    cancelCountdown,
    autoNight,
    exposureAuto,
    timerSecs,
    captureNightShot,
    recording,
    beginRecording,
    endRecording,
  ]);

  // Boutons volume / Camera Control = déclencheur physique. L'abonnement natif
  // ne se refait pas à chaque rendu, il appelle toujours la dernière version.
  const shutterRef = useRef(triggerShutter);
  useEffect(() => {
    shutterRef.current = triggerShutter;
  }, [triggerShutter]);
  useEffect(() => {
    const sub = PerseiCamera.addListener('onShutterButton', () => shutterRef.current());
    return () => sub.remove();
  }, []);

  if (permission === 'denied') {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.deniedText}>
          Persei a besoin de l’appareil photo. Autorise-le dans Réglages → Persei.
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
          {crashReport ? (
            <Pressable style={styles.crashCard} onPress={() => setCrashReport(null)}>
              <Text style={styles.crashTitle}>Dernier plantage</Text>
              <ScrollView style={styles.crashScroll}>
                <Text style={styles.crashText}>{crashReport}</Text>
              </ScrollView>
              <Text style={styles.viewerHint}>Touche pour fermer</Text>
            </Pressable>
          ) : null}

          {code && codeScan && !posing && !recording ? (
            <Pressable
              style={styles.codeBanner}
              onPress={() => {
                if (isOpenableUrl(code.value)) {
                  Linking.openURL(code.value).catch(() => setToast('Impossible d’ouvrir ce lien'));
                }
                setCode(null);
              }}
            >
              <SymbolView name="qrcode.viewfinder" size={15} tintColor="#000" />
              <Text style={styles.codeText} numberOfLines={1}>
                {describeCode(code.value, code.type)}
              </Text>
            </Pressable>
          ) : null}

          {toast ? (
            <View style={styles.toast}>
              <Text style={styles.toastText} numberOfLines={3}>
                {toast}
              </Text>
            </View>
          ) : null}

          {updateReady ? (
            <Pressable style={styles.updateBanner} onPress={() => Updates.reloadAsync()}>
              <Text style={styles.updateText}>Mise à jour prête. Touche pour l’appliquer.</Text>
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
              {caps && caps.photoResolutions.length > 1 ? (
                <SettingRow label="Définition" helpKey="resolution">
                  <Segmented
                    options={caps.photoResolutions.map(String)}
                    labels={caps.photoResolutions.map((mp) => `${Math.round(mp)} MP`)}
                    value={String(
                      photoMp > 0
                        ? photoMp
                        : caps.photoResolutions[caps.photoResolutions.length - 1]
                    )}
                    onChange={(v) => {
                      setPhotoMp(Number(v));
                      PerseiCamera.setPhotoResolution(Number(v)).catch(() => {});
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
              <SettingRow label="Codes QR" helpKey="codes">
                <Segmented
                  options={['off', 'on']}
                  labels={['Off', 'On']}
                  value={codeScan ? 'on' : 'off'}
                  onChange={(v) => setCodeScan(v === 'on')}
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

          {posing ? <PoseBanner progress={poseProgress} /> : null}

          {recording ? <RecordingBanner paused={recPaused} /> : null}

          {captureMode === 'video' && !recording ? (
            <VideoBar
              settings={videoSettings}
              caps={videoCaps}
              onChange={updateVideoSettings}
            />
          ) : null}

          {!posing && !recording ? (
            <Segmented
              options={front ? ['photo', 'video'] : ['photo', 'pose', 'video']}
              labels={front ? ['PHOTO', 'VIDÉO'] : ['PHOTO', 'POSE', 'VIDÉO']}
              value={captureMode}
              onChange={(v) => setCaptureMode(v as CaptureMode)}
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

          {captureMode === 'video' && videoSettings.cinematic ? (
            <View style={styles.toast}>
              <Text style={styles.toastText}>
                Cinéma : la mise au point et l’exposition sont pilotées par l’iPhone.
              </Text>
            </View>
          ) : (
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
          )}

          <View style={styles.shutterRow}>
            {recording && videoSettings.range !== 'log' ? (
              // Photo pendant l'enregistrement, comme l'app Camera. Impossible
              // en Log : AVFoundation désactive la sortie photo dans ce mode.
              <Pressable style={styles.flipButton} onPress={shoot} disabled={capturing}>
                <SymbolView name="camera.fill" size={19} tintColor="#e8e8e8" />
              </Pressable>
            ) : (
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
            )}
            <Pressable
              style={({ pressed }) => [styles.shutterButton, pressed && styles.shutterPressed]}
              onPress={triggerShutter}
              // Le décompte ne désactive plus le bouton : c'est lui qui
              // l'annule.
              disabled={capturing || !caps}
            >
              {posing || recording ? (
                <View style={styles.stopSquare} />
              ) : capturing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={[styles.shutterInner, captureMode === 'video' && styles.shutterVideo]} />
              )}
            </Pressable>
            {recording && videoCaps?.supportsPause ? (
              <Pressable style={styles.flipButton} onPress={toggleRecordingPause}>
                <SymbolView
                  name={recPaused ? 'play.fill' : 'pause.fill'}
                  size={19}
                  tintColor="#e8e8e8"
                />
              </Pressable>
            ) : hasFront && !recording ? (
              <Pressable
                style={styles.flipButton}
                onPress={() => {
                  // La pose longue n'existe pas sur la frontale : on ne laisse
                  // pas un mode actif qui n'a plus d'interface.
                  if (!front && captureMode === 'pose') setCaptureMode('photo');
                  setFront(!front);
                }}
              >
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
                <Text style={styles.viewerLabel}>{describeCapture(uri)}</Text>
                {uri.endsWith('.mov') ? (
                  // Une vidéo ne s'affiche pas ici : plutôt qu'un rectangle
                  // noir, on dit où elle est partie.
                  <View style={[styles.viewerImage, styles.viewerVideo]}>
                    <SymbolView name="play.rectangle.fill" size={44} tintColor="#6f6f6f" />
                    <Text style={styles.viewerHint}>Ouvre-la dans Photos pour la regarder.</Text>
                  </View>
                ) : (
                  <Image source={{ uri }} style={styles.viewerImage} contentFit="contain" />
                )}
              </View>
            ))}
            <Text style={styles.viewerHint}>
              Enregistrée dans Photos. Touche l’écran pour fermer.
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

  const activeIndex = activeZoomIndex(presets, zoom);
  // Badge du zoom courant seulement en position intermédiaire (pincement),
  // sinon il ressemble à une pastille en double.
  const onPreset = isOnPreset(presets, zoom);

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
      {!onPreset ? (
        <Text style={styles.zoomText}>{formatZoomFactor(displayZoom(presets, zoom))}</Text>
      ) : null}
    </View>
  );
}

/** Réglages vidéo. Rien n'est proposé que le matériel ne sache faire. */
function VideoBar({
  settings,
  caps,
  onChange,
}: {
  settings: VideoSettings;
  caps: VideoCapabilities | null;
  onChange(patch: Partial<VideoSettings>): void;
}) {
  const heights = caps?.heights ?? [settings.height];
  const rates = frameRatesFor(caps, settings.height, settings.cinematic);

  const ranges: VideoRange[] = ['sdr'];
  if (caps?.supportsHdr) ranges.push('hdr');
  if (caps?.supportsLog) ranges.push('log');
  const rangeLabels: Record<VideoRange, string> = { sdr: 'Standard', hdr: 'HDR', log: 'Log' };

  const stabilizations = (caps?.stabilizations ?? ['auto', 'off']).filter((s) =>
    ['auto', 'off', 'standard', 'cinematicExtended', 'lowLatency'].includes(s)
  );
  const stabilizationLabels: Record<string, string> = {
    auto: 'Auto',
    off: 'Off',
    standard: 'Standard',
    cinematicExtended: 'Max',
    lowLatency: 'Réactive',
  };
  const ouvertures = apertureStops(caps);

  return (
    <View style={styles.poseBar}>
      <Text style={styles.videoSummary}>
        {describeVideoMode(settings)}
        {caps && caps.freeBytes > 0
          ? `  ·  ${formatDuration(remainingSeconds(settings, caps.freeBytes))} d’enregistrement possible`
          : ''}
      </Text>

      <Segmented
        options={heights.map(String)}
        labels={heights.map((h) => (h >= 2160 ? '4K' : `${h}p`))}
        value={String(settings.height)}
        onChange={(v) => onChange({ height: Number(v) })}
      />

      {rates.length > 1 ? (
        <Segmented
          options={rates.map(String)}
          labels={rates.map((r) => `${r} i/s`)}
          value={String(settings.frameRate)}
          onChange={(v) => onChange({ frameRate: Number(v) })}
        />
      ) : null}

      {ranges.length > 1 ? (
        <SettingRow label="Rendu" helpKey="videoRange">
          <Segmented
            options={ranges}
            labels={ranges.map((r) => rangeLabels[r])}
            value={settings.range}
            onChange={(v) => onChange({ range: v as VideoRange })}
          />
        </SettingRow>
      ) : null}

      {caps?.supportsProRes ? (
        <SettingRow label="Codec" helpKey="videoCodec">
          <Segmented
            options={['hevc', 'prores']}
            labels={['HEVC', 'ProRes']}
            value={settings.codec === 'prores' ? 'prores' : 'hevc'}
            onChange={(v) => onChange({ codec: v as VideoCodec })}
          />
        </SettingRow>
      ) : null}

      <SettingRow label="Stabilisation" helpKey="stabilization">
        <Segmented
          options={stabilizations}
          labels={stabilizations.map((s) => stabilizationLabels[s] ?? s)}
          value={settings.stabilization}
          onChange={(v) => onChange({ stabilization: v as VideoStabilization })}
        />
      </SettingRow>

      {caps?.supportsCinematic ? (
        <SettingRow label="Cinéma (flou d’arrière-plan)" helpKey="cinematic">
          <Segmented
            options={['off', 'on']}
            labels={['Off', 'On']}
            value={settings.cinematic ? 'on' : 'off'}
            onChange={(v) => onChange({ cinematic: v === 'on' })}
          />
        </SettingRow>
      ) : null}

      {settings.cinematic && ouvertures.length > 1 ? (
        <SettingRow label={`Ouverture f/${settings.simulatedAperture}`} helpKey="aperture">
          <RulerSlider
            count={ouvertures.length}
            index={Math.max(0, ouvertures.indexOf(settings.simulatedAperture))}
            onChange={(i) => onChange({ simulatedAperture: ouvertures[i] })}
          />
        </SettingRow>
      ) : null}

      <SettingRow label="Son" helpKey="videoAudio">
        <Segmented
          options={['on', 'off']}
          labels={['Avec le son', 'Muet']}
          value={settings.audioEnabled ? 'on' : 'off'}
          onChange={(v) => onChange({ audioEnabled: v === 'on' })}
        />
      </SettingRow>

      {settings.audioEnabled ? (
        <SettingRow label="Filtre anti-vent" helpKey="windNoise">
          <Segmented
            options={['on', 'off']}
            labels={['On', 'Off']}
            value={settings.windNoiseRemoval ? 'on' : 'off'}
            onChange={(v) => onChange({ windNoiseRemoval: v === 'on' })}
          />
        </SettingRow>
      ) : null}
    </View>
  );
}

/** Compteur d'enregistrement, abonné seul à la progression (2 Hz). */
function RecordingBanner({ paused }: { paused: boolean }) {
  const [progress, setProgress] = useState<RecordingProgress | null>(null);
  useEffect(() => {
    const sub = PerseiCamera.addListener('onRecordingProgress', setProgress);
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.recBanner}>
      <View style={[styles.recDot, paused && styles.recDotPaused]} />
      <Text style={styles.recText}>
        {paused ? 'PAUSE' : 'REC'} {formatDuration(progress?.seconds ?? 0)}
      </Text>
      <Text style={styles.recSize}>{formatBytes(progress?.bytes ?? 0)}</Text>
    </View>
  );
}

/**
 * Bandeau de pose : progression et lecture capteur en direct. Abonné seul,
 * comme la barre de valeurs, pour ne pas re-rendre tout l'écran à 10 Hz.
 */
function PoseBanner({ progress }: { progress: { frame: number; total: number } | null }) {
  const [live, setLive] = useState<ExposureUpdate | null>(null);
  useEffect(() => {
    const sub = PerseiCamera.addListener('onExposureUpdate', setLive);
    return () => sub.remove();
  }, []);

  const assembling = progress != null && progress.frame >= progress.total;
  const avancement = progress ? `${progress.frame}/${progress.total} s` : 'préparation';

  return (
    <View style={styles.toast}>
      <Text style={styles.toastText}>
        {assembling
          ? 'Assemblage du rendu… quelques secondes.'
          : `Pose en cours (${avancement}). Ne bouge pas le téléphone.`}
        {live ? `\nCapteur : ISO ${Math.round(live.iso)} · ${formatShutter(live.shutter)}` : ''}
      </Text>
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
  viewerVideo: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
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
  crashCard: {
    backgroundColor: 'rgba(60, 10, 10, 0.95)',
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#ff453a',
    gap: 6,
  },
  crashTitle: {
    color: '#ff453a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  crashScroll: {
    maxHeight: 160,
  },
  crashText: {
    color: '#e8e8e8',
    fontSize: 10,
    lineHeight: 14,
  },
  codeBanner: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: '92%',
  },
  codeText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  videoSummary: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  recBanner: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff453a',
  },
  recDotPaused: {
    backgroundColor: '#9b9b9b',
  },
  recText: {
    color: '#e8e8e8',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  recSize: {
    color: '#9b9b9b',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  shutterVideo: {
    backgroundColor: '#ff453a',
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
