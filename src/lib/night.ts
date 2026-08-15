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

/**
 * Seuils de sortie, plus bas que ceux d'entrée.
 *
 * La mesure oscille en permanence autour du seuil : sans cet écart, le badge
 * apparaissait et disparaissait plusieurs fois par seconde sur une scène qui
 * n'a pas bougé.
 */
export const DARK_EXIT_ISO = 1200;
export const DARK_EXIT_SHUTTER = 1 / 50;

export function darkSceneWithHysteresis(
  precedent: boolean,
  live: ExposureUpdate | null | undefined
): boolean {
  if (!live || !Number.isFinite(live.iso) || !Number.isFinite(live.shutter)) return false;
  if (!precedent) return isDarkScene(live);
  return live.iso > DARK_EXIT_ISO && live.shutter > DARK_EXIT_SHUTTER;
}

/**
 * Appareil posé ou tenu à la main, jugé sur l'agitation de l'accéléromètre.
 *
 * Une main, même appliquée, laisse une centaine de micro-g d'écart entre deux
 * mesures ; un trépied n'en laisse aucune. La différence décide de la durée
 * qu'on peut proposer sans que l'image bouge.
 */
export const STEADY_THRESHOLD = 0.004;

export function isSteady(magnitudes: number[]): boolean {
  if (magnitudes.length < 4) return false;
  const valides = magnitudes.filter((m) => Number.isFinite(m));
  if (valides.length < 4) return false;
  const moyenne = valides.reduce((a, b) => a + b, 0) / valides.length;
  const ecart = Math.sqrt(
    valides.reduce((somme, m) => somme + (m - moyenne) ** 2, 0) / valides.length
  );
  return ecart < STEADY_THRESHOLD;
}

/**
 * Durée proposée pour la pose de nuit automatique. Posé, on peut intégrer
 * bien plus longtemps sans filé ; à main levée, dix secondes sont déjà le
 * maximum tenable.
 */
export function nightDurationSeconds(steady: boolean): number {
  return steady ? 30 : 10;
}

export interface AutoNightState {
  /** Réglage utilisateur (tiroir ⚙︎). */
  autoNight: boolean;
  exposureAuto: boolean;
  front: boolean;
  timerSecs: number;
  posing: boolean;
  /**
   * Scène sombre déjà décidée, hystérésis comprise.
   *
   * Le déclencheur recalculait le seuil de son côté pendant que le badge
   * utilisait celui de sortie : dans la bande entre les deux, l'écran
   * promettait une pose de nuit et l'appui prenait une photo ordinaire.
   * Une seule décision, partagée.
   */
  sombre: boolean;
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
    state.sombre
  );
}
