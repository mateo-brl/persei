import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PREFERENCES,
  sanitizePreferences,
  startupPreferences,
} from '../preferences';

/** Premier lancement, fichier absent ou illisible : les valeurs par défaut. */
test('une sauvegarde absente ou corrompue ne casse rien', () => {
  assert.deepEqual(sanitizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(sanitizePreferences('bidon'), DEFAULT_PREFERENCES);
  assert.deepEqual(sanitizePreferences(42), DEFAULT_PREFERENCES);
  assert.deepEqual(sanitizePreferences({}), DEFAULT_PREFERENCES);
});

test('les réglages reconnus sont rendus tels quels', () => {
  const lu = sanitizePreferences({
    captureMode: 'pose',
    grid: true,
    poseDuration: 300,
    poseStyle: 'max',
    timerSecs: 10,
    quality: 'speed',
  });
  assert.equal(lu.captureMode, 'pose');
  assert.equal(lu.grid, true);
  assert.equal(lu.poseDuration, 300);
  assert.equal(lu.poseStyle, 'max');
  assert.equal(lu.timerSecs, 10);
  assert.equal(lu.quality, 'speed');
});

/**
 * Le fichier peut venir d'une version antérieure ou d'un autre appareil : rien
 * d'inconnu ne doit atteindre le matériel, où une valeur hors bornes lève une
 * exception.
 */
test('une valeur inconnue revient au défaut', () => {
  const lu = sanitizePreferences({
    captureMode: 'panorama',
    poseStyle: 'median',
    quality: 'ultra',
    flash: 'strobe',
    timerSecs: 7,
    poseDuration: 12345,
    photoMp: -3,
    bracketEv: 99,
    grid: 'oui',
  });
  assert.equal(lu.captureMode, 'photo');
  assert.equal(lu.poseStyle, 'both');
  assert.equal(lu.quality, 'quality');
  assert.equal(lu.flash, 'off');
  assert.equal(lu.timerSecs, 0);
  assert.equal(lu.poseDuration, 30);
  assert.equal(lu.photoMp, 0);
  assert.equal(lu.bracketEv, 0);
  assert.equal(lu.grid, false);
});

/** Un réglage vidéo partiel se complète, il ne remplace pas tout le bloc. */
test('les réglages vidéo se complètent', () => {
  const lu = sanitizePreferences({ video: { height: 2160 } });
  assert.equal(lu.video.height, 2160);
  assert.equal(lu.video.codec, DEFAULT_PREFERENCES.video.codec);
  assert.equal(lu.video.frameRate, DEFAULT_PREFERENCES.video.frameRate);
});

/**
 * Rouvrir directement en vidéo reconfigurerait toute la session avant que
 * l'utilisateur ait rien demandé ; rouvrir en façade surprend plus que ça ne
 * sert. La pose, elle, est un choix délibéré et se garde.
 */
test('le lancement écarte les modes coûteux', () => {
  const video = sanitizePreferences({ captureMode: 'video', front: true, grid: true });
  const demarrage = startupPreferences(video);
  assert.equal(demarrage.captureMode, 'photo');
  assert.equal(demarrage.front, false);
  assert.equal(demarrage.grid, true, 'le reste des préférences survit');

  const pose = startupPreferences(sanitizePreferences({ captureMode: 'pose' }));
  assert.equal(pose.captureMode, 'pose');
});
