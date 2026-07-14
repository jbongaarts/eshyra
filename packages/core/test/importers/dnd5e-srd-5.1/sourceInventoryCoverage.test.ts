/**
 * Tests for the SRD source-coverage evaluator (eshyra-4a7.1.2).
 *
 * The evaluator is the gate half of the source-coverage pair: it takes the
 * typography-derived inventory (sourceInventory.ts) plus the emitted records
 * and decides, for every source item, exactly one accounting status. Anything
 * left `unaccounted` must fail the import — that fail-closed posture is the
 * whole point (eshyra-4a7.1).
 */

import { describe, expect, it } from 'vitest';
import type { SourceInventoryItem } from '../../../scripts/importers/dnd5e-srd-5.1/sourceInventory.js';
import {
  assertSourceCoverage,
  buildSourceCoverageReport,
  childOfRule,
  evaluateSourceCoverage,
  formatCoverageStatus,
  ignoreRule,
  knownGapRule,
  recordRule,
  SourceInventoryCoverageError,
  SRD_5_1_COVERAGE_RULES,
  taxonomyRule,
} from '../../../scripts/importers/dnd5e-srd-5.1/sourceInventoryCoverage.js';

function item(overrides: Partial<SourceInventoryItem>): SourceInventoryItem {
  return {
    page: 1,
    lineIndex: 0,
    text: 'Placeholder',
    tier: 'leaf',
    structure: 'heading',
    section: null,
    context: null,
    ...overrides,
  };
}

const records = [
  { kind: 'creature', key: 'creature:aboleth', name: 'Aboleth' },
  {
    kind: 'feature',
    key: 'feature:fighter:improved-critical',
    name: 'Improved Critical',
  },
  {
    kind: 'feature',
    key: 'feature:paladin:improved-critical',
    name: 'Improved Critical',
  },
] as const;

describe('evaluateSourceCoverage — name auto-match', () => {
  it('records exactly one provenance decision and keeps curated ownership distinct from auto-match', () => {
    const source = [item({ text: 'Aboleth' })];
    const automatic = evaluateSourceCoverage(source, records, []);
    const curated = evaluateSourceCoverage(source, records, [
      recordRule('creature:aboleth', () => true),
    ]);
    expect(automatic[0]?.resolution).toEqual({
      kind: 'unique-normalized-name',
      normalizedName: 'aboleth',
      ownerKey: 'creature:aboleth',
    });
    expect(curated[0]?.resolution).toEqual({
      kind: 'curated-record',
      ownerKey: 'creature:aboleth',
    });
    expect(() => assertSourceCoverage(automatic)).not.toThrow();
    expect(() => assertSourceCoverage(curated)).not.toThrow();
  });

  it('matches an item to a record by normalized name', () => {
    const entries = evaluateSourceCoverage(
      [item({ text: 'Aboleth', structure: 'stat-block' })],
      records,
      [],
    );
    expect(entries).toEqual([
      expect.objectContaining({
        status: { kind: 'record', key: 'creature:aboleth' },
      }),
    ]);
  });

  it('matches case-insensitively and normalizes curly quotes', () => {
    const entries = evaluateSourceCoverage(
      [item({ text: 'ABOLETH' })],
      [{ kind: 'creature', key: 'creature:aboleth', name: 'Aboleth' }],
      [],
    );
    expect(entries[0].status).toEqual({
      kind: 'record',
      key: 'creature:aboleth',
    });
    const curly = evaluateSourceCoverage(
      [item({ text: 'Hunter’s Prey' })],
      [
        {
          kind: 'feature',
          key: 'feature:ranger:hunters-prey',
          name: "Hunter's Prey",
        },
      ],
      [],
    );
    expect(curly[0].status).toEqual({
      kind: 'record',
      key: 'feature:ranger:hunters-prey',
    });
  });

  it('surfaces duplicate record names instead of choosing an arbitrary key', () => {
    const entries = evaluateSourceCoverage(
      [item({ text: 'Improved Critical' })],
      records,
      [],
    );
    expect(entries[0].status).toEqual({
      kind: 'ambiguous',
      candidateKeys: [
        'feature:fighter:improved-critical',
        'feature:paladin:improved-critical',
      ],
    });
  });

  it('attributes stat-block section headings to the active stat block', () => {
    const entries = evaluateSourceCoverage(
      [
        item({
          text: 'Aboleth',
          structure: 'stat-block',
          section: 'Monsters',
        }),
        item({
          text: 'Actions',
          tier: 'sidebar',
          section: 'Monsters',
          context: 'Aboleth',
          lineIndex: 1,
        }),
        item({
          text: 'Legendary Actions',
          tier: 'sidebar',
          section: 'Monsters',
          context: 'Actions',
          lineIndex: 2,
        }),
      ],
      [
        { kind: 'creature', key: 'creature:aboleth', name: 'Aboleth' },
        { kind: 'rule', key: 'rule:actions', name: 'Actions' },
        {
          kind: 'rule',
          key: 'rule:legendary-actions',
          name: 'Legendary Actions',
        },
      ],
      [],
    );
    expect(entries.map((entry) => entry.status)).toEqual([
      { kind: 'record', key: 'creature:aboleth' },
      { kind: 'child-of', key: 'creature:aboleth' },
      { kind: 'child-of', key: 'creature:aboleth' },
    ]);
  });
});

describe('evaluateSourceCoverage — rules and defaults', () => {
  it('maps colliding Appendix MM-B stat blocks to their creature records', () => {
    const inventory = [
      item({
        page: 395,
        text: 'Acolyte',
        structure: 'stat-block',
        section: 'Appendix MM-B: Nonplayer Characters',
      }),
      item({
        page: 398,
        text: 'Druid',
        structure: 'stat-block',
        section: 'Appendix MM-B: Nonplayer Characters',
      }),
    ];
    const collisionRecords = [
      { kind: 'background', key: 'background:acolyte', name: 'Acolyte' },
      { kind: 'class', key: 'class:druid', name: 'Druid' },
      { kind: 'creature', key: 'creature:acolyte', name: 'Acolyte' },
      { kind: 'creature', key: 'creature:druid', name: 'Druid' },
    ];

    expect(
      evaluateSourceCoverage(
        inventory,
        collisionRecords,
        SRD_5_1_COVERAGE_RULES,
      ).map((entry) => entry.status),
    ).toEqual([
      { kind: 'record', key: 'creature:acolyte' },
      { kind: 'record', key: 'creature:druid' },
    ]);
  });

  it('accounts for the complete Half-Dragon Template region as records', () => {
    const inventory = [
      item({
        page: 320,
        text: 'Half-Dragon Template',
        tier: 'subsection',
        section: 'Monsters',
        context: 'Actions',
      }),
      item({
        page: 320,
        lineIndex: 87,
        text: 'Color Damage Resistance',
        tier: null,
        structure: 'table-shape',
        section: 'Monsters',
        context: 'Half-Dragon Template',
      }),
      item({
        page: 321,
        lineIndex: 8,
        text: 'Optional',
        tier: null,
        structure: 'table-shape',
        section: 'Monsters',
        context: 'Half-Dragon Template',
      }),
    ];
    const templateRecords = [
      {
        kind: 'rule',
        key: 'rule:half-dragon-template',
        name: 'Half-Dragon Template',
      },
      {
        kind: 'table',
        key: 'table:half-dragon-damage-resistance',
        name: 'Half-Dragon Damage Resistance',
      },
      {
        kind: 'table',
        key: 'table:half-dragon-breath-weapon',
        name: 'Half-Dragon Breath Weapon',
      },
    ];

    expect(
      evaluateSourceCoverage(
        inventory,
        templateRecords,
        SRD_5_1_COVERAGE_RULES,
      ).map((entry) => entry.status),
    ).toEqual([
      { kind: 'record', key: 'rule:half-dragon-template' },
      { kind: 'record', key: 'table:half-dragon-damage-resistance' },
      { kind: 'record', key: 'table:half-dragon-breath-weapon' },
    ]);
  });

  it('applies ignore, known-gap, and child-of rules in list order ahead of the auto-match', () => {
    const inventory = [
      // eshyra-erf5.1: a curated rule outranks the auto-match even though a
      // same-named record ("creature:aboleth") exists.
      item({ text: 'Aboleth' }),
      item({ text: 'Wizard Spells', lineIndex: 1 }),
      item({ text: 'Figurine of Wondrous Power', lineIndex: 2 }),
      item({
        text: 'd10 Damage Type Gem',
        lineIndex: 3,
        structure: 'table-shape',
        tier: null,
      }),
    ];
    const entries = evaluateSourceCoverage(inventory, records, [
      ignoreRule('curated-override', (i) => i.text === 'Aboleth'),
      ignoreRule('spell-list-header', (i) => / Spells$/.test(i.text)),
      knownGapRule(
        'eshyra-4a7.8',
        (i) => i.text === 'Figurine of Wondrous Power',
      ),
      childOfRule(
        'magic-item:ring-of-resistance',
        (i) => i.structure === 'table-shape',
      ),
    ]);
    expect(entries.map((e) => e.status)).toEqual([
      { kind: 'ignored', reason: 'curated-override' },
      { kind: 'ignored', reason: 'spell-list-header' },
      { kind: 'known-gap', beadId: 'eshyra-4a7.8' },
      { kind: 'child-of', key: 'magic-item:ring-of-resistance' },
    ]);
  });

  it('accounts for a heading only when emitted creatures carry its taxonomy path', () => {
    const angels = item({
      page: 261,
      text: 'Angels',
      tier: 'subsection',
      section: 'Monsters',
    });
    const rule = taxonomyRule(
      ['Angels'],
      (candidate) => candidate.text === 'Angels',
    );
    const covered = evaluateSourceCoverage(
      [angels],
      [
        {
          kind: 'creature',
          key: 'creature:deva',
          name: 'Deva',
          data: { familyPath: ['Angels'] },
        },
      ],
      [rule],
    );
    expect(covered[0].status).toEqual({
      kind: 'taxonomy',
      field: 'creature.familyPath',
      path: ['Angels'],
    });

    const missing = evaluateSourceCoverage(
      [angels],
      [{ kind: 'creature', key: 'creature:deva', name: 'Deva', data: {} }],
      [rule],
    );
    expect(missing[0].status).toEqual({ kind: 'unaccounted' });
  });

  it('auto-ignores chapter and section tiers as document structure when unmatched', () => {
    const entries = evaluateSourceCoverage(
      [
        item({ text: 'Races', tier: 'chapter' }),
        item({ text: 'Class Features', tier: 'section', lineIndex: 1 }),
      ],
      [],
      [],
    );
    expect(entries.map((e) => e.status)).toEqual([
      { kind: 'ignored', reason: 'document-structure' },
      { kind: 'ignored', reason: 'document-structure' },
    ]);
  });

  it('maps a renamed heading to its record via recordRule', () => {
    // The SRD prints "Lightfoot" while the emitted record is named
    // "Lightfoot Halfling" — auto-match misses, the rule claims it.
    const entries = evaluateSourceCoverage(
      [item({ text: 'Lightfoot' })],
      [
        {
          kind: 'ancestry',
          key: 'ancestry:lightfoot-halfling',
          name: 'Lightfoot Halfling',
        },
      ],
      [
        recordRule(
          'ancestry:lightfoot-halfling',
          (i) => i.text === 'Lightfoot',
        ),
      ],
    );
    expect(entries[0].status).toEqual({
      kind: 'record',
      key: 'ancestry:lightfoot-halfling',
    });
  });

  it('lets an explicit recordRule outrank the name auto-match (duplicate source captions)', () => {
    // The SRD prints "Draconic Ancestry" twice — the Dragonborn table (p5,
    // Races) and the Sorcerer Draconic Bloodline copy (p44). Both captions
    // normalize to the same name, so the auto-match alone would claim both
    // for the p5 record; the explicit per-chapter record rules map each
    // caption to its own emitted record.
    const tableRecords = [
      {
        kind: 'table',
        key: 'table:draconic-ancestry',
        name: 'Draconic Ancestry',
      },
      {
        kind: 'table',
        key: 'table:draconic-bloodline-draconic-ancestry',
        name: 'Draconic Bloodline Draconic Ancestry',
      },
    ] as const;
    const inventory = [
      item({
        text: 'Draconic Ancestry',
        page: 5,
        structure: 'table-caption',
        section: 'Races',
      }),
      item({
        text: 'Draconic Ancestry',
        page: 44,
        structure: 'table-caption',
        section: 'Sorcerer',
      }),
    ];
    const entries = evaluateSourceCoverage(inventory, tableRecords, [
      recordRule(
        'table:draconic-ancestry',
        (i) => i.section === 'Races' && i.text === 'Draconic Ancestry',
      ),
      recordRule(
        'table:draconic-bloodline-draconic-ancestry',
        (i) => i.section === 'Sorcerer' && i.text === 'Draconic Ancestry',
      ),
    ]);
    expect(entries.map((e) => e.status)).toEqual([
      { kind: 'record', key: 'table:draconic-ancestry' },
      { kind: 'record', key: 'table:draconic-bloodline-draconic-ancestry' },
    ]);
  });

  it('lets non-record rules outrank the auto-match, first rule in list order winning', () => {
    // eshyra-erf5.1: a curated rule is more precise than the bare-name
    // heuristic and must win even when a record of the same name exists —
    // otherwise a same-named-but-unrelated record can silently swallow a
    // source item a curated rule already classifies (the p78 Skills-caption
    // "Strength"/"Dexterity"/... headings vs the real per-ability rule
    // records of the same name). Multiple matching rules resolve first-match
    // wins, same as record-type rules.
    const entries = evaluateSourceCoverage(
      [item({ text: 'Aboleth' })],
      records,
      [
        ignoreRule('would-shadow', (i) => i.text === 'Aboleth'),
        knownGapRule('eshyra-0000', (i) => i.text === 'Aboleth'),
      ],
    );
    expect(entries[0].status).toEqual({
      kind: 'ignored',
      reason: 'would-shadow',
    });
  });

  it('leaves unmatched leaf/sidebar/table items unaccounted', () => {
    const entries = evaluateSourceCoverage(
      [item({ text: 'Mystery Heading' })],
      records,
      [],
    );
    expect(entries[0].status).toEqual({ kind: 'unaccounted' });
  });

  it('sorts entries by page then lineIndex regardless of input order', () => {
    const entries = evaluateSourceCoverage(
      [
        item({ text: 'B', page: 2, lineIndex: 0 }),
        item({ text: 'A', page: 1, lineIndex: 5 }),
        item({ text: 'C', page: 1, lineIndex: 2 }),
      ],
      [],
      [ignoreRule('test', () => true)],
    );
    expect(entries.map((e) => e.item.text)).toEqual(['C', 'A', 'B']);
  });
});

describe('assertSourceCoverage', () => {
  it('throws SourceInventoryCoverageError naming every unaccounted item with provenance', () => {
    const entries = evaluateSourceCoverage(
      [
        item({
          text: 'Mystery Heading',
          page: 42,
          lineIndex: 7,
          section: 'Magic Items',
        }),
        item({ text: 'Aboleth', page: 261 }),
      ],
      records,
      [],
    );
    expect(() => assertSourceCoverage(entries)).toThrow(
      SourceInventoryCoverageError,
    );
    try {
      assertSourceCoverage(entries);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('Mystery Heading');
      expect(message).toContain('p42');
      expect(message).toContain('Magic Items');
      expect(message).not.toContain('Aboleth');
    }
  });

  it('passes silently when every item is accounted for', () => {
    const entries = evaluateSourceCoverage(
      [item({ text: 'Aboleth' })],
      records,
      [],
    );
    expect(() => assertSourceCoverage(entries)).not.toThrow();
  });

  it('rejects stat-block inventory entries mapped to non-stat records', () => {
    const entries = evaluateSourceCoverage(
      [
        item({
          text: 'Acolyte',
          structure: 'stat-block',
          section: 'Appendix MM-B: Nonplayer Characters',
        }),
      ],
      [{ kind: 'background', key: 'background:acolyte', name: 'Acolyte' }],
      [],
    );

    expect(() => assertSourceCoverage(entries)).toThrow(
      /record:background:acolyte/i,
    );
  });

  it('allows only explicitly named stat-block exception reasons', () => {
    const entries = evaluateSourceCoverage(
      [item({ text: 'Fixture Row', structure: 'stat-block' })],
      [],
      [ignoreRule('fixture-body', () => true)],
    );

    expect(() => assertSourceCoverage(entries)).toThrow(/fixture-body/i);
    expect(() =>
      assertSourceCoverage(entries, {
        statBlockExceptionReasons: ['fixture-body'],
      }),
    ).not.toThrow();
  });
});

describe('ambiguous-match diagnostic', () => {
  it('retains provenance and reports every candidate without a winner', () => {
    // records has two 'Improved Critical' features; fighter wins lexicographically.
    const report = buildSourceCoverageReport(
      evaluateSourceCoverage(
        [item({ text: 'Improved Critical' })],
        records,
        [],
      ),
      records,
    );
    const entries = evaluateSourceCoverage(
      [item({ text: 'Improved Critical' })],
      records,
      [],
    );
    expect(entries[0].resolution).toEqual({
      kind: 'ambiguous-normalized-name',
      normalizedName: 'improved critical',
      candidateKeys: [
        'feature:fighter:improved-critical',
        'feature:paladin:improved-critical',
      ],
    });
    expect(report.diagnostics.recordNameCollisions[0]).toMatchObject({
      normalizedName: 'improved critical',
      candidateKeys: [
        'feature:fighter:improved-critical',
        'feature:paladin:improved-critical',
      ],
      unresolved: true,
    });
    expect(
      report.diagnostics.recordNameCollisions[0]?.occurrences,
    ).toHaveLength(1);
    expect(report.diagnostics.recordNameCollisions[0]).not.toHaveProperty(
      'winnerKey',
    );
    expect(report.diagnostics.unresolvedOwnership[0]?.category).toBe(
      'unresolved-owner',
    );
  });

  it('reports collapsed source items when multiple source items auto-match the same key', () => {
    const singleRecord = [
      {
        kind: 'feature',
        key: 'feature:fighter:improved-critical',
        name: 'Improved Critical',
      },
    ];
    const entries = evaluateSourceCoverage(
      [
        item({ text: 'Improved Critical', page: 25, lineIndex: 0 }),
        item({ text: 'Improved Critical', page: 42, lineIndex: 3 }),
        item({ text: 'Improved Critical', page: 70, lineIndex: 1 }),
      ],
      singleRecord,
      [],
    );
    const report = buildSourceCoverageReport(entries, singleRecord);
    expect(report.diagnostics.duplicateSourceText[0]).toMatchObject({
      normalizedText: 'improved critical',
      category: 'auto-collapsed',
      ownerKeys: ['feature:fighter:improved-critical'],
      reasonCodes: ['auto-collapsed'],
    });
    expect(report.diagnostics.suspiciousOwnership[0]?.occurrences).toHaveLength(
      3,
    );
  });

  it('excludes recordRule-resolved entries from collapsed source items', () => {
    // An explicit recordRule maps "Lightfoot" -> ancestry:lightfoot-halfling.
    // keyByName has no entry for "lightfoot" (the record name is "Lightfoot
    // Halfling"), so these entries are not auto-matched and must not appear
    // in collapsedSourceItems even with two source items.
    const lightfootRecord = {
      kind: 'ancestry',
      key: 'ancestry:lightfoot-halfling',
      name: 'Lightfoot Halfling',
    };
    const entries = evaluateSourceCoverage(
      [
        item({ text: 'Lightfoot', lineIndex: 0 }),
        item({ text: 'Lightfoot', lineIndex: 1 }),
      ],
      [lightfootRecord],
      [
        recordRule(
          'ancestry:lightfoot-halfling',
          (i) => i.text === 'Lightfoot',
        ),
      ],
    );
    const report = buildSourceCoverageReport(entries, [lightfootRecord]);
    expect(report.diagnostics.duplicateSourceText[0]?.category).toBe(
      'same-owner-explicit',
    );
    expect(report.diagnostics.suspiciousOwnership).toEqual([]);
  });

  it('reports empty ambiguous when all record names are unique and each item matches once', () => {
    const uniqueRecords = [
      { kind: 'creature', key: 'creature:aboleth', name: 'Aboleth' },
    ];
    const entries = evaluateSourceCoverage(
      [item({ text: 'Aboleth' })],
      uniqueRecords,
      [],
    );
    const report = buildSourceCoverageReport(entries, uniqueRecords);
    expect(report.diagnostics).toEqual({
      recordNameCollisions: [],
      duplicateSourceText: [],
      suspiciousOwnership: [],
      unresolvedOwnership: [],
    });
  });

  it('shadowedRecords is sorted by normalizedName', () => {
    const multiDupeRecords = [
      { kind: 'feature', key: 'feature:barbarian:rage', name: 'Rage' },
      { kind: 'feature', key: 'feature:monk:rage', name: 'Rage' },
      { kind: 'feature', key: 'feature:fighter:critical', name: 'Critical' },
      { kind: 'feature', key: 'feature:paladin:critical', name: 'Critical' },
    ];
    const report = buildSourceCoverageReport(
      evaluateSourceCoverage([], multiDupeRecords, []),
      multiDupeRecords,
    );
    expect(
      report.diagnostics.recordNameCollisions.map((r) => r.normalizedName),
    ).toEqual(['critical', 'rage']);
  });

  it('duplicate source groups are sorted by normalized text and coordinates', () => {
    const recs = [
      { kind: 'feature', key: 'feature:barbarian:strike', name: 'Strike' },
      { kind: 'feature', key: 'feature:barbarian:rage', name: 'Rage' },
    ];
    const entries = evaluateSourceCoverage(
      [
        item({ text: 'Strike', page: 1, lineIndex: 0 }),
        item({ text: 'Strike', page: 2, lineIndex: 0 }),
        item({ text: 'Rage', page: 3, lineIndex: 0 }),
        item({ text: 'Rage', page: 4, lineIndex: 0 }),
      ],
      recs,
      [],
    );
    const report = buildSourceCoverageReport(entries, recs);
    expect(
      report.diagnostics.duplicateSourceText.map((g) => g.normalizedText),
    ).toEqual(['rage', 'strike']);
  });
});

describe('coverage report serialization', () => {
  it('formats every status kind as a stable one-line string', () => {
    expect(
      formatCoverageStatus({ kind: 'record', key: 'creature:aboleth' }),
    ).toBe('record:creature:aboleth');
    expect(
      formatCoverageStatus({ kind: 'child-of', key: 'background:acolyte' }),
    ).toBe('child-of:background:acolyte');
    expect(
      formatCoverageStatus({
        kind: 'ambiguous',
        candidateKeys: ['equipment:shield', 'spell:shield'],
      }),
    ).toBe('ambiguous:equipment:shield|spell:shield');
    expect(
      formatCoverageStatus({
        kind: 'taxonomy',
        field: 'creature.familyPath',
        path: ['Dragons', 'Chromatic Dragons'],
      }),
    ).toBe('taxonomy:creature.familyPath:Dragons > Chromatic Dragons');
    expect(
      formatCoverageStatus({ kind: 'ignored', reason: 'front-matter' }),
    ).toBe('ignored:front-matter');
    expect(
      formatCoverageStatus({ kind: 'known-gap', beadId: 'eshyra-4a7.3' }),
    ).toBe('known-gap:eshyra-4a7.3');
    expect(formatCoverageStatus({ kind: 'unaccounted' })).toBe('unaccounted');
  });

  it('builds a report with rolled-up summary counts and reading-order entries', () => {
    const entries = evaluateSourceCoverage(
      [
        item({ text: 'Aboleth', page: 261 }),
        item({ text: 'Wizard Spells', page: 111 }),
        item({ text: 'Bard Spells', page: 105 }),
        item({ text: 'Figurine of Wondrous Power', page: 221 }),
        item({ text: 'Mystery Heading', page: 999 }),
      ],
      records,
      [
        ignoreRule('spell-list-header', (i) => / Spells$/.test(i.text)),
        knownGapRule('eshyra-4a7.8', (i) => i.text.startsWith('Figurine')),
      ],
    );
    const report = buildSourceCoverageReport(entries, records);
    expect(report.summary).toEqual({
      record: 1,
      childOf: 0,
      ambiguous: 0,
      taxonomy: 0,
      structuredField: 0,
      ignored: { 'spell-list-header': 2 },
      knownGap: { 'eshyra-4a7.8': 1 },
      unaccounted: 1,
    });
    // The test records have two 'Improved Critical' features; one is shadowed.
    expect(report.diagnostics.recordNameCollisions[0]).toMatchObject({
      normalizedName: 'improved critical',
      candidateKeys: [
        'feature:fighter:improved-critical',
        'feature:paladin:improved-critical',
      ],
    });
    // Aboleth is the only auto-matched record item and appears once, so no
    // collapsed source items.
    expect(report.diagnostics.duplicateSourceText).toEqual([]);
    expect(report.entries.map((e) => `${e.page}:${e.status}`)).toEqual([
      '105:ignored:spell-list-header',
      '111:ignored:spell-list-header',
      '221:known-gap:eshyra-4a7.8',
      '261:record:creature:aboleth',
      '999:unaccounted',
    ]);
    // Entries carry the locator fields a reviewer needs.
    expect(report.entries[0]).toEqual({
      page: 105,
      lineIndex: 0,
      tier: 'leaf',
      structure: 'heading',
      text: 'Bard Spells',
      section: null,
      status: 'ignored:spell-list-header',
      resolution: { kind: 'curated-ignore', reason: 'spell-list-header' },
    });
  });
});
