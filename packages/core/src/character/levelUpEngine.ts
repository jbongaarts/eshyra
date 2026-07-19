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
//   - the HP increase, using fixed average or immutable caller-supplied rolled
//     evidence, with floor(hitDie/2)+1 and CON modifier for fixed average.
//
// The whole step is one transaction: the updated sheet is saved, the live
// `character` projection (level, hp_max, hp_current) is mutated through the
// validated provenance seam, and a `level-up` ledger row carrying the full
// change set is appended for replay/audit. The acting pack is verified against
// the sheet's binding first (assertSheetMatchesPack) and the step fails closed
// on mismatch — progression is never applied from a different pack than the one
// the sheet was built under.

import {
  type DiceRoll,
  parseDice,
  validateDiceRollEvidence,
} from '../orchestrator/dice.js';
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
import { syncSpellSlots } from '../state/spellSlots.js';
import { abilityModifier, abilityNameFromToken } from './abilities.js';
import { assertSupportedCharacterBuild } from './characterBuild.js';
import {
  assertSheetMatchesPack,
  type CharacterSheetStore,
} from './characterSheetStore.js';
import type { SavingThrowDerived } from './derivedValues.js';
import type { CharacterSheet } from './finalizeCharacter.js';
import {
  getBundledDnd5eCharacterResolver,
  type ResolvedClassData,
  type ResolvedFeatureImprovement,
  type ResolvedLevelSpellcasting,
  type ResolvedSubclassData,
  type ResolvedSubclassFeatureSlot,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';
import { deriveSpellcastingValues } from './spellcastingDerivation.js';

/** A before/after pair for a single scalar value changed by a level-up. */
export interface LevelUpDelta<T> {
  readonly from: T;
  readonly to: T;
}

/** How the HP increase was determined for one level-up step. */
export interface LevelUpHitPoints {
  /**
   * The HP method used. Both fixed average and caller-supplied rolled evidence
   * are persisted for replay and audit.
   */
  readonly method: 'fixed-average' | 'rolled';
  readonly hitDie: number;
  readonly constitutionModifier: number;
  readonly naturalRoll?: number;
  readonly retroactiveConstitutionAdjustment?: number;
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
  /** Player-selected feat refs gained in place of an ASI. */
  readonly featsGained?: readonly string[];
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
  /** Supported level-up choices applied as part of this step. */
  readonly choicesApplied?: readonly LevelUpAppliedChoice[];
  readonly abilityScoreIncreases?: readonly AppliedAbilityScoreIncrease[];
  readonly savingThrows?: Readonly<
    Record<
      import('./creation.js').AbilityScoreName,
      LevelUpDelta<SavingThrowDerived>
    >
  >;
}

export type LevelUpHitPointChoice =
  | { readonly method: 'fixed-average' }
  | { readonly method: 'rolled'; readonly roll: DiceRoll };

export interface AppliedAbilityScoreIncrease {
  readonly ability: import('./creation.js').AbilityScoreName;
  readonly amount: 1 | 2;
  readonly finalScore: LevelUpDelta<number>;
  readonly modifier: LevelUpDelta<number>;
}

/** Result of {@link applyLevelUp}: the updated sheet, change set, and ledger row. */
export interface ApplyLevelUpResult {
  readonly characterId: string;
  readonly changeSet: LevelUpChangeSet;
  readonly sheet: CharacterSheet;
  readonly event: ProgressionEventRecord;
}

export type PreviewLevelUpResult =
  | {
      readonly ok: true;
      readonly requiredChoices: readonly LevelUpRequiredChoice[];
      readonly changeSet: LevelUpChangeSet;
    }
  | {
      readonly ok: false;
      readonly requiredChoices: readonly LevelUpRequiredChoice[];
    };

export interface PreviewLevelUpInput {
  readonly resolver?: RulesPackCharacterResolver;
  readonly binding?: CampaignRulesBinding;
  readonly choices?: LevelUpChoiceSelections;
  readonly hitPointChoice?: LevelUpHitPointChoice;
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
  /**
   * Structured level-up decisions keyed by {@link LevelUpRequiredChoice.id}.
   * Unsupported choices still block even when present.
   */
  readonly choices?: LevelUpChoiceSelections;
  readonly hitPointChoice?: LevelUpHitPointChoice;
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

export type LevelUpRequiredChoiceStatus = 'supported' | 'unsupported';

/** A required level-up decision the engine surfaces instead of guessing. */
export interface LevelUpRequiredChoice {
  /** Stable identifier used as the key in {@link ApplyLevelUpInput.choices}. */
  readonly id: string;
  readonly kind: LevelUpRequiredChoiceKind;
  readonly status: LevelUpRequiredChoiceStatus;
  /** Human-readable prompt. */
  readonly label: string;
  /** Number to choose, when a structured count is known. */
  readonly choose?: number;
  /** The option set, when structured. */
  readonly from?: readonly string[];
  /** Human-readable explanation of what must be decided. */
  readonly reason: string;
  /** The pack feature ref that triggered this choice, when applicable. */
  readonly featureRef?: string;
  /** Why this choice is detected but cannot yet be applied deterministically. */
  readonly unsupportedReason?: string;
}

export type LevelUpChoiceSelections = Readonly<
  Record<string, readonly string[]>
>;

export interface LevelUpAppliedChoice {
  readonly id: string;
  readonly kind: Extract<
    LevelUpRequiredChoiceKind,
    'subclass' | 'ability-score-improvement'
  >;
  readonly value: string;
  readonly label: string;
  readonly featureRefs: readonly string[];
  readonly abilityScoreIncreases?: readonly AppliedAbilityScoreIncrease[];
  readonly featRef?: string;
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
        `choice(s) (${requiredChoices.map((c) => c.id).join(', ')})`,
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
  assertSupportedCharacterBuild(input, { operation: 'level-up apply' });
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
    // F6 lifecycle gate (eshyra-2n1t.8): the projection raises hp_current
    // without going through the adjustHp death machine, so a non-alive
    // character could end up dying/dead at positive HP. Level-ups are a
    // living character's action; fail closed before any write.
    const lifeRow = txnDb
      .prepare('SELECT life_state FROM character WHERE id = ?')
      .get(characterId) as { life_state: string } | undefined;
    if (lifeRow !== undefined && lifeRow.life_state !== 'alive') {
      throw new LevelUpEngineError(
        `cannot apply a level-up to a ${lifeRow.life_state} character: ` +
          'stabilize and heal them first',
      );
    }
    const sheet = input.store.load(characterId);
    if (sheet === undefined) {
      throw new LevelUpEngineError(
        `no character sheet stored for '${characterId}'`,
      );
    }
    assertSupportedCharacterBuild(sheet, {
      operation: 'level-up apply',
      resolver,
    });
    // Fail closed before any computation if the sheet is not this pack's.
    assertSheetMatchesPack(sheet, binding);

    const preview = previewLevelUpChangeSet(sheet, {
      resolver,
      binding,
      choices: input.choices,
      hitPointChoice: input.hitPointChoice,
    });
    if (!preview.ok) {
      throw new LevelUpRequiredChoicesError(preview.requiredChoices);
    }
    const changeSet = preview.changeSet;
    const updatedSheet = applyChangeSetToSheet(
      sheet,
      changeSet,
      changeSet.choicesApplied ?? [],
    );

    input.store.save(characterId, updatedSheet);
    projectToLiveCharacter(txnDb, characterId, changeSet, input);
    // F4 slot state is derived from the newly committed sole-class sheet and
    // its live level projection. Reconcile inside this transaction so prompt
    // context never advertises the pre-level capacity while a later spell cast
    // would lazily allow the increased pool.
    syncSpellSlots(txnDb, {
      characterId,
      resolver,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
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
 * Preview the exact deterministic change set a one-step level-up would commit
 * for this sheet, including supported choice consequences. Unsupported or
 * missing/invalid choices are returned as blockers instead of being guessed.
 */
export function previewLevelUpChangeSet(
  sheet: CharacterSheet,
  input: PreviewLevelUpInput = {},
): PreviewLevelUpResult {
  assertSupportedCharacterBuild(input, { operation: 'level-up preview' });
  const resolver = input.resolver ?? getBundledDnd5eCharacterResolver();
  assertSupportedCharacterBuild(sheet, {
    operation: 'level-up preview',
    resolver,
  });
  const binding = input.binding ?? DEFAULT_DND5E_SRD_BINDING;
  assertSheetMatchesPack(sheet, binding);
  const requiredChoices = detectLevelUpRequiredChoices(
    sheet,
    resolver,
    binding,
  );
  const resolvedChoices = resolveLevelUpChoices(
    requiredChoices,
    input.choices ?? {},
    sheet,
    sheet.level + 1,
    resolver,
  );
  if (resolvedChoices.blockers.length > 0) {
    return { ok: false, requiredChoices: resolvedChoices.blockers };
  }
  const baseChangeSet = computeLevelUpChangeSet(
    sheet,
    resolver,
    binding,
    input.hitPointChoice,
  );
  return {
    ok: true,
    requiredChoices,
    changeSet: recomputeAfterChoices(
      applyResolvedChoicesToChangeSet(baseChangeSet, resolvedChoices.applied),
      sheet,
      resolver,
    ),
  };
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
  hitPointChoice: LevelUpHitPointChoice = { method: 'fixed-average' },
): LevelUpChangeSet {
  assertSupportedCharacterBuild(sheet, {
    operation: 'level-up change-set computation',
    resolver,
  });
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
  const hp = resolveHitPointChoice(
    hitDie,
    constitutionModifier,
    hitPointChoice,
  );

  const existingSubclassFeatureRefs =
    row.subclassFeatureSlots.length > 0
      ? existingSubclassFeatureRefsForLevel(sheet, toLevel, resolver)
      : [];
  const changeSet: LevelUpChangeSet = {
    classKey,
    level: { from: fromLevel, to: toLevel },
    proficiencyBonus: {
      from: sheet.proficiencyBonus,
      to: row.proficiencyBonus,
    },
    hitPoints: {
      method: hp.method,
      hitDie,
      constitutionModifier,
      ...(hp.naturalRoll !== undefined ? { naturalRoll: hp.naturalRoll } : {}),
      increment: hp.increment,
      maxHitPoints: {
        from: sheet.maxHitPoints,
        to: sheet.maxHitPoints + hp.increment,
      },
    },
    featuresGained: [...row.featureRefs, ...existingSubclassFeatureRefs],
    ...spellcastingChanges(
      sheet,
      classResult.record,
      row,
      row.proficiencyBonus,
    ),
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
  assertSupportedCharacterBuild(sheet, {
    operation: 'level-up choice detection',
    resolver,
  });
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
  const classResult = resolver.resolveClass(classKey);
  if (!classResult.ok) {
    throw new LevelUpEngineError(
      `cannot resolve class '${classKey}' for level-up: ${classResult.message}`,
    );
  }

  const choices: LevelUpRequiredChoice[] = [];

  for (const featureRef of toRow.featureRefs) {
    const suffix = featureRef.slice(featureRef.lastIndexOf(':') + 1);
    const kind = featureChoiceKind(suffix);
    if (kind !== undefined) {
      choices.push(
        featureRequiredChoice(kind, featureRef, classKey, toLevel, resolver),
      );
    }
  }

  choices.push(
    ...subclassFeatureSlotChoices(
      toRow.subclassFeatureSlots,
      sheet,
      toLevel,
      resolver,
    ),
    ...featureImprovementChoices(toRow.featureImprovements, toLevel),
  );

  choices.push(
    ...spellSelectionChoices(
      classResult.record,
      fromRow?.spellcasting,
      toRow.spellcasting,
      toLevel,
    ),
  );

  return choices;
}

function subclassFeatureSlotChoices(
  slots: readonly ResolvedSubclassFeatureSlot[],
  sheet: CharacterSheet,
  toLevel: number,
  resolver: RulesPackCharacterResolver,
): readonly LevelUpRequiredChoice[] {
  const choices: LevelUpRequiredChoice[] = [];
  for (const slot of slots) {
    const featureRefs =
      sheet.subclass === undefined
        ? []
        : existingSubclassFeatureRefsForLevel(sheet, toLevel, resolver);
    if (featureRefs.length > 0) {
      continue;
    }
    choices.push({
      id: `level.${toLevel}.subclass-feature.${slug(slot.slotName)}`,
      kind: 'subclass',
      status: 'unsupported',
      label: slot.slotName,
      reason:
        `level ${toLevel} includes subclass slot '${slot.slotName}', ` +
        'but no selected subclass feature can be mapped',
      unsupportedReason:
        'Subclass-feature slots require an existing subclass with structured feature records at the target level.',
    });
  }
  return choices;
}

function featureImprovementChoices(
  improvements: readonly ResolvedFeatureImprovement[],
  toLevel: number,
): readonly LevelUpRequiredChoice[] {
  return improvements.map((improvement) => ({
    id: `level.${toLevel}.feature-improvement.${slug(improvement.label)}`,
    kind: 'class-feature-choice',
    status: 'unsupported',
    label: improvement.label,
    reason:
      `level ${toLevel} improves ${improvement.targetRefs.join(', ')} ` +
      `('${improvement.label}')`,
    unsupportedReason:
      'Feature improvements change an existing feature; deterministic application of the level-specific change is not implemented yet.',
  }));
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function featureRequiredChoice(
  kind: LevelUpRequiredChoiceKind,
  featureRef: string,
  classKey: string,
  toLevel: number,
  resolver: RulesPackCharacterResolver,
): LevelUpRequiredChoice {
  const base = {
    id: `level.${toLevel}.${kind}`,
    kind,
    featureRef,
    reason: `level ${toLevel} grants '${featureRef}', which requires a player choice`,
  } as const;
  if (kind === 'subclass') {
    const subclasses = resolver
      .listSubclasses()
      .filter((subclass) => subclass.parentClass === classKey);
    return {
      ...base,
      status: 'supported',
      label: 'Choose a subclass',
      choose: 1,
      from: subclasses.map((subclass) => subclass.name),
    };
  }
  if (kind === 'ability-score-improvement') {
    return {
      ...base,
      status: 'supported',
      label: 'Increase one ability by 2, or two abilities by 1 each',
      from: [
        'Strength',
        'Dexterity',
        'Constitution',
        'Intelligence',
        'Wisdom',
        'Charisma',
        ...resolver.listFeats().map((feat) => feat.key),
      ],
      reason: `level ${toLevel} grants an Ability Score Improvement`,
    };
  }
  return {
    ...base,
    status: 'unsupported',
    label: levelUpChoiceLabel(kind),
    unsupportedReason: `${levelUpChoiceLabel(kind)} is detected from the rules pack but deterministic application is not implemented yet.`,
  };
}

function levelUpChoiceLabel(kind: LevelUpRequiredChoiceKind): string {
  switch (kind) {
    case 'ability-score-improvement':
      return 'Choose an Ability Score Improvement';
    case 'fighting-style':
      return 'Choose a fighting style';
    case 'expertise':
      return 'Choose expertise proficiencies';
    case 'class-feature-choice':
      return 'Choose class feature options';
    case 'spell-selection':
      return 'Choose spells';
    case 'subclass':
      return 'Choose a subclass';
  }
}

/**
 * Spell-learning choices implied by the target level for a casting class: a new
 * cantrip, a new known spell, access to a new spell level, or a Wizard's
 * per-level spellbook additions. Empty for non-casters and for rows that add no
 * new learnable/preparable spells.
 */
function spellSelectionChoices(
  classRecord: ResolvedClassData,
  fromSpellcasting: ResolvedLevelSpellcasting | undefined,
  toSpellcasting: ResolvedLevelSpellcasting | undefined,
  toLevel: number,
): readonly LevelUpRequiredChoice[] {
  if (
    classRecord.spellcastingAbility === undefined ||
    toSpellcasting === undefined
  ) {
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
  // The Wizard adds spells to its spellbook every level; generated
  // spellPreparation marks that with a starting-spellbook size. This remains a
  // per-level learning choice even when cantrip/known counts are unchanged.
  if (classRecord.spellPreparation?.spellbookStartingSpells !== undefined) {
    reasons.push('spells are added to the spellbook');
  }
  if (reasons.length === 0) {
    return [];
  }
  return [
    {
      id: `level.${toLevel}.spell-selection`,
      kind: 'spell-selection',
      status: 'unsupported',
      label: 'Choose spells for this level',
      reason: `level ${toLevel} spellcasting: ${reasons.join('; ')}`,
      unsupportedReason:
        'Level-up spell selection changes cantrips/spells known, spellbook contents, or preparation state, but deterministic spell application is not implemented yet.',
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

interface ResolvedLevelUpChoices {
  readonly blockers: readonly LevelUpRequiredChoice[];
  readonly applied: readonly LevelUpAppliedChoice[];
}

function resolveLevelUpChoices(
  requiredChoices: readonly LevelUpRequiredChoice[],
  selections: LevelUpChoiceSelections,
  sheet: CharacterSheet,
  targetLevel: number,
  resolver: RulesPackCharacterResolver,
): ResolvedLevelUpChoices {
  const blockers: LevelUpRequiredChoice[] = [];
  const applied: LevelUpAppliedChoice[] = [];
  for (const choice of requiredChoices) {
    if (choice.status === 'unsupported') {
      blockers.push(choice);
      continue;
    }
    const selected = selections[choice.id] ?? [];
    if (
      choice.kind !== 'ability-score-improvement' &&
      selected.length !== (choice.choose ?? 1)
    ) {
      blockers.push(choice);
      continue;
    }
    if (choice.kind === 'subclass') {
      const subclass = resolveSubclassSelection(
        selected[0],
        sheet.class.key,
        resolver,
      );
      if (subclass === undefined) {
        blockers.push({
          ...choice,
          reason: `${choice.reason}; selected subclass '${selected[0]}' is not valid for ${sheet.class.name}`,
        });
        continue;
      }
      const featureRefs = subclassFeatureRefsForLevel(
        subclass,
        targetLevel,
        resolver,
      );
      if (featureRefs.length === 0) {
        blockers.push({
          ...choice,
          status: 'unsupported',
          unsupportedReason: `Selected subclass '${subclass.name}' has no structured feature records for level ${targetLevel}; deterministic subclass application is incomplete.`,
        });
        continue;
      }
      applied.push({
        id: choice.id,
        kind: 'subclass',
        value: subclass.key,
        label: subclass.name,
        featureRefs,
      });
      continue;
    }
    if (choice.kind === 'ability-score-improvement') {
      if (selected.length === 1 && selected[0]?.startsWith('feat:')) {
        const selectedRef = selected[0];
        const featResult = resolver.resolveFeat(selectedRef);
        if (!featResult.ok || featResult.record.key !== selectedRef) {
          blockers.push({
            ...choice,
            reason: `Feat selection '${selectedRef}' is not a canonical feat ref`,
          });
          continue;
        }
        const feat = featResult.record;
        if ((sheet.feats ?? []).some((owned) => owned.key === feat.key)) {
          blockers.push({
            ...choice,
            reason: `Feat '${feat.name}' can be selected only once`,
          });
          continue;
        }
        if (
          feat.key === 'feat:grappler' &&
          sheet.abilityScores.strength.final < 13
        ) {
          blockers.push({
            ...choice,
            reason: 'Grappler requires Strength 13 or higher',
          });
          continue;
        }
        if (feat.prerequisites !== undefined && feat.key !== 'feat:grappler') {
          blockers.push({
            ...choice,
            reason: `Feat '${feat.name}' has prerequisites that are not deterministically supported`,
          });
          continue;
        }
        applied.push({
          id: choice.id,
          kind: choice.kind,
          value: feat.key,
          label: feat.name,
          featureRefs: [],
          featRef: feat.key,
        });
        continue;
      }
      const names = selected
        .map((value) => abilityNameFromToken(value))
        .filter(
          (value): value is import('./creation.js').AbilityScoreName =>
            value !== undefined,
        );
      if (
        (selected.length !== 1 && selected.length !== 2) ||
        names.length !== selected.length ||
        new Set(names).size !== names.length
      ) {
        blockers.push(choice);
        continue;
      }
      const amounts = names.length === 1 ? [2] : [1, 1];
      if (
        names.some(
          (ability, index) =>
            sheet.abilityScores[ability].final + amounts[index] > 20,
        )
      ) {
        blockers.push({
          ...choice,
          reason: 'Ability Score Improvement cannot raise an ability above 20',
        });
        continue;
      }
      const increases = names.map((ability, index) => {
        const from = sheet.abilityScores[ability].final;
        const to = from + amounts[index];
        return {
          ability,
          amount: amounts[index] as 1 | 2,
          finalScore: { from, to },
          modifier: {
            from: sheet.abilityScores[ability].modifier,
            to: abilityModifier(to),
          },
        };
      });
      applied.push({
        id: choice.id,
        kind: choice.kind,
        value: selected.join(', '),
        label: choice.label,
        featureRefs: [],
        abilityScoreIncreases: increases,
      });
      continue;
    }
    blockers.push(choice);
  }
  return { blockers, applied };
}

function resolveSubclassSelection(
  selection: string,
  classKey: string,
  resolver: RulesPackCharacterResolver,
): ResolvedSubclassData | undefined {
  const normalized = selection.trim().toLowerCase();
  return resolver
    .listSubclasses()
    .filter((subclass) => subclass.parentClass === classKey)
    .find(
      (subclass) =>
        subclass.key.toLowerCase() === normalized ||
        subclass.name.toLowerCase() === normalized,
    );
}

function subclassFeatureRefsForLevel(
  subclass: ResolvedSubclassData,
  targetLevel: number,
  resolver: RulesPackCharacterResolver,
): readonly string[] {
  const subclassFeatureSet = new Set(subclass.features);
  return resolver
    .listFeatures()
    .filter(
      (feature) =>
        feature.source === subclass.key &&
        feature.level === targetLevel &&
        subclassFeatureSet.has(feature.key),
    )
    .map((feature) => feature.key);
}

function existingSubclassFeatureRefsForLevel(
  sheet: CharacterSheet,
  targetLevel: number,
  resolver: RulesPackCharacterResolver,
): readonly string[] {
  if (sheet.subclass === undefined) {
    return [];
  }
  const subclass = resolver
    .listSubclasses()
    .find((entry) => entry.key === sheet.subclass?.key);
  if (subclass === undefined) {
    throw new LevelUpEngineError(
      `cannot resolve subclass '${sheet.subclass.key}' for level-up`,
    );
  }
  if (subclass.parentClass !== sheet.class.key) {
    throw new LevelUpEngineError(
      `subclass '${subclass.key}' does not belong to class '${sheet.class.key}'`,
    );
  }
  return subclassFeatureRefsForLevel(subclass, targetLevel, resolver);
}

function applyResolvedChoicesToChangeSet(
  changeSet: LevelUpChangeSet,
  applied: readonly LevelUpAppliedChoice[],
): LevelUpChangeSet {
  if (applied.length === 0) {
    return changeSet;
  }
  const selectedFeatureRefs = applied.flatMap((choice) => choice.featureRefs);
  const selectedFeatRefs = applied.flatMap((choice) =>
    choice.featRef === undefined ? [] : [choice.featRef],
  );
  const abilityScoreIncreases = applied.flatMap(
    (choice) => choice.abilityScoreIncreases ?? [],
  );
  const constitution = abilityScoreIncreases.find(
    (entry) => entry.ability === 'constitution',
  );
  if (constitution !== undefined) {
    const delta = constitution.modifier.to - constitution.modifier.from;
    const natural = changeSet.hitPoints.naturalRoll;
    const base = natural ?? Math.floor(changeSet.hitPoints.hitDie / 2) + 1;
    const increment = Math.max(1, base + constitution.modifier.to);
    const retroactiveConstitutionAdjustment = delta * changeSet.level.from;
    const totalDelta = increment + retroactiveConstitutionAdjustment;
    return {
      ...changeSet,
      featuresGained: [...changeSet.featuresGained, ...selectedFeatureRefs],
      ...(selectedFeatRefs.length > 0 ? { featsGained: selectedFeatRefs } : {}),
      choicesApplied: applied,
      abilityScoreIncreases,
      hitPoints: {
        ...changeSet.hitPoints,
        constitutionModifier: constitution.modifier.to,
        increment,
        retroactiveConstitutionAdjustment,
        maxHitPoints: {
          from: changeSet.hitPoints.maxHitPoints.from,
          to: changeSet.hitPoints.maxHitPoints.from + totalDelta,
        },
      },
    };
  }
  return {
    ...changeSet,
    featuresGained: [...changeSet.featuresGained, ...selectedFeatureRefs],
    ...(selectedFeatRefs.length > 0 ? { featsGained: selectedFeatRefs } : {}),
    choicesApplied: applied,
    abilityScoreIncreases: applied.flatMap(
      (choice) => choice.abilityScoreIncreases ?? [],
    ),
  };
}

function recomputeAfterChoices(
  changeSet: LevelUpChangeSet,
  sheet: CharacterSheet,
  resolver: RulesPackCharacterResolver,
): LevelUpChangeSet {
  const increases = changeSet.abilityScoreIncreases ?? [];
  const modifiers = {
    ...Object.fromEntries(
      Object.entries(sheet.abilityScores).map(([ability, score]) => [
        ability,
        score.modifier,
      ]),
    ),
  } as Record<import('./creation.js').AbilityScoreName, number>;
  for (const increase of increases)
    modifiers[increase.ability] = increase.modifier.to;
  const classResult = resolver.resolveClass(sheet.class.key);
  if (!classResult.ok) throw new LevelUpEngineError(classResult.message);
  const savingThrows = {} as Record<
    import('./creation.js').AbilityScoreName,
    LevelUpDelta<SavingThrowDerived>
  >;
  for (const ability of Object.keys(
    sheet.abilityScores,
  ) as import('./creation.js').AbilityScoreName[]) {
    const isProficient = sheet.savingThrows[ability].proficient;
    const from = sheet.savingThrows[ability];
    const to = {
      modifier:
        modifiers[ability] + (isProficient ? changeSet.proficiencyBonus.to : 0),
      proficient: isProficient,
    };
    savingThrows[ability] = { from, to };
  }
  const ability = classResult.record.spellcastingAbility;
  const spell =
    ability === undefined
      ? {}
      : (() => {
          const derived = deriveSpellcastingValues({
            proficiencyBonus: changeSet.proficiencyBonus.to,
            abilityModifier: modifiers[ability],
          });
          return {
            spellSaveDc: { from: sheet.spellSaveDc, to: derived.spellSaveDc },
            spellAttackModifier: {
              from: sheet.spellAttackModifier,
              to: derived.spellAttackModifier,
            },
          };
        })();
  return { ...changeSet, savingThrows, ...spell };
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

function resolveHitPointChoice(
  hitDie: number,
  constitutionModifier: number,
  choice: LevelUpHitPointChoice,
): {
  readonly method: 'fixed-average' | 'rolled';
  readonly naturalRoll?: number;
  readonly increment: number;
} {
  if (choice.method === 'fixed-average') {
    return {
      method: 'fixed-average',
      increment: hitPointIncrement(hitDie, constitutionModifier),
    };
  }
  const roll = choice.roll;
  try {
    validateDiceRollEvidence(roll, parseDice(`1d${hitDie}`));
  } catch {
    throw new LevelUpEngineError('rolled hit-point evidence is malformed');
  }
  return {
    method: 'rolled',
    naturalRoll: roll.natural,
    increment: Math.max(1, roll.natural + constitutionModifier),
  };
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
  classRecord: ResolvedClassData,
  row: { readonly spellcasting?: ResolvedLevelSpellcasting },
  newProficiencyBonus: number,
): Pick<
  LevelUpChangeSet,
  'spellcasting' | 'spellSaveDc' | 'spellAttackModifier'
> {
  if (row.spellcasting === undefined) {
    return {};
  }
  const ability = classRecord.spellcastingAbility;
  if (ability === undefined) {
    // Capacity exists in the row but the class has no modeled ability: report
    // the slots/known counts, but do not invent a DC.
    return { spellcasting: row.spellcasting };
  }
  const abilityModifier = sheet.abilityScores[ability].modifier;
  const derived = deriveSpellcastingValues({
    proficiencyBonus: newProficiencyBonus,
    abilityModifier,
  });
  return {
    spellcasting: row.spellcasting,
    spellSaveDc: {
      from: sheet.spellSaveDc,
      to: derived.spellSaveDc,
    },
    spellAttackModifier: {
      from: sheet.spellAttackModifier,
      to: derived.spellAttackModifier,
    },
  };
}

/** Build the updated sheet from the change set (immutably). */
function applyChangeSetToSheet(
  sheet: CharacterSheet,
  changeSet: LevelUpChangeSet,
  appliedChoices: readonly LevelUpAppliedChoice[] = [],
): CharacterSheet {
  const subclass = appliedChoices.find((choice) => choice.kind === 'subclass');
  const gainedFeats = appliedChoices.flatMap((choice) =>
    choice.featRef === undefined
      ? []
      : [{ key: choice.featRef, name: choice.label }],
  );
  const next: CharacterSheet = {
    ...sheet,
    level: changeSet.level.to,
    proficiencyBonus: changeSet.proficiencyBonus.to,
    maxHitPoints: changeSet.hitPoints.maxHitPoints.to,
    ...(changeSet.abilityScoreIncreases !== undefined
      ? {
          abilityScores: applyAbilityScoreIncreases(
            sheet,
            changeSet.abilityScoreIncreases,
          ),
        }
      : {}),
    ...(changeSet.savingThrows !== undefined
      ? {
          savingThrows: Object.fromEntries(
            Object.entries(changeSet.savingThrows).map(([ability, delta]) => [
              ability,
              delta.to,
            ]),
          ) as CharacterSheet['savingThrows'],
        }
      : {}),
    ...(subclass !== undefined
      ? { subclass: { key: subclass.value, name: subclass.label } }
      : {}),
    ...(gainedFeats.length > 0
      ? { feats: [...(sheet.feats ?? []), ...gainedFeats] }
      : {}),
    ...(changeSet.spellSaveDc?.to !== undefined
      ? { spellSaveDc: changeSet.spellSaveDc.to }
      : {}),
    ...(changeSet.spellAttackModifier?.to !== undefined
      ? { spellAttackModifier: changeSet.spellAttackModifier.to }
      : {}),
  };
  return next;
}

function applyAbilityScoreIncreases(
  sheet: CharacterSheet,
  increases: readonly AppliedAbilityScoreIncrease[],
): CharacterSheet['abilityScores'] {
  const scores = { ...sheet.abilityScores };
  for (const increase of increases) {
    scores[increase.ability] = {
      ...scores[increase.ability],
      final: increase.finalScore.to,
      modifier: increase.modifier.to,
    };
  }
  return scores;
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
  if (changeSet.abilityScoreIncreases !== undefined) {
    const liveScores = {
      strength: 0,
      dexterity: 0,
      constitution: 0,
      intelligence: 0,
      wisdom: 0,
      charisma: 0,
    };
    const sheet = input.store.load(characterId);
    if (sheet === undefined)
      throw new LevelUpEngineError(
        'sheet disappeared during level-up projection',
      );
    for (const ability of Object.keys(
      liveScores,
    ) as (keyof typeof liveScores)[]) {
      liveScores[ability] = sheet.abilityScores[ability].final;
    }
    mutateState(db, {
      target: 'character',
      id: characterId,
      field: 'ability_scores_json',
      op: 'set',
      value: liveScores,
      ...ctx,
    });
  }
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
      value:
        row.hp_current +
        (changeSet.hitPoints.maxHitPoints.to -
          changeSet.hitPoints.maxHitPoints.from),
      ...ctx,
    });
  }
}

function requireNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LevelUpEngineError(`level-up ${field} is required`);
  }
}
