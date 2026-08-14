import type {
  VideoCapabilities,
  VideoCodec,
  VideoRange,
  VideoSettings,
  VideoStabilization,
} from '../../modules/persei-camera';

/** Réglage de départ : le plus sûr, celui qui existe sur tout iPhone. */
export const DEFAULT_VIDEO: VideoSettings = {
  height: 1080,
  frameRate: 30,
  range: 'sdr',
  codec: 'hevc',
  stabilization: 'auto',
  audioEnabled: true,
};

function nearest(values: number[], target: number): number | null {
  if (values.length === 0) return null;
  return values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best));
}

export function frameRatesFor(caps: VideoCapabilities | null, height: number): number[] {
  return caps?.frameRates?.[String(height)] ?? [];
}

/**
 * Ramène un réglage à ce que l'appareil sait réellement faire. L'interface ne
 * doit jamais proposer une combinaison qui ferait échouer la configuration :
 * un choix impossible se traduit par le voisin le plus proche, pas par une
 * erreur au moment d'appuyer sur le bouton.
 */
export function clampVideoSettings(
  settings: VideoSettings,
  caps: VideoCapabilities | null
): VideoSettings {
  if (!caps) return settings;

  const height = caps.heights.includes(settings.height)
    ? settings.height
    : (nearest(caps.heights, settings.height) ?? DEFAULT_VIDEO.height);

  const rates = frameRatesFor(caps, height);
  const frameRate = rates.includes(settings.frameRate)
    ? settings.frameRate
    : (nearest(rates, settings.frameRate) ?? DEFAULT_VIDEO.frameRate);

  let range: VideoRange = settings.range;
  if (range === 'log' && !caps.supportsLog) range = caps.supportsHdr ? 'hdr' : 'sdr';
  if (range === 'hdr' && !caps.supportsHdr) range = 'sdr';

  let codec: VideoCodec = settings.codec;
  if (codec === 'prores' && !caps.supportsProRes) codec = 'hevc';

  const stabilization: VideoStabilization = caps.stabilizations.includes(settings.stabilization)
    ? settings.stabilization
    : 'auto';

  const audioEnabled = settings.audioEnabled && caps.hasMicrophone;

  return { height, frameRate, range, codec, stabilization, audioEnabled };
}

/** Étiquette courte du mode courant, façon « 4K · 30 i/s · HDR ». */
export function describeVideoMode(settings: VideoSettings): string {
  const resolution = settings.height >= 2160 ? '4K' : `${settings.height}p`;
  const parts = [resolution, `${settings.frameRate} i/s`];
  if (settings.range === 'hdr') parts.push('HDR');
  if (settings.range === 'log') parts.push('Log');
  if (settings.codec === 'prores') parts.push('ProRes');
  return parts.join(' · ');
}

/**
 * Débit approximatif, pour estimer le temps d'enregistrement restant. Ce sont
 * des ordres de grandeur observés, pas des valeurs garanties : ils servent à
 * prévenir avant de remplir le téléphone, jamais à promettre une durée.
 */
export function bytesPerSecond(settings: VideoSettings): number {
  if (settings.codec === 'prores') {
    const base = settings.height >= 2160 ? 88_000_000 : 22_000_000;
    return base * (settings.frameRate / 30);
  }
  const base = settings.height >= 2160 ? 7_500_000 : 2_500_000;
  const hdr = settings.range === 'sdr' ? 1 : 1.3;
  return base * (settings.frameRate / 30) * hdr;
}

/** Secondes enregistrables avec l'espace libre annoncé. */
export function remainingSeconds(settings: VideoSettings, freeBytes: number): number {
  const rate = bytesPerSecond(settings);
  if (!Number.isFinite(freeBytes) || freeBytes <= 0 || rate <= 0) return 0;
  return Math.floor(freeBytes / rate);
}

/**
 * Traduit les échecs vidéo connus. Le code Pxx reste affiché : c'est lui qui
 * sert au débogage, la phrase sert à l'utilisateur.
 */
export function explainVideoError(message: string): string {
  if (message.includes('P40')) {
    return 'Pas assez d’espace libre pour lancer l’enregistrement (P40). Fais de la place ou baisse la qualité.';
  }
  if (message.includes('P41')) return 'La caméra n’est pas en mode vidéo (P41).';
  if (message.includes('P42')) return 'L’enregistrement n’a pas pu démarrer (P42). Réessaie.';
  if (message.includes('P43')) return 'Un enregistrement est déjà en cours (P43).';
  if (message.includes('P45')) {
    return 'Cette combinaison de résolution et de cadence n’existe pas sur cet appareil (P45).';
  }
  return message;
}

/** Message d'un arrêt subi, en clair pour l'utilisateur. */
export function explainStop(reason: string): string {
  switch (reason) {
    case 'thermal':
      return 'Enregistrement arrêté : le téléphone chauffe trop. La vidéo est sauvegardée.';
    case 'interruption':
      return 'Enregistrement arrêté par le système (appel ou autre app). La vidéo est sauvegardée.';
    default:
      return 'Enregistrement arrêté. La vidéo est sauvegardée.';
  }
}
