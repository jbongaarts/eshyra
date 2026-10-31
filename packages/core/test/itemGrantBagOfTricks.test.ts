/** eshyra-olc5.16.1: the Bag of Tricks' creature selection at the use_item ->
 * start_effect grant-binding boundary, on the UNMODIFIED bundled pack with NO
 * readiness waiver.
 *
 *  - The bag's cloth color is the instance's variant (gray, rust, tan).
 *  - Each use makes the ENGINE roll a d8, select that row of the color's own
 *    table, persist the creature on the use's bind credit and show it in the
 *    hint (rolledCreatures); start_effect admits only that creature, naming
 *    that credit.
 *  - Another row of the same table, another color's creature, a bind naming no
 *    credit, another instance's credit and a second bind of the same credit are
 *    refused. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
} from '../src/internal.js';
import { readItemGrantRolledCreature } from '../src/state/itemGrantBinding.js';
import { useItem } from '../src/state/itemState.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-10-31T10:00:00.000Z';
const pack = getBundledDnd5eSrdPack();
const BAG = 'magic-item:bag-of-tricks';

const TABLES = {
  gray: [
    'weasel',
    'giant-rat',
    'badger',
    'boar',
    'panther',
    'giant-badger',
    'dire-wolf',
    'giant-elk',
  ],
  rust: [
    'rat',
    'owl',
    'mastiff',
    'goat',
    'giant-goat',
    'giant-boar',
    'lion',
    'brown-bear',
  ],
  tan: [
    'jackal',
    'ape',
    'baboon',
    'axe-beak',
    'black-bear',
    'giant-weasel',
    'giant-hyena',
    'tiger',
  ],
} as const;
type Color = keyof typeof TABLES;
const ref = (name: string) => `creature:${name}`;
const ALL = (['gray', 'rust', 'tan'] as const).flatMap((color) =>
  TABLES[color].map(ref),
);

function setup(seed: number) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(seed),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'olc5-16-1',
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
      // Every creature of the three tables is a durable campaign actor
      // (c-m<index>), so the bag's next-dawn lifetime is admitted.
      ...ALL.map((rulesRef, index) => ({
        actorId: `m${index}`,
        rulesRef,
        hpMax: 300,
        hpCurrent: 300,
        side: 'ally',
      })),
    ],
  });
  let round = 0;
  const give = (id: string, color: Color) =>
    (
      must('give_item', {
        id,
        name: 'Bag of Tricks',
        packRef: BAG,
        variantId: color,
      }).data as { id: string }
    ).id;
  const pull = (instanceId: string) => {
    round += 1;
    must('begin_turn', { character: 'pc-1', round });
    return call('use_item', { instanceId, operationId: 'pull-fuzzy-object' });
  };
  const bind = (
    effectId: string,
    instanceId: string,
    grantRef: string,
    creature: string,
    creditId: string | undefined,
    extra: Record<string, unknown> = {},
  ) =>
    call('start_effect', {
      effectId,
      kind: 'summoning',
      displayName: effectId,
      source: {
        kind: 'magic-item',
        ref: BAG,
        grantRef,
        itemInstanceId: instanceId,
        ...(creditId === undefined ? {} : { bindCreditId: creditId }),
      },
      actors: [{ combatantId: `c-m${ALL.indexOf(creature)}` }],
      ...extra,
    });
  return { db, call, must, give, pull, bind };
}

interface Credit {
  creditId: string;
  grantIds: string[];
  rolledCreatures?: {
    grantId: string;
    notation: string;
    roll: number;
    creatureRef: string;
  }[];
}
const creditsOf = (result: { data?: unknown }): Credit[] =>
  (result.data as { hint?: { bindCredits?: Credit[] } }).hint?.bindCredits ??
  [];

describe('Bag of Tricks: the bag color is the variant and the engine-rolled d8 creature is bound to the use', () => {
  it('rolls the color table row at use_item, persists it, and binds exactly that creature', () => {
    const s = setup(11);
    const id = s.give('bag', 'gray');
    const used = s.pull(id);
    expect(used, used.message).toMatchObject({ ok: true });
    const [credit] = creditsOf(used);
    // Only the gray bag's grant is listed for its credit.
    expect(credit?.grantIds).toEqual(['gray-bag-creature']);
    const rolled = credit?.rolledCreatures?.[0];
    expect(rolled).toMatchObject({
      grantId: 'gray-bag-creature',
      notation: '1d8',
    });
    const k = rolled?.roll as number;
    expect(Number.isInteger(k) && k >= 1 && k <= 8).toBe(true);
    expect(rolled?.creatureRef).toBe(ref(TABLES.gray[k - 1] as string));
    const creditId = credit?.creditId as string;

    // Persisted on the credit, reloaded identically (nothing re-rolls).
    expect(
      readItemGrantRolledCreature(s.db, creditId, 'gray-bag-creature'),
    ).toEqual(rolled);

    // A caller-supplied creature or roll is not accepted: the tool schema has no
    // such field and refuses it.
    const supplied = s.bind(
      'fx-supplied',
      id,
      'gray-bag-creature',
      rolled?.creatureRef as string,
      creditId,
      { creatureRef: 'creature:weasel', rolledCreature: 'creature:weasel' },
    );
    expect(supplied).toMatchObject({ ok: false });

    const bound = s.bind(
      'fx-ok',
      id,
      'gray-bag-creature',
      rolled?.creatureRef as string,
      creditId,
    );
    expect(bound, bound.message).toMatchObject({ ok: true });
    expect(
      (
        s.db
          .prepare(
            'SELECT redeemed_effect_id AS r FROM item_grant_bind_credit WHERE credit_id = ?',
          )
          .get(creditId) as { r: string }
      ).r,
    ).toBe('fx-ok');
  });

  it('refuses another row of the same table, another color, no credit, another instance, and a second bind', () => {
    const s = setup(5);
    const id = s.give('bag', 'gray');
    const other = s.give('bag-2', 'gray');
    const used = s.pull(id);
    const [credit] = creditsOf(used);
    const creditId = credit?.creditId as string;
    const rolled = credit?.rolledCreatures?.[0]?.creatureRef as string;
    const k = credit?.rolledCreatures?.[0]?.roll as number;
    const open = () =>
      (
        s.db
          .prepare(
            'SELECT COUNT(*) AS n FROM item_grant_bind_credit WHERE redeemed_effect_id IS NULL',
          )
          .get() as { n: number }
      ).n;

    // Another row of the SAME gray table, though printed on the bag's table.
    const sibling = ref(TABLES.gray[k % 8] as string);
    expect(sibling).not.toBe(rolled);
    const sameTable = s.bind(
      'fx-row',
      id,
      'gray-bag-creature',
      sibling,
      creditId,
    );
    expect(sameTable).toMatchObject({ ok: false });
    expect(sameTable.message).toContain(
      `use '${creditId}' rolled 1d8 = ${k}: ${rolled}`,
    );
    expect(sameTable.message).toContain(
      `linked actor 'c-m${ALL.indexOf(sibling)}' is ${sibling}`,
    );

    // A creature of another color's table (rust rat) under the gray grant.
    const rustCreature = ref(TABLES.rust[0] as string);
    expect(
      s.bind('fx-rust', id, 'gray-bag-creature', rustCreature, creditId),
    ).toMatchObject({ ok: false });
    // The rust grant on a gray bag: not this instance's variant.
    const rustGrant = s.bind(
      'fx-rust-grant',
      id,
      'rust-bag-creature',
      rustCreature,
      creditId,
    );
    expect(rustGrant).toMatchObject({ ok: false });
    expect(rustGrant.message).toMatch(/belongs to variant\(s\) rust/);

    // No credit named: a rolled creature belongs to one use.
    const unnamed = s.bind(
      'fx-unnamed',
      id,
      'gray-bag-creature',
      rolled,
      undefined,
    );
    expect(unnamed).toMatchObject({ ok: false });
    expect(unnamed.message).toMatch(/give source\.bindCreditId/);

    // The credit of an unrelated instance (the second bag, unused) and a credit
    // id that does not exist.
    const foreign = s.bind(
      'fx-foreign',
      other,
      'gray-bag-creature',
      rolled,
      creditId,
    );
    expect(foreign).toMatchObject({ ok: false });
    expect(foreign.message).toMatch(/is not an unredeemed use/);
    expect(
      s.bind('fx-none', id, 'gray-bag-creature', rolled, 'no-such-credit'),
    ).toMatchObject({ ok: false });

    // Every refusal left the credit open; the rolled creature then binds, once.
    expect(open()).toBe(1);
    expect(
      s.bind('fx-ok', id, 'gray-bag-creature', rolled, creditId),
    ).toMatchObject({ ok: true });
    expect(open()).toBe(0);
    const again = s.bind('fx-again', id, 'gray-bag-creature', rolled, creditId);
    expect(again).toMatchObject({ ok: false });
    expect(again.message).toMatch(/is not an unredeemed use/);
  });

  it('refuses a bind against a credit with no recorded engine roll, or one that records another grant, notation or out-of-range row', () => {
    const s = setup(3);
    const id = s.give('bag', 'gray');
    const [credit] = creditsOf(s.pull(id));
    const creditId = credit?.creditId as string;
    const rolled = credit?.rolledCreatures?.[0];
    const creature = rolled?.creatureRef as string;
    const stored = (
      s.db
        .prepare('SELECT rolled_creatures_json FROM item_grant_bind_credit')
        .get() as { rolled_creatures_json: string }
    ).rolled_creatures_json;
    const setStored = (value: string | null) =>
      s.db
        .prepare('UPDATE item_grant_bind_credit SET rolled_creatures_json = ?')
        .run(value);
    const attempt = (effectId: string) =>
      s.bind(effectId, id, 'gray-bag-creature', creature, creditId);

    // Absent (a credit predating the roll, or tampered), malformed, another
    // grant, another notation, a row outside 1..N, a non-string creature.
    const tampered: [string, string | null][] = [
      ['null', null],
      ['malformed', '{not json'],
      ['not an array', '{}'],
      ['grant', stored.replace('gray-bag-creature', 'rust-bag-creature')],
      ['notation', stored.replace('1d8', '1d6')],
      ['row 0', stored.replace(/"roll":\d/, '"roll":0')],
      ['row 9', stored.replace(/"roll":\d/, '"roll":9')],
      ['creature', stored.replace(/"creatureRef":"[^"]*"/, '"creatureRef":7')],
    ];
    for (const [label, value] of tampered) {
      setStored(value);
      const refused = attempt(`fx-${label}`);
      expect(refused, label).toMatchObject({ ok: false });
      expect(refused.message, label).toMatch(/records no engine roll/);
      // A well-formed roll of another notation is readable; the binder refuses
      // it on the grant's own notation.
      if (label !== 'notation')
        expect(
          readItemGrantRolledCreature(s.db, creditId, 'gray-bag-creature'),
          label,
        ).toBeUndefined();
    }
    expect(s.db.prepare('SELECT 1 FROM active_effect').get()).toBeUndefined();

    // Restored, the same bind succeeds.
    setStored(stored);
    expect(attempt('fx-ok')).toMatchObject({ ok: true });
  });

  it('every color rolls on its own table: the credit lists only that color, and the rolled creature binds', () => {
    for (const color of ['gray', 'rust', 'tan'] as const) {
      const rolls = new Set<number>();
      for (const seed of [1, 2, 3, 4]) {
        const s = setup(seed);
        const id = s.give('bag', color);
        const [credit] = creditsOf(s.pull(id));
        expect(credit?.grantIds, color).toEqual([`${color}-bag-creature`]);
        const rolled = credit?.rolledCreatures?.[0];
        expect(rolled?.grantId).toBe(`${color}-bag-creature`);
        expect(rolled?.creatureRef).toBe(
          ref(TABLES[color][(rolled?.roll as number) - 1] as string),
        );
        rolls.add(rolled?.roll as number);
        const bound = s.bind(
          'fx',
          id,
          `${color}-bag-creature`,
          rolled?.creatureRef as string,
          credit?.creditId,
        );
        expect(bound, `${color} ${seed}: ${bound.message}`).toMatchObject({
          ok: true,
        });
        // Another color's grant is not this bag's.
        const otherColor = color === 'gray' ? 'rust' : 'gray';
        expect(
          s.bind(
            'fx-other',
            id,
            `${otherColor}-bag-creature`,
            rolled?.creatureRef as string,
            credit?.creditId,
          ),
        ).toMatchObject({ ok: false });
      }
      // The d8 varies across seeds (not a constant row).
      expect(rolls.size).toBeGreaterThan(1);
    }
  }, 30_000);

  it('rolls each use anew, deterministically for a seed; three pulls per dawn and a fourth is refused', () => {
    const rollsFor = (seed: number) => {
      const s = setup(seed);
      const id = s.give('bag', 'tan');
      const rolls: number[] = [];
      for (let i = 0; i < 3; i++) {
        const used = s.pull(id);
        expect(used, used.message).toMatchObject({ ok: true });
        rolls.push(creditsOf(used)[0]?.rolledCreatures?.[0]?.roll as number);
      }
      // The uses economy still holds: the fourth pull is refused, no credit.
      expect(s.pull(id)).toMatchObject({ ok: false });
      expect(
        (
          s.db
            .prepare('SELECT COUNT(*) AS n FROM item_grant_bind_credit')
            .get() as { n: number }
        ).n,
      ).toBe(3);
      return rolls;
    };
    expect(rollsFor(21)).toEqual(rollsFor(21));
  });

  it('refuses use_item without seeded RNG, leaving no credit', () => {
    const s = setup(2);
    const id = s.give('bag', 'gray');
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    expect(() =>
      useItem(s.db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        instanceId: id,
        operationId: 'pull-fuzzy-object',
        characterId: 'pc-1',
        provenance: 'test:no-rng',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
        resolveRulesPack: () => pack,
      }),
    ).toThrow(/seeded RNG is required/);
    expect(
      s.db.prepare('SELECT 1 FROM item_grant_bind_credit').get(),
    ).toBeUndefined();
  });

  it('fails closed for a bag with no established color', () => {
    const s = setup(2);
    const refused = s.call('give_item', {
      id: 'bag',
      name: 'Bag of Tricks',
      packRef: BAG,
    });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toMatch(/requires variantId/);
  });
});
