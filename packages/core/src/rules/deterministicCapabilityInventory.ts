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
 * Closure is claimed over two bounded populations (see
 * `packages/core/test/deterministicCapabilityInventory.test.ts`): every tool in
 * `createDefaultToolRegistry()` appears exactly once, either as an entry here
 * or in {@link NON_CAPABILITY_TOOLS}; and every module file under
 * `packages/core/src` (except the `index.ts` and `internal.ts` barrels) has
 * exactly one disposition in {@link MODULE_DISPOSITIONS}, either covered by the
 * entries that name it as a runtime owner or not a deterministic commitment,
 * with the reason. The module population is file-level only: it is not a symbol
 * census and makes no claim that every function of a covered module is a
 * separate capability.
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
      'A malformed expression is refused (invalid_dice).',
      'Does not decide what the roll is for, which modifiers belong in the expression, or what the result means.',
      'Does not cancel advantage against disadvantage or add sheet-derived modifiers; resolve_check does that for d20 tests.',
      'visibility and category are optional; a value outside their enumerations is refused by input-schema validation before the roll, and a given value is echoed in the result.',
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
      'Resolve an opposed contest: side a then side b each roll one ability-check d20 with their own declared modifiers, proficiency, and advantage or disadvantage; the higher total wins, and equal totals are reported as a tie with no winner.',
    requiredInputs: ['reason', 'a', 'b'],
    exclusions: [
      'Both sides always roll; a contest against an already-fixed total is not resolved here (resolve_retained_check compares against a retained total).',
      'Does not derive modifiers or proficiency from a character sheet; each side declares its own.',
      'Reports a tie but does not apply what a tie means in the fiction.',
      'Does not decide that a contest applies or what winning changes.',
    ],
    residualDmInterpretation: [
      'The DM decides whether a contest applies, which checks each side makes, the modifiers, proficiency, and advantage each side has, and what a tie or a win changes.',
    ],
    runtimeOwner: [
      o('toolResolveContest.ts'),
      o('resolution.ts'),
      o('toolResolutionShared.ts'),
    ],
    evidence: [t('resolutionTools.test.ts'), t('resolution.test.ts')],
  }),
  toolEntry('roll_retained_check', 'state-integrity', {
    operation:
      'Roll an ability check d20 from the seeded RNG with declared modifiers, proficiency, and advantage or disadvantage, and persist the total as an active retained check (linked to the active combat instance when one exists; visibility defaults to dm_only).',
    requiredInputs: ['kind', 'reason', 'label'],
    exclusions: [
      'Only ability_check is accepted.',
      'Does not derive modifiers from a character sheet; the caller declares them.',
      'A participant, when given, must be an existing character or a combatant in the active combat instance; it is optional and is not checked against who is actually hiding.',
      'Does not decide who is hiding or who the observers are.',
    ],
    residualDmInterpretation: [
      'The DM decides whether the check applies, which modifiers and advantage count, and which creatures could observe the result.',
    ],
    runtimeOwner: [
      o('toolRollRetainedCheck.ts'),
      o('toolRetainedCheckShared.ts'),
      o('toolResolutionShared.ts'),
    ],
    evidence: [t('retainedChecks.test.ts')],
  }),
  toolEntry('resolve_retained_check', 'bounded-procedure', {
    operation:
      'Compare an active retained check total with exactly one fresh opposing ability check (search) or a list of passive scores (computed through calc passive_score), record all of the call comparisons in one transaction (an invalid passive entry records none), and report an observer as noticing only when its total is strictly higher than the retained total.',
    requiredInputs: ['retainedCheckId', 'reason'],
    exclusions: [
      'Exactly one of search or passive is required; both or neither is refused.',
      'An unknown retained check (not_found) or an ended one (retained_check_ended) is refused.',
      'A search needs a label and a passive entry needs a label and an integer modifier; observer participant identity is optional here (set_surprised later requires it).',
      'Does not decide which observers can perceive the hider or what noticing changes in the fiction.',
    ],
    residualDmInterpretation: [
      'The DM chooses the observers, their declared modifiers and advantage, and what follows when an observer notices or fails to notice.',
    ],
    runtimeOwner: [
      o('toolResolveRetainedCheck.ts'),
      o('calc.ts'),
      o('toolRetainedCheckShared.ts'),
      o('toolResolutionShared.ts'),
    ],
    evidence: [t('retainedChecks.test.ts')],
  }),
  toolEntry('end_retained_check', 'state-integrity', {
    operation:
      'Mark one active retained check ended with the reason discovered or stopped, in one transaction.',
    requiredInputs: ['retainedCheckId', 'reason'],
    exclusions: [
      'This tool is the only writer that ends a retained check, and only when called; nothing ends one automatically (combat close included), and whether the creature was discovered or stopped hiding is not decided here.',
      'An unknown or already-ended retained check is refused (not_found_or_ended); there is no idempotent no-op.',
    ],
    residualDmInterpretation: [
      'The DM decides whether and when the creature is discovered or stops hiding.',
    ],
    runtimeOwner: [o('toolEndRetainedCheck.ts')],
    evidence: [t('retainedChecks.test.ts')],
  }),
  toolEntry('resolve_damage', 'bounded-procedure', {
    operation:
      'Roll 1-10 declared damage packets once from the seeded RNG (doubling each packet dice count on critical:true), aggregate same-type packets with a floor of 0 per type, and, when targets are declared (up to 20), apply per target and per type: immune types to zero, resisted types halved rounding down, then vulnerable types doubled.',
    requiredInputs: ['reason', 'packets'],
    exclusions: [
      'Keep/drop dice notation is refused in a damage packet, and a damage type repeated within one resistance, vulnerability, or immunity list is refused.',
      'Without declared targets only the per-type aggregate is returned.',
      'Does not change hit points; adjust_hp or update_combatant applies the result.',
      'Does not decide which resistances, vulnerabilities, or immunities a target has; the caller declares them per target.',
      'Does not decide whether an attack hit or was a critical hit.',
    ],
    residualDmInterpretation: [
      'The DM decides the damage dice and types, whether the hit is critical, which targets are affected, and which resistances, vulnerabilities, or immunities apply.',
    ],
    runtimeOwner: [
      o('toolResolveDamage.ts'),
      o('resolution.ts'),
      o('toolResolutionShared.ts'),
    ],
    evidence: [t('resolutionTools.test.ts'), t('resolution.test.ts')],
  }),
  ledgerEntry(
    'resolve-spell-upcast-v1',
    { kind: 'tool', name: 'resolve_spell_upcast' },
    'bounded-procedure',
  ),
  toolEntry('calc', 'state-integrity', {
    operation:
      'Evaluate one registered dice-free rules formula (breath-hold duration, carrying capacity, days without food, encumbrance thresholds, fall damage dice, forced-march DC, grapple escape DC, group check outcome, jump distance, passive score, suffocation survival rounds) with validated named arguments.',
    requiredInputs: ['formula', 'args', 'reason'],
    exclusions: [
      'An unregistered formula is refused by input-schema validation, and invalid or unknown arguments are rejected (invalid_formula); there is no generic expression engine.',
      'Does not roll dice; fall damage dice returns an expression for the caller to roll.',
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
        'Apply a signed integer hit point change to a character in one transaction. Damage consumes temporary hit points first. Dropping from above 0 to 0 makes the character dying, or dead when the overflow reaches the effective hit point maximum, or, with knockOut=true, stable (at 0 hit points, with death-save counters reset) with a seeded stable-recovery schedule. Damage at 0 hit points is dead when the whole damage reaches the effective maximum, otherwise adds a death-save failure (two on a critical) and returns a stable character to dying. Healing a non-alive character who ends above 0 hit points restores alive and clears death-save counters. When damage leaves a living concentrating character alive, reports concentrationCheck with its DC; leaving alive breaks the character concentration in the same transaction (reported as concentrationBroken). Death clears a recovery block and ends the character attunements.',
      requiredInputs: ['amount'],
      exclusions: [
        'Characters only; encounter combatants use update_combatant.',
        'Any change to a dead character is refused; healing is refused while the character is suffocating.',
        'knockOut is refused with a non-damage amount, while suffocating, or when the character is already at 0 hit points or dead; with damage that does not reach 0 hit points it has no effect.',
        'A character whose hit point maximum is 0 (uninitialized sheet) is clamped without the death machine.',
        'Does not roll the concentration save (resolve_concentration does) or death saves (record_death_save records them).',
        'Does not compute damage amounts, resistance, or whether a hit was critical.',
      ],
      residualDmInterpretation: [
        'The DM decides the amount, whether the hit is critical, whether a knockout is intended, and the fiction around revival or unconsciousness.',
      ],
      runtimeOwner: [
        o('toolAdjustHp.ts'),
        s('hpLifecycle.ts'),
        s('attunement.ts'),
      ],
      evidence: [t('hpLifecycle.test.ts'), t('toolCharacterTargeting.test.ts')],
    }),
    toolEntry('grant_temporary_hp', 'bounded-procedure', {
      operation:
        'Grant a positive amount of temporary hit points to a character who is not dead as a separate buffer that never stacks: with an existing buffer, replace=true takes the new pool, replace=false keeps the old one, and omitted takes the new pool only when it is at least as large. Granting at 0 hit points does not restore consciousness or change death state.',
      requiredInputs: ['amount'],
      exclusions: [
        'A non-positive amount and a dead character are refused.',
        'Does not heal and does not change real hit points.',
        'Does not decide whether a granting effect ends earlier than a long rest; complete_long_rest expires the buffer.',
      ],
      residualDmInterpretation: [
        'The DM decides the amount and, when a buffer already exists, relays the player choice between the old and new pool.',
      ],
      runtimeOwner: [o('toolGrantTempHp.ts'), s('hpLifecycle.ts')],
      evidence: [t('hpLifecycle.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('record_death_save', 'bounded-procedure', {
      operation:
        'Apply a caller-supplied natural d20 result (integer 1-20) to a dying character, or to a dying opted-in player-character combatant in the active combat instance: 10 or more is a success, less than 10 a failure, a natural 1 two failures, a natural 20 revives to 1 hit point unless recovery is blocked or the effective maximum is 0 (then an ordinary success); three successes stabilize unless recovery is blocked, and three failures kill. Stabilizing schedules a seeded stable recovery.',
      requiredInputs: ['roll'],
      exclusions: [
        'The natural result is supplied by the caller and only range-checked; the tool does not verify that it came from the roll tool.',
        'Refused unless the target is dying (a character) or a dying player-character-rules combatant in the active combat instance.',
        'Providing both character and combatantId is refused.',
        'Does not decide when a death save is owed.',
      ],
      residualDmInterpretation: [
        'The DM decides when a death save is owed and obtains the natural result through roll.',
      ],
      runtimeOwner: [
        o('toolRecordDeathSave.ts'),
        s('hpLifecycle.ts'),
        s('encounterCombatants.ts'),
        s('combatantLifecycle.ts'),
      ],
      evidence: [t('hpLifecycle.test.ts'), t('encounterCombatants.test.ts')],
    }),
    toolEntry('stabilize_character', 'bounded-procedure', {
      operation:
        'Mark a dying character, or a dying opted-in player-character combatant in the active combat instance, stable with a seeded stable-recovery schedule, resetting death-save counters.',
      requiredInputs: [
        'character or combatantId (at most one; the acting character when neither is given)',
      ],
      exclusions: [
        'Refused unless the target is dying (a character) or a dying player-character-rules combatant in the active combat instance, and refused while recovery is blocked by suffocation.',
        'Providing both character and combatantId is refused.',
        'Does not roll or judge the stabilizing check and does not decide that a stabilizing effect occurred.',
      ],
      residualDmInterpretation: [
        'The DM decides whether a successful check or stabilizing effect occurred.',
      ],
      runtimeOwner: [
        o('toolStabilizeCharacter.ts'),
        s('hpLifecycle.ts'),
        s('encounterCombatants.ts'),
      ],
      evidence: [t('hpLifecycle.test.ts'), t('combatantRepairsBatchG.test.ts')],
    }),
    toolEntry('set_suffocation', 'bounded-procedure', {
      operation:
        'Apply a suffocation event immediately when called. drop sets the character to 0 hit points dying with a suffocating recovery block (a combatant under player-character rules becomes dying with the block, under monster rules dies, and one with a vanish or revert zero-hit-point rule becomes absent or reverts); breathe clears the block and, when a dying target already has three death-save successes, stabilizes it with a seeded recovery schedule. A drop that takes a conscious target down or out of play breaks its concentration in the same transaction.',
      requiredInputs: ['event'],
      exclusions: [
        "The tool does not time the drop: it takes effect when called, so the start-of-turn timing after the survival interval is the caller's to observe (calc suffocation_survival_rounds gives the interval).",
        'drop is refused for a dead character or combatant (and changes nothing for a target already suffocating); breathe is refused when there is no suffocation block.',
        'Providing both character and combatantId is refused; a combatant must be in the active combat instance.',
        'Must not be replaced by an hp adjustment: the drop is not damage.',
      ],
      residualDmInterpretation: [
        'The DM decides when breath runs out, when the survival interval elapses, when breathing resumes, and the fiction around the drop.',
      ],
      runtimeOwner: [
        o('toolSetSuffocation.ts'),
        s('hpLifecycle.ts'),
        s('encounterCombatants.ts'),
        s('combatantLifecycle.ts'),
      ],
      evidence: [t('hpLifecycle.test.ts'), t('zeroHpRevertRules.test.ts')],
    }),
    toolEntry('adjust_exhaustion', 'bounded-procedure', {
      operation:
        'Change the exhaustion level of a character, or of a combatant by exact id (through update_combatant), by a non-zero integer from -6 to 6, clamped to levels 0-6; level 6 kills, level 4 or higher halves the hit point maximum (clamping current hit points), and a level below 1 removes exhaustion.',
      requiredInputs: ['delta'],
      exclusions: [
        'Applies only the level 4 and level 6 effects; the effects of other levels are declared on the relevant rolls by the caller.',
        'Providing both character and combatantId is refused, and an unknown combatant is refused.',
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
        "Add a condition (id plus any extra fields) to a character's stored conditions, a no-op when the id is already present; adding incapacitated, or a condition whose rules record implies incapacitation, to a character with no stored incapacitating condition atomically breaks the character's concentration.",
      requiredInputs: ['id'],
      exclusions: [
        'Characters only; encounter combatants use update_combatant.',
        'Exhaustion and exhausted are refused; adjust_exhaustion changes exhaustion.',
        'Extra fields such as duration or severity are preserved on the condition but not interpreted here (start_effect owns timed lifecycles).',
        'Does not decide whether a condition applies or how long it lasts.',
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
        'Exhaustion and exhausted are refused; adjust_exhaustion changes exhaustion.',
        'Does not decide that a condition ended and does not touch a condition owned by an active effect differently from any other condition with that id.',
      ],
      residualDmInterpretation: [
        'The DM decides that the condition has ended.',
      ],
      runtimeOwner: [o('toolRemoveCondition.ts'), s('domainMutations.ts')],
      evidence: [t('hpLifecycle.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('award_inspiration', 'bounded-procedure', {
      operation: "Set a living character's binary inspiration resource.",
      requiredInputs: ['character (the acting character when omitted)'],
      exclusions: [
        'A dead character and a character who already has inspiration are refused (it cannot be stockpiled).',
        'Does not decide whether a deed earns inspiration.',
      ],
      residualDmInterpretation: [
        'The DM decides whether the character earned inspiration.',
      ],
      runtimeOwner: [o('toolAwardInspiration.ts'), s('inspiration.ts')],
      evidence: [t('inspiration.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('use_inspiration', 'bounded-procedure', {
      operation:
        "Spend a character's inspiration, or transfer it to another character with giftTo.",
      requiredInputs: ['character (the acting character when omitted)'],
      exclusions: [
        'Refused when the character has no inspiration.',
        'A gift to oneself, to a dead character, or to a character who already has inspiration is refused.',
        'Spending only clears the stored resource and returns an advantage note; it does not apply advantage to any roll.',
      ],
      residualDmInterpretation: [
        'The DM applies the advantage to one attack roll, saving throw, or ability check.',
      ],
      runtimeOwner: [o('toolUseInspiration.ts'), s('inspiration.ts')],
      evidence: [t('inspiration.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('start_effect', 'bounded-procedure', {
      operation:
        'Start one durable active effect (concentration or timed spell effect, condition package, curse, ward, summon control, or activated item power) in one transaction. Source grounding depends on the source form. A spell source must resolve to a spell record in the bound rules stack; when that record carries a duration text, its concentration marker must match the declaration (required or forbidden), and its parsed duration form constrains the declared duration: a timed record (a number of rounds, minutes, hours, or days) requires a timed duration with the same amount and unit; until dispelled requires until-removed; until dispelled or triggered requires until-trigger; and an instantaneous record is refused unless the effect is a summoning whose record mechanics declare a persistent-linked summon with an active initial link (Find Familiar, Find Steed), which is admitted as a bonded summon. A duration text in no recognized form constrains concentration but not the duration, and a record without a duration text constrains neither. A magic-item source that names a ref must resolve to a magic-item record; other source kinds are not grounded in a record. A new concentration effect ends the owner previous live concentration effect in the same transaction; projected conditions, linked actors, zones, and forms are owned by the effect.',
      requiredInputs: ['effectId', 'kind', 'displayName', 'source', 'duration'],
      exclusions: [
        'An existing effect id (whatever its status) is refused, and an id ending in the reserved "<id>:uncontrolled" suffix is refused.',
        'The kind limits which source kinds, concentration, and projections an effect may declare; structurally meaningless combinations, an owned entity that already has an owning effect, and a condition the target already has are refused before any write.',
        'A bonded summon (the instantaneous persistent-linked case above) requires an until-removed duration, a source actor that is a character or campaign actor (not a combatant), and at least one linked actor (and no more than the record maximum, when it gives one), and is refused while the same caster already holds a live effect from that spell with an active actor link (one bond per caster per spell).',
        'The timed record check compares amount and unit only, not the anchor; a ruling or item source, and a spell record whose duration is unrecognized or absent, leave the declared duration to the caller.',
        'If projecting a condition cascades back and ends the effect mid-creation, the creation is refused and nothing is committed.',
        'Does not apply the consequences of the effect beyond the condition, actor, zone, and form projections it owns.',
      ],
      residualDmInterpretation: [
        'The DM decides that an effect starts, its targets and source, and the consequences of the effect beyond the projections it owns.',
      ],
      runtimeOwner: [
        o('toolStartEffect.ts'),
        o('toolEffectShared.ts'),
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
        'End one active or suppressed effect with a declared reason in one transaction: mark it ended and apply the cleanup policy of each of its active links (the break policy for concentration-broken, otherwise the end policy), so each owned projection is removed, released, or reverted; a linked creature in its pocket dimension is removed whatever the policy. Removing an owned creature can cascade beyond this effect, for example by breaking that creature own concentration. A concentration-broken end of a spell effect whose record declares an uncontrolled removal (Conjure Elemental, Conjure Fey) and whose creatures were released creates the engine-owned "<id>:uncontrolled" successor effect. Ending an already-ended effect again with the same reason (and the same detail, when one is given) is an unchanged no-op.',
      requiredInputs: ['effectId', 'reason'],
      exclusions: [
        'An unknown effect is refused, and ending an already-ended effect with a different reason, or a different given detail, is refused.',
        'A live linked creature with a revert-form zero-hit-point rule whose link carries a non-revert policy (recorded before natural forms were) refuses the end instead of guessing its form.',
        'dismissed requires a dismissible effect; concentration-broken requires a concentration effect and a directly declarable cause; ruled requires a note; expired is validated against the declared timer (an until-trigger effect needs its trigger named, and a round timer anchored to a still-active combat instance cannot expire before its deadline).',
        'Damage-triggered concentration saves go through resolve_concentration, not here.',
        'An effect can also end without this tool, for example through owned-creature cleanup cascades, combat closure, elapsed-time expiry, replacement by a new concentration effect, its concentration owner leaving the alive state, and a failed concentration save.',
        'Does not decide that the effect ended.',
      ],
      residualDmInterpretation: [
        'The DM decides that the effect ended and which reason applies.',
      ],
      runtimeOwner: [
        o('toolEndEffect.ts'),
        o('toolEffectShared.ts'),
        s('activeEffects.ts'),
      ],
      evidence: [
        t('activeEffects.test.ts'),
        t('conjureUncontrolledRemoval.test.ts'),
      ],
    }),
    toolEntry('suppress_effect', 'state-integrity', {
      operation:
        'Mark an active effect suppressed without ending it, leaving its targets, owned projections, concentration slot, links, and identity unchanged.',
      requiredInputs: ['effectId'],
      exclusions: [
        'Only an active effect can be suppressed; a suppressed or ended effect is refused.',
        'Does not end, dispel, or dismiss the effect, and a suppressed effect remains subject to ending by other routes.',
        'Does not decide that suppression applies.',
      ],
      residualDmInterpretation: [
        'The DM decides that the effect is suppressed and for how long.',
      ],
      runtimeOwner: [
        o('toolSuppressEffect.ts'),
        o('toolEffectShared.ts'),
        s('activeEffects.ts'),
      ],
      evidence: [t('bondedSummonTransitions.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('unsuppress_effect', 'state-integrity', {
      operation:
        'Restore a suppressed effect to active status without creating a new effect or changing its targets, projections, concentration slot, links, or identity.',
      requiredInputs: ['effectId'],
      exclusions: [
        'Only a suppressed effect can be unsuppressed; an active or ended effect is refused.',
        'Does not undo an end, dispel, dismissal, or concentration loss.',
        'Does not decide that suppression is over.',
      ],
      residualDmInterpretation: [
        'The DM decides that suppression has stopped.',
      ],
      runtimeOwner: [
        o('toolUnsuppressEffect.ts'),
        o('toolEffectShared.ts'),
        s('activeEffects.ts'),
      ],
      evidence: [t('bondedSummonTransitions.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('refresh_effect', 'state-integrity', {
      operation:
        'Re-anchor the timer of an active effect in one transaction and record a refreshed event with the previous and next duration. With no duration supplied, the stored duration (kind, amount, unit, anchor, trigger) is re-validated and re-anchored; with a duration supplied, it replaces the stored one after the shared duration validation. Spell-record grounding is narrower than at creation: only when a duration is supplied, the effect source is a spell, and that record duration parses as timed must the supplied duration be timed with the same amount and unit.',
      requiredInputs: ['effectId'],
      exclusions: [
        'Only an active effect can be refreshed; an unknown effect, a suppressed effect (unsuppress first), and an ended effect (a re-established effect is a new start_effect) are refused.',
        'A supplied duration is not checked against a spell record whose duration is until dispelled, until dispelled or triggered, instantaneous (a bonded summon), unrecognized, or unavailable, and not against a ruling or item source: unlike creation, such a refresh can change the duration form (for example an until-removed Continual Flame effect to a timed one).',
        'Changes no status, target, link, projection, or concentration owner.',
        'Does not decide that a rule renews the effect.',
      ],
      residualDmInterpretation: [
        'The DM decides that a rule renews the effect and whether any new duration fits its source.',
      ],
      runtimeOwner: [
        o('toolRefreshEffect.ts'),
        o('toolEffectShared.ts'),
        s('activeEffects.ts'),
      ],
      evidence: [t('activeEffects.test.ts'), t('tools.test.ts')],
    }),
    toolEntry('remove_effect_target', 'state-integrity', {
      operation:
        "Remove one target from a live effect: mark the target removed, then apply the cleanup policy of each active link on that target (projected conditions removed; owned creatures removed, released, or reverted). Normally the effect and its other targets continue. Owned-creature cleanup can cascade, for example by breaking another owner's concentration, and end this very effect: the result then reports superseded:true with the effect ended, and no target-removed event follows the terminal event.",
      requiredInputs: ['effectId', 'target', 'reason'],
      exclusions: [
        'An ended effect (including one ended by an earlier removal cascade) and an unknown target are refused.',
        'Repeating a removal with the same reason is an unchanged no-op only while the target is already removed and the effect has not ended; a different reason is refused.',
        'Does not end the effect by itself, but a cascade it triggers may; end_effect is not the only route to an ended effect.',
        'Does not decide that the target is released from the effect.',
      ],
      residualDmInterpretation: [
        'The DM decides that the target is no longer affected, for example after a successful save.',
      ],
      runtimeOwner: [
        o('toolRemoveEffectTarget.ts'),
        o('toolEffectShared.ts'),
        s('activeEffects.ts'),
      ],
      evidence: [t('activeEffects.test.ts'), t('zeroHpRevertRules.test.ts')],
    }),
    toolEntry('recast_bonded_summon', 'bounded-procedure', {
      operation:
        "Record that the summoner casts a bonded-summon spell again while exactly one durable bonded creature stays linked to an active summoning effect: the spell record's cast-again transition for the creature's modelled presence restores an absent creature (at its effective maximum hit points, or in a chosen listed form) or reforms a present or pocketed one, in one transaction.",
      requiredInputs: ['effectId', 'spellRef'],
      exclusions: [
        'Refused for an ended or suppressed effect, a non-summoning effect, an effect not recorded from that exact spell (a ruling-sourced bond), an effect without exactly one active durable actor link, a presence the spell has no transition for (for example a present Find Steed), and a creature that still has a combatant in an active combat instance.',
        'A spell that restores the same creature takes no form; a spell that lets it adopt a form requires one of the forms its record lists.',
        'Spends no spell slot; spend_spell_slot does.',
        'Does not decide that the spell was cast.',
      ],
      residualDmInterpretation: [
        'The DM decides that the summoner recasts the spell and, where the spell allows a form, which form is chosen.',
      ],
      runtimeOwner: [
        o('toolRecastBondedSummon.ts'),
        o('toolEffectShared.ts'),
        s('activeEffects.ts'),
        s('encounterCombatants.ts'),
      ],
      evidence: [
        t('bondedSummonRecast.test.ts'),
        t('bondedSummonPactOfTheChain.test.ts'),
      ],
    }),
    toolEntry('transition_bonded_summon', 'bounded-procedure', {
      operation:
        "Execute the action-triggered presence transition a bonded-summon spell record declares for the trigger and the creature's modelled presence: temporary dismissal to a pocket dimension, recall, dismissal, permanent dismissal, or release. A creature that leaves play while it has a combatant in the active combat instance first has participant-turn timers anchored to that combatant expired and its effect references rebound onto its durable campaign actor, then becomes pocketed or absent. Release and permanent dismissal close the actor link and target (removed with a bond-ended reason) and end the effect (reason dismissed) when it was the effect's last owned creature.",
      requiredInputs: ['effectId', 'spellRef', 'trigger'],
      exclusions: [
        'Refused for an ended or suppressed effect, a non-summoning effect, an effect not recorded from that exact spell, an effect without exactly one active durable actor link, a creature without the vanish-bonded zero-hit-point rule, a spell with no transition for that trigger and presence, a transition gated by an unresolved source ambiguity, and a transition the engine does not execute; nothing changes when refused.',
        'A recalled creature enters an active combat instance as a new combatant, and side is required then when it has no earlier combatant in that instance.',
        'Spends no action; spend_turn_resource does. Where a recalled creature appears and its initiative are narrated, not tracked.',
      ],
      residualDmInterpretation: [
        'The DM decides that the summoner takes the triggering action and where a recalled creature appears.',
      ],
      runtimeOwner: [
        o('toolTransitionBondedSummon.ts'),
        o('toolEffectShared.ts'),
        s('activeEffects.ts'),
        s('encounterCombatants.ts'),
      ],
      evidence: [t('bondedSummonTransitions.test.ts')],
    }),
  ];

// ---------------------------------------------------------------------------
// Combat and turns
// ---------------------------------------------------------------------------

const COMBAT_AND_TURNS: readonly DeterministicCapabilityInventoryEntry[] = [
  toolEntry('start_encounter', 'state-integrity', {
    operation:
      'Open a new live combat instance in one transaction, closing any open short-rest recovery windows: creatures of an authored encounter template found in an active adventure run become instance-only enemy-side combatants with hit points and armor class from their creature records, and persistent campaign actors are admitted with their own hit points and state.',
    requiredInputs: ['encounterId or at least one actor (one of)'],
    exclusions: [
      'Refused while another combat instance is active, when the encounter is not found in an active adventure run, and when encounterId is given without an adventure module resolver.',
      'An absent actor is admitted only as a new manifestation with hpCurrent above 0 and no carried-over conditions; an absent actor still bonded to its summoner, a pocketed actor, an engine-owned combat lifecycle in the input, and a dead, dying, or stable actor given replacement hit points are refused, as is a creature with a vanish or revert zero-hit-point rule admitted at 0 hit points.',
      'Initiative and turn order are narrated, not tracked.',
    ],
    residualDmInterpretation: [
      'The DM decides that combat starts, which encounter or actors take part, and the initiative order.',
    ],
    runtimeOwner: [o('toolStartEncounter.ts'), s('encounterCombatants.ts')],
    evidence: [
      t('encounterCombatants.test.ts'),
      t('bondedSummonTransitions.test.ts'),
    ],
  }),
  toolEntry('join_combat', 'state-integrity', {
    operation:
      'Atomically admit creatures (instance-only combatants taking hit points, armor class, and heads from a creature record, with a required side and count of at least 1) and/or persistent actors (admitted under the same rules as start_encounter) into the active combat instance; any invalid entry writes nothing.',
    requiredInputs: [
      'creatures or actors (at least one entry; side on every entry)',
    ],
    exclusions: [
      'Refused when no combat instance is active, when a creature ref does not resolve as a creature record, and when an actor is already in this instance as a non-absent combatant.',
      'A bonded absent actor, a pocketed actor, and the other start_encounter actor refusals apply to actors here too.',
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
      'Update one combatant of the active combat instance by exact id in one transaction: apply an hpDelta through the combatant lifecycle (monster rules by default: reaching 0 hit points kills, unless status unconscious declares a nonlethal knockout, after which any further damage kills; opted-in player-character rules: dying, death-save failures, instant death, and a status stable knockout when the damage takes it from above 0 to 0 hit points), add or remove conditions, set location and placement, and apply owned-creature zero-hit-point rules (vanish, vanish-bonded, revert to object or natural form) and multi-head tracking. Incapacitation breaks its concentration in the same transaction.',
    requiredInputs: ['combatantId'],
    exclusions: [
      'A combatant of an inactive instance is refused. A dead combatant cannot be healed or change status. An absent combatant accepts no damage, healing, condition, or status change. Explicit statuses absent and dying are refused.',
      'Status stable is refused except as the knockout of an opted-in player-character combatant dropped from above 0 to 0 hit points by this call; dying and stable otherwise come from the engine, and under monster rules stable is refused.',
      'deathRules player-character is refused for a creature with a zero-hit-point rule, for a combatant owned by an effect with a remove cleanup policy, and for a 0 hit point combatant that is not dead.',
      'A knockout, and any other status passed with damage to 0, is refused for creatures that vanish or revert at 0 hit points; escaped or inactive status together with an hpDelta is refused under player-character rules.',
      'Exhaustion cannot be added here; adjust_exhaustion changes it.',
      'Does not compute damage, resistance, or critical hits.',
    ],
    residualDmInterpretation: [
      'The DM decides the hit point change, which conditions apply, whether a knockout is intended, and whether a combatant opts into player-character death rules.',
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
      'Close the active combat instance (or one named active instance) with an inactive status so it cannot become active again, in one transaction, settling live (active or suppressed) effects in this order before the status flips. (1) Every round or participant-turn timer anchored to the instance expires, whatever its owner. (2) Concentration owned by a combatant of the instance breaks (owner-removed). (3) A combatant with a durable identity (a campaign-actor combatant, or one an active actor link claims for a campaign actor) has its current state projected onto that campaign actor, and every remaining live reference to it (actor and condition links, targets, the source-actor pointer) is rebound onto the campaign actor: its ownership, bonds, and conditions continue after combat. (4) Only the remaining instance-only references are cleaned: actor links on instance-only combatants are released, their effect targets are removed (combat-ended, which can cascade and end an effect), leftover condition links on them are removed, and source-actor pointers to them are detached. An effect with neither a timer anchored to the instance nor a concentration owner, link, target, or source actor among its combatants is untouched.',
    requiredInputs: ['status'],
    exclusions: [
      'An unknown instance, or no active instance when none is named, is refused, and an instance that is already closed cannot be closed again.',
      'Conflicting durable claims (a campaign actor already owned by another effect, a combatant with incompatible actor claims, or one campaign actor claimed by two closing combatants) refuse the whole close and nothing is committed; the refusal is reported as an effect_error result, as other effect-layer refusals are.',
      'A durable bond is not released at close: a bonded summon remains linked to its effect on its campaign actor and can be recast or admitted to a later encounter.',
      'Concentration and participant-turn timers are settled before rebinding and never move to the campaign actor.',
      'Does not decide that the fight is over.',
    ],
    residualDmInterpretation: [
      'The DM decides that combat has ended and whether it completed, was abandoned, fled, or interrupted.',
    ],
    runtimeOwner: [
      o('toolCloseCombatInstance.ts'),
      s('encounterCombatants.ts'),
      s('activeEffects.ts'),
    ],
    evidence: [
      t('encounterCombatants.test.ts'),
      t('activeEffects.test.ts'),
      t('bondedSummonTransitions.test.ts'),
      t('bondedSummonRecast.test.ts'),
    ],
  }),
  toolEntry('begin_turn', 'bounded-procedure', {
    operation:
      "Begin a turn for a combatant of the active instance or for a character, in one transaction: complete the previous participant's turn (counting it and clearing its surprise), settle its multi-head regrowth, record the new participant and round (never decreasing), reset the new participant's action, bonus action, free interaction, movement note, reaction use, and legendary actions, refresh every-turn reactions, settle due round and participant-turn effects, and report turnAvailable assessed after that settlement.",
    requiredInputs: [
      'combatantId or character (at most one; the acting character when neither is given)',
      'round, when a new combat round starts (a positive integer that never decreases)',
    ],
    exclusions: [
      'turnAvailable is false for a combatant that is dead, stable, escaped, inactive, or absent, and for a character only when it is dead; a dying participant keeps an available turn, and a stable character is available.',
      'An unavailable participant still establishes its boundary: its turn is counted and the active participant is cleared.',
      'A combatant must belong to the active instance; with no active combat instance the call is refused.',
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
      "Spend one participant's action-economy resource in the active combat instance (action, bonus action, reaction against its per-round allowance, free object interaction, movement note, or a legendary action charged at the cost its record gives the named option), and enforce the bonus-action-spell restriction on action, bonus action, and own-turn reaction casts using the spell record.",
    requiredInputs: ['resource', 'activity'],
    exclusions: [
      'Refused for an unavailable participant (dead, stable, escaped, inactive, or absent combatant; dead character), for any resource when the participant is surprised, over-budget spends, and on-turn resources off-turn.',
      'A legendary action is refused on the creature own turn, when no turn is open, when its record has none, when an option was already used at the end of this turn, for an unnamed or unknown option, and when its cost exceeds the remaining allowance.',
      'A spell cast must pass spellRef (action, bonus action, reaction, or legendary action only); an activity that reads like a spell cast without spellRef is refused.',
      'Movement is a narrative note, not a numeric budget; whether an activity satisfies the restriction on an extra reaction stays a ruling.',
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
      'Derive which observers are surprised from recorded passive comparisons and set the surprised flag in the active combat instance: an observer that noticed no hider is surprised, and a surprised participant loses its first turn. Each comparison id must be a distinct passive comparison from an active retained check rolled before or during the active instance, and every hider must be compared with the same complete observer set.',
    requiredInputs: ['comparisonIds'],
    exclusions: [
      'Refused with no active combat instance, for a non-passive, unknown, stale, or ended comparison, a duplicate hider/observer pair, an observer without participant identity or outside the instance, and hiders compared with different observer sets (mismatched_observer_sets).',
      'Does not check which side a hider or observer is on; selecting opposing hiders and observers is left to the caller.',
      'Surprise can be recorded only before a participant takes a turn or spends anything, and an unavailable participant (such as a dead one) refuses the call.',
      'Does not roll the hiders checks or decide who hides; roll_retained_check and resolve_retained_check do the rolls and comparisons.',
    ],
    residualDmInterpretation: [
      'The DM decides whether either side is trying to be stealthy and which creatures are hiders and observers, including that hiders are compared against opposing creatures.',
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
      "Record a completed gain of exact coin amounts (cp, sp, ep, gp, pp) in a character's wallet on the stored sheet and append a wallet event, atomically.",
    requiredInputs: ['amounts'],
    exclusions: [
      'At least one positive coin is required, and an unknown denomination is refused.',
      'The wallet is implemented only for characters whose sheet is under the dnd5e SRD system and pack, and needs a stored sheet.',
      'Does not decide that a reward, sale, or refund occurred.',
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
      "Record a completed exact-denomination payment from a character's wallet on the stored sheet and append a wallet event, atomically.",
    requiredInputs: ['amounts'],
    exclusions: [
      'A payment the wallet cannot cover in those exact denominations is refused; it does not break larger coins or make change (convert_currency does that explicitly).',
      'At least one positive coin is required; the wallet is implemented only for dnd5e SRD sheets.',
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
      'Record an exact denomination conversion in a character wallet, using the fixed copper values cp 1, sp 10, ep 50, gp 100, and pp 1000, preserving total value, and append a convert wallet event, atomically.',
    requiredInputs: ['amount', 'from', 'to'],
    exclusions: [
      'The same denomination twice, a non-positive amount, an amount the wallet lacks, and a conversion that does not divide exactly are refused.',
      'The wallet is implemented only for dnd5e SRD sheets.',
      'Not a purchase or sale.',
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
      'Create a new inventory row for a character, or, for a non-stateful row the same character already holds, set its name and quantity (default 1; replacing, not adding to, the stored quantity) and, when supplied, its location and properties. A packRef must resolve to a magic-item record in the active campaign stack; a stateful pack item gets a new unique row id with seeded initial item state.',
    requiredInputs: ['id', 'name'],
    exclusions: [
      'A row held by another character, a dropped row, a sold or lost row, a reserved expended-ammunition row, a quarantined row, and an id belonging to a different pack instance are refused; transfer_item and claim_item change custody.',
      'A variantId requires a packRef, a stateful item must have quantity 1, and an unresolvable packRef or variant is refused.',
      'Does not decide that the player receives, buys, or is granted an item.',
    ],
    residualDmInterpretation: [
      'The DM decides that the player explicitly receives the item and which item it is.',
    ],
    runtimeOwner: [
      o('toolGiveItem.ts'),
      s('domainMutations.ts'),
      s('inventoryIdentity.ts'),
      s('itemState.ts'),
      s('itemRandomInitialization.ts'),
    ],
    evidence: [t('itemAdoption.test.ts'), t('inventoryQueryGuard.test.ts')],
  }),
  toolEntry('adopt_item', 'state-integrity', {
    operation:
      'Recognize one legacy held inventory row as an exact canonical magic item from the active campaign rules stack, splitting stateful legacy stacks of at most 100 instances and quarantining incompatible or malformed legacy evidence for review; a quarantine is resolved only through a typed resolution action, atomically with the adoption.',
    requiredInputs: ['id', 'packRef'],
    exclusions: [
      'Never guesses from the display name; an exact packRef (and variantId where required) is required.',
      'Resolution needs durable GM evidence.',
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
      'Claim an existing unheld inventory row with disposition dropped whose world location equals the current campaign location, preserving its id, pack and variant identity, quantity, properties, mutable item state, and any attunement while clearing its world placement and setting wear state to not worn.',
    requiredInputs: ['id'],
    exclusions: [
      'A held row, a sold or lost row, a quarantined row, expended ammunition reserved for recover_ammunition, and a row whose location is unknown or different from the current location are refused.',
      'Does not decide that the character picks the item up.',
    ],
    residualDmInterpretation: [
      'The DM decides that the character explicitly picks up the item.',
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
      'Restore custody of one specifically identified sold or lost inventory row at the current campaign location, appending a custody event and clearing its world placement; basis found or returned applies only to a lost row, and basis repurchased applies only to a sold row and debits an exact-denomination payment in the same transaction.',
    requiredInputs: ['id', 'basis', 'evidence'],
    exclusions: [
      'Non-empty evidence is required; payment is required for repurchased and refused for the other bases.',
      'A dropped row (use claim_item), a quarantined row, an incompatible basis, and a row not at the current location are refused.',
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
      'Remote and unknown-location rows are not exposed, and expended ammunition reserved for recover_ammunition is omitted.',
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
      'List up to 20 sold or lost unheld rows at the current world location that are eligible for one basis (found and returned list lost rows, repurchased lists sold rows), excluding quarantined rows, with a truncated flag.',
    requiredInputs: ['basis'],
    exclusions: ['Changes no custody and does not list dropped loot.'],
    residualDmInterpretation: [
      'The DM decides whether a recovery is warranted by the scene.',
    ],
    runtimeOwner: [o('toolListRecoverableItems.ts'), s('domainMutations.ts')],
    evidence: [t('inventoryQueryGuard.test.ts'), t('currencyTools.test.ts')],
  }),
  toolEntry('use_item', 'bounded-procedure', {
    operation:
      'Use one rules-pack-bound inventory instance the character holds through an operation its magic-item record declares (or activate or deactivate through its state machine), in one transaction: require attunement when the record does, run the magic-item readiness preflight, select the state-machine transition, spend its economy costs (at-will free, stateless single-use reduces quantity, insufficient resources refused), apply declared depletion outcomes, and return the declared effect definitions.',
    requiredInputs: ['instanceId', 'operationId'],
    exclusions: [
      'A quarantined row, a row not bound to a pack item, an unresolvable packRef, a missing required attunement, a blocked readiness preflight (derived-magic-item-clauses-v1), an undeclared operation, an inert or nonmagical instance, an ambiguous transition lacking transitionTo, and an uninitialized dice-derived economy are refused.',
      'Returns the declared effects but does not start them (start_effect does) and does not execute item semantics outside the declared operation.',
    ],
    residualDmInterpretation: [
      'The DM decides whether the character may attempt the operation, supplies transition choices, starts any returned effect, and adjudicates source prose beyond the declared operation.',
    ],
    runtimeOwner: [
      o('toolUseItem.ts'),
      s('itemState.ts'),
      s('itemDepletion.ts'),
      'packages/core/src/campaign/capabilityPreflight.ts',
    ],
    evidence: [t('itemState.test.ts'), t('itemAdoption.test.ts')],
  }),
  toolEntry('transfer_item', 'state-integrity', {
    operation:
      'Transfer an existing inventory instance between two different characters without recreating it, preserving row id, pack and variant identity, quantity, charges, and item state, clearing holder-relative storage and world placement, and resetting wear state to not worn.',
    requiredInputs: ['id', 'to_character', 'attunement'],
    exclusions: [
      'The source must hold the row; an item with multiple attunements or one attuned outside the asserted source and campaign is refused.',
      'attunement must be explicit: require-unattuned refuses an attuned item, and end deletes the attunement in the same transaction.',
      'Source-declared cursed custody (and, when ending an attunement, cursed attunement) can refuse the transfer.',
      'Does not decide that the transfer happens.',
    ],
    residualDmInterpretation: [
      'The DM decides that the character hands the item over.',
    ],
    runtimeOwner: [
      o('toolTransferItem.ts'),
      s('itemTransfer.ts'),
      s('attunement.ts'),
    ],
    evidence: [t('itemTransfer.test.ts')],
  }),
  toolEntry('don_item', 'state-integrity', {
    operation:
      'Mark one held inventory item worn, adding the source-declared don-onset curse state condition when the pack item declares one.',
    requiredInputs: ['id'],
    exclusions: [
      'An item the character does not hold, an item with no authoritative wear state (ambiguous legacy placement fails closed), and an item already worn are refused.',
      'A pack-bound item whose record cannot resolve is refused.',
      'Does not decide whether the character can wear the item or how long donning takes.',
    ],
    residualDmInterpretation: [
      'The DM decides whether the item can be worn and the time it takes.',
    ],
    runtimeOwner: [
      o('toolWearItem.ts'),
      s('inventoryWear.ts'),
      s('curseState.ts'),
    ],
    evidence: [t('inventoryWear.test.ts')],
  }),
  toolEntry('doff_item', 'state-integrity', {
    operation:
      'Mark one held, worn inventory item not worn, enforcing source-declared cursed doff restrictions.',
    requiredInputs: ['id'],
    exclusions: [
      'An item the character does not hold, an item with no authoritative wear state, an item already not worn, and a cursed item that restricts doffing are refused.',
      'Wear is not inferred from inventory.location.',
      'Does not decide that the character removes the item or how long it takes.',
    ],
    residualDmInterpretation: [
      'The DM decides that the character removes the item and the time it takes.',
    ],
    runtimeOwner: [
      o('toolWearItem.ts'),
      s('inventoryWear.ts'),
      s('attunement.ts'),
      s('curseState.ts'),
    ],
    evidence: [t('inventoryWear.test.ts')],
  }),
  toolEntry('remove_item', 'state-integrity', {
    operation:
      'Apply an explicit disposition (destroyed, dropped, sold, or lost) to a held item, or destroy an unheld dropped row at the current location. destroyed deletes the row (or reduces quantity for a partial amount) and, for a full destruction, ends attunements and deletes its usage counters. A full drop, sale, or loss keeps the row unheld at the current world location with that disposition and clears wear state; a partial drop, sale, or loss splits a new unheld row.',
    requiredInputs: ['id', 'disposition'],
    exclusions: [
      'An unknown id returns removed:false instead of an error.',
      'A row held by another character, a quarantined row, and an unheld row that is not dropped or not at the current location are refused.',
      'A partial disposition of a row with per-instance state, usage counters, or an attunement is refused.',
      'Dropping, selling, or losing needs a known current world location and is refused for cursed custody the record restricts.',
      'Only dropped rows become claimable through claim_item; sold and lost rows return to custody only through reacquire_item.',
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
      'Record a living character attunement to an inventory item the character holds, enforcing at most three attunements, no second copy of the same item identity, one attuned creature per item, and, when the item resolves to a magic-item record, that the record requires attunement and has no engine-pending curse attunement lifecycle.',
    requiredInputs: ['itemId'],
    exclusions: [
      'An item the character does not hold, a quarantined row, a dead character, an itemRef that does not match the row packRef, an unresolvable packRef or variant, and an item whose record says it works without attunement are refused.',
      'A row with no packRef and no itemRef whose name resolves to no record is accepted under the cap and identity rules.',
      'Class and spellcaster prerequisites are returned as a note, not enforced.',
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
      'Refused when no such attunement exists. For any reason other than death, the item source-declared curse state is checked and can refuse the end; with reason death it is not checked.',
      'The reason is declared, not verified: the tool does not detect the 100 foot / 24 hour separation or check that a death occurred.',
      'Death ends attunements automatically: every character hit point write that moves life state into dead deletes all of that character attunements.',
    ],
    residualDmInterpretation: [
      'The DM decides that the ending condition occurred.',
    ],
    runtimeOwner: [o('toolEndAttunement.ts'), s('attunement.ts')],
    evidence: [t('attunement.test.ts'), t('itemAdoption.test.ts')],
  }),
  toolEntry('expend_ammunition', 'state-integrity', {
    operation:
      'Move a positive quantity (default 1) of a held inventory row to the current battlefield location as an unheld dropped row and record an ammunition expenditure against the active combat instance, so recover_ammunition can later account for it.',
    requiredInputs: ['itemId'],
    exclusions: [
      'Refused with no active combat instance, for a row the character does not hold or holds fewer of, and for the restrictions of dropping an item (unknown location, per-instance state on a partial amount, cursed custody).',
      "Does not check that the item is ammunition and does not enforce one piece per attack; the quantity is the caller's.",
      'Does not resolve attacks or decide which weapons require ammunition.',
    ],
    residualDmInterpretation: [
      'The DM decides that an ammunition weapon attacked, which row is ammunition, and how many pieces were used.',
    ],
    runtimeOwner: [
      o('toolExpendAmmunition.ts'),
      s('ammunition.ts'),
      s('domainMutations.ts'),
    ],
    evidence: [t('ammunition.test.ts')],
  }),
  toolEntry('recover_ammunition', 'bounded-procedure', {
    operation:
      "After the named combat instance is closed, and at the location where the character expended it, resolve all of the character's remaining expenditures for that instance: per ammunition identity, recover half of the expended pieces rounded down, limited to what is still present as dropped rows at the current location, and destroy the remaining present pieces.",
    requiredInputs: ['combatInstanceId'],
    exclusions: [
      'Refused for an unknown or still-active instance, when the character has no expended ammunition for that instance, and when any expenditure was at another location.',
      'The entitlement is half of the expended pieces per ammunition identity, capped by the pieces still present; pieces no longer present are reported as unavailable.',
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
      'Spend a spell slot for one spell resolved from the bound rules stack, in one transaction: a cantrip spends nothing but still runs the single-class build and slot-capacity validation; a leveled spell spends the lowest available slot of at least its level (created Flexible Casting slots before ordinary ones, and an explicit slotLevel selects that level), after resolving the source-bound upcast transform for the selected level. The slot pool (Spellcasting and Pact Magic) is derived from the stored sheet.',
    requiredInputs: ['spellRef or spell (exactly one of)'],
    exclusions: [
      'A caller never declares the slot table, caster level, or class association; a sheet outside the single-class boundary is refused.',
      'A spell that does not resolve unambiguously, a record without a base level, a slotLevel below the spell level or given for a cantrip, no available slot, and an upcast the transform refuses are all refused before any slot is spent.',
      'Does not check that the character knows or has prepared the spell, whether it may be cast, its targets, or its effects; casting time and action economy go through spend_turn_resource.',
    ],
    residualDmInterpretation: [
      'The DM decides that the spell is cast and is on the character list, its targets and effects, and whether an upcast is intended.',
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
      'Convert between sorcery points and spell slots for a stored sorcerer sheet of level 2 or higher in one transaction: create-slot spends the pack-procedure cost in sorcery points for a new created slot of slotLevel (up to the maximum slot level the pack procedure allows) that vanishes at the next long rest, and convert-slot expends an available slot of slotLevel to regain that many sorcery points; a conversion that would take the points above the maximum is refused, not clamped. In an active combat instance it first spends the character bonus action.',
    requiredInputs: ['operation', 'slotLevel'],
    exclusions: [
      'A non-sorcerer, a sorcerer below level 2, a binding without the Font of Magic record, a Font of Magic procedure whose sorcery point maximum disagrees with the class table, an unaffordable or illegal level, and an unavailable slot are refused; any refusal, including the bonus-action spend, aborts atomically.',
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
      "Replace a prepared-caster character's whole prepared spell list after a completed long rest the character took part in, while world time still equals that rest's end and no combat is active, enforcing the class count, the class list at castable levels (wizard: spellbook only), and rejecting duplicates and unknown spells; always-prepared domain, oath, and circle spells are recomputed from the pack and neither count nor can be selected.",
    requiredInputs: ['restId', 'spells'],
    exclusions: [
      'A sheet outside the single-class boundary or not built under the bound pack is refused; repeated calls inside the window replace the list (last wins).',
      'Circle of the Land spells need a recorded land pick; with none, no circle spells are set and the result says so.',
      'Does not decide which spells the player prefers and writes no progression event.',
    ],
    residualDmInterpretation: [
      'The DM relays the player choice of spells to prepare.',
    ],
    runtimeOwner: [o('toolPrepareSpells.ts'), c('spellPreparation.ts')],
    evidence: [t('spellPreparation.test.ts')],
  }),
  toolEntry('spend_usage', 'state-integrity', {
    operation:
      "Spend uses of a limited-use counter in one transaction, choosing the economy source by branch. A combatant: derived only from its creature record (X/Day, recharge, recharge-after-rest, per-day innate spell); a declared economy is rejected, and at-will, legendary, unlimited, or unmatched abilities are refused with a reason. A character with a sheet whose class has a bound class resource (Rage, Ki, Sorcery Points) named by alias: capacity, reset, and counter come from the active class table at the sheet level (unlimited consumes nothing, a level with none refuses), and a declared maxUses or reset is rejected. Any other character ability, and a legacy unbound item the character holds (charges): no structured economy exists, so the first spend must declare maxUses and reset (optionally rechargeMinimum or rechargeFormula), and later spends use the recorded economy. A recharge ability spent during its owner's own open turn stamps the turn window.",
    requiredInputs: ['ability or itemId (one of)'],
    exclusions: [
      'A dead character, a dead or absent combatant, an overspend, and a declared economy where the pack supplies one are refused.',
      'A pack-bound or quarantined item row is refused (use_item); item charges must be spent by the holding character, not a combatant.',
      'A bound class resource whose capacity cannot be resolved from the active campaign rules stack is refused rather than defaulted.',
    ],
    residualDmInterpretation: [
      'The DM decides that the ability is used and, for an unbound character ability or unbound item only, supplies the economy from the source.',
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
      'Restore a spent counter, found by ability or item (a bound class resource is first reconciled to the active class capacity): with roll, apply a recharge-die result to a recharge-roll counter, recharging it exactly when the natural roll meets the counter threshold and consuming that owner-turn window; with amount, regain that many uses (never below zero spent) on a counter of any reset kind not refused below.',
    requiredInputs: [
      'ability or itemId (one of)',
      'roll or amount (exactly one)',
    ],
    exclusions: [
      'The natural recharge result is supplied by the caller and only range-checked against the counter die; the tool does not verify that it came from the roll tool, and a ruled amount is not checked against any source.',
      'A roll is refused for a counter that is not recharge-roll, outside the owner own open structured turn, when already attempted in this turn window, and when the ability was used in this window.',
      'A bound class resource with no capacity or unlimited capacity at the level is refused, and a pack-bound or quarantined item row is refused (use_item).',
      'Rest and dawn resets go through reset_usage.',
    ],
    residualDmInterpretation: [
      'The DM obtains the recharge or restore roll through roll and decides a ruled amount.',
    ],
    runtimeOwner: [
      o('toolRestoreUsage.ts'),
      s('usageCounters.ts'),
      s('classResources.ts'),
    ],
    evidence: [
      t('usageCounters.test.ts'),
      t('classResourceActiveCapacity.test.ts'),
    ],
  }),
  toolEntry('reset_usage', 'bounded-procedure', {
    operation:
      'Apply a short rest, long rest, or dawn reset event to spent usage counters: short rest resets recharge-roll, short-rest, and short-or-long counters, long rest also resets long-rest counters, and dawn resets dawn counters, except that a dawn counter with a recharge formula is returned in needsRolledRestore instead. Bound class-resource counters in scope are first reconciled to the active class table; one whose capacity is none is neither refilled nor reported. Without an owner, rests cover every character and the counters of the item rows characters hold, and dawn covers every counter owner, including combatants and unheld items.',
    requiredInputs: ['event'],
    exclusions: [
      'combatantId or character scopes the event to one owner (and, for a character, the items it holds); a dead owner and an absent combatant are refused.',
      'A spent counter in scope that belongs to a pack-bound item row refuses the whole call; canonical item economies belong to the item reset executor, and quarantined item rows are skipped.',
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
      'Complete one group short rest in one transaction, recorded under a unique restId: require a declared duration of at least 60 minutes without strenuous activity, advance the world clock by that duration (which settles due effect, recovery, and item events), restore Pact Magic slots and short-rest usage counters and item resets for each participant, and open each participant Hit Die recovery window.',
    requiredInputs: ['restId', 'participants', 'qualification'],
    exclusions: [
      'Participants are character ids that must exist, be unique, and each have a stored sheet built under the bound pack; unknown qualification properties are refused.',
      'Reusing a completed restId returns the recorded result, without re-applying anything, only when kind, qualification, label, and participants are identical, and is otherwise refused; this check runs first, so an identical reuse returns even while combat is active. A new rest is refused while combat is active.',
      'Does not restore ordinary Spellcasting slots or hit points.',
      'Does not decide whether the party actually rested.',
    ],
    residualDmInterpretation: [
      'The DM decides that the party rests, its duration, and whether it involved strenuous activity.',
    ],
    runtimeOwner: [
      o('toolRest.ts'),
      s('rest.ts'),
      s('spellSlots.ts'),
      s('usageCounters.ts'),
    ],
    evidence: [t('rest.test.ts')],
  }),
  toolEntry('complete_long_rest', 'bounded-procedure', {
    operation:
      'Complete one group long rest in one transaction, recorded under a unique restId, after validating the qualification (duration at least 480 minutes with at least 360 asleep, at most 120 of light activity, and under 60 of strenuous interruption within the duration): advance the world clock, then for each participant reduce exhaustion by one level when foodAndDrink is true, restore hit points to the effective maximum, expire temporary hit points, restore half the Hit Dice (at least 1, up to what was spent), restore spell slots, and reset usage counters and item resets.',
    requiredInputs: ['restId', 'participants', 'qualification'],
    exclusions: [
      'A new rest is refused while combat is active, for a dead participant or one at 0 hit points, when a participant benefited from a long rest within 24 in-game hours, and for any participant without a stored sheet built under the bound pack.',
      'Reusing a completed restId returns the recorded result, without re-applying anything, only when kind, qualification, label, and participants are identical, and is otherwise refused; this check runs before the combat check.',
      'A refusal inside a participant benefit (for example a spent counter on a pack-bound item row in the usage reset) aborts the whole rest.',
      'Dawn is not a long rest.',
      'Does not decide whether the party actually rested.',
    ],
    residualDmInterpretation: [
      'The DM decides that the party rests and reports its sleep, activity, interruption, and food and drink honestly.',
    ],
    runtimeOwner: [
      o('toolRest.ts'),
      s('rest.ts'),
      s('spellSlots.ts'),
      s('usageCounters.ts'),
    ],
    evidence: [t('rest.test.ts')],
  }),
  toolEntry('spend_rest_hit_die', 'bounded-procedure', {
    operation:
      "Spend exactly one Hit Die in an open short-rest recovery window while world time still equals that rest's end: roll 1d(class Hit Die) from the seeded RNG, add the stored sheet Constitution modifier, heal the character by that amount floored at 0 through the hit point path, and count the die spent (the pool maximum is the sheet level).",
    requiredInputs: ['restId'],
    exclusions: [
      'Refused during combat, for a dead character, when the character did not take part in that short rest or its window is closed or expired (advancing time or starting an encounter closes it), and when no Hit Dice remain.',
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
      'Close one character short-rest Hit Die recovery window so further Hit Die spending for that rest is rejected.',
    requiredInputs: ['restId'],
    exclusions: [
      'Refused when no open recovery window exists for that rest and character.',
    ],
    residualDmInterpretation: [
      'The DM decides that the player has finished spending Hit Dice.',
    ],
    runtimeOwner: [o('toolRest.ts'), s('rest.ts')],
    evidence: [t('rest.test.ts'), t('tools.test.ts')],
  }),
  toolEntry('advance_time', 'state-integrity', {
    operation:
      'Advance the structured elapsed-minutes world clock by a positive integer number of minutes in one transaction, closing open short-rest recovery windows and settling what falls due: effects whose elapsed-time deadline is reached expire, stable characters and stable player-character combatants whose recovery deadline is reached regain 1 hit point, and item economy resets and timers due in the interval run in order.',
    requiredInputs: ['minutes'],
    exclusions: [
      'Refused if the clock would exceed the safe integer range.',
      'Does not complete a rest; in_game_time_label is a narrative label, not elapsed time, and a stale label is reported (narrativeLabelStale).',
    ],
    residualDmInterpretation: ['The DM decides how much time passes.'],
    runtimeOwner: [
      o('toolRest.ts'),
      s('rest.ts'),
      s('turnClock.ts'),
      s('itemResetExecutor.ts'),
    ],
    evidence: [t('rest.test.ts'), t('exhaustion.test.ts')],
  }),
];

// ---------------------------------------------------------------------------
// World, plot, clock, scenes, ambiguity
// ---------------------------------------------------------------------------

const WORLD_AND_RULINGS: readonly DeterministicCapabilityInventoryEntry[] = [
  toolEntry('update_clock', 'state-integrity', {
    operation:
      'Set the in-game time label (stamped with the current elapsed minutes) and/or the current location id through the validated, provenance-recording state seam.',
    requiredInputs: ['in_game_time or location_id (at least one)'],
    exclusions: [
      'A time label never advances elapsed minutes; advance_time does.',
      'A blank location_id is refused (null clears it).',
      'Does not check that the location exists in the module.',
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
    operation:
      'Open a scene record with a title in the current session, or close the open scene.',
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
      'Insert one campaign overlay lore record (a generated or supplied id, kind, subject, fact, truth status, source, scope, significance, visibility, tags, and optional supersedes or invalidates references), defaulting its location to the current campaign location; queries hide records that a later record invalidates unless asked to include them.',
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
      'The record is insert-only; each enumerated field is validated, but supersedes and invalidates are stored references that are not checked to exist.',
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
      'Look up one published rules ambiguity in the campaign rules at the persisted current campaign position and report its question, enumerated interpretations, status (unresolved, resolved with the active ruling, or conflicting with the rulings that must be revoked), and any active ruling.',
    requiredInputs: ['ambiguityId'],
    exclusions: [
      'Refused when the campaign has no persisted current turn position or the ambiguity id is unknown.',
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
      'Stage, inside an audited campaign turn, one proposed durable precedent for a published ambiguity that is unresolved now and at the next position, naming exactly one of its enumerated interpretations with a reason. The tool persists nothing: the orchestrator records the staged proposal as a ruling only when the candidate is accepted (an auditor acceptance or a presentation-only repair), and a rejected candidate drops it.',
    requiredInputs: ['ambiguityId', 'matchingInterpretationIds', 'reason'],
    exclusions: [
      'Refused outside an audited candidate turn, without the current persisted turn position, when the ambiguity already has an active, conflicting, or prospective ruling, and when the interpretation is not enumerated by the ambiguity.',
      "Exactly one interpretation id is accepted; the tool description's instruction to supply all matching ids is not reflected in the input schema.",
      'The tool cannot tell whether the action is a question, a canonical-rule violation, a house rule, or a contextual judgment (for none of which it is meant); that is not checked, and the tool does not itself persist the precedent.',
    ],
    residualDmInterpretation: [
      'The DM decides that the action accepted at the table unambiguously selects the interpretation.',
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
    'single-class-build-boundary-v1',
    'assertSupportedCharacterBuild',
    c('characterBuild.ts'),
    'state-integrity',
    {
      operation:
        'Refuse, with UnsupportedCharacterBuildError, a build record that is not a single-class build at the operation being performed: a multiclass-shaped field, an array class, a non-positive-integer level, a claimed total or sole-class level that disagrees with level, or a subclass that belongs to another class. Called at creation, finalization, sheet persistence and load, character-registry persistence and load, attach, level-up, rests, and spell-slot paths, among others.',
      requiredInputs: [
        'The record to check (a draft, sheet, or transport value)',
        'The operation name being refused',
      ],
      exclusions: [
        'A value that is not an object is not checked.',
        'The subclass-parent check against the pack runs only for dnd5e-srd records with a class and subclass key; an unlisted subclass key is not refused.',
        'Does not enforce rules of any class; it only bounds the build shape to one class and one level.',
      ],
      residualDmInterpretation: [
        'The DM adjudicates anything about multiclassing, which Eshyra refuses rather than executes (ADR 0018).',
      ],
      runtimeOwner: [c('characterBuild.ts')],
      evidence: [t('characterBuild.test.ts')],
    },
  ),
  engineEntry(
    'character-creation-engine-v1',
    'createCharacterCreationEngine',
    c('characterDraft.ts'),
    'bounded-procedure',
    {
      operation:
        'Recompute a guided-creation draft after each engine setter and gate finalization: derive ability modifiers, saving throws, proficiency bonus, hit points, and spellcasting values; validate ability scores (free entry in range, point buy within the 27-point budget, the standard array, or a rolled set assigned by multiplicity from six recorded 4d6-drop-lowest rolls whose roll evidence is validated), background customization, starting equipment or wealth, and the chosen spells against the class list and level-1 reach; classify the spell list against the level-1 counts (level1SpellRequirements), excluding always-prepared spells from the preparation limit; derive the level-1 class-feature choices (deriveCreationClassChoices) and the skill, tool, language, and equipment mechanical choices; and report missing required choices and error diagnostics. toFinalizableDraft returns the draft only when no required choice is missing and the diagnostics recorded on the draft (by its last recompute) include no error. The ability-score set and starting-wealth dice are rolled from the caller-supplied RNG by rollAbilityScoreSet and rollStartingWealth (the CLI wizard), and a starting-wealth result is validated against its recorded roll.',
      requiredInputs: [
        'A rules-pack character resolver (the default is the bundled dnd5e SRD resolver)',
        'The draft selections made through the engine setters',
      ],
      exclusions: [
        'A draft outside the single-class boundary is refused.',
        'A shortfall in a count is a pending diagnostic that blocks finalization; an excess, a duplicate, or a prepared spell outside the spellbook is an error diagnostic.',
        'Does not choose anything for the player; an unstructured class-feature choice stays an explicit blocker with its reason.',
      ],
      residualDmInterpretation: [
        'The player makes every selection; the DM adjudicates the effect of chosen options the sheet only records.',
      ],
      runtimeOwner: [
        c('characterDraft.ts'),
        c('creationSpellCounts.ts'),
        c('creationClassChoices.ts'),
        c('requiredChoices.ts'),
        c('abilities.ts'),
        c('abilityAllocation.ts'),
        c('derivedValues.ts'),
        c('spellcastingDerivation.ts'),
        c('proficiency.ts'),
        c('srdStartingWealth.ts'),
      ],
      evidence: [
        t('characterDraftEngine.test.ts'),
        t('creationSpellCounts.test.ts'),
        t('creationClassChoices.test.ts'),
        t('requiredChoices.test.ts'),
        t('abilityAllocation.test.ts'),
      ],
    },
  ),
  engineEntry(
    'creation-spell-counts-v1',
    'level1SpellRequirements',
    c('creationSpellCounts.ts'),
    'bounded-procedure',
    {
      operation:
        'Compute what the class requires at level 1 for a spell list, from the resolved class record, as numbers only: the cantrip count, the known-caster spell count, the wizard spellbook size and prepared-list limit, and the cleric and druid preparation limit (ability modifier plus level through evaluatePreparationBasis).',
      requiredInputs: [
        'A resolved class record',
        'The ability modifiers by ability name',
        'A rules-pack character resolver',
      ],
      exclusions: [
        'Takes no chosen spells: it does not classify a selection, exclude always-prepared spells, or gate a deficient spellbook; character-creation-engine-v1 does that with this result.',
        'A class without spellcasting or without a preparation rule yields no or fewer requirements, and a limit that cannot be evaluated is omitted.',
      ],
      residualDmInterpretation: [
        'The player chooses the spells within the counts the draft engine enforces.',
      ],
      runtimeOwner: [c('creationSpellCounts.ts'), c('levelUpSpells.ts')],
      evidence: [t('creationSpellCounts.test.ts')],
    },
  ),
  engineEntry(
    'creation-class-choices-v1',
    'deriveCreationClassChoices',
    c('creationClassChoices.ts'),
    'bounded-procedure',
    {
      operation:
        'Derive the level-1 class-feature decisions (the level-1 subclass and its level-1 choices, fighting style, favored enemy, natural explorer terrain, rogue expertise) from the resolved class record and the bound pack, each paired with the stored selection and a satisfied or refused verdict, using validation shared with the level-up detectors.',
      requiredInputs: [
        'The rules-pack character resolver',
        'The resolved class record',
        'The stored selections keyed by choice id',
        'The skill proficiencies, tool proficiencies, and (optionally) languages held so far',
      ],
      exclusions: [
        'Validation of an expertise or similar pick depends on the proficiencies passed in, not on a draft.',
        'A choice the shared detectors cannot handle stays an explicit unstructured descriptor that blocks finalization with its reason.',
        'Spell choices belong to the creation spell flow and use-time choices are not build decisions.',
      ],
      residualDmInterpretation: [
        'The player makes each pick; the DM adjudicates the effect of options the sheet only records.',
      ],
      runtimeOwner: [
        c('creationClassChoices.ts'),
        c('levelUpFeatureChoices.ts'),
        c('levelUpExpertise.ts'),
        c('levelUpSubclass.ts'),
        c('levelUpChoiceCoverage.ts'),
      ],
      evidence: [t('creationClassChoices.test.ts')],
    },
  ),
  engineEntry(
    'finalize-character-v1',
    'finalizeCharacterDraft',
    c('finalizeCharacter.ts'),
    'bounded-procedure',
    {
      operation:
        'Turn a creation draft into the canonical character sheet, or report what is missing: refuse a build outside the single-class boundary; require the draft engine to report the draft finalizable and every level-1 mechanical choice satisfied; validate the final starting acquisition; assert that duplicate skill and tool proficiencies are resolved by generated replacement choices; then derive the final ability scores, modifiers, saving throws, proficiency bonus, maximum hit points, spell state, skills, tools, languages, equipment, wallet, class-feature choices, and the standing proficiency grants (with their provenance ledger) that level-1 class and subclass features and chosen options confer.',
      requiredInputs: [
        'A creation draft',
        'Finalize metadata',
        'A rules-pack character resolver and creation engine (bundled dnd5e SRD defaults)',
      ],
      exclusions: [
        'An incomplete draft, an error diagnostic, an unsatisfied mechanical choice, an invalid starting acquisition, or an unresolved duplicate proficiency returns ok:false with the reasons, and a build outside the one-class boundary throws.',
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
        c('abilityAllocation.ts'),
        c('proficiency.ts'),
        c('srdStartingWealth.ts'),
      ],
      evidence: [
        t('finalizeCharacter.test.ts'),
        t('proficiencyGrants.test.ts'),
      ],
    },
  ),
  engineEntry(
    'character-sheet-store-v1',
    'createSqliteCharacterSheetStore',
    c('characterSheetStore.ts'),
    'state-integrity',
    {
      operation:
        'Persist and load the canonical character sheet as a versioned JSON document keyed by character id: saving upserts in place after the single-class boundary and roll-evidence checks, and loading re-checks both and refuses a row whose mirrored schema version, system, or pack id disagrees with its document. assertSheetMatchesPack refuses a sheet whose system or pack id differs from the campaign binding base.',
      requiredInputs: [
        'A database',
        'A non-empty character id',
        'The sheet to save',
      ],
      exclusions: [
        'The binding comparison is by system and pack id only, not pack version or add-ons.',
        'The live character row is a separate projection that this store does not write.',
      ],
      residualDmInterpretation: [
        'None: persistence integrity involves no DM interpretation.',
      ],
      runtimeOwner: [
        c('characterSheetStore.ts'),
        c('finalizeCharacter.ts'),
        c('characterBuild.ts'),
      ],
      evidence: [t('characterSheetStore.test.ts'), t('characterBuild.test.ts')],
    },
  ),
  engineEntry(
    'character-sheet-attach-v1',
    'attachCharacterSheetToCampaign',
    c('attachCharacter.ts'),
    'state-integrity',
    {
      operation:
        'Bring a registry character into a campaign as its authoritative playable sheet: refuse a build outside the single-class boundary or a sheet built under another rules pack than the campaign binding base, stamp the global character id, import time, and source revision on the sheet metadata, save it under the campaign character id (default pc-1), and project it into the live character row.',
      requiredInputs: [
        'A database',
        'The sheet',
        'The global character id',
        'sessionId',
        'at',
      ],
      exclusions: [
        'A cross-pack attach is refused (conversion is not implemented), and the projection supports the dnd5e SRD system only.',
        'The sheet save and the live-row import are separate writes: an import correction result (a campaign rules system other than dnd5e-srd) leaves the saved sheet in place.',
        'Consults and records no custody; character-checkout-v1 and character-catch-up-v1 call it inside the custody lifecycle.',
      ],
      residualDmInterpretation: [
        'The player decides which registry character joins the campaign.',
      ],
      runtimeOwner: [
        c('attachCharacter.ts'),
        c('creation.ts'),
        c('characterSheetStore.ts'),
      ],
      evidence: [
        t('characterRegistry.test.ts'),
        t('characterSheetStore.test.ts'),
      ],
    },
  ),
  engineEntry(
    'finalized-character-import-v1',
    'importFinalizedCharacter',
    c('creation.ts'),
    'state-integrity',
    {
      operation:
        'Project a finalized character into the campaign live character row through the validated state seam in one transaction, and make it the active character.',
      requiredInputs: [
        'A database',
        'The finalized character',
        'sessionId',
        'at',
      ],
      exclusions: [
        'A build outside the single-class boundary is refused; a campaign or character whose rules system is not dnd5e-srd returns a correction result instead of importing.',
      ],
      residualDmInterpretation: [
        'The player decides which character joins the campaign.',
      ],
      runtimeOwner: [
        c('creation.ts'),
        s('mutateState.ts'),
        s('activeCharacter.ts'),
      ],
      evidence: [
        t('characterCreation.test.ts'),
        t('characterSheetStore.test.ts'),
      ],
    },
  ),
  engineEntry(
    'proficiency-grants-v1',
    'applyProficiencyGrants',
    c('proficiencyGrants.ts'),
    'state-integrity',
    {
      operation:
        'Apply typed standing proficiency grants (saving throws, skills, armor) from class and subclass features and chosen options to the sheet, recording in the CharacterSheet.proficiencyGrants ledger only what each source newly added so that a replaceable option can later be removed exactly. It is pure over the sheet.',
      requiredInputs: [
        'A character sheet',
        'The grant sources with their source refs',
      ],
      exclusions: [
        'Applying refuses nothing: a proficiency already held is simply not recorded for the source. The only ProficiencyGrantError is the removal refusal below.',
        'Removal (removeOptionGrants) drops only what that source ledger entry recorded and refuses when a recorded skill has Expertise. A proficiency already held when a source was applied is not recorded for it and is not removed with it. A recorded proficiency that a still-held, already-applied source also confers is not removed: it stays on the sheet and is recorded under that source, so removing that source later removes it (the level-up replacement passes the still-held sources). Ancestry trait grants are not read here.',
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
    'level-up-eligibility-v1',
    'getLevelUpEligibility',
    s('levelUpEligibility.ts'),
    'bounded-procedure',
    {
      operation:
        'Read-only verdict on whether a character may level up under the campaign advancement policy: in XP mode, the highest level the stored XP qualifies for in the bound pack Character Advancement table (clamped to the table range); in milestone mode, the current level plus the granted milestone awards not yet consumed by level-up events; returning mode, current level, target level, pending levels, and eligible.',
      requiredInputs: [
        'A database',
        'A character id (the active character when omitted)',
      ],
      exclusions: [
        'XP mode fails closed when the bound pack ships no advancement table.',
        'Does not apply a level-up or award anything; applyLevelUp is a separate step that does not itself check this verdict, so callers (the guided level-up flow and the CLI) gate on it.',
        'Counts every level-up event as consuming one milestone.',
      ],
      residualDmInterpretation: [
        'The DM decides when XP or milestones are awarded and whether the table accepts the character advancing.',
      ],
      runtimeOwner: [
        s('levelUpEligibility.ts'),
        s('advancementPolicy.ts'),
        r('advancementTable.ts'),
      ],
      evidence: [
        t('levelUpEligibility.test.ts'),
        t('advancementPolicy.test.ts'),
        t('guidedLevelUpFlow.test.ts'),
      ],
    },
  ),
  engineEntry(
    'xp-award-v1',
    'awardXp',
    s('domainMutations.ts'),
    'bounded-procedure',
    {
      operation:
        'Add a positive integer amount of experience to a character and append the matching xp-award progression event in one transaction, under XP advancement mode only; the award never changes the character level. Retained and staged: no tool or CLI path calls it yet (tests only), and eshyra-menn owns wiring a consumer.',
      requiredInputs: [
        'A database',
        'The amount',
        'The source',
        'The mutation context (provenance, session, time, character)',
      ],
      exclusions: [
        'A non-positive amount and a campaign in milestone mode (or any mode other than XP) are refused.',
        'Does not decide that XP is earned or its amount.',
      ],
      residualDmInterpretation: [
        'The DM decides when an award is earned and how much.',
      ],
      runtimeOwner: [
        s('domainMutations.ts'),
        s('advancementPolicy.ts'),
        s('progression.ts'),
      ],
      evidence: [
        t('progressionAwards.test.ts'),
        t('progressionIntegration.test.ts'),
      ],
    },
  ),
  engineEntry(
    'milestone-award-v1',
    'grantMilestone',
    s('domainMutations.ts'),
    'bounded-procedure',
    {
      operation:
        'Record a milestone for a character as an append-only milestone-award progression event, under milestone advancement mode only; the grant never changes the character level. Retained and staged: no tool or CLI path calls it yet (tests only), and eshyra-menn owns wiring a consumer.',
      requiredInputs: [
        'A database',
        'The milestone label',
        'The source',
        'The mutation context (provenance, session, time, character)',
      ],
      exclusions: [
        'An empty label and a campaign in XP mode (or any mode other than milestone) are refused.',
        'Does not decide that a milestone is reached.',
      ],
      residualDmInterpretation: ['The DM decides when a milestone is reached.'],
      runtimeOwner: [
        s('domainMutations.ts'),
        s('advancementPolicy.ts'),
        s('progression.ts'),
      ],
      evidence: [
        t('progressionAwards.test.ts'),
        t('progressionIntegration.test.ts'),
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
        'Apply exactly one level-up step to the stored sheet in one transaction: refuse a non-alive or suffocating character, a build outside the single-class boundary, and a sheet not built under the campaign binding pack; compute the change set from the campaign-bound class progression (proficiency bonus, features, spellcasting capacity, class resource changes, and hit points by fixed average or caller-supplied immutable roll evidence); refuse with the required choices until every detected choice is supplied and valid; apply the choices and the proficiency ledger; save the sheet; project level and hit points to the live character; reconcile spell slots and class-resource counters; and append a level-up progression event.',
      requiredInputs: [
        'A sheet store',
        'source, provenance, sessionId, and at (ledger audit fields)',
        'The required choices for the target level, when any are detected',
        'characterId (the active character when omitted)',
      ],
      exclusions: [
        'Does not check level-up eligibility or award experience; getLevelUpEligibility gives the verdict that callers gate on, so an ineligible character is not refused here (a target level with no class row in the pack is).',
        'Records the pick of an option-catalog feature choice only; the option effect is not implemented here.',
        'Multi-level catch-up is the caller looping one step at a time.',
      ],
      residualDmInterpretation: [
        'The player makes the choices; the DM adjudicates the effect of chosen options the sheet only records.',
      ],
      runtimeOwner: [
        c('levelUpEngine.ts'),
        c('levelUpSkillChoices.ts'),
        c('levelUpExpertise.ts'),
        c('levelUpSubclass.ts'),
        c('levelUpChoiceCoverage.ts'),
        c('spellcastingDerivation.ts'),
        s('campaignRecordLookup.ts'),
        s('classResources.ts'),
        s('spellSlots.ts'),
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
        'Derive the counter capacity of the bound expendable class resources (Rage for barbarians, Ki for monks, Sorcery Points for sorcerers, with their reset events) from the resourceProgression column of the class table row at a level: a positive count, unlimited, or none. spend_usage, restore_usage, reset_usage, rests, level-up, and Flexible Casting reconcile a character counter for these resources to that capacity instead of accepting a declared economy.',
      requiredInputs: [
        'A class resource binding',
        'The resolved class level row',
      ],
      exclusions: [
        'Covers only the bindings listed in classResources.ts; other class resources have no pack-derived capacity here.',
        'A missing column or non-positive value is treated as no resource at that level, and none leaves an existing counter unchanged and unusable.',
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
        'Resolve the campaign rules binding (the stored row, or the default bundled dnd5e SRD binding when none is stored) into an exact rules stack of its base pack and ordered add-ons, each matched by system, pack id, and version, so that rests, level-up, spell-slot, usage, and record lookups read the bound stack. A caller-supplied pack resolver is consulted first, then the bundled packs.',
      requiredInputs: ['The campaign database'],
      exclusions: [
        'A bound pack that is unavailable, or a resolved pack whose identity differs from the binding, throws CampaignRulesBindingResolutionError; there is no fallback to a different pack once a binding is stored.',
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
    'campaign-creation-v1',
    'createCampaign',
    'packages/core/src/campaign/campaign.ts',
    'state-integrity',
    {
      operation:
        "Create the single campaign of a campaign database from a module pack. Two separate callables are involved. checkBindingAgainstModuleRequirements(binding, requirements) is a pure check that writes nothing: the binding base system must equal the module's required base system, the base version must be among the module's allowed versions when any are listed, and every required add-on pack id must be in the binding; it returns a mismatch reason or undefined. createCampaign refuses a blank campaign id and an existing campaign, runs that check first (a mismatch refuses before any write), and then, in one transaction, forks the module template into the database (replacing every module_* table row), records the campaign id, and persists the rules binding through writeCampaignRulesBinding(db, binding), which inserts or replaces the single binding row (id 1). The binding defaults to the bundled dnd5e SRD base with no add-ons, stamped with the creation time.",
      requiredInputs: [
        'A database (createCampaign and writeCampaignRulesBinding)',
        'A non-blank campaign id',
        'The module pack (its meta.rulesRequirements feed the check)',
        'An optional rules binding (base and add-ons by system, pack id, and version)',
      ],
      exclusions: [
        'The check compares identities only; it does not resolve or load the bound packs (campaign-rules-binding-resolution-v1 does that later and fails closed).',
        'A database that already holds a campaign is refused rather than re-forked; the template fork itself replaces any template rows it finds.',
        'getCampaign reads a campaign whose binding row is missing as the default dnd5e SRD binding.',
        'Does not decide which module or rules a campaign uses.',
      ],
      residualDmInterpretation: [
        'The player or operator chooses the module and the campaign rules binding.',
      ],
      runtimeOwner: [
        'packages/core/src/campaign/campaign.ts',
        r('binding.ts'),
        'packages/core/src/world/forkCampaign.ts',
      ],
      evidence: [t('campaign.test.ts'), t('campaignRulesBinding.test.ts')],
    },
  ),
  engineEntry(
    'campaign-rule-store-v1',
    'createCampaignRule',
    'packages/core/src/campaign/campaignRuleStore.ts',
    'state-integrity',
    {
      operation:
        'Create, revoke, and supersede campaign rules (house rules and rulings with provenance) at chronological positions: a live mutation must name the persisted current campaign position, ordinals at or before the current turn must match the persisted chronology row, a ruling must name an enumerated interpretation of a known ambiguity or a recurring question, a revocation must be in the future and not before a successor takes effect, and each write is validated and atomic.',
      requiredInputs: [
        'A database',
        'The rule',
        'The current campaign position',
      ],
      exclusions: [
        'A position that disagrees with the persisted position, an invalid or non-active new rule, a duplicate rule identity, an unpersisted disputed or past anchor, an unknown or inactive rule to revoke or supersede, and an active ruling that overlaps another for the same ambiguity are refused.',
        'Does not decide what a ruling should be; the player chooses.',
      ],
      residualDmInterpretation: [
        'The player chooses rulings and house rules; the DM applies the active ones.',
      ],
      runtimeOwner: [
        'packages/core/src/campaign/campaignRuleStore.ts',
        'packages/core/src/campaign/campaignRules.ts',
        'packages/core/src/campaign/campaignPosition.ts',
      ],
      evidence: [t('campaignRuleStore.test.ts'), t('campaignRules.test.ts')],
    },
  ),
  engineEntry(
    'checkpoint-store-v1',
    'CheckpointStore',
    'packages/core/src/persistence/checkpoint/store.ts',
    'state-integrity',
    {
      operation:
        'Serialize the live campaign database (schema, indexes, triggers, and canonical rows) into a Dolt-backed checkpoint, list checkpoints, restore one into a new working-copy database file, and fork a branch from a checkpoint, off the per-turn path. A restore builds into a sibling temporary file and renames it into place only after every record applies, with foreign keys checked at commit.',
      requiredInputs: [
        'A Dolt directory',
        'A beads directory',
        'The live database path or a checkpoint id and destination path',
      ],
      exclusions: [
        'Refuses a Dolt directory that is the same as, nested with, or shares a remote or the reserved ref namespace with the beads Dolt data.',
        'A restore destination that already exists (checked before the build, and again when the finished file is hard-linked into place, so one created in between is not replaced) and a schema snapshot that is not the current version are refused; a restore that fails before the rename removes its temporary file and creates no database at the destination.',
        'Does not decide when to checkpoint or which checkpoint to restore.',
      ],
      residualDmInterpretation: [
        'The player or operator decides when to checkpoint, restore, or fork.',
      ],
      runtimeOwner: [
        'packages/core/src/persistence/checkpoint/store.ts',
        'packages/core/src/persistence/checkpoint/serialize.ts',
        'packages/core/src/persistence/checkpoint/separation.ts',
        'packages/core/src/persistence/checkpoint/doltRepo.ts',
      ],
      evidence: [
        t('checkpoint.store.test.ts'),
        t('checkpoint.restore.test.ts'),
        t('checkpoint.separation.test.ts'),
        t('checkpoint.doltRepo.test.ts'),
      ],
    },
  ),
  engineEntry(
    'turn-replay-retention-v1',
    'retainTurnReplay',
    'packages/core/src/campaign/turnReplayStore.ts',
    'state-integrity',
    {
      operation:
        'Retain, inside the turn transaction after all canonical writes, the pre-turn snapshot and the turn input with a hash of the post-turn state (excluding the replay tables), so the latest adjudication can be replayed; assertReplayState refuses when the state hash no longer matches, and restoreReplaySnapshot restores the snapshot only inside an enclosing transaction, only when the schema matches, and re-checks foreign keys.',
      requiredInputs: ['The turn input', 'The pre-turn snapshot records'],
      exclusions: [
        'The replay tables are excluded from the snapshot and hash.',
        'Retention is not itself a dispute; disputeTurn decides whether a replay may run.',
      ],
      residualDmInterpretation: [
        'None for retention itself; the player decides whether to dispute a turn.',
      ],
      runtimeOwner: [
        'packages/core/src/campaign/turnReplayStore.ts',
        'packages/core/src/persistence/checkpoint/serialize.ts',
      ],
      evidence: [
        t('campaignRules.test.ts'),
        t('campaignRulesEndToEnd.test.ts'),
      ],
    },
  ),
  engineEntry(
    'dispute-turn-v1',
    'disputeTurn',
    'packages/core/src/campaign/disputedTurn.ts',
    'state-integrity',
    {
      operation:
        'On explicit player approval, replay only the latest unreplayed adjudication: verify that the saved replay and the persisted current position name that exact turn and that the state is unchanged since, restore the pre-turn snapshot, create or supersede the player-approved rule at the disputed position with its provenance, mark the replay pending, record a diagnostic with the original trace, and rerun the same turn input (resumeDisputedTurn retries only that approved replay).',
      requiredInputs: [
        'Run-turn dependencies',
        'The campaign, session, and turn ids',
        'The approved rule prose, kind, and provenance',
      ],
      exclusions: [
        'Never exposed as a model tool.',
        'A turn that is not the latest available adjudication, changed state, an empty rule, a house rule carrying ruling provenance, or an unknown ambiguity is refused before any restore.',
        'Does not decide what the approved rule is; the player does.',
      ],
      residualDmInterpretation: [
        'The player approves the rule; the DM re-adjudicates the turn under it.',
      ],
      runtimeOwner: [
        'packages/core/src/campaign/disputedTurn.ts',
        'packages/core/src/campaign/turnReplayStore.ts',
        'packages/core/src/campaign/campaignRuleStore.ts',
      ],
      evidence: [
        t('campaignRules.test.ts'),
        t('campaignRulesEndToEnd.test.ts'),
      ],
    },
  ),
  engineEntry(
    'schema-migration-runner-v1',
    'migrateDatabase',
    'packages/core/src/persistence/migrationRunner.ts',
    'state-integrity',
    {
      operation:
        'Bring a campaign database onto the current schema (initSchema calls migrateDatabase when the CLI opens or creates a campaign). A database without a schema_migrations ledger is adopted only when it is empty or is a legacy database at the baseline schema version whose table and index structure matches the baseline migration (the baseline is then recorded in the ledger); runMigrations then verifies that every applied migration still has its file with the same checksum and name and that the ledger is a contiguous prefix starting at 1, and applies each pending versioned SQL migration in its own transaction together with its ledger row.',
      requiredInputs: ['A database', 'The bundled migration files'],
      exclusions: [
        'Any other unledgered database (tables without a meta table or schema_version, a non-integer or non-baseline version, or a baseline version whose structure differs) throws SchemaResetRequiredError and is not modified.',
        'A deleted, renamed, or edited applied migration, or a non-contiguous ledger, throws SchemaMigrationError.',
        'Does not decide when a migration is written.',
      ],
      residualDmInterpretation: [
        'None: migration integrity involves no DM interpretation.',
      ],
      runtimeOwner: [
        'packages/core/src/persistence/migrationRunner.ts',
        'packages/core/src/persistence/schema.ts',
      ],
      evidence: [
        t('migrationRunner.test.ts'),
        t('migrationLegacyAdoption.test.ts'),
        t('schemaSnapshot.test.ts'),
      ],
    },
  ),
  engineEntry(
    'mutate-state-v1',
    'mutateState',
    s('mutateState.ts'),
    'state-integrity',
    {
      operation:
        'Write one validated field of a live state target (character, inventory, plot_flags, clock, overlay_facts) through the trusted internal seam, checking the target, field allowlist, value shape, and provenance fields, and recording provenance.',
      requiredInputs: [
        'target',
        'field',
        'op',
        'value',
        'provenance, sessionId, and at',
      ],
      exclusions: [
        'Performs no lifecycle reactions itself: a write of hit points, life state, death saves, or conditions through it runs no death, concentration, or condition machinery; the domain operations that own those lifecycles call it and add the reactions.',
        'Not model-facing: no tool exposes it directly (tools reach it only through domain operations), and a test pins the default registry to contain no mutate_state tool.',
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
        'Execute a typed bounded-procedure request against redacted pack record data, refusing (BoundedProcedureError) a request that fails validation or record data that lacks the procedure kind the request needs: a hazard save (initial or repeat), a weapon damage mode, selection and applicability of a feature option, creating a spell slot from or converting a slot into sorcery points, and the begin, per-spell, and recovery-day arithmetic of an adjudicated stress procedure, using caller-supplied roll results. Retained and staged: only the create-spell-slot and convert-spell-slot requests have a runtime consumer (state/flexibleCasting.ts); the other request kinds have none yet, and eshyra-4xx6 owns their integration.',
      requiredInputs: [
        'Record data carrying the typed procedure',
        'A validated request',
      ],
      exclusions: [
        'Executes only the procedure shapes proven by eshyra-o9bd.19.1.14; it is not a universal rules taxonomy and a record without one of these shapes is not thereby free of mechanics.',
        'Rolls and percentiles are supplied by the caller and are not verified here.',
      ],
      residualDmInterpretation: [
        'The DM decides applicability and adjudicates everything outside the typed procedure, including stress effects beyond the listed ones.',
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
        'Reset the economies and fire the timers of canonical pack-bound magic-item instances as their records declare, in chronological order, on short and long rest events (resolveRestEventItemResets, for the rest participants) and on the dawn, dusk, anchored-deadline, and state-machine timer events crossed by a clock advance (resolveDueItemClockEvents), writing the authoritative item_state row and returning per-instance evidence; a fired timer can destroy an instance.',
      requiredInputs: [
        'The campaign database',
        'A rest event and its participants, or the previous and new elapsed minutes',
      ],
      exclusions: [
        'A malformed clock interval throws ItemResetExecutorError.',
        'Items not bound to a pack record are reset by the generic usage counters, not here.',
      ],
      residualDmInterpretation: [
        'The DM adjudicates item behavior outside the declared resets and timers.',
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
        'Append one insert-only progression event (xp-award, milestone-award, or level-up) after validating structure only: the kind, the fields required or forbidden per kind, integer bounds, and a JSON-serializable change set; corrections are new compensating events, never edits.',
      requiredInputs: [
        'kind',
        'source',
        'resultingLevel',
        'occurredAt',
        'provenance',
        'sessionId',
      ],
      exclusions: [
        'Storage only: it implements no award rules, advancement mode, or eligibility; awardXp, grantMilestone, and applyLevelUp call it.',
        'The campaign advancement mode is read from a stored policy row and defaults to XP; writeCampaignProgressionPolicy, which stores that row, has no production caller.',
      ],
      residualDmInterpretation: [
        'The DM decides awards and milestones within the campaign advancement policy.',
      ],
      runtimeOwner: [s('progression.ts')],
      evidence: [t('progression.test.ts'), t('progressionAwards.test.ts')],
    },
  ),
];

// ---------------------------------------------------------------------------
// Character continuity and custody across campaigns (ADR 0012)
// ---------------------------------------------------------------------------

const cli = (file: string) => `packages/cli/src/${file}`;

const CHARACTER_CONTINUITY: readonly DeterministicCapabilityInventoryEntry[] = [
  engineEntry(
    'character-registry-v1',
    'createCharacterRegistryStore',
    c('characterRegistry.ts'),
    'state-integrity',
    {
      operation:
        'Persist the cross-campaign character registry in its own database: one head sheet per global character id, a linear append-only revision timeline, and the custody record. appendRevision numbers the next revision (head + 1, or 1 for a new id) and inserts it and updates the head row in one transaction, recording its source (register, sync-back, or fork) and, for a fork, the parent revision. registerNewCharacter appends a register revision; the CLI play flow registers each newly finalized character and each legacy JSON library character it migrates this way. save writes only the head row, without a revision; the standalone create-character command registers this way, and the first checkout then seeds revision 1 from that head. Every sheet write (head or revision) and every sheet load re-checks the single-class boundary and the roll evidence, and a load refuses a row whose mirrored schema version, system, or pack id disagrees with its sheet. The custody table holds at most one row per character: setCustody inserts or replaces it, and clearCustody deletes it (a no-op when absent).',
      requiredInputs: [
        'The registry database (schema created by ensureCharacterRegistrySchema)',
        'A non-blank global character id',
        'The sheet to register or append',
      ],
      exclusions: [
        'Revisions are never edited or deleted, and a head written by save gains its revision 1 only at its first checkout or resume.',
        'registerNewCharacter refuses an id that is already registered (a timeline or a legacy head row); the seeding of a legacy head at first checkout appends its revision 1 directly, not through registerNewCharacter.',
        'The store applies no custody rule itself; checkout, sync-back, release, resume, and catch-up consult and write the custody row.',
        'No write spans the registry database and a campaign database in one transaction.',
      ],
      residualDmInterpretation: [
        'None for persistence integrity; the player decides which characters to create.',
      ],
      runtimeOwner: [
        c('characterRegistry.ts'),
        c('characterCustody.ts'),
        cli('characterRegistry.ts'),
        cli('playCharacter.ts'),
        cli('createCharacter.ts'),
      ],
      evidence: [t('characterRegistry.test.ts'), t('characterCustody.test.ts')],
    },
  ),
  engineEntry(
    'character-checkout-v1',
    'checkoutCharacterIntoCampaign',
    c('characterCustody.ts'),
    'state-integrity',
    {
      operation:
        'Check a registry character out into a campaign as its single active writer. Refuses when another campaign holds custody, when this campaign holds it under a different party slot, and when the id is not registered; seeds revision 1 from a legacy head that has no timeline; attaches the registry head sheet (character-sheet-attach-v1: build and rules-pack checks, the sheet stamped with the global id, import time, and checked-out revision, then projected into the live row); and only after the attach succeeds records custody (campaign, slot, revision). The CLI checks out an existing registry character the player imports, each newly registered character (for the first character and /addpc), and each fork it plays.',
      requiredInputs: [
        'The registry store',
        'The campaign database',
        'globalCharacterId',
        'campaignId',
        'characterId (the party slot; pc-1 when omitted)',
        'sessionId and at',
      ],
      exclusions: [
        'A rejected attach (a sheet built under another rules pack, or a build outside the single-class boundary) throws before custody is recorded.',
        'When the attach returns a correction result (ok:false, for a campaign whose rules system is not dnd5e-srd and so has no live-row import), no custody is recorded and the result is returned to the caller.',
        'Re-checkout into the same campaign and slot is idempotent (it re-attaches the head and rewrites custody) only when the campaign copy, once its attachment provenance is stripped, equals the registry head; a campaign copy with unsynced changes is refused so they are never overwritten. Resuming a campaign uses character-resume-custody-v1 instead.',
        'The campaign writes and the registry custody write are ordered, not one transaction.',
      ],
      residualDmInterpretation: [
        'The player decides which registry character joins the campaign and in which slot.',
      ],
      runtimeOwner: [
        c('characterCustody.ts'),
        c('attachCharacter.ts'),
        c('characterRegistry.ts'),
        cli('playCharacter.ts'),
        cli('playFork.ts'),
      ],
      evidence: [t('characterCustody.test.ts'), t('characterRegistry.test.ts')],
    },
  ),
  engineEntry(
    'character-sync-back-release-v1',
    'releaseCharacterFromCampaign',
    c('characterCustody.ts'),
    'state-integrity',
    {
      operation:
        'Commit a campaign character back to its registry timeline and release it. syncBackCharacterFromCampaign reads the campaign sheet and follows its stamped global id, and acts only when this campaign and slot hold custody: it strips the per-attachment provenance (global id, import time, source revision) and appends a sync-back revision unless the result equals the registry head sheet (then it reports committed:false and appends nothing). releaseCharacterFromCampaign validates any selected chronicle records, performs that sync-back, and then, only when it acted as the custody holder, appends those records and clears custody. The CLI releases every campaign character on quit and reports, rather than propagates, a failure.',
      requiredInputs: [
        'The registry store',
        'The campaign database',
        'campaignId and characterId of the caller',
        'An optional chronicle store and selected chronicle records (release)',
      ],
      exclusions: [
        'A caller that is not the custody holder, and a campaign sheet with no registry link, get no result: nothing is appended and custody is untouched, so a stale campaign copy cannot revert the timeline or drop another campaign hold.',
        'Chronicle records passed without a chronicle store are refused, and for the custody holder invalid chronicle records are refused, before the sync-back writes anything.',
        'The revision append, the chronicle append, and the custody clear are separate writes, not one transaction.',
        'Does not merge divergent sheets; it appends the holder copy as the next revision.',
      ],
      residualDmInterpretation: [
        'The player decides when to leave a campaign and which character-scoped memories to carry forward.',
      ],
      runtimeOwner: [
        c('characterCustody.ts'),
        c('characterRegistry.ts'),
        c('characterChronicle.ts'),
        cli('playClose.ts'),
      ],
      evidence: [
        t('characterCustody.test.ts'),
        t('characterChronicle.test.ts'),
      ],
    },
  ),
  engineEntry(
    'character-resume-custody-v1',
    'acquireCustodyOnResume',
    c('characterCustody.ts'),
    'state-integrity',
    {
      operation:
        'Re-take custody for a campaign character that is already attached when the campaign resumes, without re-attaching, so per-turn campaign state such as hit points and conditions survives. classifyResumeConflict reads without writing: not-linked (no registry link), already-held (this campaign and slot hold custody), held-elsewhere (another holder), stale-copy (no holder, but the registry head sheet differs from this campaign copy once its provenance is stripped), or resumable. checkCustodyResumable turns held-elsewhere and stale-copy into CharacterCustodyError, and acquireCustodyOnResume records custody at the head revision only for resumable. The CLI resume flow classifies every campaign character first, stops on any held-elsewhere conflict and on a cancelled stale-copy choice before writing anything, applies each chosen catch-up or fork, and then acquires custody for every character.',
      requiredInputs: [
        'The registry store',
        'The campaign database',
        'campaignId and characterId',
        'at (acquire)',
      ],
      exclusions: [
        'Held elsewhere is a hard stop; there is no custody-steal path.',
        'A stale copy is never resolved automatically: cancel (the default, also on end of input or unrecognized input) writes nothing, and catch-up and fork are explicit choices.',
        'Only classification-time conflicts and cancellation abort before any write; if applying a chosen catch-up or fork fails, choices already applied remain.',
      ],
      residualDmInterpretation: [
        'The player chooses how to resolve a stale copy.',
      ],
      runtimeOwner: [
        c('characterCustody.ts'),
        c('characterRegistry.ts'),
        cli('playCharacter.ts'),
      ],
      evidence: [t('characterCustody.test.ts')],
    },
  ),
  engineEntry(
    'character-catch-up-v1',
    'catchUpCharacterToHead',
    c('characterCustody.ts'),
    'state-integrity',
    {
      operation:
        'Adopt the registry head into a campaign whose character copy is stale: refuse a campaign character with no registry link, one whose custody another campaign or slot holds, and a character with no registry timeline; re-attach the head sheet over the campaign copy (stamped with the head as its source revision and re-projected into the live row); and record custody at the head revision. The stale campaign copy is replaced wholesale, not merged, and no registry revision is appended. The CLI runs it only as an explicit resume choice, confirmed again when a combat or scene is open.',
      requiredInputs: [
        'The registry store',
        'The campaign database',
        'campaignId and characterId',
        'sessionId and at',
      ],
      exclusions: [
        'The re-attach and the custody write are ordered, not one transaction.',
        'An in-fiction continuity bridge is optional and composed separately; the mechanical catch-up does not depend on it.',
      ],
      residualDmInterpretation: [
        'The player chooses catch-up over cancel or fork and decides whether to bridge the change in fiction.',
      ],
      runtimeOwner: [
        c('characterCustody.ts'),
        c('attachCharacter.ts'),
        cli('playCharacter.ts'),
      ],
      evidence: [t('characterCustody.test.ts')],
    },
  ),
  engineEntry(
    'character-timeline-fork-v1',
    'forkCharacterTimeline',
    c('characterCustody.ts'),
    'state-integrity',
    {
      operation:
        'Branch a chosen revision (the source head when none is given) of a registry character into a new global character id as its revision 1, with source fork and parent provenance (source id and revision), deliberately breaking continuity: the source timeline and custody are untouched. Refuses a target id that already has a revision timeline or a head row, a source with no timeline, and a source revision that does not exist. The CLI uses it for the explicit fork-character command (registry only, not attached) and for the resume stale-copy fork choice, which forks this campaign stamped revision and checks the fork into the same slot (character-checkout-v1).',
      requiredInputs: [
        'The registry store',
        'sourceGlobalCharacterId',
        'newGlobalCharacterId',
        'fromRevision (optional)',
      ],
      exclusions: [
        'Never moves a character between campaigns (release and re-checkout does) and never merges timelines.',
      ],
      residualDmInterpretation: [
        'The player decides to fork and, for the explicit command, names the new identity.',
      ],
      runtimeOwner: [
        c('characterCustody.ts'),
        c('characterRegistry.ts'),
        cli('playFork.ts'),
      ],
      evidence: [t('characterCustody.test.ts'), t('characterRegistry.test.ts')],
    },
  ),
  engineEntry(
    'character-chronicle-v1',
    'createCharacterChronicleStore',
    c('characterChronicle.ts'),
    'state-integrity',
    {
      operation:
        'Persist a character portable chronicle (relationships, scars, debts, vows, subjective knowledge, and similar records) in the registry database. Appending validates every record (non-empty text, source campaign, session, and time, non-empty related ref ids, and enumerated category, portability, visibility, and truth status), assigns the next free chronicle id when none is given, refuses a duplicate id, and inserts each record with a create event in one transaction (a batch is one transaction). Updating revalidates the merged record and rewrites it with an update event listing the changed fields. Release appends the selected records (character-sync-back-release-v1). When the DM context is assembled, only portable records that are not private are included for the acting character, up to the context limit (contextAssembler.ts).',
      requiredInputs: [
        'The registry database',
        'globalCharacterId',
        'The record fields: category, text, source, portability, visibility, truth status, and related refs',
      ],
      exclusions: [
        'Records are never deleted; the event log keeps each create and update.',
        'The labels are caller-declared; the store does not judge truth or significance.',
        'Campaign world canon is never read or merged here.',
        'The CLI lists, shows, and updates records; no model tool writes them.',
      ],
      residualDmInterpretation: [
        'The player decides what the character remembers and its labels; the DM uses dm-only entries for continuity only.',
      ],
      runtimeOwner: [
        c('characterChronicle.ts'),
        c('characterCustody.ts'),
        o('contextAssembler.ts'),
        cli('chronicle.ts'),
      ],
      evidence: [
        t('characterChronicle.test.ts'),
        t('contextAssembler.test.ts'),
      ],
    },
  ),
];

// ---------------------------------------------------------------------------
// Turns, sessions, campaigns, and identity
// ---------------------------------------------------------------------------

const TURNS_AND_SESSIONS: readonly DeterministicCapabilityInventoryEntry[] = [
  engineEntry(
    'turn-transaction-v1',
    'runTurn',
    o('orchestrator.ts'),
    'state-integrity',
    {
      operation:
        'Run one campaign turn inside an outer SQLite savepoint, with three distinct failure boundaries. (1) A failed tool call does not abort the turn: an unknown tool (unknown_tool), arguments that fail the tool input schema (invalid_args, checked before the tool runs), an unparseable tool request (parse_error, never executed), a refusal the tool returns, and an exception thrown inside a tool (caught by the registry as tool_error) are each recorded as a failed result and returned to the model, which continues the turn. Writes made by other successful calls stay in place, and the registry undoes nothing itself; whether a failing tool can leave writes of its own is stated on that tool entry. (2) Each candidate response runs in its own nested savepoint, and only the candidate decision rolls it back. With no auditor the first candidate is accepted whatever its failed calls. With an auditor, an accepted candidate is kept even when some of its calls failed, and a rejected candidate writes are rolled back to the nested savepoint before a retry or before the turn fails; at most three candidates run, and after the first a retry happens only when the verdict raises a requirement not seen before. A rejection the auditor marks as presentation-only (roll ledger) is accepted as a repair only when it has no disallowed call, no missing tool other than roll, no failed tool call, and explicit visibility and category on every successful roll-evidence call, at least one of them player-visible. (3) A failure that escapes the candidate loop aborts the turn: every write of the turn is rolled back to the outer savepoint and runTurn returns ok:false. Such failures are a model, provider, or auditor error, a tool-round budget exhausted without final narration, empty narration, an audit rejection with no retry left, a failure while recording an accepted precedent (including an existing prospective ruling), and any error thrown by the pre-turn checks, context assembly, or the commit steps. Before any context assembly or tool call it refuses a turn id that already has an accepted trace unless a pending dispute replay of exactly that input is being resumed (whose state must be unchanged), resolves the campaign position, and requires the acting character to be a player character. Ambiguity precedents staged by the accepted candidate are recorded as rulings (a second proposal for the same ambiguity within one candidate is a failed tool result). The accepted turn then summarizes any scenes it closed, appends the player input and the narration to the scene log (opening an untitled scene when none is open), records the validated turn trace with the accepted state delta, retains the replay snapshot, and releases the outer savepoint.',
      requiredInputs: [
        'The campaign database, model client, and tool registry',
        'campaignId, sessionId, turnId, playerInput, and at',
        'actingCharacterId (the active character when omitted)',
        'An optional turn auditor and an optional tool-round budget (8 per candidate by default)',
      ],
      exclusions: [
        'A failed tool result is not itself a turn failure or a candidate rejection: the engine rolls back a candidate only on an auditor rejection and the whole turn only on an escaping failure, so a successful write made before or after a failed call survives an accepted candidate.',
        'The audit verdict is a model judgment; the engine owns only the savepoints, the retry bound, and the presentation-repair rule.',
        'runTurn refuses to overwrite an accepted turn; a dispute goes through dispute-turn-v1.',
        'The final narration is stored in the scene log and trace but not parsed into game state: state changes come from tool calls and from the engine bookkeeping listed above (campaign position, accepted precedents, scene summaries and scene log, turn trace, replay snapshot); the roll ledger appended to the narration is rendered from tool results and writes nothing.',
        'The savepoints cover the campaign database only: after an abort a turn-failure diagnostic row is written to it best-effort, and the optional diagnostics and debug sinks are injected callbacks whose storage runTurn does not manage.',
      ],
      residualDmInterpretation: [
        'The DM model narrates and chooses the tool calls; the auditor model judges each candidate.',
      ],
      runtimeOwner: [
        o('orchestrator.ts'),
        o('turnLoop.ts'),
        o('toolRegistry.ts'),
        'packages/core/src/model/toolSchemaValidation.ts',
        o('auditRetryDiagnostics.ts'),
        o('turnTranscript.ts'),
        o('scene.ts'),
        o('turnTraceProjection.ts'),
        'packages/core/src/memory/turnTrace.ts',
        s('activeCharacter.ts'),
        'packages/core/src/campaign/campaignPosition.ts',
        'packages/core/src/campaign/ambiguityResolution.ts',
        'packages/core/src/campaign/turnReplayStore.ts',
      ],
      evidence: [
        t('orchestrator.test.ts'),
        t('turnAuditor.test.ts'),
        t('actingCharacter.test.ts'),
      ],
    },
  ),
  engineEntry(
    'player-visible-roll-ledger-v1',
    'appendPlayerVisibleRollLedger',
    o('playerVisibleRollLedger.ts'),
    'state-integrity',
    {
      operation:
        'Cut a candidate narration from the first line that begins (after optional spaces or tabs) with "Rolls:" (in any case) followed by a line break, to the end, then, when there is at least one entry, append an engine-rendered Rolls: ledger built, in call order, only from successful player_visible results of roll, resolve_check, resolve_contest, roll_retained_check, resolve_retained_check, resolve_damage, and spend_rest_hit_die; the dice, kept and dropped dice, natural results, modifiers, totals, and outcomes come from the tool data. It runs on every candidate before the audit.',
      requiredInputs: ['The candidate narration', 'The executed tool calls'],
      exclusions: [
        'dm_only results, results without a recognized visibility, and failed calls never appear.',
        'Does not decide visibility; the DM declares it on each roll (spend_rest_hit_die results are always player-visible).',
        'Model prose and other tools are never read into the ledger; any model text after such a line-leading "Rolls:" is dropped, not preserved; "Rolls:" in the middle of a line is left in the narration.',
      ],
      residualDmInterpretation: [
        'The DM decides which rolls the player sees and narrates around the ledger.',
      ],
      runtimeOwner: [o('playerVisibleRollLedger.ts'), o('orchestrator.ts')],
      evidence: [t('playerVisibleRollLedger.test.ts')],
    },
  ),
  engineEntry(
    'character-targeting-v1',
    'resolveCharacterRef',
    s('activeCharacter.ts'),
    'state-integrity',
    {
      operation:
        'Resolve which character an operation targets. A character reference resolves to an exact row id or, failing that, to a unique case-insensitive name; no match and more than one match are refused (tools return invalid_target). An omitted reference means the acting character of the turn. setActiveCharacterId changes the active character only to an existing player character; character creation and import set it, and the CLI /switch command sets it.',
      requiredInputs: [
        'A database',
        'A character id or name (the acting character when omitted)',
      ],
      exclusions: [
        'Does not decide which character the player means beyond exact id and unique name matching.',
      ],
      residualDmInterpretation: [
        'The DM decides which character an action targets and names it unambiguously.',
      ],
      runtimeOwner: [
        s('activeCharacter.ts'),
        o('toolRegistry.ts'),
        cli('playParty.ts'),
      ],
      evidence: [
        t('toolCharacterTargeting.test.ts'),
        t('actingCharacter.test.ts'),
        t('party.test.ts'),
      ],
    },
  ),
  engineEntry(
    'session-lifecycle-v1',
    'startSession',
    'packages/core/src/session/session.ts',
    'state-integrity',
    {
      operation:
        'Open and close campaign play sessions. startSession refuses blank ids, a campaign that already has an open session, and a session id already used, and inserts the open session in one transaction. closeSessionGracefully refuses an unknown session and, in one transaction and only while the session is still open, closes its open scene (writing that scene log summary), records the session recap, closes the session, and optionally stamps its memory arc; closing an already-closed session repeats none of that. A close-time checkpoint runs after that transaction commits and is marked done only when it succeeds, so a failed checkpoint is retried by the next close call.',
      requiredInputs: [
        'A database',
        'campaignId and sessionId',
        'startedAt (start), or closedAt, recap, and state delta (close)',
        'An optional checkpoint runner and arc stamp (close)',
      ],
      exclusions: [
        'The recap and summaries are generated memory supplied or derived from the log; their content is not judged here.',
        'Does not decide when a session starts or ends.',
      ],
      residualDmInterpretation: [
        'The player decides when to play and when to stop.',
      ],
      runtimeOwner: [
        'packages/core/src/session/session.ts',
        'packages/core/src/session/close.ts',
        o('scene.ts'),
        cli('playSession.ts'),
        cli('playClose.ts'),
      ],
      evidence: [t('session.test.ts'), t('sessionClose.test.ts')],
    },
  ),
  engineEntry(
    'demo-campaign-v1',
    'createDemoCampaign',
    'packages/core/src/campaign/demoMode.ts',
    'state-integrity',
    {
      operation:
        'Create a bounded public demo campaign and meter its turns. createDemoCampaign requires a positive integer turn cap (DEMO_TURN_CAP when omitted) and refuses a module pack whose license is not both shippable and cleared for hosted use, then creates the campaign (campaign-creation-v1, default binding) and starts its session (session-lifecycle-v1). getDemoTurnBudget counts the distinct player turns in that session scene log against the cap; the CLI stops the demo turn loop once the cap is reached, and assertDemoTurnAllowed refuses at the cap.',
      requiredInputs: [
        'A database',
        'campaignId, sessionId, and startedAt',
        'An optional module pack, turn cap, profile registry, and DM profile',
      ],
      exclusions: [
        'Campaign creation and session start are two transactions; a failed session start leaves the created campaign.',
        'The turn count is derived from the scene log, not kept as a separate counter.',
        'The demo model decision is reported for labelling, not enforced.',
      ],
      residualDmInterpretation: [
        'The operator chooses the demo content; the player chooses to play.',
      ],
      runtimeOwner: [
        'packages/core/src/campaign/demoMode.ts',
        'packages/core/src/world/license.ts',
        cli('play.ts'),
        cli('playTurnLoop.ts'),
      ],
      evidence: [t('demoMode.test.ts')],
    },
  ),
  engineEntry(
    'adventure-run-v1',
    'startAdventureRun',
    'packages/core/src/campaign/adventureRun.ts',
    'state-integrity',
    {
      operation:
        'Bind a campaign to an immutable adventure module through an adventure run. startAdventureRun requires non-blank ids and provenance, a known status (active when omitted), and non-empty session markers when given, refuses a run id that already exists in the campaign, and inserts the run with empty progress in one transaction; the CLI module selector starts it. recordAdventureRunProgress validates a progress delta (non-empty ids, known encounter resolutions, non-negative integer clock fills, complete deviations) and merges it in one transaction (id lists unioned in order; encounter outcomes, clocks, and deviations replaced by id), optionally updating status, session markers, and notes, and refuses a missing run. Retained and staged: recordAdventureRunProgress has no production caller (tests only), and eshyra-aiq8 owns wiring a consumer.',
      requiredInputs: [
        'A database',
        'campaignId and runId',
        'moduleId (start)',
        'provenance, sessionId, and updatedAt',
        'A progress delta (progress)',
      ],
      exclusions: [
        'The module is referenced by id only; its source is neither read nor written.',
        'Does not check that recorded ids exist in the module.',
        'start_encounter reads encounters only from active runs.',
      ],
      residualDmInterpretation: [
        'The player chooses the module; the DM decides what progress happened.',
      ],
      runtimeOwner: [
        'packages/core/src/campaign/adventureRun.ts',
        cli('playModuleSelector.ts'),
      ],
      evidence: [t('adventureRun.test.ts')],
    },
  ),
  engineEntry(
    'simple-character-creation-v1',
    'completeCharacterCreation',
    c('creation.ts'),
    'state-integrity',
    {
      operation:
        'Complete the simple draft creation flow by campaign rules system: a dnd5e-srd draft is validated (a known SRD class and ancestry, a name, level 1 only, integer ability scores valid for the chosen method, the class level-1 hit point maximum, and spells that resolve and are on the class list), a pathfinder2e-remaster draft is validated against that pack, and a valid draft is projected into the live character row through the validated state seam and made the active character in one transaction. The CLI calls it only for campaigns whose rules system is not dnd5e-srd (dnd5e campaigns use the guided path), so no production caller reaches its dnd5e-srd branch.',
      requiredInputs: [
        'A database',
        'The draft',
        'sessionId and at',
        'characterId (pc-1 when omitted)',
      ],
      exclusions: [
        'An invalid draft, and a campaign rules system with no implementation, return ok:false with the reasons and write nothing.',
        'Writes no canonical character sheet; the guided path (finalize-character-v1, character-sheet-attach-v1) does.',
      ],
      residualDmInterpretation: ['The player supplies every choice.'],
      runtimeOwner: [
        c('creation.ts'),
        c('pathfinder2e.ts'),
        s('activeCharacter.ts'),
        s('mutateState.ts'),
        cli('playCharacter.ts'),
      ],
      evidence: [
        t('characterCreation.test.ts'),
        t('pathfinderCharacterCreation.test.ts'),
      ],
    },
  ),
  engineEntry(
    'guided-level-up-v1',
    'runGuidedLevelUp',
    c('guidedLevelUpFlow.ts'),
    'bounded-procedure',
    {
      operation:
        'Drive one guided level-up: refuse a build outside the single-class boundary; return not-eligible unless getLevelUpEligibility says the character may level up; refuse a missing sheet and a sheet level that disagrees with the live level; preview the change set and return the required choices (blocked when any is unsupported); and commit through applyLevelUp only on an explicit confirm, returning cancelled on an explicit decline. The CLI level-up command runs it.',
      requiredInputs: [
        'A database and sheet store',
        'characterId (the active character when omitted)',
        'The choices, hit point choice, and confirm decision',
        'source, provenance, sessionId, and at',
      ],
      exclusions: [
        'Levels at most once per call; multi-level catch-up is repeated calls.',
        'Does not award experience or milestones.',
      ],
      residualDmInterpretation: [
        'The player makes the choices and confirms; the DM adjudicates option effects the sheet only records.',
      ],
      runtimeOwner: [
        c('guidedLevelUpFlow.ts'),
        c('levelUpEngine.ts'),
        s('levelUpEligibility.ts'),
        cli('playProgression.ts'),
      ],
      evidence: [t('guidedLevelUpFlow.test.ts')],
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
    ...CHARACTER_CONTINUITY,
    ...TURNS_AND_SESSIONS,
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
 * The disposition of one module file under `packages/core/src`.
 *
 * `covered` is derived, never hand-maintained: a module is covered exactly when
 * at least one inventory entry names it in `runtimeOwner`, and `by` lists those
 * revisions. Every other module carries an explicit reason why it performs no
 * deterministic commitment of its own.
 */
export type ModuleDisposition =
  | {
      readonly disposition: 'covered';
      readonly by: readonly string[];
      /** Which part of a mixed module the covering entries describe. */
      readonly note?: string;
    }
  | {
      readonly disposition: 'not-a-deterministic-commitment';
      readonly reason: string;
    };

const PACK_DATA =
  'reads, validates, or resolves rules-pack record data; changes no state and makes no rules decision of its own (the consuming entries state the decisions)';
const SRD_CREATION_DATA =
  'SRD creation data tables or lookups over pack records consumed by character creation; performs no operation of its own';
const MODULE_PACK =
  'loads, validates, or lists authored module or adventure pack content; changes no campaign state';
const DISCOVERY =
  'rule discovery retrieval, measurement, or shadow evidence (ADR 0020 section 5); selects rule-awareness context for the DM and writes no game state';
const PROMPT =
  'assembles or renders text for the DM or auditor model; changes no state';
const MODEL_ADAPTER =
  'model provider adapter, profile, or usage accounting; makes no game-state or rules commitment';
const GENERATED_MEMORY =
  'generated memory (scene summaries, session recaps, arcs, campaign bible) composition or storage; non-canonical by design (ADR 0001) and makes no rules or game-state commitment';
const DIAGNOSTICS = 'diagnostics or debug recording; never changes game state';
const TYPES = 'type declarations (and their constant vocabularies) only';
const INFRASTRUCTURE =
  'generic infrastructure (database open and transaction helper, JSON column codec, identifier quoting, string helpers); each atomicity or validation claim is stated on the operation that uses it';
const AUDIT =
  'offline audit, registry, or proof machinery over the rules pack; no gameplay path calls it';
const DOLT_TOOLING =
  'locates, provisions, or runs the pinned Dolt binary for checkpoint-store-v1; tooling, not a state commitment';
const NON_CAPABILITY_TOOL =
  'implements a registered tool listed in NON_CAPABILITY_TOOLS with its reason';
const RULE_AWARENESS =
  'rule-awareness presentation for the DM model and discovery; writes nothing';

const core = (file: string) => `packages/core/src/${file}`;

const NOT_A_DETERMINISTIC_COMMITMENT: Readonly<Record<string, string>> = {
  [core('adventure/listModules.ts')]: MODULE_PACK,
  [core('adventure/loadModule.ts')]: MODULE_PACK,
  [core('adventure/references.ts')]: MODULE_PACK,
  [core('adventure/types.ts')]: TYPES,
  [core('adventure/validate.ts')]: MODULE_PACK,
  [core('campaign/campaignContext.ts')]:
    'assembles and renders the active campaign rules at the current position for the DM context; writes nothing (the rule store and its position checks are campaign-rule-store-v1)',
  [core('character/continuityBridge.ts')]:
    'composes an optional model-written catch-up bridge narration; changes no state',
  [core('character/dnd5eRecipe.ts')]:
    'creation wizard recipe (step order and modes) for the CLI; validates nothing itself',
  [core('character/recipe.ts')]: TYPES,
  [core('character/rulesPackResolver.ts')]: PACK_DATA,
  [core('character/srdAncestryAbilityScoreIncreases.ts')]: SRD_CREATION_DATA,
  [core('character/srdAncestrySkills.ts')]: SRD_CREATION_DATA,
  [core('character/srdClassSpellcasting.ts')]: SRD_CREATION_DATA,
  [core('character/srdClassStartingEquipment.ts')]: SRD_CREATION_DATA,
  [core('character/srdCreationChoices.ts')]: SRD_CREATION_DATA,
  [core('character/srdEquipmentPacks.ts')]: SRD_CREATION_DATA,
  [core('character/srdLanguages.ts')]: SRD_CREATION_DATA,
  [core('character/srdStartingEquipmentGrants.ts')]: SRD_CREATION_DATA,
  [core('config.ts')]:
    'resolves runtime provider and model configuration; makes no game-state or rules commitment',
  [core('debug/sessionDebug.ts')]: DIAGNOSTICS,
  [core('discovery/accounting.ts')]: DISCOVERY,
  [core('discovery/bands.ts')]: DISCOVERY,
  [core('discovery/blockerRepairs.ts')]: DISCOVERY,
  [core('discovery/campaignRuleSeam.ts')]: DISCOVERY,
  [core('discovery/candidates.ts')]: DISCOVERY,
  [core('discovery/dedup.ts')]: DISCOVERY,
  [core('discovery/expansion.ts')]: DISCOVERY,
  [core('discovery/harness.ts')]: DISCOVERY,
  [core('discovery/measurements.ts')]: DISCOVERY,
  [core('discovery/packet.ts')]: DISCOVERY,
  [core('discovery/packetMessage.ts')]: DISCOVERY,
  [core('discovery/retention.ts')]: DISCOVERY,
  [core('discovery/shadow.ts')]: DISCOVERY,
  [core('discovery/signals.ts')]: DISCOVERY,
  [core('discovery/structuralEquality.ts')]: DISCOVERY,
  [core('discovery/traceDerivation.ts')]: DISCOVERY,
  [core('discovery/traceProjection.ts')]: DISCOVERY,
  [core('discovery/types.ts')]: TYPES,
  [core('memory/arcSummary.ts')]: GENERATED_MEMORY,
  [core('memory/campaignArc.ts')]: GENERATED_MEMORY,
  [core('memory/campaignBibleExtractor.ts')]: GENERATED_MEMORY,
  [core('memory/config.ts')]: GENERATED_MEMORY,
  [core('memory/recapBuilder.ts')]: GENERATED_MEMORY,
  [core('memory/summary.ts')]: GENERATED_MEMORY,
  [core('memory/turnFailureDiagnostic.ts')]: DIAGNOSTICS,
  [core('model/agentSdkClient.ts')]: MODEL_ADAPTER,
  [core('model/agentSdkEnv.ts')]: MODEL_ADAPTER,
  [core('model/agentSdkLoader.ts')]: MODEL_ADAPTER,
  [core('model/agentSdkMcpClient.ts')]: MODEL_ADAPTER,
  [core('model/anthropicNativeClient.ts')]: MODEL_ADAPTER,
  [core('model/client.ts')]: MODEL_ADAPTER,
  [core('model/codexEnv.ts')]: MODEL_ADAPTER,
  [core('model/codexMcpHttpServer.ts')]: MODEL_ADAPTER,
  [core('model/codexSdkMcpClient.ts')]: MODEL_ADAPTER,
  [core('model/evaluation.ts')]:
    'offline model-tier evaluation harness; no gameplay path calls it',
  [core('model/jsonSchemaToZod.ts')]: MODEL_ADAPTER,
  [core('model/openaiNativeClient.ts')]: MODEL_ADAPTER,
  [core('model/profiles.ts')]: MODEL_ADAPTER,
  [core('model/toolSchema.ts')]:
    'tool input-schema types and provider rendering; schema validation of tool calls is stated in turn-transaction-v1 (model/toolSchemaValidation.ts)',
  [core('model/usage.ts')]: MODEL_ADAPTER,
  [core('orchestrator/adventureAudit.ts')]:
    'builds a read-only adventure progress audit report; writes nothing',
  [core('orchestrator/adventureContext.ts')]: PROMPT,
  [core('orchestrator/protocol.ts')]:
    'renders the system prompt and parses text-protocol tool calls; each call commitment is its tool entry',
  [core('orchestrator/toolLookupRules.ts')]: NON_CAPABILITY_TOOL,
  [core('orchestrator/toolMemoryDrilldown.ts')]: NON_CAPABILITY_TOOL,
  [core('orchestrator/toolRequest.ts')]:
    'normalizes provider tool-call requests before dispatch; each call commitment is its tool entry',
  [core('orchestrator/toolWorldQuery.ts')]: NON_CAPABILITY_TOOL,
  [core('orchestrator/tools.ts')]:
    'the registration list of the default tool registry; the closure test accounts for every registered tool',
  [core('orchestrator/turnAuditor.ts')]:
    'model-based mechanics auditor whose verdict is model judgment; turn-transaction-v1 states what the engine does with the verdict',
  [core('orchestrator/turnSceneSummary.ts')]: GENERATED_MEMORY,
  [core('persistence/checkpoint/doltBinary.ts')]: DOLT_TOOLING,
  [core('persistence/checkpoint/doltCli.ts')]: DOLT_TOOLING,
  [core('persistence/checkpoint/doltProvision.ts')]: DOLT_TOOLING,
  [core('persistence/db.ts')]: INFRASTRUCTURE,
  [core('persistence/jsonColumn.ts')]: INFRASTRUCTURE,
  [core('persistence/sql.ts')]: INFRASTRUCTURE,
  [core('rules/audit.ts')]: AUDIT,
  [core('rules/bundledSrdPack.ts')]: PACK_DATA,
  [core('rules/conditionRelations.ts')]: PACK_DATA,
  [core('rules/deterministicCapabilityContract.ts')]:
    'capability contract types and the magic-item readiness contract text; the preflight itself is derived-magic-item-clauses-v1',
  [core('rules/deterministicCapabilityInventory.ts')]:
    'this inventory: proof machinery that states capabilities and performs none',
  [core('rules/deterministicCapabilityLedger.ts')]:
    'rule-bound capability contracts and their model-facing rule bindings (presentation); the operations are the entries that quote them',
  [core('rules/featureChoices.ts')]: PACK_DATA,
  [core('rules/fieldProvenance.ts')]: PACK_DATA,
  [core('rules/findingRegistry.ts')]:
    'audit finding registry and its lookups; also read by rule-awareness presentation (ruleKnownLimits.ts), and writes no game state and makes no rules decision',
  [core('rules/inlineFeatureOptions.ts')]: PACK_DATA,
  [core('rules/jsonPointer.ts')]: PACK_DATA,
  [core('rules/kindSchemas.ts')]: PACK_DATA,
  [core('rules/license.ts')]:
    'license policy wrapper for rules packs used by audits and tests; no gameplay path calls it',
  [core('rules/lookup.ts')]: PACK_DATA,
  [core('rules/magicItemLegacyCapabilityBacklog.ts')]: AUDIT,
  [core('rules/magicItemMechanics.ts')]: PACK_DATA,
  [core('rules/magicItemVariants.ts')]: PACK_DATA,
  [core('rules/packLoader.ts')]: PACK_DATA,
  [core('rules/pathfinder2eRemaster.ts')]: PACK_DATA,
  [core('rules/recordCard.ts')]: RULE_AWARENESS,
  [core('rules/recordRelationships.ts')]: RULE_AWARENESS,
  [core('rules/repeatedFeatureChoices.ts')]: PACK_DATA,
  [core('rules/ruleAwareness.ts')]: RULE_AWARENESS,
  [core('rules/ruleKnownLimits.ts')]: RULE_AWARENESS,
  [core('rules/rulesAmbiguities.ts')]: PACK_DATA,
  [core('rules/spellUpcastContract.ts')]: PACK_DATA,
  [core('rules/srdAudit.ts')]: AUDIT,
  [core('rules/srdChoiceProseAudit.ts')]: AUDIT,
  [core('rules/srdEquipmentResolutionAudit.ts')]: AUDIT,
  [core('rules/srdPlayabilityAudit.ts')]: AUDIT,
  [core('rules/summoningSchema.ts')]: PACK_DATA,
  [core('rules/types.ts')]: TYPES,
  [core('rules/validate.ts')]: PACK_DATA,
  [core('rules/verticalProcedureProof.ts')]: AUDIT,
  [core('session/launch.ts')]:
    'read-only launch state used to choose between resuming and starting a session',
  [core('state/nameNormalization.ts')]: INFRASTRUCTURE,
  [core('state/party.ts')]:
    'read-only party listing for the DM context and CLI display',
  [core('validation.ts')]: INFRASTRUCTURE,
  [core('world/loadModule.ts')]: MODULE_PACK,
  [core('world/samples/emberfallHollow.ts')]: 'bundled sample module content',
  [core('world/types.ts')]: TYPES,
  [core('world/validate.ts')]: MODULE_PACK,
  [core('world/worldQuery.ts')]: NON_CAPABILITY_TOOL,
  [core('world/worldVisibility.ts')]:
    'classifies module fields as DM-only for world_query annotations and enforces no visibility (see NON_CAPABILITY_TOOLS.world_query)',
};

const COVERED_MODULE_NOTES: Readonly<Record<string, string>> = {
  [core('orchestrator/contextAssembler.ts')]:
    'only its character-chronicle selection (portable, non-private records) is a commitment; the rest assembles the DM prompt context',
  [core('orchestrator/orchestrator.ts')]:
    'the turn savepoint, candidate, audit, and commit sequence and the roll-ledger append; discovery capture and diagnostics recording are not commitments',
  [core('orchestrator/auditRetryDiagnostics.ts')]:
    'only the presentation-only repair rule decides acceptance; the retry-cause classification feeds diagnostics',
  [core('orchestrator/toolRegistry.ts')]:
    'ToolRegistry.invoke (input-schema validation and error wrapping) and resolveTargetCharacterId; tool definitions and mutation classification are presentation helpers',
  [core('character/abilityAllocation.ts')]:
    'ability-score rolling, assignment, and roll-evidence validation; class recommendation and command parsing are CLI helpers',
};

function buildModuleDispositions(): Readonly<
  Record<string, ModuleDisposition>
> {
  const coveredBy = new Map<string, string[]>();
  for (const entry of DETERMINISTIC_CAPABILITY_INVENTORY)
    for (const path of entry.runtimeOwner) {
      if (!path.startsWith('packages/core/src/')) continue;
      const revisions = coveredBy.get(path) ?? [];
      if (!revisions.includes(entry.revision)) revisions.push(entry.revision);
      coveredBy.set(path, revisions);
    }
  const dispositions: Record<string, ModuleDisposition> = {};
  for (const [path, by] of [...coveredBy].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (NOT_A_DETERMINISTIC_COMMITMENT[path] !== undefined)
      throw new Error(
        `${path}: covered module also has a no-commitment reason`,
      );
    const note = COVERED_MODULE_NOTES[path];
    dispositions[path] = Object.freeze({
      disposition: 'covered' as const,
      by: Object.freeze([...by]),
      ...(note === undefined ? {} : { note }),
    });
  }
  for (const path of Object.keys(COVERED_MODULE_NOTES))
    if (!coveredBy.has(path))
      throw new Error(
        `${path}: a covered-module note names an uncovered module`,
      );
  for (const [path, reason] of Object.entries(NOT_A_DETERMINISTIC_COMMITMENT))
    dispositions[path] = Object.freeze({
      disposition: 'not-a-deterministic-commitment' as const,
      reason,
    });
  return Object.freeze(dispositions);
}

/**
 * Every module file under `packages/core/src` (except the `index.ts` and
 * `internal.ts` barrels), each with exactly one disposition. Covered modules
 * are derived from the inventory's runtime owners; the rest name their reason.
 */
export const MODULE_DISPOSITIONS: Readonly<Record<string, ModuleDisposition>> =
  buildModuleDispositions();

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
