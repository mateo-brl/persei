import type { ZoomPreset } from '../../modules/persei-camera';

/**
 * Sur le device virtuel, `videoZoomFactor` compte depuis l'ultra grand-angle :
 * le 1× de l'utilisateur vaut 2,0 en interne sur un 16 Pro. Tout ce qui est
 * affiché passe donc par ces conversions.
 */
export function wideZoomOf(presets: ZoomPreset[]): number {
  const wide = presets.find((p) => p.factor === 1);
  return wide && wide.zoom > 0 ? wide.zoom : 1;
}

/** Facteur affiché (1×, 2×…) pour un `videoZoomFactor` matériel. */
export function displayZoom(presets: ZoomPreset[], zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return zoom / wideZoomOf(presets);
}

/** Pastille en surbrillance : la dernière dont le seuil est franchi. */
export function activeZoomIndex(presets: ZoomPreset[], zoom: number): number {
  let active = 0;
  for (let i = 0; i < presets.length; i++) {
    if (zoom >= presets[i].zoom - 0.01) active = i;
  }
  return active;
}

/**
 * Vrai quand le zoom courant tombe sur une pastille : le badge de valeur
 * n'apparaît qu'entre deux crans (pendant un pincement), sinon il ferait
 * doublon avec la pastille allumée.
 */
export function isOnPreset(presets: ZoomPreset[], zoom: number): boolean {
  const shown = displayZoom(presets, zoom);
  return presets.some((p) => Math.abs(shown - p.factor) < 0.06);
}

/**
 * Plafond du zoom numérique. Au-delà l'image n'est plus que de
 * l'agrandissement ; Apple s'arrête au même endroit sur ses Pro.
 */
export const MAX_DIGITAL_ZOOM = 25;

/** Zoom demandé par un pincement, borné aux capacités du device. */
export function pinchZoom(base: number, scale: number, minZoom: number, maxZoom: number): number {
  const min = Number.isFinite(minZoom) ? minZoom : 1;
  const max = Number.isFinite(maxZoom) ? Math.min(maxZoom, MAX_DIGITAL_ZOOM) : 6;
  const wanted = (Number.isFinite(base) ? base : 1) * (Number.isFinite(scale) ? scale : 1);
  return Math.min(Math.max(wanted, min), Math.max(max, min));
}
