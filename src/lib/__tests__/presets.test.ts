import assert from 'node:assert/strict';
import test from 'node:test';

import { planPreset, SCENE_PRESETS } from '../presets';
import { FOCUS_STOPS, ISO_BASE, SHUTTER_BASE } from '../scales';

/** Device virtuel d'un 16 Pro : le 1× de l'utilisateur vaut 2,0 en interne. */
const device = {
  isoStops: ISO_BASE,
  shutterStops: SHUTTER_BASE,
  zoomPresets: [
    { factor: 0.5, zoom: 1 },
    { factor: 1, zoom: 2 },
    { factor: 2, zoom: 4 },
    { factor: 5, zoom: 10 },
  ],
};

function preset(id: string) {
  const found = SCENE_PRESETS.find((p) => p.id === id);
  assert.ok(found, `preset ${id} manquant`);
  return found;
}

test('le preset météores vise le ciel : manuel, 1 s, infini, capteur principal', () => {
  const plan = planPreset(preset('meteors'), device);
  assert.equal(plan.duration, 60);
  assert.equal(plan.style, 'both');
  assert.equal(plan.exposure.mode, 'manual');
  if (plan.exposure.mode !== 'manual') return;
  assert.equal(device.isoStops[plan.exposure.isoIndex], 1600);
  assert.equal(device.shutterStops[plan.exposure.shutterIndex], 1);
  assert.equal(plan.focus.mode, 'locked');
  if (plan.focus.mode !== 'locked') return;
  assert.equal(FOCUS_STOPS[plan.focus.focusIndex], 1);
  assert.equal(plan.zoom, 2, 'les scènes de ciel cadrent sur le 1×, jamais sur l ultra grand-angle');
});

/** Bug corrigé le 13 août : forcer 1 s en plein jour cramait l'image. */
test('le filé d eau reste en exposition automatique', () => {
  const plan = planPreset(preset('water'), device);
  assert.equal(plan.exposure.mode, 'auto');
  assert.equal(plan.focus.mode, 'auto');
  assert.equal(plan.zoom, null, 'pas de recadrage imposé quand la scène n est pas le ciel');
});

test('un ISO hors plage retombe sur le cran le plus proche disponible', () => {
  const narrow = { ...device, isoStops: [100, 200, 400] };
  const plan = planPreset(preset('startrails'), narrow);
  assert.equal(plan.exposure.mode, 'manual');
  if (plan.exposure.mode !== 'manual') return;
  assert.equal(narrow.isoStops[plan.exposure.isoIndex], 400, 'ISO 800 demandé, 400 est le maximum du device');
});

test('sans pastille 1× le preset ne force aucun zoom', () => {
  const plan = planPreset(preset('meteors'), { ...device, zoomPresets: [] });
  assert.equal(plan.zoom, null);
});

test('chaque preset est complet et cohérent', () => {
  const ids = new Set<string>();
  for (const p of SCENE_PRESETS) {
    assert.ok(!ids.has(p.id), `identifiant dupliqué : ${p.id}`);
    ids.add(p.id);
    assert.ok(p.label.length > 0);
    assert.ok(p.description.length > 40, `${p.id} : description trop courte pour être utile`);
    assert.ok(p.duration >= 10 && p.duration <= 1800, `${p.id} : durée hors des choix proposés`);
    assert.ok(['mean', 'max', 'both'].includes(p.style));
    if (p.iso != null) assert.ok(p.iso >= 25 && p.iso <= 12800);
    if (p.focus != null) assert.ok(p.focus >= 0 && p.focus <= 1);
  }
});
