// Campaign advancement policy: the resolved, ready-to-consume combination of a
// campaign's advancement *mode* (xp vs milestone) and — in XP mode — the XP
// threshold table from the rules pack (eshyra-lupf.4). Design:
// docs/design/character-progression.md.
//
// The mode is persisted at campaign scope (`campaign_progression_policy`, from
// eshyra-lupf.2). This module layers the rules-pack binding on top: it reads the
// persisted mode (applying a documented default when unset) and, in XP mode,
// resolves the Character Advancement table so eligibility (.7), award (.6), and
// the level-up engine (.8) get one object carrying everything they need.
//
// Layering: state -> rules (this module reads the pack-table resolver in
// `rules/advancementTable.ts`); the pure table resolver itself knows nothing
// about the database.

import type { Db } from '../persistence/db.js';
import {
  getBundledAdvancementTable,
  type ResolvedAdvancementTable,
  resolveAdvancementTable,
} from '../rules/advancementTable.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import {
  type AdvancementMode,
  ProgressionError,
  readCampaignProgressionPolicy,
} from './progression.js';

/**
 * The effective advancement mode when a campaign has not explicitly selected
 * one. XP is the SRD-canonical default: the pack ships the Character Advancement
 * (XP threshold) table, so advancement is deterministic from pack data out of
 * the box. A campaign switches to milestone via
 * {@link writeCampaignProgressionPolicy}.
 */
export const DEFAULT_ADVANCEMENT_MODE: AdvancementMode = 'xp';

/**
 * A resolved, ready-to-consume advancement policy. In milestone mode there is
 * no XP table to carry; in XP mode the resolved threshold table travels with it.
 */
export type AdvancementPolicy =
  | { readonly mode: 'milestone' }
  | { readonly mode: 'xp'; readonly table: ResolvedAdvancementTable };

/**
 * The campaign's effective advancement mode: the persisted selection, or
 * {@link DEFAULT_ADVANCEMENT_MODE} when none has been set.
 */
export function getEffectiveAdvancementMode(db: Db): AdvancementMode {
  return (
    readCampaignProgressionPolicy(db)?.advancementMode ??
    DEFAULT_ADVANCEMENT_MODE
  );
}

/**
 * Build an advancement policy from an explicit mode and rules stack. Pure over
 * its inputs (no database); use this when you already hold a resolved stack
 * (e.g. tests, or a future multi-pack binding resolver).
 *
 * @throws {ProgressionError} in XP mode if the stack has no usable advancement
 *   table — a fail-closed pack/binding defect, not silent degradation.
 */
export function buildAdvancementPolicy(
  mode: AdvancementMode,
  stack: ResolvedRulesStack,
): AdvancementPolicy {
  if (mode === 'milestone') {
    return { mode };
  }
  const resolution = resolveAdvancementTable(stack);
  if (!resolution.ok) {
    throw new ProgressionError(
      `cannot resolve XP advancement table: ${resolution.message}`,
    );
  }
  return { mode, table: resolution.table };
}

/**
 * Resolve the campaign's advancement policy: read the effective mode and, in XP
 * mode, attach the XP threshold table.
 *
 * The XP table is sourced from the bundled SRD pack (the only base pack shipped
 * today); a future multi-pack binding resolver can pass an explicit stack via
 * {@link buildAdvancementPolicy} instead. This reads the persisted mode but not
 * the live rules binding, because pack selection is not yet generalized beyond
 * the bundled SRD.
 */
export function resolveCampaignAdvancementPolicy(db: Db): AdvancementPolicy {
  const mode = getEffectiveAdvancementMode(db);
  if (mode === 'milestone') {
    return { mode };
  }
  return { mode, table: getBundledAdvancementTable() };
}
