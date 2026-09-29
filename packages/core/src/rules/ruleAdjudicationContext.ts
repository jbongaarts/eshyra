export interface RuleAdjudicationContext {
  readonly tools: readonly string[];
  readonly dmContext: string;
}

/** Runtime-facing statements re-derived from rule text and current tools under R0. */
export const RULE_ADJUDICATION_CONTEXT: Readonly<
  Record<string, RuleAdjudicationContext>
> = Object.freeze({
  // R0 confirmed: the action grants or requires attack as described by this record; toolSpendTurnResource.ts records turn costs and toolLookupRules.ts lookupRulesTool retrieves the source.
  'action:attack': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Choose one melee or ranged attack; a feature such as Extra Attack can change the number of attacks made. Record the action with spend_turn_resource, then resolve the attack with resolve_check.',
  }),
  // R0 confirmed: the action grants or requires dash as described by this record; toolSpendTurnResource.ts records turn costs and toolLookupRules.ts lookupRulesTool retrieves the source.
  'action:dash': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Dash adds movement equal to the creature’s speed for this turn. Record the action with spend_turn_resource and adjudicate the resulting movement from the scene.',
  }),
  // R0 confirmed: the action grants or requires disengage as described by this record; toolSpendTurnResource.ts records turn costs and toolLookupRules.ts lookupRulesTool retrieves the source.
  'action:disengage': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Disengage prevents the creature’s movement from provoking opportunity attacks for the rest of its turn. Record the action with spend_turn_resource.',
  }),
  // R0 confirmed: the action grants or requires dodge as described by this record; toolSpendTurnResource.ts records turn costs and toolLookupRules.ts lookupRulesTool retrieves the source.
  'action:dodge': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Dodge makes attacks against the creature disadvantaged when it can see the attacker and gives it advantage on Dexterity saves until its next turn, unless it is incapacitated or its speed is 0. Record the action with spend_turn_resource.',
  }),
  // R0 confirmed: the action grants or requires help as described by this record; toolSpendTurnResource.ts records turn costs and toolLookupRules.ts lookupRulesTool retrieves the source.
  'action:help': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'Decide whether the character can meaningfully help with the task; in combat, the helper must use the Help action. Record that action with spend_turn_resource.',
  }),
  // R0 confirmed: the action grants or requires hide as described by this record; toolSpendTurnResource.ts records turn costs and toolLookupRules.ts lookupRulesTool retrieves the source.
  'action:hide': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'spend_turn_resource',
      'resolve_check',
    ]),
    dmContext:
      'Resolve the attempt to hide with a Dexterity (Stealth) check against the relevant observers. In combat, record the action with spend_turn_resource and resolve the check with resolve_check.',
  }),
  // R0 confirmed: the action grants or requires ready as described by this record; toolSpendTurnResource.ts records turn costs and toolLookupRules.ts lookupRulesTool retrieves the source.
  'action:ready': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'The DM decides whether the stated trigger occurs and when the readied response can happen. Record the action with spend_turn_resource; spend the reaction when the trigger occurs.',
  }),
  // R0 confirmed: the action grants or requires search as described by this record; toolSpendTurnResource.ts records turn costs and toolLookupRules.ts lookupRulesTool retrieves the source.
  'action:search': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource', 'roll']),
    dmContext:
      'Decide which ability check fits the search and what information it can reveal. In combat, record the action with spend_turn_resource; use roll for the check.',
  }),
  // R0 confirmed: the action grants or requires use an object as described by this record; toolSpendTurnResource.ts records turn costs and toolLookupRules.ts lookupRulesTool retrieves the source.
  'action:use-an-object': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'The DM decides whether the object interaction is incidental or requires the Use an Object action. Record the action with spend_turn_resource when a full action is required.',
  }),
  // R0 confirmed: source clause 'To target something, you must have a clear path to it, so it can’t be behind total cover.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:a-clear-path-to-the-target': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'The DM decides whether an obstruction blocks a clear path to the target. Eshyra does not track a grid, so use lookup_rules to check the rule and adjudicate positions and line of sight.',
  }),
  // R0 confirmed: source clause 'Activating some magic items requires a user to do something special, such as holding the item and uttering a command word.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:activating-an-item': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'The DM decides whether an item’s own activation requirement applies or whether the character is taking the Use an Object action.',
  }),
  // R0 confirmed: source clause 'A monster carries enough ammunition to make its ranged attacks.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:ammunition': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'For monsters, use the ammunition quantity convention in this rule. For characters, check their inventory before deciding whether ammunition remains.',
  }),
  // R0 confirmed: source clause 'Spells such as burning hands and cone of cold cover an area, allowing them to affect multiple creatures at once.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:areas-of-effect': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'The DM determines where the effect is placed and which creatures fall within its shape, using the geometry stated in the rule.',
  }),
  // R0 confirmed: source clause 'Assume that a creature is proficient with its armor, weapons, and tools.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:armor-weapon-and-tool-proficiencies': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'For monsters, assume proficiency with listed armor, weapons, and tools unless the DM decides otherwise for the scene.',
  }),
  // R0 confirmed: source clause 'Combatants often find themselves lying on the ground, either because they are knocked down or because they throw themselves down.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:being-prone': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'add_condition', 'remove_condition']),
    dmContext:
      'The DM decides when a creature becomes prone and how the condition affects its movement. Record or clear the condition with add_condition or remove_condition.',
  }),
  // R0 confirmed: source clause 'A creature with blindsight can perceive its surroundings without relying on sight, within a specific radius.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:blindsight': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Use the creature’s listed blindsight radius. The DM decides what the creature can detect without sight within that range.',
  }),
  // R0 confirmed: source clause 'You can break up your movement on your turn, using some of your speed before and after your action.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:breaking-up-your-move': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Breaking Up Your Move with lookup_rules, then apply its source direction to the scene: You can break up your movement on your turn, using some of your speed before and after your action.',
  }),
  // R0 confirmed: source clause 'A monster that has a burrowing speed can use that speed to move through sand, earth, mud, or ice.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:burrow': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Burrow with lookup_rules, then apply its source direction to the scene: A monster that has a burrowing speed can use that speed to move through sand, earth, mud, or ice.',
  }),
  // R0 confirmed: source clause 'Some spells require the caster to make an attack roll to determine whether the spell effect hits the intended target.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:casting-a-spell-attack-rolls': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Use the character’s spell attack bonus or the monster’s listed value. The DM decides when a hostile creature within 5 feet imposes disadvantage.',
  }),
  // R0 confirmed: source clause 'The target of a spell must be within the spell’s range.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:casting-a-spell-range': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Range with lookup_rules, then apply its source direction to the scene: The target of a spell must be within the spell’s range.',
  }),
  // R0 rewritten: item-bonus special-modifier payload is present under closed bead eshyra-o9bd.18.7.7.2 and resolveCheckTool accepts declared modifiers; the source DC and situational adjudication remain.
  'rule:casting-a-spell-saving-throws': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Saving Throws with lookup_rules, then apply its source direction to the scene: Many spells specify that a target can make a saving throw to avoid some or all of a spell’s effects.',
  }),
  // R0 confirmed: source clause 'Because of the mental focus and precise gestures required for spellcasting, you must be proficient with the armor you are wearing to ca'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:casting-in-armor': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Check whether the character is proficient with the armor they wear. The DM applies this restriction when the character casts a spell.',
  }),
  // R0 confirmed: source clause 'A monster that has a climbing speed can use all or part of its movement to move on vertical surfaces.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:climb': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Climb with lookup_rules, then apply its source direction to the scene: A monster that has a climbing speed can use all or part of its movement to move on vertical surfaces.',
  }),
  // R0 confirmed: source clause 'While climbing or swimming, each foot of movement costs 1 extra foot (2 extra feet in difficult terrain), unless a creature has a climb'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:climbing-swimming-and-crawling': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Climbing, Swimming, and Crawling with lookup_rules, then apply its source direction to the scene: While climbing or swimming, each foot of movement costs 1 extra foot (2 extra feet in difficult terrain), unless a creature has a climbing or swimming speed.',
  }),
  // R0 confirmed: source clause 'Common coins come in several different denominations based on the relative worth of the metal from which they are made.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:coinage': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Check the acting character’s currency before the transaction. The DM determines coin weight when it matters; use the currency tools to record gains, spending, or conversion.',
  }),
  // R0 confirmed: source clause '1.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:combat-step-by-step': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'The DM determines surprise and positions, then advances the encounter through the steps in this rule. Use the encounter tools to start, update, or close combat.',
  }),
  // R0 confirmed: source clause 'The effects of different spells add together while the durations of those spells overlap.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:combining-magical-effects': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'When durations overlap, effects from different spells add together. The DM applies only the strongest effect when the same spell affects a target more than once.',
  }),
  // R0 confirmed: source clause 'A command word is a word or phrase that must be spoken for an item to work.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:command-word': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'A command word requires speech. The DM decides whether the item can be heard and activated in the current scene.',
  }),
  // R0 confirmed: source clause 'Complex traps work like standard traps, except once activated they execute a series of actions each round.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:complex-traps': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'The DM determines the trap’s initiative and actions for each round. Use the encounter tools to track a trap entered as a combatant.',
  }),
  // R0 confirmed: source clause 'A cone extends in a direction you choose from its point of origin.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:cone': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Cone with lookup_rules, then apply its source direction to the scene: A cone extends in a direction you choose from its point of origin.',
  }),
  // R0 confirmed: source clause 'Some items are used up when they are activated.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:consumables': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'remove_item']),
    dmContext:
      'Check the item’s use description to decide whether activation consumes it. Remove a consumed item with remove_item; use spend_usage for a limited-use item.',
  }),
  // R0 confirmed: source clause 'While you’re mounted, you have two options.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:controlling-a-mount': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'The DM decides whether a mount is controlled or acts independently, and how its initiative relates to its rider.',
  }),
  // R0 confirmed: source clause 'You select a cube’s point of origin, which lies anywhere on a face of the cubic effect.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:cube': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Cube with lookup_rules, then apply its source direction to the scene: You select a cube’s point of origin, which lies anywhere on a face of the cubic effect.',
  }),
  // R0 confirmed: source clause 'A cylinder’s point of origin is the center of a circle of a particular radius, as given in the spell description.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:cylinder': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Cylinder with lookup_rules, then apply its source direction to the scene: A cylinder’s point of origin is the center of a circle of a particular radius, as given in the spell description.',
  }),
  // R0 confirmed: source clause 'Many creatures in fantasy gaming worlds, especially those that dwell underground, have darkvision.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:darkvision': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Darkvision with lookup_rules, then apply its source direction to the scene: Many creatures in fantasy gaming worlds, especially those that dwell underground, have darkvision.',
  }),
  // R0 confirmed: source clause 'Usually, some element of a trap is visible to careful inspection.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:detecting-and-disabling-a-trap': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Detecting and Disabling a Trap with lookup_rules, then apply its source direction to the scene: Usually, some element of a trap is visible to careful inspection.',
  }),
  // R0 confirmed: source clause 'You add your Dexterity modifier to your attack roll and your damage roll when attacking with a ranged weapon, such as a sling or a long'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:dexterity-attack-rolls-and-damage': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'roll']),
    dmContext:
      'Retrieve Attack Rolls and Damage with lookup_rules, then apply its source direction to the scene: You add your Dexterity modifier to your attack roll and your damage roll when attacking with a ranged weapon, such as a sling or a longbow.',
  }),
  // R0 confirmed: source clause 'At the beginning of every combat, you roll initiative by making a Dexterity check.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:dexterity-initiative': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Roll initiative and track the combatants with the encounter tools. The DM resolves ties and group initiative.',
  }),
  // R0 confirmed: source clause 'Between adventures, the GM might ask you what your character is doing during his or her downtime.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:downtime-activities': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'update_clock']),
    dmContext:
      'The DM schedules downtime activities and decides their outcomes. Use update_clock when elapsed time needs to be recorded.',
  }),
  // R0 confirmed: source clause 'A stat block rarely refers to equipment, other than armor or weapons used by a monster.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:equipment': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Equipment with lookup_rules, then apply its source direction to the scene: A stat block rarely refers to equipment, other than armor or weapons used by a monster.',
  }),
  // R0 confirmed: the source sets 1d6 per 10 feet capped at 20d6 and prone on landing; toolCalc.ts, toolResolveDamage.ts, toolAdjustHp.ts, toolUpdateCombatant.ts, and toolAddCondition.ts provide the named path.
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
      'At the end of a fall, use calc for the 1d6-per-10-feet damage up to 20d6 and resolve_damage to determine damage. Apply it with adjust_hp, update_combatant for the fall outcome, and add_condition for prone unless the creature avoids damage.',
  }),
  // R0 confirmed: source clause 'A monster that has a flying speed can use all or part of its movement to fly.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:fly': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Fly with lookup_rules, then apply its source direction to the scene: A monster that has a flying speed can use all or part of its movement to fly.',
  }),
  // R0 confirmed: source clause 'Flying creatures enjoy many benefits of mobility, but they must also deal with the danger of falling.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:flying-movement': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Flying Movement with lookup_rules, then apply its source direction to the scene: Flying creatures enjoy many benefits of mobility, but they must also deal with the danger of falling.',
  }),
  // R0 confirmed: source clause 'A character needs one pound of food per day and can make food last longer by subsisting on half rations.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:food': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc', 'add_condition']),
    dmContext:
      'The DM tracks food deprivation over time and applies the rule’s exhaustion effects. Use calc for the food deprivation threshold and add_condition to record the condition.',
  }),
  // R0 confirmed: source clause 'Characters who don’t eat or drink suffer the effects of exhaustion (see appendix PH-A).'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:food-and-water': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'The DM tracks deprivation and applies the exhaustion effects. Do not remove exhaustion caused by hunger or thirst until the character eats or drinks as required by this rule.',
  }),
  // R0 confirmed: source clause 'When you want to grab a creature or wrestle with it, you can use the Attack action to make a special melee attack, a grapple.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:grappling': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Grappling with lookup_rules, then apply its source direction to the scene: When you want to grab a creature or wrestle with it, you can use the Attack action to make a special melee attack, a grapple.',
  }),
  // R0 confirmed: source clause 'A beast, humanoid, giant, or monstrosity can become a half-dragon.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:half-dragon-template': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Half-Dragon Template with lookup_rules, then apply its source direction to the scene: A beast, humanoid, giant, or monstrosity can become a half-dragon.',
  }),
  // R0 confirmed: source clause 'The GM decides when circumstances are appropriate for hiding.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:hiding': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_contest', 'calc']),
    dmContext:
      'The DM decides whether circumstances allow hiding and whether the attempt succeeds. Resolve a contest with resolve_contest and calculate passive scores with calc when required.',
  }),
  // R0 confirmed: source clause 'A monster usually dies or is destroyed when it drops to 0 hit points.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:hit-points': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'adjust_hp']),
    dmContext:
      'Use the creature’s listed hit points and Hit Dice. Apply hit point changes with adjust_hp; the DM determines hit points when creating a creature.',
  }),
  // R0 confirmed: source clause 'Sometimes characters don’t have their weapons and have to attack with whatever is at hand.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:improvised-weapons': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Improvised Weapons with lookup_rules, then apply its source direction to the scene: Sometimes characters don’t have their weapons and have to attack with whatever is at hand.',
  }),
  // R0 confirmed: source clause 'A monster with the innate ability to cast spells has the Innate Spellcasting special trait.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:innate-spellcasting': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Innate Spellcasting with lookup_rules, then apply its source direction to the scene: A monster with the innate ability to cast spells has the Innate Spellcasting special trait.',
  }),
  // R0 confirmed: source clause 'A character’s interaction with objects in an environment is often simple to resolve in the game.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:interacting-with-objects': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Interacting with Objects with lookup_rules, then apply its source direction to the scene: A character’s interaction with objects in an environment is often simple to resolve in the game.',
  }),
  // R0 confirmed: source clause 'Your Strength determines how far you can jump.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:jumping': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc']),
    dmContext:
      'Use calc to determine long- and high-jump distances from the rule. The DM decides whether an obstacle or landing calls for an additional check.',
  }),
  // R0 confirmed: source clause 'Sometimes an attacker wants to incapacitate a foe, rather than deal a killing blow.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:knocking-a-creature-out': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'When a melee attack reduces a creature to 0 hit points, the attacker may choose to knock it out. Record the resulting unconscious and stable conditions with the condition and hit point tools.',
  }),
  // R0 confirmed: source clause 'If a legendary creature has lair actions, it can use them to harness the ambient magic in its lair.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:lair-actions': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'The DM decides which lair action occurs on initiative count 20 and tracks its once-per-round use in the encounter.',
  }),
  // R0 confirmed: source clause 'A legendary creature can do things that ordinary creatures can’t.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:legendary-creatures': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Legendary Creatures with lookup_rules, then apply its source direction to the scene: A legendary creature can do things that ordinary creatures can’t.',
  }),
  // R0 confirmed: source clause 'Your Strength score determines the amount of weight you can bear.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:lifting-and-carrying': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc']),
    dmContext:
      'Use calc to determine carrying, pushing, and dragging limits from Strength and size. The DM tracks the carried load and applies the speed penalty when the limit is exceeded.',
  }),
  // R0 confirmed: source clause 'A line extends from its point of origin in a straight path up to its length and covers an area defined by its width.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:line': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Line with lookup_rules, then apply its source direction to the scene: A line extends from its point of origin in a straight path up to its length and covers an area defined by its width.',
  }),
  // R0 confirmed: source clause 'Certain spells (including spells cast as rituals) require more time to cast: minutes or even hours.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:longer-casting-times': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Longer Casting Times with lookup_rules, then apply its source direction to the scene: Certain spells (including spells cast as rituals) require more time to cast: minutes or even hours.',
  }),
  // R0 confirmed: source clause 'Madness can be short-term, long-term, or indefinite.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:madness-effects': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Madness Effects with lookup_rules, then apply its source direction to the scene: Madness can be short-term, long-term, or indefinite.',
  }),
  // R0 confirmed: source clause 'Whether you’re striking with a melee weapon, firing a weapon at range, or making an attack roll as part of a spell, an attack has a sim'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:making-an-attack': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'roll']),
    dmContext:
      'Retrieve Making an Attack with lookup_rules, then apply its source direction to the scene: Whether you’re striking with a melee weapon, firing a weapon at range, or making an attack roll as part of a spell, an attack has a simple structure.',
  }),
  // R0 confirmed: source clause 'Casting some spells requires particular objects, specified in parentheses in the component entry.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:material-m': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Material (M) with lookup_rules, then apply its source direction to the scene: Casting some spells requires particular objects, specified in parentheses in the component entry.',
  }),
  // R0 confirmed: source clause 'Used in hand-to-hand combat, a melee attack allows you to attack a foe within your reach.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:melee-attacks': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Melee Attacks with lookup_rules, then apply its source direction to the scene: Used in hand-to-hand combat, a melee attack allows you to attack a foe within your reach.',
  }),
  // R0 confirmed: source clause 'A knight charging into battle on a warhorse, a wizard casting spells from the back of a griffon, or a cleric soaring through the sky on'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:mounted-combat': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Mounted Combat with lookup_rules, then apply its source direction to the scene: A knight charging into battle on a warhorse, a wizard casting spells from the back of a griffon, or a cleric soaring through the sky on a pegasus all enjoy the benefits of speed and mobility that a mount can provide.',
  }),
  // R0 confirmed: source clause 'Once during your move, you can mount a creature that is within 5 feet of you or dismount.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:mounting-and-dismounting': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Mounting and Dismounting with lookup_rules, then apply its source direction to the scene: Once during your move, you can mount a creature that is within 5 feet of you or dismount.',
  }),
  // R0 confirmed: source clause 'A good mount can help you move more quickly through the wilderness, but its primary purpose is to carry the gear that would otherwise s'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:mounts-and-vehicles': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Mounts and Vehicles with lookup_rules, then apply its source direction to the scene: A good mount can help you move more quickly through the wilderness, but its primary purpose is to carry the gear that would otherwise slow you down.',
  }),
  // R0 confirmed: source clause 'In combat, characters and monsters are in constant motion, often using movement and position to gain the upper hand.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:movement-and-position': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Movement and Position with lookup_rules, then apply its source direction to the scene: In combat, characters and monsters are in constant motion, often using movement and position to gain the upper hand.',
  }),
  // R0 confirmed: source clause 'Combat rarely takes place in bare rooms or on featureless plains.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:movement-and-position-difficult-terrain': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'The DM determines the scene’s terrain and applies the extra movement cost stated by this rule. Eshyra does not track a movement budget.',
  }),
  // R0 confirmed: source clause 'You can move through a nonhostile creature’s space.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:moving-around-other-creatures': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Moving Around Other Creatures with lookup_rules, then apply its source direction to the scene: You can move through a nonhostile creature’s space.',
  }),
  // R0 confirmed: source clause 'If you take an action that includes more than one weapon attack, you can break up your movement even further by moving between those at'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:moving-between-attacks': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Moving between Attacks with lookup_rules, then apply its source direction to the scene: If you take an action that includes more than one weapon attack, you can break up your movement even further by moving between those attacks.',
  }),
  // R0 confirmed: source clause 'A creature that can make multiple attacks on its turn has the Multiattack action.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:multiattack': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Use the creature’s listed Multiattack routine on its turn. An opportunity attack must be a single melee attack, not the routine.',
  }),
  // R0 confirmed: source clause 'When characters need to saw through ropes, shatter a window, or smash a vampire’s coffin, the only hard and fast rule is this: given en'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:objects': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'adjust_hp']),
    dmContext:
      'Use the object’s listed armor class and hit points. The DM applies damage thresholds and immunities from this rule, and adjust_hp records damage when appropriate.',
  }),
  // R0 confirmed: source clause 'Items that come in pairs—such as boots, bracers, gauntlets, and gloves—impart their benefits only if both items of the pair are worn.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:paired-items': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Paired Items with lookup_rules, then apply its source direction to the scene: Items that come in pairs—such as boots, bracers, gauntlets, and gloves—impart their benefits only if both items of the pair are worn.',
  }),
  // R0 confirmed: source clause 'Given their insidious and deadly nature, poisons are illegal in most societies but are a favorite tool among assassins, drow, and other'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:poisons': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Poisons with lookup_rules, then apply its source direction to the scene: Given their insidious and deadly nature, poisons are illegal in most societies but are a favorite tool among assassins, drow, and other evil creatures.',
  }),
  // R0 confirmed: source clause 'You can make ranged attacks only against targets within a specified range.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:range': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Range with lookup_rules, then apply its source direction to the scene: You can make ranged attacks only against targets within a specified range.',
  }),
  // R0 confirmed: source clause 'Aiming a ranged attack is more difficult when a foe is next to you.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:ranged-attacks-in-close-combat': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Ranged Attacks in Close Combat with lookup_rules, then apply its source direction to the scene: Aiming a ranged attack is more difficult when a foe is next to you.',
  }),
  // R0 confirmed: source clause 'You can use downtime between adventures to recover from a debilitating injury, disease, or poison.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:recuperating': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'After three days of downtime, the character may attempt the Constitution save at the fixed DC in this rule. The DM tracks the recovery period and resolves the save.',
  }),
  // R0 confirmed: source clause 'Certain spells have a special tag: ritual.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:rituals': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Rituals with lookup_rules, then apply its source direction to the scene: Certain spells have a special tag: ritual.',
  }),
  // R0 confirmed: source clause 'Sometimes fate blesses or curses a combatant, causing the novice to hit and the veteran to miss.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:rolling-1-or-20': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'On an attack, a natural 20 hits and is critical; a natural 1 misses. These automatic results do not apply to ability checks or saving throws.',
  }),
  // R0 confirmed: source clause 'Using the Attack action, you can make a special melee attack to shove a creature, either to knock it prone or push it away from you.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:shoving-a-creature': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Shoving a Creature with lookup_rules, then apply its source direction to the scene: Using the Attack action, you can make a special melee attack to shove a creature, either to knock it prone or push it away from you.',
  }),
  // R0 confirmed: source clause 'Some monsters that have immunity or resistance to nonmagical weapons are susceptible to silver weapons, so cautious adventurers invest'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:silvered-weapons': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Silvered Weapons with lookup_rules, then apply its source direction to the scene: Some monsters that have immunity or resistance to nonmagical weapons are susceptible to silver weapons, so cautious adventurers invest extra coin to plate their weapons with silver.',
  }),
  // R0 confirmed: source clause 'Spellcasting gestures might include a forceful gesticulation or an intricate set of gestures.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:somatic-s': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Somatic (S) with lookup_rules, then apply its source direction to the scene: Spellcasting gestures might include a forceful gesticulation or an intricate set of gestures.',
  }),
  // R0 confirmed: source clause 'A monster with the Spellcasting special trait has a spellcaster level and spell slots, which it uses to cast its spells of 1st level an'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:special-traits-spellcasting': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Spellcasting with lookup_rules, then apply its source direction to the scene: A monster with the Spellcasting special trait has a spellcaster level and spell slots, which it uses to cast its spells of 1st level and higher (as explained in the Player’s Handbook).',
  }),
  // R0 confirmed: source clause 'Every character and monster has a speed, which is the distance in feet that the character or monster can walk in 1 round.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:speed': Object.freeze({
    tools: Object.freeze([
      'lookup_rules',
      'calc',
      'resolve_check',
      'add_condition',
    ]),
    dmContext:
      'The DM adjudicates travel pace and movement costs. Use calc for the forced march DC, resolve_check for the save, and add_condition to record exhaustion.',
  }),
  // R0 confirmed: source clause 'The travel speeds given in the Travel Pace table assume relatively simple terrain: roads, open plains, or clear dungeon corridors.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:speed-difficult-terrain': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Difficult Terrain with lookup_rules, then apply its source direction to the scene: The travel speeds given in the Travel Pace table assume relatively simple terrain: roads, open plains, or clear dungeon corridors.',
  }),
  // R0 rewritten: spell-bearing magic-item payload moved into pack records under closed bead eshyra-o9bd.18.7.7; the source still requires the DM to adjudicate the item's activation and spell effect.
  'rule:spells': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Spells with lookup_rules, then apply its source direction to the scene: Some magic items allow the user to cast a spell from the item.',
  }),
  // R0 confirmed: source clause 'You select a sphere’s point of origin, and the sphere extends outward from that point.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:sphere': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Sphere with lookup_rules, then apply its source direction to the scene: You select a sphere’s point of origin, and the sphere extends outward from that point.',
  }),
  // R0 confirmed: source clause 'A creature can squeeze through a space that is large enough for a creature one size smaller than it.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:squeezing-into-a-smaller-space': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Squeezing into a Smaller Space with lookup_rules, then apply its source direction to the scene: A creature can squeeze through a space that is large enough for a creature one size smaller than it.',
  }),
  // R0 confirmed: source clause 'You add your Strength modifier to your attack roll and your damage roll when attacking with a melee weapon such as a mace, a battleaxe,'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:strength-attack-rolls-and-damage': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'roll']),
    dmContext:
      'Retrieve Attack Rolls and Damage with lookup_rules, then apply its source direction to the scene: You add your Strength modifier to your attack roll and your damage roll when attacking with a melee weapon such as a mace, a battleaxe, or a javelin.',
  }),
  // R0 confirmed: source clause 'A monster that has a swimming speed doesn’t need to spend extra movement to swim.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:swim': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Swim with lookup_rules, then apply its source direction to the scene: A monster that has a swimming speed doesn’t need to spend extra movement to swim.',
  }),
  // R0 confirmed: source clause 'If a spell targets a creature of your choice, you can choose yourself, unless the creature must be hostile or specifically a creature o'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:targeting-yourself': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Targeting Yourself with lookup_rules, then apply its source direction to the scene: If a spell targets a creature of your choice, you can choose yourself, unless the creature must be hostile or specifically a creature other than you.',
  }),
  // R0 rewritten: the item-specific telepathy payload clause is retired after eshyra-o9bd.18.7.9 closed; the source's range and communication limits remain DM adjudication.
  'rule:telepathy': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Telepathy with lookup_rules, then apply its source direction to the scene: Telepathy is a magical ability that allows a monster to communicate mentally with another creature within a specified range.',
  }),
  // R0 confirmed: source clause 'A typical combat encounter is a clash between two sides, a flurry of weapon swings, feints, parries, footwork, and spellcasting.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:the-order-of-combat': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve The Order of Combat with lookup_rules, then apply its source direction to the scene: A typical combat encounter is a clash between two sides, a flurry of weapon swings, feints, parries, footwork, and spellcasting.',
  }),
  // R0 confirmed: source clause 'Initiative determines the order of turns during combat.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:the-order-of-combat-initiative': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Initiative with lookup_rules, then apply its source direction to the scene: Initiative determines the order of turns during combat.',
  }),
  // R0 confirmed: source clause 'A monster with tremorsense can detect and pinpoint the origin of vibrations within a specific radius, provided that the monster and the'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:tremorsense': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Tremorsense with lookup_rules, then apply its source direction to the scene: A monster with tremorsense can detect and pinpoint the origin of vibrations within a specific radius, provided that the monster and the source of the vibrations are in contact with the same ground or substance.',
  }),
  // R0 confirmed: source clause 'A creature with truesight can, out to a specific range, see in normal and magical darkness, see invisible creatures and objects, automa'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:truesight': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Truesight with lookup_rules, then apply its source direction to the scene: A creature with truesight can, out to a specific range, see in normal and magical darkness, see invisible creatures and objects, automatically detect visual illusions and succeed on saving throws against them, and perceives the original form of a shapechanger or a creature that is transformed by magic.',
  }),
  // R0 confirmed: source clause 'When you take the Attack action and attack with a light melee weapon that you’re holding in one hand, you can use a bonus action to att'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:two-weapon-fighting': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Two-Weapon Fighting with lookup_rules, then apply its source direction to the scene: When you take the Attack action and attack with a light melee weapon that you’re holding in one hand, you can use a bonus action to attack with a different light melee weapon that you’re holding in the other hand.',
  }),
  // R0 confirmed: source clause 'When adventurers pursue sahuagin back to their undersea homes, fight off sharks in an ancient shipwreck, or find themselves in a floode'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:underwater-combat': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Underwater Combat with lookup_rules, then apply its source direction to the scene: When adventurers pursue sahuagin back to their undersea homes, fight off sharks in an ancient shipwreck, or find themselves in a flooded dungeon room, they must fight in a challenging environment.',
  }),
  // R0 confirmed: source clause 'Combatants often try to escape their foes’ notice by hiding, casting the invisibility spell, or lurking in darkness.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:unseen-attackers-and-targets': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Unseen Attackers and Targets with lookup_rules, then apply its source direction to the scene: Combatants often try to escape their foes’ notice by hiding, casting the invisibility spell, or lurking in darkness.',
  }),
  // R0 confirmed: source clause 'If you have more than one speed, such as your walking speed and a flying speed, you can switch back and forth between your speeds durin'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:using-different-speeds': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Using Different Speeds with lookup_rules, then apply its source direction to the scene: If you have more than one speed, such as your walking speed and a flying speed, you can switch back and forth between your speeds during your move.',
  }),
  // R0 confirmed: the source applies 5×/10× Strength thresholds and roll penalties; toolCalc.ts computes the thresholds and toolResolveCheck.ts applies declared modifiers.
  'rule:variant-encumbrance': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'calc', 'resolve_check']),
    dmContext:
      'First decide whether the table uses this variant; calc the 5× and 10× Strength load thresholds and resulting speed reductions. Pass disadvantage for the specified Strength, Dexterity, or Constitution rolls as declared modifiers to resolve_check.',
  }),
  // R0 confirmed: source clause 'Normally, your proficiency in a skill applies only to a specific kind of ability check.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:variant-skills-with-different-abilities': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Variant: Skills with Different Abilities with lookup_rules, then apply its source direction to the scene: Normally, your proficiency in a skill applies only to a specific kind of ability check.',
  }),
  // R0 confirmed: source clause 'Most spells require the chanting of mystic words.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:verbal-v': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Verbal (V) with lookup_rules, then apply its source direction to the scene: Most spells require the chanting of mystic words.',
  }),
  // R0 confirmed: source clause 'The most fundamental tasks of adventuring— noticing danger, finding hidden objects, hitting an enemy in combat, and targeting a spell,'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:vision-and-light': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Vision and Light with lookup_rules, then apply its source direction to the scene: The most fundamental tasks of adventuring— noticing danger, finding hidden objects, hitting an enemy in combat, and targeting a spell, to name just a few—rely heavily on a character’s ability to see.',
  }),
  // R0 confirmed: source clause 'A character needs one gallon of water per day, or two gallons per day if the weather is hot.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:water': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'add_condition']),
    dmContext:
      'The DM tracks water deprivation and the Constitution saves specified by this rule. Record any resulting exhaustion with add_condition and remove it only when the rule allows.',
  }),
  // R0 confirmed: source clause 'Your race, class, and feats can grant you proficiency with certain weapons or categories of weapons.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:weapon-proficiency': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Weapon Proficiency with lookup_rules, then apply its source direction to the scene: Your race, class, and feats can grant you proficiency with certain weapons or categories of weapons.',
  }),
  // R0 confirmed: source clause 'Sometimes two or more characters team up to attempt a task.'; DM reads it through toolLookupRules.ts lookupRulesTool.
  'rule:working-together': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'Retrieve Working Together with lookup_rules, then apply its source direction to the scene: Sometimes two or more characters team up to attempt a task.',
  }),
  // R0 confirmed: the cover bonus enters the check as a declared modifier; toolResolveCheck.ts resolveCheckTool applies it.
  'rule:cover': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'resolve_check']),
    dmContext:
      'The DM chooses the degree of cover. Pass the +2 or +5 AC and Dexterity saving throw bonuses as declared modifiers to resolve_check. Total cover means the target cannot be targeted directly.',
  }),
  // R0 confirmed: the source defines when movement provokes and the listed exclusions; toolSpendTurnResource.ts records the reaction cost.
  'rule:opportunity-attacks': Object.freeze({
    tools: Object.freeze(['lookup_rules', 'spend_turn_resource']),
    dmContext:
      'The DM rules whether movement triggers an opportunity attack and applies the exclusions, including Disengage, teleportation, and movement that does not use the creature’s movement, action, or reaction. Spend the reaction with spend_turn_resource.',
  }),
  // R0 rewritten: toolSpendUsage.ts spendUsageTool and toolResetUsage.ts resetUsageTool change charges; the identify/attunement disclosure timing remains the DM’s ruling.
  'rule:charges': Object.freeze({
    tools: Object.freeze(['lookup_rules']),
    dmContext:
      'When the rule calls for it, identify or attunement reveals the item’s remaining charges; an attuned creature also learns how many charges were regained. Use the item record for its charge maximum and reset economy, and the usage tools for expenditure and restoration.',
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
  }
  return errors;
}
