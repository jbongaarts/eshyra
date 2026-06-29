/**
 * Shared vocabulary for playable choice modeling on feature records
 * (eshyra-o9bd.9).
 *
 * A class- or subclass-granted feature gained at character creation or level-up
 * may require the player to make a build choice — pick a subclass, a Fighting
 * Style, Metamagic options, a favored enemy, an ability-score-improvement-vs-feat,
 * and so on. The frozen pack carried these as PROSE only (the feature
 * `description`), which a creation/level-up engine cannot apply without guessing.
 *
 * This module is the single source of truth for the structured shape those
 * choices take and the closed category vocabulary. Both the schema validator
 * (`kindSchemas.validateDnd5eFeature`) and the `choice-coverage` audit gate
 * (`srdPlayabilityAudit`) import from here so the generated pack and the gate
 * cannot drift.
 *
 * A `choices[]` entry is EITHER:
 *   - a STRUCTURED choice — a `choose` count plus an optional `from` (a discrete
 *     option list or a free-text restriction); or
 *   - a named OUT-OF-SCOPE marker — `unsupported.reason`, used when a choice is
 *     intentionally not modeled yet so the gap is explicit, never silent.
 *
 * Exactly one of those two shapes is present per entry (enforced by the schema).
 */

/** The closed set of player-choice categories the pack models on features. */
export const FEATURE_CHOICE_CATEGORIES = [
  'subclass',
  'cantrip',
  'spell',
  'asiOrFeat',
  'fightingStyle',
  'metamagic',
  'invocation',
  'favoredEnemy',
  'naturalExplorer',
  'language',
  'skill',
  'expertise',
  'channelDivinity',
  'other',
] as const;

export type FeatureChoiceCategory = (typeof FEATURE_CHOICE_CATEGORIES)[number];

/** A named out-of-scope marker: the choice exists but is not modeled yet. */
export interface FeatureChoiceUnsupported {
  /** Why the choice is out of scope (names the missing model/data). */
  readonly reason: string;
}

/** A single structured player choice carried on a feature record. */
export interface FeatureChoice {
  /** Stable, kebab-case id unique within the feature (e.g. "fighting-style"). */
  readonly id: string;
  readonly category: FeatureChoiceCategory;
  /** Player-facing prompt (verbatim or lightly derived from the SRD text). */
  readonly prompt: string;
  /** Character level at which the choice is made (mirrors the feature level). */
  readonly level: number;
  /** How many options to pick. Present iff this is a structured choice. */
  readonly choose?: number;
  /** Legal options (record keys / labels) or a free-text restriction. */
  readonly from?: readonly string[] | string;
  /** Present iff the choice is intentionally out of scope; names why. */
  readonly unsupported?: FeatureChoiceUnsupported;
}

const CATEGORY_SET: ReadonlySet<string> = new Set(FEATURE_CHOICE_CATEGORIES);

/** Narrowing guard for the closed category vocabulary. */
export function isFeatureChoiceCategory(
  value: string,
): value is FeatureChoiceCategory {
  return CATEGORY_SET.has(value);
}
