import { NativeModule, requireNativeModule } from 'expo';

import type {
  CameraCapabilities,
  CameraPosition,
  CaptureOptions,
  FlashMode,
  PerseiCameraEvents,
  QualityPrioritization,
  StackMode,
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
  /** true = résolution maximale (48 MP si dispo), false = 12 MP. */
  setHighResolution(enabled: boolean): Promise<void>;
  setLivePhotoEnabled(enabled: boolean): Promise<void>;
  setDepthEnabled(enabled: boolean): Promise<void>;
  /** Capture ; renvoie les URIs produits (HEIC, DNG si raw, MOV si Live Photo). */
  capturePhoto(options: CaptureOptions): Promise<string[]>;
  /** Aides de visée : focus peaking, zebras, histogramme (événement onHistogram). */
  setAssistOptions(peaking: boolean, zebras: boolean, histogram: boolean): Promise<void>;
  /** Loupe de mise au point (recadrage central grossi, calque natif). */
  setLoupeEnabled(enabled: boolean): Promise<void>;
  /**
   * Pose longue par empilement (durée libre, pas de plafond) : trames de ~1 s
   * fusionnées en moyenne et/ou en max. `align` recale les trames (main levée),
   * `meteorFilter` ne fusionne en max que les trames contenant un transitoire.
   */
  startLongExposure(
    seconds: number,
    iso: number,
    mode: StackMode,
    align: boolean,
    meteorFilter: boolean
  ): Promise<string[]>;
  cancelLongExposure(): Promise<void>;
}

export default requireNativeModule<PerseiCameraModule>('PerseiCamera');
