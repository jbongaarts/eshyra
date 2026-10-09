import { describe, expect, it } from 'vitest';
import { validateRecordKindSchema } from '../src/rules/kindSchemas.js';
import type { RulesRecord } from '../src/rules/types.js';

/**
 * Focused negative validator tests for the FeatureChoice fields added by
 * eshyra-mdke (`requiresOption`, `optional: true`) in `optFeatureChoiceArray`
 * (kindSchemas.ts). Uses a minimal hand-built feature record, not the real
 * pack, so each rejection is attributable to exactly one field.
 */

type ChoiceEntry = Record<string, unknown>;

function featureWithChoices(choices: readonly ChoiceEntry[]): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'feature',
    key: 'feature:test:choices',
    name: 'Choice Test',
    data: {
      source: 'class:test',
      level: 1,
      description: 'Test feature with player choices.',
      choices,
    },
  } as RulesRecord;
}

// Sibling choice that offers two options; `requiresOption` on another choice
// names it and one of these option ids.
const siblingChoice: ChoiceEntry = {
  id: 'race-pick',
  category: 'language',
  prompt: 'Pick a race.',
  level: 1,
  choose: 1,
  from: ['humanoid-a', 'humanoid-b'],
};

const dependentChoice = (
  requiresOption: unknown,
  extra: Record<string, unknown> = {},
): ChoiceEntry => ({
  id: 'race-language',
  category: 'language',
  prompt: 'Pick a language.',
  level: 1,
  choose: 1,
  from: ['common', 'elvish'],
  requiresOption,
  ...extra,
});

describe('FeatureChoice requiresOption validation (eshyra-mdke / eshyra-v0db)', () => {
  it('rejects requiresOption whose choiceId names no sibling choice', () => {
    const record = featureWithChoices([
      siblingChoice,
      dependentChoice({ choiceId: 'no-such-choice', optionId: 'humanoid-a' }),
    ]);
    expect(() => validateRecordKindSchema(record, 'records[0]')).toThrow(
      /choices\[1\]\.requiresOption\.choiceId 'no-such-choice' must name a sibling choice/,
    );
  });

  it('rejects requiresOption whose choiceId names the choice itself', () => {
    const record = featureWithChoices([
      siblingChoice,
      dependentChoice({ choiceId: 'race-language', optionId: 'common' }),
    ]);
    expect(() => validateRecordKindSchema(record, 'records[0]')).toThrow(
      /must name a sibling choice on the same feature/,
    );
  });

  it('rejects requiresOption whose optionId is not in the sibling from list', () => {
    const record = featureWithChoices([
      siblingChoice,
      dependentChoice({ choiceId: 'race-pick', optionId: 'not-an-option' }),
    ]);
    expect(() => validateRecordKindSchema(record, 'records[0]')).toThrow(
      /requiresOption\.optionId 'not-an-option' must be one of sibling choice 'race-pick'/,
    );
  });

  it('rejects requiresOption whose sibling has no from list to check against', () => {
    const noFrom: ChoiceEntry = {
      id: 'race-pick',
      category: 'language',
      prompt: 'Pick a race.',
      level: 1,
      choose: 1,
    };
    const record = featureWithChoices([
      noFrom,
      dependentChoice({ choiceId: 'race-pick', optionId: 'humanoid-a' }),
    ]);
    expect(() => validateRecordKindSchema(record, 'records[0]')).toThrow(
      /requiresOption\.optionId 'humanoid-a' must be one of sibling choice 'race-pick'/,
    );
  });

  it('rejects a malformed requiresOption shape (non-object)', () => {
    const record = featureWithChoices([
      siblingChoice,
      dependentChoice('race-pick:humanoid-a'),
    ]);
    expect(() => validateRecordKindSchema(record, 'records[0]')).toThrow(
      /choices\[1\]\.requiresOption must be a non-null object/,
    );
  });

  it('rejects a requiresOption missing optionId', () => {
    const record = featureWithChoices([
      siblingChoice,
      dependentChoice({ choiceId: 'race-pick' }),
    ]);
    expect(() => validateRecordKindSchema(record, 'records[0]')).toThrow(
      /choices\[1\]\.requiresOption\.optionId must be a non-empty string/,
    );
  });

  it('rejects optional present but false', () => {
    const record = featureWithChoices([
      siblingChoice,
      dependentChoice(
        { choiceId: 'race-pick', optionId: 'humanoid-a' },
        { optional: false },
      ),
    ]);
    expect(() => validateRecordKindSchema(record, 'records[0]')).toThrow(
      /choices\[1\]\.optional must be true when present/,
    );
  });

  it('rejects optional present as a string', () => {
    const record = featureWithChoices([
      siblingChoice,
      dependentChoice(
        { choiceId: 'race-pick', optionId: 'humanoid-a' },
        { optional: 'true' },
      ),
    ]);
    expect(() => validateRecordKindSchema(record, 'records[0]')).toThrow(
      /choices\[1\]\.optional must be true when present/,
    );
  });

  it('accepts a valid requiresOption with optional: true', () => {
    const record = featureWithChoices([
      siblingChoice,
      dependentChoice(
        { choiceId: 'race-pick', optionId: 'humanoid-a' },
        { optional: true },
      ),
    ]);
    expect(() => validateRecordKindSchema(record, 'records[0]')).not.toThrow();
  });
});
