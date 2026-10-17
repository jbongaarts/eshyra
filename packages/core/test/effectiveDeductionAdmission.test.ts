import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  createInitialItemState,
  createSeededRng,
  getBundledDnd5eSrdPack,
  giveItem,
  RulesPackError,
  readItemState,
  resolveRulesStack,
  resolveStrictCampaignRulesStack,
  validateRulesPack,
  writeItemState,
} from '../src/internal.js';
import { writeCampaignRulesBinding } from '../src/rules/binding.js';
import { applyItemStateConditionEvent } from '../src/state/itemResetExecutor.js';
import { freshDbWithSession } from './support/db.js';

// Effective-stack admission of economyDeduction tables (eshyra-w750). A
// table-only add-on is valid standalone (it declares no deduction) yet changes
// what the Cube of Force deduction reads. The stack must refuse each violation
// class of the shared contract (magicItemEconomyDeductionViolation) naming the
// add-on, table and rule; a conforming override is admitted and executes. The
// execution-side refusal when admission is bypassed is proved in
// itemResetExecutor.test.ts (admission mocked out there).

const BASE = getBundledDnd5eSrdPack();
const CUBE_TABLE = 'table:cube-of-force-charges-lost';
const ADDON_ID = 'test-cube-addon';
const COLUMNS = ['Spell or Item', 'Charges Lost'];
const CTX = {
  campaignId: 'campaign-1',
  provenance: 'test:admission',
  sessionId: 'session-1',
  at: '2026-07-20T00:00:00.000Z',
};
const CUBE_CONDITION =
  'The cube loses charges when the barrier is targeted by certain spells or comes into contact with certain spell or magic item effects, as shown in the table below.';

function cubeTableAddon(columns: unknown[], rows: unknown[][]): RulesPack {
  const table = JSON.parse(
    JSON.stringify(BASE.records.find(({ key }) => key === CUBE_TABLE)),
  ) as RulesRecord;
  const data = table.data as { columns: unknown[]; rows: unknown[][] };
  data.columns = columns;
  data.rows = rows;
  return {
    meta: {
      ...BASE.meta,
      packId: ADDON_ID,
      role: 'addon',
      compatibleBaseSystems: [
        { systemId: BASE.meta.systemId, versions: [BASE.meta.version] },
      ],
    },
    records: [{ ...table, overrides: [`${BASE.meta.packId}/${CUBE_TABLE}`] }],
  };
}

describe('effective-stack economyDeduction admission (eshyra-w750)', () => {
  it.each([
    [
      'duplicate key',
      COLUMNS,
      [
        ['Disintegrate', '1'],
        ['Disintegrate', '12'],
      ],
      /is ambiguous/,
    ],
    [
      'non-string key',
      COLUMNS,
      [
        ['Disintegrate', '2'],
        [7, '1'],
      ],
      /key cell must be a non-empty string/,
    ],
    ['empty key', COLUMNS, [['', '1']], /key cell must be a non-empty string/],
    [
      'negative numeric amount',
      COLUMNS,
      [['Disintegrate', -7]],
      /amount must be non-negative/,
    ],
    [
      'negative dice floor',
      COLUMNS,
      [['Disintegrate', '2d4-8']],
      /can total below zero/,
    ],
    [
      'fractional amount',
      COLUMNS,
      [['Disintegrate', 1.5]],
      /dice expression or non-negative integer/,
    ],
    [
      'non-dice amount',
      COLUMNS,
      [['Disintegrate', 'twelve']],
      /does not parse as a dice expression/,
    ],
    [
      'dice ceiling beyond the safe range',
      COLUMNS,
      [['Disintegrate', '1d2+9007199254740991']],
      /above the safe-integer range/,
    ],
    [
      'keep-highest ceiling beyond the safe range',
      COLUMNS,
      [['Disintegrate', '2d20kh1+9007199254740991']],
      /above the safe-integer range/,
    ],
    [
      'straddling safe-integer ceiling',
      COLUMNS,
      [['Disintegrate', '1d2+9007199254740990']],
      /above the safe-integer range/,
    ],
    [
      'key column absent',
      ['Spell', 'Charges Lost'],
      [['Disintegrate', '2']],
      /must name keyColumn and amountColumn that exist/,
    ],
    [
      'amount column absent',
      ['Spell or Item', 'Charges'],
      [['Disintegrate', '2']],
      /must name keyColumn and amountColumn that exist/,
    ],
    [
      'key column twice',
      ['Spell or Item', 'Spell or Item', 'Charges Lost'],
      [['Disintegrate', 'Other', '3']],
      /each occur exactly once/,
    ],
    [
      'amount column twice',
      ['Spell or Item', 'Charges Lost', 'Charges Lost'],
      [['Disintegrate', '1', '12']],
      /each occur exactly once/,
    ],
  ] as const)(
    'refuses a table-only add-on override with %s at stack resolution',
    (_label, columns, rows, rule) => {
      const addon = cubeTableAddon(
        [...columns],
        rows.map((r) => [...r]),
      );
      // The add-on is independently valid: only the layered stack is wrong.
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
      expect(message).toContain(CUBE_TABLE);
      expect(message).toMatch(rule);

      // The campaign binding seam refuses the same stack.
      const db = freshDbWithSession();
      writeCampaignRulesBinding(db, {
        base: BASE.meta,
        addons: [addon.meta],
        resolvedAt: CTX.at,
      });
      expect(() =>
        resolveStrictCampaignRulesStack(db, (ref) =>
          ref.packId === ADDON_ID ? addon : BASE,
        ),
      ).toThrow(rule);
      db.close();
    },
  );

  it('admits a conforming override and executes it', () => {
    const addon = cubeTableAddon(COLUMNS, [
      ['Disintegrate', '2'],
      ['Horn of blasting', '1d10'],
    ]);
    expect(() =>
      resolveRulesStack({ base: BASE, addons: [addon] }),
    ).not.toThrow();
    const db = freshDbWithSession();
    const original = BASE.records.find(
      (r) => r.kind === 'magic-item' && r.name === 'Cube of Force',
    ) as RulesRecord;
    const item = giveItem(
      db,
      {
        id: 'instance-cube',
        name: original.name,
        packRef: original.key,
        stateful: true,
      },
      CTX,
    );
    writeItemState(
      db,
      item.id,
      {
        ...createInitialItemState(original.key, original),
        machineState: 'face-1',
      },
      CTX,
    );
    writeCampaignRulesBinding(db, {
      base: BASE.meta,
      addons: [addon.meta],
      resolvedAt: CTX.at,
    });
    const result = applyItemStateConditionEvent(db, {
      ...CTX,
      instanceId: item.id,
      condition: CUBE_CONDITION,
      tableRow: 'Disintegrate',
      rng: createSeededRng('w750'),
      resolveRulesPack: (ref) => (ref.packId === ADDON_ID ? addon : BASE),
    });
    expect(result.deduction?.amount).toBe(2);
    expect(readItemState(db, item.id)?.economies?.charges?.remaining).toBe(34);
    db.close();
  });

  it('does not widen standalone or base-only stacks', () => {
    expect(() => resolveRulesStack({ base: BASE })).not.toThrow();
    expect(() => resolveRulesStack({ base: BASE, addons: [] })).not.toThrow();
  });
});
