import assert from 'node:assert/strict';
import test from 'node:test';

import { activeZoomIndex, displayZoom, isOnPreset, pinchZoom, wideZoomOf } from '../zoom';

/** 16 Pro : ultra grand-angle, principal, recadrage 2×, télé 5×. */
const proPresets = [
  { factor: 0.5, zoom: 1 },
  { factor: 1, zoom: 2 },
  { factor: 2, zoom: 4 },
  { factor: 5, zoom: 10 },
];

/** Appareil sans ultra grand-angle : le 1× est le zoom 1. */
const simplePresets = [{ factor: 1, zoom: 1 }];

test('le facteur affiché se compte depuis le capteur principal', () => {
  assert.equal(wideZoomOf(proPresets), 2);
  assert.equal(displayZoom(proPresets, 2), 1);
  assert.equal(displayZoom(proPresets, 1), 0.5);
  assert.equal(displayZoom(proPresets, 10), 5);
  assert.equal(displayZoom(simplePresets, 3), 3);
  assert.equal(wideZoomOf([]), 1, 'sans pastille, pas de division par zéro');
});

test('la pastille allumée suit le zoom réel', () => {
  assert.equal(activeZoomIndex(proPresets, 1), 0);
  assert.equal(activeZoomIndex(proPresets, 2), 1);
  assert.equal(activeZoomIndex(proPresets, 3.5), 1, 'entre 1× et 2× : la pastille 1× reste allumée');
  assert.equal(activeZoomIndex(proPresets, 10), 3);
  assert.equal(activeZoomIndex(proPresets, 24), 3);
});

test('le badge de zoom n apparaît qu entre deux pastilles', () => {
  assert.equal(isOnPreset(proPresets, 2), true);
  assert.equal(isOnPreset(proPresets, 10), true);
  assert.equal(isOnPreset(proPresets, 6), false, 'pincement à 3× : le badge doit s afficher');
});

test('le pincement reste dans les bornes du device', () => {
  assert.equal(pinchZoom(2, 2, 1, 25), 4);
  assert.equal(pinchZoom(2, 0.1, 1, 25), 1, 'on ne descend pas sous le minimum matériel');
  assert.equal(pinchZoom(10, 10, 1, 25), 25, 'plafonné au zoom numérique maximum');
  assert.equal(pinchZoom(2, NaN, 1, 25), 2, 'un geste corrompu ne fait pas partir NaN au natif');
  assert.ok(Number.isFinite(pinchZoom(2, 2, NaN, NaN)));
});
