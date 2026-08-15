import type {
  AppliedVideoState,
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
  windNoiseRemoval: true,
  cinematic: false,
  simulatedAperture: 0,
};

function nearest(values: number[], target: number): number | null {
  if (values.length === 0) return null;
  return values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best));
}

export function frameRatesFor(
  caps: VideoCapabilities | null,
  height: number,
  cinematic = false
): number[] {
  if (cinematic) return caps?.cinematicFrameRates?.[String(height)] ?? [];
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

  // Le cinématique n'existe que sur des formats dédiés, plafonnés à 30
  // images/s : proposer 120 dans ce mode serait promettre l'impossible.
  const cinematic = settings.cinematic && caps.supportsCinematic;

  const rates = frameRatesFor(caps, height, cinematic);
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

  // Le flou cinématique impose ses propres conditions : ni ProRes, ni Log.
  const codecFinal: VideoCodec = cinematic ? 'hevc' : codec;
  const rangeFinal: VideoRange = cinematic && range === 'log' ? 'hdr' : range;

  const [minimum, maximum, defaut] = caps.apertureRange ?? [];
  let simulatedAperture = settings.simulatedAperture;
  if (!cinematic || minimum === undefined) {
    simulatedAperture = 0;
  } else if (simulatedAperture <= 0) {
    simulatedAperture = defaut ?? minimum;
  } else {
    simulatedAperture = Math.min(Math.max(simulatedAperture, minimum), maximum ?? minimum);
  }

  return {
    height,
    frameRate,
    range: rangeFinal,
    codec: codecFinal,
    stabilization,
    audioEnabled,
    windNoiseRemoval: settings.windNoiseRemoval,
    cinematic,
    simulatedAperture,
  };
}

/** Ouvertures proposées en cinématique, dans les bornes du format. */
const OUVERTURES = [1.4, 1.8, 2, 2.2, 2.8, 3.2, 4, 4.5, 5.6, 6.3, 8, 11, 16];

export function apertureStops(caps: VideoCapabilities | null): number[] {
  const [minimum, maximum] = caps?.apertureRange ?? [];
  if (minimum === undefined || maximum === undefined) return [];
  const gardees = OUVERTURES.filter((f) => f >= minimum && f <= maximum);
  return gardees.length > 0 ? gardees : [minimum, maximum];
}

/** Étiquette courte du mode courant, façon « 4K · 30 i/s · HDR ». */
export function describeVideoMode(settings: VideoSettings): string {
  const resolution = settings.height >= 2160 ? '4K' : `${settings.height}p`;
  const parts = [resolution, `${settings.frameRate} i/s`];
  if (settings.range === 'hdr') parts.push('HDR');
  if (settings.range === 'log') parts.push('Log');
  if (settings.codec === 'prores') parts.push('ProRes');
  if (settings.cinematic) {
    parts.push(settings.simulatedAperture > 0 ? `Cinéma f/${settings.simulatedAperture}` : 'Cinéma');
  }
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

/**
 * Écart entre ce qui a été demandé et ce que le matériel sert vraiment.
 *
 * Ces replis existent et sont légitimes — tous les formats n'acceptent pas
 * tous les codecs. Ce qui ne l'est pas, c'est de les taire : on pouvait filmer
 * en HLG avec « Log » affiché à l'écran, en HEVC avec « ProRes » affiché, ou
 * en 10 bits en croyant tourner en standard. Rend `null` quand tout a été
 * servi tel quel.
 */
export function describeFallback(
  demande: VideoSettings,
  servi: AppliedVideoState | undefined
): string | null {
  if (!servi) return null;
  const ecarts: string[] = [];

  if (demande.range === 'log' && servi.range !== 'log') {
    ecarts.push(servi.range === 'hdr' ? 'Log indisponible, rendu en HDR' : 'Log indisponible, rendu en standard');
  } else if (demande.range === 'hdr' && servi.range === 'sdr') {
    ecarts.push('HDR indisponible, rendu en standard');
  } else if (demande.range === 'sdr' && servi.isTenBit) {
    ecarts.push('standard demandé, servi en 10 bits');
  }

  if (demande.codec === 'prores' && servi.codec !== 'prores') {
    ecarts.push(`ProRes indisponible, encodé en ${servi.codec.toUpperCase()}`);
  } else if (demande.codec !== servi.codec && servi.codec !== '') {
    ecarts.push(`codec ${servi.codec.toUpperCase()} au lieu de ${demande.codec.toUpperCase()}`);
  }

  if (servi.height > 0 && servi.height !== demande.height) {
    ecarts.push(`${servi.height}p au lieu de ${demande.height}p`);
  }
  if (servi.frameRate > 0 && Math.abs(servi.frameRate - demande.frameRate) > 0.6) {
    ecarts.push(`${Math.round(servi.frameRate)} i/s au lieu de ${Math.round(demande.frameRate)}`);
  }

  if (ecarts.length === 0) return null;
  return `Réglage adapté par l’appareil : ${ecarts.join(', ')}.`;
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
