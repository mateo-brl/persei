export type CameraPosition = 'back' | 'front';

export type FlashMode = 'off' | 'auto' | 'on';

export type QualityPrioritization = 'speed' | 'balanced' | 'quality';

/** Rendus d'une pose longue : moyenne (lueur), fusion max (étoiles), ou les deux. */
export type StackMode = 'mean' | 'max' | 'both';

/** Pastille de zoom façon app Apple : `factor` affiché, `zoom` = videoZoomFactor. */
export interface ZoomPreset {
  factor: number;
  zoom: number;
}

export interface CameraCapabilities {
  minIso: number;
  maxIso: number;
  /** Durée d'obturation minimale en secondes (ex. 1/16000). */
  minShutter: number;
  /** Durée d'obturation maximale matérielle en secondes (~1 s sur iPhone). */
  maxShutter: number;
  minExposureBias: number;
  maxExposureBias: number;
  supportsRaw: boolean;
  supportsProRaw: boolean;
  maxMegapixels: number;
  zoomPresets: ZoomPreset[];
  hasFrontCamera: boolean;
  minZoom: number;
  maxZoom: number;
  hasFlash: boolean;
  hasTorch: boolean;
  supportsLivePhoto: boolean;
  supportsDepth: boolean;
  maxBracketCount: number;
}

/** Lecture temps réel du capteur (~10 Hz), y compris en modes auto. */
export interface ExposureUpdate {
  iso: number;
  shutter: number;
  lensPosition: number;
  exposureBias: number;
  whiteBalanceKelvin: number;
  zoom: number;
}

export interface CaptureOptions {
  raw?: boolean;
  /** Écarts d'exposition (EV) pour un bracketing ; vide/absent = photo simple. */
  bracketStops?: number[];
}

export interface LongExposureProgress {
  frame: number;
  total: number;
}

export type PerseiCameraEvents = {
  onExposureUpdate(update: ExposureUpdate): void;
  onLongExposureProgress(progress: LongExposureProgress): void;
  /** Histogramme de luminance 64 bins (0-255), ~5 Hz quand activé. */
  onHistogram(payload: { bins: number[] }): void;
  /** Pression du bouton volume ou Camera Control. */
  onShutterButton(): void;
};
