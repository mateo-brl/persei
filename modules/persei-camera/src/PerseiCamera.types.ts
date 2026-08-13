export type LensId = 'ultraWide' | 'wide' | 'telephoto' | 'front';

export type FlashMode = 'off' | 'auto' | 'on';

export type QualityPrioritization = 'speed' | 'balanced' | 'quality';

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
  lenses: LensId[];
  /** Facteur de zoom réel du téléobjectif vs grand-angle (5 sur 16 Pro), 0 si absent. */
  telephotoFactor: number;
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

export type PerseiCameraEvents = {
  onExposureUpdate(update: ExposureUpdate): void;
};
