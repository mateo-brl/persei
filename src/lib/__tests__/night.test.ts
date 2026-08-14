import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExposureUpdate } from '../../../modules/persei-camera';
import { isDarkScene, shouldAutoNight } from '../night';

const dark: ExposureUpdate = {
  iso: 3200,
  shutter: 1 / 20,
  lensPosition: 1,
  exposureBias: 0,
  whiteBalanceKelvin: 4200,
  zoom: 2,
};

const daylight: ExposureUpdate = { ...dark, iso: 64, shutter: 1 / 800 };

const base = {
  autoNight: true,
  exposureAuto: true,
  front: false,
  timerSecs: 0,
  posing: false,
  live: dark,
};

test('une scène de nuit se reconnaît à l ISO ET à la vitesse', () => {
  assert.equal(isDarkScene(dark), true);
  assert.equal(isDarkScene(daylight), false);
  assert.equal(isDarkScene({ ...dark, shutter: 1 / 500 }), false, 'ISO haut mais vitesse rapide : lumière artificielle');
  assert.equal(isDarkScene({ ...dark, iso: 400 }), false);
  assert.equal(isDarkScene(null), false);
  assert.equal(isDarkScene({ ...dark, iso: NaN }), false);
});

test('le mode nuit auto se déclenche sur une scène sombre', () => {
  assert.equal(shouldAutoNight(base), true);
});

test('le mode nuit auto laisse la main dès que l utilisateur a décidé', () => {
  assert.equal(shouldAutoNight({ ...base, autoNight: false }), false, 'réglage coupé');
  assert.equal(shouldAutoNight({ ...base, exposureAuto: false }), false, 'exposition manuelle : ses réglages priment');
  assert.equal(shouldAutoNight({ ...base, front: true }), false, 'pas de pose sur la frontale');
  assert.equal(shouldAutoNight({ ...base, timerSecs: 10 }), false, 'retardateur puis pose : illisible');
  assert.equal(shouldAutoNight({ ...base, posing: true }), false, 'une pose tourne déjà');
  assert.equal(shouldAutoNight({ ...base, live: daylight }), false);
  assert.equal(shouldAutoNight({ ...base, live: null }), false, 'aucune lecture capteur : on ne devine pas');
});
