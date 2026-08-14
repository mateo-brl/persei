import assert from 'node:assert/strict';
import test from 'node:test';

import { describeCode, isOpenableUrl } from '../codes';

test('seuls les codes ouvrables proposent une action', () => {
  assert.equal(isOpenableUrl('https://persei.app'), true);
  assert.equal(isOpenableUrl('  http://exemple.fr/page  '), true);
  assert.equal(isOpenableUrl('mailto:mateo@exemple.fr'), true);
  assert.equal(isOpenableUrl('WIFI:S:maison;T:WPA;P:secret;;'), false);
  assert.equal(isOpenableUrl('3017620422003'), false);
  assert.equal(isOpenableUrl('javascript:alert(1)'), false, 'aucun schéma exotique ne doit être ouvert');
});

test('le bandeau dit ce qu on vient de lire', () => {
  assert.equal(describeCode('https://persei.app/', 'org.iso.QRCode'), 'persei.app');
  assert.equal(describeCode('WIFI:S:maison;T:WPA;P:secret;;', 'org.iso.QRCode'), 'Réseau wifi');
  assert.equal(describeCode('BEGIN:VCARD\nFN:Mateo', 'org.iso.QRCode'), 'Contact');
  assert.equal(describeCode('3017620422003', 'org.gs1.EAN-13'), 'Code-barres 3017620422003');
  assert.equal(describeCode('un texte libre', 'org.iso.QRCode'), 'un texte libre');
});
