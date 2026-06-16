import { describe, expect, it } from 'vitest';
import type { SourceInventoryItem } from '../../../scripts/importers/dnd5e-srd-5.1/sourceInventory.js';
import type { SourceCoverageEntry } from '../../../scripts/importers/dnd5e-srd-5.1/sourceInventoryCoverage.js';
import {
  assertSourceRegionLedger,
  buildSourceRegionLedger,
  SourceRegionLedgerError,
} from '../../../scripts/importers/dnd5e-srd-5.1/sourceRegionLedger.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(lines: readonly string[], heights: readonly number[]): PageText {
  return {
    pageNumber: 3,
    lines,
    lineHeights: heights,
    lineGaps: lines.map((_, index) => (index === 0 ? null : 10)),
  };
}

function item(
  overrides: Partial<SourceInventoryItem> & Pick<SourceInventoryItem, 'text'>,
): SourceInventoryItem {
  return {
    page: 3,
    lineIndex: 0,
    tier: 'section',
    structure: 'heading',
    section: null,
    context: null,
    ...overrides,
  };
}

function coverage(
  item: SourceInventoryItem,
  status: SourceCoverageEntry['status'],
): SourceCoverageEntry {
  return { item, status };
}

const record = (key: string, name: string, text: string) => ({
  kind: key.split(':')[0],
  key,
  name,
  data: { text },
});

describe('buildSourceRegionLedger', () => {
  it('distinguishes a pure structural heading with no body prose', () => {
    const heading = item({ text: 'Appendix A', lineIndex: 0 });
    const next = item({ text: 'Next Section', lineIndex: 1 });
    const ledger = buildSourceRegionLedger(
      [page(['Appendix A', 'Next Section'], [18, 18])],
      [
        coverage(heading, { kind: 'ignored', reason: 'document-structure' }),
        coverage(next, { kind: 'record', key: 'rule:next-section' }),
      ],
      [record('rule:next-section', 'Next Section', 'body')],
    );

    expect(ledger.entries).toContainEqual(
      expect.objectContaining({
        regionType: 'pure-structure',
        firstPhrase: 'Appendix A',
        normalizedCharCount: 0,
        classification: 'pure-document-structure',
      }),
    );
    expect(ledger.summary.unrepresented).toBe(0);
  });

  it('classifies chapter intro prose before the first child heading', () => {
    const chapter = item({
      text: 'Spellcasting',
      lineIndex: 0,
      tier: 'chapter',
    });
    const child = item({
      text: 'What Is a Spell?',
      lineIndex: 2,
      tier: 'section',
    });
    const ledger = buildSourceRegionLedger(
      [
        page(
          [
            'Spellcasting',
            'Magic permeates fantasy worlds.',
            'What Is a Spell?',
          ],
          [25.9, 9.8, 18],
        ),
      ],
      [
        coverage(chapter, { kind: 'record', key: 'rule:spellcasting-chapter' }),
        coverage(child, { kind: 'record', key: 'rule:what-is-a-spell' }),
      ],
      [
        record(
          'rule:spellcasting-chapter',
          'Spellcasting',
          'Magic permeates fantasy worlds.',
        ),
      ],
    );

    expect(ledger.entries).toContainEqual(
      expect.objectContaining({
        regionType: 'chapter-intro',
        firstPhrase: 'Magic permeates fantasy worlds.',
        classification: 'record:rule:spellcasting-chapter',
      }),
    );
  });

  it('classifies short prose under a group heading before records', () => {
    const group = item({ text: 'Sample Traps', lineIndex: 0 });
    const firstRecord = item({ text: 'Collapsing Roof', lineIndex: 2 });
    const ledger = buildSourceRegionLedger(
      [
        page(
          [
            'Sample Traps',
            'The traps presented here are alphabetical.',
            'Collapsing Roof',
          ],
          [18, 9.8, 12],
        ),
      ],
      [
        coverage(group, { kind: 'record', key: 'rule:sample-traps' }),
        coverage(firstRecord, {
          kind: 'record',
          key: 'hazard:collapsing-roof',
        }),
      ],
      [
        record(
          'rule:sample-traps',
          'Sample Traps',
          'The traps presented here are alphabetical.',
        ),
      ],
    );

    expect(ledger.entries[0]).toMatchObject({
      regionType: 'group-intro',
      classification: 'record:rule:sample-traps',
    });
  });

  it('classifies table preface prose before table rows', () => {
    const table = item({
      text: 'Damage Severity by Level',
      lineIndex: 0,
      structure: 'table-caption',
      tier: 'leaf',
    });
    const ledger = buildSourceRegionLedger(
      [
        page(
          [
            'Damage Severity by Level',
            'Use this table to judge trap damage.',
            'Character Level Setback Dangerous Deadly',
          ],
          [12, 9.8, 8.9],
        ),
      ],
      [
        coverage(table, {
          kind: 'record',
          key: 'table:damage-severity-by-level',
        }),
      ],
      [
        record(
          'table:damage-severity-by-level',
          'Damage Severity by Level',
          'Use this table to judge trap damage.',
        ),
      ],
    );

    expect(ledger.entries[0]).toMatchObject({
      regionType: 'table-preface',
      classification: 'record:table:damage-severity-by-level',
    });
  });

  it('handles adjacent records without creating orphan prose', () => {
    const first = item({ text: 'First Rule', lineIndex: 0 });
    const second = item({ text: 'Second Rule', lineIndex: 2 });
    const ledger = buildSourceRegionLedger(
      [
        page(
          ['First Rule', 'First body.', 'Second Rule', 'Second body.'],
          [12, 9.8, 12, 9.8],
        ),
      ],
      [
        coverage(first, { kind: 'record', key: 'rule:first-rule' }),
        coverage(second, { kind: 'record', key: 'rule:second-rule' }),
      ],
      [
        record('rule:first-rule', 'First Rule', 'First body.'),
        record('rule:second-rule', 'Second Rule', 'Second body.'),
      ],
    );

    expect(ledger.summary.unrepresented).toBe(0);
    expect(ledger.entries.map((entry) => entry.classification)).toEqual([
      'record:rule:first-rule',
      'record:rule:second-rule',
    ]);
  });

  it('allows prose intentionally ignored with a specific reason', () => {
    const note = item({ text: 'Designer Note', lineIndex: 0 });
    const ledger = buildSourceRegionLedger(
      [
        page(
          ['Designer Note', 'This note is outside the import scope.'],
          [18, 9.8],
        ),
      ],
      [coverage(note, { kind: 'ignored', reason: 'designer-note' })],
      [],
    );

    expect(ledger.entries[0]).toMatchObject({
      classification: 'intentionally-ignored:designer-note',
      ignoreReason: 'designer-note',
    });
    expect(() => assertSourceRegionLedger(ledger)).not.toThrow();
  });

  it('fails when prose is hidden behind a broad structural ignore', () => {
    const section = item({ text: 'Group', lineIndex: 0 });
    const ledger = buildSourceRegionLedger(
      [page(['Group', 'This prose has no concrete owner.'], [18, 9.8])],
      [coverage(section, { kind: 'ignored', reason: 'document-structure' })],
      [],
    );

    expect(ledger.summary.unrepresented).toBe(1);
    expect(() => assertSourceRegionLedger(ledger)).toThrow(
      SourceRegionLedgerError,
    );
  });
});
