import type { StackMode, ZoomPreset } from '../../modules/persei-camera';
import { FOCUS_STOPS, nearestIndex } from './scales';

/** Presets scénario : un tap règle exposition, focus, durée et style de pose. */
export interface ScenePreset {
  id: string;
  emoji: string;
  label: string;
  description: string;
  duration: number;
  style: StackMode;
  /** ISO manuel (trames de 1 s), ou null pour empiler des trames auto (jour). */
  iso: number | null;
  /** Position de focus manuelle (1 = ∞), ou null pour laisser l'autofocus. */
  focus: number | null;
}

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: 'meteors',
    emoji: '🌠',
    label: 'Étoiles filantes',
    description:
      "Une minute de pose en mode Les deux. La fusion max garde les traînées, la moyenne donne un ciel propre. ISO 1600, focus sur ∞, capteur principal 1×. Cale bien le téléphone.",
    duration: 60,
    style: 'both',
    iso: 1600,
    focus: 1,
  },
  {
    id: 'startrails',
    emoji: '⭐',
    label: 'Star trails',
    description:
      "Trente minutes de pose en fusion max. Les étoiles tracent des arcs autour du pôle. ISO 800, focus sur ∞. Pense à la batterie.",
    duration: 1800,
    style: 'max',
    iso: 800,
    focus: 1,
  },
  {
    id: 'water',
    emoji: '💧',
    label: "Filé d'eau",
    description:
      "Dix secondes en moyenne, exposition automatique : les trames courtes s'empilent et l'eau devient soyeuse, même en plein jour.",
    duration: 10,
    style: 'mean',
    iso: null,
    focus: null,
  },
  {
    id: 'fireworks',
    emoji: '🎆',
    label: "Feux d'artifice",
    description:
      "Dix secondes en fusion max. Toutes les gerbes du bouquet s'accumulent sur une seule image. ISO 100, focus sur ∞.",
    duration: 10,
    style: 'max',
    iso: 100,
    focus: 1,
  },
  {
    id: 'lighttrails',
    emoji: '🌃',
    label: 'Light trails',
    description:
      "Trente secondes en fusion max. Les phares dessinent des rubans de lumière dans la ville. ISO 50.",
    duration: 30,
    style: 'max',
    iso: 50,
    focus: null,
  },
];

/** Ce qu'il faut appliquer au matériel pour un preset donné. */
export interface PresetPlan {
  duration: number;
  style: StackMode;
  exposure: { mode: 'auto' } | { mode: 'manual'; isoIndex: number; shutterIndex: number };
  focus: { mode: 'auto' } | { mode: 'locked'; focusIndex: number };
  /** Zoom à appliquer (capteur principal pour les scènes de ciel), sinon null. */
  zoom: number | null;
}

/**
 * Traduit un preset en réglages concrets sur les échelles réelles du device.
 * Les scènes à focus fixe visent le ciel : elles cadrent sur le capteur
 * principal (1×), le meilleur des trois, jamais sur l'ultra grand-angle.
 */
export function planPreset(
  preset: ScenePreset,
  device: { isoStops: number[]; shutterStops: number[]; zoomPresets: ZoomPreset[] }
): PresetPlan {
  const exposure: PresetPlan['exposure'] =
    preset.iso == null
      ? { mode: 'auto' }
      : {
          mode: 'manual',
          isoIndex: nearestIndex(device.isoStops, preset.iso),
          // Trames de pose : la vitesse la plus longue disponible (~1 s).
          shutterIndex: nearestIndex(device.shutterStops, 1),
        };

  if (preset.focus == null) {
    return { duration: preset.duration, style: preset.style, exposure, focus: { mode: 'auto' }, zoom: null };
  }

  const wide = device.zoomPresets.find((z) => z.factor === 1);
  return {
    duration: preset.duration,
    style: preset.style,
    exposure,
    focus: { mode: 'locked', focusIndex: nearestIndex(FOCUS_STOPS, preset.focus) },
    zoom: wide ? wide.zoom : null,
  };
}
