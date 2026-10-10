import type { DeterministicCapabilityContract } from './deterministicCapabilityContract.js';
import { RULE_DETERMINISTIC_CAPABILITY_CONTRACTS } from './deterministicCapabilityLedger.js';
import type { RulesRecord } from './types.js';

/**
 * Eshyra's authoritative inventory of the deterministic capabilities in force
 * (ADR 0020 section 3, eshyra-o9bd.19.5.12).
 *
 * This is a statement about Eshyra, never about the rules. An entry says what
 * one operation performs, what it refuses or does not decide, and what stays
 * with the DM. Absence from this inventory is not evidence that a rule has no
 * mechanics, is irrelevant, or is safe to ignore, and nothing here claims the
 * rules pack is deterministically complete.
 *
 * Closure is claimed over exactly one bounded registry: every tool in
 * `createDefaultToolRegistry()` appears exactly once, either as an entry here
 * or in {@link NON_CAPABILITY_TOOLS} (see
 * `packages/core/test/deterministicCapabilityInventory.test.ts`). Engine
 * (non-tool) entries are curated with evidence pointers; no closure claim is
 * made over engine code.
 *
 * The four contracts already in `RULE_DETERMINISTIC_CAPABILITY_CONTRACTS` are
 * quoted by reference, never restated.
 *
 * Internal: exported from `@eshyra/core/internal` only. Nothing here changes
 * what the DM model is told; model-facing presentation stays owned by
 * `RULE_DETERMINISTIC_CAPABILITY_BINDINGS` and the dispositions beside it.
 */

export type DeterministicCapabilityCategory =
  /**
   * Dice/RNG, arithmetic, atomic canonical mutation, resource accounting,
   * identity/ownership, persistence/replay/rollback, or a
   * visibility/authorization boundary.
   */
  | 'state-integrity'
  /** A positively selected, bounded rules procedure. */
  | 'bounded-procedure';

export type DeterministicCapabilitySurface =
  | { readonly kind: 'tool'; readonly name: string }
  | {
      readonly kind: 'engine';
      readonly module: string;
      readonly entryPoint: string;
    };

export interface DeterministicCapabilityInventoryEntry
  extends DeterministicCapabilityContract {
  readonly surface: DeterministicCapabilitySurface;
  readonly category: DeterministicCapabilityCategory;
  /** Repository-relative paths of the code that performs the operation. */
  readonly runtimeOwner: readonly string[];
  /** Repository-relative paths of the existing tests that exercise it. */
  readonly evidence: readonly string[];
  /** Set when the entry quotes a contract in the rule-bound ledger. */
  readonly ledgerContract?: string;
}

const o = (file: string) => `packages/core/src/orchestrator/${file}`;
const s = (file: string) => `packages/core/src/state/${file}`;
const c = (file: string) => `packages/core/src/character/${file}`;
const r = (file: string) => `packages/core/src/rules/${file}`;
const t = (file: string) => `packages/core/test/${file}`;

interface EntrySpec {
  readonly operation: string;
  readonly requiredInputs: readonly string[];
  readonly exclusions: readonly string[];
  readonly residualDmInterpretation: readonly string[];
  readonly runtimeOwner: readonly string[];
  readonly evidence: readonly string[];
}

function toolEntry(
  name: string,
  category: DeterministicCapabilityCategory,
  spec: EntrySpec,
): DeterministicCapabilityInventoryEntry {
  return Object.freeze({
    revision: `${name.replaceAll('_', '-')}-v1`,
    operationId: name,
    surface: Object.freeze({ kind: 'tool' as const, name }),
    category,
    ...spec,
  });
}

function engineEntry(
  revision: string,
  operationId: string,
  module: string,
  category: DeterministicCapabilityCategory,
  spec: EntrySpec,
): DeterministicCapabilityInventoryEntry {
  return Object.freeze({
    revision,
    operationId,
    surface: Object.freeze({
      kind: 'engine' as const,
      module,
      entryPoint: operationId,
    }),
    category,
    ...spec,
  });
}

/** Quotes a ledger contract by reference; the facts are never restated. */
function ledgerEntry(
  revision: string,
  surface: DeterministicCapabilitySurface,
  category: DeterministicCapabilityCategory,
): DeterministicCapabilityInventoryEntry {
  const contract = RULE_DETERMINISTIC_CAPABILITY_CONTRACTS[revision];
  if (contract === undefined)
    throw new Error(`${revision}: ledger contract is not registered`);
  return Object.freeze({
    revision: contract.revision,
    operationId: contract.operationId,
    surface,
    category,
    operation: contract.operation,
    requiredInputs: contract.requiredInputs,
    exclusions: contract.exclusions,
    residualDmInterpretation: contract.residualDmInterpretation,
    runtimeOwner: contract.runtimeOwner,
    evidence: contract.evidence,
    ledgerContract: revision,
  });
}

// ---------------------------------------------------------------------------
// Dice and resolution
// ---------------------------------------------------------------------------

const DICE_AND_RESOLUTION: readonly DeterministicCapabilityInventoryEntry[] = [
  toolEntry('roll', 'state-integrity', {
    operation:
      'Roll one dice expression (NdM with optional keep/drop and a flat modifier) from the seeded code-owned RNG and return every die, the kept/dropped split, the natural total, the modifier, and the total.',
    requiredInputs: ['dice', 'reason'],
    exclusions: [
      'Does not decide what the roll is for, which modifiers belong in the expression, or what the result means.',
      'Does not cancel advantage against disadvantage or add sheet-derived modifiers; resolve_check does that for d20 tests.',
      'visibility and category are caller-declared labels; the tool does not verify them.',
    ],
    residualDmInterpretation: [
      'The DM chooses the expression, whether the roll is player-visible or DM-only, and the consequence of the result.',
    ],
    runtimeOwner: [o('toolRoll.ts'), o('dice.ts'), o('rng.ts')],
    evidence: [t('diceGrammar.test.ts'), t('playerVisibleRollLedger.test.ts')],
  }),
  ledgerEntry(
    'resolve-check-v2',
    { kind: 'tool', name: 'resolve_check' },
    'bounded-procedure',
  ),
  toolEntry('resolve_contest', 'bounded-procedure', {
    operation:
      'Resolve an opposed contest: side a then side b each roll a d20 with their own declared modifiers, proficiency, and advantage or disadvantage; the higher total wins and a tie leaves the situation unchanged.',
    requiredInputs: ['reason', 'a', 'b'],
    exclusions: [
      'Both sides always roll; a contest against an already-fixed total is not resolved here (resolve_retained_check compares against a retained total).',
      'Does not derive modifiers or proficiency from a character sheet; each side declares its own.',
      'Does not decide that a contest applies or what winning changes in the fiction.',
    ],
    residualDmInterpretation: [
      'The DM decides whether a contest applies, which checks each side makes, and the modifiers, proficiency, and advantage each side has.',
    ],
    runtimeOwner: [o('toolResolveContest.ts'), o('resolution.ts')],
    evidence: [t('resolutionTools.test.ts'), t('resolution.test.ts')],
  }),
  toolEntry('roll_retained_check', 'state-integrity', {
    operation:
      'Roll an ability check d20 from the seeded RNG with declared modifiers, proficiency, and advantage or disadvantage, and persist the total as an active retained check (linked to the active combat instance when one exists; visibility defaults to dm_only).',
    requiredInputs: ['kind', 'reason', 'label'],
    exclusions: [
      'Only ability_check is accepted.',
      'Does not derive modifiers from a character sheet; the caller declares them.',
      'A participant, when given, must be a character or a combatant in the active combat instance; the tool does not decide who should be hiding or who the observers are.',
    ],
    residualDmInterpretation: [
      'The DM decides whether the check applies, which modifiers and advantage count, and which creatures could observe the result.',
    ],
    runtimeOwner: [
      o('toolRollRetainedCheck.ts'),
      o('toolRetainedCheckShared.ts'),
    ],
    evidence: [t('retainedChecks.test.ts')],
  }),
  toolEntry('resolve_retained_check', 'bounded-procedure', {
    operation:
      'Compare an active retained check total with exactly one fresh opposing ability check (search) or a set of passive scores (computed through calc passive_score), record each comparison atomically, and report an observer as noticing only when its total is strictly higher than the retained total.',
    requiredInputs: ['retainedCheckId', 'reason'],
    exclusions: [
      'Exactly one of search or passive is required; both or neither is refused.',
      'An unknown or already-ended retained check is refused.',
      'Does not decide which observers can perceive the hider or what noticing changes in the fiction.',
    ],
    residualDmInterpretation: [
      'The DM chooses the observers, their declared modifiers and advantage, and what follows when an observer notices or fails to notice.',
    ],
    runtimeOwner: [o('toolResolveRetainedCheck.ts'), o('calc.ts')],
    evidence: [t('retainedChecks.test.ts')],
  }),
  toolEntry('end_retained_check', 'state-integrity', {
    operation:
      'Mark one active retained check ended with the reason discovered or stopped, in one transaction.',
    requiredInputs: ['retainedCheckId', 'reason'],
    exclusions: [
      'Never ends a retained check on its own; whether the creature was discovered or stopped hiding is not decided here.',
      'An unknown or already-ended retained check is refused.',
    ],
    residualDmInterpretation: [
      'The DM decides whether and when the creature is discovered or stops hiding.',
    ],
    runtimeOwner: [o('toolEndRetainedCheck.ts')],
    evidence: [t('retainedChecks.test.ts')],
  }),
  toolEntry('resolve_damage', 'bounded-procedure', {
    operation:
      'Roll declared damage packets once from the seeded RNG (doubling the dice on critical:true), aggregate same-type packets, then per declared target zero immune types, halve resisted types rounding down, and double vulnerable types, never below 0 per type.',
    requiredInputs: ['reason', 'packets'],
    exclusions: [
      'Does not change hit points; adjust_hp or update_combatant applies the result.',
      'Does not decide which resistances, vulnerabilities, or immunities a target has; the caller declares them per target.',
      'Does not decide whether an attack hit or was a critical hit.',
    ],
    residualDmInterpretation: [
      'The DM decides the damage dice and types, whether the hit is critical, which targets are affected, and which resistances, vulnerabilities, or immunities apply.',
    ],
    runtimeOwner: [o('toolResolveDamage.ts'), o('resolution.ts')],
    evidence: [t('resolutionTools.test.ts'), t('resolution.test.ts')],
  }),
  ledgerEntry(
    'resolve-spell-upcast-v1',
    { kind: 'tool', name: 'resolve_spell_upcast' },
    'bounded-procedure',
  ),
  toolEntry('calc', 'state-integrity', {
    operation:
      'Evaluate one registered dice-free rules formula (breath-hold duration, carrying capacity, encumbrance thresholds, fall damage dice, forced-march DC, grapple escape DC, group check outcome, jump distance, passive score, suffocation survival rounds, and the other formulas registered in calc.ts) with validated named arguments.',
    requiredInputs: ['formula', 'args', 'reason'],
    exclusions: [
      'Unregistered formulas and unknown or invalid arguments are rejected; there is no generic expression engine.',
      'Does not roll dice.',
      'Does not choose the inputs or decide that the formula applies.',
    ],
    residualDmInterpretation: [
      'The DM chooses the formula and its inputs and decides what the result means for play.',
    ],
    runtimeOwner: [o('toolCalc.ts'), o('calc.ts')],
    evidence: [t('calc.test.ts'), t('resolutionTools.test.ts')],
  }),
  ledgerEntry(
    'resolve-concentration-v1',
    { kind: 'tool', name: 'resolve_concentration' },
    'bounded-procedure',
  ),
];

// ---------------------------------------------------------------------------
// Hit points, death, conditions, effects
// ---------------------------------------------------------------------------

const HP_CONDITIONS_EFFECTS: readonly DeterministicCapabilityInventoryEntry[] =
  [
    toolEntry('adjust_hp', 'bounded-procedure', {
      operation:
        'Apply a signed hit point change to a character in one transaction: damage consumes temporary hit points first; dropping to 0 makes the character dying, or dead when the overflow reaches the hit point maximum (knockOut=true instead makes a character reduced from above 0 unconscious and stable); damage at 0 adds a death-save failure (two on a critical) and returns a stable character to dying; healing a dying or stable character restores consciousness; death ends attunements. Reports the required concentration save (concentrationCheck with its DC) or an incapacitation break (concentrationBroken).',
      requiredInputs: ['amount'],
      exclusions: [
        'Characters only; encounter combatants use update_combatant.',
        'Healing a dead character is refused, and healing is refused while the character is suffocating.',
        'Does not roll the concentration save (resolve_concentration does) and does not roll death saves (record_death_save records them).',
        'Does not compute damage amounts, resistance, or whether a hit was critical.',
      ],
      residualDmInterpretation: [
        'The DM decides the amount, whether the hit is critical, whether a knockout is intended, and the fiction around revival or unconsciousness.',
      ],
      runtimeOwner: [o('toolAdjustHp.ts'), s('hpLifecycle.ts')],
      evidence: [t('hpLifecycle.test.ts'), t('toolCharacterTargeting.test.ts')],
    }),
    toolEntry('grant_temporary_hp', 'bounded-procedure', {
      operation:
        'Grant temporary hit points to a character as a separate buffer that never stacks: with an existing buffer, replace=true takes the new pool, replace=false keeps the old one, and omitted keeps the larger. Granting at 0 hit points does not wake the character.',
      requiredInputs: ['amount'],
      exclusions: [
        'Does not heal and does not change real hit points.',
        'Does not decide whether a granting effect ends earlier than a long rest; a long rest expires the buffer through the rest tools.',
      ],
      residualDmInterpretation: [
        'The DM decides the amount and, when a buffer already exists, relays the player choice between the old and new pool.',
      ],
      runtimeOwner: [o('toolGrantTempHp.ts'), s('hpLifecycle.ts')],
      evidence: [t('hpLifecycle.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('record_death_save', 'bounded-procedure', {
      operation:
        'Apply a natural d20 death-save result to a dying character or an opted-in player-character combatant: 10 or more is a success, less is a failure, a natural 1 counts two failures, a natural 20 restores 1 hit point, three successes stabilize, and three failures kill.',
      requiredInputs: ['roll'],
      exclusions: [
        'The natural result is supplied by the caller (range-checked 1-20); the tool does not verify that it came from the roll tool.',
        'For a combatant, works only during its active combat instance.',
        'Does not decide when a death save is owed.',
      ],
      residualDmInterpretation: [
        'The DM decides when a death save is owed and obtains the natural result through roll.',
      ],
      runtimeOwner: [
        o('toolRecordDeathSave.ts'),
        s('hpLifecycle.ts'),
        s('encounterCombatants.ts'),
      ],
      evidence: [t('hpLifecycle.test.ts'), t('encounterCombatants.test.ts')],
    }),
    toolEntry('stabilize_character', 'bounded-procedure', {
      operation:
        'Record stabilization for a dying character or opted-in player-character combatant, in one transaction.',
      requiredInputs: [
        'character or combatantId (one of; the acting character when omitted)',
      ],
      exclusions: [
        'Providing both character and combatantId is refused.',
        'Does not roll or judge the stabilizing check and does not decide that a stabilizing effect occurred.',
        'Stabilization is blocked while the creature is suffocating.',
      ],
      residualDmInterpretation: [
        'The DM decides whether a successful check or stabilizing effect occurred.',
      ],
      runtimeOwner: [o('toolStabilizeCharacter.ts'), s('hpLifecycle.ts')],
      evidence: [t('hpLifecycle.test.ts'), t('combatantRepairsBatchG.test.ts')],
    }),
    toolEntry('set_suffocation', 'bounded-procedure', {
      operation:
        'Record that a character or combatant runs out of breath, or breathes again; on the drop event at the start of its next turn after the survival interval, set it to 0 hit points (a character or player-character-rules combatant becomes dying, a monster-rules combatant dies, and a vanish, revert, or animated-object creature follows its own zero-hit-point rule) and block healing and stabilization until it breathes.',
      requiredInputs: ['event'],
      exclusions: [
        'Does not apply the drop as damage and does not compute the survival interval (calc suffocation_survival_rounds does).',
        'Does not decide when breath runs out or when the creature can breathe again.',
      ],
      residualDmInterpretation: [
        'The DM decides when breath runs out, when breathing resumes, and what the fiction around the drop is.',
      ],
      runtimeOwner: [
        o('toolSetSuffocation.ts'),
        s('hpLifecycle.ts'),
        s('encounterCombatants.ts'),
      ],
      evidence: [t('hpLifecycle.test.ts'), t('zeroHpRevertRules.test.ts')],
    }),
    toolEntry('adjust_exhaustion', 'bounded-procedure', {
      operation:
        'Change the exhaustion level of a character or active combatant by a signed number of levels, clamped at 6; level 6 kills, level 4 or higher halves the hit point maximum, and a level below 1 removes exhaustion.',
      requiredInputs: ['delta'],
      exclusions: [
        'Applies only the level 4 and level 6 effects; the effects of other levels are declared on the relevant rolls by the caller.',
        'Does not decide how many levels a source inflicts or removes.',
      ],
      residualDmInterpretation: [
        'The DM decides the source-declared number of levels and applies the other levels effects to rolls.',
      ],
      runtimeOwner: [
        o('toolAdjustExhaustion.ts'),
        s('exhaustionMutation.ts'),
        s('exhaustion.ts'),
      ],
      evidence: [t('exhaustion.test.ts')],
    }),
    toolEntry('add_condition', 'state-integrity', {
      operation:
        "Add a condition to a character's stored conditions (a no-op when the id is already present); a condition that incapacitates atomically breaks the character's concentration.",
      requiredInputs: ['id'],
      exclusions: [
        'Characters only; encounter combatants use update_combatant.',
        'Exhaustion is refused; adjust_exhaustion changes it.',
        'Does not decide whether a condition applies or how long it lasts; extra fields such as duration or severity are preserved on the condition but not interpreted here (start_effect owns timed lifecycles).',
      ],
      residualDmInterpretation: [
        'The DM decides that a condition is imposed and what its fiction and duration are.',
      ],
      runtimeOwner: [o('toolAddCondition.ts'), s('domainMutations.ts')],
      evidence: [t('exhaustion.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('remove_condition', 'state-integrity', {
      operation:
        "Remove a condition from a character's stored conditions by id (a no-op when absent).",
      requiredInputs: ['id'],
      exclusions: [
        'Characters only; encounter combatants use update_combatant.',
        'Exhaustion is refused; adjust_exhaustion changes it.',
        'Does not decide that a condition ended.',
      ],
      residualDmInterpretation: [
        'The DM decides that the condition has ended.',
      ],
      runtimeOwner: [o('toolRemoveCondition.ts'), s('domainMutations.ts')],
      evidence: [t('hpLifecycle.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('award_inspiration', 'bounded-procedure', {
      operation:
        "Set a character's binary inspiration resource; awarding it to a character who already has it is refused.",
      requiredInputs: ['character (the acting character when omitted)'],
      exclusions: ['Does not decide whether a deed earns inspiration.'],
      residualDmInterpretation: [
        'The DM decides whether the character earned inspiration.',
      ],
      runtimeOwner: [o('toolAwardInspiration.ts'), s('inspiration.ts')],
      evidence: [t('inspiration.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('use_inspiration', 'bounded-procedure', {
      operation:
        "Spend a character's inspiration, or transfer it to another character with giftTo; a transfer to a character who already has inspiration is refused.",
      requiredInputs: ['character (the acting character when omitted)'],
      exclusions: [
        'Spending only flips the stored resource; it does not apply advantage to any roll.',
      ],
      residualDmInterpretation: [
        'The DM applies the advantage to one attack roll, saving throw, or ability check.',
      ],
      runtimeOwner: [o('toolUseInspiration.ts'), s('inspiration.ts')],
      evidence: [t('inspiration.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('start_effect', 'bounded-procedure', {
      operation:
        'Start one durable active effect (concentration or timed spell effect, condition package, curse, ward, summon control, or activated item power) in one transaction: spell sources must resolve in the bound rules pack and bind duration and concentration, a new concentration effect deterministically ends the owner previous one, and projected conditions are owned by the effect.',
      requiredInputs: ['effectId', 'kind', 'displayName', 'source', 'duration'],
      exclusions: [
        'Instantaneous spells leave no active effect and are not started here, except a bonded summon whose record keeps a persistent link.',
        'Every timer must declare a quantity, unit, and anchor; structurally meaningless kind, source, and link combinations fail closed.',
        'Does not apply the consequences of the effect other than its owned condition and actor projections.',
      ],
      residualDmInterpretation: [
        'The DM decides that an effect starts, its targets, and the consequences of the effect beyond the projections it owns.',
      ],
      runtimeOwner: [
        o('toolStartEffect.ts'),
        s('activeEffects.ts'),
        s('liveStateSchema.ts'),
      ],
      evidence: [
        t('activeEffects.test.ts'),
        t('bondedSummonTransitions.test.ts'),
      ],
    }),
    toolEntry('end_effect', 'bounded-procedure', {
      operation:
        'End one active effect with a declared reason and clean up exactly the state it owns (projected conditions and linked actors, per their remove, release, or revert policy) in one transaction; repeating the same end is a harmless no-op.',
      requiredInputs: ['effectId', 'reason'],
      exclusions: [
        'dismissed requires a dismissible effect, ruled requires a note, an until-trigger expiry needs its trigger named, and a round timer still in combat cannot expire early.',
        'Damage-triggered concentration saves go through resolve_concentration, not here.',
        'Does not decide that the effect ended.',
      ],
      residualDmInterpretation: [
        'The DM decides that the effect ended and which reason applies.',
      ],
      runtimeOwner: [o('toolEndEffect.ts'), s('activeEffects.ts')],
      evidence: [
        t('activeEffects.test.ts'),
        t('conjureUncontrolledRemoval.test.ts'),
      ],
    }),
    toolEntry('suppress_effect', 'state-integrity', {
      operation:
        'Mark an active effect suppressed without ending it, leaving its targets, owned projections, concentration slot, timers, links, and identity intact.',
      requiredInputs: ['effectId'],
      exclusions: [
        'Does not end, dispel, or dismiss the effect.',
        'Does not decide that suppression applies.',
      ],
      residualDmInterpretation: [
        'The DM decides that the effect is suppressed and for how long.',
      ],
      runtimeOwner: [o('toolSuppressEffect.ts'), s('activeEffects.ts')],
      evidence: [t('bondedSummonTransitions.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('unsuppress_effect', 'state-integrity', {
      operation:
        'Restore a suppressed effect to active status without creating a new effect or changing its targets, projections, concentration slot, timers, links, or identity.',
      requiredInputs: ['effectId'],
      exclusions: [
        'Does not undo an end, dispel, dismissal, or concentration loss.',
        'Does not decide that suppression is over.',
      ],
      residualDmInterpretation: [
        'The DM decides that suppression has stopped.',
      ],
      runtimeOwner: [o('toolUnsuppressEffect.ts'), s('activeEffects.ts')],
      evidence: [t('bondedSummonTransitions.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('refresh_effect', 'state-integrity', {
      operation:
        'Re-anchor the timer of an active (not suppressed, never ended) effect; a spell-grounded effect keeps its record duration when no duration is given.',
      requiredInputs: ['effectId'],
      exclusions: [
        'An ended or suppressed effect cannot be refreshed; re-establishing an ended effect is a new start_effect.',
        'Does not decide that a rule renews the effect.',
      ],
      residualDmInterpretation: [
        'The DM decides that a rule renews the effect and any new duration.',
      ],
      runtimeOwner: [o('toolRefreshEffect.ts'), s('activeEffects.ts')],
      evidence: [t('activeEffects.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('remove_effect_target', 'state-integrity', {
      operation:
        "Remove one target from a multi-target active effect, cleaning up exactly that target's projected conditions (and applying the owned-creature cleanup policy) while the effect and its other targets continue.",
      requiredInputs: ['effectId', 'target', 'reason'],
      exclusions: [
        'Never ends the effect itself; end_effect does.',
        'Repeating the same removal is a no-op.',
        'Does not decide that the target is released from the effect.',
      ],
      residualDmInterpretation: [
        'The DM decides that the target is no longer affected, for example after a successful save.',
      ],
      runtimeOwner: [o('toolRemoveEffectTarget.ts'), s('activeEffects.ts')],
      evidence: [t('zeroHpRevertRules.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('recast_bonded_summon', 'bounded-procedure', {
      operation:
        'Record that the summoner casts a bonded-summon spell again while its bond stays active: an absent creature is restored (at maximum hit points for a spell that restores the same creature, or in a chosen listed form), and a present creature is reformed when the spell has a cast-again transition for it.',
      requiredInputs: ['effectId', 'spellRef'],
      exclusions: [
        'The bond must have been created from that spell; a ruling-sourced bond, an ended or released bond, a suppressed effect, and a creature still in an active combat instance are refused.',
        'Spends no spell slot; spend_spell_slot does.',
        'Does not decide that the spell was cast.',
      ],
      residualDmInterpretation: [
        'The DM decides that the summoner recasts the spell and, where the spell allows a form, which form is chosen.',
      ],
      runtimeOwner: [o('toolRecastBondedSummon.ts'), s('activeEffects.ts')],
      evidence: [
        t('bondedSummonRecast.test.ts'),
        t('bondedSummonPactOfTheChain.test.ts'),
      ],
    }),
    toolEntry('transition_bonded_summon', 'bounded-procedure', {
      operation:
        "Execute an action-triggered presence transition a bonded-summon spell declares (temporary dismissal to a pocket dimension, recall, dismissal, permanent dismissal, or release), decided by the spell record's transition for the trigger, the creature's modelled presence, and the active link.",
      requiredInputs: ['effectId', 'spellRef', 'trigger'],
      exclusions: [
        'The bond must have been created from that spell; a ruling-sourced bond, an ended or suppressed effect, and a spell with no transition for that trigger and presence are refused with nothing changed.',
        'Spends no action; spend_turn_resource does.',
        'Where a recalled creature appears and its initiative are narrated, not tracked.',
      ],
      residualDmInterpretation: [
        'The DM decides that the summoner takes the triggering action and where a recalled creature appears.',
      ],
      runtimeOwner: [o('toolTransitionBondedSummon.ts'), s('activeEffects.ts')],
      evidence: [t('bondedSummonTransitions.test.ts')],
    }),
  ];

// ---------------------------------------------------------------------------
// Combat and turns
// ---------------------------------------------------------------------------

const COMBAT_AND_TURNS: readonly DeterministicCapabilityInventoryEntry[] = [
  toolEntry('start_encounter', 'state-integrity', {
    operation:
      'Open a new live combat instance from an authored encounter template and/or persistent actors, in one transaction; an absent actor is admitted only as a new manifestation with hit points above 0.',
    requiredInputs: ['encounterId or at least one actor (one of)'],
    exclusions: [
      'An absent actor still bonded to its summoner is refused until recast_bonded_summon restores it; a creature that disappears or reverts at 0 hit points cannot be admitted at 0 hit points.',
      'Initiative and turn order are narrated, not tracked.',
    ],
    residualDmInterpretation: [
      'The DM decides that combat starts, who takes part, and the initiative order.',
    ],
    runtimeOwner: [o('toolStartEncounter.ts'), s('encounterCombatants.ts')],
    evidence: [
      t('encounterCombatants.test.ts'),
      t('bondedSummonTransitions.test.ts'),
    ],
  }),
  toolEntry('join_combat', 'state-integrity', {
    operation:
      'Atomically admit creatures (instance-only combatants taking hit points, armor class, and heads from the creature record) and/or persistent actors into the active combat instance; any invalid entry writes nothing.',
    requiredInputs: [
      'creatures or actors (at least one entry; side on every entry)',
    ],
    exclusions: [
      'Refused when no combat instance is active.',
      'An actor already in this combat, a bonded absent actor, and a pocketed actor are refused or recalled through their own tools.',
      'Initiative and turn order stay narrated; the effect of a summon is recorded separately with start_effect.',
    ],
    residualDmInterpretation: [
      'The DM decides who joins, on which side, and their placement.',
    ],
    runtimeOwner: [o('toolJoinCombat.ts'), s('encounterCombatants.ts')],
    evidence: [t('joinCombat.test.ts')],
  }),
  toolEntry('update_combatant', 'bounded-procedure', {
    operation:
      'Update one live combatant by exact id: apply a hit point delta under monster death rules (0 hit points is dead unless a nonlethal knockout is declared) or opted-in player-character death rules (dying, death-save failures, instant death), add or remove conditions, set status and placement, and apply the owned-creature zero-hit-point rules (vanish, vanish-bonded, revert, Animate Objects, Giant Insect) and multi-head tracking.',
    requiredInputs: ['combatantId'],
    exclusions: [
      'A dead combatant cannot be healed; dying and stable are engine-owned for player-character rules and refused as explicit statuses; absent is engine-owned and refused; exhaustion cannot be added here.',
      'A combatant that is absent takes no changes; knockouts and other statuses are refused for creatures that vanish or revert at 0 hit points.',
      'Does not compute damage, resistance, or critical hits.',
    ],
    residualDmInterpretation: [
      'The DM decides the hit point change, which conditions apply, and whether a monster knockout is intended.',
    ],
    runtimeOwner: [
      o('toolUpdateCombatant.ts'),
      s('encounterCombatants.ts'),
      s('combatantLifecycle.ts'),
    ],
    evidence: [
      t('encounterCombatants.test.ts'),
      t('zeroHpVanishAndRemovePolicy.test.ts'),
    ],
  }),
  toolEntry('close_combat_instance', 'state-integrity', {
    operation:
      'Close the active combat instance so it cannot become active again, atomically breaking concentration owned by its combatants, removing effect targets and condition projections on them, and releasing owned summon links; character-owned effects survive.',
    requiredInputs: ['status'],
    exclusions: ['Does not decide that the fight is over.'],
    residualDmInterpretation: [
      'The DM decides that combat has ended and whether it completed, was abandoned, fled, or interrupted.',
    ],
    runtimeOwner: [
      o('toolCloseCombatInstance.ts'),
      s('encounterCombatants.ts'),
    ],
    evidence: [
      t('encounterCombatants.test.ts'),
      t('bondedSummonRecast.test.ts'),
    ],
  }),
  toolEntry('begin_turn', 'bounded-procedure', {
    operation:
      "Begin a combatant's or party character's turn in the active combat instance: reset its per-turn budget (action, bonus action, free object interaction, movement note), return its reaction, end the previous turn (clearing surprise), settle due round and participant-turn effects, and apply multi-head regrowth at the end of a multi-headed creature's turn.",
    requiredInputs: [
      'combatantId or character (one of)',
      'round, when a new combat round starts (never decreases)',
    ],
    exclusions: [
      'A dead, stable, escaped, inactive, or absent participant returns turnAvailable:false.',
      'Does not decide initiative order; it is called once per participant in the order the DM narrates.',
    ],
    residualDmInterpretation: [
      'The DM decides the initiative order and when each participant turn begins.',
    ],
    runtimeOwner: [
      o('toolBeginTurn.ts'),
      o('toolTurnParticipant.ts'),
      s('actionEconomy.ts'),
    ],
    evidence: [t('actionEconomy.test.ts'), t('encounterCombatants.test.ts')],
  }),
  toolEntry('spend_turn_resource', 'bounded-procedure', {
    operation:
      "Spend a participant's action-economy budget (action, bonus action, reaction allowance, free object interaction, movement note, or a legendary action with its record cost) and enforce the bonus-action-spell restriction from the spell record.",
    requiredInputs: ['resource', 'activity'],
    exclusions: [
      'Over-budget spends, off-turn spends of on-turn resources, any spend by a surprised participant, and legendary actions on the creature own turn are refused.',
      'A spell cast must pass spellRef; a cast without it is refused.',
      'Movement is a narrative note, not a numeric budget; whether an activity satisfies a reaction restriction (such as opportunity attacks only) stays a ruling.',
    ],
    residualDmInterpretation: [
      'The DM decides what the activity is, whether it satisfies a restriction on an extra reaction, and the timing rules the engine does not enforce.',
    ],
    runtimeOwner: [
      o('toolSpendTurnResource.ts'),
      o('toolTurnParticipant.ts'),
      s('actionEconomy.ts'),
    ],
    evidence: [t('actionEconomy.test.ts'), t('joinCombat.test.ts')],
  }),
  toolEntry('set_surprised', 'bounded-procedure', {
    operation:
      "Derive and record which participants are surprised at the start of the active combat instance from recorded passive comparisons (an observer that noticed no hider is surprised) and enforce the loss of the surprised participant's first turn.",
    requiredInputs: ['comparisonIds'],
    exclusions: [
      'A single call mixing hiders from both sides is refused.',
      'Does not roll the hiders checks or decide who hides or who observes; roll_retained_check and resolve_retained_check do the rolls and comparisons.',
    ],
    residualDmInterpretation: [
      'The DM decides whether either side is trying to be stealthy and which creatures are hiders and observers.',
    ],
    runtimeOwner: [o('toolSetSurprised.ts'), s('actionEconomy.ts')],
    evidence: [t('retainedChecks.test.ts'), t('actionEconomy.test.ts')],
  }),
];

// ---------------------------------------------------------------------------
// Items, currency, attunement, ammunition
// ---------------------------------------------------------------------------

const ITEMS_AND_CURRENCY: readonly DeterministicCapabilityInventoryEntry[] = [
  toolEntry('gain_currency', 'state-integrity', {
    operation:
      "Record a completed gain of exact currency denominations in a character's canonical wallet, atomically.",
    requiredInputs: ['amounts'],
    exclusions: [
      'Does not decide that a reward, sale, or refund occurred; prices, offers, and hypothetical rewards are not recorded.',
    ],
    residualDmInterpretation: [
      'The DM decides that coins were actually received and their amounts.',
    ],
    runtimeOwner: [
      o('toolGainCurrency.ts'),
      o('toolCurrencyShared.ts'),
      c('currency.ts'),
    ],
    evidence: [t('currencyTools.test.ts'), t('characterCurrency.test.ts')],
  }),
  toolEntry('spend_currency', 'state-integrity', {
    operation:
      "Record a completed exact-denomination payment from a character's canonical wallet, atomically.",
    requiredInputs: ['amounts'],
    exclusions: [
      'Does not break larger coins or make change; convert_currency does that explicitly.',
      'An unaffordable exact-denomination payment is refused.',
      'Does not decide prices or answer affordability questions.',
    ],
    residualDmInterpretation: [
      'The DM decides that the player actually pays and the price.',
    ],
    runtimeOwner: [
      o('toolSpendCurrency.ts'),
      o('toolCurrencyShared.ts'),
      c('currency.ts'),
    ],
    evidence: [t('currencyTools.test.ts'), t('characterCurrency.test.ts')],
  }),
  toolEntry('convert_currency', 'state-integrity', {
    operation:
      'Record an exact denomination conversion in a character wallet without changing total value.',
    requiredInputs: ['amount', 'from', 'to'],
    exclusions: [
      'Not a purchase or sale; it never changes total value.',
      'An unsupported denomination or a conversion the wallet cannot cover is refused.',
    ],
    residualDmInterpretation: [
      'The DM decides that a conversion or change-making happens and its venue.',
    ],
    runtimeOwner: [
      o('toolConvertCurrency.ts'),
      o('toolCurrencyShared.ts'),
      c('currency.ts'),
    ],
    evidence: [t('currencyTools.test.ts'), t('characterCurrency.test.ts')],
  }),
  toolEntry('give_item', 'state-integrity', {
    operation:
      "Add a new item to a character's inventory, or update an item row already held by the same character, validating inventory identity and any pack-bound magic-item reference.",
    requiredInputs: ['id', 'name'],
    exclusions: [
      'Never changes custody of an existing row; transfer_item and claim_item do.',
      'Sold, lost, and unknown-custody rows are not eligible.',
      'Does not decide that the player receives, buys, or is granted an item.',
    ],
    residualDmInterpretation: [
      'The DM decides that the player explicitly receives the item and which item it is.',
    ],
    runtimeOwner: [
      o('toolGiveItem.ts'),
      s('domainMutations.ts'),
      s('inventoryIdentity.ts'),
    ],
    evidence: [t('itemAdoption.test.ts'), t('inventoryQueryGuard.test.ts')],
  }),
  toolEntry('adopt_item', 'state-integrity', {
    operation:
      'Recognize one legacy held inventory row as an exact canonical magic item from the active campaign rules stack, splitting stateful legacy stacks of at most 100 instances and quarantining incompatible or malformed legacy evidence, atomically with any resolution action.',
    requiredInputs: ['id', 'packRef'],
    exclusions: [
      'Never guesses from the display name; an exact packRef (and variantId where required) is required.',
      'A quarantine is resolved only with one typed resolution action and durable GM evidence.',
    ],
    residualDmInterpretation: [
      'The DM decides which canonical item a legacy row is and supplies the review evidence for a quarantine.',
    ],
    runtimeOwner: [
      o('toolAdoptItem.ts'),
      s('itemAdoption.ts'),
      s('itemAdoptionReview.ts'),
    ],
    evidence: [t('itemAdoption.test.ts'), t('migrationLegacyAdoption.test.ts')],
  }),
  toolEntry('claim_item', 'state-integrity', {
    operation:
      'Claim an existing unheld physical inventory row whose world location exactly matches the current campaign location, preserving its id, pack and variant identity, quantity, properties, mutable item state, and any still-existing attunement while clearing its world placement.',
    requiredInputs: ['id'],
    exclusions: [
      'Unknown-location, remote, and already-held rows are refused, as is expended ammunition reserved for recover_ammunition.',
      'Does not decide that the character picks the item up.',
    ],
    residualDmInterpretation: [
      'The DM decides that the character explicitly picks up or recovers the item.',
    ],
    runtimeOwner: [
      o('toolClaimItem.ts'),
      s('domainMutations.ts'),
      s('inventoryWorldLocation.ts'),
    ],
    evidence: [t('characterCustody.test.ts'), t('ammunition.test.ts')],
  }),
  toolEntry('reacquire_item', 'state-integrity', {
    operation:
      'Restore custody of one specifically identified sold or lost inventory row, preserving its id, state, and attunement, after exact current-world co-location, non-empty custody evidence, and a disposition-compatible basis; a repurchase debits an exact-denomination payment atomically.',
    requiredInputs: ['id', 'basis', 'evidence'],
    exclusions: [
      'returned applies only to lost property, and a sold row requires basis repurchased with payment.',
      'Dropped rows are claimed with claim_item, not here.',
    ],
    residualDmInterpretation: [
      'The DM adjudicates that the recovery happened and supplies the custody evidence.',
    ],
    runtimeOwner: [o('toolReacquireItem.ts'), s('domainMutations.ts')],
    evidence: [t('characterCustody.test.ts'), t('currencyTools.test.ts')],
  }),
  toolEntry('list_nearby_items', 'state-integrity', {
    operation:
      'List bounded, id-ordered claim-selection identity (id, name, quantity, world location, pack and variant identity) for unheld physical rows at the current campaign location, with cursor pagination.',
    requiredInputs: ['none required; cursor and limit (1-20) are optional'],
    exclusions: [
      'Remote and unknown-location rows are never exposed, and expended ammunition reserved for recover_ammunition is omitted.',
      'Changes no custody or state.',
    ],
    residualDmInterpretation: [
      'The DM decides what the character can perceive and which listed item is picked up.',
    ],
    runtimeOwner: [
      o('toolListNearbyItems.ts'),
      s('inventoryWorldLocation.ts'),
      s('inventoryIdentity.ts'),
    ],
    evidence: [t('inventoryQueryGuard.test.ts'), t('ammunition.test.ts')],
  }),
  toolEntry('list_recoverable_items', 'state-integrity', {
    operation:
      'List bounded exact sold or lost row ids at the current world location eligible for a scene-adjudicated recovery for one basis (found, returned, or repurchased).',
    requiredInputs: ['basis'],
    exclusions: [
      'Changes no custody and does not reveal ordinary dropped loot.',
    ],
    residualDmInterpretation: [
      'The DM decides whether a recovery is warranted by the scene.',
    ],
    runtimeOwner: [o('toolListRecoverableItems.ts'), s('domainMutations.ts')],
    evidence: [t('inventoryQueryGuard.test.ts'), t('currencyTools.test.ts')],
  }),
  toolEntry('use_item', 'bounded-procedure', {
    operation:
      'Use one rules-pack-bound inventory instance through an operation declared by its magic-item record, validating the operation and every economy and effect reference, refusing insufficient resources, and applying deterministic costs.',
    requiredInputs: ['instanceId', 'operationId'],
    exclusions: [
      'The operation must be declared by the item record and pass the magic-item readiness preflight (derived-magic-item-clauses-v1); a blocked operation is refused before any state change.',
      'Does not execute item semantics outside the declared operation.',
    ],
    residualDmInterpretation: [
      'The DM decides whether the character may attempt the operation and how source prose beyond the declared operation applies.',
    ],
    runtimeOwner: [
      o('toolUseItem.ts'),
      s('itemState.ts'),
      'packages/core/src/campaign/capabilityPreflight.ts',
    ],
    evidence: [t('itemState.test.ts'), t('itemAdoption.test.ts')],
  }),
  toolEntry('transfer_item', 'state-integrity', {
    operation:
      'Transfer an existing inventory instance between party members without recreating it, preserving row id, pack and variant identity, charges, curse, timers, and item state, and clearing holder-relative storage and equipment placement.',
    requiredInputs: ['id', 'to_character', 'attunement'],
    exclusions: [
      'attunement must be explicit: require-unattuned refuses an attuned item and end atomically ends the current attunement.',
      'Does not decide that the transfer happens.',
    ],
    residualDmInterpretation: [
      'The DM decides that the character hands the item over.',
    ],
    runtimeOwner: [o('toolTransferItem.ts'), s('itemTransfer.ts')],
    evidence: [t('itemTransfer.test.ts')],
  }),
  toolEntry('don_item', 'state-integrity', {
    operation:
      'Mark one exact held inventory item as worn; wear state, not storage prose, is authoritative.',
    requiredInputs: ['id'],
    exclusions: [
      'Ambiguous legacy placement fails closed.',
      'Does not decide whether the character can wear the item or how long donning takes.',
    ],
    residualDmInterpretation: [
      'The DM decides whether the item can be worn and the time it takes.',
    ],
    runtimeOwner: [o('toolWearItem.ts'), s('inventoryWear.ts')],
    evidence: [t('inventoryWear.test.ts')],
  }),
  toolEntry('doff_item', 'state-integrity', {
    operation:
      'Mark one exact worn inventory item as not worn, enforcing source-declared cursed doff restrictions.',
    requiredInputs: ['id'],
    exclusions: [
      'Wear is not inferred from inventory.location.',
      'Does not decide whether the character wants or is able to remove it beyond the declared curse restriction.',
    ],
    residualDmInterpretation: [
      'The DM decides that the character removes the item and the time it takes.',
    ],
    runtimeOwner: [o('toolWearItem.ts'), s('inventoryWear.ts')],
    evidence: [t('inventoryWear.test.ts')],
  }),
  toolEntry('remove_item', 'state-integrity', {
    operation:
      'Apply an explicit physical disposition (destroyed, dropped, sold, or lost) to a held item: only destroyed deletes the row and ends attunement; a full drop, sale, or loss clears held storage and preserves the row, state, and disposition; a partial stateless stack splits into a new disposition-marked unheld row.',
    requiredInputs: ['id', 'disposition'],
    exclusions: [
      'Destroying an unheld dropped row requires its world location to match the current campaign location.',
      'Only dropped rows become claimable; sold and lost rows stay outside player custody.',
      'Does not decide that the player drops, sells, loses, or destroys the item.',
    ],
    residualDmInterpretation: [
      'The DM decides that the player explicitly drops, sells, loses, or destroys the item.',
    ],
    runtimeOwner: [
      o('toolRemoveItem.ts'),
      s('domainMutations.ts'),
      s('inventoryLifecycle.ts'),
    ],
    evidence: [t('itemAdoption.test.ts'), t('inventoryQueryGuard.test.ts')],
  }),
  toolEntry('attune_item', 'bounded-procedure', {
    operation:
      'Record a character attunement to a held magic item, enforcing at most three attuned items, no second copy of the same item, one creature per item, and that the item record requires attunement.',
    requiredInputs: ['itemId'],
    exclusions: [
      'An item whose record says it works without attunement is refused; items with no resolvable record are accepted under the cap and identity rules.',
      'Class and spellcaster prerequisites are returned for adjudication, not enforced.',
      'Does not narrate or time the short rest spent attuning.',
    ],
    residualDmInterpretation: [
      'The DM decides that the short rest of attunement occurred and adjudicates class or spellcaster prerequisites.',
    ],
    runtimeOwner: [o('toolAttuneItem.ts'), s('attunement.ts')],
    evidence: [t('attunement.test.ts')],
  }),
  toolEntry('end_attunement', 'state-integrity', {
    operation:
      'End a character attunement to an item with a declared reason (voluntary, distance, death, replaced, item_destroyed, or other), freeing the slot.',
    requiredInputs: ['itemId', 'reason'],
    exclusions: [
      'Does not detect the 100 foot / 24 hour separation; the DM notices it and records the ending.',
      'Death ends attunements automatically through the hit point death machine.',
    ],
    residualDmInterpretation: [
      'The DM decides that the ending condition occurred.',
    ],
    runtimeOwner: [o('toolEndAttunement.ts'), s('attunement.ts')],
    evidence: [t('attunement.test.ts'), t('itemAdoption.test.ts')],
  }),
  toolEntry('expend_ammunition', 'state-integrity', {
    operation:
      'Spend pieces of ammunition from a character held inventory after an attack, recording the expended pieces at the current battlefield location; one piece per attack.',
    requiredInputs: ['itemId'],
    exclusions: [
      'Requires an active combat instance.',
      'Does not resolve attacks or decide which weapons require ammunition.',
    ],
    residualDmInterpretation: [
      'The DM decides that an ammunition weapon attacked and which piece was used.',
    ],
    runtimeOwner: [o('toolExpendAmmunition.ts'), s('ammunition.ts')],
    evidence: [t('ammunition.test.ts')],
  }),
  toolEntry('recover_ammunition', 'bounded-procedure', {
    operation:
      "After a battle's combat instance is closed, recover half the expended ammunition (rounded down per ammunition identity), limited to what is still at the battlefield, and destroy the remaining present pieces.",
    requiredInputs: ['combatInstanceId'],
    exclusions: [
      'Reports pieces no longer present as unavailable.',
      'Does not advance the clock.',
    ],
    residualDmInterpretation: [
      'The DM decides that the character searches the battlefield and recovers ammunition.',
    ],
    runtimeOwner: [o('toolRecoverAmmunition.ts'), s('ammunition.ts')],
    evidence: [t('ammunition.test.ts')],
  }),
  // The magic-item readiness preflight is an engine path invoked by use_item
  // and by offline discovery; its contract lives in the rule-bound ledger.
  ledgerEntry(
    'derived-magic-item-clauses-v1',
    {
      kind: 'engine',
      module: s('itemExecutionReadiness.ts'),
      entryPoint: 'assertMagicItemOperationReady',
    },
    'bounded-procedure',
  ),
];

// ---------------------------------------------------------------------------
// Spells, slots, rests, resources, usage
// ---------------------------------------------------------------------------

const SPELLS_RESTS_USAGE: readonly DeterministicCapabilityInventoryEntry[] = [
  toolEntry('spend_spell_slot', 'bounded-procedure', {
    operation:
      'Spend a spell slot for a named spell: resolve the spell base level from the bound rules pack, treat cantrips as at will, spend the lowest legal available slot (or an explicit higher slotLevel), and return the canonical upcast scaling transform, atomically; the slot pool is derived from the character sheet.',
    requiredInputs: ['spellRef or spell (exactly one of)'],
    exclusions: [
      'A caller never declares the slot table, caster level, or class association.',
      'A leveled spell without an available slot at its level or higher is refused; a spell that does not resolve unambiguously in the campaign rules binding is refused.',
      'Does not decide whether the spell may be cast, its targets, or its effects; casting time and action economy go through spend_turn_resource.',
    ],
    residualDmInterpretation: [
      'The DM decides that the spell is cast, its targets and effects, and whether an upcast is intended.',
    ],
    runtimeOwner: [
      o('toolSpendSpellSlot.ts'),
      s('spellSlots.ts'),
      o('spellUpcast.ts'),
    ],
    evidence: [t('spellSlots.test.ts'), t('spellUpcast.test.ts')],
  }),
  toolEntry('flexible_casting', 'bounded-procedure', {
    operation:
      'Convert between sorcery points and spell slots: create-slot spends sorcery points for a new slot of slotLevel 1-5 that vanishes at the next long rest, and convert-slot expends an available slot to regain that many sorcery points, never above the maximum, with costs and limits from the bound pack procedure; in active combat it spends the bonus action first.',
    requiredInputs: ['operation', 'slotLevel'],
    exclusions: [
      'An unaffordable or illegal request is refused; a refusal aborts atomically, including the bonus-action spend.',
      'Outside structured combat no turn timing is consumed.',
    ],
    residualDmInterpretation: [
      'The DM decides that the character uses Flexible Casting and which conversion is chosen.',
    ],
    runtimeOwner: [
      o('toolFlexibleCasting.ts'),
      s('flexibleCasting.ts'),
      r('boundedProcedures.ts'),
    ],
    evidence: [
      t('flexibleCasting.test.ts'),
      t('flexibleCastingCombat.test.ts'),
    ],
  }),
  toolEntry('prepare_spells', 'bounded-procedure', {
    operation:
      "Replace a cleric's, druid's, paladin's, or wizard's whole prepared spell list after a completed long rest the character took part in, before world time advances, enforcing the class count, the class list at castable levels (wizard: spellbook only), and rejecting duplicates and unknown spells.",
    requiredInputs: ['restId', 'spells'],
    exclusions: [
      'Domain, oath, and circle spells are always prepared, are added by the engine, and do not count against the limit.',
      'Does not decide which spells the player prefers.',
    ],
    residualDmInterpretation: [
      'The DM relays the player choice of spells to prepare.',
    ],
    runtimeOwner: [o('toolPrepareSpells.ts'), c('spellPreparation.ts')],
    evidence: [t('spellPreparation.test.ts')],
  }),
  toolEntry('spend_usage', 'state-integrity', {
    operation:
      'Spend uses of a limited-use ability (X/Day, Recharge X-Y, recharge-after-rest, per-day innate spell) or charges of a legacy unbound item; a combatant economy is derived from its creature record and the engine refuses over-spends.',
    requiredInputs: ['ability or itemId (one of)'],
    exclusions: [
      'A declared economy for a combatant is rejected, and an ability matching no record entry is an error.',
      'Character abilities and unbound item charges have no structured economy, so the first spend must declare maxUses and reset.',
      'Canonical pack-bound item operations use use_item, not this tool.',
    ],
    residualDmInterpretation: [
      'The DM decides that the ability is used and, for a character ability or unbound item, supplies the economy from the source.',
    ],
    runtimeOwner: [
      o('toolSpendUsage.ts'),
      s('usageCounters.ts'),
      s('classResources.ts'),
    ],
    evidence: [
      t('usageCounters.test.ts'),
      t('classResourceActiveCapacity.test.ts'),
    ],
  }),
  toolEntry('restore_usage', 'bounded-procedure', {
    operation:
      'Restore a spent limited-use ability or unbound item charges either by a recharge roll (recharged iff the natural roll meets the record threshold, once per owner turn window) or by an explicit amount; exactly one of roll or amount.',
    requiredInputs: [
      'ability or itemId (one of)',
      'roll or amount (exactly one)',
    ],
    exclusions: [
      'The natural recharge result is supplied by the caller; the tool does not verify that it came from the roll tool.',
      'Off-turn and out-of-combat recharge rolls and a second roll in the same window are refused.',
      'Rest and dawn resets go through reset_usage; canonical pack-bound items use use_item.',
    ],
    residualDmInterpretation: [
      'The DM obtains the recharge or restore roll through roll and decides a ruled amount.',
    ],
    runtimeOwner: [o('toolRestoreUsage.ts'), s('usageCounters.ts')],
    evidence: [t('usageCounters.test.ts'), t('itemAdoption.test.ts')],
  }),
  toolEntry('reset_usage', 'bounded-procedure', {
    operation:
      'Apply a short rest, long rest, or dawn reset event to usage counters: rests restore rest-recharge economies and Recharge X-Y abilities, dawn restores per-day economies, and items that regain a rolled amount are returned for a rolled restore instead of being reset.',
    requiredInputs: ['event'],
    exclusions: [
      'Applies to every character by default; combatantId or character scopes it to one owner, and dawn applies to everyone.',
      'Canonical pack-bound item economies belong to the item reset executor, not generic counters.',
      'Does not complete a rest; the rest tools do.',
    ],
    residualDmInterpretation: [
      'The DM decides that the rest or dawn occurred and rolls any formula-based restoration.',
    ],
    runtimeOwner: [
      o('toolResetUsage.ts'),
      s('usageCounters.ts'),
      s('classResources.ts'),
    ],
    evidence: [
      t('usageCounters.test.ts'),
      t('classResourceActiveCapacity.test.ts'),
    ],
  }),
  toolEntry('complete_short_rest', 'bounded-procedure', {
    operation:
      'Complete one group short rest in one transaction: require a declared duration of at least 60 minutes without strenuous activity, advance the clock once, restore Pact Magic slots and short-rest usage and item resets, and open one-at-a-time Hit Die recovery.',
    requiredInputs: ['restId', 'participants', 'qualification'],
    exclusions: [
      'Refused while combat is active; reusing a rest id with a different participant list is refused.',
      'Does not restore ordinary Spellcasting slots.',
      'Does not decide whether the party actually rested.',
    ],
    residualDmInterpretation: [
      'The DM decides that the party rests, its duration, and whether it involved strenuous activity.',
    ],
    runtimeOwner: [o('toolRest.ts'), s('rest.ts')],
    evidence: [t('rest.test.ts')],
  }),
  toolEntry('complete_long_rest', 'bounded-procedure', {
    operation:
      'Complete one group long rest in one transaction after validating the qualification (at least 480 minutes with at least 360 asleep, at most 120 of light activity, and strenuous interruption under 60 minutes), then restore hit points, expire temporary hit points, restore half the Hit Dice (minimum 1), reset spell slots, usage counters and item resets, and reduce exhaustion by one level when food and drink were had.',
    requiredInputs: ['restId', 'participants', 'qualification'],
    exclusions: [
      'Refused while combat is active, for a dead participant or one at 0 hit points, and when a participant already benefited from a long rest within 24 in-game hours.',
      'Dawn is not a long rest.',
      'Does not decide whether the party actually rested.',
    ],
    residualDmInterpretation: [
      'The DM decides that the party rests and reports its sleep, activity, interruption, and food and drink honestly.',
    ],
    runtimeOwner: [o('toolRest.ts'), s('rest.ts'), s('spellSlots.ts')],
    evidence: [t('rest.test.ts')],
  }),
  toolEntry('spend_rest_hit_die', 'bounded-procedure', {
    operation:
      'Spend exactly one Hit Die inside an open short-rest recovery window: roll 1dHitDie from the seeded RNG, apply the canonical Constitution modifier, and return the dice evidence.',
    requiredInputs: ['restId'],
    exclusions: [
      'Refused during combat, for a dead character, with no open recovery window, or when no Hit Dice remain.',
      'The player may stop after any die; the tool does not decide how many to spend.',
    ],
    residualDmInterpretation: [
      'The DM relays the player choice to spend another Hit Die or stop.',
    ],
    runtimeOwner: [o('toolRest.ts'), s('rest.ts')],
    evidence: [t('rest.test.ts')],
  }),
  toolEntry('finish_short_rest_recovery', 'state-integrity', {
    operation:
      'Close a short-rest Hit Die recovery window so further Hit Die spending is rejected.',
    requiredInputs: ['restId'],
    exclusions: ['Refused when no recovery window is open.'],
    residualDmInterpretation: [
      'The DM decides that the player has finished spending Hit Dice.',
    ],
    runtimeOwner: [o('toolRest.ts'), s('rest.ts')],
    evidence: [t('rest.test.ts'), t('tools.test.ts')],
  }),
  toolEntry('advance_time', 'state-integrity', {
    operation:
      'Advance the structured elapsed-minutes world clock by a positive number of minutes, settling the effects, timers, stable-character recoveries, item resets, and recovery windows that fall due.',
    requiredInputs: ['minutes'],
    exclusions: [
      'Refused if the clock would exceed the safe integer range.',
      'Does not complete a rest; the in_game_time_label is a narrative label, not elapsed time.',
    ],
    residualDmInterpretation: ['The DM decides how much time passes.'],
    runtimeOwner: [o('toolRest.ts'), s('rest.ts'), s('turnClock.ts')],
    evidence: [t('rest.test.ts'), t('exhaustion.test.ts')],
  }),
];

// ---------------------------------------------------------------------------
// World, plot, clock, scenes, ambiguity
// ---------------------------------------------------------------------------

const WORLD_AND_RULINGS: readonly DeterministicCapabilityInventoryEntry[] = [
  toolEntry('update_clock', 'state-integrity', {
    operation:
      "Set the in-game time label and/or the character's current location through the validated, provenance-recording state seam.",
    requiredInputs: ['in_game_time or location_id (at least one)'],
    exclusions: [
      'A time label never advances elapsed minutes; advance_time does.',
      'A blank location_id is refused (null clears it).',
    ],
    residualDmInterpretation: [
      'The DM decides the time label and where the character is.',
    ],
    runtimeOwner: [
      o('toolUpdateClock.ts'),
      s('domainMutations.ts'),
      s('mutateState.ts'),
    ],
    evidence: [t('tools.test.ts'), t('domainMutations.test.ts')],
  }),
  toolEntry('mark_scene', 'state-integrity', {
    operation: 'Open or close a scene record in the campaign session.',
    requiredInputs: ['boundary'],
    exclusions: [
      'Opening requires a title, and closing with no open scene is refused.',
      'Does not decide that a scene boundary occurred.',
    ],
    residualDmInterpretation: ['The DM decides where scenes begin and end.'],
    runtimeOwner: [o('toolMarkScene.ts'), o('scene.ts')],
    evidence: [t('scene.test.ts')],
  }),
  toolEntry('set_plot_flag', 'state-integrity', {
    operation:
      'Set one named plot flag (any JSON value) through the validated, provenance-recording state seam.',
    requiredInputs: ['key', 'value'],
    exclusions: [
      'Stores the value as given; it does not interpret story progression, quest state, or NPC attitude.',
    ],
    residualDmInterpretation: [
      'The DM decides what the flag means and when story state changes.',
    ],
    runtimeOwner: [
      o('toolSetPlotFlag.ts'),
      s('domainMutations.ts'),
      s('mutateState.ts'),
    ],
    evidence: [t('tools.test.ts'), t('domainMutations.test.ts')],
  }),
  toolEntry('set_world_fact', 'state-integrity', {
    operation:
      'Set one world-template overlay fact (any JSON value) through the validated, provenance-recording state seam.',
    requiredInputs: ['key', 'value'],
    exclusions: [
      'Stores the value as given; it does not check it against module canon or decide that the divergence is warranted.',
    ],
    residualDmInterpretation: [
      'The DM decides what diverges from the base module.',
    ],
    runtimeOwner: [
      o('toolSetWorldFact.ts'),
      s('domainMutations.ts'),
      s('mutateState.ts'),
    ],
    evidence: [t('tools.test.ts'), t('domainMutations.test.ts')],
  }),
  toolEntry('record_world_fact', 'state-integrity', {
    operation:
      'Persist improvised lore or continuity dressing as campaign overlay lore with its kind, subject, truth status, source, scope, significance, and visibility, optionally superseding or invalidating earlier lore.',
    requiredInputs: [
      'kind',
      'subjectText',
      'fact',
      'truthStatus',
      'source',
      'scope',
      'visibility',
    ],
    exclusions: [
      'Does not decide whether the lore is true, significant, or player-visible; those labels are caller-declared.',
      'Transient atmosphere is not meant to be recorded.',
    ],
    residualDmInterpretation: [
      'The DM decides what is worth recording, its truth status, and its visibility.',
    ],
    runtimeOwner: [
      o('toolRecordWorldFact.ts'),
      'packages/core/src/world/campaignOverlayLore.ts',
    ],
    evidence: [t('campaignOverlayLoreContinuity.test.ts')],
  }),
  toolEntry('request_ambiguity_ruling', 'bounded-procedure', {
    operation:
      'Look up a published rules ambiguity in the campaign rules and report its status (unresolved, resolved with the active ruling, or conflicting with the rulings that must be revoked).',
    requiredInputs: ['ambiguityId'],
    exclusions: [
      'Never selects an interpretation and never records a ruling; the player chooses through the campaign rules flow.',
      'Writes no canon.',
    ],
    residualDmInterpretation: [
      'The DM narrates the uncertainty, presents the interpretations neutrally, and applies an already-active ruling.',
    ],
    runtimeOwner: [
      o('toolRequestAmbiguityRuling.ts'),
      'packages/core/src/campaign/ambiguityResolution.ts',
    ],
    evidence: [
      t('toolRequestAmbiguityRuling.test.ts'),
      t('campaignRulesEndToEnd.test.ts'),
    ],
  }),
  toolEntry('accept_ambiguity_precedent', 'state-integrity', {
    operation:
      'Stage a proposed durable precedent for an unresolved published ambiguity that the accepted player action unambiguously selects (all matching interpretation ids with a reason); nothing persists unless the auditor accepts the action and proposal.',
    requiredInputs: ['ambiguityId', 'matchingInterpretationIds', 'reason'],
    exclusions: [
      'Never for a question, canonical-rule violation, house rule, or contextual judgment.',
      'Does not itself persist the precedent; turn-level auditing does.',
    ],
    residualDmInterpretation: [
      'The DM decides that the action accepted by the table unambiguously selects the interpretation.',
    ],
    runtimeOwner: [
      o('toolAcceptAmbiguityPrecedent.ts'),
      'packages/core/src/campaign/ambiguityResolution.ts',
    ],
    evidence: [t('campaignRulesEndToEnd.test.ts'), t('turnAuditor.test.ts')],
  }),
];

// ---------------------------------------------------------------------------
// Engine (non-tool) paths. Curated; no closure claim over engine code.
// ---------------------------------------------------------------------------

const ENGINE_PATHS: readonly DeterministicCapabilityInventoryEntry[] = [
  engineEntry(
    'finalize-character-v1',
    'finalizeCharacterDraft',
    c('finalizeCharacter.ts'),
    'bounded-procedure',
    {
      operation:
        'Gate a guided-creation draft and, when complete, derive the canonical character sheet: final ability scores and modifiers, saving throws, proficiency bonus, maximum hit points, spell save DC and attack, level-1 skills, tools, languages and equipment, spell state, class-feature choices, starting wallet, and the standing proficiency grants (with their provenance ledger) that level-1 class and subclass features and chosen options confer.',
      requiredInputs: [
        'A draft with identity, class, ancestry, and ability scores',
        'Every level-1 mechanical choice satisfied',
        'Finalize metadata',
      ],
      exclusions: [
        'An incomplete draft, an error diagnostic, a duplicate skill or tool proficiency without a replacement choice, an invalid starting acquisition, or a build outside the one-class boundary returns or throws a refusal; nothing is guessed.',
        'Ancestry skill grants are applied at creation by srdAncestrySkills.ts, not by the proficiency-grant ledger.',
        'Does not choose the character concept or any player choice.',
      ],
      residualDmInterpretation: [
        'The player and DM supply every creative and mechanical choice; the DM adjudicates feature effects the sheet only records.',
      ],
      runtimeOwner: [
        c('finalizeCharacter.ts'),
        c('proficiencyGrants.ts'),
        c('characterBuild.ts'),
      ],
      evidence: [
        t('finalizeCharacter.test.ts'),
        t('proficiencyGrants.test.ts'),
      ],
    },
  ),
  engineEntry(
    'creation-class-choices-v1',
    'deriveCreationClassChoices',
    c('creationClassChoices.ts'),
    'bounded-procedure',
    {
      operation:
        'Derive the level-1 class-feature decisions (fighting style, favored enemy, natural explorer terrain, rogue expertise, level-1 subclass and its level-1 choices) from the bound rules pack, with validation and persisted shape shared with the level-up detectors.',
      requiredInputs: ['A creation draft', 'The rules pack character resolver'],
      exclusions: [
        'A choice the shared detectors cannot handle stays an explicit unstructured descriptor that blocks finalization with its reason.',
        'Spell choices are owned by the spell-count flow and use-time choices are not build decisions.',
      ],
      residualDmInterpretation: [
        'The player makes each pick; the DM adjudicates the effect of options the sheet only records.',
      ],
      runtimeOwner: [
        c('creationClassChoices.ts'),
        c('levelUpFeatureChoices.ts'),
      ],
      evidence: [t('creationClassChoices.test.ts')],
    },
  ),
  engineEntry(
    'creation-spell-counts-v1',
    'level1SpellRequirements',
    c('creationSpellCounts.ts'),
    'bounded-procedure',
    {
      operation:
        'Classify the flat creation spell list by spell level and report what the class requires at level 1 (cantrip count, known-caster spell count, wizard spellbook size and prepared list, cleric and druid preparation range), gating finalization on it.',
      requiredInputs: [
        'A creation draft with a class',
        'The rules pack character resolver',
      ],
      exclusions: [
        'Subclass always-prepared spells do not count against the preparation limit.',
        'Does not choose the spells.',
      ],
      residualDmInterpretation: [
        'The player chooses the spells within the enforced counts.',
      ],
      runtimeOwner: [c('creationSpellCounts.ts'), c('levelUpSpells.ts')],
      evidence: [t('creationSpellCounts.test.ts')],
    },
  ),
  engineEntry(
    'proficiency-grants-v1',
    'applyProficiencyGrants',
    c('proficiencyGrants.ts'),
    'state-integrity',
    {
      operation:
        'Apply typed standing proficiency grants (saving throws, skills, armor) from class and subclass features and chosen options to the durable sheet, recording in the CharacterSheet.proficiencyGrants ledger only what each source newly added so that a replaceable option can later be removed exactly.',
      requiredInputs: [
        'A character sheet',
        'The grant sources with their source refs',
      ],
      exclusions: [
        'A grant that cannot be applied or removed without losing state raises ProficiencyGrantError.',
        'A proficiency held from any other source is never touched; ancestry trait grants are not read here.',
      ],
      residualDmInterpretation: [
        'The DM adjudicates any feature effect that is not a typed proficiency grant.',
      ],
      runtimeOwner: [c('proficiencyGrants.ts'), c('levelUpEngine.ts')],
      evidence: [
        t('proficiencyGrants.test.ts'),
        t('proficiencyReplacement.test.ts'),
      ],
    },
  ),
  engineEntry(
    'level-up-v1',
    'applyLevelUp',
    c('levelUpEngine.ts'),
    'bounded-procedure',
    {
      operation:
        'Apply exactly one level-up step to the pack-bound sheet in one transaction: derive proficiency bonus, class features, spellcasting capacity, and hit points (fixed average or immutable caller-supplied roll evidence) from the campaign-bound class progression, apply validated choices (feature choices, subclass, spells, skills, expertise, feats), update the proficiency ledger, project to the live character, reconcile spell slots and class-resource counters, and append a level-up ledger row.',
      requiredInputs: [
        'characterId',
        'A character sheet store',
        'source, provenance, sessionId, and at (ledger audit fields)',
        'Required choices for the target level, or none',
      ],
      exclusions: [
        'A non-alive or suffocating character, a sheet not built under the acting pack binding, a build outside the one-class boundary, and missing or invalid required choices are refused before any write.',
        'Records the pick of an option-catalog feature choice only; the option effect is not implemented here.',
        'Does not decide eligibility to level up or award experience.',
      ],
      residualDmInterpretation: [
        'The player makes the choices; the DM adjudicates the effect of chosen options the sheet only records.',
      ],
      runtimeOwner: [
        c('levelUpEngine.ts'),
        s('campaignRecordLookup.ts'),
        s('classResources.ts'),
        s('progression.ts'),
      ],
      evidence: [t('levelUpEngine.test.ts'), t('guidedLevelUpFlow.test.ts')],
    },
  ),
  engineEntry(
    'class-resource-capacity-v1',
    'classResourceCapacity',
    s('classResources.ts'),
    'state-integrity',
    {
      operation:
        'Derive the counter maximum of the selected expendable class resources (Rage, Ki, Sorcery Points) from the class table resourceProgression column at the character level, with their reset events.',
      requiredInputs: [
        'A class resource binding',
        'The resolved class level row',
      ],
      exclusions: [
        'Covers only the bindings listed in classResources.ts; other class resources have no pack-derived capacity here.',
        'A missing column or non-positive value is treated as no resource at that level.',
      ],
      residualDmInterpretation: [
        'The DM adjudicates class resources that have no binding.',
      ],
      runtimeOwner: [
        s('classResources.ts'),
        s('usageCounters.ts'),
        c('levelUpEngine.ts'),
      ],
      evidence: [
        t('classResourceActiveCapacity.test.ts'),
        t('usageCounters.test.ts'),
      ],
    },
  ),
  engineEntry(
    'campaign-rules-binding-resolution-v1',
    'resolveStrictCampaignRulesStack',
    s('campaignRecordLookup.ts'),
    'state-integrity',
    {
      operation:
        'Resolve the campaign stored rules binding (base pack and add-ons by system, pack id, and exact version) into a rules stack, so that rests, level-up, spell-slot, and record lookups read the bound pack and never a default one.',
      requiredInputs: ['The campaign database with its stored rules binding'],
      exclusions: [
        'An unavailable bound pack or version throws CampaignRulesBindingResolutionError; there is no silent fallback.',
        'Does not decide which rules a campaign should use.',
      ],
      residualDmInterpretation: [
        'The DM interprets the rules text of the resolved records.',
      ],
      runtimeOwner: [
        s('campaignRecordLookup.ts'),
        r('binding.ts'),
        r('stack.ts'),
      ],
      evidence: [t('campaignRulesBinding.test.ts'), t('rulesStack.test.ts')],
    },
  ),
  engineEntry(
    'checkpoint-store-v1',
    'CheckpointStore',
    'packages/core/src/persistence/checkpoint/store.ts',
    'state-integrity',
    {
      operation:
        'Serialize the live campaign database into a Dolt-backed checkpoint, list checkpoints, and restore one to a new working-copy database, off the per-turn path.',
      requiredInputs: [
        'A Dolt directory',
        'A beads directory',
        'The live database path or a checkpoint id',
      ],
      exclusions: [
        'Refuses a Dolt repository that is not separate from the beads Dolt data (including its reserved ref).',
        'A schema snapshot not in the current version is refused.',
        'Does not decide when to checkpoint or which checkpoint to restore.',
      ],
      residualDmInterpretation: [
        'The player or operator decides when to checkpoint and restore.',
      ],
      runtimeOwner: [
        'packages/core/src/persistence/checkpoint/store.ts',
        'packages/core/src/persistence/checkpoint/serialize.ts',
        'packages/core/src/persistence/checkpoint/separation.ts',
      ],
      evidence: [
        t('checkpoint.store.test.ts'),
        t('checkpoint.restore.test.ts'),
        t('checkpoint.separation.test.ts'),
      ],
    },
  ),
  engineEntry(
    'turn-replay-v1',
    'retainTurnReplay',
    'packages/core/src/campaign/turnReplayStore.ts',
    'state-integrity',
    {
      operation:
        'Retain the pre-turn state snapshot and a state hash with the turn input so a disputed turn can be replayed, and restore the snapshot only into an enclosing transaction after verifying the schema matches.',
      requiredInputs: ['The turn input', 'The pre-turn snapshot records'],
      exclusions: [
        'Replay is refused when campaign state changed after the adjudicated turn, and a snapshot whose schema differs from the current database is refused.',
        'The replay tables themselves are excluded from the snapshot and hash.',
      ],
      residualDmInterpretation: [
        'The DM and player decide whether a turn is disputed and how it is adjudicated.',
      ],
      runtimeOwner: [
        'packages/core/src/campaign/turnReplayStore.ts',
        'packages/core/src/campaign/disputedTurn.ts',
      ],
      evidence: [
        t('campaignRules.test.ts'),
        t('campaignRulesEndToEnd.test.ts'),
      ],
    },
  ),
  engineEntry(
    'schema-migration-runner-v1',
    'runMigrations',
    'packages/core/src/persistence/migrationRunner.ts',
    'state-integrity',
    {
      operation:
        'Apply pending versioned SQL migrations, each in its own transaction with its schema_migrations ledger row, after verifying that applied migrations match their files by checksum and name and form a contiguous prefix.',
      requiredInputs: ['A database', 'The bundled migration files'],
      exclusions: [
        'A deleted, renamed, or edited applied migration, or a non-contiguous ledger, throws SchemaMigrationError.',
        'Does not decide when a migration is written.',
      ],
      residualDmInterpretation: [
        'None: migration integrity involves no DM interpretation.',
      ],
      runtimeOwner: ['packages/core/src/persistence/migrationRunner.ts'],
      evidence: [t('migrationRunner.test.ts'), t('schemaSnapshot.test.ts')],
    },
  ),
  engineEntry(
    'mutate-state-v1',
    'mutateState',
    s('mutateState.ts'),
    'state-integrity',
    {
      operation:
        'Write one validated field of a live state target (clock, plot flags, overlay facts, character, inventory) through the trusted internal seam, checking value shape, field allowlists, and provenance, atomically.',
      requiredInputs: [
        'target',
        'field',
        'op',
        'value',
        'provenance, sessionId, and at',
      ],
      exclusions: [
        'Performs no lifecycle reactions; lifecycle-owned fields (hit points, life state, death saves, conditions) are written only through their domain operations.',
        'Not model-facing: no tool wraps it, and the default registry is pinned to contain no mutate_state tool.',
      ],
      residualDmInterpretation: [
        'None: callers are trusted domain code, not the DM model.',
      ],
      runtimeOwner: [
        s('mutateState.ts'),
        s('domainMutations.ts'),
        s('liveStateSchema.ts'),
      ],
      evidence: [
        t('domainMutations.test.ts'),
        t('liveStateSchema.test.ts'),
        t('tools.test.ts'),
      ],
    },
  ),
  engineEntry(
    'bounded-procedure-executor-v1',
    'executeBoundedProcedure',
    r('boundedProcedures.ts'),
    'bounded-procedure',
    {
      operation:
        'Execute a typed bounded-procedure request (hazard save, weapon damage mode, feature option selection and applicability, create or convert spell slot) against redacted pack record data, failing closed on any request or procedure shape it does not recognize. Retained and staged: only the create-spell-slot and convert-spell-slot requests have a runtime consumer (state/flexibleCasting.ts); the other request kinds have none yet, and eshyra-4xx6 owns their integration.',
      requiredInputs: [
        'Record data carrying the typed procedure',
        'A validated request',
      ],
      exclusions: [
        'Executes only the procedure shapes proven by eshyra-o9bd.19.1.14; it is not a universal rules taxonomy and a record without one of these shapes is not thereby free of mechanics.',
        'The adjudicated-stress procedure is declared but adjudicated by the DM.',
      ],
      residualDmInterpretation: [
        'The DM decides applicability and adjudicates everything outside the typed procedure, including adjudicated-stress material.',
      ],
      runtimeOwner: [r('boundedProcedures.ts'), s('flexibleCasting.ts')],
      evidence: [t('boundedProcedures.test.ts'), t('flexibleCasting.test.ts')],
    },
  ),
  engineEntry(
    'item-reset-executor-v1',
    'resolveRestEventItemResets',
    s('itemResetExecutor.ts'),
    'bounded-procedure',
    {
      operation:
        'Reset the economies and timers of canonical pack-bound item instances on rest events and crossed clock boundaries, as declared by their magic-item records, returning per-instance evidence.',
      requiredInputs: [
        'The campaign database',
        'A rest event and its participants, or an elapsed-time interval',
      ],
      exclusions: [
        'A malformed clock interval throws ItemResetExecutorError.',
        'Items not bound to a pack record are reset by the generic usage counters, not here.',
      ],
      residualDmInterpretation: [
        'The DM adjudicates item behavior outside the declared resets.',
      ],
      runtimeOwner: [
        s('itemResetExecutor.ts'),
        s('itemTimers.ts'),
        s('itemState.ts'),
      ],
      evidence: [t('itemResetExecutor.test.ts'), t('itemTimers.test.ts')],
    },
  ),
  engineEntry(
    'progression-event-ledger-v1',
    'recordProgressionEvent',
    s('progression.ts'),
    'state-integrity',
    {
      operation:
        'Append an insert-only progression event (such as a level-up or an experience award) to the progression ledger, so corrections are new compensating events and never edits.',
      requiredInputs: [
        'characterId',
        'kind',
        'source',
        'resultingLevel',
        'provenance',
      ],
      exclusions: [
        'Storage only: implements no advancement mechanics or eligibility.',
      ],
      residualDmInterpretation: [
        'The DM decides awards and milestones within the campaign advancement policy.',
      ],
      runtimeOwner: [
        s('progression.ts'),
        s('levelUpEligibility.ts'),
        s('advancementPolicy.ts'),
      ],
      evidence: [t('progression.test.ts'), t('progressionAwards.test.ts')],
    },
  ),
];

export const DETERMINISTIC_CAPABILITY_INVENTORY: readonly DeterministicCapabilityInventoryEntry[] =
  Object.freeze([
    ...DICE_AND_RESOLUTION,
    ...HP_CONDITIONS_EFFECTS,
    ...COMBAT_AND_TURNS,
    ...ITEMS_AND_CURRENCY,
    ...SPELLS_RESTS_USAGE,
    ...WORLD_AND_RULINGS,
    ...ENGINE_PATHS,
  ]);

/**
 * Registered tools that make no deterministic rules commitment of their own,
 * with the reason. They are accounted for here so the closure test can name
 * every tool in `createDefaultToolRegistry()`; being listed is not a claim
 * that the tool is unimportant.
 */
export const NON_CAPABILITY_TOOLS: Readonly<Record<string, string>> =
  Object.freeze({
    lookup_rules:
      'read-only retrieval of rules records; makes no deterministic rules commitment',
    world_query:
      'read-only retrieval of module and overlay canon; marks DM-only fields with annotations but does not enforce visibility',
    memory_drilldown:
      'read-only retrieval of omitted memory windows; makes no deterministic rules commitment',
  });

/**
 * Report on the legacy magic-item `executionReadiness` / `engine:F` backlog.
 *
 * This is an UNSELECTED CANDIDATE BACKLOG. Its numbers are never a count of
 * implemented capabilities and never a count of absent ones: a clause being
 * pending, carrying engine hooks, or being green says nothing about whether
 * Eshyra has selected a capability for it (ADR 0020 section 3). Only
 * {@link DETERMINISTIC_CAPABILITY_INVENTORY} lists capabilities in force.
 */
export interface MagicItemCapabilityBacklogSummary {
  readonly disposition: 'unselected-candidate-backlog';
  readonly nonClaim: string;
  /** Magic-item records in the supplied pack records. */
  readonly records: number;
  /** Magic-item records that carry an executionReadiness block. */
  readonly recordsWithReadiness: number;
  /** Readiness clauses across those records. */
  readonly clauses: number;
  /** Clauses whose readiness is engine-pending. */
  readonly enginePendingClauses: number;
  /** Clauses carrying at least one engineHooks entry (an engine:F label). */
  readonly hookCarryingClauses: number;
  /** Clauses that are both engine-pending and hook-carrying. */
  readonly enginePendingHookCarryingClauses: number;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Computes the unselected legacy backlog report from pack records by query;
 * nothing is hand-copied.
 */
export function summarizeMagicItemCapabilityBacklog(
  records: readonly RulesRecord[],
): MagicItemCapabilityBacklogSummary {
  let magicItems = 0;
  let withReadiness = 0;
  let clauses = 0;
  let enginePending = 0;
  let hookCarrying = 0;
  let pendingAndHooked = 0;
  for (const record of records) {
    if (record.kind !== 'magic-item') continue;
    magicItems += 1;
    const readiness = asObject(asObject(record.data)?.executionReadiness);
    if (readiness === undefined || !Array.isArray(readiness.clauses)) continue;
    withReadiness += 1;
    for (const raw of readiness.clauses) {
      const clause = asObject(raw);
      if (clause === undefined) continue;
      clauses += 1;
      const pending = clause.readiness === 'engine-pending';
      const hooked =
        Array.isArray(clause.engineHooks) && clause.engineHooks.length > 0;
      if (pending) enginePending += 1;
      if (hooked) hookCarrying += 1;
      if (pending && hooked) pendingAndHooked += 1;
    }
  }
  return {
    disposition: 'unselected-candidate-backlog',
    nonClaim:
      'Unselected candidate backlog from the legacy magic-item executionReadiness data: not counted as implemented capabilities and not counted as absent ones; unbound or unselected entries make no claim about either.',
    records: magicItems,
    recordsWithReadiness: withReadiness,
    clauses,
    enginePendingClauses: enginePending,
    hookCarryingClauses: hookCarrying,
    enginePendingHookCarryingClauses: pendingAndHooked,
  };
}
