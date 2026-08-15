import assert from 'node:assert/strict';
import test from 'node:test';

import { pickThumbnail } from '../capture';

/**
 * Le défaut réel : la vignette était choisie sur l'extension `.heic`, donc
 * toujours le premier fichier écrit — la vue à −2 IL d'un bracket, la plus
 * sombre des trois.
 */
test('en bracket, la vignette montre la vue à 0 IL', () => {
  const uris = ['file://a.heic', 'file://b.heic', 'file://c.heic'];
  assert.equal(pickThumbnail(uris, [-2, 0, 2]), 'file://b.heic');
  assert.equal(pickThumbnail(uris, [-1, 0, 1]), 'file://b.heic');
});

/** Un bracket asymétrique existe : on prend la plus proche de 0, pas la médiane. */
test('la vue retenue est la plus proche de zéro', () => {
  const uris = ['file://a.heic', 'file://b.heic', 'file://c.heic'];
  assert.equal(pickThumbnail(uris, [-3, -1, 2]), 'file://b.heic');
  assert.equal(pickThumbnail(uris, [0.5, 3, 4]), 'file://a.heic');
});

/** Un DNG ne s'affiche pas : la vignette vient du fichier développé. */
test('le RAW cède la vignette à l image développée', () => {
  assert.equal(pickThumbnail(['file://a.dng', 'file://a.heic']), 'file://a.heic');
  assert.equal(pickThumbnail(['file://a.DNG', 'file://a.jpg']), 'file://a.jpg');
  assert.equal(pickThumbnail(['file://a.heic']), 'file://a.heic');
});

/** Rien d'affichable : on rend quand même quelque chose plutôt que rien. */
test('cas dégradés', () => {
  assert.equal(pickThumbnail([]), null);
  assert.equal(pickThumbnail(['file://a.dng']), 'file://a.dng', 'un seul fichier : celui-là');
  assert.equal(
    pickThumbnail(['file://a.heic', 'file://b.heic'], [-2, 0, 2]),
    'file://a.heic',
    'décompte incohérent : on ignore les corrections et on prend la première développée'
  );
});
