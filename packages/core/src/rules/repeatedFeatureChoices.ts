/**
 * Advancement-level-aware instantiation for repeated SRD feature choices
 * (eshyra-qhac).
 *
 * A class-granted feature is source-correctly modeled once, with its
 * `choices[].level` set to the level its prose first appears at. Class
 * progression can grant the SAME feature again at later levels — Fighter's
 * Ability Score Improvement is one feature record granted at levels 4, 6, 8,
 * 12, 14, 16, and 19 — without reprinting the choice. That is faithful to the
 * source, but a level-up consumer that reads only `choices[].level` would
 * either mis-level every later instance (treat all of them as level-4
 * choices) or only ever surface the first one.
 *
 * The contract this module implements:
 *   - **feature source level** (`choices[].level` as stored on the record)
 *     names where the feature's prose originates.
 *   - **advancement grant level** (a class `progression[].level` whose
 *     `advancement[]` contains a `featureGrant` for this feature) names a
 *     level at which a choice INSTANCE is actually available to the player.
 *
 * `deriveFeatureChoiceInstances` derives one instance per grant level. Some
 * features already print a distinct, correctly-leveled `choices[]` entry per
 * grant level (Warlock's Mystic Arcanum: four entries at levels 11/13/15/17,
 * one per grant) — those are returned as-is, never duplicated. Features with
 * fewer distinct choice levels than grant levels (ASI, Channel Divinity,
 * Expertise, Metamagic, Magical Secrets) are treated as a template anchored
 * at their source level and repeated at every grant level lacking an exact
 * match, with `level` overridden to the grant level on the repeated copies.
 */

import type { FeatureChoice } from './featureChoices.js';
import type { RulesPack, RulesRecord } from './types.js';

/** One instantiation of a feature's choice at a specific advancement level. */
export interface FeatureChoiceInstance {
  readonly featureKey: string;
  readonly choiceId: string;
  /** Where this choice's prose originates (`choices[].level` on the record). */
  readonly sourceLevel: number;
  /** The class advancement row level this instance is available at. */
  readonly grantLevel: number;
  /** The choice, with `level` set to {@link grantLevel}. */
  readonly choice: FeatureChoice;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Every level at which some class's progression grants `featureRef`, sorted
 * ascending and deduplicated. A feature granted once returns a single-element
 * array; the Fighter ASI feature returns `[4, 6, 8, 12, 14, 16, 19]`.
 */
export function featureGrantLevels(
  pack: RulesPack,
  featureRef: string,
): readonly number[] {
  const levels = new Set<number>();
  for (const record of pack.records) {
    if (record.kind !== 'class') continue;
    const data = asObject(record.data);
    const progression = data === null ? null : data.progression;
    if (!Array.isArray(progression)) continue;
    for (const rowValue of progression) {
      const row = asObject(rowValue);
      const level = row === null ? null : row.level;
      if (typeof level !== 'number') continue;
      const advancement = row === null ? null : row.advancement;
      if (!Array.isArray(advancement)) continue;
      for (const entryValue of advancement) {
        const entry = asObject(entryValue);
        if (
          entry !== null &&
          entry.kind === 'featureGrant' &&
          entry.ref === featureRef
        ) {
          levels.add(level);
        }
      }
    }
  }
  return [...levels].sort((a, b) => a - b);
}

function featureChoices(record: RulesRecord): readonly FeatureChoice[] {
  const data = asObject(record.data);
  const choices = data === null ? null : data.choices;
  return Array.isArray(choices) ? (choices as FeatureChoice[]) : [];
}

/**
 * Derive one {@link FeatureChoiceInstance} per (choice, grant level) pair a
 * feature actually needs. Returns `[]` for a feature with no `choices[]` or
 * no class-progression grant (e.g. a non-class-granted record) — there is
 * nothing to instantiate.
 */
export function deriveFeatureChoiceInstances(
  pack: RulesPack,
  featureRecord: RulesRecord,
): readonly FeatureChoiceInstance[] {
  const choices = featureChoices(featureRecord);
  if (choices.length === 0) return [];
  const grantLevels = featureGrantLevels(pack, featureRecord.key);
  if (grantLevels.length === 0) return [];

  const choiceLevels = new Set(choices.map((c) => c.level));
  // Every grant level already has its own correctly-leveled choice entry
  // (Mystic Arcanum) — the source data already satisfies the contract, so
  // instantiate each choice exactly as printed rather than duplicating it.
  if (grantLevels.every((level) => choiceLevels.has(level))) {
    return choices.map((choice) => ({
      featureKey: featureRecord.key,
      choiceId: choice.id,
      sourceLevel: choice.level,
      grantLevel: choice.level,
      choice,
    }));
  }

  const instances: FeatureChoiceInstance[] = [];
  for (const grantLevel of grantLevels) {
    const exact = choices.filter((c) => c.level === grantLevel);
    const template = exact.length > 0 ? exact : choices;
    for (const choice of template) {
      instances.push({
        featureKey: featureRecord.key,
        choiceId: choice.id,
        sourceLevel: choice.level,
        grantLevel,
        choice:
          choice.level === grantLevel
            ? choice
            : { ...choice, level: grantLevel },
      });
    }
  }
  return instances;
}
