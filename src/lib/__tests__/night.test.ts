import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExposureUpdate } from '../../../modules/persei-camera';
import {
  darkSceneWithHysteresis,
  isDarkScene,
  isSteady,
  nightDurationSeconds,
  shouldAutoNight,
} from '../night';

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
  sombre: true,
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
  assert.equal(
    shouldAutoNight({ ...base, sombre: false }),
    false,
    'scène pas jugée sombre : photo ordinaire'
  );
});

/**
 * Le badge clignotait plusieurs fois par seconde : la mesure oscille autour du
 * seuil, et chaque oscillation basculait l'affichage.
 */
test('l hystérésis empêche le badge de clignoter', () => {
  const limite = { iso: 1400, shutter: 1 / 40, lensPosition: 1, exposureBias: 0, whiteBalanceKelvin: 5000, zoom: 2 };
  assert.equal(darkSceneWithHysteresis(false, limite), false, "sous le seuil d'entrée : rien");
  assert.equal(darkSceneWithHysteresis(true, limite), true, 'déjà affiché : on reste affiché');

  const clair = { ...limite, iso: 900, shutter: 1 / 120 };
  assert.equal(darkSceneWithHysteresis(true, clair), false, 'franchement clair : on sort');
  assert.equal(darkSceneWithHysteresis(true, null), false);
});

/** Une main laisse toujours une agitation, un trépied non. */
test('la stabilité distingue la main du trépied', () => {
  assert.equal(isSteady([1.0, 1.0001, 0.9999, 1.0, 1.0001]), true, 'posé');
  assert.equal(isSteady([1.0, 1.02, 0.97, 1.03, 0.98]), false, 'à main levée');
  assert.equal(isSteady([1, 1]), false, 'trop peu de mesures pour conclure');
  assert.equal(isSteady([1, NaN, 1, 1]), false, 'mesures incomplètes : on ne conclut pas');
});

test('la durée proposée suit la stabilité', () => {
  assert.equal(nightDurationSeconds(true), 30);
  assert.equal(nightDurationSeconds(false), 10);
});
