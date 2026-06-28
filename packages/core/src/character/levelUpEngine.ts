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
 * The kinds of required level-up choice this engine can detect but not yet
 * resolve. Each blocks a level-up until the structured required-choice layer
 * (eshyra-lupf.9) collects and applies the player's decision.
 */
export type LevelUpRequiredChoiceKind =
  | 'subclass'
  | 'ability-score-improvement'
  | 'fighting-style'
  | 'expertise'
  | 'class-feature-choice'
  | 'spell-selection';

/** A required level-up decision the engine surfaces instead of guessing. */
export interface LevelUpRequiredChoice {
  readonly kind: LevelUpRequiredChoiceKind;
  /** Human-readable explanation of what must be decided. */
  readonly reason: string;
  /** The pack feature ref that triggered this choice, when applicable. */
  readonly featureRef?: string;
}

/**
 * Raised by {@link applyLevelUp} when the target level carries one or more
 * decisions the engine cannot make deterministically (a subclass, an Ability
 * Score Improvement / feat, a fighting style, expertise, or new spells to
 * learn/prepare). The design requires these to fail closed — block with an
 * explicit reason rather than advance the sheet with the choice unmade. The
 * structured collection/apply of these choices is eshyra-lupf.9.
 */
export class LevelUpRequiredChoicesError extends Error {
  readonly requiredChoices: readonly LevelUpRequiredChoice[];
  constructor(requiredChoices: readonly LevelUpRequiredChoice[]) {
    super(
      `level-up blocked: ${requiredChoices.length} unresolved required ` +
        `choice(s) (${requiredChoices.map((c) => c.kind).join(', ')}); ` +
        'these are not yet supported (eshyra-lupf.9)',
    );
    this.name = 'LevelUpRequiredChoicesError';
    this.requiredChoices = requiredChoices;
  }
}

/**
 * Subclass-selection features by their pack feature-ref suffix (the segment
 * after the last `:`), keyed per the frozen SRD class records. Reaching the
 * level that grants one of these requires the player to choose a subclass —
 * Arcane Tradition, Martial Archetype, Divine Domain, and so on.
 */
const SUBCLASS_FEATURE_SUFFIXES: ReadonlySet<string> = new Set([
  'primal-path',
  'bard-college',
  'divine-domain',
  'druid-circle',
  'martial-archetype',
  'monastic-tradition',
  'sacred-oath',
  'ranger-archetype',
  'roguish-archetype',
  'sorcerous-origin',
  'otherworldly-patron',
  'arcane-tradition',
]);

/** Other choice-bearing class features that require a player pick. */
const CLASS_FEATURE_CHOICE_SUFFIXES: ReadonlySet<string> = new Set([
  'eldritch-invocations',
  'pact-boon',
  'metamagic',
]);

/** Classify a feature-ref suffix as a required-choice kind, or `undefined`. */
function featureChoiceKind(
  suffix: string,
): LevelUpRequiredChoiceKind | undefined {
  if (suffix === 'ability-score-improvement') {
    return 'ability-score-improvement';
  }
  if (suffix === 'fighting-style') {
    return 'fighting-style';
  }
  if (suffix === 'expertise') {
    return 'expertise';
  }
  if (SUBCLASS_FEATURE_SUFFIXES.has(suffix)) {
    return 'subclass';
  }
  if (CLASS_FEATURE_CHOICE_SUFFIXES.has(suffix)) {
    return 'class-feature-choice';
  }
  return undefined;
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
  // Validate the ledger-required audit fields up front, before any write, so a
  // missing one fails fast rather than after the sheet has been saved (the
  // SQLite store shares this connection's transaction, but the store type does
  // not prove that, so we do not rely on rollback to undo a partial apply).
  requireNonEmpty('source', input.source);
  requireNonEmpty('provenance', input.provenance);
  requireNonEmpty('sessionId', input.sessionId);
  requireNonEmpty('at', input.at);

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

    // Fail closed on unresolved required choices (subclass, ASI/feat, spells,
    // …): advance nothing until eshyra-lupf.9 can collect and apply them.
    const requiredChoices = detectLevelUpRequiredChoices(
      sheet,
      resolver,
      binding,
    );
    if (requiredChoices.length > 0) {
      throw new LevelUpRequiredChoicesError(requiredChoices);
    }

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
 * Detect the required choices a single level-up step would impose but that the
 * engine cannot yet resolve deterministically — the fail-closed boundary the
 * progression design mandates. Read-only and pure over the sheet + resolved
 * pack; the guided flow (eshyra-lupf.10) calls this to preview blockers, and
 * {@link applyLevelUp} refuses to advance while any remain.
 *
 * Conservative by intent for now: it flags known generic choice signals on the
 * target level — subclass-selection features, Ability Score Improvement / feat
 * rows, fighting-style and expertise picks, other class-feature choices, and
 * any new spell to learn/prepare (a caster gaining cantrips/known spells, a new
 * spell level, or a Wizard's per-level spellbook growth). The structured
 * descriptors and accepted choice inputs that will *replace* this block are
 * eshyra-lupf.9.
 *
 * @throws {LevelUpEngineError} when the pack has no class/progression row for
 *   the target level (same fail-closed condition as {@link computeLevelUpChangeSet}).
 */
export function detectLevelUpRequiredChoices(
  sheet: CharacterSheet,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
  binding: CampaignRulesBinding = DEFAULT_DND5E_SRD_BINDING,
): readonly LevelUpRequiredChoice[] {
  assertSheetMatchesPack(sheet, binding);

  const classKey = sheet.class.key;
  const toLevel = sheet.level + 1;
  const toRowResult = resolver.resolveClassLevel(classKey, toLevel);
  if (!toRowResult.ok) {
    throw new LevelUpEngineError(
      `cannot resolve level ${toLevel} of '${classKey}': ${toRowResult.message}`,
    );
  }
  const toRow = toRowResult.record;
  const fromRowResult = resolver.resolveClassLevel(classKey, sheet.level);
  const fromRow = fromRowResult.ok ? fromRowResult.record : undefined;

  const choices: LevelUpRequiredChoice[] = [];

  for (const featureRef of toRow.featureRefs) {
    const suffix = featureRef.slice(featureRef.lastIndexOf(':') + 1);
    const kind = featureChoiceKind(suffix);
    if (kind !== undefined) {
      choices.push({
        kind,
        featureRef,
        reason: `level ${toLevel} grants '${featureRef}', which requires a player choice`,
      });
    }
  }

  choices.push(
    ...spellSelectionChoices(
      classKey,
      fromRow?.spellcasting,
      toRow.spellcasting,
      toLevel,
    ),
  );

  return choices;
}

/**
 * Spell-learning choices implied by the target level for a casting class: a new
 * cantrip, a new known spell, access to a new spell level, or a Wizard's
 * per-level spellbook additions. Empty for non-casters and for rows that add no
 * new learnable/preparable spells.
 */
function spellSelectionChoices(
  classKey: string,
  fromSpellcasting: ResolvedLevelSpellcasting | undefined,
  toSpellcasting: ResolvedLevelSpellcasting | undefined,
  toLevel: number,
): readonly LevelUpRequiredChoice[] {
  const spellcasting = getClassSpellcasting(classKey);
  if (spellcasting === undefined || toSpellcasting === undefined) {
    return [];
  }
  const reasons: string[] = [];
  if (
    (toSpellcasting.cantripsKnown ?? 0) > (fromSpellcasting?.cantripsKnown ?? 0)
  ) {
    reasons.push('a new cantrip is learned');
  }
  if (
    (toSpellcasting.spellsKnown ?? 0) > (fromSpellcasting?.spellsKnown ?? 0)
  ) {
    reasons.push('a new spell is learned');
  }
  if (gainsNewSpellLevel(fromSpellcasting?.slots, toSpellcasting.slots)) {
    reasons.push('a new spell level becomes available');
  }
  // The Wizard adds spells to its spellbook every level (the overlay marks the
  // class by its starting-spellbook size); that is a per-level learning choice
  // even when the cantrip/known counts are unchanged.
  if (spellcasting.spellbookStartingSpells !== undefined) {
    reasons.push('spells are added to the spellbook');
  }
  if (reasons.length === 0) {
    return [];
  }
  return [
    {
      kind: 'spell-selection',
      reason: `level ${toLevel} spellcasting: ${reasons.join('; ')}`,
    },
  ];
}

/** Whether `to` grants a spell-slot level that `from` did not have. */
function gainsNewSpellLevel(
  from: Readonly<Record<string, number>> | undefined,
  to: Readonly<Record<string, number>> | undefined,
): boolean {
  if (to === undefined) {
    return false;
  }
  const had = new Set(Object.keys(from ?? {}));
  return Object.keys(to).some((level) => !had.has(level));
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

function requireNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LevelUpEngineError(`level-up ${field} is required`);
  }
}
