import { NativeModule, requireNativeModule } from 'expo';

import type {
  CameraCapabilities,
  CameraPosition,
  CaptureOptions,
  FlashMode,
  PerseiCameraEvents,
  QualityPrioritization,
  StackMode,
  VideoCapabilities,
  VideoSettings,
} from './PerseiCamera.types';

declare class PerseiCameraModule extends NativeModule<PerseiCameraEvents> {
  requestPermission(): Promise<boolean>;
  /**
   * Démarre (ou reconfigure) la session et renvoie les capacités. L'arrière
   * utilise le device virtuel : zoom continu 0,5×→télé, bascule auto, macro.
   */
  start(position: CameraPosition): Promise<CameraCapabilities>;
  stop(): Promise<void>;
  setManualExposure(iso: number, shutterSeconds: number): Promise<void>;
  setAutoExposure(): Promise<void>;
  setExposureBias(bias: number): Promise<void>;
  /** Position de mise au point manuelle, 0 (proche) à 1 (infini). */
  setLensPosition(position: number): Promise<void>;
  setAutoFocus(): Promise<void>;
  /** Balance des blancs verrouillée : température (K) + teinte (vert-magenta, ~±150). */
  setWhiteBalance(kelvin: number, tint: number): Promise<void>;
  setAutoWhiteBalance(): Promise<void>;
  setZoom(factor: number): Promise<void>;
  setFlashMode(mode: FlashMode): Promise<void>;
  /** 0 = éteinte, sinon intensité 0-1. */
  setTorchLevel(level: number): Promise<void>;
  setQualityPrioritization(mode: QualityPrioritization): Promise<void>;
  /** Définition photo en mégapixels ; 0 demande la plus grande disponible. */
  setPhotoResolution(megapixels: number): Promise<void>;
  setLivePhotoEnabled(enabled: boolean): Promise<void>;
  setDepthEnabled(enabled: boolean): Promise<void>;
  /** Capture ; renvoie les URIs produits (HEIC, DNG si raw, MOV si Live Photo). */
  capturePhoto(options: CaptureOptions): Promise<string[]>;
  /** Aides de visée : focus peaking, zebras, histogramme (événement onHistogram). */
  setAssistOptions(peaking: boolean, zebras: boolean, histogram: boolean): Promise<void>;
  /** Loupe de mise au point (recadrage central grossi, calque natif). */
  setLoupeEnabled(enabled: boolean): Promise<void>;
  /**
   * Pose longue par empilement (durée libre, pas de plafond). `manualExposure`
   * true (nuit) : trames de ~1 s à l'ISO donné sur la caméra physique ;
   * false (jour) : trames auto courtes empilées (rendu pose longue correct en
   * pleine lumière). `align` recale les trames (main levée), `meteorFilter`
   * ne fusionne en max que les trames contenant un transitoire.
   */
  startLongExposure(
    seconds: number,
    iso: number,
    mode: StackMode,
    align: boolean,
    meteorFilter: boolean,
    manualExposure: boolean
  ): Promise<string[]>;
  cancelLongExposure(): Promise<void>;

  /** Autorisation micro, demandée seulement au passage en vidéo. */
  requestMicrophonePermission(): Promise<boolean>;
  /**
   * Mode réclamé par un raccourci Siri ou le bouton Action avant l'ouverture
   * (« meteors », « video », « photo »), consommé une seule fois.
   */
  consumeLaunchMode(): Promise<string | null>;
  /**
   * Trace du dernier plantage (nom de l'exception, raison, haut de pile), lue
   * une seule fois. Une exception levée sur une file d'arrière-plan tue l'app
   * sans rien afficher : c'est le seul moyen de savoir ce qui s'est passé.
   */
  consumeLastCrash(): Promise<string | null>;
  /**
   * Bascule la session en vidéo (ou revient en photo) et renvoie ce que le
   * matériel sait faire. En vidéo, le format est choisi explicitement : les
   * presets de session et le choix de format s'excluent.
   */
  setVideoMode(enabled: boolean): Promise<VideoCapabilities>;
  configureVideo(settings: VideoSettings): Promise<VideoCapabilities>;
  /** Démarre l'enregistrement ; échoue si l'espace disque est insuffisant. */
  startRecording(): Promise<void>;
  /** Arrête et renvoie l'URI du fichier .mov. */
  stopRecording(): Promise<string>;
  /** Pause dans le même fichier (iOS 18+), sans effet ailleurs. */
  pauseRecording(): Promise<void>;
  resumeRecording(): Promise<void>;
}

export default requireNativeModule<PerseiCameraModule>('PerseiCamera');
