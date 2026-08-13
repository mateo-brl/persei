import { NativeModule, requireNativeModule } from 'expo';

import type { CameraCapabilities, LensId, PerseiCameraEvents } from './PerseiCamera.types';

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
  setWhiteBalanceKelvin(kelvin: number): Promise<void>;
  setAutoWhiteBalance(): Promise<void>;
  setZoom(factor: number): Promise<void>;
  /** Capture une photo, renvoie les URIs des fichiers produits (HEIC, et DNG si raw). */
  capturePhoto(raw: boolean): Promise<string[]>;
}

export default requireNativeModule<PerseiCameraModule>('PerseiCamera');
