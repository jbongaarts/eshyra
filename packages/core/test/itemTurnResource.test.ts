/**
 * use_item spends the printed activation turn resource (eshyra-olc5.9.1).
 *
 * Invariant: in structured combat an item operation whose TYPED pack
 * `activation.cost` is action / bonus-action / reaction spends that resource of
 * the acting character through the existing turn-budget owner, in the same
 * transaction as the item costs and before any item mutation; an unavailable
 * resource refuses the use and changes nothing. Free / consumed activations and
 * operations with no typed cost spend nothing; a bound castSpell `spellRef`
 * carries spell timing; a typed cost that contradicts the bound spell's casting
 * time fails closed unless the reviewed printed-text override set names the row.
 * Authority is the printed item text, evidenced row by row in the activation
 * census; the fixtures reuse the BUNDLED PACK's operation / effect / economy
 * records unchanged, with only execution-readiness made green so the turn
 * resource (not the readiness preflight) is what is exercised.
 */
import { readFileSync } from 'node:fs';
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
  PRINTED_CASTING_TIME_OVERRIDES,
  planItemTurnResource,
  readCombatTurnState,
  readItemState,
  startAdventureRun,
  startEncounter,
  turnResourceForCastingTime,
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
const NOW = '2026-07-10T10:00:00.000Z';
const CAMPAIGN = DEFAULT_TEST_CAMPAIGN_ID;
const CTX = {
  provenance: 'test:item-turn-resource',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: NOW,
};
const PC = { kind: 'character' as const };
const bundled = getBundledDnd5eSrdPack();

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

const itemRecord = (key: string): RulesRecord => {
  const record = bundled.records.find(
    (r) => r.kind === 'magic-item' && r.key === key,
  );
  if (record === undefined) throw new Error(`no pack item ${key}`);
  return record;
};

/** The pack item with its mechanics untouched and readiness made green. */
function greenFixture(key: string): RulesRecord {
  const record = itemRecord(key);
  const data = record.data as Obj;
  const mechanics = data.mechanics as Obj;
  const economies = Object.keys((mechanics.economies as Obj) ?? {});
  const effects = ((mechanics.effects as Obj[]) ?? []).map((e) => e.id);
  const operations = ((mechanics.operations as Obj[]) ?? []).map((o) => o.id);
  const { stateMachine: _stateMachine, ...rest } = mechanics;
  return {
    ...record,
    data: {
      ...data,
      requiresAttunement: false,
      mechanics: rest,
      executionReadiness: {
        source: 'derived-magic-item-clauses-v1',
        clauses: [
          ...operations.map((operationId) => ({
            clauseId: `fixture/op:${String(operationId)}`,
            scope: { kind: 'parent' },
            tag: 'M1',
            readiness: 'green',
            representation: { block: 'operations', operationId },
          })),
          ...economies.map((economyId) => ({
            clauseId: `fixture/economy:${economyId}`,
            scope: { kind: 'parent' },
            tag: 'M1',
            readiness: 'green',
            representation: { block: 'economies', economyId },
          })),
          ...effects.map((effectId) => ({
            clauseId: `fixture/effect:${String(effectId)}`,
            scope: { kind: 'parent' },
            tag: 'C2',
            readiness: 'green',
            representation: { block: 'effects', effectId },
          })),
        ],
      },
    },
  };
}

function install(
  db: ReturnType<typeof freshDbWithSession>,
  pack: RulesPack,
  key: string,
  idSuffix: string,
) {
  const record = pack.records.find((r) => r.key === key) as RulesRecord;
  const stateful = isStatefulMagicItem(record);
  const row = giveItem(
    db,
    {
      id: `i-${idSuffix}`,
      name: record.name,
      packRef: key,
      stateful,
    },
    { campaignId: CAMPAIGN, ...CTX },
  );
  if (stateful)
    writeItemState(db, row.id, createInitialItemState(key, record), CTX);
  const operations = ((record.data as Obj).mechanics as Obj).operations as
    | Obj[]
    | undefined;
  const requirements = new Set(
    (operations ?? []).flatMap((operation) => {
      const activation = operation.activation as Obj | undefined;
      return (activation?.equipment as unknown[][] | undefined)?.flat() ?? [];
    }),
  );
  if (requirements.has('worn')) donItem(db, { ...CTX, itemId: row.id });
  if (requirements.has('held')) holdItem(db, { ...CTX, itemId: row.id });
  if (requirements.has('attuned'))
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, 'pc-1', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      CAMPAIGN,
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

function packWith(...keys: string[]): RulesPack {
  const fixtures = new Map(keys.map((key) => [key, greenFixture(key)]));
  return {
    ...bundled,
    records: bundled.records.map((r) => fixtures.get(r.key) ?? r),
  };
}

function use(
  db: ReturnType<typeof freshDbWithSession>,
  pack: RulesPack,
  pcId: string,
  instanceId: string,
  operationId: string,
) {
  return useItem(db, {
    ...CTX,
    campaignId: CAMPAIGN,
    instanceId,
    operationId,
    characterId: pcId,
    resolveRulesPack: () => pack,
  });
}

const budgetOf = (db: ReturnType<typeof freshDbWithSession>, pcId: string) =>
  readCombatTurnState(db, CAMPAIGN)?.budgets.find(
    (b) => b.participant.kind === 'character' && b.participant.ref === pcId,
  );

describe('use_item spends the printed activation turn resource (pack records)', () => {
  const WAND = 'magic-item:wand-of-web';

  it('an action-cost operation spends the action; a second action-cost use is refused and mutates nothing', () => {
    const { db, pcId } = setup(true);
    const pack = packWith(WAND);
    const id = install(db, pack, WAND, 'wand');
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    const first = use(db, pack, pcId, id, 'cast-web');
    expect(first.turnResource).toMatchObject({
      status: 'spent',
      resource: 'action',
      source: 'activation-cost',
      spellRef: 'spell:web',
    });
    expect(
      first.turnResource?.status === 'spent' &&
        first.turnResource.budget.actionUsed,
    ).toBe(true);
    expect(readItemState(db, id)?.economies?.charges?.remaining).toBe(6);
    const before = readItemState(db, id);
    const budgetBefore = budgetOf(db, pcId);
    expect(() => use(db, pack, pcId, id, 'cast-web')).toThrow(
      /already used their action/,
    );
    // Atomic: the refused turn spend left charges and the budget untouched.
    expect(readItemState(db, id)).toEqual(before);
    expect(readItemState(db, id)?.economies?.charges?.remaining).toBe(6);
    expect(budgetOf(db, pcId)).toEqual(budgetBefore);
  });

  it("refuses before any item mutation when it is not the actor's turn (action)", () => {
    const { db, pcId } = setup(true);
    const pack = packWith(WAND);
    const id = install(db, pack, WAND, 'wand');
    // Nobody's turn has begun for the PC: another participant is active.
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: { kind: 'combatant', ref: 'ci-enc-goblins-1-goblin-1' },
      ...CTX,
    });
    const before = readItemState(db, id);
    expect(() => use(db, pack, pcId, id, 'cast-web')).toThrow(/not .*turn/);
    expect(readItemState(db, id)).toEqual(before);
  });

  it('a bonus-action operation without a spell spends the bonus action', () => {
    const { db, pcId } = setup(true);
    const key = 'magic-item:ring-of-shooting-stars';
    const pack = packWith(key);
    const id = install(db, pack, key, 'stars');
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    const result = use(db, pack, pcId, id, 'move-ball-lightning');
    expect(result.turnResource).toMatchObject({
      status: 'spent',
      resource: 'bonus_action',
      source: 'activation-cost',
    });
    expect(result.turnResource).not.toHaveProperty('spellRef');
    expect(budgetOf(db, pcId)?.bonusActionUsed).toBe(true);
    expect(budgetOf(db, pcId)?.actionUsed).toBe(false);
  });

  it('a reaction operation spends the reaction off-turn, once per round', () => {
    const { db, pcId } = setup(true);
    const key = 'magic-item:staff-of-the-magi';
    const pack = packWith(key);
    const id = install(db, pack, key, 'magi');
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: { kind: 'combatant', ref: 'ci-enc-goblins-1-goblin-1' },
      ...CTX,
    });
    const result = use(db, pack, pcId, id, 'm9-absorb-staff-spell');
    expect(result.turnResource).toMatchObject({
      status: 'spent',
      resource: 'reaction',
    });
    expect(budgetOf(db, pcId)?.reactionsUsed).toBe(1);
    const charges = readItemState(db, id)?.economies?.charges?.remaining;
    expect(() => use(db, pack, pcId, id, 'm9-absorb-staff-spell')).toThrow(
      /already used their reaction/,
    );
    expect(readItemState(db, id)?.economies?.charges?.remaining).toBe(charges);
  });

  it('outside combat spends nothing and records that in the result', () => {
    const { db, pcId } = setup(false);
    const pack = packWith(WAND);
    const id = install(db, pack, WAND, 'wand');
    const result = use(db, pack, pcId, id, 'cast-web');
    expect(result.turnResource).toEqual({
      status: 'not-spent',
      reason: 'not-in-combat',
      spellRef: 'spell:web',
    });
    expect(readItemState(db, id)?.economies?.charges?.remaining).toBe(6);
  });

  it('a spell-casting operation passes its spellRef so the bonus-action-spell rule applies', () => {
    const { db, pcId } = setup(true);
    const jump = 'magic-item:ring-of-jumping';
    const stars = 'magic-item:ring-of-shooting-stars';
    const frost = 'magic-item:staff-of-frost';
    const pack = packWith(jump, stars, frost);
    const jumpId = install(db, pack, jump, 'jump');
    const starsId = install(db, pack, stars, 'stars');
    const frostId = install(db, pack, frost, 'frost');
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    // Ring of Jumping prints a bonus-action cast of jump.
    const cast = use(db, pack, pcId, jumpId, 'cast-jump');
    expect(cast.turnResource).toMatchObject({
      status: 'spent',
      resource: 'bonus_action',
      spellRef: 'spell:jump',
    });
    expect(budgetOf(db, pcId)?.bonusActionSpellCast).toBe(true);
    // A leveled spell (fog cloud) is now barred; nothing is spent or mutated.
    const frostBefore = readItemState(db, frostId);
    expect(() => use(db, pack, pcId, frostId, 'cast-fog-cloud')).toThrow(
      /cantrip with a casting time of 1 action/,
    );
    expect(readItemState(db, frostId)).toEqual(frostBefore);
    expect(budgetOf(db, pcId)?.actionUsed).toBe(false);
    // A 1-action cantrip (light) is the one permitted companion spell.
    const light = use(db, pack, pcId, starsId, 'cast-light');
    expect(light.turnResource).toMatchObject({
      status: 'spent',
      resource: 'action',
      spellRef: 'spell:light',
    });
  });

  it("a cost-null spell operation spends by the spell's casting time", () => {
    const { db, pcId } = setup(true);
    const key = 'magic-item:ring-of-telekinesis';
    const pack = packWith(key);
    const id = install(db, pack, key, 'tk');
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    const result = use(db, pack, pcId, id, 'cast-telekinesis');
    expect(result.turnResource).toMatchObject({
      status: 'spent',
      resource: 'action',
      source: 'spell-casting-time',
      spellRef: 'spell:telekinesis',
    });
  });

  it('Staff of the Magi uses conjure elemental casting time and still spends charges', () => {
    const { db, pcId } = setup(true);
    const key = 'magic-item:staff-of-the-magi';
    const pack = packWith(key);
    const id = install(db, pack, key, 'magi');
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    const chargesBefore = readItemState(db, id)?.economies?.charges?.remaining;

    const result = use(db, pack, pcId, id, 'cast-conjure-elemental');

    expect(result.turnResource).toEqual({
      status: 'not-spent',
      reason: 'casting-time-dm-adjudicated',
      spellRef: 'spell:conjure-elemental',
      castingTime: '1 minute',
    });
    expect(budgetOf(db, pcId)?.actionUsed).toBe(false);
    expect(readItemState(db, id)?.economies?.charges?.remaining).toBe(
      (chargesBefore ?? 0) - 7,
    );
  });

  it('consumed and free activations spend nothing automatically', () => {
    const { db, pcId } = setup(true);
    const key = 'magic-item:potion-of-heroism';
    const pack = packWith(key);
    const id = install(db, pack, key, 'potion');
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    const result = use(db, pack, pcId, id, 'drink');
    expect(result.turnResource).toEqual({
      status: 'not-spent',
      reason: 'consumed-item',
    });
    expect(budgetOf(db, pcId)?.actionUsed).toBe(false);
  });

  it('an operation with neither a typed cost nor a bound spell reports no turn resource', () => {
    const { db, pcId } = setup(true);
    const key = 'magic-item:ring-of-shooting-stars';
    const pack = packWith(key);
    const id = install(db, pack, key, 'stars');
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    const result = use(db, pack, pcId, id, 'discharge-ball-lightning');
    expect(result.turnResource).toBeUndefined();
    expect(budgetOf(db, pcId)?.actionUsed).toBe(false);
  });
});

describe('typed cost versus bound spell casting time (fail closed)', () => {
  const spells = new Map(
    bundled.records
      .filter((r) => r.kind === 'spell')
      .map((r) => [r.key, (r.data as Obj).castingTime as string]),
  );
  const castingTimeOf = (ref: string) => spells.get(ref);

  /** Every (item, operation) in the bundled pack, parent and variants. */
  function* packOperations(): Generator<{
    key: string;
    operation: Obj;
    effects: Obj[];
  }> {
    for (const record of bundled.records) {
      if (record.kind !== 'magic-item') continue;
      const data = record.data as Obj;
      const scopes = [
        data.mechanics as Obj | undefined,
        ...((data.variants as Obj[] | undefined) ?? []).map(
          (v) => v.mechanics as Obj | undefined,
        ),
      ];
      for (const mechanics of scopes) {
        const byId = new Map(
          ((mechanics?.effects as Obj[]) ?? []).map((e) => [e.id, e]),
        );
        for (const operation of (mechanics?.operations as Obj[]) ?? [])
          yield {
            key: record.key,
            operation,
            effects: ((operation.effects as string[]) ?? [])
              .map((id) => byId.get(id))
              .filter((e): e is Obj => e !== undefined),
          };
      }
    }
  }

  function contradictions(overrides: ReadonlySet<string>): string[] {
    const found: string[] = [];
    for (const { key, operation, effects } of packOperations()) {
      try {
        planItemTurnResource({
          itemKey: key,
          operation,
          effects,
          inCombat: true,
          castingTimeOf,
          overrides,
        });
      } catch (error) {
        expect((error as Error).message).toMatch(/prints activation/);
        found.push(`${key}#${String(operation.id)}`);
      }
    }
    return found.sort();
  }

  it('every contradiction in the bundled pack is a reviewed printed-text override, and nothing else', () => {
    expect(contradictions(new Set())).toEqual(
      [...PRINTED_CASTING_TIME_OVERRIDES].sort(),
    );
    expect(contradictions(PRINTED_CASTING_TIME_OVERRIDES)).toEqual([]);
  });

  it('each override row is backed by printed activation text in the activation census', () => {
    const census = JSON.parse(
      readFileSync(
        new URL(
          '../scripts/importers/dnd5e-srd-5.1/magicItemActivationCensus.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { scope: string; operation: string; costSentence: string | null }[];
    const printedOverrides: Readonly<Record<string, string>> = {
      'magic-item:elemental-gem#break-gem':
        'When you use an action to break the gem',
      'magic-item:ring-of-jumping#cast-jump':
        'cast the jump spell from it as a bonus action',
    };
    expect([...PRINTED_CASTING_TIME_OVERRIDES].sort()).toEqual(
      Object.keys(printedOverrides).sort(),
    );
    for (const row of PRINTED_CASTING_TIME_OVERRIDES) {
      const [key, operationId] = row.split('#');
      const name = itemRecord(key ?? '').name;
      const entry = census.find(
        (c) => c.scope === name && c.operation === operationId,
      );
      expect(entry?.costSentence, row).toContain(printedOverrides[row]);
    }
  });

  it('refuses an unreviewed contradiction and surfaces a reviewed one', () => {
    const { db, pcId } = setup(true);
    const key = 'magic-item:ring-of-jumping';
    const pack = packWith(key);
    const id = install(db, pack, key, 'jump');
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    // Reviewed: bonus action governs although jump's casting time is 1 action.
    const result = use(db, pack, pcId, id, 'cast-jump');
    expect(result.turnResource).toMatchObject({
      status: 'spent',
      resource: 'bonus_action',
      castingTimeOverride: { spellRef: 'spell:jump', castingTime: '1 action' },
    });
    // Unreviewed: the same row without the override fails closed.
    expect(() =>
      planItemTurnResource({
        itemKey: key,
        operation: {
          id: 'cast-jump',
          activation: { cost: 'bonus-action' },
        },
        effects: [{ kind: 'castSpell', spellRef: 'spell:jump' }],
        inCombat: true,
        castingTimeOf,
        overrides: new Set(),
      }),
    ).toThrow(/does not establish which governs/);
  });

  it('classifies casting times conservatively', () => {
    expect(turnResourceForCastingTime('1 action')).toBe('action');
    expect(turnResourceForCastingTime('1 bonus action')).toBe('bonus_action');
    expect(
      turnResourceForCastingTime(
        '1 reaction, which you take when you see a creature within 60 feet of you casting a spell',
      ),
    ).toBe('reaction');
    for (const longer of [
      '1 minute',
      '10 minutes',
      '8 hours',
      '1 action or 8 hours',
    ])
      expect(turnResourceForCastingTime(longer)).toBeUndefined();
  });

  it('a cost-null operation bound to a long-casting-time spell is DM-adjudicated and spends nothing', () => {
    const plan = planItemTurnResource({
      itemKey: 'magic-item:test',
      operation: { id: 'cast-x', activation: {} },
      effects: [{ kind: 'castSpell', spellRef: 'spell:scrying' }],
      inCombat: true,
      castingTimeOf,
    });
    expect(plan).toMatchObject({
      kind: 'not-spent',
      reason: 'casting-time-dm-adjudicated',
      castingTime: '10 minutes',
    });
  });

  it('refuses an operation that binds several spells, or an unresolvable spell', () => {
    expect(() =>
      planItemTurnResource({
        itemKey: 'magic-item:test',
        operation: { id: 'x', activation: { cost: 'action' } },
        effects: [
          { kind: 'castSpell', spellRef: 'spell:web' },
          { kind: 'castSpell', spellRef: 'spell:fireball' },
        ],
        inCombat: true,
        castingTimeOf,
      }),
    ).toThrow(/binds several spells/);
    expect(() =>
      planItemTurnResource({
        itemKey: 'magic-item:test',
        operation: { id: 'x', activation: { cost: 'action' } },
        effects: [{ kind: 'castSpell', spellRef: 'spell:no-such-spell' }],
        inCombat: true,
        castingTimeOf,
      }),
    ).toThrow(/does not resolve/);
  });
});
