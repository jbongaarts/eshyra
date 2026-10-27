import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  createInitialItemState,
  createSeededRng,
  getBundledDnd5eSrdPack,
  RulesPackError,
  resolveRulesStack,
  validateRulesPack,
} from '../src/internal.js';
import {
  initialStateProcedures,
  randomInitializationCoverageViolation,
} from '../src/state/itemRandomInitialization.js';

// Roll-domain coverage of effective random-initialization tables (eshyra-1dey):
// every possible roll total maps to exactly one row (containment-occupant,
// table-results) and a table-pool declares at least as many entries as its
// maximum removal count. Admission and execution share one predicate.

type Rows = string[][];
const BASE = getBundledDnd5eSrdPack();
const ADDON_ID = 'test-coverage-addon';
const byKey = new Map(BASE.records.map((r) => [r.key, r] as const));

function addonWithRows(tableRef: string, rows: Rows): RulesPack {
  const table = JSON.parse(JSON.stringify(byKey.get(tableRef))) as RulesRecord;
  (table.data as { rows: Rows }).rows = rows;
  return {
    meta: {
      ...BASE.meta,
      packId: ADDON_ID,
      role: 'addon',
      compatibleBaseSystems: [
        { systemId: BASE.meta.systemId, versions: [BASE.meta.version] },
      ],
    },
    records: [{ ...table, overrides: [`${BASE.meta.packId}/${tableRef}`] }],
  };
}

const baseRows = (ref: string) =>
  ((byKey.get(ref) as RulesRecord).data as { rows: Rows }).rows.map((r) => [
    ...r,
  ]);

function refusal(addon: RulesPack): string {
  expect(() => validateRulesPack(addon)).not.toThrow();
  try {
    resolveRulesStack({ base: BASE, addons: [addon] });
  } catch (error) {
    expect(error).toBeInstanceOf(RulesPackError);
    return (error as Error).message;
  }
  throw new Error('expected admission refusal');
}

describe('random-initialization roll-domain coverage (eshyra-1dey)', () => {
  it('the unmodified base pack satisfies the predicate', () => {
    let checked = 0;
    for (const item of BASE.records.filter((r) => r.kind === 'magic-item')) {
      const data = item.data as { mechanics?: unknown; variants?: unknown[] };
      const all = [
        data.mechanics,
        ...(data.variants ?? []).map(
          (v) => (v as { mechanics?: unknown }).mechanics,
        ),
      ];
      for (const mechanics of all)
        for (const procedure of initialStateProcedures(mechanics)) {
          if (typeof procedure.tableRef !== 'string') continue;
          checked += 1;
          expect(
            randomInitializationCoverageViolation(
              mechanics,
              procedure,
              byKey.get(procedure.tableRef),
            ),
          ).toBeUndefined();
        }
    }
    expect(checked).toBe(4);
  });

  it('refuses a containment-occupant gap and execution still throws', () => {
    const rows = baseRows('table:iron-flask').slice(1); // drops rolls 1-50
    const addon = addonWithRows('table:iron-flask', rows);
    const message = refusal(addon);
    expect(message).toContain(`add-on ${ADDON_ID}`);
    expect(message).toContain('table:iron-flask');
    expect(message).toContain('initial-creature');
    expect(message).toMatch(/can total 1 but .* has no row/);

    const item = byKey.get('magic-item:iron-flask') as RulesRecord;
    const broken = { ...(byKey.get('table:iron-flask') as RulesRecord) };
    broken.data = { ...(broken.data as object), rows };
    expect(() =>
      Array.from({ length: 20 }, (_, i) =>
        createInitialItemState(item.key, item, {
          rng: createSeededRng(`gap-${i}`),
          resolveTable: () => broken,
        }),
      ),
    ).toThrow(/has no row for initialization roll \d+/);
  });

  it('refuses a table-results overlap and a gap', () => {
    const overlap = baseRows('table:necklace-of-prayer-beads');
    overlap[1][0] = '6–12'; // 6 now matches two rows
    const m1 = refusal(
      addonWithRows('table:necklace-of-prayer-beads', overlap),
    );
    expect(m1).toContain(`add-on ${ADDON_ID}`);
    expect(m1).toContain('initial-bead-types');
    expect(m1).toMatch(/can total 6 but .* has 2 rows/);

    const gap = baseRows('table:robe-of-useful-items').filter(
      (r) => r[0] !== '09–15',
    );
    const m2 = refusal(addonWithRows('table:robe-of-useful-items', gap));
    expect(m2).toContain('initial-extra-patches');
    expect(m2).toMatch(/can total 9 but .* has no row/);
  });

  it('refuses a table-pool with fewer entries than the maximum removal', () => {
    const rows = baseRows('table:deck-of-illusions').slice(0, 5);
    const message = refusal(addonWithRows('table:deck-of-illusions', rows));
    expect(message).toContain(`add-on ${ADDON_ID}`);
    expect(message).toContain('initial-missing-cards');
    expect(message).toMatch(/can remove 19 entries .* declares only 5/);
  });

  it('admits a well-formed replacement with a different row partition', () => {
    const rows: Rows = [
      ['01–50', 'Empty'],
      ['51–99', 'Giant owl'],
      ['00', 'Efreeti'],
    ];
    const addon = addonWithRows('table:iron-flask', rows);
    const stack = resolveRulesStack({ base: BASE, addons: [addon] });
    const item = byKey.get('magic-item:iron-flask') as RulesRecord;
    const state = createInitialItemState(item.key, item, {
      rng: createSeededRng('ok'),
      resolveTable: (ref) => stack.recordsByKey.get(ref)?.record,
    });
    expect(Object.keys(state.randomInitialization ?? {})).toHaveLength(1);
  });
});
