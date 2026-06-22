/**
 * Runtime loader for the bundled D&D 5e SRD 5.1 rules pack (ADR 0013).
 *
 * Gameplay resolves rules against the importer-generated SRD pack shipped under
 * `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` — the audited, durable
 * rules product (1811 records: creatures, spells, classes, equipment,
 * magic-items, conditions, features, tables, …), NOT the retired three-record
 * in-code placeholder that predated the importer.
 *
 * The pack is loaded once and cached. The 1811-record parse cost is paid lazily
 * on first lookup, not at module load, so editions that never play (or never
 * look up a rule) do not pay it.
 *
 * The data directory lives two levels above this module in both the TypeScript
 * source tree (`src/rules/` → `data/`) and the compiled output (`dist/rules/` →
 * `data/`), so the relative URL resolves correctly under vitest and from the
 * published package alike. `data/` is listed in `packages/core/package.json`
 * `files`, so it ships in every edition.
 */

import { fileURLToPath } from 'node:url';
import { loadRulesPackFromDirectory } from './packLoader.js';
import type { RulesPack } from './types.js';

/** Canonical pack id for the runtime D&D 5e SRD 5.1 rules pack (ADR 0013). */
export const DND5E_SRD_PACK_ID = 'rules:dnd5e-srd-5.1';

/** Rules-system id shared by the SRD pack and its campaign bindings. */
export const DND5E_SRD_SYSTEM_ID = 'dnd5e-srd';

/** Source version of the bundled SRD pack. */
export const DND5E_SRD_VERSION = '5.1';

/**
 * Retired pre-v1 placeholder pack id. The old in-code `DND5E_SRD_RULES_PACK`
 * shipped under this id; per ADR 0013 it is retired with no compatibility
 * shims, aliases, or migrations. A pre-adoption campaign DB whose binding still
 * names this id fails resolution with a clear, actionable error.
 */
export const RETIRED_DND5E_SRD_PLACEHOLDER_PACK_ID = 'rules:dnd5e-srd';

const PACK_DIR = fileURLToPath(
  new URL('../../data/rules-packs/rules__dnd5e-srd-5.1/', import.meta.url),
);

let cachedPack: RulesPack | undefined;

/**
 * Load the bundled, importer-generated D&D 5e SRD 5.1 rules pack from the
 * packaged data directory. Loaded once and cached (lazily on first use).
 *
 * Throws `RulesPackError` if the bundled pack is missing or fails validation —
 * that is a packaging defect, not a recoverable runtime condition.
 */
export function getBundledDnd5eSrdPack(): RulesPack {
  cachedPack ??= loadRulesPackFromDirectory(PACK_DIR);
  return cachedPack;
}
