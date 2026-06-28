// Level-up eligibility detection (eshyra-lupf.7). Design:
// docs/design/character-progression.md.
//
// A pure, read-only computation over a character's progression state, the
// campaign advancement policy, and (in milestone mode) the progression-event
// ledger. It answers "may this character level up, and to what target level?"
// without mutating or applying anything — it drives prompts and the guided flow
// (eshyra-lupf.10/.11). Applying a level-up is a separate deterministic step
// (eshyra-lupf.8); each level between current and target is applied as its own
// step, so multi-level catch-up is reported here but never collapsed.
//
// The two modes:
//   - XP: compare current XP against the resolved threshold table to find the
//     highest level the character now qualifies for. Eligible when that exceeds
//     the current level (possibly by several levels at once).
//   - Milestone: an outstanding milestone award (a `milestone-award` ledger row
//     not yet consumed by a `level-up` row) confers one pending level. Multiple
//     unconsumed milestones stack into multi-level catch-up.
//
// Layering: state -> rules (reads `levelForXp` from `rules/advancementTable.ts`
// via the already-resolved policy table); the pure helpers below know nothing
// about the database.

import type { Db } from '../persistence/db.js';
import { levelForXp } from '../rules/advancementTable.js';
import {
  type AdvancementPolicy,
  resolveCampaignAdvancementPolicy,
} from './advancementPolicy.js';
import {
  type AdvancementMode,
  getProgressionState,
  listProgressionEvents,
  type ProgressionState,
} from './progression.js';

/**
 * The resolved eligibility verdict. Flat by design so callers (CLI, guided
 * flow) can branch on `eligible` and read `pendingLevels` without unpacking a
 * union. Invariants:
 *   - `targetLevel >= currentLevel`.
 *   - `pendingLevels === targetLevel - currentLevel` and is `>= 0`.
 *   - `eligible === pendingLevels > 0`; when not eligible, `targetLevel ===
 *     currentLevel` and `pendingLevels === 0`.
 */
export interface LevelUpEligibility {
  readonly mode: AdvancementMode;
  readonly currentLevel: number;
  /** Highest level the character may advance to right now. */
  readonly targetLevel: number;
  /** Levels available to gain (`targetLevel - currentLevel`), each applied as its own step. */
  readonly pendingLevels: number;
  readonly eligible: boolean;
}

/**
 * XP-mode eligibility, pure over its inputs. The highest qualified level is read
 * from the resolved threshold table (`levelForXp`, which clamps to the table's
 * tabulated range), so the character can never be reported eligible past the
 * table's maximum level.
 */
export function computeXpEligibility(
  policy: Extract<AdvancementPolicy, { mode: 'xp' }>,
  currentLevel: number,
  currentXp: number,
): LevelUpEligibility {
  const qualified = levelForXp(policy.table, currentXp);
  const targetLevel = Math.max(currentLevel, qualified);
  return verdict('xp', currentLevel, targetLevel);
}

/**
 * Milestone-mode eligibility, pure over its inputs. `outstandingMilestones` is
 * the number of granted milestones not yet consumed by an applied level-up; each
 * confers one pending level.
 */
export function computeMilestoneEligibility(
  currentLevel: number,
  outstandingMilestones: number,
): LevelUpEligibility {
  const pending = Math.max(0, outstandingMilestones);
  return verdict('milestone', currentLevel, currentLevel + pending);
}

/**
 * Detect whether a character is eligible to level up under the campaign's
 * advancement policy. Read-only: resolves the policy and progression state, and
 * in milestone mode reads the ledger to count outstanding milestones. Resolves
 * the active character when `characterId` is omitted.
 *
 * @throws {ProgressionError} via {@link resolveCampaignAdvancementPolicy} when an
 *   XP-mode campaign's bound pack ships no advancement table (fail-closed), or
 *   via {@link getProgressionState} when the character row is missing.
 */
export function getLevelUpEligibility(
  db: Db,
  characterId?: string,
): LevelUpEligibility {
  const policy = resolveCampaignAdvancementPolicy(db);
  const state: ProgressionState = getProgressionState(db, characterId);
  if (policy.mode === 'xp') {
    return computeXpEligibility(policy, state.level, state.currentXp);
  }
  return computeMilestoneEligibility(
    state.level,
    countOutstandingMilestones(db, state.characterId),
  );
}

/**
 * Outstanding milestones for a character: granted `milestone-award` events minus
 * the `level-up` events that have consumed them. The ledger is the audit spine,
 * so eligibility is derived from it rather than from a separate mutable counter.
 */
export function countOutstandingMilestones(
  db: Db,
  characterId?: string,
): number {
  let granted = 0;
  let consumed = 0;
  for (const event of listProgressionEvents(db, characterId)) {
    if (event.kind === 'milestone-award') {
      granted += 1;
    } else if (event.kind === 'level-up') {
      consumed += 1;
    }
  }
  return Math.max(0, granted - consumed);
}

function verdict(
  mode: AdvancementMode,
  currentLevel: number,
  targetLevel: number,
): LevelUpEligibility {
  const pendingLevels = Math.max(0, targetLevel - currentLevel);
  return {
    mode,
    currentLevel,
    targetLevel: currentLevel + pendingLevels,
    pendingLevels,
    eligible: pendingLevels > 0,
  };
}
