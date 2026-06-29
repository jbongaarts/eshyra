import { describe, expect, it } from 'vitest';
import {
  getAncestryAbilityScoreIncrease,
  getBundledDnd5eCharacterResolver,
  getBundledDnd5eSrdPack,
  resolveRulesStack,
} from '../src/internal.js';

/**
 * Source-cited ability-score-increase constants are retained as regression
 * oracles. Character creation reads generated pack data at runtime; these tests
 * assert that generated data still matches the SRD-derived oracle values and
 * source prose.
 */

const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
const resolver = getBundledDnd5eCharacterResolver();

interface AncestryTrait {
  readonly name: string;
  readonly text: string;
}

function ancestryEntries(): { key: string; asiText: string }[] {
  const index = stack.recordsByKind.get('ancestry');
  if (index === undefined) {
    throw new Error('no ancestry records in the bundled pack');
  }
  const entries: { key: string; asiText: string }[] = [];
  for (const { record } of index.byKey.values()) {
    const data = record.data as { traits?: readonly AncestryTrait[] };
    const asi = (data.traits ?? []).find((trait) =>
      /ability score increase/i.test(trait.name),
    );
    if (asi === undefined) {
      throw new Error(`ancestry ${record.key} has no ability-increase trait`);
    }
    entries.push({ key: record.key, asiText: asi.text });
  }
  return entries;
}

describe('ancestry ability-score-increase oracle', () => {
  it('matches every frozen ancestry generated pack field', () => {
    const entries = ancestryEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const { key, asiText } of entries) {
      const oracle = getAncestryAbilityScoreIncrease(key);
      if (oracle === undefined) {
        throw new Error(`missing oracle for ${key}`);
      }
      const actual = resolver.resolveAncestry(key);
      if (!actual.ok) {
        throw new Error(`ancestry ${key} did not resolve`);
      }
      expect(actual.record.abilityScoreIncreases).toEqual([oracle]);
      expect(
        asiText.startsWith(oracle.sourceText),
        `oracle sourceText for ${key} is not faithful to pack prose`,
      ).toBe(true);
      expect(oracle.fixed.length).toBeGreaterThan(0);
    }
  });

  it('interprets representative fixed increases correctly', () => {
    expect(getAncestryAbilityScoreIncrease('ancestry:elf')?.fixed).toEqual([
      { ability: 'dexterity', bonus: 2 },
    ]);
    expect(getAncestryAbilityScoreIncrease('ancestry:high-elf')?.fixed).toEqual(
      [
        { ability: 'dexterity', bonus: 2 },
        { ability: 'intelligence', bonus: 1 },
      ],
    );
    // Human raises all six abilities by 1.
    const human = getAncestryAbilityScoreIncrease('ancestry:human');
    expect(human?.choice).toBeUndefined();
    expect(human?.fixed).toEqual([
      { ability: 'strength', bonus: 1 },
      { ability: 'dexterity', bonus: 1 },
      { ability: 'constitution', bonus: 1 },
      { ability: 'intelligence', bonus: 1 },
      { ability: 'wisdom', bonus: 1 },
      { ability: 'charisma', bonus: 1 },
    ]);
  });

  it('models the Half-Elf choice as +1 to two abilities other than the fixed one', () => {
    const halfElf = getAncestryAbilityScoreIncrease('ancestry:half-elf');
    expect(halfElf?.fixed).toEqual([{ ability: 'charisma', bonus: 2 }]);
    expect(halfElf?.choice).toEqual({
      choose: 2,
      bonus: 1,
      from: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom'],
    });
  });

  it('is the only ancestry that grants a player choice', () => {
    const withChoice = ancestryEntries()
      .map(({ key }) => key)
      .filter(
        (key) => getAncestryAbilityScoreIncrease(key)?.choice !== undefined,
      );
    expect(withChoice).toEqual(['ancestry:half-elf']);
  });

  it('returns undefined for an unmodeled ancestry key', () => {
    expect(
      getAncestryAbilityScoreIncrease('ancestry:warforged'),
    ).toBeUndefined();
  });
});
