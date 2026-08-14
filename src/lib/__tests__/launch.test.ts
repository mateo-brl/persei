import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isLaunchMode, modeFromUrl } from '../launch';
import { SCENE_PRESETS } from '../presets';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('le mode se lit dans l URL d ouverture', () => {
  assert.equal(modeFromUrl('persei://?mode=meteors'), 'meteors');
  assert.equal(modeFromUrl('persei://?mode=photo'), 'photo');
  assert.equal(modeFromUrl('persei://?autre=1&mode=video'), 'video');
  assert.equal(modeFromUrl('persei://'), null);
  assert.equal(modeFromUrl(null), null);
});

/** Une URL peut venir de n'importe où : rien d'inconnu ne doit s'appliquer. */
test('un mode inconnu est ignoré', () => {
  assert.equal(modeFromUrl('persei://?mode=nimportequoi'), null);
  assert.equal(isLaunchMode('meteors'), true);
  assert.equal(isLaunchMode('bidon'), false);
  assert.equal(isLaunchMode(undefined), false);
});

/**
 * Les contrôles système renvoient des identifiants de preset : si un preset
 * est renommé sans mettre la liste à jour, le bouton n'ouvre plus rien.
 */
test('chaque preset reste atteignable depuis l extérieur', () => {
  for (const preset of SCENE_PRESETS) {
    assert.equal(isLaunchMode(preset.id), true, `preset non atteignable : ${preset.id}`);
  }
});

/** Les URLs codées en dur dans le contrôle iOS doivent rester valides. */
test('les boutons du Centre de contrôle pointent vers des modes connus', () => {
  const swift = readFileSync(path.join(racine, 'targets/PerseiControl/PerseiControl.swift'), 'utf8');
  const urls = [...swift.matchAll(/persei:\/\/\?mode=([a-z]+)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2, 'aucune URL trouvée dans le contrôle');
  for (const mode of urls) {
    assert.equal(isLaunchMode(mode), true, `le contrôle iOS ouvre un mode inconnu : ${mode}`);
  }
});
