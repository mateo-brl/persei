import assert from 'node:assert/strict';
import test from 'node:test';

import type { CameraCapabilities } from '../../../modules/persei-camera';
import {
  clampIndex,
  evStopsFor,
  isoStopsFor,
  ISO_BASE,
  nearestIndex,
  shutterStopsFor,
} from '../scales';

/** Capacités d'un iPhone 16 Pro, caméra principale. */
const proCaps: CameraCapabilities = {
  minIso: 22,
  maxIso: 6336,
  minShutter: 1 / 16000,
  maxShutter: 1,
  minExposureBias: -8,
  maxExposureBias: 8,
  supportsRaw: true,
  supportsProRaw: true,
  maxMegapixels: 48,
  photoResolutions: [12, 24, 48],
  zoomPresets: [],
  hasFrontCamera: true,
  minZoom: 1,
  maxZoom: 25,
  hasFlash: true,
  hasTorch: true,
  supportsLivePhoto: true,
  supportsDepth: true,
  maxBracketCount: 3,
};

test('nearestIndex trouve le cran le plus proche', () => {
  assert.equal(nearestIndex([100, 200, 400], 250), 1);
  assert.equal(nearestIndex([100, 200, 400], 399), 2);
  assert.equal(nearestIndex([100, 200, 400], 0), 0);
  assert.equal(nearestIndex([], 5), 0, 'liste vide : pas de plantage');
});

test('les échelles restent dans les bornes du matériel', () => {
  const iso = isoStopsFor(proCaps);
  assert.ok(iso.length > 0);
  assert.ok(iso.every((v) => v >= proCaps.minIso && v <= proCaps.maxIso));
  assert.ok(!iso.includes(12800), 'ISO au-delà du capteur : refusé par AVFoundation');

  const shutter = shutterStopsFor(proCaps);
  assert.ok(shutter.every((v) => v >= proCaps.minShutter && v <= proCaps.maxShutter));
  assert.ok(shutter.includes(1), 'la pose de 1 s est la trame de base du mode nuit');
});

/**
 * Une plage matérielle si étroite qu'aucune valeur normalisée n'y tombe
 * donnerait une molette vide, donc `undefined` envoyé au natif (NaN au
 * capteur). La molette doit toujours avoir un cran utilisable.
 */
test('une plage étroite ne vide jamais la molette', () => {
  const narrow = { ...proCaps, minIso: 34, maxIso: 38 };
  const iso = isoStopsFor(narrow);
  assert.ok(iso.length > 0);
  assert.ok(iso.every(Number.isFinite));
  assert.ok(iso.every((v) => v >= 34 && v <= 38));

  const single = isoStopsFor({ ...proCaps, minIso: 100, maxIso: 100 });
  assert.deepEqual(single, [100]);
});

test('des capacités absurdes retombent sur une échelle utilisable', () => {
  assert.deepEqual(isoStopsFor({ ...proCaps, minIso: NaN, maxIso: NaN }), ISO_BASE);
  assert.deepEqual(isoStopsFor({ ...proCaps, minIso: 900, maxIso: 100 }), ISO_BASE);
  assert.deepEqual(isoStopsFor(null), ISO_BASE);
});

test('la correction d exposition couvre la plage par tiers d IL', () => {
  const ev = evStopsFor(proCaps);
  assert.ok(ev.includes(0), '0 doit exister, c est la position neutre');
  assert.equal(ev[0], -8);
  assert.ok(ev[ev.length - 1] <= 8.01);
  assert.deepEqual(evStopsFor(null), [0]);
  assert.deepEqual(evStopsFor({ ...proCaps, minExposureBias: NaN, maxExposureBias: 3 }), [0]);
});

/**
 * Passer sur la frontale rétrécit les plages : sans reclamp, l'index gardé
 * de l'arrière pointe hors de la nouvelle échelle.
 */
test('clampIndex ramène un index périmé dans la nouvelle échelle', () => {
  assert.equal(clampIndex(27, 12), 11);
  assert.equal(clampIndex(-3, 12), 0);
  assert.equal(clampIndex(5, 0), 0);
  assert.equal(clampIndex(NaN, 12), 0);
});
