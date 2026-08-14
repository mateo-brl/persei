import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoCapabilities, VideoSettings } from '../../../modules/persei-camera';
import {
  apertureStops,
  bytesPerSecond,
  clampVideoSettings,
  DEFAULT_VIDEO,
  describeVideoMode,
  explainStop,
  explainVideoError,
  frameRatesFor,
  remainingSeconds,
} from '../video';

/** iPhone 16 Pro : 4K jusqu'à 120, Log et ProRes disponibles. */
const proCaps: VideoCapabilities = {
  heights: [2160, 1080],
  frameRates: { '2160': [24, 25, 30, 60, 120], '1080': [24, 25, 30, 60, 120, 240] },
  supportsHdr: true,
  supportsLog: true,
  supportsProRes: true,
  stabilizations: ['off', 'auto', 'standard', 'cinematic', 'cinematicExtended'],
  supportsPause: true,
  hasMicrophone: true,
  isRecording: false,
  freeBytes: 64_000_000_000,
  supportsCinematic: true,
  cinematicFrameRates: { '2160': [24, 25, 30], '1080': [24, 25, 30] },
  apertureRange: [2.0, 16.0, 2.8],
  isCinematic: false,
};

/** Appareil d'entrée de gamme : 1080p seulement, ni Log ni ProRes. */
const basicCaps: VideoCapabilities = {
  heights: [1080, 720],
  frameRates: { '1080': [30, 60], '720': [30] },
  supportsHdr: false,
  supportsLog: false,
  supportsProRes: false,
  stabilizations: ['off', 'auto', 'standard'],
  supportsPause: false,
  hasMicrophone: true,
  isRecording: false,
  freeBytes: 64_000_000_000,
  supportsCinematic: false,
  cinematicFrameRates: {},
  apertureRange: [],
  isCinematic: false,
};

const pro4K120: VideoSettings = {
  height: 2160,
  frameRate: 120,
  range: 'log',
  codec: 'prores',
  stabilization: 'cinematicExtended',
  audioEnabled: true,
  windNoiseRemoval: true,
  cinematic: false,
  simulatedAperture: 0,
};

test('un réglage supporté passe sans être touché', () => {
  const settings: VideoSettings = { ...DEFAULT_VIDEO, height: 2160, frameRate: 60, range: 'hdr' };
  assert.deepEqual(clampVideoSettings(settings, proCaps), settings);
});

/**
 * Le même réglage sur un appareil plus modeste doit dégrader proprement,
 * jamais échouer au moment d'appuyer sur le déclencheur.
 */
test('un réglage impossible retombe sur le voisin le plus proche', () => {
  const result = clampVideoSettings(pro4K120, basicCaps);
  assert.equal(result.height, 1080, '4K absent : on redescend en 1080p');
  assert.equal(result.frameRate, 60, '120 i/s absent : la cadence la plus proche');
  assert.equal(result.range, 'sdr', 'ni Log ni HDR sur cet appareil');
  assert.equal(result.codec, 'hevc', 'ProRes absent');
  assert.equal(result.stabilization, 'auto', 'mode de stabilisation non supporté');
});

test('le HDR sert de repli quand le Log manque', () => {
  const caps = { ...proCaps, supportsLog: false };
  assert.equal(clampVideoSettings({ ...DEFAULT_VIDEO, range: 'log' }, caps).range, 'hdr');
});

test('sans micro le son est coupé, pas juste ignoré', () => {
  const caps = { ...proCaps, hasMicrophone: false };
  assert.equal(clampVideoSettings(DEFAULT_VIDEO, caps).audioEnabled, false);
});

test('sans capacités connues on ne touche à rien', () => {
  assert.deepEqual(clampVideoSettings(pro4K120, null), pro4K120);
});

test('les cadences proposées viennent du matériel', () => {
  assert.deepEqual(frameRatesFor(proCaps, 2160), [24, 25, 30, 60, 120]);
  assert.deepEqual(frameRatesFor(proCaps, 720), [], 'hauteur absente : aucune cadence');
  assert.deepEqual(frameRatesFor(null, 1080), []);
});

test('l étiquette du mode reste lisible', () => {
  assert.equal(describeVideoMode({ ...DEFAULT_VIDEO, height: 2160 }), '4K · 30 i/s');
  assert.equal(
    describeVideoMode({ ...pro4K120 }),
    '4K · 120 i/s · Log · ProRes'
  );
  assert.equal(describeVideoMode(DEFAULT_VIDEO), '1080p · 30 i/s');
});

/** ProRes remplit un téléphone en quelques minutes : l'ordre de grandeur doit être juste. */
test('le débit estimé distingue ProRes du reste', () => {
  const prores4K = bytesPerSecond({ ...DEFAULT_VIDEO, height: 2160, codec: 'prores' });
  const hevc4K = bytesPerSecond({ ...DEFAULT_VIDEO, height: 2160 });
  assert.ok(prores4K > hevc4K * 5, 'ProRes pèse au moins cinq fois plus lourd');
  assert.ok(prores4K * 60 > 4_000_000_000, 'environ 5 Go la minute en 4K ProRes');
  assert.ok(bytesPerSecond({ ...DEFAULT_VIDEO, frameRate: 60 }) > bytesPerSecond(DEFAULT_VIDEO));
});

test('le temps restant se déduit de l espace libre', () => {
  const settings = { ...DEFAULT_VIDEO, height: 2160 };
  const oneHour = remainingSeconds(settings, 27_000_000_000);
  assert.ok(oneHour > 3000 && oneHour < 4200, `durée inattendue : ${oneHour}`);
  assert.equal(remainingSeconds(settings, 0), 0);
  assert.equal(remainingSeconds(settings, Number.NaN), 0);
});

test('un arrêt subi est expliqué en clair', () => {
  assert.match(explainStop('thermal'), /chauffe/);
  assert.match(explainStop('interruption'), /système/);
  assert.match(explainStop('inconnu'), /sauvegardée/);
});

test('les échecs vidéo connus sont expliqués sans perdre leur code', () => {
  const manqueEspace = explainVideoError('ERR_RECORDING_START P40: not enough free space');
  assert.match(manqueEspace, /espace/);
  assert.match(manqueEspace, /P40/, 'le code doit rester lisible pour le débogage');
  assert.match(explainVideoError('P45: no format'), /résolution/);
  assert.equal(explainVideoError('boum inconnu'), 'boum inconnu');
});

/**
 * Le flou cinématique ne vit que sur des formats dédiés : 30 images/s au
 * plus, ni ProRes ni Log. Proposer autre chose ferait échouer la
 * configuration au moment d'appuyer.
 */
test('le mode cinéma ramène les réglages dans ses limites', () => {
  const demande: VideoSettings = {
    ...DEFAULT_VIDEO,
    height: 2160,
    frameRate: 120,
    range: 'log',
    codec: 'prores',
    cinematic: true,
  };
  const resultat = clampVideoSettings(demande, proCaps);
  assert.equal(resultat.cinematic, true);
  assert.equal(resultat.frameRate, 30, 'le cinéma plafonne à 30 images/s');
  assert.equal(resultat.codec, 'hevc');
  assert.equal(resultat.range, 'hdr', 'le Log n a pas de sens avec un flou calculé');
  assert.equal(resultat.simulatedAperture, 2.8, 'ouverture par défaut du format');
});

test('sans matériel compatible le cinéma reste éteint', () => {
  const resultat = clampVideoSettings({ ...DEFAULT_VIDEO, cinematic: true }, basicCaps);
  assert.equal(resultat.cinematic, false);
  assert.equal(resultat.simulatedAperture, 0);
});

test('l ouverture demandée reste dans les bornes du format', () => {
  const bas = clampVideoSettings(
    { ...DEFAULT_VIDEO, cinematic: true, simulatedAperture: 0.5 },
    proCaps
  );
  assert.equal(bas.simulatedAperture, 2);
  const haut = clampVideoSettings(
    { ...DEFAULT_VIDEO, cinematic: true, simulatedAperture: 40 },
    proCaps
  );
  assert.equal(haut.simulatedAperture, 16);
});

test('les cadences cinéma viennent de leur propre liste', () => {
  assert.deepEqual(frameRatesFor(proCaps, 2160, true), [24, 25, 30]);
  assert.deepEqual(frameRatesFor(basicCaps, 1080, true), []);
});

test('l étiquette annonce le cinéma et son ouverture', () => {
  assert.match(
    describeVideoMode({ ...DEFAULT_VIDEO, cinematic: true, simulatedAperture: 2.8 }),
    /Cinéma f\/2\.8/
  );
});

test('les ouvertures proposées tiennent dans les bornes du format', () => {
  const stops = apertureStops(proCaps);
  assert.ok(stops.length > 3);
  assert.ok(stops.every((f) => f >= 2 && f <= 16));
  assert.deepEqual(apertureStops(basicCaps), [], 'sans cinéma, aucune ouverture');
  assert.deepEqual(apertureStops(null), []);
});
