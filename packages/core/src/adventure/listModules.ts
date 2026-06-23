// Enumerate installed adventure module packs for selection (eshyra-47ob).
//
// `loadModule.ts` loads ONE module from a known directory; this enumerates every
// module installed under a parent directory so a session-start selector can
// offer a choice. Two sources feed the selector: the core-bundled modules under
// `packages/core/data/adventure-modules/` (always present) and any the host has
// installed under the per-user data root. Both are just directories of packs, so
// one enumerator serves both — the host concatenates the two lists.
//
// Enumeration is deliberately forgiving: a subdirectory missing the pack file or
// carrying malformed JSON is skipped, never thrown, so one broken pack cannot
// make every other installed adventure unselectable.

import { type Dirent, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdventureModuleFromDir } from './loadModule.js';
import type { AdventureModule } from './types.js';

/** A discovered installed adventure module plus the directory it loaded from. */
export interface InstalledAdventureModule {
  readonly module: AdventureModule;
  /** Absolute path of the pack directory the module was loaded from. */
  readonly dir: string;
}

/**
 * Enumerate adventure module packs installed under `dir` — one per immediate
 * subdirectory that contains a loadable `adventure-module.json`. A subdirectory
 * that is missing the file or fails to parse/validate is skipped rather than
 * thrown, so a single malformed pack does not break selection of the well-formed
 * ones. A missing or unreadable `dir` yields `[]`. Results are sorted by module
 * id so the presentation order is stable across platforms and filesystems.
 */
export function listAdventureModulesInDir(
  dir: string,
): InstalledAdventureModule[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Missing or unreadable source directory: nothing installed here.
    return [];
  }

  const found: InstalledAdventureModule[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const moduleDir = join(dir, entry.name);
    try {
      found.push({
        module: loadAdventureModuleFromDir(moduleDir),
        dir: moduleDir,
      });
    } catch {
      // A pack that is missing its file or fails validation is skipped so the
      // rest of the installed adventures stay selectable.
    }
  }
  found.sort((a, b) => a.module.id.localeCompare(b.module.id));
  return found;
}

/**
 * Absolute path of the core-bundled adventure modules directory. Resolved
 * relative to this module so it is correct both in the TypeScript source tree
 * (`src/adventure/` → `data/`) and the compiled output (`dist/adventure/` →
 * `data/`); `data/` ships in every edition via `packages/core/package.json`
 * `files`. Mirrors the bundled SRD rules-pack resolution in `bundledSrdPack.ts`.
 */
const BUNDLED_ADVENTURE_MODULES_DIR = fileURLToPath(
  new URL('../../data/adventure-modules/', import.meta.url),
);

/**
 * Enumerate the core-bundled adventure modules shipped with the package. These
 * are always available out of the box (e.g. The Hollow Beneath Emberfall) and
 * form the baseline choices a fresh-campaign selector offers, ahead of any
 * host-installed modules.
 */
export function listBundledAdventureModules(): InstalledAdventureModule[] {
  return listAdventureModulesInDir(BUNDLED_ADVENTURE_MODULES_DIR);
}
