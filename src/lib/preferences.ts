import type {
  FlashMode,
  QualityPrioritization,
  StackMode,
  VideoSettings,
} from '../../modules/persei-camera';
import { DEFAULT_VIDEO } from './video';

/**
 * Réglages conservés d'une ouverture à l'autre.
 *
 * L'app oubliait tout à chaque lancement : mode, grille, aides, retardateur,
 * préférences de pose. Apple conserve jusqu'au mode Nuit.
 *
 * L'exposition manuelle n'en fait volontairement pas partie. La restaurer
 * ferait basculer la session sur la caméra physique dès l'ouverture, avec des
 * valeurs mesurées dans une autre lumière, parfois la veille : l'app
 * s'ouvrirait sur une image noire ou brûlée sans que rien ne l'explique.
 */
export interface Preferences {
  captureMode: 'photo' | 'pose' | 'video';
  front: boolean;
  raw: boolean;
  flash: FlashMode;
  livePhoto: boolean;
  depth: boolean;
  photoMp: number;
  quality: QualityPrioritization;
  bracketEv: number;
  timerSecs: number;
  grid: boolean;
  levelOn: boolean;
  autoNight: boolean;
  codeScan: boolean;
  nightVision: boolean;
  peaking: boolean;
  zebras: boolean;
  histogramOn: boolean;
  poseDuration: number;
  poseStyle: StackMode;
  poseAlign: boolean;
  poseMeteor: boolean;
  video: VideoSettings;
}

export const DEFAULT_PREFERENCES: Preferences = {
  captureMode: 'photo',
  front: false,
  raw: false,
  flash: 'off',
  livePhoto: false,
  depth: false,
  photoMp: 0,
  quality: 'quality',
  bracketEv: 0,
  timerSecs: 0,
  grid: false,
  levelOn: false,
  autoNight: true,
  codeScan: true,
  nightVision: false,
  peaking: false,
  zebras: false,
  histogramOn: false,
  poseDuration: 30,
  poseStyle: 'both',
  poseAlign: false,
  poseMeteor: false,
  video: DEFAULT_VIDEO,
};

const MODES: Preferences['captureMode'][] = ['photo', 'pose', 'video'];
const FLASHES: FlashMode[] = ['off', 'auto', 'on'];
const QUALITES: QualityPrioritization[] = ['speed', 'balanced', 'quality'];
const STYLES: StackMode[] = ['mean', 'max', 'both'];
const POSES = [10, 30, 60, 300, 900, 1800];
const RETARDATEURS = [0, 3, 10];

function bool(valeur: unknown, defaut: boolean): boolean {
  return typeof valeur === 'boolean' ? valeur : defaut;
}

function parmi<T>(valeur: unknown, autorisees: T[], defaut: T): T {
  return autorisees.includes(valeur as T) ? (valeur as T) : defaut;
}

function nombre(valeur: unknown, autorises: number[], defaut: number): number {
  return typeof valeur === 'number' && autorises.includes(valeur) ? valeur : defaut;
}

/**
 * Relit des réglages enregistrés en n'acceptant que ce qui a un sens
 * aujourd'hui.
 *
 * Le fichier vient d'une version antérieure de l'app, parfois d'un appareil
 * qui n'avait pas les mêmes capacités : tout ce qui n'est pas reconnu revient
 * à sa valeur par défaut, plutôt que d'être poussé tel quel vers le matériel.
 */
export function sanitizePreferences(brut: unknown): Preferences {
  if (typeof brut !== 'object' || brut === null) return DEFAULT_PREFERENCES;
  const p = brut as Record<string, unknown>;
  const d = DEFAULT_PREFERENCES;

  const video = typeof p.video === 'object' && p.video !== null
    ? { ...DEFAULT_VIDEO, ...(p.video as Partial<VideoSettings>) }
    : DEFAULT_VIDEO;

  return {
    captureMode: parmi(p.captureMode, MODES, d.captureMode),
    front: bool(p.front, d.front),
    raw: bool(p.raw, d.raw),
    flash: parmi(p.flash, FLASHES, d.flash),
    livePhoto: bool(p.livePhoto, d.livePhoto),
    depth: bool(p.depth, d.depth),
    photoMp: typeof p.photoMp === 'number' && p.photoMp >= 0 && p.photoMp <= 200 ? p.photoMp : d.photoMp,
    quality: parmi(p.quality, QUALITES, d.quality),
    bracketEv: typeof p.bracketEv === 'number' && p.bracketEv >= 0 && p.bracketEv <= 3 ? p.bracketEv : d.bracketEv,
    timerSecs: nombre(p.timerSecs, RETARDATEURS, d.timerSecs),
    grid: bool(p.grid, d.grid),
    levelOn: bool(p.levelOn, d.levelOn),
    autoNight: bool(p.autoNight, d.autoNight),
    codeScan: bool(p.codeScan, d.codeScan),
    nightVision: bool(p.nightVision, d.nightVision),
    peaking: bool(p.peaking, d.peaking),
    zebras: bool(p.zebras, d.zebras),
    histogramOn: bool(p.histogramOn, d.histogramOn),
    poseDuration: nombre(p.poseDuration, POSES, d.poseDuration),
    poseStyle: parmi(p.poseStyle, STYLES, d.poseStyle),
    poseAlign: bool(p.poseAlign, d.poseAlign),
    poseMeteor: bool(p.poseMeteor, d.poseMeteor),
    video,
  };
}

/**
 * Réglages à ne pas restaurer tels quels au lancement, même enregistrés.
 *
 * Rouvrir directement en vidéo reconfigure toute la session avant que
 * l'utilisateur ait rien demandé, et rouvrir sur la caméra frontale surprend
 * plus que ça ne sert. La pose, elle, se garde : c'est un choix délibéré, et
 * c'est le mode où l'on revient exprès.
 */
export function startupPreferences(sauvegardees: Preferences): Preferences {
  return {
    ...sauvegardees,
    captureMode: sauvegardees.captureMode === 'video' ? 'photo' : sauvegardees.captureMode,
    front: false,
  };
}
