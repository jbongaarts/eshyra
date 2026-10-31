/**
 * Real-pack conformance for eshyra-7f0h: the Apparatus of the Crab's one
 * action for up to two levers, and the Candle of Invocation's light / snuff /
 * burn / first-light-gate lifecycle. The pack is the bundled SRD pack,
 * unmodified: readiness is the pack's own (nothing is made green here).
 */
import { describe, expect, it } from 'vitest';
import {
  beginTurn,
  getActiveCharacterId,
  getBundledDnd5eSrdPack,
  giveItem,
  planItemTurnResource,
  readCombatTurnState,
  readItemState,
  startAdventureRun,
  startEncounter,
  useItem,
} from '../src/internal.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

type TestDb = ReturnType<typeof freshDbWithSession>;
const NOW = '2026-10-31T10:00:00.000Z';
const CAMPAIGN = DEFAULT_TEST_CAMPAIGN_ID;
const CTX = {
  provenance: 'test:candle-and-apparatus',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: NOW,
};
const bundled = getBundledDnd5eSrdPack();

function setup(inCombat: boolean) {
  const db = freshDbWithSession();
  if (inCombat) {
    const module = {
      ...makeTestAdventureModule(),
    };
    const withEncounter = {
      ...module,
      encounters: [
        {
          id: 'enc-goblins',
          name: 'Goblin Ambush',
          description: 'Two goblins spring from the brush.',
          creatures: [
            { rulesRef: 'creature:goblin', count: 2, role: 'ambusher' },
          ],
          locationId: 'loc-cellar',
          reward: 'A few bent copper coins.',
        },
      ],
      scenes: module.scenes.map((scene) =>
        scene.id === 'scene-cellar'
          ? { ...scene, encounterIds: ['enc-goblins'] }
          : scene,
      ),
    };
    startAdventureRun(db, {
      campaignId: CAMPAIGN,
      runId: 'run-goblins',
      moduleId: withEncounter.id,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      updatedAt: NOW,
    });
    startEncounter(db, {
      campaignId: CAMPAIGN,
      encounterId: 'enc-goblins',
      resolveAdventureModule: (moduleId) =>
        moduleId === withEncounter.id ? withEncounter : undefined,
      ...CTX,
    });
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: { kind: 'character' },
      ...CTX,
    });
  }
  return { db, pcId: getActiveCharacterId(db) };
}

function install(db: TestDb, pcId: string, key: string): string {
  const record = bundled.records.find((r) => r.key === key);
  if (record === undefined) throw new Error(`missing ${key}`);
  const row = giveItem(
    db,
    { id: `i-${record.name}`, name: record.name, packRef: key, stateful: true },
    { campaignId: CAMPAIGN, ...CTX },
  );
  if ((record.data as { requiresAttunement?: boolean }).requiresAttunement)
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      CAMPAIGN,
      pcId,
      row.id,
      key,
      record.name,
      NOW,
      CTX.provenance,
      CTX.sessionId,
      NOW,
    );
  return row.id;
}

function use(
  db: TestDb,
  pcId: string,
  instanceId: string,
  operationId: string,
  extra: { levers?: unknown } = {},
) {
  return useItem(db, {
    ...CTX,
    campaignId: CAMPAIGN,
    instanceId,
    operationId,
    characterId: pcId,
    resolveRulesPack: () => bundled,
    ...extra,
  });
}

const budgetOf = (db: TestDb, pcId: string) =>
  readCombatTurnState(db, CAMPAIGN)?.budgets.find(
    (b) => b.participant.kind === 'character' && b.participant.ref === pcId,
  );

const APPARATUS = 'magic-item:apparatus-of-the-crab';
const CANDLE = 'magic-item:candle-of-invocation';
/** Readiness refusal for cast-gate: spell:gate execution is not owned (F4). */
const CAST_GATE_REFUSAL =
  /operation 'cast-gate' is not safely executable: magic-item:candle-of-invocation\/c2-effect-cast-gate \(engine-pending: F4:canonical spell execution\)/;

describe('Apparatus of the Crab: one action moves up to two levers (real pack)', () => {
  it('types the lever move once: one operation, one action, a bounded selection', () => {
    const record = bundled.records.find((r) => r.key === APPARATUS);
    const mechanics = (
      record?.data as { mechanics: Record<string, unknown> } | undefined
    )?.mechanics;
    expect(mechanics?.operations).toEqual([
      {
        id: 'move-levers',
        activation: { cost: 'action' },
        leverSelection: {
          tableRef: 'table:apparatus-of-the-crab-levers',
          min: 1,
          max: 2,
        },
      },
    ]);
  });

  it('two distinct levers spend ONE action and return both printed cells; a second use the same turn is refused', () => {
    const { db, pcId } = setup(true);
    const id = install(db, pcId, APPARATUS);
    const result = use(db, pcId, id, 'move-levers', {
      levers: [
        { lever: 1, direction: 'up' },
        { lever: 10, direction: 'down' },
      ],
    });
    expect(result.turnResource).toMatchObject({
      status: 'spent',
      resource: 'action',
      source: 'activation-cost',
    });
    expect(result.levers).toEqual([
      {
        lever: 1,
        direction: 'up',
        text: 'Legs and tail extend, allowing the apparatus to walk and swim.',
      },
      {
        lever: 10,
        direction: 'down',
        text: 'The rear hatch closes and seals.',
      },
    ]);
    expect(result.costs).toEqual([]);
    expect(budgetOf(db, pcId)).toMatchObject({
      actionUsed: true,
      bonusActionUsed: false,
    });
    // A third lever is another use, hence another action: refused, no action left.
    expect(() =>
      use(db, pcId, id, 'move-levers', {
        levers: [{ lever: 4, direction: 'up' }],
      }),
    ).toThrow(/already used/);
  });

  it('refuses three levers, the same lever twice, no levers, an unknown lever and a bad direction before spending the action', () => {
    const { db, pcId } = setup(true);
    const id = install(db, pcId, APPARATUS);
    const before = budgetOf(db, pcId);
    const attempts: [unknown, RegExp][] = [
      [
        [
          { lever: 1, direction: 'up' },
          { lever: 2, direction: 'up' },
          { lever: 3, direction: 'up' },
        ],
        /moves 1 to 2 levers in one use, not 3/,
      ],
      [
        [
          { lever: 5, direction: 'up' },
          { lever: 5, direction: 'down' },
        ],
        /lever 5 is selected twice/,
      ],
      [undefined, /requires levers/],
      [[], /moves 1 to 2 levers in one use, not 0/],
      [[{ lever: 11, direction: 'up' }], /lever 11 is not a row/],
      [[{ lever: 1, direction: 'sideways' }], /direction must be/],
      [[{ lever: 1.5, direction: 'up' }], /integer row key/],
    ];
    for (const [levers, message] of attempts)
      expect(() => use(db, pcId, id, 'move-levers', { levers })).toThrow(
        message,
      );
    expect(budgetOf(db, pcId)).toEqual(before);
    expect(readItemState(db, id)).toBeUndefined();
  });

  it('refuses levers on an operation that selects none', () => {
    const { db, pcId } = setup(false);
    const id = install(db, pcId, CANDLE);
    expect(() =>
      use(db, pcId, id, 'light', { levers: [{ lever: 1, direction: 'up' }] }),
    ).toThrow(/selects no levers/);
  });
});

describe('Candle of Invocation: light, burn, snuff and the first-light gate (real pack)', () => {
  it('refuses burn while unlit; light spends an action and lights it; burn spends burn-time and no turn resource', () => {
    const { db, pcId } = setup(true);
    const id = install(db, pcId, CANDLE);
    expect(() => use(db, pcId, id, 'burn')).toThrow(
      /requires machineState 'lit', but the item is 'unlit'/,
    );
    expect(budgetOf(db, pcId)?.actionUsed).toBe(false);

    const light = use(db, pcId, id, 'light');
    expect(light.turnResource).toMatchObject({
      status: 'spent',
      resource: 'action',
    });
    expect(readItemState(db, id)?.machineState).toBe('lit');
    const afterLight = budgetOf(db, pcId);

    for (let minute = 1; minute <= 3; minute += 1) {
      const burn = use(db, pcId, id, 'burn');
      expect(burn.costs).toEqual([{ economy: 'burn-time', amount: 1 }]);
      expect(burn.turnResource).toBeUndefined();
      expect(readItemState(db, id)?.economies['burn-time']).toEqual({
        remaining: 240 - minute,
      });
    }
    expect(budgetOf(db, pcId)).toEqual(afterLight);
  });

  it('snuff returns it to unlit-for-later: burn is refused again, and the gate is no longer available', () => {
    const { db, pcId } = setup(false);
    const id = install(db, pcId, CANDLE);
    use(db, pcId, id, 'light');
    use(db, pcId, id, 'burn');
    use(db, pcId, id, 'snuff');
    expect(readItemState(db, id)?.machineState).toBe('snuffed');
    expect(() => use(db, pcId, id, 'burn')).toThrow(
      /requires machineState 'lit', but the item is 'snuffed'/,
    );
    // The first-light gate is refused by readiness before any state guard:
    // spell:gate execution is not owned (c2-effect-cast-gate, F4).
    expect(() => use(db, pcId, id, 'cast-gate')).toThrow(CAST_GATE_REFUSAL);
    // It can be relit for the time that remains.
    use(db, pcId, id, 'light');
    expect(use(db, pcId, id, 'burn').state?.economies['burn-time']).toEqual({
      remaining: 238,
    });
  });

  it('refuses cast-gate after any burn while lit, and a lit candle cannot be lit again', () => {
    const { db, pcId } = setup(false);
    const id = install(db, pcId, CANDLE);
    use(db, pcId, id, 'light');
    use(db, pcId, id, 'burn');
    expect(() => use(db, pcId, id, 'cast-gate')).toThrow(CAST_GATE_REFUSAL);
    expect(readItemState(db, id)?.machineState).toBe('lit');
    expect(() => use(db, pcId, id, 'light')).toThrow(
      /invalid from machineState 'lit'/,
    );
  });

  it('cast-gate on a fresh candle is refused by readiness and leaves the candle, its state and the action unchanged', () => {
    const { db, pcId } = setup(true);
    const id = install(db, pcId, CANDLE);
    const budgetBefore = budgetOf(db, pcId);
    expect(() => use(db, pcId, id, 'cast-gate')).toThrow(CAST_GATE_REFUSAL);
    expect(
      db.prepare('SELECT id FROM inventory WHERE id = ?').get(id),
    ).toMatchObject({ id });
    expect(readItemState(db, id)).toBeUndefined();
    expect(budgetOf(db, pcId)).toEqual(budgetBefore);
    expect(budgetOf(db, pcId)?.actionUsed).toBe(false);
    // The action is still available: lighting succeeds and spends it.
    const light = use(db, pcId, id, 'light');
    expect(light.turnResource).toMatchObject({
      status: 'spent',
      resource: 'action',
    });
    expect(readItemState(db, id)?.machineState).toBe('lit');
    expect(budgetOf(db, pcId)?.actionUsed).toBe(true);
  });

  it('the real pack binds cast-gate to spell:gate, so an owned cast is accounted as a spell', () => {
    const record = bundled.records.find((r) => r.key === CANDLE);
    if (record === undefined) throw new Error(`missing ${CANDLE}`);
    const mechanics = (record.data as { mechanics: Record<string, unknown> })
      .mechanics;
    const operation = (mechanics.operations as Record<string, unknown>[]).find(
      (op) => op.id === 'cast-gate',
    );
    if (operation === undefined) throw new Error('cast-gate is not typed');
    const plan = planItemTurnResource({
      itemKey: CANDLE,
      operation: operation as Parameters<
        typeof planItemTurnResource
      >[0]['operation'],
      effects: mechanics.effects as Parameters<
        typeof planItemTurnResource
      >[0]['effects'],
      inCombat: true,
      castingTimeOf: (ref) =>
        (
          bundled.records.find((r) => r.key === ref)?.data as
            | { castingTime?: string }
            | undefined
        )?.castingTime,
    });
    expect(plan).toMatchObject({
      kind: 'spend',
      resource: 'action',
      source: 'activation-cost',
      spellRef: 'spell:gate',
    });
  });

  it('light refuses when the action is already spent, leaving the candle unlit', () => {
    const { db, pcId } = setup(true);
    const first = install(db, pcId, APPARATUS);
    use(db, pcId, first, 'move-levers', {
      levers: [{ lever: 2, direction: 'up' }],
    });
    const id = install(db, pcId, CANDLE);
    expect(() => use(db, pcId, id, 'light')).toThrow(/already used/);
    expect(readItemState(db, id)).toBeUndefined();
  });
});
