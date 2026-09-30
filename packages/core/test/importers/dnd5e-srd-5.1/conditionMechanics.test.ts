import { describe, expect, it } from 'vitest';
import { deriveConditionRecordMechanics } from '../../../scripts/importers/dnd5e-srd-5.1/conditionMechanics.js';
import type { ConditionExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

// SRD 5.1 p. 358, Exhaustion introductory prose (verbatim).
const EXHAUSTION_PROSE =
  'Some special abilities and environmental hazards, such as starvation and the long-term effects of freezing or scorching temperatures, can lead to a special condition called exhaustion. Exhaustion is measured in six levels. An effect can give a creature one or more levels of exhaustion, as specified in the effect’s description. If an already exhausted creature suffers another effect that causes exhaustion, its current level of exhaustion increases by the amount specified in the effect’s description. A creature suffers the effect of its current level of exhaustion as well as all lower levels. For example, a creature suffering level 2 exhaustion has its speed halved and has disadvantage on ability checks. An effect that removes exhaustion reduces its level as specified in the effect’s description, with all exhaustion effects ending if a creature’s exhaustion level is reduced below 1. Finishing a long rest reduces a creature’s exhaustion level by 1, provided that the creature has also ingested some food and drink.';

function exhaustion(description: string): ConditionExtraction {
  return {
    name: 'Exhaustion',
    description,
    effects: [],
    levels: [
      { level: 1, effect: 'Disadvantage on ability checks' },
      { level: 2, effect: 'Speed halved' },
    ],
    sourcePage: 358,
  };
}

describe('deriveConditionRecordMechanics exhaustion level lifecycle', () => {
  it('projects how exhaustion levels are gained, removed, ended, and reduced by a long rest', () => {
    expect(
      deriveConditionRecordMechanics(exhaustion(EXHAUSTION_PROSE))
        ?.levelLifecycle,
    ).toEqual({
      gain: 'increase-by-amount-specified-by-effect',
      removal: 'reduce-by-amount-specified-by-effect',
      endsWhenLevelBelow: 1,
      restReduction: {
        rest: 'long-rest',
        levels: 1,
        requires: 'ingested-food-and-drink',
      },
      exceptionRuleRefs: ['rule:food-and-water'],
    });
  });

  it('drops a lifecycle clause whose source sentence is absent instead of asserting it', () => {
    const withoutRest = EXHAUSTION_PROSE.replace(
      / Finishing a long rest[^.]*\./,
      '',
    );
    const lifecycle = deriveConditionRecordMechanics(
      exhaustion(withoutRest),
    )?.levelLifecycle;
    expect(lifecycle?.restReduction).toBeUndefined();
    expect(lifecycle?.exceptionRuleRefs).toBeUndefined();
    expect(lifecycle?.gain).toBe('increase-by-amount-specified-by-effect');
  });
});

describe('deriveConditionRecordMechanics Grappled trigger condition', () => {
  it('projects only the source-named incapacitated trigger condition', () => {
    // SRD 5.1 p. 358: “The condition ends if the grappler is incapacitated
    // (see the condition).” The reach clause names no condition.
    const mechanics = deriveConditionRecordMechanics({
      name: 'Grappled',
      description:
        'The condition ends if the grappler is incapacitated (see the condition), or if an effect removes the grappled creature from the grappler’s reach.',
      effects: [],
      sourcePage: 358,
    });
    expect(
      mechanics?.effects?.filter(
        (effect) => effect.kind === 'conditionEndsWhen',
      ),
    ).toEqual([
      {
        kind: 'conditionEndsWhen',
        condition: 'grappled',
        trigger: 'grappler-incapacitated',
        triggerCondition: 'incapacitated',
      },
      {
        kind: 'conditionEndsWhen',
        condition: 'grappled',
        trigger: 'removed-from-grappler-reach',
      },
    ]);
  });
});
