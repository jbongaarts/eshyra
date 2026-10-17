import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  createInitialItemState,
  createSeededRng,
  getBundledDnd5eSrdPack,
  RulesPackError,
  resolveRulesStack,
  resolveStrictCampaignRulesStack,
  validateRulesPack,
} from '../src/internal.js';
import { writeCampaignRulesBinding } from '../src/rules/binding.js';
import {
  initialStateTableRefs,
  randomInitializationTableViolation,
} from '../src/state/itemRandomInitialization.js';
import { freshDbWithSession } from './support/db.js';

// Effective-stack admission of magic-item randomInitialization tables
// (eshyra-3xi0). A table-only add-on is valid standalone yet changes the table
// an initial-state procedure reads. The shared contract
// (randomInitializationTableViolation, also thrown by execution) is enforced at
// resolveRulesStack for every real item/table pair enumerated from the bundled
// pack. Admission is bypassed by building a resolver directly (resolveTable).

type Data = { rows: unknown[] };
const BASE = getBundledDnd5eSrdPack();
const ADDON_ID = 'test-random-init-addon';
const AT = '2026-07-20T00:00:00.000Z';

const byKey = new Map(BASE.records.map((r) => [r.key, r] as const));
// Every (item, table) pair that a bundled item's initial-state procedure reads.
const PAIRS = BASE.records
  .filter((r) => r.kind === 'magic-item')
  .flatMap((item) => {
    const data = item.data as { mechanics?: unknown; variants?: unknown[] };
    const refs = new Set([
      ...initialStateTableRefs(data.mechanics),
      ...(data.variants ?? []).flatMap((v) =>
        initialStateTableRefs((v as { mechanics?: unknown }).mechanics),
      ),
    ]);
    return [...refs].map((tableRef) => ({ item, tableRef }));
  });

function tableAddon(tableRef: string, patch: (data: Data) => void): RulesPack {
  const table = JSON.parse(JSON.stringify(byKey.get(tableRef))) as RulesRecord;
  patch(table.data);
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

type Violation = readonly [string, (data: Data) => void, RegExp];

// Violations a standalone add-on survives (validateRulesPack accepts them).
const ADMISSIBLE: readonly Violation[] = [
  ['empty rows', (d) => (d.rows = []), /\.data\.rows is empty/],
  [
    'non-string cell',
    (d) => (d.rows[2] = [...d.rows[2].slice(1), 7]),
    /rows\[2\] must be a string row/,
  ],
];

// Every violation class of the shared contract; the rest are already refused
// at pack validation, so only the execution side can see them.
const VIOLATIONS: readonly Violation[] = [
  ...ADMISSIBLE,
  ['rows not an array', (d) => (d.rows = 'x'), /\.data\.rows is empty/],
  ['rows missing', (d) => (d.rows = undefined), /\.data\.rows is empty/],
  [
    'non-array row',
    (d) => (d.rows[1] = 'not a row'),
    /rows\[1\] must be a string row/,
  ],
];

describe('effective-stack randomInitialization admission (eshyra-3xi0)', () => {
  it('enumerates the bundled random-initialization items', () => {
    expect(PAIRS.map((p) => p.item.key).sort()).toEqual([
      'magic-item:deck-of-illusions',
      'magic-item:iron-flask',
      'magic-item:necklace-of-prayer-beads',
      'magic-item:robe-of-useful-items',
    ]);
  });

  it.each(
    PAIRS.flatMap(({ item, tableRef }) =>
      ADMISSIBLE.map(
        ([label, patch, rule]) =>
          [item.key, tableRef, label, patch, rule] as const,
      ),
    ),
  )('refuses %s table %s with %s', (itemKey, tableRef, _l, patch, rule) => {
    const addon = tableAddon(tableRef, patch);
    expect(() => validateRulesPack(addon)).not.toThrow();
    const refusal = (() => {
      try {
        resolveRulesStack({ base: BASE, addons: [addon] });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(refusal).toBeInstanceOf(RulesPackError);
    const message = (refusal as Error).message;
    expect(message).toContain(`add-on ${ADDON_ID}`);
    expect(message).toContain(tableRef);
    expect(message).toContain(itemKey);
    expect(message).toMatch(rule);

    const db = freshDbWithSession();
    writeCampaignRulesBinding(db, {
      base: BASE.meta,
      addons: [addon.meta],
      resolvedAt: AT,
    });
    expect(() =>
      resolveStrictCampaignRulesStack(db, (ref) =>
        ref.packId === ADDON_ID ? addon : BASE,
      ),
    ).toThrow(rule);
    db.close();
  });

  it.each(PAIRS)(
    'admits a conforming override of $tableRef and initializes from it',
    ({ item, tableRef }) => {
      const addon = tableAddon(tableRef, (d) => {
        d.rows = d.rows.map((row: string[]) => [
          ...row.slice(0, -1),
          `${row[row.length - 1]} OVERRIDE`,
        ]);
      });
      const stack = resolveRulesStack({ base: BASE, addons: [addon] });
      const state = createInitialItemState(item.key, item, {
        rng: createSeededRng('3xi0'),
        resolveTable: (ref) => stack.recordsByKey.get(ref)?.record,
      });
      const initialized = Object.values(state.randomInitialization ?? {});
      expect(initialized.length).toBeGreaterThan(0);
      const outcomes = initialized.flatMap((s) =>
        s.kind === 'containment-occupant'
          ? s.occupant === null
            ? []
            : [s.occupant.outcome.join(' ')]
          : s.kind === 'table-results'
            ? s.results.map((r) => r.outcome.join(' '))
            : [],
      );
      if (outcomes.length > 0)
        expect(outcomes.some((o) => o.includes('OVERRIDE'))).toBe(true);
    },
  );

  it.each(
    PAIRS.flatMap(({ item, tableRef }) =>
      VIOLATIONS.map(
        ([label, patch, rule]) => [item, tableRef, label, patch, rule] as const,
      ),
    ),
  )(
    'execution still refuses %# when admission is bypassed (%s)',
    (item, tableRef, _l, patch, rule) => {
      const broken = JSON.parse(
        JSON.stringify(byKey.get(tableRef)),
      ) as RulesRecord;
      patch(broken.data);
      expect(randomInitializationTableViolation(tableRef, broken)).toMatch(
        rule,
      );
      expect(() =>
        createInitialItemState(item.key, item, {
          rng: createSeededRng('3xi0'),
          resolveTable: (ref) => (ref === tableRef ? broken : byKey.get(ref)),
        }),
      ).toThrow(rule);
    },
  );

  it('refuses an add-on item whose table reference does not resolve', () => {
    const item = JSON.parse(
      JSON.stringify(byKey.get('magic-item:iron-flask')),
    ) as RulesRecord;
    const raw = JSON.stringify(item).replaceAll(
      'table:iron-flask',
      'table:no-such-table',
    );
    const addon: RulesPack = {
      meta: tableAddon('table:iron-flask', () => undefined).meta,
      records: [
        {
          ...(JSON.parse(raw) as RulesRecord),
          overrides: [`${BASE.meta.packId}/magic-item:iron-flask`],
        },
      ],
    };
    expect(() => validateRulesPack(addon)).not.toThrow();
    expect(() => resolveRulesStack({ base: BASE, addons: [addon] })).toThrow(
      /add-on test-random-init-addon .*magic-item:iron-flask.*does not resolve/,
    );
  });

  it('does not widen standalone or base-only stacks', () => {
    expect(() => resolveRulesStack({ base: BASE })).not.toThrow();
    expect(() => resolveRulesStack({ base: BASE, addons: [] })).not.toThrow();
  });
});
