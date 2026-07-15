import type { Db } from '../persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { getBundledDnd5eSrdPack } from '../rules/bundledSrdPack.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../rules/pathfinder2eRemaster.js';
import { resolveRulesStack } from '../rules/stack.js';
import type { RulesRecord, RulesRecordKind } from '../rules/types.js';

/**
 * Look up a record in the campaign's resolved rules stack (same binding
 * resolution `start_encounter` uses for creature statlines). Shared by the
 * state modules that derive mechanics from records (F2 action economy, F5
 * usage counters/attunement) so they cannot drift on binding resolution.
 */
export function lookupCampaignRecord(
  db: Db,
  kind: RulesRecordKind,
  ref: string,
): RulesRecord | undefined {
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;
  const base =
    [getBundledDnd5eSrdPack(), PATHFINDER2E_REMASTER_RULES_PACK].find(
      (candidate) => candidate.meta.packId === binding.base.packId,
    ) ?? getBundledDnd5eSrdPack();
  const stack = resolveRulesStack({ base });
  const result = ref.includes(':')
    ? lookupRulesRecord(stack, { kind, ref })
    : lookupRulesRecord(stack, { kind, name: ref });
  return result.ok ? result.record : undefined;
}

/** Strict binding lookup for model-facing tools: an unsupported/missing active
 * base must not silently fall back to D&D and produce the wrong spell. */
export function lookupStrictCampaignRecord(
  db: Db,
  kind: RulesRecordKind,
  ref: string,
): RulesRecord | undefined {
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;
  const base = [
    getBundledDnd5eSrdPack(),
    PATHFINDER2E_REMASTER_RULES_PACK,
  ].find((candidate) => candidate.meta.packId === binding.base.packId);
  if (base === undefined) return undefined;
  const stack = resolveRulesStack({ base });
  const result = ref.includes(':')
    ? lookupRulesRecord(stack, { kind, ref })
    : lookupRulesRecord(stack, { kind, name: ref });
  return result.ok ? result.record : undefined;
}
