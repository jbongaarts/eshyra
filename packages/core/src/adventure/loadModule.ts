// Loader for immutable adventure module source packs (eshyra-eh54.3).
//
// Mirrors `world/loadModule.ts`: read an authored JSON pack read-only and
// structurally validate it. Adventure modules are kept logically separate from
// rules packs and from the world `ModulePack`, so they live in their own file
// (`adventure-module.json`) and never merge into the SRD rules pack. This step
// validates authored *structure and intra-module references* only; resolving
// cross-pack references (creature/item/table `rulesRef`s, setting ids) against
// a rules stack is `validateAdventureModuleReferences` in `./references.ts`,
// and campaign progress is a separate layer entirely (eshyra-eh54.4).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdventureModule } from './types.js';
import { AdventureModuleError, validateAdventureModule } from './validate.js';

/** File name an authored adventure module pack directory must contain. */
export const ADVENTURE_MODULE_FILE = 'adventure-module.json';

/** Parse and structurally validate an adventure module from a JSON string. */
export function parseAdventureModule(json: string): AdventureModule {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    throw new AdventureModuleError(
      `adventure module JSON is not parseable: ${(cause as Error).message}`,
    );
  }
  return validateAdventureModule(value);
}

/**
 * Load the authored adventure module at `<dir>/adventure-module.json`. The file
 * is read read-only and never written back, so the authored module stays
 * pristine and a campaign can bind to it repeatedly without mutating it.
 */
export function loadAdventureModuleFromDir(dir: string): AdventureModule {
  const path = join(dir, ADVENTURE_MODULE_FILE);
  let json: string;
  try {
    json = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new AdventureModuleError(
      `adventure module pack not found at ${path}: ${(cause as Error).message}`,
    );
  }
  return parseAdventureModule(json);
}
