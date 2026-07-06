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
