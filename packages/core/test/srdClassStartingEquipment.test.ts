import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eSrdPack,
  getClassStartingEquipment,
  resolveRulesStack,
} from '../src/internal.js';

/**
 * The overlay (eshyra-b69j.12.3) structures each class's starting equipment that
 * the frozen pack carries only as prose. These tests pin it to the frozen
 * records: every pack class must have an overlay whose per-entry `sourceText`
 * deep-equals the pack's `startingEquipment.entries` verbatim, so the overlay can
 * never silently drift from the audited source it cites.
 */

const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });

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

describe('class starting-equipment overlay', () => {
  it('covers every frozen class with source-faithful entry text', () => {
    const classes = classEntries();
    expect(classes.length).toBe(12);
    for (const { key, entries } of classes) {
      const overlay = getClassStartingEquipment(key);
      if (overlay === undefined) {
        throw new Error(`missing overlay for ${key}`);
      }
      // Each overlay entry's sourceText must equal the pack entry verbatim, in
      // order — the freeze-faithfulness pin.
      expect(overlay.entries.map((e) => e.sourceText)).toEqual(entries);
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
      { label: 'a', text: 'chain mail' },
      { label: 'b', text: 'leather armor, longbow, and 20 arrows' },
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
    });
    // Exactly the three choose-one groups are choices.
    expect(wizard?.entries.filter((e) => e.kind === 'choice')).toHaveLength(3);
  });

  it('treats the Rogue leather-armor line as a fixed grant despite a stray (a)', () => {
    const rogue = getClassStartingEquipment('class:rogue');
    const last = rogue?.entries.at(-1);
    expect(last?.kind).toBe('fixed');
    if (last?.kind !== 'fixed') {
      throw new Error('expected a fixed grant');
    }
    // The clean text drops the artifact marker; sourceText keeps it verbatim.
    expect(last.text).toBe('Leather armor, two daggers, and thieves’ tools');
    expect(last.sourceText).toBe(
      '(a) Leather armor, two daggers, and thieves’ tools',
    );
  });

  it('returns undefined for an unmodeled class key', () => {
    expect(getClassStartingEquipment('class:artificer')).toBeUndefined();
  });
});
