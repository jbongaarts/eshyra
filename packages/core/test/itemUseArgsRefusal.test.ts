/** eshyra-o9bd.16.10.2 (L4-F2): use_item refuses unrecognized or inapplicable
 * operation arguments before any mutation.
 *
 * Invariant, on the UNMODIFIED bundled pack through the default tool registry:
 * a call whose args carry a name the operation does not read, a name that is
 * inapplicable to the selected operation, or a cost key outside the operation's
 * variable costs is refused, and the refusal changes nothing — the full
 * database (item state, inventory, turn budget, economies, event trail) is
 * byte-identical before and after. Declared inputs on the same operations keep
 * working, including transitionOutcome 'failure' and omitted defaults. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
  holdItem,
  readItemState,
} from '../src/internal.js';
import { useItemTool } from '../src/orchestrator/toolUseItem.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-11-01T10:00:00.000Z';
const pack = getBundledDnd5eSrdPack();
const ROPE = 'magic-item:rope-of-entanglement';
const BAG = 'magic-item:bag-of-tricks';

type Db = ReturnType<typeof freshDbWithSession>;

function setup() {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(7),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'l4-f2-args',
    at: NOW,
    resolveRulesPack: () => pack,
  };
  const call = (name: string, args: unknown) =>
    registry.invoke(name, args, ctx);
  const must = (name: string, args: unknown) => {
    const result = call(name, args);
    if (!result.ok) throw new Error(`${name} failed: ${result.message}`);
    return result;
  };
  must('start_encounter', {
    combatInstanceId: 'c',
    actors: [
      {
        actorId: 'pc',
        rulesRef: 'creature:goblin',
        hpMax: 20,
        hpCurrent: 20,
        side: 'ally',
      },
    ],
  });
  must('begin_turn', { character: 'pc-1', round: 1 });
  const ctx2 = ctx;
  const give = (id: string, packRef: string, variantId?: string) => {
    const given = must('give_item', {
      id,
      name: id,
      packRef,
      ...(variantId === undefined ? {} : { variantId }),
    });
    return (given.data as { id: string }).id;
  };
  // The item-layer validator, reached without the registry's schema check.
  const run = (args: unknown) => useItemTool.run(args, ctx2);
  return { db, call, run, must, give };
}

/** Every user table, row for row, in a stable order. */
function snapshot(db: Db): string {
  const tables = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
  return JSON.stringify(
    tables.map((table) => [
      table,
      db.prepare(`SELECT * FROM "${table}"`).all(),
    ]),
  );
}

function ropeInstance(s: ReturnType<typeof setup>): string {
  const id = s.give('rope', ROPE);
  holdItem(s.db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    provenance: 'test:l4-f2-args',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: NOW,
    itemId: id,
  });
  return id;
}

describe('use_item refuses unrecognized or inapplicable operation arguments before any mutation', () => {
  const refusals: {
    name: string;
    item: 'rope' | 'bag';
    args: unknown;
    message: RegExp;
    /** registry: the schema boundary; item: the item-layer validator. */
    layer?: 'registry' | 'item';
  }[] = [
    {
      name: 'Rope misspelled transitionOutcome (transitionOutome) is unknown',
      item: 'rope',
      args: { transitionOutome: 'failure' },
      message: /transitionOutome/,
    },
    {
      name: 'Rope declared transitionOutcome plus an unknown predicate is refused',
      item: 'rope',
      args: { transitionOutcome: 'failure', unknownPredicate: true },
      message: /unknownPredicate/,
    },
    {
      name: 'Bag of Tricks with a fixed-cost cost key and an unknown name',
      item: 'bag',
      args: { costs: { uses: 0 }, unknown: 'garbage' },
      message: /costs|unknown/,
    },
    {
      name: 'Bag of Tricks with only an unknown name',
      item: 'bag',
      args: { unknown: 'garbage' },
      message: /unknown/,
    },
    {
      name: 'Bag of Tricks with a costs key on a fixed-cost operation',
      item: 'bag',
      args: { costs: { uses: 1 } },
      message: /costs/,
    },
    // The item-layer validator, reached past the registry schema: it names the
    // accepted keys, so a caller bypassing the schema gets the same refusal.
    {
      name: 'item layer: Rope misspelled transitionOutcome names the accepted keys',
      item: 'rope',
      layer: 'item',
      args: { transitionOutome: 'failure' },
      message:
        /does not accept args\.transitionOutome; accepted args: transitionOutcome, transitionTo/,
    },
    {
      name: 'item layer: Bag of Tricks fixed-cost costs key names the accepted keys',
      item: 'bag',
      layer: 'item',
      args: { costs: { uses: 0 }, unknown: 'garbage' },
      message: /does not accept args\.costs; accepted args: none/,
    },
    {
      name: 'item layer: Bag of Tricks unknown name says the operation takes no args',
      item: 'bag',
      layer: 'item',
      args: { unknown: 'garbage' },
      message:
        /does not accept args\.unknown; accepted args: none \(this operation takes no args\)/,
    },
    {
      name: 'item layer: Rope costs key on a state-transition operation with no variable cost',
      item: 'rope',
      layer: 'item',
      args: { costs: { charges: 1 } },
      message:
        /does not accept args\.costs; accepted args: transitionOutcome, transitionTo/,
    },
  ];

  for (const refusal of refusals) {
    it(`refuses and leaves state and budgets unchanged: ${refusal.name}`, () => {
      const s = setup();
      const id =
        refusal.item === 'rope' ? ropeInstance(s) : s.give('bag', BAG, 'gray');
      const before = snapshot(s.db);
      const machineBefore = readItemState(s.db, id)?.machineState;
      const operationId =
        refusal.item === 'rope' ? 'entangle-creature' : 'pull-fuzzy-object';
      const input = { instanceId: id, operationId, args: refusal.args };
      const result =
        refusal.layer === 'item' ? s.run(input) : s.call('use_item', input);
      expect(result).toMatchObject({ ok: false });
      expect((result as { message: string }).message).toMatch(refusal.message);
      expect(snapshot(s.db)).toBe(before);
      if (refusal.item === 'rope')
        expect(readItemState(s.db, id)?.machineState).toBe(machineBefore);
      s.db.close();
    });
  }

  it('refuses non-object args at the tool boundary instead of dropping them', () => {
    const s = setup();
    const id = ropeInstance(s);
    const before = snapshot(s.db);
    const result = s.call('use_item', {
      instanceId: id,
      operationId: 'entangle-creature',
      args: 'transitionOutcome=failure',
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(snapshot(s.db)).toBe(before);
    s.db.close();
  });

  describe('declared inputs still work', () => {
    it('Rope entangle-creature with transitionOutcome failure records the failure branch', () => {
      const s = setup();
      const id = ropeInstance(s);
      const used = s.call('use_item', {
        instanceId: id,
        operationId: 'entangle-creature',
        args: { transitionOutcome: 'failure' },
      });
      expect(used, used.message).toMatchObject({ ok: true });
      expect(used.data).toMatchObject({
        state: { machineState: 'loose' },
        transition: { outcome: 'failure' },
      });
      s.db.close();
    });

    it('Rope entangle-creature with transitionOutcome success or omitted restrains', () => {
      const s = setup();
      const id = ropeInstance(s);
      const used = s.call('use_item', {
        instanceId: id,
        operationId: 'entangle-creature',
        args: { transitionOutcome: 'success' },
      });
      expect(used, used.message).toMatchObject({
        ok: true,
        data: {
          state: { machineState: 'restraining' },
          transition: { outcome: 'success' },
        },
      });
      s.db.close();

      const omitted = setup();
      const omittedId = ropeInstance(omitted);
      const plain = omitted.call('use_item', {
        instanceId: omittedId,
        operationId: 'entangle-creature',
      });
      expect(plain, plain.message).toMatchObject({
        ok: true,
        data: {
          state: { machineState: 'restraining' },
          transition: { outcome: 'success' },
        },
      });
      omitted.db.close();
    });

    it('Bag of Tricks pull-fuzzy-object with no args spends one use and issues a bind credit', () => {
      const s = setup();
      const id = s.give('bag', BAG, 'gray');
      const used = s.call('use_item', {
        instanceId: id,
        operationId: 'pull-fuzzy-object',
      });
      expect(used, used.message).toMatchObject({
        ok: true,
        data: { costs: [{ economy: 'uses', amount: 1 }] },
      });
      s.db.close();
    });

    it('Bag of Tricks pull-fuzzy-object with an empty args object is accepted', () => {
      const s = setup();
      const id = s.give('bag', BAG, 'gray');
      const used = s.call('use_item', {
        instanceId: id,
        operationId: 'pull-fuzzy-object',
        args: {},
      });
      expect(used, used.message).toMatchObject({ ok: true });
      s.db.close();
    });
  });
});
