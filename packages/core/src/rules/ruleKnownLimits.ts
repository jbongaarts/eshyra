import { findingByCanonicalId } from './findingRegistry.js';

export interface RuleKnownLimit {
  readonly limit: 'partial' | 'unimplemented' | 'deferred';
  readonly statement: string;
  readonly findingId: string;
  /** Historical design-decision bead, kept as history, never as identity. */
  readonly designOwner?: string;
  readonly externalClauses?: readonly {
    readonly clause: string;
    readonly findingId: string;
    /** Historical owning bead; history only. `findingId` is the identity. */
    readonly bead: string;
  }[];
}

/** Source-grounded limits re-derived against current runtime behavior under R0. */
export const RULE_KNOWN_LIMITS: Readonly<
  Record<string, readonly RuleKnownLimit[]>
> = Object.freeze({
  // R0 rewritten: the external armor-data ownership clause is retired with eshyra-b69j.13 closed; the base-AC clause remains outside deriveLevel1Values in character/derivedValues.ts.
  'rule:armor-guidance': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not derive a character’s armor class from worn armor, Dexterity, armor category, and shield. The DM determines the resulting armor class from this rule and the character’s equipment.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer class-feature grants obtained by gaining another class. Source clause: 'When you gain a new level in a class, you get its features for that level.'
  'rule:class-features': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class character boundary under ADR 0018 leaves class-feature grants from a second class deferred. A character combining classes is refused, and the DM does not adjudicate those additional feature grants from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 rewritten: the repeat-on-damage charm save has no trigger in state/activeEffects.ts addEffect; generic duration tracking does not implement this source clause. Source clause: a damage event allows another save against the 1d12-hour charm; activeEffects.ts addEffect has no repeat-on-damage trigger.
  'rule:conflict': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not track a sentient item’s personality conflict, its control attempts, or the charm duration and repeat-save trigger. The DM resolves the control save with resolve_check, records the charmed condition with add_condition, and removes it when it ends with remove_condition; the duration and repeat-on-damage timing remain manual.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 rewritten: the time-and-materials crafting calculation has no registered operation in orchestrator/tools.ts DEFAULT_TOOLS. Source clause: daily 5 gp progress, half-cost materials, and downtime lifestyle offsets; DEFAULT_TOOLS has no crafting-progress operation.
  'rule:crafting': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not calculate crafting progress or the time and materials required to make an item. The DM adjudicates progress, tracks elapsed days with update_clock, and records material costs with spend_currency.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 rewritten: daily lifestyle multiplication over downtime duration has no registered operation in orchestrator/tools.ts DEFAULT_TOOLS. Source clause: select a daily lifestyle and multiply its price across the chosen period; DEFAULT_TOOLS has no downtime expense calculator.
  'rule:expenses-lifestyle-expenses': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not multiply a lifestyle’s daily cost by the time spent between adventures. The DM calculates the total and records the payment with spend_currency.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 confirmed: this source example explicitly combines cleric 6/fighter 1 for XP; ADR 0018 §6 and closed bead eshyra-2n1t.1 defer total-level XP across classes.
  'rule:experience-points': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class progression under ADR 0018 does not apply XP thresholds to levels split between classes. A character combining classes is refused, and the DM does not adjudicate that total-level XP example.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer combining Extra Attack grants from different classes. Source clause: 'If you gain the Extra Attack class feature from more than one class, the features don’t add together.'
  'rule:extra-attack': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class combat progression under ADR 0018 leaves the Extra Attack combination from multiple classes deferred. A character combining classes is refused, and the DM does not adjudicate the combined attack count from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer mixed-class Hit Dice and hit-point progression. Source clause: 'You gain the hit points from your new class as described for levels after 1st.'
  'rule:hit-points-and-hit-dice': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class progression under ADR 0018 leaves mixed-class hit points and Hit Dice deferred. A character combining classes is refused, and the DM does not adjudicate the mixed progression from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer additional-class choice, prerequisites, and progression. Source clause: 'Multiclassing allows you to gain levels in multiple classes.'
  'rule:multiclassing': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s build boundary under ADR 0018 supports one class, so the additional-class choice and its prerequisites remain deferred. A character combining classes is refused, and the DM does not adjudicate additional-class advancement from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer proficiency bonus across multiple class levels. Source clause: 'Your proficiency bonus is always based on your total character level, as shown in the Character Advancement table, not your level in a'
  'rule:multiclassing-proficiency-bonus': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s one-class level model under ADR 0018 leaves proficiency bonus across several class levels deferred. A character combining classes is refused, and the DM does not adjudicate a bonus from split class levels.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 rewritten: profession earnings and the daily lifestyle offset have no registered operation in orchestrator/tools.ts DEFAULT_TOOLS. Source clause: organization and Performance proficiency change the lifestyle benefit; DEFAULT_TOOLS has no profession earnings operation.
  'rule:practicing-a-profession': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not calculate profession earnings or apply the rule’s daily lifestyle offset. The DM tracks the work period with update_clock, applies the lifestyle benefit, and records any earnings with gain_currency.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 rewritten: research schedule and expense calculation have no registered operation in orchestrator/tools.ts DEFAULT_TOOLS. Source clause: the GM sets research availability and duration and charges 1 gp per day; DEFAULT_TOOLS has no research schedule/cost operation.
  'rule:researching': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not calculate research time or expenses from the activity’s duration. The DM determines the schedule and records research days with update_clock and expenses with spend_currency.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 rewritten: the lifestyle-cost offset for foraging, hunting, or repairing has no registered operation in orchestrator/tools.ts DEFAULT_TOOLS. Source clause: 'The expenses and lifestyles described here assume that you are spending your time between adventures in town, availing yourself of what'
  'rule:self-sufficiency': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not calculate the lifestyle expense offset for time spent foraging, hunting, or repairing. The DM applies the offset and records elapsed downtime with update_clock.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 rewritten: the rarity-based resale-price procedure has no registered operation in orchestrator/tools.ts DEFAULT_TOOLS. Source clause: ordinary equipment sells for half cost while gems/art retain full value and magic items require special buyers; DEFAULT_TOOLS has no resale valuation operation.
  'rule:selling-treasure': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not calculate a resale price from an item’s purchase price or rarity. The DM finds a buyer, applies the source price, and records sale proceeds with gain_currency.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 rewritten: the external weapon-property ownership clause is retired with eshyra-o9bd.18.7.8.3 closed and pack properties emitted; toolResolveCheck.ts resolveCheckTool still does not execute net escape, object-damage, or one-attack procedures.
  'rule:special-weapons': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not enforce the net escape and removal procedure, damage to objects, or the one-attack restriction for special weapons. The DM applies those procedures when resolving an attack; record a net’s restrained condition with add_condition or remove_condition, and remove a destroyed net with remove_item.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 confirmed: ADR 0018 §6 and closed bead eshyra-2n1t.1 defer combined multiclass spell slots and class-associated casting. Source clause: 'Your capacity for spellcasting depends partly on your combined levels in all your spellcasting classes and partly on your individual le'
  'rule:spellcasting': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class spellcasting under ADR 0018 leaves combined slots and class-associated spells deferred. A character combining classes is refused, and the DM does not adjudicate multiclass spellcasting from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 rewritten: the training duration and cost calculation has no registered operation in orchestrator/tools.ts DEFAULT_TOOLS. Source clause: training takes 250 days and costs 1 gp per day after finding an instructor; DEFAULT_TOOLS has no training-time/cost operation.
  'rule:training': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not calculate the training period or its total cost. The DM tracks the training period with update_clock and payment with spend_currency, then adjudicates the resulting proficiency.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 confirmed: the source limits this rule to characters who gain the feature from a second class; ADR 0018 §6 and closed bead eshyra-2n1t.1 defer it.
  'rule:channel-divinity': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra supports single-class characters only under ADR 0018. A character with more than one class is refused, so this multiclass Channel Divinity interaction is deliberately unsupported and is not adjudicated.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 confirmed: the breath countdown has no state owner; hpLifecycle.ts adjustHp handles the 0-HP transition, while toolAdjustHp.ts and toolStabilizeCharacter.ts do not gate recovery on breathing.
  'rule:suffocating': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not track how long a creature has held its breath or the suffocation round countdown; the DM tracks both from this rule. When the creature drops to 0 hit points, apply it with adjust_hp, which runs the dying rules. Eshyra also does not enforce that a suffocating creature cannot regain hit points or be stabilized until it can breathe again: do not call stabilize_character or restore its hit points while it still cannot breathe.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 confirmed: the source says an Unarmored Defense feature from a second class is not gained; ADR 0018 §6 and closed bead eshyra-2n1t.1 defer the interaction.
  'rule:unarmored-defense': Object.freeze([
    Object.freeze({
      limit: 'deferred',
      statement:
        'Eshyra’s single-class feature model under ADR 0018 leaves the interaction between multiple Unarmored Defense grants deferred. A character combining classes is refused, and the DM does not adjudicate which AC formula applies from this prose.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    }),
  ]),
  // R0 rewritten: the external generic-weapon-procedure clause is retired with eshyra-o9bd.18.7.8.3 closed and parameters carried in the pack; toolResolveCheck.ts resolveCheckTool still does not decrement ammunition or enforce loading and attack-count limits.
  'rule:weapon-properties': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not enforce ammunition decrement, the loading restriction, or weapon-property attack-count limits. The DM removes ammunition with remove_item after each attack and adjudicates the loading and attack-count limits before resolving further attacks.',
      findingId: 'readiness-integrity',
    }),
  ]),
  // R0 rewritten: levelUpEngine.ts does not model downtime copying costs or time for found spells. Source clause: 'The spells that you add to your spellbook as you gain levels reflect the arcane research you conduct on your own, as well as intellectu'
  'rule:wizard-your-spellbook': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Eshyra does not calculate the time and gold cost to copy a spell into a wizard’s spellbook. The DM applies the per-level costs and time, records elapsed study with update_clock, and records expenses with spend_currency.',
      findingId: 'readiness-integrity',
    }),
  ]),
});

export function validateRuleKnownLimits(
  entries: Readonly<
    Record<string, readonly RuleKnownLimit[]>
  > = RULE_KNOWN_LIMITS,
): readonly string[] {
  const errors: string[] = [];
  for (const [key, limits] of Object.entries(entries))
    for (const limit of limits) {
      if (findingByCanonicalId(limit.findingId) === undefined)
        errors.push(`${key}: unknown findingId '${limit.findingId}'`);
      for (const clause of limit.externalClauses ?? [])
        if (findingByCanonicalId(clause.findingId) === undefined)
          errors.push(
            `${key}: unknown external findingId '${clause.findingId}'`,
          );
    }
  return errors;
}
