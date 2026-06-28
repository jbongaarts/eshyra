// Deterministic level-up application engine (eshyra-lupf.8). Design:
// docs/design/character-progression.md.
//
// Applies a SINGLE level-up step to the core-owned, rules-pack-bound character
// sheet (ADR 0011), computing every mechanical delta from the generated rules
// pack rather than improvising. One call advances the character exactly one
// level; multi-level catch-up (eshyra-lupf.7) is the caller looping one step at
// a time, each applied and audited on its own.
//
// What it derives from the pack's class progression row (eshyra-lupf.3's
// generalized resolver) for the target level:
//   - proficiency bonus,
//   - class features granted at that level (by ref),
//   - spellcasting capacity (cantrips/spells-known counts, spell slots).
// And from the class hit die + the sheet's Constitution modifier:
//   - the HP increase, using the SRD fixed-average method (the deterministic,
//     no-roll policy: floor(hitDie/2)+1 per level + CON modifier, minimum 1).
//     The rolled alternative would have to flow through the seeded dice path to
//     stay auditable; that is deferred until a recipe selects it.
//
// The whole step is one transaction: the updated sheet is saved, the live
// `character` projection (level, hp_max, hp_current) is mutated through the
// validated provenance seam, and a `level-up` ledger row carrying the full
// change set is appended for replay/audit. The acting pack is verified against
// the sheet's binding first (assertSheetMatchesPack) and the step fails closed
// on mismatch — progression is never applied from a different pack than the one
// the sheet was built under.

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import {
  type CampaignRulesBinding,
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { resolveCharacterId } from '../state/activeCharacter.js';
import { mutateState } from '../state/mutateState.js';
import {
  type ProgressionEventRecord,
  recordProgressionEvent,
} from '../state/progression.js';
import {
  assertSheetMatchesPack,
  type CharacterSheetStore,
} from './characterSheetStore.js';
import type { CharacterSheet } from './finalizeCharacter.js';
import {
  getBundledDnd5eCharacterResolver,
  type ResolvedLevelSpellcasting,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';
import { getClassSpellcasting } from './srdClassSpellcasting.js';

/** A before/after pair for a single scalar value changed by a level-up. */
export interface LevelUpDelta<T> {
  readonly from: T;
  readonly to: T;
}

/** How the HP increase was determined for one level-up step. */
export interface LevelUpHitPoints {
  /**
   * The HP method used. Only `fixed-average` is supported today — the
   * deterministic, no-roll SRD "take the average" rule. A `rolled` method is
   * deferred until it can flow through the seeded dice path.
   */
  readonly method: 'fixed-average';
  readonly hitDie: number;
  readonly constitutionModifier: number;
  /** HP gained this level: max(1, floor(hitDie/2)+1 + CON modifier). */
  readonly increment: number;
  readonly maxHitPoints: LevelUpDelta<number>;
}

/**
 * The deterministic change set applied by a single level-up step — everything
 * the rules pack and the sheet imply for advancing one level, with enough
 * before/after detail to audit or replay. Persisted opaquely as the ledger
 * event's `appliedChanges`.
 */
export interface LevelUpChangeSet {
  readonly classKey: string;
  readonly level: LevelUpDelta<number>;
  readonly proficiencyBonus: LevelUpDelta<number>;
  readonly hitPoints: LevelUpHitPoints;
  /** Class feature refs granted at the new level (e.g. `feature:fighter:action-surge`). */
  readonly featuresGained: readonly string[];
  /**
   * Spellcasting capacity at the new level (cantrips/spells-known counts, spell
   * slots), present only for a class whose target-level progression row carries
   * spellcasting. Specific spell selections remain required choices
   * (eshyra-lupf.9), not automatic effects.
   */
  readonly spellcasting?: ResolvedLevelSpellcasting;
  /** Recomputed spell save DC, when the class casts (proficiency bonus feeds it). */
  readonly spellSaveDc?: LevelUpDelta<number | undefined>;
  /** Recomputed spell attack modifier, under the same condition as {@link spellSaveDc}. */
  readonly spellAttackModifier?: LevelUpDelta<number | undefined>;
}

/** Result of {@link applyLevelUp}: the updated sheet, change set, and ledger row. */
export interface ApplyLevelUpResult {
  readonly characterId: string;
  readonly changeSet: LevelUpChangeSet;
  readonly sheet: CharacterSheet;
  readonly event: ProgressionEventRecord;
}

/** Inputs to {@link applyLevelUp}. */
export interface ApplyLevelUpInput {
  /** The sheet store to read the authoritative sheet from and write it back to. */
  readonly store: CharacterSheetStore;
  /** Resolves the active live character when omitted. */
  readonly characterId?: string;
  /** Defaults to the bundled SRD resolver; the pack guard enforces correctness. */
  readonly resolver?: RulesPackCharacterResolver;
  /** Narrative cause recorded on the ledger row (guided flow, manual, …). */
  readonly source: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export class LevelUpEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LevelUpEngineError';
  }
}

/**
 * Apply one deterministic level-up step to a character's sheet and live state,
 * appending a `level-up` ledger row for the change set. Advances the character
 * exactly one level (current → current + 1).
 *
 * @throws {LevelUpEngineError} when no sheet is stored for the character, or the
 *   pack has no progression/class row for the target level (e.g. past the
 *   tabulated maximum) — a fail-closed defect, never a silent no-op.
 * @throws {CharacterSheetPackMismatchError} when the acting pack does not match
 *   the sheet's binding.
 */
export function applyLevelUp(
  db: Db,
  input: ApplyLevelUpInput,
): ApplyLevelUpResult {
  const resolver = input.resolver ?? getBundledDnd5eCharacterResolver();
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;

  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(txnDb, input.characterId);
    const sheet = input.store.load(characterId);
    if (sheet === undefined) {
      throw new LevelUpEngineError(
        `no character sheet stored for '${characterId}'`,
      );
    }
    // Fail closed before any computation if the sheet is not this pack's.
    assertSheetMatchesPack(sheet, binding);

    const changeSet = computeLevelUpChangeSet(sheet, resolver, binding);
    const updatedSheet = applyChangeSetToSheet(sheet, changeSet);

    input.store.save(characterId, updatedSheet);
    projectToLiveCharacter(txnDb, characterId, changeSet, input);
    const event = recordProgressionEvent(txnDb, {
      characterId,
      kind: 'level-up',
      source: input.source,
      resultingLevel: changeSet.level.to,
      appliedChanges: changeSet,
      occurredAt: input.at,
      provenance: input.provenance,
      sessionId: input.sessionId,
    });

    return { characterId, changeSet, sheet: updatedSheet, event };
  });
}

/**
 * Compute the deterministic change set for advancing `sheet` one level. Pure
 * over the sheet + resolved pack; performs no I/O. Exposed for previewing a
 * level-up (the guided flow shows the change set before committing).
 *
 * @throws {LevelUpEngineError} when the pack has no class or progression row for
 *   the target level.
 */
export function computeLevelUpChangeSet(
  sheet: CharacterSheet,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
  binding: CampaignRulesBinding = DEFAULT_DND5E_SRD_BINDING,
): LevelUpChangeSet {
  assertSheetMatchesPack(sheet, binding);

  const fromLevel = sheet.level;
  const toLevel = fromLevel + 1;
  const classKey = sheet.class.key;

  const classResult = resolver.resolveClass(classKey);
  if (!classResult.ok) {
    throw new LevelUpEngineError(
      `cannot resolve class '${classKey}' for level-up: ${classResult.message}`,
    );
  }
  const rowResult = resolver.resolveClassLevel(classKey, toLevel);
  if (!rowResult.ok) {
    throw new LevelUpEngineError(
      `cannot resolve level ${toLevel} of '${classKey}': ${rowResult.message}`,
    );
  }
  const row = rowResult.record;

  const hitDie = classResult.record.hitDie;
  const constitutionModifier = sheet.abilityScores.constitution.modifier;
  const increment = hitPointIncrement(hitDie, constitutionModifier);

  const changeSet: LevelUpChangeSet = {
    classKey,
    level: { from: fromLevel, to: toLevel },
    proficiencyBonus: {
      from: sheet.proficiencyBonus,
      to: row.proficiencyBonus,
    },
    hitPoints: {
      method: 'fixed-average',
      hitDie,
      constitutionModifier,
      increment,
      maxHitPoints: {
        from: sheet.maxHitPoints,
        to: sheet.maxHitPoints + increment,
      },
    },
    featuresGained: row.featureRefs,
    ...spellcastingChanges(sheet, classKey, row, row.proficiencyBonus),
  };
  return changeSet;
}

/**
 * The HP gained for one level by the SRD fixed-average method:
 * `floor(hitDie / 2) + 1` (the per-class average: d6→4, d8→5, d10→6, d12→7)
 * plus the Constitution modifier, with the SRD floor of at least 1 HP per level.
 */
function hitPointIncrement(
  hitDie: number,
  constitutionModifier: number,
): number {
  const average = Math.floor(hitDie / 2) + 1;
  return Math.max(1, average + constitutionModifier);
}

/**
 * Spellcasting fields of the change set: the new capacity row plus, when the
 * class has a spellcasting ability, the recomputed spell save DC / attack
 * modifier (both depend on the proficiency bonus, which the level-up changes).
 * A half-caster (Paladin/Ranger) reaching level 2 turns these on for the first
 * time, so the `from` side may be `undefined`.
 */
function spellcastingChanges(
  sheet: CharacterSheet,
  classKey: string,
  row: { readonly spellcasting?: ResolvedLevelSpellcasting },
  newProficiencyBonus: number,
): Pick<
  LevelUpChangeSet,
  'spellcasting' | 'spellSaveDc' | 'spellAttackModifier'
> {
  if (row.spellcasting === undefined) {
    return {};
  }
  const ability = getClassSpellcasting(classKey)?.ability;
  if (ability === undefined) {
    // Capacity exists in the row but the class has no modeled ability: report
    // the slots/known counts, but do not invent a DC.
    return { spellcasting: row.spellcasting };
  }
  const abilityModifier = sheet.abilityScores[ability].modifier;
  return {
    spellcasting: row.spellcasting,
    spellSaveDc: {
      from: sheet.spellSaveDc,
      to: 8 + newProficiencyBonus + abilityModifier,
    },
    spellAttackModifier: {
      from: sheet.spellAttackModifier,
      to: newProficiencyBonus + abilityModifier,
    },
  };
}

/** Build the updated sheet from the change set (immutably). */
function applyChangeSetToSheet(
  sheet: CharacterSheet,
  changeSet: LevelUpChangeSet,
): CharacterSheet {
  const next: CharacterSheet = {
    ...sheet,
    level: changeSet.level.to,
    proficiencyBonus: changeSet.proficiencyBonus.to,
    maxHitPoints: changeSet.hitPoints.maxHitPoints.to,
    ...(changeSet.spellSaveDc?.to !== undefined
      ? { spellSaveDc: changeSet.spellSaveDc.to }
      : {}),
    ...(changeSet.spellAttackModifier?.to !== undefined
      ? { spellAttackModifier: changeSet.spellAttackModifier.to }
      : {}),
  };
  return next;
}

/**
 * Project the level-up onto the live `character` row (the per-turn store): bump
 * level and hp_max, and raise hp_current by the same increment so the new hit
 * points are immediately available. Routed through the validated mutateState
 * provenance seam so every field carries audit metadata.
 */
function projectToLiveCharacter(
  db: Db,
  characterId: string,
  changeSet: LevelUpChangeSet,
  input: ApplyLevelUpInput,
): void {
  const row = db
    .prepare('SELECT hp_current FROM character WHERE id = ?')
    .get(characterId) as { hp_current: number } | undefined;

  const ctx = {
    provenance: input.provenance,
    sessionId: input.sessionId,
    at: input.at,
  };
  mutateState(db, {
    target: 'character',
    id: characterId,
    field: 'level',
    op: 'set',
    value: changeSet.level.to,
    ...ctx,
  });
  mutateState(db, {
    target: 'character',
    id: characterId,
    field: 'hp_max',
    op: 'set',
    value: changeSet.hitPoints.maxHitPoints.to,
    ...ctx,
  });
  if (row !== undefined) {
    mutateState(db, {
      target: 'character',
      id: characterId,
      field: 'hp_current',
      op: 'set',
      value: row.hp_current + changeSet.hitPoints.increment,
      ...ctx,
    });
  }
}
