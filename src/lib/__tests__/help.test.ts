import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HELP_TEXTS } from '../help';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Le ⓘ qui n'affichait rien a coûté trois allers-retours à Mateo. Une clé
 * utilisée dans l'écran sans texte associé casse silencieusement l'aide :
 * on le vérifie sur le fichier source réel.
 */
test('chaque bouton d aide de l écran a un texte', () => {
  const screen = readFileSync(path.join(projectRoot, 'src/app/index.tsx'), 'utf8');
  const used = [...screen.matchAll(/helpKey="([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 5, 'aucun helpKey trouvé : le test ne lit pas le bon fichier');
  for (const key of new Set(used)) {
    assert.ok(HELP_TEXTS[key], `aucune explication pour « ${key} »`);
  }
});

test('chaque réglage de la barre a un texte', () => {
  for (const key of ['iso', 'shutter', 'ev', 'focus', 'wb', 'tint']) {
    assert.ok(HELP_TEXTS[key], `aucune explication pour « ${key} »`);
  }
});

test('les explications restent utiles et lisibles', () => {
  for (const [key, texte] of Object.entries(HELP_TEXTS)) {
    assert.ok(texte.length > 60, `${key} : explication trop courte`);
    assert.ok(texte.length < 420, `${key} : explication trop longue pour une carte`);
    assert.ok(!texte.includes('—'), `${key} : tiret cadratin, ça sonne machine`);
  }
});
