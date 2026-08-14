import { register } from 'node:module';

// Chargé par `node --import` avant les tests : branche la résolution des
// imports sans extension (voir ts-hooks.mjs).
register('./ts-hooks.mjs', import.meta.url);
