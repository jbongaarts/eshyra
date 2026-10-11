/**
 * Source-backed evidence for eshyra-o9bd.19.2.3 / .1 on the committed SRD 5.1
 * pack: madness durations (opus:F-16), the Tack, Harness, and Drawn Vehicles
 * grouping and Barding transformation (sol:CAP-013), the empty-cell invariant
 * (fable:F6; the formerly empty cells are printed dashes in the vendored PDF),
 * and class-table advancement qualifiers (opus:F-10).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackRecord {
  readonly kind: string;
  readonly key: string;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous committed-pack JSON read by exact-shape assertions
  readonly data: Record<string, any>;
}

const RECORDS: readonly PackRecord[] = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
);
const byKey = new Map(RECORDS.map((r) => [r.key, r]));
const record = (key: string): PackRecord => {
  const found = byKey.get(key);
  if (found === undefined) throw new Error(`missing ${key}`);
  return found;
};

describe('madness durations (opus:F-16)', () => {
  it('projects each table duration from the printed Madness Effects sentence', () => {
    const rule = record('rule:madness-effects').data.text as string;
    const expected = {
      'table:short-term-madness': {
        duration: { dice: '1d10', unit: 'minute' },
        sourceText: 'from the Short-Term Madness table for 1d10 minutes',
      },
      'table:long-term-madness': {
        duration: { dice: '1d10', multiplier: 10, unit: 'hour' },
        sourceText: 'from the Long-Term Madness table for 1d10 × 10 hours',
      },
      'table:indefinite-madness': {
        duration: { kind: 'until-cured' },
        sourceText: 'from the Indefinite Madness table that lasts until cured',
      },
    } as const;
    for (const [key, want] of Object.entries(expected)) {
      expect(record(key).data.projection).toEqual({
        kind: 'madnessDuration',
        ...want,
        sourceRuleRef: 'rule:madness-effects',
      });
      expect(rule).toContain(want.sourceText);
    }
  });
});

describe('Tack, Harness, and Drawn Vehicles (sol:CAP-013)', () => {
  // The printed table rows (SRD 5.1 p. 72); Saddle variants are qualified.
  const PRINTED_ROWS: readonly [string, string, string | undefined][] = [
    ['equipment:bit-and-bridle', '2 gp', '1 lb.'],
    ['equipment:carriage', '100 gp', '600 lb.'],
    ['equipment:cart', '15 gp', '200 lb.'],
    ['equipment:chariot', '250 gp', '100 lb.'],
    ['equipment:feed-per-day', '5 cp', '10 lb.'],
    ['equipment:saddle-exotic', '60 gp', '40 lb.'],
    ['equipment:saddle-military', '20 gp', '30 lb.'],
    ['equipment:saddle-pack', '5 gp', '15 lb.'],
    ['equipment:saddle-riding', '10 gp', '25 lb.'],
    ['equipment:saddlebags', '4 gp', '8 lb.'],
    ['equipment:sled', '20 gp', '300 lb.'],
    ['equipment:stabling-per-day', '5 sp', undefined],
    ['equipment:wagon', '35 gp', '400 lb.'],
  ];

  it('groups exactly the printed table rows', () => {
    const grouped = RECORDS.filter(
      (r) => r.data.equipmentGroup === 'tack-harness-drawn-vehicles',
    )
      .map((r) => r.key)
      .sort();
    expect(grouped).toEqual(PRINTED_ROWS.map(([key]) => key).sort());
    for (const [key, cost, weight] of PRINTED_ROWS) {
      expect(record(key).data.cost).toBe(cost);
      expect(record(key).data.weight).toBe(weight);
    }
  });

  it('types the Barding rule as a transformation', () => {
    const rule = record('rule:mounts-and-vehicles').data;
    expect(rule.bardingTransformation).toEqual({
      costMultiplier: 4,
      weightMultiplier: 2,
      appliesTo: 'armor-table',
      sourceText:
        'Any type of armor shown on the Armor table can be purchased as barding. The cost is four times the equivalent armor made for humanoids, and it weighs twice as much.',
    });
    expect(rule.text).toContain(rule.bardingTransformation.sourceText);
  });
});

describe('table cells (fable:F6)', () => {
  it('has no empty-string table cell: unavailable cells are the printed dash', () => {
    const empty: string[] = [];
    for (const r of RECORDS) {
      if (r.kind !== 'table') continue;
      for (const [i, row] of (r.data.rows as unknown[][]).entries()) {
        for (const [j, cell] of row.entries()) {
          if (cell === '') empty.push(`${r.key}[${i}][${j}]`);
        }
      }
    }
    expect(empty).toEqual([]);
  });

  it('prints the dash in the class-table spell-slot and Features cells', () => {
    const bard = record('table:the-bard').data;
    expect(bard.rows[0]).toEqual([
      '1st',
      '+2',
      'Spellcasting, Bardic Inspiration (d6)',
      '2',
      '4',
      '2',
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
    ]);
    expect(bard.rows[6][2]).toBe('—'); // 7th level prints a dash for Features
    const warlock = record('table:the-warlock').data;
    expect(warlock.rows[0].at(-1)).toBe('—');
  });
});

describe('advancement qualifiers (opus:F-10)', () => {
  const splitTop = (text: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth = Math.max(0, depth - 1);
      else if (text[i] === ',' && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts;
  };

  it('keeps every parenthetical Features qualifier as a progression detail', () => {
    let qualifiers = 0;
    for (const cls of RECORDS.filter((r) => r.kind === 'class')) {
      const table = record(`table:the-${cls.key.slice('class:'.length)}`).data;
      const features = table.columns.indexOf('Features');
      for (const [i, row] of (table.rows as string[][]).entries()) {
        const advancement = cls.data.progression[i].advancement as Record<
          string,
          unknown
        >[];
        for (const raw of splitTop(row[features])) {
          const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(raw.trim());
          if (m === null) continue;
          qualifiers++;
          expect(
            advancement.some(
              (e) => e.name === m[1].trim() && e.detail === m[2],
            ),
            `${cls.key} level ${i + 1} ${raw.trim()}`,
          ).toBe(true);
        }
      }
    }
    expect(qualifiers).toBe(30);
  });
});
