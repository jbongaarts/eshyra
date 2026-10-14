import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  createInitialItemState,
  donItem,
  getBundledDnd5eSrdPack,
  giveItem,
  holdItem,
  isInventoryItemHeld,
  isStatefulMagicItem,
  readItemState,
  stowItem,
  transferItem,
  useItem,
  writeItemState,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

type Obj = Record<string, unknown>;
const AT = '2026-10-14T12:00:00.000Z';
const CTX = {
  provenance: 'test:equipment-prerequisites',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
  characterId: 'pc-1',
};
const bundled = getBundledDnd5eSrdPack();

function readyItem(key: string): RulesRecord {
  const record = bundled.records.find(
    (candidate) => candidate.key === `magic-item:${key}`,
  );
  if (record === undefined) throw new Error(`missing bundled item ${key}`);
  const data = record.data as Obj;
  const readiness = data.executionReadiness as Obj;
  const clauses = readiness.clauses as Obj[];
  return {
    ...record,
    data: {
      ...data,
      executionReadiness: {
        ...readiness,
        clauses: clauses.map((clause) => ({ ...clause, readiness: 'green' })),
      },
    },
  };
}

function packWith(...keys: string[]): RulesPack {
  const overrides = new Map(
    keys.map((key) => [`magic-item:${key}`, readyItem(key)]),
  );
  return {
    ...bundled,
    records: bundled.records.map(
      (record) => overrides.get(record.key) ?? record,
    ),
  };
}

function addRecipient(db: ReturnType<typeof freshDbWithSession>): void {
  db.prepare(
    `INSERT INTO character(
       id, name, ability_scores_json, provenance, session_id, updated_at
     ) VALUES ('pc-2', 'Recipient', ?, ?, ?, ?)`,
  ).run(
    JSON.stringify({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    }),
    CTX.provenance,
    CTX.sessionId,
    AT,
  );
}

function grant(
  db: ReturnType<typeof freshDbWithSession>,
  key: string,
  id: string,
  pack: RulesPack,
): string {
  const record = pack.records.find(
    (candidate) => candidate.key === `magic-item:${key}`,
  ) as RulesRecord;
  const row = giveItem(
    db,
    {
      id,
      name: record.name,
      packRef: record.key,
      stateful: isStatefulMagicItem(record),
    },
    { campaignId: DEFAULT_TEST_CAMPAIGN_ID, ...CTX },
  );
  if (isStatefulMagicItem(record))
    writeItemState(
      db,
      row.id,
      createInitialItemState(record.key, record, {
        rng: { nextInt: () => 0 },
      }),
      CTX,
    );
  if ((record.data as Obj).requiresAttunement === true)
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, 'pc-1', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      DEFAULT_TEST_CAMPAIGN_ID,
      row.id,
      record.key,
      record.name,
      AT,
      CTX.provenance,
      CTX.sessionId,
      AT,
    );
  return row.id;
}

function use(
  db: ReturnType<typeof freshDbWithSession>,
  pack: RulesPack,
  instanceId: string,
  operationId: string,
) {
  return useItem(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    instanceId,
    operationId,
    characterId: 'pc-1',
    resolveRulesPack: () => pack,
    ...CTX,
  });
}

describe('printed magic-item equipment prerequisites', () => {
  it('persists exact hold and stow transitions for an item in custody', () => {
    const db = freshDbWithSession();
    const { id } = giveItem(db, { id: 'held-test', name: 'Test Wand' }, CTX);
    expect(isInventoryItemHeld(db, id, 'pc-1')).toBe(false);
    holdItem(db, { ...CTX, itemId: id });
    expect(isInventoryItemHeld(db, id, 'pc-1')).toBe(true);
    stowItem(db, { ...CTX, itemId: id });
    expect(isInventoryItemHeld(db, id, 'pc-1')).toBe(false);
    db.close();
  });

  it('requires a held wand, permits use when held, and clears held on transfer', () => {
    const db = freshDbWithSession();
    addRecipient(db);
    const pack = packWith('wand-of-web');
    const id = grant(db, 'wand-of-web', 'wand-web', pack);
    const before = readItemState(db, id);

    expect(() => use(db, pack, id, 'cast-web')).toThrow(
      /unmet alternatives: .*held/,
    );
    expect(readItemState(db, id)).toEqual(before);
    expect(holdItem(db, { ...CTX, itemId: id }).held).toBe(true);
    expect(use(db, pack, id, 'cast-web').costs).toEqual([
      { economy: 'charges', amount: 1 },
    ]);
    expect(
      db
        .prepare('SELECT held FROM inventory_wear_state WHERE inventory_id=?')
        .get(id),
    ).toEqual({ held: 1 });

    transferItem(
      db,
      {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        itemId: id,
        toCharacterRef: 'pc-2',
        attunement: 'end',
      },
      CTX,
    );
    expect(
      db
        .prepare(
          'SELECT held, wear_state FROM inventory_wear_state WHERE inventory_id=?',
        )
        .get(id),
    ).toEqual({ held: 0, wear_state: 'not_worn' });
    expect(() => use(db, pack, id, 'cast-web')).toThrow(
      /holds no inventory instance/,
    );
    db.close();
  });

  it('requires worn state for Winged Boots even while the actor has custody', () => {
    const db = freshDbWithSession();
    const pack = packWith('winged-boots');
    const id = grant(db, 'winged-boots', 'boots', pack);
    expect(() => use(db, pack, id, 'fly')).toThrow(
      /unmet alternatives: .*worn/,
    );
    expect(readItemState(db, id)?.economies?.flight?.remaining).toBe(240);
    db.close();
  });

  it('accepts either worn or held for the Talisman of Pure Good', () => {
    const db = freshDbWithSession();
    const pack = packWith('talisman-of-pure-good');
    const worn = grant(db, 'talisman-of-pure-good', 'talisman-worn', pack);
    const held = grant(db, 'talisman-of-pure-good', 'talisman-held', pack);
    // The fixture's first use establishes each separate alternative; no hand
    // count or two-handed rule is represented in this capability.
    donItem(db, { ...CTX, itemId: worn });
    holdItem(db, { ...CTX, itemId: held });
    expect(use(db, pack, worn, 'open-fissure').costs).toHaveLength(1);
    expect(use(db, pack, held, 'open-fissure').costs).toHaveLength(1);
    db.close();
  });

  it('checks operation attunement independently of item-level attunement', () => {
    const db = freshDbWithSession();
    const pack = packWith('hammer-of-thunderbolts');
    const record = pack.records.find(
      (candidate) => candidate.key === 'magic-item:hammer-of-thunderbolts',
    ) as RulesRecord;
    expect((record.data as Obj).requiresAttunement).toBe(false);
    const id = grant(db, 'hammer-of-thunderbolts', 'hammer', pack);
    expect(() => use(db, pack, id, 'giant-slaying-critical')).toThrow(
      /unmet alternatives: .*attuned/,
    );
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, 'pc-1', ?, 'magic-item:hammer-of-thunderbolts',
                 'Hammer of Thunderbolts', ?, ?, ?, ?)`,
    ).run(DEFAULT_TEST_CAMPAIGN_ID, id, AT, CTX.provenance, CTX.sessionId, AT);
    expect(use(db, pack, id, 'giant-slaying-critical').operationId).toBe(
      'giant-slaying-critical',
    );
    db.close();
  });

  it('treats on-person as exact character custody', () => {
    const db = freshDbWithSession();
    const pack = packWith('luck-blade');
    const id = grant(db, 'luck-blade', 'luck-blade', pack);
    // The operation's roll-replacement economy remains engine-pending. Reaching
    // that later readiness refusal proves custody satisfied on-person.
    expect(() => use(db, pack, id, 'm10-use-luck')).toThrow(
      /no trusted semantic owner connecting this spend/,
    );
    db.close();
  });
});
