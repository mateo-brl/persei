import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Node exige une extension explicite dans les imports ESM, alors que le
 * bundler de l'app résout `./scales` tout seul. Ce crochet complète le
 * spécifieur pour les tests, ce qui évite d'écrire du code d'app différent
 * de celui qu'on teste.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL) {
    const parent = path.dirname(fileURLToPath(context.parentURL));
    for (const extension of ['.ts', '.tsx', '.mjs', '.js']) {
      const candidate = path.resolve(parent, `${specifier}${extension}`);
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
