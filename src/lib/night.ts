import type { ExposureUpdate } from '../../modules/persei-camera';

/**
 * Scène sombre : en exposition automatique, l'iPhone pousse l'ISO et allonge
 * la vitesse jusqu'à ses limites. Les deux ensemble signent une scène que le
 * cliché unique ne rattrapera pas (l'app Camera d'Apple bascule en mode Nuit
 * au même moment).
 */
export const DARK_ISO_THRESHOLD = 1500;
export const DARK_SHUTTER_THRESHOLD = 1 / 35;

export function isDarkScene(live: ExposureUpdate | null | undefined): boolean {
  if (!live) return false;
  if (!Number.isFinite(live.iso) || !Number.isFinite(live.shutter)) return false;
  return live.iso > DARK_ISO_THRESHOLD && live.shutter > DARK_SHUTTER_THRESHOLD;
}

export interface AutoNightState {
  /** Réglage utilisateur (tiroir ⚙︎). */
  autoNight: boolean;
  exposureAuto: boolean;
  front: boolean;
  timerSecs: number;
  posing: boolean;
  live: ExposureUpdate | null | undefined;
}

/**
 * Le déclencheur photo lance une pose alignée au lieu d'un cliché bruité.
 * Jamais en exposition manuelle (l'utilisateur a choisi ses réglages), jamais
 * en frontale (pas de pose sur la caméra avant), jamais avec retardateur
 * (l'enchaînement des deux serait illisible), jamais pendant une pose.
 */
export function shouldAutoNight(state: AutoNightState): boolean {
  return (
    state.autoNight &&
    state.exposureAuto &&
    !state.front &&
    state.timerSecs === 0 &&
    !state.posing &&
    isDarkScene(state.live)
  );
}
