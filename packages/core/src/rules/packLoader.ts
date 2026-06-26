/**
 * Loader for generated rules-pack artifacts stored on disk.
 *
 * ## Generated data layout
 *
 * Generated (and seed) rules-pack artifacts live under:
 *
 *   packages/core/data/rules-packs/<packId-safe>/
 *     manifest.json   — RulesPackMeta (minus `order` / `dependsOn`; those are
 *                       runtime-only and are not persisted to disk)
 *     records.json    — RulesRecord[]  (one flat array; importers may generate
 *                       this in any order; the loader sorts by `key` before
 *                       returning so output is always deterministic)
 *
 * `<packId-safe>` is the pack identifier with every `:` replaced by `__`
 * (double underscore) so the directory name is valid on all platforms
 * (Windows NTFS forbids `:` in file/directory names).  For example, the pack
 * `rules:dnd5e-srd-5.1` lives in `rules__dnd5e-srd-5.1/`.  The canonical
 * `packId` is stored inside `manifest.json`, not derived from the directory.
 * Pack IDs must not contain path separators.
 *
 * Both files are required.  `validateRulesPack` runs over the merged object so
 * all existing invariants (source xor identity, per-record provenance match,
 * per-kind shape checks) are enforced on every load.
 *
 * Release archives include this package's `data/` directory alongside `dist/`
 * so bundled seed packs are pre-populated for the CLI. The package manifest
 * also keeps `data/` in `files` for private/internal package artifacts.
 *
 * ## Loader guarantee
 *
 * Given identical files on disk, `loadRulesPackFromDirectory` always returns a
 * value that is deeply equal (same `packId`, same records in the same order,
 * same field values).  Stability is achieved by:
 *   1. Sorting records by `key` (lexicographic, UTF-16 code unit order) after
 *      parsing, before returning.
 *   2. `JSON.parse` preserves object-property insertion order in the supported
 *      Node 24 runtime, so per-field order within a record is stable across
 *      runs.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RulesPack } from './types.js';
import { RulesPackError } from './types.js';
import { validateRulesPack } from './validate.js';

/** File names inside a generated pack directory. */
export const PACK_MANIFEST_FILE = 'manifest.json';
export const PACK_RECORDS_FILE = 'records.json';

/**
 * Load a generated rules pack from `dir`.
 *
 * `dir` must contain `manifest.json` (pack metadata) and `records.json`
 * (array of records).  Both files are parsed and merged, then passed through
 * `validateRulesPack`, which enforces all pack-level and record-level
 * invariants.  Records are sorted by `key` for deterministic output.
 *
 * Throws `RulesPackError` if either file is missing, unparseable, or fails
 * validation.
 */
export function loadRulesPackFromDirectory(dir: string): RulesPack {
  const manifestPath = join(dir, PACK_MANIFEST_FILE);
  const recordsPath = join(dir, PACK_RECORDS_FILE);

  let manifestJson: string;
  try {
    manifestJson = readFileSync(manifestPath, 'utf8');
  } catch (cause) {
    throw new RulesPackError(
      `rules pack manifest not found at ${manifestPath}: ${(cause as Error).message}`,
    );
  }

  let recordsJson: string;
  try {
    recordsJson = readFileSync(recordsPath, 'utf8');
  } catch (cause) {
    throw new RulesPackError(
      `rules pack records not found at ${recordsPath}: ${(cause as Error).message}`,
    );
  }

  let meta: unknown;
  try {
    meta = JSON.parse(manifestJson);
  } catch (cause) {
    throw new RulesPackError(
      `rules pack manifest at ${manifestPath} is not valid JSON: ${(cause as Error).message}`,
    );
  }

  let rawRecords: unknown;
  try {
    rawRecords = JSON.parse(recordsJson);
  } catch (cause) {
    throw new RulesPackError(
      `rules pack records at ${recordsPath} are not valid JSON: ${(cause as Error).message}`,
    );
  }

  // Sort records by key for deterministic output before validation so that
  // error messages from validateRulesPack reference indices in the final
  // (sorted) order.
  if (Array.isArray(rawRecords)) {
    rawRecords = [...rawRecords].sort((a, b) => {
      const ka =
        typeof a === 'object' && a !== null
          ? (a as Record<string, unknown>).key
          : undefined;
      const kb =
        typeof b === 'object' && b !== null
          ? (b as Record<string, unknown>).key
          : undefined;
      if (typeof ka === 'string' && typeof kb === 'string') {
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      }
      return 0;
    });
  }

  return validateRulesPack({ meta, records: rawRecords });
}
