import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  auditActiveEffectIntegrity,
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
  listActiveEffects,
  updateCampaignActor,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

// eshyra-ffoo (Option C): a creature bound to a grant that prints no ending
// (Pipes of the Sewers' called rat swarms) that is reduced to 0 hit points in
// the ordinary way closes exactly its own actor link, and the effect ends only
// when no owned creature remains. The creature is NOT removed: its corpse and
// combatant stay in play. The credit stays redeemed. Driven on the unmodified
// bundled pack and the default tool registry.

const pack = getBundledDnd5eSrdPack();
const PIPES = 'magic-item:pipes-of-the-sewers';
const AT = '2026-10-31T00:00:00.000Z';

type Where = 'in-combat' | 'after-close-combat';

function scenario(swarms: number) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(23),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'ffoo3',
    at: AT,
    resolveRulesPack: () => pack,
  };
  const must = (name: string, args: unknown) => {
    const result = registry.invoke(name, args, ctx);
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
      ...Array.from({ length: swarms }, (_, n) => ({
        actorId: `s${n}`,
        rulesRef: 'creature:swarm-of-rats',
        hpMax: 24,
        hpCurrent: 24,
        side: 'ally',
      })),
    ],
  });
  must('begin_turn', { character: 'pc-1', round: 1 });
  const id = (
    must('give_item', {
      id: 'pipes',
      name: 'Pipes of the Sewers',
      packRef: PIPES,
    }).data as { id: string }
  ).id;
  must('attune_item', { character: 'pc-1', itemId: id });
  const used = must('use_item', {
    instanceId: id,
    operationId: 'call-rat-swarms',
    args: { costs: { charges: swarms } },
  });
  const creditId = (
    used.data as { hint?: { bindCredits?: { creditId: string }[] } }
  ).hint?.bindCredits?.[0]?.creditId as string;
  must('start_effect', {
    effectId: 'fx-swarms',
    kind: 'summoning',
    displayName: 'called swarms',
    source: {
      kind: 'magic-item',
      ref: PIPES,
      grantRef: 'called-rat-swarms',
      itemInstanceId: id,
      bindCreditId: creditId,
    },
    actors: Array.from({ length: swarms }, (_, n) => ({
      combatantId: `c-s${n}`,
      campaignActorId: `s${n}`,
    })),
    duration: { kind: 'until-removed' },
  });
  return { db, must, creditId };
}

function snapshot(db: ReturnType<typeof freshDbWithSession>, creditId: string) {
  const links = db
    .prepare(
      `SELECT projection_ref, status, removed_reason FROM active_effect_link
       WHERE effect_id = 'fx-swarms' AND link_kind = 'actor' ORDER BY projection_ref`,
    )
    .all() as {
    projection_ref: string;
    status: string;
    removed_reason: string | null;
  }[];
  const effect = listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, {
    includeEnded: true,
  }).find((e) => e.effectId === 'fx-swarms');
  const credit = db
    .prepare(
      'SELECT redeemed_effect_id FROM item_grant_bind_credit WHERE credit_id = ?',
    )
    .get(creditId) as { redeemed_effect_id: string | null };
  const events = db
    .prepare(
      "SELECT event_kind FROM active_effect_event WHERE effect_id = 'fx-swarms' ORDER BY rowid",
    )
    .all() as { event_kind: string }[];
  return { links, effect, credit, events: events.map((e) => e.event_kind) };
}

describe('ordinary 0 HP closes the link of a no-printed-ending grant (Pipes, real pack)', () => {
  for (const where of ['in-combat', 'after-close-combat'] as Where[]) {
    for (const swarms of [1, 2]) {
      it(`${where}, ${swarms} swarm(s): each death closes only its own link; the effect ends with the last; credit stays redeemed; swarms stay in play`, () => {
        const { db, must, creditId } = scenario(swarms);
        try {
          if (where === 'after-close-combat')
            must('close_combat_instance', { status: 'completed' });
          const kill = (n: number) => {
            if (where === 'in-combat')
              must('update_combatant', {
                combatantId: `c-s${n}`,
                hpDelta: -24,
              });
            else
              updateCampaignActor(db, {
                campaignId: DEFAULT_TEST_CAMPAIGN_ID,
                actorId: `s${n}`,
                hpCurrent: 0,
                status: 'dead',
                provenance: 'test:ffoo3',
                sessionId: DEFAULT_TEST_SESSION_ID,
                at: AT,
                resolveRulesPack: () => pack,
              });
          };
          const before = snapshot(db, creditId);
          expect(before.links.every((l) => l.status === 'active')).toBe(true);
          expect(before.effect?.status).toBe('active');

          for (let n = 0; n < swarms; n += 1) {
            kill(n);
            const now = snapshot(db, creditId);
            for (let m = 0; m < swarms; m += 1)
              expect(now.links[m]?.status).toBe(m <= n ? 'removed' : 'active');
            expect(now.links[n]?.removed_reason).toBe('zero-hit-points');
            const last = n === swarms - 1;
            expect(now.effect?.status).toBe(last ? 'ended' : 'active');
            if (last)
              expect(now.effect).toMatchObject({
                endReason: 'source-removed',
                endDetail: 'zero-hit-points',
              });
            // The credit stays redeemed throughout.
            expect(now.credit.redeemed_effect_id).toBe('fx-swarms');
            // Exactly one terminal event, and it is the last event.
            expect(now.events.filter((e) => e === 'ended')).toHaveLength(
              last ? 1 : 0,
            );
            if (last) expect(now.events.at(-1)).toBe('ended');
          }

          // The dead swarms stay in play (no vanish): hit points 0, status dead.
          for (let n = 0; n < swarms; n += 1) {
            const actor = db
              .prepare(
                'SELECT status, hp_current FROM campaign_actor WHERE actor_id = ?',
              )
              .get(`s${n}`) as { status: string; hp_current: number };
            expect(actor).toMatchObject({ status: 'dead', hp_current: 0 });
          }
          if (where === 'in-combat') {
            const rows = db
              .prepare(
                "SELECT status, hp_current FROM encounter_combatant WHERE combatant_id LIKE 'c-s%'",
              )
              .all() as { status: string; hp_current: number }[];
            expect(rows).toHaveLength(swarms);
            for (const row of rows)
              expect(row).toMatchObject({ status: 'dead', hp_current: 0 });
          }
          expect(
            auditActiveEffectIntegrity(db, DEFAULT_TEST_CAMPAIGN_ID).filter(
              (issue) => issue.effectId === 'fx-swarms',
            ),
          ).toEqual([]);
        } finally {
          db.close();
        }
      });
    }
  }
});
