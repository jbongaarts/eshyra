import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eCharacterResolver,
  getBundledDnd5eSrdPack,
  getClassStartingEquipment,
  resolveRulesStack,
} from '../src/internal.js';

/**
 * Source-cited starting-equipment constants are retained as regression oracles.
 * Runtime creation reads generated pack fields; these tests assert that the
 * generated fields still match the SRD-derived oracle values.
 */

const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
const resolver = getBundledDnd5eCharacterResolver();

interface PackStartingEquipment {
  readonly entries?: readonly (string | { readonly sourceText?: string })[];
}

function classEntries(): { key: string; entries: readonly string[] }[] {
  const index = stack.recordsByKind.get('class');
  if (index === undefined) {
    throw new Error('no class records in the bundled pack');
  }
  const out: { key: string; entries: readonly string[] }[] = [];
  for (const { record } of index.byKey.values()) {
    const data = record.data as {
      startingEquipment?: PackStartingEquipment;
    };
    out.push({
      key: record.key,
      entries: (data.startingEquipment?.entries ?? []).map((entry) =>
        typeof entry === 'string' ? entry : (entry.sourceText ?? ''),
      ),
    });
  }
  return out;
}

describe('class starting-equipment oracle', () => {
  it('matches every frozen class generated pack field', () => {
    const classes = classEntries();
    expect(classes.length).toBe(12);
    for (const { key, entries } of classes) {
      const oracle = getClassStartingEquipment(key);
      if (oracle === undefined) {
        throw new Error(`missing oracle for ${key}`);
      }
      const actual = resolver.resolveClass(key);
      if (!actual.ok) {
        throw new Error(`class ${key} did not resolve`);
      }
      expect(actual.record.startingEquipment?.entries).toEqual(oracle.entries);
      expect(oracle.entries.map((e) => e.sourceText)).toEqual(entries);
    }
  });

  it('structures Fighter choose-one groups with labelled options', () => {
    const fighter = getClassStartingEquipment('class:fighter');
    expect(fighter?.entries).toHaveLength(4);
    // Every Fighter entry is a choose-one group (no fixed grants).
    expect(fighter?.entries.every((e) => e.kind === 'choice')).toBe(true);
    const first = fighter?.entries[0];
    if (first?.kind !== 'choice') {
      throw new Error('expected a choice group');
    }
    expect(first.options).toEqual([
      {
        label: 'a',
        text: 'chain mail',
        grants: [{ kind: 'item', ref: 'equipment:chain-mail', quantity: 1 }],
      },
      {
        label: 'b',
        text: 'leather armor, longbow, and 20 arrows',
        grants: [
          { kind: 'item', ref: 'equipment:leather', quantity: 1 },
          { kind: 'item', ref: 'equipment:longbow', quantity: 1 },
          { kind: 'item', ref: 'equipment:arrows-20', quantity: 1 },
        ],
      },
    ]);
  });

  it('models a three-option group (Bard weapons)', () => {
    const bard = getClassStartingEquipment('class:bard');
    const weapons = bard?.entries[0];
    if (weapons?.kind !== 'choice') {
      throw new Error('expected a choice group');
    }
    expect(weapons.options.map((o) => o.label)).toEqual(['a', 'b', 'c']);
    expect(weapons.options.map((o) => o.text)).toEqual([
      'a rapier',
      'a longsword',
      'any simple weapon',
    ]);
  });

  it('models fixed grants (Wizard spellbook) as non-choice entries', () => {
    const wizard = getClassStartingEquipment('class:wizard');
    const spellbook = wizard?.entries.at(-1);
    expect(spellbook).toEqual({
      kind: 'fixed',
      text: 'A spellbook',
      sourceText: 'A spellbook',
      grants: [{ kind: 'item', ref: 'equipment:spellbook', quantity: 1 }],
    });
    // Exactly the three choose-one groups are choices.
    expect(wizard?.entries.filter((e) => e.kind === 'choice')).toHaveLength(3);
  });

  it('treats the Rogue leather-armor line as a fixed grant without a stray (a)', () => {
    const rogue = getClassStartingEquipment('class:rogue');
    const last = rogue?.entries.at(-1);
    expect(last?.kind).toBe('fixed');
    if (last?.kind !== 'fixed') {
      throw new Error('expected a fixed grant');
    }
    expect(last.text).toBe('Leather armor, two daggers, and thieves’ tools');
    expect(last.sourceText).toBe(
      'Leather armor, two daggers, and thieves’ tools',
    );
  });

  it('returns undefined for an unmodeled class key', () => {
    expect(getClassStartingEquipment('class:artificer')).toBeUndefined();
  });
});
