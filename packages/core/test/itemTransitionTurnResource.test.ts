/**
 * State-machine activate/deactivate transitions spend the printed turn
 * resource through the same use_item path as plain operations (eshyra-xwau.1).
 *
 * A transition is driven by an operation (`transitions[].via`) and carries no
 * cost field of its own: the cost is that operation's typed
 * `activation.cost`. Invariant, enumerated from the BUNDLED PACK (nothing
 * hard-coded): for every state-machine transition driven by an operation whose
 * typed cost is action / bonus-action / reaction, use_item in combat spends
 * exactly that resource and performs the transition, refuses when the resource
 * is already spent (leaving machine state and economies untouched), and spends
 * nothing outside combat. A via-operation with no spendable typed cost
 * (untyped, or `consume`) spends nothing automatically. An unrecognized cost
 * value fails closed (planItemTurnResource).
 */
import { describe, expect, it } from 'vitest';
import type {
  AdventureModule,
  RulesPack,
  RulesRecord,
} from '../src/internal.js';
import {
  beginTurn,
  createInitialItemState,
  donItem,
  getActiveCharacterId,
  getBundledDnd5eSrdPack,
  giveItem,
  holdItem,
  isStatefulMagicItem,
  planItemTurnResource,
  readCombatTurnState,
  readItemState,
  spendTurnResource,
  startAdventureRun,
  startEncounter,
  useItem,
  writeItemState,
} from '../src/internal.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

type Obj = Record<string, unknown>;
type TestDb = ReturnType<typeof freshDbWithSession>;
const NOW = '2026-07-10T10:00:00.000Z';
const CAMPAIGN = DEFAULT_TEST_CAMPAIGN_ID;
const CTX = {
  provenance: 'test:item-transition-turn-resource',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: NOW,
};
const PC = { kind: 'character' as const };
const bundled = getBundledDnd5eSrdPack();
const RESOURCE: Readonly<
  Record<string, 'action' | 'bonus_action' | 'reaction'>
> = { action: 'action', 'bonus-action': 'bonus_action', reaction: 'reaction' };

function goblinModule(): AdventureModule {
  const module = makeTestAdventureModule();
  return {
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
}

function setup(inCombat: boolean) {
  const db = freshDbWithSession();
  if (inCombat) {
    const module = goblinModule();
    startAdventureRun(db, {
      campaignId: CAMPAIGN,
      runId: 'run-goblins',
      moduleId: module.id,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      updatedAt: NOW,
    });
    startEncounter(db, {
      campaignId: CAMPAIGN,
      encounterId: 'enc-goblins',
      resolveAdventureModule: (moduleId) =>
        moduleId === module.id ? module : undefined,
      ...CTX,
    });
  }
  return { db, pcId: getActiveCharacterId(db) };
}

/** The pack item unchanged (mechanics AND state machine), readiness green so
 * the turn resource, not the readiness preflight, is what is exercised. */
function greenFixture(record: RulesRecord): RulesRecord {
  const data = record.data as Obj;
  const mechanics = data.mechanics as Obj;
  const ids = (list: unknown) => ((list as Obj[]) ?? []).map((e) => e.id);
  const clause = (block: Obj, tag: string) => ({
    clauseId: `fixture/${JSON.stringify(block)}`,
    scope: { kind: 'parent' },
    tag,
    readiness: 'green',
    representation: block,
  });
  return {
    ...record,
    data: {
      ...data,
      requiresAttunement: false,
      executionReadiness: {
        source: 'derived-magic-item-clauses-v1',
        clauses: [
          ...ids(mechanics.operations).map((operationId) =>
            clause({ block: 'operations', operationId }, 'M1'),
          ),
          ...Object.keys((mechanics.economies as Obj) ?? {}).map((economyId) =>
            clause({ block: 'economies', economyId }, 'M1'),
          ),
          ...ids(mechanics.effects).map((effectId) =>
            clause({ block: 'effects', effectId }, 'C2'),
          ),
          clause({ block: 'stateMachine' }, 'M5'),
        ],
      },
    },
  };
}

interface Drive {
  readonly key: string;
  readonly operationId: string;
  readonly cost: string | undefined;
  readonly from: string;
  readonly to: string;
}

/** One driven transition per (item, via operation), enumerated from the pack. */
function drivenTransitions(): Drive[] {
  const found: Drive[] = [];
  for (const record of bundled.records) {
    if (record.kind !== 'magic-item') continue;
    const mechanics = (record.data as Obj).mechanics as Obj | undefined;
    const machine = mechanics?.stateMachine as Obj | undefined;
    if (machine === undefined) continue;
    const operations = (mechanics?.operations as Obj[]) ?? [];
    const seen = new Set<string>();
    for (const transition of machine.transitions as Obj[]) {
      if (typeof transition.via !== 'string' || seen.has(transition.via))
        continue;
      seen.add(transition.via);
      const operation = operations.find(({ id }) => id === transition.via);
      found.push({
        key: record.key,
        operationId: transition.via,
        cost: (operation?.activation as Obj | undefined)?.cost as
          | string
          | undefined,
        from: String(transition.from),
        to: String(transition.to),
      });
    }
  }
  return found;
}

/** A variant-required item (Ioun Stone) is installed as its first variant; the
 * state machine under test lives on the parent mechanics every variant inherits. */
function variantOf(record: RulesRecord): string | undefined {
  const variants = (record.data as Obj).variants as Obj[] | undefined;
  return variants === undefined ? undefined : String(variants[0]?.id);
}

function install(db: TestDb, pack: RulesPack, drive: Drive): string {
  const record = pack.records.find((r) => r.key === drive.key) as RulesRecord;
  const variantId = variantOf(record);
  const stateful = isStatefulMagicItem(record, variantId);
  const row = giveItem(
    db,
    {
      id: 'i-machine',
      name: record.name,
      packRef: drive.key,
      stateful,
      ...(variantId === undefined ? {} : { variantId }),
    },
    { campaignId: CAMPAIGN, ...CTX },
  );
  const initial = createInitialItemState(drive.key, record, { variantId });
  writeItemState(db, row.id, { ...initial, machineState: drive.from }, CTX);
  const requirements = new Set(
    (((record.data as Obj).mechanics as Obj).operations as Obj[]).flatMap(
      (operation) =>
        (
          (operation.activation as Obj | undefined)?.equipment as
            | unknown[][]
            | undefined
        )?.flat() ?? [],
    ),
  );
  if (requirements.has('worn')) donItem(db, { ...CTX, itemId: row.id });
  if (requirements.has('held')) holdItem(db, { ...CTX, itemId: row.id });
  return row.id;
}

function use(
  db: TestDb,
  pack: RulesPack,
  pcId: string,
  instanceId: string,
  drive: Drive,
) {
  // Several transitions can leave the same state via one operation (the Cube
  // of Force faces); naming the destination is the declared disambiguation.
  return useItem(db, {
    ...CTX,
    campaignId: CAMPAIGN,
    instanceId,
    operationId: drive.operationId,
    args: { transitionTo: drive.to },
    characterId: pcId,
    resolveRulesPack: () => pack,
  });
}

/** A transition into the printed destroyed state destroys the instance in the
 * same use (Candle of Invocation's first-light gate): no state row survives
 * and the use reports it consumed. Every other transition lands on `to`. */
function expectArrivedAt(
  db: TestDb,
  id: string,
  drive: Drive,
  result: { readonly consumed: boolean },
): void {
  if (drive.to === 'destroyed') {
    expect(result.consumed).toBe(true);
    expect(readItemState(db, id)).toBeUndefined();
  } else expect(readItemState(db, id)?.machineState).toBe(drive.to);
}

const budgetOf = (db: TestDb, pcId: string) =>
  readCombatTurnState(db, CAMPAIGN)?.budgets.find(
    (b) => b.participant.kind === 'character' && b.participant.ref === pcId,
  );

const flagFor = (
  budget: NonNullable<ReturnType<typeof budgetOf>>,
  resource: 'action' | 'bonus_action' | 'reaction',
) =>
  resource === 'action'
    ? budget.actionUsed
    : resource === 'bonus_action'
      ? budget.bonusActionUsed
      : budget.reactionsUsed > 0;

describe('state-machine transitions spend the printed turn resource (real pack)', () => {
  const drives = drivenTransitions();
  const typed = drives.filter(
    (d) => d.cost !== undefined && d.cost in RESOURCE,
  );
  const unspent = drives.filter(
    (d) => d.cost === undefined || !(d.cost in RESOURCE),
  );

  it('enumerates a non-trivial set of typed and untyped driven transitions from the pack', () => {
    expect(typed.length).toBeGreaterThan(20);
    expect(unspent.length).toBeGreaterThan(0);
    for (const d of unspent)
      expect([undefined, 'consume', 'free']).toContain(d.cost);
  });

  it.each(typed.map((d) => [`${d.key}#${d.operationId}`, d] as const))(
    '%s: in combat spends exactly the printed resource and transitions; refuses when spent; spends nothing out of combat',
    (_label, drive) => {
      const resource = RESOURCE[drive.cost as string] as
        | 'action'
        | 'bonus_action'
        | 'reaction';
      const record = bundled.records.find(
        (r) => r.key === drive.key,
      ) as RulesRecord;
      const pack: RulesPack = {
        ...bundled,
        records: bundled.records.map((r) =>
          r.key === drive.key ? greenFixture(record) : r,
        ),
      };

      // In combat: spends exactly the printed resource, then transitions.
      {
        const { db, pcId } = setup(true);
        const id = install(db, pack, drive);
        beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
        const result = use(db, pack, pcId, id, drive);
        expect(result.turnResource).toMatchObject({
          status: 'spent',
          resource,
          source: 'activation-cost',
        });
        const budget = budgetOf(db, pcId);
        for (const other of ['action', 'bonus_action', 'reaction'] as const) {
          expect(
            flagFor(budget as NonNullable<typeof budget>, other),
            `${other} used`,
          ).toBe(other === resource);
        }
        expectArrivedAt(db, id, drive, result);
      }

      // Refuses when the resource is already spent; nothing mutates.
      {
        const { db, pcId } = setup(true);
        const id = install(db, pack, drive);
        beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
        spendTurnResource(db, {
          campaignId: CAMPAIGN,
          participant: { kind: 'character', ref: pcId },
          resource,
          activity: 'test: exhaust the resource',
          provenance: CTX.provenance,
          sessionId: CTX.sessionId,
          at: CTX.at,
        });
        const stateBefore = readItemState(db, id);
        const budgetBefore = budgetOf(db, pcId);
        expect(() => use(db, pack, pcId, id, drive)).toThrow(/already used/);
        expect(readItemState(db, id)).toEqual(stateBefore);
        expect(budgetOf(db, pcId)).toEqual(budgetBefore);
      }

      // Out of combat: spends nothing, still transitions.
      {
        const { db, pcId } = setup(false);
        const id = install(db, pack, drive);
        const result = use(db, pack, pcId, id, drive);
        expect(result.turnResource).toMatchObject({
          status: 'not-spent',
          reason: 'not-in-combat',
        });
        expectArrivedAt(db, id, drive, result);
      }
    },
  );

  it('a driven transition whose operation has no spendable typed cost spends nothing automatically', () => {
    for (const drive of unspent) {
      const plan = planItemTurnResource({
        itemKey: drive.key,
        operation: {
          id: drive.operationId,
          ...(drive.cost === undefined
            ? {}
            : { activation: { cost: drive.cost } }),
        },
        effects: [],
        inCombat: true,
        castingTimeOf: () => undefined,
      });
      expect(
        ['absent', 'not-spent'],
        `${drive.key}#${drive.operationId}`,
      ).toContain(plan.kind);
    }
  });

  it('fails closed on an unrecognized activation cost value', () => {
    expect(() =>
      planItemTurnResource({
        itemKey: 'magic-item:test',
        operation: { id: 'toggle', activation: { cost: 'two-actions' } },
        effects: [],
        inCombat: true,
        castingTimeOf: () => undefined,
      }),
    ).toThrow(/unrecognized activation cost 'two-actions'/);
  });
});
