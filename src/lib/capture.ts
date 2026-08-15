/**
 * Choix de la vignette après une prise. Séparé de l'écran pour être testé :
 * la vignette est la seule chose que l'utilisateur voit du fichier qu'il vient
 * d'écrire, et elle a longtemps montré autre chose que la photo attendue.
 */

/** Un DNG ne s'affiche pas : la vignette doit venir de l'image développée. */
function estDeveloppee(uri: string): boolean {
  return !uri.toLowerCase().endsWith('.dng');
}

/**
 * Vignette à afficher parmi les fichiers d'une même prise.
 *
 * En bracketing, les fichiers reviennent dans l'ordre des corrections
 * demandées. Choisir « le premier » montrait donc toujours la vue la plus
 * sombre, celle qu'on garde le moins. On prend la vue la plus proche de 0 IL,
 * qui est l'exposition que l'utilisateur a cadrée.
 *
 * En RAW, on écarte le DNG au profit du JPEG ou du HEIC qui l'accompagne.
 */
export function pickThumbnail(uris: string[], bracketStops?: number[]): string | null {
  if (uris.length === 0) return null;

  if (bracketStops && bracketStops.length === uris.length) {
    let meilleur = 0;
    for (let i = 1; i < bracketStops.length; i += 1) {
      if (Math.abs(bracketStops[i]) < Math.abs(bracketStops[meilleur])) meilleur = i;
    }
    if (estDeveloppee(uris[meilleur])) return uris[meilleur];
  }

  return uris.find(estDeveloppee) ?? uris[0];
}
