import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoCapabilities, VideoSettings } from '../../../modules/persei-camera';
import {
  bytesPerSecond,
  clampVideoSettings,
  DEFAULT_VIDEO,
  describeVideoMode,
  explainStop,
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
};

const pro4K120: VideoSettings = {
  height: 2160,
  frameRate: 120,
  range: 'log',
  codec: 'prores',
  stabilization: 'cinematicExtended',
  audioEnabled: true,
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
