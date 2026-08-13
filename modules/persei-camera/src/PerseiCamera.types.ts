export type LensId = 'ultraWide' | 'wide' | 'telephoto';

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
}
