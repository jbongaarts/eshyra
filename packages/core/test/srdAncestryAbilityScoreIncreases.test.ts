import { describe, expect, it } from 'vitest';
import {
  getAncestryAbilityScoreIncreases,
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

function ancestryEntries(): { key: string; asiTexts: string[] }[] {
  const index = stack.recordsByKind.get('ancestry');
  if (index === undefined) {
    throw new Error('no ancestry records in the bundled pack');
  }
  const entries: { key: string; asiTexts: string[] }[] = [];
  for (const { record } of index.byKey.values()) {
    const data = record.data as { traits?: readonly AncestryTrait[] };
    const asiTraits = (data.traits ?? []).filter((trait) =>
      /ability score increase/i.test(trait.name),
    );
    if (asiTraits.length === 0) {
      throw new Error(`ancestry ${record.key} has no ability-increase trait`);
    }
    entries.push({ key: record.key, asiTexts: asiTraits.map((t) => t.text) });
  }
  return entries;
}

describe('ancestry ability-score-increase oracle', () => {
  it('matches every frozen ancestry generated pack field', () => {
    const entries = ancestryEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const { key, asiTexts } of entries) {
      const oracle = getAncestryAbilityScoreIncreases(key);
      if (oracle === undefined) {
        throw new Error(`missing oracle for ${key}`);
      }
      const actual = resolver.resolveAncestry(key);
      if (!actual.ok) {
        throw new Error(`ancestry ${key} did not resolve`);
      }
      expect(actual.record.abilityScoreIncreases).toEqual(oracle);
      // Every trait named "Ability Score Increase" is one printed sentence —
      // for the four SRD 5.1 subraces there are two (parent + subrace, each
      // printed in a separate section). The multiset of ASI-trait texts must
      // equal, one-to-one and in order, the oracle's sourceText values by
      // exact string equality — not merely start with a composed join of them.
      expect(
        asiTexts,
        `oracle sourceText entries for ${key} are not faithful to pack prose, in order`,
      ).toEqual(oracle.map((entry) => entry.sourceText));
      for (const entry of oracle) {
        expect(entry.fixed.length).toBeGreaterThan(0);
      }
    }
  });

  it('interprets representative fixed increases correctly', () => {
    expect(getAncestryAbilityScoreIncreases('ancestry:elf')).toEqual([
      {
        fixed: [{ ability: 'dexterity', bonus: 2 }],
        sourceText: 'Your Dexterity score increases by 2.',
      },
    ]);
    // High Elf prints its ability-score-increase sentence across two separate
    // sections (parent Elf block, then the High Elf subrace block), so the
    // oracle carries two entries in that document order rather than one
    // fabricated joined sentence.
    expect(getAncestryAbilityScoreIncreases('ancestry:high-elf')).toEqual([
      {
        fixed: [{ ability: 'dexterity', bonus: 2 }],
        sourceText: 'Your Dexterity score increases by 2.',
      },
      {
        fixed: [{ ability: 'intelligence', bonus: 1 }],
        sourceText: 'Your Intelligence score increases by 1.',
      },
    ]);
    // Human raises all six abilities by 1, printed as a single sentence.
    const human = getAncestryAbilityScoreIncreases('ancestry:human');
    expect(human).toHaveLength(1);
    expect(human?.[0]?.choice).toBeUndefined();
    expect(human?.[0]?.fixed).toEqual([
      { ability: 'strength', bonus: 1 },
      { ability: 'dexterity', bonus: 1 },
      { ability: 'constitution', bonus: 1 },
      { ability: 'intelligence', bonus: 1 },
      { ability: 'wisdom', bonus: 1 },
      { ability: 'charisma', bonus: 1 },
    ]);
  });

  it('sums subrace entries to the same net level-1 bonus as before the split', () => {
    // Rock Gnome: +2 Intelligence (parent Gnome), +1 Constitution (subrace).
    const rockGnome = getAncestryAbilityScoreIncreases('ancestry:rock-gnome');
    expect(rockGnome?.flatMap((entry) => entry.fixed)).toEqual([
      { ability: 'intelligence', bonus: 2 },
      { ability: 'constitution', bonus: 1 },
    ]);
    // Lightfoot Halfling: +2 Dexterity (parent Halfling), +1 Charisma (subrace).
    const lightfoot = getAncestryAbilityScoreIncreases(
      'ancestry:lightfoot-halfling',
    );
    expect(lightfoot?.flatMap((entry) => entry.fixed)).toEqual([
      { ability: 'dexterity', bonus: 2 },
      { ability: 'charisma', bonus: 1 },
    ]);
    // Hill Dwarf: +2 Constitution (parent Dwarf), +1 Wisdom (subrace).
    const hillDwarf = getAncestryAbilityScoreIncreases('ancestry:hill-dwarf');
    expect(hillDwarf?.flatMap((entry) => entry.fixed)).toEqual([
      { ability: 'constitution', bonus: 2 },
      { ability: 'wisdom', bonus: 1 },
    ]);
  });

  it('models the Half-Elf choice as +1 to two abilities other than the fixed one', () => {
    const halfElf = getAncestryAbilityScoreIncreases('ancestry:half-elf');
    expect(halfElf).toHaveLength(1);
    expect(halfElf?.[0]?.fixed).toEqual([{ ability: 'charisma', bonus: 2 }]);
    expect(halfElf?.[0]?.choice).toEqual({
      choose: 2,
      bonus: 1,
      from: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom'],
    });
  });

  it('is the only ancestry that grants a player choice', () => {
    const withChoice = ancestryEntries()
      .map(({ key }) => key)
      .filter((key) =>
        (getAncestryAbilityScoreIncreases(key) ?? []).some(
          (entry) => entry.choice !== undefined,
        ),
      );
    expect(withChoice).toEqual(['ancestry:half-elf']);
  });

  it('returns undefined for an unmodeled ancestry key', () => {
    expect(
      getAncestryAbilityScoreIncreases('ancestry:warforged'),
    ).toBeUndefined();
  });
});
