// Cross-pack reference validation for an adventure module (eshyra-eh54.3).
//
// `validateAdventureModule` (eshyra-eh54.2) checks shape and *intra-module*
// references. This step resolves the references that point *out* of the module
// into other immutable content layers:
//   - encounter creatures, treasure, and random tables → rules-pack records,
//     addressed by a provider-neutral `rulesRef` of the form `<kind>:<key>`
//     (e.g. `creature:goblin`, `magic-item:amulet-of-health`,
//     `table:wild-magic`) — resolved through the campaign's rules stack, never
//     copied into the module. A `rulesRef` *is* the canonical rules-pack record
//     key: the generated SRD pack and every other in-system cross-reference
//     (`recordsByKey`, spell→table links, lookup candidate keys) address records
//     by the same kind-prefixed `<kind>:<key>` form, so the ref resolves by the
//     whole string. The `<kind>` prefix is also parsed out to assert the ref
//     names the kind the slot expects;
//   - rules requirements → the base system id and add-on pack ids actually
//     present in that stack;
//   - setting compatibility → known campaign-template/setting pack ids (and
//     optionally their location ids), when the caller supplies them.
//
// Fails closed: throws {@link AdventureModuleError} on the first unresolved
// reference. It reads only immutable content (rules stack + setting ids); it
// never reads or requires campaign state (that is eshyra-eh54.4).

import { lookupRulesRecord } from '../rules/lookup.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import type { RulesRecordKind } from '../rules/types.js';
import type { AdventureModule } from './types.js';
import { AdventureModuleError } from './validate.js';

/**
 * The immutable content a module's outward references are resolved against.
 * `rules` is required; setting information is optional and only enforced when
 * supplied ("where applicable" — a module may declare setting compatibility the
 * caller has no loaded setting for yet).
 */
export interface AdventureReferenceContext {
  /** Resolved rules stack the module's `rulesRef`s and requirements resolve against. */
  readonly rules: ResolvedRulesStack;
  /** Known setting/campaign-template pack ids the module may declare compatibility with. */
  readonly settingPackIds?: ReadonlySet<string>;
  /** Per-setting location ids, keyed by setting pack id, to resolve `anchorLocationId`. */
  readonly settingLocationIds?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Parse the leading `<kind>` from a `<kind>:<key>` rules reference; throws on a
 * malformed ref. Only the kind prefix is returned — the full `ref` is the
 * canonical record key used for lookup, so it is never re-split into a bare key.
 */
function rulesRefKind(ref: string, where: string): string {
  const idx = ref.indexOf(':');
  if (idx <= 0 || idx >= ref.length - 1) {
    throw new AdventureModuleError(
      `${where}: malformed rules reference '${ref}' (expected '<kind>:<key>')`,
    );
  }
  return ref.slice(0, idx);
}

/**
 * Resolve a `rulesRef` against the stack, requiring it to name one of
 * `expectedKinds` and to resolve to a real record. The ref encodes its own
 * kind, so a mismatch (e.g. an encounter pointing at `magic-item:…`) is a
 * reference error, not just a not-found. The ref is the canonical record key,
 * so it is looked up whole (`creature:goblin`), not re-split into a bare key.
 */
function assertRulesRef(
  stack: ResolvedRulesStack,
  ref: string,
  where: string,
  expectedKinds: readonly RulesRecordKind[],
): void {
  const kind = rulesRefKind(ref, where);
  if (!(expectedKinds as readonly string[]).includes(kind)) {
    throw new AdventureModuleError(
      `${where}: rules reference '${ref}' must name one of: ${expectedKinds.join(', ')}`,
    );
  }
  const result = lookupRulesRecord(stack, {
    kind: kind as RulesRecordKind,
    ref,
  });
  if (!result.ok) {
    throw new AdventureModuleError(
      `${where}: rules reference '${ref}' does not resolve to a ${kind} in the rules stack`,
    );
  }
}

/**
 * Validate an adventure module's cross-pack references against immutable
 * content. Assumes the module already passed {@link validateAdventureModule};
 * this only resolves outward references. Throws {@link AdventureModuleError} on
 * the first failure.
 */
export function validateAdventureModuleReferences(
  module: AdventureModule,
  context: AdventureReferenceContext,
): void {
  const { rules } = context;

  // Rules requirements must match the stack the module will run against.
  const baseSystemId = rules.base.meta.systemId;
  if (module.rulesRequirements.baseSystemId !== baseSystemId) {
    throw new AdventureModuleError(
      `rulesRequirements.baseSystemId '${module.rulesRequirements.baseSystemId}' does not match the rules stack base system '${baseSystemId}'`,
    );
  }
  // `baseVersions`, when present, constrains acceptable base versions (matching
  // the campaign rules-binding checker).
  const baseVersion = rules.base.meta.version;
  const allowedBaseVersions = module.rulesRequirements.baseVersions;
  if (
    allowedBaseVersions !== undefined &&
    allowedBaseVersions.length > 0 &&
    !allowedBaseVersions.includes(baseVersion)
  ) {
    throw new AdventureModuleError(
      `rulesRequirements.baseVersions does not allow loaded base version '${baseVersion}'`,
    );
  }
  // `requiredAddonPackIds` must be satisfied by loaded *add-on* packs only — the
  // base pack id does not count.
  const addonPackIds = new Set(rules.addons.map((p) => p.meta.packId));
  for (const required of module.rulesRequirements.requiredAddonPackIds ?? []) {
    if (!addonPackIds.has(required)) {
      throw new AdventureModuleError(
        `rulesRequirements.requiredAddonPackIds references missing add-on rules pack '${required}'`,
      );
    }
  }

  // Encounter creatures resolve to creature/stat-block records.
  for (const e of module.encounters) {
    for (let j = 0; j < e.creatures.length; j++) {
      assertRulesRef(
        rules,
        e.creatures[j].rulesRef,
        `encounters[${e.id}].creatures[${j}].rulesRef`,
        ['creature', 'stat-block'],
      );
    }
  }

  // Treasure with a rules reference resolves to a magic-item/equipment record.
  for (const t of module.treasure) {
    if (t.rulesRef !== undefined) {
      assertRulesRef(rules, t.rulesRef, `treasure[${t.id}].rulesRef`, [
        'magic-item',
        'equipment',
      ]);
    }
  }

  // Random tables resolve to rules-pack table records.
  for (const rt of module.randomTables) {
    assertRulesRef(rules, rt.rulesRef, `randomTables[${rt.id}].rulesRef`, [
      'table',
    ]);
  }

  // Setting compatibility — enforced only when the caller supplies the loaded
  // setting universe ("where applicable").
  for (let i = 0; i < module.settingCompatibility.length; i++) {
    const ref = module.settingCompatibility[i];
    if (
      context.settingPackIds !== undefined &&
      !context.settingPackIds.has(ref.settingPackId)
    ) {
      throw new AdventureModuleError(
        `settingCompatibility[${i}].settingPackId '${ref.settingPackId}' is not a known setting/campaign-template pack`,
      );
    }
    if (ref.anchorLocationId !== undefined && context.settingLocationIds) {
      const locationIds = context.settingLocationIds.get(ref.settingPackId);
      if (locationIds !== undefined && !locationIds.has(ref.anchorLocationId)) {
        throw new AdventureModuleError(
          `settingCompatibility[${i}].anchorLocationId '${ref.anchorLocationId}' does not resolve to a location in setting '${ref.settingPackId}'`,
        );
      }
    }
  }
}
