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
  // R0 rewritten: packages/core/src/state/activeEffects.ts addEffect tracks the charm duration, but packages/core/src/orchestrator/toolAdjustHp.ts adjustHpTool cannot trigger the source repeat save when the charmed creature takes damage.
  'rule:conflict': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'Damage to a creature charmed by a sentient item permits another saving throw, but adjust_hp does not trigger that save from the tracked effect. After applying damage, resolve the repeat save with resolve_check and end the effect if it succeeds.',
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
  // R0 rewritten: packages/core/src/orchestrator/toolSpendTurnResource.ts spendTurnResourceTool charges an Attack action without checking the source net clause limiting that action to one attack; toolResolveCheck.ts resolveCheckTool resolves each attack independently.
  'rule:special-weapons': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'A net attack limits the Attack action to one attack, but spend_turn_resource does not enforce that limit. Make only one net attack with resolve_check even if a feature grants additional attacks.',
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
  // R0 confirmed: hpLifecycle.ts adjustHp handles the 0-HP transition, while toolAdjustHp.ts and toolStabilizeCharacter.ts do not gate recovery on breathing.
  'rule:suffocating': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'When the creature drops to 0 hit points, apply it with adjust_hp, which runs the dying rules. Eshyra does not gate stabilization or HP recovery on renewed breathing: do not call stabilize_character or restore HP before the creature can breathe.',
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
  // R0 rewritten: packages/core/src/orchestrator/toolResolveCheck.ts resolveCheckTool resolves ranged attacks without the source ammunition expenditure; packages/core/src/orchestrator/toolRemoveItem.ts removeItemTool requires an explicit inventory mutation.
  'rule:weapon-properties': Object.freeze([
    Object.freeze({
      limit: 'partial',
      statement:
        'resolve_check does not spend ammunition for an attack with the ammunition property. Spend one piece with remove_item after each such attack, and apply the loading restriction before another attack with that weapon.',
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
