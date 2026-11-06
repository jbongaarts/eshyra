import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractPdfText } from '../../../scripts/importers/dnd5e-srd-5.1/extract.js';
import { deriveEmbeddedTableSpliceDeclarations } from '../../../scripts/importers/dnd5e-srd-5.1/fieldProvenanceDeclarations.js';
import { parseConditions } from '../../../scripts/importers/dnd5e-srd-5.1/parseConditions.js';
import { assertReconstructionUsesOnlySourceTokens } from '../../../scripts/importers/dnd5e-srd-5.1/parseDocumentTables.js';
import { parseFeats } from '../../../scripts/importers/dnd5e-srd-5.1/parseFeats.js';
import {
  parseRules,
  removeTableCellLines,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseRules.js';
import {
  endsPrintedSentence,
  hasInteriorRemoval,
  joinParagraphsStrippingBullets,
} from '../../../scripts/importers/dnd5e-srd-5.1/proseComposition.js';
import { citedPages } from '../../../scripts/importers/dnd5e-srd-5.1/recordSourceAnchors.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import {
  classifyFieldPointer,
  type FieldProvenanceManifest,
  walkFieldPointers,
} from '../../../src/rules/fieldProvenance.js';
import type { RulesRecord } from '../../../src/rules/types.js';

/**
 * eshyra-o9bd.19.6.7.10 (audit lane A3, findings A3-F1 / A3-F2): the
 * composition / substitution class of the `source-prose` provenance claim.
 *
 * Invariant: a `source-prose` leaf differs from its cited extraction only by
 * whitespace / hyphenation / layout / glyph-encoding normalisation. Interior
 * removal, bullet joins with the glyph dropped, and invented characters need a
 * generated scoped declaration (or are restored). The Iron Flask cells, the ten
 * interior-splice records and the bullet-join records are the reproducer set.
 * This is NOT a universal literal-contiguity rule across extractions: column
 * flow and glyph encoding are accommodated (see the layout controls below).
 */

const root = process.cwd();
const packDir = join(
  root,
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);
const records = JSON.parse(
  readFileSync(join(packDir, 'records.json'), 'utf8'),
) as RulesRecord[];
const manifest = JSON.parse(
  readFileSync(join(packDir, 'field-provenance.json'), 'utf8'),
) as FieldProvenanceManifest;
const byKey = (key: string): RulesRecord => {
  const found = records.find((record) => record.key === key);
  if (found === undefined) throw new Error(`${key} missing`);
  return found;
};
const classOf = (kind: RulesRecord['kind'], key: string, pointer: string) =>
  classifyFieldPointer(manifest, kind, key, pointer);

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

describe('producers report composition (nothing hand-listed)', () => {
  it('hasInteriorRemoval: only a removal between two printed sentences counts', () => {
    const line = (text: string, kept: boolean) => ({ text, kept });
    expect(
      hasInteriorRemoval([
        line('One sentence.', true),
        line('TABLE ROW', false),
        line('Two sentence.', true),
      ]),
    ).toBe(true);
    // Trailing and leading removals leave one contiguous quotation.
    expect(
      hasInteriorRemoval([line('One.', true), line('TABLE ROW', false)]),
    ).toBe(false);
    expect(
      hasInteriorRemoval([line('TABLE ROW', false), line('One.', true)]),
    ).toBe(false);
    // Column-flow control: another table's cells interleave mid-sentence.
    expect(
      hasInteriorRemoval([
        line('Most people', true),
        line('TABLE ROW', false),
        line('can use simple weapons.', true),
      ]),
    ).toBe(false);
    expect(endsPrintedSentence('shows the most common DCs.')).toBe(true);
    expect(endsPrintedSentence('Most people')).toBe(false);
  });

  it('removeTableCellLines + parseRules: a table removed between paragraphs is reported, mid-sentence flow is not', () => {
    const lines = [
      'Alpha Rule',
      'Before the table.',
      'ROW ONE',
      'ROW TWO',
      'After the table.',
      'Beta Rule',
      'Most people',
      'CELL',
      'can use simple weapons.',
    ];
    const heights = [12, 9.8, 8.9, 8.9, 9.8, 12, 9.8, 8.9, 9.8];
    const pages = removeTableCellLines([
      { pageNumber: 1, lines, lineHeights: heights },
    ]);
    expect(pages[0].removedBefore).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    // Heading-tier fixture: use real tiered heights so the hierarchy path runs.
    const tiered: PageText = {
      pageNumber: 1,
      lines: [
        'Chapter Heading',
        'Alpha Rule',
        'Before the table.',
        'ROW ONE',
        'After the table.',
        'Beta Rule',
        'Most people',
        'CELL',
        'can use simple weapons.',
      ],
      lineHeights: [25.9, 13.9, 9.8, 8.9, 9.8, 13.9, 9.8, 8.9, 9.8],
    };
    const rules = parseRules(removeTableCellLines([tiered]));
    const alpha = rules.find((rule) => rule.name === 'Alpha Rule');
    const beta = rules.find((rule) => rule.name === 'Beta Rule');
    expect(alpha?.composedBy).toEqual(['interior-removal']);
    expect(beta?.composedBy).toBeUndefined();
    expect(beta?.text).toBe('Most people can use simple weapons.');
  });

  it('parseConditions: several joined bullets are a bullet-join; one bullet and prose are not', () => {
    const conditions = parseConditions([
      page(358, [
        'Blinded',
        "• A blinded creature can't see.",
        '• Attack rolls against the creature have advantage.',
        'Deafened',
        "• A deafened creature can't hear.",
        'Exhaustion',
        'Some special abilities cause exhaustion, as the table shows.',
        'Level Effect',
        '1 Disadvantage on ability checks',
        '2 Speed halved',
        'If an already exhausted creature suffers another effect, it worsens.',
      ]),
    ]);
    const get = (name: string) => conditions.find((c) => c.name === name);
    expect(get('Blinded')?.composedBy).toEqual(['bullet-join']);
    expect(get('Deafened')?.composedBy).toBeUndefined();
    expect(get('Exhaustion')?.composedBy).toEqual(['interior-removal']);
  });

  it('parseFeats: the Grappler bullets are a bullet-join', () => {
    const [grappler] = parseFeats([
      page(72, [
        'Grappler',
        'Prerequisite: Strength 13 or higher',
        'You gain the following benefits:',
        '• You have advantage on attack rolls.',
        '• You can pin a creature.',
      ]),
    ]);
    expect(grappler.composedBy).toEqual(['bullet-join']);
    expect(joinParagraphsStrippingBullets(['• Only one.']).bulletJoin).toBe(
      false,
    );
  });

  it('the compiler derives one scoped source-derived declaration per cause set', () => {
    const declarations = deriveEmbeddedTableSpliceDeclarations(
      [
        {
          kind: 'condition',
          recordKey: 'condition:a',
          pointer: '/description',
          cause: 'bullet-join',
        },
        {
          kind: 'condition',
          recordKey: 'condition:b',
          pointer: '/description',
          cause: 'bullet-join',
        },
        {
          kind: 'condition',
          recordKey: 'condition:c',
          pointer: '/description',
          cause: 'interior-removal',
        },
      ],
      [],
    );
    expect(declarations).toHaveLength(2);
    const join = declarations.find((d) =>
      d.recordKeys?.includes('condition:a'),
    );
    expect(join?.recordKeys).toEqual(['condition:a', 'condition:b']);
    expect(join?.class).toBe('source-derived');
    expect(join?.reason).toMatch(/bullet glyphs removed/);
    const interior = declarations.find((d) =>
      d.recordKeys?.includes('condition:c'),
    );
    expect(interior?.reason).toMatch(/removed from the middle/);
  });
});

describe('substitution: reviewed reconstructions use only source tokens', () => {
  it('the old Iron Flask spec (invented leading zero) is rejected; the printed value is accepted', () => {
    const sourceLines = ['Empty', '1 50', 'Demon (type 1)', '51 54'];
    expect(() =>
      assertReconstructionUsesOnlySourceTokens(
        sourceLines,
        [
          ['01–50', 'Empty'],
          ['51–54', 'Demon (type 1)'],
        ],
        'Iron Flask',
      ),
    ).toThrow(/does not match its pinned source tokens/);
    expect(() =>
      assertReconstructionUsesOnlySourceTokens(
        sourceLines,
        [
          ['1–50', 'Empty'],
          ['51–54', 'Demon (type 1)'],
        ],
        'Iron Flask',
      ),
    ).not.toThrow();
  });

  it('table:iron-flask carries the printed 1-50, with no invented 01', () => {
    const rows = (byKey('table:iron-flask').data as { rows: string[][] }).rows;
    expect(rows[0]).toEqual(['1–50', 'Empty']);
    expect(rows.flat()).not.toContain('01–50');
  });
});

describe('reproducer set in the committed pack', () => {
  const interiorRules = [
    'rule:ability-checks',
    'rule:ability-scores-and-modifiers',
    'rule:expenses-lifestyle-expenses',
    'rule:half-dragon-template',
    'rule:hit-points',
    'rule:objects',
    'rule:services',
    'rule:skills',
    'rule:speed',
  ];
  const joinedConditions = [
    'blinded',
    'charmed',
    'frightened',
    'grappled',
    'invisible',
    'paralyzed',
    'petrified',
    'prone',
    'restrained',
    'stunned',
    'unconscious',
  ].map((name) => `condition:${name}`);

  it('each interior-splice record is source-derived, with a reason that names the cause', () => {
    for (const key of interiorRules)
      expect(classOf('rule', key, '/text'), key).toBe('source-derived');
    expect(classOf('condition', 'condition:exhaustion', '/description')).toBe(
      'source-derived',
    );
    const reasons = manifest.declarations
      .filter((d) => d.recordKeys?.includes('rule:objects'))
      .map((d) => d.reason);
    expect(reasons.join(' ')).toMatch(/removed from the middle/);
  });

  it('each bullet-join record is source-derived; single-bullet and column-flow controls stay source-prose', () => {
    for (const key of joinedConditions)
      expect(classOf('condition', key, '/description'), key).toBe(
        'source-derived',
      );
    expect(classOf('feat', 'feat:grappler', '/description')).toBe(
      'source-derived',
    );
    for (const key of [
      'condition:deafened',
      'condition:incapacitated',
      'condition:poisoned',
    ])
      expect(classOf('condition', key, '/description'), key).toBe(
        'source-prose',
      );
    // Mid-sentence column-flow interleaving of another table's cells is
    // layout, and the monk's printed bullets are kept: both stay verbatim.
    for (const [kind, key, pointer] of [
      ['rule', 'rule:weapon-proficiency', '/text'],
      ['rule', 'rule:improvised-weapons', '/text'],
      ['feature', 'feature:monk:martial-arts', '/description'],
    ] as const)
      expect(classOf(kind, key, pointer), key).toBe('source-prose');
  });

  it('no source-prose condition joins several bullets (generalised over the whole kind)', () => {
    for (const record of records.filter((r) => r.kind === 'condition')) {
      const data = record.data as { description: string; effects?: string[] };
      if (classOf('condition', record.key, '/description') !== 'source-prose')
        continue;
      const effects = data.effects ?? [];
      if (effects.length > 1)
        expect(data.description, record.key).not.toBe(effects.join(' '));
    }
  });
});

describe('source-level invariant: faithful modulo layout, against the importer extraction', () => {
  const norm = (value: string): string =>
    value
      .toLowerCase()
      .replace(/['‘’ʼ]/g, '')
      .replace(/[-‐‑‒–—−]+/g, '-')
      .replace(/-\s*/g, '')
      .replace(/[^a-z0-9•]+/g, ' ')
      .trim();
  const tokens = (value: string): string[] =>
    value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  let pageText: Map<number, string>;
  let pageTokens: Map<number, Set<string>>;
  beforeAll(async () => {
    const pages = await extractPdfText(
      new Uint8Array(
        readFileSync(
          join(root, 'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf'),
        ),
      ),
    );
    pageText = new Map(
      pages.map((p) => [p.pageNumber, norm(p.lines.join(' '))]),
    );
    pageTokens = new Map(
      pages.map((p) => [p.pageNumber, new Set(tokens(p.lines.join(' ')))]),
    );
  }, 60_000);

  const citedHaystack = (record: RulesRecord): string =>
    [
      ...new Set(
        citedPages(record.provenance.locator).flatMap((p) => [p, p + 1]),
      ),
    ]
      .sort((a, b) => a - b)
      .map((p) => pageText.get(p) ?? '')
      .join(' ');

  /**
   * Layout-only residuals: another table's cells interleave MID-SENTENCE in the
   * extraction order of a column (Weapon Proficiency: "Most people / [armor
   * table cells] / can use simple weapons"; Improvised Weapons: "any object you
   * can / [weapon table cells] / wield in one or two hands"). The printed prose
   * is one contiguous passage; the producer deliberately reports no splice.
   * Each exemption is verified to be needed below, so none can go stale.
   */
  const COLUMN_FLOW_LAYOUT = new Set([
    'rule:weapon-proficiency',
    'rule:improvised-weapons',
  ]);

  const proseLeaves = (kinds: readonly string[]) => {
    const out: { record: RulesRecord; pointer: string; value: string }[] = [];
    for (const record of records) {
      if (!kinds.includes(record.kind)) continue;
      walkFieldPointers(record.data, (pointer, value, actual) => {
        if (typeof value !== 'string' || norm(value).length < 4) return;
        if (classOf(record.kind, record.key, pointer) !== 'source-prose')
          return;
        out.push({ record, pointer: actual, value });
      });
    }
    return out;
  };

  it('every source-prose rule/condition/feat/action string is contiguous in the cited extraction, modulo normalisation', () => {
    const leaves = proseLeaves(['rule', 'condition', 'feat', 'action']);
    expect(leaves.length).toBeGreaterThan(300);
    const offenders = leaves
      .filter(
        ({ record, value }) =>
          !COLUMN_FLOW_LAYOUT.has(record.key) &&
          !citedHaystack(record).includes(norm(value)),
      )
      .map(({ record, pointer }) => `${record.key} ${pointer}`);
    expect(offenders).toEqual([]);
  });

  it('the column-flow exemptions are still needed (not contiguous) and complete (every token is on the cited page)', () => {
    for (const key of COLUMN_FLOW_LAYOUT) {
      const record = byKey(key);
      const text = (record.data as { text: string }).text;
      expect(citedHaystack(record).includes(norm(text)), key).toBe(false);
      const printed = new Set(
        citedPages(record.provenance.locator).flatMap((p) => [
          ...(pageTokens.get(p) ?? []),
          ...(pageTokens.get(p + 1) ?? []),
        ]),
      );
      expect(
        tokens(text).filter((t) => !printed.has(t)),
        key,
      ).toEqual([]);
    }
  });

  it('every source-prose table cell uses only tokens printed on its cited pages (catches the Iron Flask 01)', () => {
    let checked = 0;
    const offenders: string[] = [];
    for (const record of records.filter((r) => r.kind === 'table')) {
      const printed = new Set(
        citedPages(record.provenance.locator).flatMap((p) => [
          ...(pageTokens.get(p) ?? []),
        ]),
      );
      walkFieldPointers(record.data, (pointer, value, actual) => {
        if (typeof value !== 'string') return;
        if (classOf('table', record.key, pointer) !== 'source-prose') return;
        checked += 1;
        const missing = tokens(value).filter((t) => !printed.has(t));
        if (missing.length > 0)
          offenders.push(`${record.key} ${actual} ${JSON.stringify(value)}`);
      });
    }
    expect(checked).toBeGreaterThan(1000);
    expect(offenders).toEqual([]);
    // The detector fires on the historical defect.
    const flask = new Set(pageTokens.get(228));
    expect(flask.has('01')).toBe(false);
  });
});
