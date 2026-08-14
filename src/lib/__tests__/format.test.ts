import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeCapture,
  formatBytes,
  formatDuration,
  formatError,
  formatFocus,
  formatShutter,
  formatZoomFactor,
} from '../format';

test('la vitesse s affiche en fraction ou en secondes', () => {
  assert.equal(formatShutter(1 / 500), '1/500');
  assert.equal(formatShutter(1), '1.0s');
  assert.equal(formatShutter(0.5), '0.5s');
  assert.equal(formatShutter(0), '—');
  assert.equal(formatShutter(NaN), '—');
});

test('le focus affiche l infini en haut de course', () => {
  assert.equal(formatFocus(1), '∞');
  assert.equal(formatFocus(0.995), '∞');
  assert.equal(formatFocus(0.5), '0.50');
  assert.equal(formatFocus(NaN), '—');
});

test('le zoom garde une décimale et la virgule française', () => {
  assert.equal(formatZoomFactor(1), '1×');
  assert.equal(formatZoomFactor(0.5), '0,5×');
  assert.equal(formatZoomFactor(5.04), '5×');
  assert.equal(formatZoomFactor(NaN), '—');
});

test('la durée d enregistrement passe aux heures quand il faut', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(9.7), '00:09');
  assert.equal(formatDuration(61), '01:01');
  assert.equal(formatDuration(3600), '01:00:00');
  assert.equal(formatDuration(-5), '00:00');
});

test('les tailles de fichier restent lisibles', () => {
  assert.equal(formatBytes(512), '512 o');
  assert.equal(formatBytes(1024 * 1024 * 1.5), '1.5 Mo');
  assert.equal(formatBytes(1024 ** 3 * 12), '12 Go');
  assert.equal(formatBytes(NaN), '—');
});

/** Le code Pxx doit survivre jusqu'au toast, c'est lui qui sert au debug. */
test('le code d erreur natif reste visible', () => {
  assert.equal(
    formatError({ code: 'ERR_LONG_EXPOSURE', message: 'P31: no frame captured' }),
    'ERR_LONG_EXPOSURE P31: no frame captured'
  );
  assert.equal(formatError({ message: 'P10: camera device unavailable' }), 'P10: camera device unavailable');
  assert.equal(formatError('boum'), 'boum');
});

test('la visionneuse nomme correctement chaque rendu', () => {
  assert.equal(describeCapture('file:///tmp/persei-pose-lueur-1.heic'), 'Lueur (moyenne)');
  assert.equal(describeCapture('file:///tmp/persei-pose-etoiles-1.heic'), 'Étoiles (fusion max)');
  assert.equal(describeCapture('file:///tmp/persei-1.dng'), 'RAW');
  assert.equal(describeCapture('file:///tmp/persei-video-1.mov'), 'Vidéo');
  assert.equal(describeCapture('file:///tmp/persei-live-1.mov'), 'Live Photo (vidéo)');
  assert.equal(describeCapture('file:///tmp/persei-1.heic'), 'Photo');
});
