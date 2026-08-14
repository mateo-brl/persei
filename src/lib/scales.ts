import type { CameraCapabilities } from '../../modules/persei-camera';

/**
 * Échelles de réglage affichées par les molettes. Ce sont les valeurs de la
 * série normalisée (tiers de diaphragme) : on garde celles que le matériel
 * accepte réellement, jamais plus.
 */
export const ISO_BASE = [
  25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600,
  2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800,
];

export const SHUTTER_BASE = [
  1 / 16000, 1 / 12800, 1 / 10000, 1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500,
  1 / 2000, 1 / 1600, 1 / 1250, 1 / 1000, 1 / 800, 1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250,
  1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40, 1 / 30, 1 / 25, 1 / 20,
  1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 0.4, 0.5, 0.6, 0.8, 1,
];

export const FOCUS_STOPS = Array.from({ length: 101 }, (_, i) => i / 100);
export const WB_STOPS = Array.from({ length: 56 }, (_, i) => 2500 + i * 100);
export const TINT_STOPS = Array.from({ length: 61 }, (_, i) => -150 + i * 5);
export const TORCH_STOPS = Array.from({ length: 21 }, (_, i) => i / 20);

/** Index de la valeur la plus proche de `target` (0 si la liste est vide). */
export function nearestIndex(values: number[], target: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
  }
  return best;
}

/** Ramène un index dans les bornes d'une liste, y compris si elle a rétréci. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.round(index), 0), length - 1);
}

/**
 * Une molette vide enverrait `undefined` au natif (donc NaN au capteur). Si
 * aucune valeur normalisée ne tombe dans la plage du matériel, on retombe sur
 * les bornes elles-mêmes : la molette a toujours au moins un cran valide.
 */
function withinRange(values: number[], min: number, max: number, fallback: number[]): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return fallback;
  const kept = values.filter((v) => v >= min && v <= max);
  if (kept.length > 0) return kept;
  return min === max ? [min] : [min, max];
}

export function isoStopsFor(caps: CameraCapabilities | null): number[] {
  if (!caps) return ISO_BASE;
  return withinRange(ISO_BASE, caps.minIso, caps.maxIso, ISO_BASE);
}

export function shutterStopsFor(caps: CameraCapabilities | null): number[] {
  if (!caps) return SHUTTER_BASE;
  return withinRange(SHUTTER_BASE, caps.minShutter, caps.maxShutter, SHUTTER_BASE);
}

/** Correction d'exposition par tiers d'IL, sur la plage annoncée par le device. */
export function evStopsFor(caps: CameraCapabilities | null): number[] {
  if (!caps) return [0];
  const { minExposureBias: min, maxExposureBias: max } = caps;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return [0];
  const stops: number[] = [];
  for (let v = min; v <= max + 0.01; v += 1 / 3) {
    stops.push(Math.round(v * 10) / 10);
  }
  return stops.length > 0 ? stops : [0];
}
