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
      'Spend the Dash action with spend_turn_resource and record the extra movement in its activity text.',
  }),
  // R0 confirmed: action:disengage (disengage) uses spend_turn_resource; tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts.
  'action:disengage': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Record the Disengage action with spend_turn_resource so its turn cost is spent.',
  }),
  // R0 rewritten (second pass, conditional result): the benefit lasts until the start of the dodger's next turn and ends early if it is incapacitated or its speed drops to 0. Tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, toolResolveCheck.ts.
  'action:dodge': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Spend the Dodge action with spend_turn_resource, then, while its benefit lasts, declare its advantage or disadvantage to resolve_check for an affected save or attack.',
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
  // R0 rewritten (second pass, procedure): the Stealth total is retained for rule:hiding's later searches and passive comparisons. Tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, toolResolveCheck.ts.
  'action:hide': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Spend the Hide action with spend_turn_resource in combat, then use resolve_check for the Dexterity (Stealth) check and retain its total for later searches.',
  }),
  // R0 rewritten (second pass, target domain + procedure): spend_spell_slot is character-only; readying a spell requires concentration, which ends any concentration effect the caster maintains (end_effect). The held spell's own concentration is a trap in RULE_KNOWN_LIMITS. Tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, toolSpendSpellSlot.ts, toolEndEffect.ts.
  'action:ready': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'spend_spell_slot',
      'end_effect',
    ]),
    dmContext:
      'Spend the Ready action with spend_turn_resource, then spend the reaction with spend_turn_resource if the declared trigger occurs. When a character readies a spell, pass its spellRef on the Ready action, spend the slot with spend_spell_slot when it is readied, and end any concentration effect the caster is maintaining with end_effect.',
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
  // R0 confirmed: rule:being-prone (being prone) uses character condition tools and update_combatant for encounter combatants.
  'rule:being-prone': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'add_condition',
      'remove_condition',
      'update_combatant',
    ]),
    dmContext:
      'For a character, record becoming prone with add_condition and recovery with remove_condition. For an encounter combatant, use update_combatant with addCondition {id: "prone"} or removeCondition "prone".',
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
  // R0 rewritten (Sol review F8): the source's step 3 is rolling initiative; resolve_check resolves the Dexterity checks before begin_turn. Tool descriptions: packages/core/src/orchestrator/toolStartEncounter.ts, toolSetSurprised.ts, toolResolveCheck.ts, toolBeginTurn.ts, toolCloseCombatInstance.ts.
  'rule:combat-step-by-step': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'start_encounter',
      'set_surprised',
      'resolve_check',
      'begin_turn',
      'close_combat_instance',
    ]),
    dmContext:
      'Start the encounter with start_encounter, mark surprised participants with set_surprised, resolve initiative with resolve_check, advance turns in initiative order with begin_turn, and close combat with close_combat_instance.',
  }),
  // R0 rewritten (Sol review F5): use_item and remove_item address character-held inventory only (CHARACTER_TARGET_SCHEMA). Tool descriptions: packages/core/src/orchestrator/toolUseItem.ts, packages/core/src/orchestrator/toolRemoveItem.ts.
  'rule:consumables': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'use_item', 'remove_item']),
    dmContext:
      'For a consumable a character holds, use use_item for a pack-bound consumable operation; after an unbound consumable is used, record its destruction with remove_item.',
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
  // R0 confirmed: rule:falling uses calc, resolve_damage, character HP/condition tools, and update_combatant for encounter combatants.
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
      'Use calc with fall_damage_dice and evaluate the packet with resolve_damage. For a character, apply damage with adjust_hp and record prone with add_condition when applicable. For an encounter combatant, use update_combatant for damage and addCondition {id: "prone"} when applicable.',
  }),
  // R0 rewritten: calc days_without_food_limit is a positive mapping; the add_condition exhaustion write is retired (add_condition does not grade or increment exhaustion; see RULE_KNOWN_LIMITS['rule:food']). Tool descriptions: packages/core/src/orchestrator/toolCalc.ts.
  'rule:food': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc']),
    dmContext:
      'Use calc with days_without_food_limit for the number of days a creature can go without food before deprivation begins.',
  }),
  // R0 rewritten (Sol review F10): the grapple replaces one attack of the Attack action; escape uses the grappled creature's action and a contest; release or escape removes the condition. Tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, toolResolveContest.ts, toolAddCondition.ts, toolRemoveCondition.ts, toolUpdateCombatant.ts.
  'rule:grappling': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_contest',
      'add_condition',
      'remove_condition',
      'update_combatant',
    ]),
    dmContext:
      'The grapple replaces one attack of the Attack action spent with spend_turn_resource; resolve its contest with resolve_contest and, on success, record grappled on a character with add_condition or on an encounter combatant with update_combatant addCondition {id: "grappled"}. For an escape, spend the grappled creature\'s action with spend_turn_resource and resolve its contest with resolve_contest; on escape or release, remove grappled with remove_condition or update_combatant removeCondition "grappled".',
  }),
  // SRD Hiding: a hider's Dexterity (Stealth) total remains until discovery or the hider stops hiding; active Wisdom (Perception) checks compare against that retained total.
  'rule:hiding': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check', 'calc']),
    dmContext:
      'Use resolve_check for the hider’s Dexterity (Stealth) check and retain its total. For a later active search, use resolve_check for the searcher’s Wisdom (Perception) check with vs set to that retained Stealth total. For passive observers, use calc with passive_score and compare it to the retained total.',
  }),
  // R0 rewritten (source identity): this record is the environment passage (forcing a rusted lever or breaking an object with a Strength check against a GM-set DC; damaging objects), not combat's free object interaction (rule:interacting-with-objects-around-you). resolve_check with vs carries the check. Tool description: packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:interacting-with-objects': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      'When forcing, manipulating, or breaking an object calls for a check, such as a Strength check to wrench a stuck lever, use resolve_check with kind ability_check and vs set to the DC the DM chooses for the task.',
  }),
  // R0 rewritten (Sol review F11): calc jump_distance carries distance; the source's DC 10 obstacle and landing checks resolve through resolve_check, and a failed landing imposes prone (character vs combatant). Tool descriptions: packages/core/src/orchestrator/toolCalc.ts, toolResolveCheck.ts, toolAddCondition.ts, toolUpdateCombatant.ts.
  'rule:jumping': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'calc',
      'resolve_check',
      'add_condition',
      'update_combatant',
    ]),
    dmContext:
      'Use calc with jump_distance and the jumper\'s Strength score, modifier, and running-start choice. For the DC 10 Strength (Athletics) obstacle check or Dexterity (Acrobatics) landing check, use resolve_check with vs 10; after a failed landing, record prone on a character with add_condition or on an encounter combatant with update_combatant addCondition {id: "prone"}.',
  }),
  // R0 rewritten (Sol review F3): for characters, adjust_hp can kill outright by massive damage (hpLifecycle.ts instant death) and stabilize_character stabilizes only a dying character, so the character path applies only when the damage leaves the character dying (trap in RULE_KNOWN_LIMITS); encounter combatants take hpDelta with status unconscious. Tool descriptions: packages/core/src/orchestrator/toolAdjustHp.ts, toolStabilizeCharacter.ts, toolUpdateCombatant.ts.
  'rule:knocking-a-creature-out': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'adjust_hp',
      'stabilize_character',
      'update_combatant',
    ]),
    dmContext:
      'When the attacker chooses a nonlethal result against a character, apply the damage with adjust_hp and, if it leaves the character dying, mark it stable with stabilize_character; for an encounter combatant, use update_combatant with hpDelta and status "unconscious".',
  }),
  // R0 confirmed: rule:lifting-and-carrying (lifting and carrying) uses calc; tool descriptions: packages/core/src/orchestrator/toolCalc.ts.
  'rule:lifting-and-carrying': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc']),
    dmContext:
      'Use calc with carry_capacity and the creature’s Strength score and size for its carrying and lifting limits.',
  }),
  // R0 rewritten (Sol review F7): the source rolls damage on a hit unless the attack specifies otherwise. Tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts, toolResolveDamage.ts.
  'rule:making-an-attack': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check', 'resolve_damage']),
    dmContext:
      'Resolve the attack against the target AC with resolve_check; on a hit that deals damage, use resolve_damage for its damage packet.',
  }),
  // R0 rewritten (Sol review F13): advance_time and resolve_check carry the period and the DC 15 save; end_effect carries the first success option when the effect is tracked. The 24-hour advantage option has no stated tool path. Tool descriptions: packages/core/src/orchestrator/toolRest.ts, toolResolveCheck.ts, toolEndEffect.ts.
  'rule:recuperating': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'advance_time',
      'resolve_check',
      'end_effect',
    ]),
    dmContext:
      'Record the recuperation period with advance_time, then resolve its Constitution saving throw at the stated DC with resolve_check. If the chosen success result ends a tracked effect that prevents regaining hit points, end it with end_effect.',
  }),
  // R0 rewritten (second pass, omitted step): a natural 20 on an attack is a critical hit, and resolve_damage doubles the dice when passed critical:true. Tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts, toolResolveDamage.ts.
  'rule:rolling-1-or-20': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check', 'resolve_damage']),
    dmContext:
      'Use resolve_check with kind attack so natural 1 and 20 receive the attack-only automatic results; for a critical hit, pass critical: true to resolve_damage.',
  }),
  // R0 rewritten (second pass, omitted step; sibling of rule:grappling): the shove replaces one attack of the Attack action. Tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, toolResolveContest.ts, toolAddCondition.ts, toolUpdateCombatant.ts.
  'rule:shoving-a-creature': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_contest',
      'add_condition',
      'update_combatant',
    ]),
    dmContext:
      'The shove replaces one attack of the Attack action spent with spend_turn_resource; resolve the opposed Athletics and Athletics or Acrobatics checks with resolve_contest. If prone is the chosen result, record it on a character with add_condition or on an encounter combatant with update_combatant addCondition {id: "prone"}.',
  }),
  // R0 rewritten: calc forced_march_dc and resolve_check are positive mappings; the add_condition exhaustion write is retired (see RULE_KNOWN_LIMITS['rule:speed']). Tool descriptions: packages/core/src/orchestrator/toolCalc.ts, packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:speed': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc', 'resolve_check']),
    dmContext:
      'For a forced march, use calc with forced_march_dc for each hour past the eighth and resolve_check with kind saving_throw for each Constitution save.',
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
  // R0 rewritten (Sol review F12): the bonus attack's damage omits a positive ability modifier; resolve_damage packet modifiers carry it. Tool descriptions: packages/core/src/orchestrator/toolSpendTurnResource.ts, toolResolveCheck.ts, toolResolveDamage.ts.
  'rule:two-weapon-fighting': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
      'resolve_damage',
    ]),
    dmContext:
      'Spend the off-hand bonus action with spend_turn_resource and resolve its attack with resolve_check; in its resolve_damage packet, omit the ability modifier unless it is negative.',
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
  // R0 rewritten: resolve_check for the saving throw is a positive mapping; the add_condition exhaustion write is retired (see RULE_KNOWN_LIMITS['rule:water']). Tool descriptions: packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:water': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      'Use resolve_check with kind saving_throw for the Constitution save after a day of inadequate water.',
  }),
  // R0 rewritten (Sol review F4): resolve_check modifiers apply to the rolling side and vs is a bare AC/DC, so cover raises vs for an attack against the covered target and is a declared modifier on the covered creature's Dexterity save. Tool description: packages/core/src/orchestrator/toolResolveCheck.ts.
  'rule:cover': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      "For an attack against a target with cover, add the cover bonus to the target's AC in resolve_check's vs; for the covered creature's Dexterity saving throw, pass the bonus to resolve_check as a declared modifier.",
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
  // R0 rewritten (second pass, tool contract): reset_usage applies a dawn or rest event, returning rolled recharges in needsRolledRestore; those are rolled with roll and applied with restore_usage amount. use_item and the usage counters address character-held items. Tool descriptions: packages/core/src/orchestrator/toolUseItem.ts, toolSpendUsage.ts, toolResetUsage.ts, toolRestoreUsage.ts, toolRoll.ts.
  'rule:charges': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'use_item',
      'spend_usage',
      'reset_usage',
      'roll',
      'restore_usage',
    ]),
    dmContext:
      "For an item a character holds, use use_item for a pack-bound item's declared charge-spending operation. For an unbound item a character holds, spend charges with spend_usage; at dawn apply reset_usage with event dawn, and for an item returned in needsRolledRestore, roll its regained amount with roll and apply it with restore_usage amount.",
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
