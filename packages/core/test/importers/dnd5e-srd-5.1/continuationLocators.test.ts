import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { contentChunks } from '../../../scripts/importers/dnd5e-srd-5.1/contentSpanPages.js';
import { extractPdfText } from '../../../scripts/importers/dnd5e-srd-5.1/extract.js';
import {
  assertRecordLocatorCompleteness,
  RecordLocatorCompletenessError,
} from '../../../scripts/importers/dnd5e-srd-5.1/recordLocatorCompleteness.js';
import {
  citedPages,
  normalizedPageTextByNumber,
} from '../../../scripts/importers/dnd5e-srd-5.1/recordSourceAnchors.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

/**
 * eshyra-o9bd.16.7.3 (audit eshyra-o9bd.16.1, L1-F1): a record's locator cites
 * every page its retained table rows, flattened ancestry traits and copied
 * variant entries are printed on. Page numbers are SRD printed pages.
 */

const root = process.cwd();
const records = JSON.parse(
  readFileSync(
    join(
      root,
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
) as RulesRecord[];

let pages: PageText[];
beforeAll(async () => {
  pages = await extractPdfText(
    new Uint8Array(
      readFileSync(
        join(root, 'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf'),
      ),
    ),
  );
}, 60_000);

const byKey = (key: string): RulesRecord => {
  const record = records.find((candidate) => candidate.key === key);
  if (record === undefined) throw new Error(`${key} missing`);
  return record;
};

/** Is `text` printed (whole-token) on printed page `page`? */
function printedOn(page: number, text: string): boolean {
  const normalized = normalizedPageTextByNumber(pages);
  const bounded = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
  return (normalized.get(page) ?? []).some((reading) =>
    reading.includes(bounded),
  );
}

describe('continuation and inherited-span locators (L1-F1 witnesses)', () => {
  const witnesses: [string, string, [number, string][]][] = [
    [
      'ancestry:dragonborn',
      'pp. 5, 6',
      [
        [
          6,
          'You have resistance to the damage type associated with your draconic',
        ],
      ],
    ],
    [
      'ancestry:hill-dwarf',
      'pp. 3, 4',
      [[3, 'Dwarves mature at the same rate as humans']],
    ],
    [
      'ancestry:lightfoot-halfling',
      'pp. 4, 5',
      [[4, 'When you roll a 1 on the d20']],
    ],
    [
      'table:bag-of-beans',
      'pp. 209, 210',
      [[210, 'A pyramid with a 60-foot-square base bursts upward']],
    ],
    ['table:celtic-deities', 'pp. 360, 361', [[361, 'Math Mathonwy']]],
    ['table:gray-bag-of-tricks', 'pp. 210, 211', [[211, 'Dire wolf']]],
    [
      'table:half-dragon-damage-resistance',
      'pp. 320, 321',
      [[321, 'Brass, gold, or red']],
    ],
    ['table:lifestyle-expenses', 'pp. 72, 73', [[73, '10 gp minimum']]],
    ['table:food-drink-and-lodging', 'pp. 73, 74', [[74, 'Banquet']]],
    ['magic-item:bag-of-tricks', 'pp. 210, 211', [[211, 'Giant elk']]],
    // Found by the generalized content pass, not named by the audit.
    [
      'table:draconic-bloodline-draconic-ancestry',
      'pp. 44, 45',
      [[45, 'Silver']],
    ],
  ];

  for (const [key, locator, evidence] of witnesses) {
    it(`${key} cites ${locator} and the later page really prints its content`, () => {
      const record = byKey(key);
      expect(record.provenance.locator).toBe(locator);
      expect(record.source).toBe(`SRD 5.1 ${locator}`);
      for (const [page, text] of evidence) {
        expect(printedOn(page, text), `${text} on p. ${page}`).toBe(true);
        expect(citedPages(record.provenance.locator)).toContain(page);
      }
    });
  }

  it('does not widen a locator to a page that only shares a heading word (Barbarian table stays p. 8)', () => {
    expect(byKey('table:the-barbarian').provenance.locator).toBe('p. 8');
  });
});

describe('content-derived locator invariant over the pack', () => {
  it('every table row, ancestry trait and variant entry printed near its record is printed on a cited page', () => {
    const normalized = normalizedPageTextByNumber(pages);
    let chunks = 0;
    for (const record of records) {
      if (!['table', 'ancestry', 'magic-item'].includes(record.kind)) continue;
      const cited = new Set(citedPages(record.provenance.locator));
      for (const chunk of contentChunks(record, normalized)) {
        chunks += 1;
        expect(
          chunk.pages.some((page) => cited.has(page)),
          `${record.key} ${chunk.pointer} printed on [${chunk.pages}] but cites ${record.provenance.locator}`,
        ).toBe(true);
      }
    }
    expect(chunks).toBeGreaterThan(1000);
  });

  it('the gate rejects the pre-repair single-page locators for the audited witnesses', () => {
    const stale = [
      ['table:bag-of-beans', 'p. 209'],
      ['table:celtic-deities', 'p. 360'],
      ['ancestry:hill-dwarf', 'p. 4'],
      ['ancestry:dragonborn', 'p. 5'],
      ['magic-item:bag-of-tricks', 'p. 210'],
    ].map(([key, locator]) => {
      const record = byKey(key);
      return {
        ...record,
        source: `SRD 5.1 ${locator}`,
        provenance: { ...record.provenance, locator },
      };
    });
    const ledger = {
      summary: {},
      entries: [],
    } as unknown as Parameters<typeof assertRecordLocatorCompleteness>[1];
    for (const record of stale) {
      expect(
        () =>
          assertRecordLocatorCompleteness([record], ledger, pages, {
            requireComplete: false,
          }),
        record.key,
      ).toThrow(RecordLocatorCompletenessError);
    }
    // The repaired records pass the same gate.
    expect(() =>
      assertRecordLocatorCompleteness(
        [
          'table:bag-of-beans',
          'table:celtic-deities',
          'ancestry:hill-dwarf',
          'ancestry:dragonborn',
          'magic-item:bag-of-tricks',
        ].map(byKey),
        ledger,
        pages,
        { requireComplete: false },
      ),
    ).not.toThrow();
  });
});

describe('source accounting attributes table continuations to their table', () => {
  it('the region ledger carries a record:table entry for each continuation page', () => {
    const ledger = JSON.parse(
      readFileSync(
        join(
          root,
          'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-region-ledger.json',
        ),
        'utf8',
      ),
    ) as {
      entries: {
        targetKey?: string;
        pageStart: number;
        pageEnd: number;
      }[];
    };
    const covers = (key: string, page: number): boolean =>
      ledger.entries.some(
        (entry) =>
          entry.targetKey === key &&
          entry.pageStart <= page &&
          page <= entry.pageEnd,
      );
    expect(covers('table:bag-of-beans', 210)).toBe(true);
    expect(covers('table:food-drink-and-lodging', 74)).toBe(true);
    expect(covers('table:celtic-deities', 361)).toBe(true);
    expect(covers('table:lifestyle-expenses', 73)).toBe(true);
  });
});
