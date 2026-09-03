import type { Db } from '../persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { getBundledDnd5eSrdPack } from '../rules/bundledSrdPack.js';
import { lookupRulesRecord, type RulesLookupHit } from '../rules/lookup.js';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../rules/pathfinder2eRemaster.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import { resolveRulesStack } from '../rules/stack.js';
import type {
  RulesPack,
  RulesRecord,
  RulesRecordKind,
} from '../rules/types.js';
import { markRulesPackContentError } from '../rules/types.js';

export type CampaignRulesPackResolver = (binding: {
  readonly systemId: string;
  readonly packId: string;
  readonly version: string;
}) => RulesPack | undefined;

export class CampaignRulesBindingResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignRulesBindingResolutionError';
    markRulesPackContentError(this);
  }
}

/** Successful exact lookup plus the resolved stack that produced it. */
export type StrictCampaignRecordLookup = RulesLookupHit & {
  readonly stack: ResolvedRulesStack;
};

function bundledRulesPacks(): readonly RulesPack[] {
  return [getBundledDnd5eSrdPack(), PATHFINDER2E_REMASTER_RULES_PACK];
}

function exactPack(
  ref: Parameters<CampaignRulesPackResolver>[0],
  resolver: CampaignRulesPackResolver | undefined,
): RulesPack {
  const pack =
    resolver?.(ref) ??
    bundledRulesPacks().find(
      (candidate) =>
        candidate.meta.systemId === ref.systemId &&
        candidate.meta.packId === ref.packId &&
        candidate.meta.version === ref.version,
    );
  if (pack === undefined) {
    throw new CampaignRulesBindingResolutionError(
      `campaign rules pack '${ref.systemId}' / '${ref.packId}' @ '${ref.version}' is unavailable`,
    );
  }
  if (
    pack.meta.systemId !== ref.systemId ||
    pack.meta.packId !== ref.packId ||
    pack.meta.version !== ref.version
  ) {
    throw new CampaignRulesBindingResolutionError(
      `resolved rules pack does not match binding '${ref.systemId}' / '${ref.packId}' @ '${ref.version}'`,
    );
  }
  return pack;
}

/** Resolve the complete exact campaign binding, including ordered add-ons. */
export function resolveStrictCampaignRulesStack(
  db: Db,
  resolver?: CampaignRulesPackResolver,
): ResolvedRulesStack {
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;
  const base = exactPack(binding.base, resolver);
  const addons = binding.addons.map((addon) => exactPack(addon, resolver));
  return resolveRulesStack({ base, addons });
}

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
  resolver?: CampaignRulesPackResolver,
): RulesRecord | undefined {
  const stack = resolveStrictCampaignRulesStack(db, resolver);
  const result = ref.includes(':')
    ? lookupRulesRecord(stack, { kind, ref })
    : lookupRulesRecord(stack, { kind, name: ref });
  return result.ok ? result.record : undefined;
}

/**
 * Strict binding lookup for model-facing tools. Preserve both lookup metadata
 * and the exact resolved stack so downstream mechanics and evidence cannot
 * silently fall back to a different rules source.
 */
export function lookupStrictCampaignRecord(
  db: Db,
  kind: RulesRecordKind,
  ref: string,
  resolver?: CampaignRulesPackResolver,
): StrictCampaignRecordLookup | undefined {
  if (!ref.includes(':')) return undefined;
  const stack = resolveStrictCampaignRulesStack(db, resolver);
  const result = lookupRulesRecord(stack, { kind, ref });
  return result.ok ? { ...result, stack } : undefined;
}

/** Compatibility-only name lookup for legacy persisted tool calls. */
export function lookupStrictCampaignRecordByName(
  db: Db,
  kind: RulesRecordKind,
  name: string,
  resolver?: CampaignRulesPackResolver,
): StrictCampaignRecordLookup | undefined {
  const stack = resolveStrictCampaignRulesStack(db, resolver);
  const result = lookupRulesRecord(stack, { kind, name });
  return result.ok ? { ...result, stack } : undefined;
}
