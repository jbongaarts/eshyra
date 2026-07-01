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

    // The table-cell-height row is a real table row, already owned by the
    // `table:` record — it must not also surface as a ledger entry.
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      regionType: 'table-preface',
      classification: 'record:table:damage-severity-by-level',
    });
  });

  it('gives a sidebar heading a ledger entry for its table-cell-height body prose (eshyra-5c7f)', () => {
    // Sidebar/callout box body text renders in the same h≈8.9 table-cell band
    // as real table rows, so a heading immediately followed by sidebar prose
    // is classified `structure: 'table-caption'` just like a heading
    // immediately followed by a real table (see `sourceInventory.ts`). Unlike
    // a real table caption, a sidebar has no `table:` record owning that
    // "row" data — it IS the sidebar's own body — so it must not be skipped
    // as table-row noise the way the previous test's genuine table row is.
    const sidebar = item({
      text: 'Sacred Plants and Wood',
      lineIndex: 0,
      structure: 'table-caption',
      tier: 'sidebar',
    });
    const ledger = buildSourceRegionLedger(
      [
        page(
          [
            'Sacred Plants and Wood',
            'A druid holds certain plants to be sacred.',
          ],
          [10.8, 8.9],
        ),
      ],
      [
        coverage(sidebar, {
          kind: 'record',
          key: 'rule:druid-sacred-plants-and-wood',
        }),
      ],
      [
        record(
          'rule:druid-sacred-plants-and-wood',
          'Sacred Plants and Wood',
          'A druid holds certain plants to be sacred.',
        ),
      ],
    );

    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      regionType: 'record-body',
      classification: 'record:rule:druid-sacred-plants-and-wood',
      targetKey: 'rule:druid-sacred-plants-and-wood',
    });
    expect(ledger.entries[0].normalizedCharCount).toBeGreaterThan(0);
  });

  it('prefers the section-slug match when every candidate shares the heading slug (eshyra-erf5.6)', () => {
    // Every class has an identically worded "Ability Score Improvement"
    // feature, so a document-wide content search matches all of them and
    // every candidate key ends with `:ability-score-improvement`. Only the
    // owning section (here: Cleric) distinguishes them; the section-slug
    // match must win even though feature:barbarian:... sorts first.
    const boilerplate =
      'When you reach 4th level, you can increase one ability score of your choice by 2.';
    const heading = item({
      text: 'Ability Score Improvement',
      lineIndex: 0,
      section: 'Cleric',
    });
    const ledger = buildSourceRegionLedger(
      [page(['Ability Score Improvement', boilerplate], [12, 9.8])],
      [
        coverage(heading, {
          kind: 'record',
          key: 'feature:cleric:ability-score-improvement',
        }),
      ],
      [
        record(
          'feature:barbarian:ability-score-improvement',
          'Ability Score Improvement',
          boilerplate,
        ),
        record(
          'feature:bard:ability-score-improvement',
          'Ability Score Improvement',
          boilerplate,
        ),
        record(
          'feature:cleric:ability-score-improvement',
          'Ability Score Improvement',
          boilerplate,
        ),
      ],
    );

    const body = ledger.entries.find(
      (entry) => entry.normalizedCharCount > 0,
    );
    expect(body).toMatchObject({
      classification: 'record:feature:cleric:ability-score-improvement',
      targetKey: 'feature:cleric:ability-score-improvement',
    });
    expect(body?.contentMatch).toBeUndefined();
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

  it('gives a table-rows-only continuation page an explicit entry keyed to the owning table record (eshyra-erf5.5)', () => {
    // Mirrors table:norse-deities: rows continue onto a page with no heading
    // at all. The run must produce one explicit entry spanning both pages so
    // neither page is left with zero ledger accounting.
    const caption = item({
      text: 'Example Deities',
      lineIndex: 0,
      structure: 'table-caption',
      tier: 'leaf',
    });
    const pages: PageText[] = [
      {
        pageNumber: 3,
        lines: ['Example Deities', 'Odin, god of knowledge', 'Aegir, god of the sea'],
        lineHeights: [12, 8.9, 8.9],
        lineGaps: [null, 10, 10],
      },
      {
        pageNumber: 4,
        lines: ['Frigga, goddess of birth', 'Uller, god of hunting'],
        lineHeights: [8.9, 8.9],
        lineGaps: [null, 10],
      },
    ];
    const ledger = buildSourceRegionLedger(
      pages,
      [coverage(caption, { kind: 'record', key: 'table:example-deities' })],
      [
        record(
          'table:example-deities',
          'Example Deities',
          'Odin, god of knowledge Aegir, god of the sea Frigga, goddess of birth Uller, god of hunting',
        ),
      ],
    );

    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      regionType: 'table-rows',
      pageStart: 3,
      pageEnd: 4,
      classification: 'record:table:example-deities',
      targetKey: 'table:example-deities',
    });
    expect(ledger.summary.unaccountedPages).toEqual([]);
    expect(() => assertSourceRegionLedger(ledger)).not.toThrow();
  });

  it('accounts a rows-only page under a non-table caption via the table-rows-emitted-as-records reason (eshyra-erf5.5)', () => {
    // Mirrors p69: the Adventuring Gear price list's rows (and its embedded
    // sub-group captions, which render at cell height) fill a page whose
    // content is emitted as equipment records, not a table record.
    const caption = item({
      text: 'Adventuring Gear',
      lineIndex: 0,
      structure: 'table-caption',
      tier: 'leaf',
    });
    const pages: PageText[] = [
      {
        pageNumber: 3,
        lines: ['Adventuring Gear', 'Abacus 2 gp 2 lb.', 'Ammunition', 'Arrows (20) 1 gp 1 lb.'],
        lineHeights: [12, 8.9, 8.9, 8.9],
        lineGaps: [null, 10, 10, 10],
      },
    ];
    const ledger = buildSourceRegionLedger(
      pages,
      [coverage(caption, { kind: 'record', key: 'rule:adventuring-gear' })],
      [record('rule:adventuring-gear', 'Adventuring Gear', 'intro prose')],
    );

    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      regionType: 'table-rows',
      classification: 'intentionally-ignored:table-rows-emitted-as-records',
      ignoreReason: 'table-rows-emitted-as-records',
    });
    expect(ledger.entries[0].targetKey).toBeUndefined();
    expect(ledger.summary.unaccountedPages).toEqual([]);
    expect(() => assertSourceRegionLedger(ledger)).not.toThrow();
  });

  it('fails closed when a rows-only page has no accounted owning structure (eshyra-erf5.5)', () => {
    const pages: PageText[] = [
      {
        pageNumber: 3,
        lines: ['Orphan row one', 'Orphan row two'],
        lineHeights: [8.9, 8.9],
        lineGaps: [null, 10],
      },
    ];
    const ledger = buildSourceRegionLedger(pages, [], []);

    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      regionType: 'table-rows',
      classification: 'unrepresented',
    });
    expect(() => assertSourceRegionLedger(ledger)).toThrow(
      SourceRegionLedgerError,
    );
  });

  it('emits no table-rows entry when the run’s pages already carry other ledger entries (eshyra-erf5.5)', () => {
    // Same shape as the table-preface test: preface prose gives the page an
    // entry, so the caption-owned rows stay accounted by coverage alone.
    const table = item({
      text: 'Damage Severity by Level',
      lineIndex: 0,
      structure: 'table-caption',
      tier: 'leaf',
    });
    const ledger = buildSourceRegionLedger(
      [
        page(
          ['Damage Severity by Level', 'Preface prose.', 'Setback 1d10'],
          [12, 9.8, 8.9],
        ),
      ],
      [coverage(table, { kind: 'record', key: 'table:damage-severity' })],
      [
        record(
          'table:damage-severity',
          'Damage Severity by Level',
          'Preface prose. Setback 1d10',
        ),
      ],
    );

    expect(
      ledger.entries.filter((entry) => entry.regionType === 'table-rows'),
    ).toHaveLength(0);
    expect(ledger.summary.unaccountedPages).toEqual([]);
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

  it('fails when prose is hidden behind table-row or group-heading ignore reasons that require representation', () => {
    const gear = item({
      text: 'Adventuring Gear',
      lineIndex: 0,
      section: 'Equipment',
    });
    const ledger = buildSourceRegionLedger(
      [
        page(
          [
            'Adventuring Gear',
            'This section describes items that have special rules.',
          ],
          [18, 9.8],
        ),
      ],
      [
        coverage(gear, {
          kind: 'ignored',
          reason: 'table-rows-emitted-as-records',
        }),
      ],
      [],
    );

    expect(ledger.summary.unrepresented).toBe(1);
    expect(ledger.entries[0]).toMatchObject({
      classification: 'unrepresented',
      ignoreReason: 'table-rows-emitted-as-records',
    });
    expect(() => assertSourceRegionLedger(ledger)).toThrow(
      SourceRegionLedgerError,
    );
  });

  it('splits equipment intro prose from following item descriptions so both need concrete records', () => {
    const gear = item({
      text: 'Adventuring Gear',
      lineIndex: 0,
      section: 'Equipment',
    });
    const ledger = buildSourceRegionLedger(
      [
        page(
          [
            'Adventuring Gear',
            'This section describes items that have special rules or require further explanation. Acid. As an action, you can splash it.',
          ],
          [18, 9.8],
        ),
      ],
      [coverage(gear, { kind: 'record', key: 'rule:adventuring-gear' })],
      [
        record(
          'rule:adventuring-gear',
          'Adventuring Gear',
          'This section describes items that have special rules or require further explanation.',
        ),
        {
          kind: 'equipment',
          key: 'equipment:acid-vial',
          name: 'Acid (vial)',
          data: { description: 'Acid. As an action, you can splash it.' },
        },
      ],
    );

    expect(ledger.entries.map((entry) => entry.classification)).toEqual([
      'record:rule:adventuring-gear',
      'record:equipment:acid-vial',
    ]);
  });
});
