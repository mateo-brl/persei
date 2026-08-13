import { NativeModule, requireNativeModule } from 'expo';

import type {
  CameraCapabilities,
  CaptureOptions,
  FlashMode,
  LensId,
  PerseiCameraEvents,
  QualityPrioritization,
} from './PerseiCamera.types';

declare class PerseiCameraModule extends NativeModule<PerseiCameraEvents> {
  requestPermission(): Promise<boolean>;
  /** Démarre (ou reconfigure) la session sur l'objectif donné et renvoie ses capacités. */
  start(lens: LensId): Promise<CameraCapabilities>;
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
}

export default requireNativeModule<PerseiCameraModule>('PerseiCamera');
