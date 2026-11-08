import { describe, expect, it } from 'vitest';
import { deriveConditionMechanics } from '../src/rules/conditionRelations.js';

// Classifier regression tests (per the eshyra-o9bd.18.3 review note: the
// condition-relation-safety gate shares this classifier with the importer,
// so relation bugs need direct classifier tests, not the gate).
describe('benefit early-end triggers (eshyra-o9bd.18.7.5)', () => {
  it('classifies "ends early if you are knocked unconscious" as exclusion, not applies', () => {
    const relations = deriveConditionMechanics(
      'Your rage lasts for 1 minute. It ends early if you are knocked unconscious or if your turn ends and you haven’t attacked a hostile creature since your last turn.',
    );
    expect(relations).toEqual([
      { condition: 'unconscious', relation: 'exclusion' },
    ]);
  });

  it('still classifies a genuine knocked-prone application as applies', () => {
    const relations = deriveConditionMechanics(
      'On a failed save, the target takes 7 (2d6) damage and is knocked prone.',
    );
    expect(relations).toEqual([{ condition: 'prone', relation: 'applies' }]);
  });
});

describe('review failure classes beyond Rage (eshyra-o9bd.18.7.5)', () => {
  it('classifies Persistent Rage "ends early only if you fall unconscious" as exclusion', () => {
    expect(
      deriveConditionMechanics(
        'Beginning at 15th level, your rage is so fierce that it ends early only if you fall unconscious or if you choose to end it.',
      ),
    ).toEqual([{ condition: 'unconscious', relation: 'exclusion' }]);
  });

  it('classifies Danger Sense "To gain this benefit, you can’t be blinded, deafened, or incapacitated" as exclusions, not prevents', () => {
    expect(
      deriveConditionMechanics(
        'To gain this benefit, you can’t be blinded, deafened, or incapacitated.',
      ),
    ).toEqual([
      { condition: 'blinded', relation: 'exclusion' },
      { condition: 'deafened', relation: 'exclusion' },
      { condition: 'incapacitated', relation: 'exclusion' },
    ]);
  });

  it('classifies Grappler "you and the creature are both restrained" as applies', () => {
    expect(
      deriveConditionMechanics(
        'If you succeed, you and the creature are both restrained until the grapple ends.',
      ),
    ).toEqual([{ condition: 'restrained', relation: 'applies' }]);
  });

  it('still classifies an ordinary prevention as prevents', () => {
    expect(
      deriveConditionMechanics('The target can’t be charmed or frightened.'),
    ).toEqual([
      { condition: 'charmed', relation: 'prevents' },
      { condition: 'frightened', relation: 'prevents' },
    ]);
  });
});

describe('removal of condition-causing effects (eshyra-30xi)', () => {
  for (const conditions of ['charmed or frightened', 'frightened or charmed']) {
    it(`removes both alternatives in ${conditions}`, () => {
      expect(
        deriveConditionMechanics(
          `Starting at 7th level, you can use your action to end one effect on yourself that is causing you to be ${conditions}.`,
        ),
      ).toEqual([
        { condition: 'charmed', relation: 'removes' },
        { condition: 'frightened', relation: 'removes' },
      ]);
    });
  }
});

describe('adverbed and listed infliction (eshyra-mx0d)', () => {
  const relationOf = (text: string, condition: string) =>
    deriveConditionMechanics(text).find((e) => e.condition === condition)
      ?.relation;

  it('classifies aboleth Enslave "be magically charmed by the aboleth" as applies', () => {
    expect(
      deriveConditionMechanics(
        'The target must succeed on a DC 14 Wisdom saving throw or be magically charmed by the aboleth until the aboleth dies or until it is on a different plane of existence from the target.',
      ),
    ).toEqual([{ condition: 'charmed', relation: 'applies' }]);
  });

  for (const [text, condition] of [
    ['it must succeed on a save or be magically charmed.', 'charmed'],
    ['the creature is instantly petrified.', 'petrified'],
    ['the target is also paralyzed for the same duration.', 'paralyzed'],
    ['the target is either blinded or deafened (your choice).', 'deafened'],
    ['the creature is deafened and frightened for 1 minute.', 'frightened'],
    ['the target is blinded, restrained, and stunned.', 'stunned'],
    ['it fails and is turned away, becoming petrified.', 'petrified'],
  ] as const) {
    it(`applies ${condition}: ${text}`, () => {
      expect(relationOf(text, condition)).toBe('applies');
    });
  }

  for (const [text, condition, relation] of [
    ['The target can’t be magically charmed.', 'charmed', 'prevents'],
    ['It isn’t magically charmed.', 'charmed', 'mention'],
    ['It is immune to being charmed or frightened.', 'frightened', 'immune'],
    [
      'while the vampire is also incapacitated in its resting place.',
      'incapacitated',
      'gates',
    ],
    [
      'You can suppress any effect causing a target to be magically charmed.',
      'charmed',
      'suppresses',
    ],
  ] as const) {
    it(`keeps ${relation} for ${condition}: ${text}`, () => {
      expect(relationOf(text, condition)).toBe(relation);
    });
  }
});

describe('residual non-copular infliction phrasings (eshyra-xogv)', () => {
  const relationOf = (text: string, condition: string) =>
    deriveConditionMechanics(text).find((e) => e.condition === condition)
      ?.relation;

  // Exact printed SRD sentences.
  for (const [text, condition] of [
    [
      'If the poison damage reduces the target to 0 hit points, the target is stable but poisoned for 1 hour, even after regaining hit points, and is paralyzed while poisoned in this way.',
      'poisoned',
    ],
    [
      'If the saving throw fails by 5 or more, the target is instead poisoned for 5 (1d10) minutes and unconscious while poisoned in this way.',
      'unconscious',
    ],
    [
      'If the target is Medium or smaller, it is grappled (escape DC 13) and restrained until the grapple ends.',
      'restrained',
    ],
    [
      'If it fails its saves three times, it is turned to stone and subjected to the petrified condition for the duration.',
      'petrified',
    ],
    [
      'If it fails its save three times, it permanently turns to stone and is subjected to the petrified condition.',
      'petrified',
    ],
    [
      'Those in the area are trapped under the net and restrained, and those that fail a DC 10 Strength saving throw are also knocked prone.',
      'restrained',
    ],
    [
      'each hostile creature that starts its turn in this aura must succeed on a Wisdom saving throw or be charmed (if you chose awe) or frightened (if you chose fear) until the aura ends.',
      'frightened',
    ],
    [
      'On a failed save, a creature suffers an effect based on its current hit points: • 50 hit points or fewer: deafened for 1 minute • 40 hit points or fewer: deafened and blinded for 10 minutes • 30 hit points or fewer: blinded, deafened, and stunned for 1 hour • 20 hit points or fewer: killed instantly',
      'stunned',
    ],
  ] as const) {
    it(`applies ${condition}: ${text.slice(0, 70)}`, () => {
      expect(relationOf(text, condition)).toBe('applies');
    });
  }

  // Controls: the extensions must not turn gates/exclusions into applications.
  for (const [text, condition, relation] of [
    [
      'The glyph is nearly invisible and requires a check to be found.',
      'invisible',
      'mention',
    ],
    [
      'One creature grappled by the chuul must succeed on a save.',
      'grappled',
      'mention',
    ],
    [
      'The ankheg spits acid, provided that it has no creature grappled.',
      'grappled',
      'mention',
    ],
    [
      'The effect ends early if the target is stable but poisoned.',
      'poisoned',
      'exclusion',
    ],
    [
      'while the target is grappled (escape DC 13) and restrained.',
      'restrained',
      'gates',
    ],
    ['It isn’t subjected to the petrified condition.', 'petrified', 'mention'],
  ] as const) {
    it(`keeps ${relation} for ${condition}: ${text}`, () => {
      expect(relationOf(text, condition)).toBe(relation);
    });
  }
});
