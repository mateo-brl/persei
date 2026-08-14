/**
 * Modes d'ouverture demandés de l'extérieur : bouton du Centre de contrôle,
 * raccourci Siri, bouton Action. Le contrôle passe par une URL
 * (`persei://?mode=meteors`), les raccourcis par un réglage lu au démarrage.
 */

/** Modes acceptés. Tout le reste est ignoré, jamais appliqué au hasard. */
export const LAUNCH_MODES = ['photo', 'video', 'meteors', 'startrails', 'water', 'fireworks', 'lighttrails'];

export function isLaunchMode(value: string | null | undefined): boolean {
  return typeof value === 'string' && LAUNCH_MODES.includes(value);
}

/** Mode porté par une URL d'ouverture, ou null si elle n'en contient pas. */
export function modeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /[?&]mode=([a-z]+)/i.exec(url);
  if (!match) return null;
  const mode = match[1].toLowerCase();
  return isLaunchMode(mode) ? mode : null;
}
