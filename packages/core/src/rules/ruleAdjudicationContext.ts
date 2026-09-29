export interface RuleAdjudicationContext {
  readonly tools: readonly string[];
  readonly dmContext: string;
}

/** Positive mappings from source rules to registered runtime tools (A3). */
export const RULE_ADJUDICATION_CONTEXT: Readonly<
  Record<string, RuleAdjudicationContext>
> = Object.freeze({
  // R0 confirmed: action:attack (attack) uses spend_turn_resource, resolve_check; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'action:attack': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Spend the Attack action with spend_turn_resource, then resolve each permitted attack through resolve_check with its declared target AC and modifiers.',
  }),
  // R0 confirmed: action:dash (dash) uses spend_turn_resource; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts.
  'action:dash': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Record the Dash action with spend_turn_resource; its movement is represented by the turn activity.',
  }),
  // R0 confirmed: action:disengage (disengage) uses spend_turn_resource; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts.
  'action:disengage': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Record the Disengage action with spend_turn_resource so its turn cost is spent.',
  }),
  // R0 confirmed: action:dodge (dodge) uses spend_turn_resource, resolve_check; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'action:dodge': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Spend the Dodge action with spend_turn_resource, then declare its advantage or disadvantage to resolve_check for an affected save or attack.',
  }),
  // R0 confirmed: action:help (help) uses spend_turn_resource, resolve_check; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'action:help': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Spend the Help action with spend_turn_resource, then give the assisted check or attack advantage through resolve_check.',
  }),
  // R0 confirmed: action:hide (hide) uses spend_turn_resource, resolve_check; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'action:hide': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Spend the Hide action with spend_turn_resource in combat, then use resolve_check for the Dexterity (Stealth) check.',
  }),
  // R0 confirmed: action:ready (ready) uses spend_turn_resource; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts.
  'action:ready': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Spend the Ready action with spend_turn_resource, then spend the reaction with spend_turn_resource if its declared trigger occurs.',
  }),
  // R0 confirmed: action:search (search) uses spend_turn_resource, resolve_check; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'action:search': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Spend the Search action with spend_turn_resource in combat, then pass the chosen Intelligence (Investigation) or Wisdom (Perception) check to resolve_check.',
  }),
  // R0 confirmed: action:use-an-object (use an object) uses spend_turn_resource; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts.
  'action:use-an-object': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Spend the Use an Object action with spend_turn_resource when the interaction requires an action.',
  }),
  // R0 confirmed: rule:being-prone (being prone) uses add_condition, remove_condition; tool descriptions: packages/core/src/orchestrator/toolAddCondition.ts, packages/core/src/orchestrator/toolRemoveCondition.ts.
  'rule:being-prone': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'add_condition', 'remove_condition']),
    dmContext:
      'Record a creature becoming prone with add_condition and its recovery with remove_condition.',
  }),
  // R0 confirmed: rule:casting-a-spell-attack-rolls (casting a spell attack rolls) uses resolve_check; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:casting-a-spell-attack-rolls': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      'Use resolve_check with kind attack and the caster’s spell attack bonus for a spell attack.',
  }),
  // R0 confirmed: rule:casting-a-spell-saving-throws (casting a spell saving throws) uses resolve_check; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:casting-a-spell-saving-throws': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      'Use resolve_check with kind saving_throw and the spell save DC when the target makes the specified save.',
  }),
  // R0 confirmed: rule:coinage (coinage) uses gain_currency, spend_currency, convert_currency; tool descriptions: packages/core/src/orchestrator/toolGainCurrency.ts, packages/core/src/orchestrator/toolSpendCurrency.ts, packages/core/src/orchestrator/toolConvertCurrency.ts.
  'rule:coinage': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'gain_currency',
      'spend_currency',
      'convert_currency',
    ]),
    dmContext:
      'Record received coins with gain_currency, payments with spend_currency, and exact denomination changes with convert_currency.',
  }),
  // R0 confirmed: rule:combat-step-by-step (combat step by step) uses start_encounter, set_surprised, begin_turn, close_combat_instance; tool descriptions: packages/core/src/orchestrator/toolStartEncounter.ts, packages/core/src/orchestrator/toolSetSurprised.ts, packages/core/src/orchestrator/toolBeginTurn.ts, packages/core/src/orchestrator/toolCloseCombatInstance.ts.
  'rule:combat-step-by-step': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'start_encounter',
      'set_surprised',
      'begin_turn',
      'close_combat_instance',
    ]),
    dmContext:
      'Start the encounter with start_encounter, mark surprised participants with set_surprised, advance their turns with begin_turn, and close combat with close_combat_instance.',
  }),
  // R0 confirmed: rule:complex-traps (complex traps) uses start_encounter, update_combatant; tool descriptions: packages/core/src/orchestrator/toolStartEncounter.ts, packages/core/src/orchestrator/toolUpdateCombatant.ts.
  'rule:complex-traps': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'start_encounter',
      'update_combatant',
    ]),
    dmContext:
      'If a complex trap participates in combat, include it with start_encounter and record its combatant changes with update_combatant.',
  }),
  // R0 confirmed: rule:consumables (activation consumes the item) uses use_item for pack-bound operations or remove_item for an unbound physical item; tool descriptions: packages/core/src/orchestrator/toolUseItem.ts, packages/core/src/orchestrator/toolRemoveItem.ts.
  'rule:consumables': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'use_item', 'remove_item']),
    dmContext:
      'Use use_item for a pack-bound consumable operation; after an unbound consumable is used, record its destruction with remove_item.',
  }),
  // R0 confirmed: rule:dexterity-attack-rolls-and-damage (dexterity attack rolls and damage) uses resolve_check, resolve_damage; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts, packages/core/src/orchestrator/toolResolveDamage.ts.
  'rule:dexterity-attack-rolls-and-damage': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check', 'resolve_damage']),
    dmContext:
      'Pass the Dexterity modifier to resolve_check for an eligible attack and to resolve_damage for its damage packet.',
  }),
  // R0 confirmed: rule:dexterity-initiative (dexterity initiative) uses resolve_check, begin_turn; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts, packages/core/src/orchestrator/toolBeginTurn.ts.
  'rule:dexterity-initiative': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check', 'begin_turn']),
    dmContext:
      'Use resolve_check with kind ability_check and the Dexterity modifier for initiative, then call begin_turn in initiative order.',
  }),
  // R0 confirmed: rule:downtime-activities (downtime activities) uses advance_time; tool descriptions: packages/core/src/orchestrator/toolRest.ts.
  'rule:downtime-activities': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'advance_time']),
    dmContext:
      'Record elapsed downtime with advance_time after the activity duration is established.',
  }),
  // R0 confirmed: rule:falling (falling) uses calc, resolve_damage, adjust_hp, update_combatant, add_condition; tool descriptions: packages/core/src/orchestrator/toolCalc.ts, packages/core/src/orchestrator/toolResolveDamage.ts, packages/core/src/orchestrator/toolAdjustHp.ts, packages/core/src/orchestrator/toolUpdateCombatant.ts, packages/core/src/orchestrator/toolAddCondition.ts.
  'rule:falling': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'calc',
      'resolve_damage',
      'adjust_hp',
      'update_combatant',
      'add_condition',
    ]),
    dmContext:
      'Use calc with fall_damage_dice, evaluate the resulting packet with resolve_damage, apply damage through adjust_hp or update_combatant, and record prone with add_condition when applicable.',
  }),
  // R0 confirmed: rule:food (food) uses calc, add_condition; tool descriptions: packages/core/src/orchestrator/toolCalc.ts, packages/core/src/orchestrator/toolAddCondition.ts.
  'rule:food': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc', 'add_condition']),
    dmContext:
      'Use calc with days_without_food_limit for the Constitution threshold, then record resulting exhaustion with add_condition.',
  }),
  // R0 confirmed: rule:grappling (grappling) uses resolve_contest, add_condition; tool descriptions: packages/core/src/orchestrator/toolResolveContest.ts, packages/core/src/orchestrator/toolAddCondition.ts.
  'rule:grappling': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_contest', 'add_condition']),
    dmContext:
      'Resolve the Athletics contest with resolve_contest, then record the grappled condition with add_condition on success.',
  }),
  // R0 confirmed: rule:hiding (hiding) uses resolve_contest, calc; tool descriptions: packages/core/src/orchestrator/toolResolveContest.ts, packages/core/src/orchestrator/toolCalc.ts.
  'rule:hiding': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_contest', 'calc']),
    dmContext:
      'Use resolve_contest when an observer actively searches for the hidden creature, or calc with passive_score for passive observers.',
  }),
  // R0 confirmed: rule:hit-points (hit points) uses adjust_hp; tool descriptions: packages/core/src/orchestrator/toolAdjustHp.ts.
  'rule:hit-points': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'adjust_hp']),
    dmContext:
      'Apply changes to a character’s current hit points with adjust_hp.',
  }),
  // R0 confirmed: rule:interacting-with-objects (interacting with objects) uses spend_turn_resource; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts.
  'rule:interacting-with-objects': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Record the free object interaction or required action with spend_turn_resource during combat.',
  }),
  // R0 confirmed: rule:jumping (jumping) uses calc; tool descriptions: packages/core/src/orchestrator/toolCalc.ts.
  'rule:jumping': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc']),
    dmContext:
      'Use calc with jump_distance and the jumper’s Strength score, modifier, and running-start choice.',
  }),
  // R0 confirmed: rule:knocking-a-creature-out (melee knockout at zero HP) uses adjust_hp and stabilize_character; tool descriptions: packages/core/src/orchestrator/toolAdjustHp.ts, packages/core/src/orchestrator/toolStabilizeCharacter.ts.
  'rule:knocking-a-creature-out': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'adjust_hp', 'stabilize_character']),
    dmContext:
      'Apply the knockout damage to a character with adjust_hp, then mark the character stable with stabilize_character when the attacker chooses a nonlethal result.',
  }),
  // R0 confirmed: rule:lifting-and-carrying (lifting and carrying) uses calc; tool descriptions: packages/core/src/orchestrator/toolCalc.ts.
  'rule:lifting-and-carrying': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc']),
    dmContext:
      'Use calc with carry_capacity and the creature’s Strength score and size for its carrying and lifting limits.',
  }),
  // R0 confirmed: rule:making-an-attack (making an attack) uses resolve_check, resolve_damage; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts, packages/core/src/orchestrator/toolResolveDamage.ts.
  'rule:making-an-attack': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check', 'resolve_damage']),
    dmContext:
      'Resolve the attack against the target AC with resolve_check; on a hit, use resolve_damage for the damage packet.',
  }),
  // R0 confirmed: rule:recuperating (recuperating) uses advance_time, resolve_check; tool descriptions: packages/core/src/orchestrator/toolRest.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:recuperating': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'advance_time', 'resolve_check']),
    dmContext:
      'Record the recuperation period with advance_time, then resolve its Constitution saving throw at the stated DC with resolve_check.',
  }),
  // R0 confirmed: rule:rolling-1-or-20 (rolling 1 or 20) uses resolve_check; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:rolling-1-or-20': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      'Use resolve_check with kind attack so natural 1 and 20 receive the attack-only automatic results.',
  }),
  // R0 confirmed: rule:shoving-a-creature (shoving a creature) uses resolve_contest, add_condition; tool descriptions: packages/core/src/orchestrator/toolResolveContest.ts, packages/core/src/orchestrator/toolAddCondition.ts.
  'rule:shoving-a-creature': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_contest', 'add_condition']),
    dmContext:
      'Resolve the opposed Athletics and Athletics or Acrobatics checks with resolve_contest, then record prone with add_condition if that is the chosen result.',
  }),
  // R0 confirmed: rule:speed (speed) uses calc, resolve_check, add_condition; tool descriptions: packages/core/src/orchestrator/toolCalc.ts, packages/core/src/orchestrator/toolResolveCheck.ts, packages/core/src/orchestrator/toolAddCondition.ts.
  'rule:speed': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'calc',
      'resolve_check',
      'add_condition',
    ]),
    dmContext:
      'Use calc with forced_march_dc after the eighth travel hour, resolve_check for the Constitution save, and add_condition for resulting exhaustion.',
  }),
  // R0 confirmed: rule:strength-attack-rolls-and-damage (strength attack rolls and damage) uses resolve_check, resolve_damage; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts, packages/core/src/orchestrator/toolResolveDamage.ts.
  'rule:strength-attack-rolls-and-damage': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check', 'resolve_damage']),
    dmContext:
      'Pass the Strength modifier to resolve_check for an eligible attack and to resolve_damage for its damage packet.',
  }),
  // R0 confirmed: rule:the-order-of-combat-initiative (the order of combat initiative) uses resolve_check, begin_turn; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts, packages/core/src/orchestrator/toolBeginTurn.ts.
  'rule:the-order-of-combat-initiative': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check', 'begin_turn']),
    dmContext:
      'Use resolve_check for each initiative check, then call begin_turn in the resulting order.',
  }),
  // R0 confirmed: rule:two-weapon-fighting (two weapon fighting) uses spend_turn_resource, resolve_check; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:two-weapon-fighting': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Spend the off-hand bonus action with spend_turn_resource and resolve its attack with resolve_check.',
  }),
  // R0 confirmed: rule:unseen-attackers-and-targets (unseen attackers and targets) uses resolve_check; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:unseen-attackers-and-targets': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      'Declare the applicable advantage or disadvantage to resolve_check when resolving an attack by or against an unseen creature.',
  }),
  // R0 confirmed: rule:variant-encumbrance (variant encumbrance) uses calc, resolve_check; tool descriptions: packages/core/src/orchestrator/toolCalc.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:variant-encumbrance': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc', 'resolve_check']),
    dmContext:
      'Use calc with encumbrance_thresholds and the creature’s Strength score, then declare heavy-encumbrance disadvantage to resolve_check for affected checks.',
  }),
  // R0 confirmed: rule:water (water) uses resolve_check, add_condition; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts, packages/core/src/orchestrator/toolAddCondition.ts.
  'rule:water': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check', 'add_condition']),
    dmContext:
      'Use resolve_check for the Constitution save after inadequate water and add_condition for resulting exhaustion.',
  }),
  // R0 confirmed: rule:cover (cover) uses resolve_check; tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:cover': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      'Pass the bonus for the target’s degree of cover to resolve_check as a declared modifier to AC or to the Dexterity saving throw.',
  }),
  // R0 confirmed: rule:opportunity-attacks (opportunity attacks) uses spend_turn_resource, resolve_check; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:opportunity-attacks': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Spend the attacker’s reaction with spend_turn_resource, then resolve the opportunity attack with resolve_check.',
  }),
  // R0 confirmed: rule:charges (item charge expenditure and recharge) uses use_item for pack-bound operations, or generic usage counters for unbound items; tool descriptions: packages/core/src/orchestrator/toolUseItem.ts, packages/core/src/orchestrator/toolSpendUsage.ts, packages/core/src/orchestrator/toolRestoreUsage.ts, packages/core/src/orchestrator/toolResetUsage.ts.
  'rule:charges': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'use_item',
      'spend_usage',
      'restore_usage',
      'reset_usage',
    ]),
    dmContext:
      'Use use_item for a pack-bound item’s declared charge-spending operation. For an unbound item, use spend_usage with its charge maximum and reset economy, restore_usage for rolled recovery, and reset_usage for a full recharge event.',
  }),
});

export function validateRuleAdjudicationContext(
  registeredToolNames: ReadonlySet<string>,
  entries: Readonly<
    Record<string, RuleAdjudicationContext>
  > = RULE_ADJUDICATION_CONTEXT,
): readonly string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (value.dmContext.trim() === '')
      errors.push(`${key}: dmContext is empty`);
    if (!value.tools.some((tool) => tool !== 'lookup_rules'))
      errors.push(`${key}: adjudication context requires a non-lookup tool`);
    if (/Eshyra\s+(?:does\s+not|doesn't)/i.test(value.dmContext))
      errors.push(`${key}: dmContext asserts an unbounded Eshyra negative`);
    for (const tool of value.tools) {
      if (!registeredToolNames.has(tool))
        errors.push(`${key}: tool '${tool}' is not registered`);
      if (
        tool !== 'lookup_rules' &&
        !new RegExp(`(?<![A-Za-z0-9_])${tool}(?![A-Za-z0-9_])`).test(
          value.dmContext,
        )
      )
        errors.push(`${key}: tool '${tool}' is not named in dmContext`);
    }
    for (const tool of registeredToolNames) {
      if (
        tool !== 'lookup_rules' &&
        !value.tools.includes(tool) &&
        new RegExp(`(?<![A-Za-z0-9_])${tool}(?![A-Za-z0-9_])`).test(
          value.dmContext,
        )
      )
        errors.push(
          `${key}: tool '${tool}' is named in dmContext but not listed`,
        );
    }
  }
  return errors;
}
