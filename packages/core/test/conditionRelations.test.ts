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
