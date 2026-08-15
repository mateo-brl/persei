import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VIDEO, describeFallback } from '../video';

const demande = { ...DEFAULT_VIDEO, height: 2160, frameRate: 30, range: 'log' as const, codec: 'prores' as const };

const servi = (patch: Partial<Parameters<typeof describeFallback>[1] & object>) => ({
  height: 2160,
  frameRate: 30,
  range: 'log' as const,
  codec: 'prores',
  isTenBit: true,
  ...patch,
});

/** Tout a été servi : rien à signaler, et surtout pas de message inutile. */
test('aucun écart, aucun message', () => {
  assert.equal(describeFallback(demande, servi({})), null);
  assert.equal(describeFallback(demande, undefined), null, 'moteur muet : on ne raconte rien');
});

/** Les trois mensonges relevés par l'audit, un par un. */
test('le Log servi en HDR se dit', () => {
  const message = describeFallback(demande, servi({ range: 'hdr' }));
  assert.match(message ?? '', /Log indisponible, rendu en HDR/);
});

test('le ProRes servi en HEVC se dit', () => {
  const message = describeFallback(demande, servi({ codec: 'hevc' }));
  assert.match(message ?? '', /ProRes indisponible, encodé en HEVC/);
});

test('le standard servi en 10 bits se dit', () => {
  const sdr = { ...demande, range: 'sdr' as const, codec: 'hevc' as const };
  const message = describeFallback(sdr, servi({ range: 'sdr', codec: 'hevc', isTenBit: true }));
  assert.match(message ?? '', /standard demandé, servi en 10 bits/);
});

/** Résolution et cadence comptent aussi, avec une tolérance sur le 29,97. */
test('résolution et cadence', () => {
  assert.match(describeFallback(demande, servi({ height: 1080 })) ?? '', /1080p au lieu de 2160p/);
  assert.match(describeFallback(demande, servi({ frameRate: 60 })) ?? '', /60 i\/s au lieu de 30/);
  assert.equal(
    describeFallback({ ...demande, frameRate: 30 }, servi({ frameRate: 29.97 })),
    null,
    '29,97 pour 30 est la même cadence, pas un repli'
  );
});

/** Plusieurs écarts d'un coup : un seul message, pas trois. */
test('les écarts se cumulent dans une seule phrase', () => {
  const message = describeFallback(demande, servi({ range: 'sdr', codec: 'hevc', height: 1080 })) ?? '';
  assert.match(message, /Log indisponible/);
  assert.match(message, /ProRes indisponible/);
  assert.match(message, /1080p/);
  assert.equal(message.split('.').filter(Boolean).length, 1);
});
