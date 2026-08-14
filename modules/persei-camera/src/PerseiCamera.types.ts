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
  /** Définitions photo offertes par le matériel, en mégapixels (12, 24, 48…). */
  photoResolutions: number[];
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

/** Étendue dynamique : Rec.709, HLG 10 bits (Dolby Vision) ou Apple Log. */
export type VideoRange = 'sdr' | 'hdr' | 'log';

export type VideoCodec = 'hevc' | 'h264' | 'prores';

export type VideoStabilization =
  | 'off'
  | 'auto'
  | 'standard'
  | 'cinematic'
  | 'cinematicExtended'
  /** iOS 26 : recadre sans ajouter de latence. */
  | 'lowLatency';

export interface VideoSettings {
  /** Hauteur de l'image : 2160 (4K), 1080, 720. */
  height: number;
  frameRate: number;
  range: VideoRange;
  codec: VideoCodec;
  stabilization: VideoStabilization;
  audioEnabled: boolean;
  /** Réduction du bruit du vent (iOS 18), exige l'audio multicanal. */
  windNoiseRemoval: boolean;
  /** Flou d'arrière-plan cinématique (iOS 26). */
  cinematic: boolean;
  /** Ouverture simulée en cinématique ; 0 laisse la valeur par défaut. */
  simulatedAperture: number;
}

export interface VideoCapabilities {
  /** Hauteurs disponibles, de la plus grande à la plus petite. */
  heights: number[];
  /** Cadences disponibles par hauteur (clé = hauteur en texte). */
  frameRates: Record<string, number[]>;
  supportsHdr: boolean;
  supportsLog: boolean;
  supportsProRes: boolean;
  stabilizations: VideoStabilization[];
  /** Pause en cours d'enregistrement (iOS 18+). */
  supportsPause: boolean;
  hasMicrophone: boolean;
  isRecording: boolean;
  /** Espace libre au moment de la lecture, en octets. */
  freeBytes: number;
  supportsCinematic: boolean;
  /** Cadences autorisées en cinématique, par hauteur. */
  cinematicFrameRates: Record<string, number[]>;
  /** [minimum, maximum, défaut] de l'ouverture simulée, vide si indisponible. */
  apertureRange: number[];
  isCinematic: boolean;
}

export interface RecordingProgress {
  seconds: number;
  bytes: number;
  paused: boolean;
}

/** Arrêt non demandé : surchauffe, interruption, disque plein. */
export interface RecordingStopped {
  uri: string;
  reason: string;
  error?: string;
}

export type PerseiCameraEvents = {
  onExposureUpdate(update: ExposureUpdate): void;
  onLongExposureProgress(progress: LongExposureProgress): void;
  /** Histogramme de luminance 64 bins (0-255), ~5 Hz quand activé. */
  onHistogram(payload: { bins: number[] }): void;
  /** Pression du bouton volume ou Camera Control. */
  onShutterButton(): void;
  /** Durée et poids du fichier pendant un enregistrement (2 Hz). */
  onRecordingProgress(progress: RecordingProgress): void;
  /** L'enregistrement s'est arrêté sans que l'app le demande. */
  onRecordingStopped(payload: RecordingStopped): void;
  /** Le téléphone chauffe : « serious » avertit, « critical » a coupé. */
  onSystemPressure(payload: { level: string }): void;
  /** Code QR ou code-barres lu dans la préview. */
  onCodeDetected(payload: { value: string; type: string }): void;
};
