import { describe, expect, it } from 'vitest';
import {
  assertNoEmbeddedTableLinearization,
  EmbeddedTableProseError,
  stripEmbeddedTableProse,
} from '../../../scripts/importers/dnd5e-srd-5.1/stripEmbeddedTableProse.js';
import type { TableExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

function record(
  key: string,
  field: 'description' | 'text',
  value: string,
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: key.split(':')[0],
    key,
    name: key,
    data: { [field]: value },
    source: 'SRD 5.1 p. 1',
    license: { licenseClass: 'open' },
    provenance: { sourceRef: 'x', locator: 'p. 1' },
  } as unknown as RulesRecord;
}

function table(
  name: string,
  ownerRecordKey: string | undefined,
  proseSourceText: string | undefined,
): TableExtraction {
  return {
    name,
    columns: ['a', 'b'],
    rows: [['1', '2']],
    sourcePage: 1,
    ...(ownerRecordKey === undefined ? {} : { ownerRecordKey }),
    ...(proseSourceText === undefined ? {} : { proseSourceText }),
  };
}

describe('stripEmbeddedTableProse', () => {
  it('removes an end-of-body table span and keeps the preceding prose', () => {
    const span =
      'd20 Bead of … Spell 1–6 Blessing Bless 20 Wind Wind walk walking';
    const records = [
      record(
        'magic-item:necklace',
        'description',
        `This necklace has magic beads. ${span}`,
      ),
    ];
    const tables = [table('Necklace', 'magic-item:necklace', span)];
    const [out] = stripEmbeddedTableProse({ records, tables });
    expect((out.data as { description: string }).description).toBe(
      'This necklace has magic beads.',
    );
  });

  it('removes a mid-body table span and rejoins the surrounding prose', () => {
    const span = 'Playing Card Card Ace of diamonds Vizier Joker Jester';
    const records = [
      record(
        'magic-item:deck',
        'description',
        `Draw the same card twice. ${span} Balance. Your mind suffers.`,
      ),
    ];
    const tables = [table('Deck', 'magic-item:deck', span)];
    const [out] = stripEmbeddedTableProse({ records, tables });
    expect((out.data as { description: string }).description).toBe(
      'Draw the same card twice. Balance. Your mind suffers.',
    );
  });

  it('scopes identical spans to their named owners (no cross-strip ambiguity)', () => {
    const span = 'Distance from Origin Damage 21 to 30 ft. away 4 ×';
    const records = [
      record('magic-item:staff-of-power', 'description', `Power. ${span}`),
      record('magic-item:staff-of-the-magi', 'description', `Magi. ${span}`),
    ];
    const tables = [
      table('Staff of Power', 'magic-item:staff-of-power', span),
      table('Staff of the Magi', 'magic-item:staff-of-the-magi', span),
    ];
    const out = stripEmbeddedTableProse({ records, tables });
    expect((out[0].data as { description: string }).description).toBe('Power.');
    expect((out[1].data as { description: string }).description).toBe('Magi.');
    // And the completeness assertion is satisfied once both copies are gone.
    expect(() =>
      assertNoEmbeddedTableLinearization({ records: out, tables }),
    ).not.toThrow();
  });

  it('is a no-op when the owner prose does not contain the span', () => {
    const records = [
      record('rule:half-dragon-template', 'text', 'Clean rule prose only.'),
    ];
    const tables = [
      table(
        'Half-Dragon Breath Weapon',
        'rule:half-dragon-template',
        'Size Breath Weapon Prerequisite Large',
      ),
    ];
    const [out] = stripEmbeddedTableProse({ records, tables });
    expect((out.data as { text: string }).text).toBe('Clean rule prose only.');
  });

  it('ignores tables with no owner or no captured span', () => {
    const records = [record('rule:x', 'text', 'Travel Pace 30 feet a day.')];
    const tables = [
      table('Travel Pace', undefined, 'Travel Pace 30 feet a day.'),
      table('Orphan', 'rule:x', undefined),
    ];
    const [out] = stripEmbeddedTableProse({ records, tables });
    expect((out.data as { text: string }).text).toBe(
      'Travel Pace 30 feet a day.',
    );
  });

  it('fails closed when an owner key names no emitted record', () => {
    expect(() =>
      stripEmbeddedTableProse({
        records: [record('magic-item:other', 'description', 'x')],
        tables: [table('Ghost', 'magic-item:missing', 'some span text here')],
      }),
    ).toThrow(EmbeddedTableProseError);
  });

  it('assertion catches a genuinely embedded table left in prose', () => {
    const span = 'd100 Effect 01–50 nothing 51–00 chaos ensues';
    const records = [
      record('magic-item:wand', 'description', `A wand. ${span}`),
    ];
    // No owner set => not stripped => the assertion must flag the leak.
    const tables = [table('Wand', undefined, span)];
    expect(() =>
      assertNoEmbeddedTableLinearization({ records, tables }),
    ).toThrow(EmbeddedTableProseError);
  });
});
