/** eshyra-0xaq.2: a held row already bound to its canonical pack ref but held
 * with no variant (before the item declared its variants, e.g. a Horn of
 * Valhalla held pre-olc5.14) has its variant established ONCE through
 * adopt_item. The establishment is durable, never a reselection, and refused
 * for any instance that already has facts created under the variant-less
 * identity. Real SRD pack, no waiver. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
  resolveCharacterId,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-10-18T10:00:00.000Z';
const HORN = 'magic-item:horn-of-valhalla';
const pack = getBundledDnd5eSrdPack();

function setup() {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(7),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'establish-variant',
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
  return { db, call, must };
}

type S = ReturnType<typeof setup>;

/** A pre-variant save's row: bound to the horn, no variant. */
function insertPreVariantHorn(s: S, id = 'pre-horn', quantity = 1): void {
  s.db
    .prepare(
      `INSERT INTO inventory(
         id, character_id, name, quantity, location, world_location_id,
         properties_json, provenance, session_id, updated_at, pack_ref,
         variant_id
       ) VALUES (?, ?, 'Horn of Valhalla', ?, 'backpack', NULL, '{}',
                 'test:pre-variant', ?, ?, ?, NULL)`,
    )
    .run(
      id,
      resolveCharacterId(s.db),
      quantity,
      DEFAULT_TEST_SESSION_ID,
      NOW,
      HORN,
    );
}

const variantOf = (s: S, id: string) =>
  (
    s.db.prepare('SELECT variant_id FROM inventory WHERE id = ?').get(id) as {
      variant_id: string | null;
    }
  ).variant_id;

const adopt = (s: S, id: string, variantId: string | undefined) =>
  s.call('adopt_item', {
    id,
    packRef: HORN,
    ...(variantId === undefined ? {} : { variantId }),
  });

describe('adopt_item establishes a held row variant once', () => {
  it('establishes the variant of a pre-variant horn and keeps it live for use_item', () => {
    const s = setup();
    insertPreVariantHorn(s);

    const established = adopt(s, 'pre-horn', 'brass');
    expect(established).toMatchObject({
      ok: true,
      data: {
        adopted: true,
        alreadyBound: true,
        establishedVariant: true,
        variantId: 'brass',
      },
    });
    expect(variantOf(s, 'pre-horn')).toBe('brass');
    expect(
      s.db
        .prepare(
          'SELECT campaign_id, pack_ref, variant_id, provenance, session_id, established_at FROM item_variant_establishment WHERE inventory_id = ?',
        )
        .get('pre-horn'),
    ).toEqual({
      campaign_id: DEFAULT_TEST_CAMPAIGN_ID,
      pack_ref: HORN,
      variant_id: 'brass',
      provenance: expect.stringMatching(/^model:/),
      session_id: DEFAULT_TEST_SESSION_ID,
      established_at: NOW,
    });

    // The established identity is live: the brass horn rolls 3d4+3 at use.
    s.must('start_encounter', {
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
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    const used = s.call('use_item', {
      instanceId: 'pre-horn',
      operationId: 'blow-horn',
    });
    expect(used, used.message).toMatchObject({ ok: true });
    const credit = (
      used.data as {
        hint?: {
          bindCredits?: {
            rolledCounts?: { notation: string }[];
          }[];
        };
      }
    ).hint?.bindCredits?.[0];
    expect(credit?.rolledCounts?.[0]?.notation).toBe('3d4+3');
  });

  it('never reselects: a second establishment with another variant is refused and the row stays brass', () => {
    const s = setup();
    insertPreVariantHorn(s);
    expect(adopt(s, 'pre-horn', 'brass')).toMatchObject({ ok: true });

    const reselect = adopt(s, 'pre-horn', 'iron');
    expect(reselect).toMatchObject({ ok: false });
    expect(variantOf(s, 'pre-horn')).toBe('brass');
    expect(
      s.db
        .prepare('SELECT COUNT(*) AS n FROM item_variant_establishment')
        .get(),
    ).toEqual({ n: 1 });
  });

  it('refuses a variant-bearing row given with one type when adopt_item names another', () => {
    const s = setup();
    const given = s.must('give_item', {
      id: 'silver-horn',
      name: 'Horn of Valhalla',
      packRef: HORN,
      variantId: 'silver',
    });
    const id = (given.data as { id: string }).id;
    expect(adopt(s, id, 'bronze')).toMatchObject({ ok: false });
    expect(variantOf(s, id)).toBe('silver');
  });

  it('refuses an instance that already holds a bind credit and leaves it unchanged', () => {
    const s = setup();
    insertPreVariantHorn(s);
    s.db
      .prepare(
        `INSERT INTO item_grant_bind_credit(
           credit_id, campaign_id, item_instance_id, pack_ref, variant_id,
           economy_id, operation_id, issued_at, provenance, session_id
         ) VALUES ('pre-horn:blow-horn:1', ?, 'pre-horn', ?, NULL,
                   'horn-charges', 'blow-horn', ?, 'test:credit', ?)`,
      )
      .run(DEFAULT_TEST_CAMPAIGN_ID, HORN, NOW, DEFAULT_TEST_SESSION_ID);
    const refused = adopt(s, 'pre-horn', 'brass');
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toMatch(/bind credit/);
    expect(variantOf(s, 'pre-horn')).toBeNull();
    expect(
      s.db
        .prepare('SELECT COUNT(*) AS n FROM item_variant_establishment')
        .get(),
    ).toEqual({ n: 0 });
  });

  it('refuses an undeclared variant and leaves the row unchanged', () => {
    const s = setup();
    insertPreVariantHorn(s);
    const refused = adopt(s, 'pre-horn', 'gold');
    expect(refused).toMatchObject({ ok: false });
    expect(variantOf(s, 'pre-horn')).toBeNull();
  });

  it('an establishment record retires its instance id after the row is destroyed', () => {
    const s = setup();
    const OLD = 'horn-of-valhalla#1';
    insertPreVariantHorn(s, OLD);
    expect(adopt(s, OLD, 'brass')).toMatchObject({ ok: true });
    s.must('remove_item', { id: OLD, disposition: 'destroyed' });

    // Neither an automatic nor an explicit allocation reissues the id, so the
    // brass trace keeps naming only the destroyed horn.
    const fresh = s.must('give_item', {
      id: 'horn-of-valhalla',
      name: 'Horn of Valhalla',
      packRef: HORN,
      variantId: 'iron',
    }) as { data: { id: string } };
    expect(fresh.data.id).not.toBe(OLD);
    const explicit = s.must('give_item', {
      id: OLD,
      name: 'Horn of Valhalla',
      packRef: HORN,
      variantId: 'silver',
    }) as { data: { id: string } };
    expect(explicit.data.id).not.toBe(OLD);
    expect(variantOf(s, fresh.data.id)).toBe('iron');
    expect(
      s.db
        .prepare(
          'SELECT variant_id FROM item_variant_establishment WHERE inventory_id = ?',
        )
        .get(OLD),
    ).toEqual({ variant_id: 'brass' });
  });
});
