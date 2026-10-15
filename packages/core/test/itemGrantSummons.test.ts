/** olc5.12: item entity grants bound through start_effect summoning, their
 * printed revertOn endings, and the grant-ended cooldown anchor. Every case
 * uses the bundled pack's real grant records. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  advanceWorldTime,
  attuneItem,
  createDefaultToolRegistry,
  createInitialItemState,
  createSeededRng,
  donItem,
  expireElapsedWorldEffects,
  getBundledDnd5eSrdPack,
  giveItem,
  ITEM_GRANT_REVERT_DISPOSITIONS,
  listActiveEffects,
  readItemState,
  useItem,
  writeItemState,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-10-15T10:00:00.000Z';
const pack = getBundledDnd5eSrdPack();

function packRecord(key: string) {
  const found = pack.records.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`bundled pack has no ${key}`);
  return found;
}

/** The pack with one item's readiness waived (every clause green). Mirrors
 * the olc5.8 cooldown-anchor precedent: the grant hooks stay unlanded, so the
 * readiness preflight would refuse the use step, while this file exercises
 * the grant lifecycle and the cooldown boundary itself. */
function waivedPack(key: string) {
  return {
    ...pack,
    records: pack.records.map((record) => {
      if (record.key !== key) return record;
      const data = record.data as Record<string, unknown>;
      const readiness = data.executionReadiness as {
        source: string;
        clauses: Record<string, unknown>[];
      };
      return {
        ...record,
        data: {
          ...data,
          executionReadiness: {
            ...readiness,
            clauses: readiness.clauses.map((clause) => ({
              ...clause,
              readiness: 'green',
              missingHooks: undefined,
              missingEngines: undefined,
            })),
          },
        },
      };
    }),
  };
}

/** Spends one operation through the real use_item path and returns its result. */
function spend(
  db: ReturnType<typeof freshDbWithSession>,
  instanceId: string,
  operationId: string,
  resolvePack: typeof pack,
  rngSeed = 3,
) {
  return useItem(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    instanceId,
    operationId,
    characterId: 'pc-1',
    provenance: 'test:item-grant-spend',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: NOW,
    rng: createSeededRng(rngSeed),
    resolveRulesPack: () => resolvePack,
  });
}

function setup(resolvePack = pack) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(7),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'olc5-12',
    at: NOW,
    resolveRulesPack: () => resolvePack,
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
        actorId: 'wiz',
        rulesRef: 'creature:goblin',
        hpMax: 20,
        hpCurrent: 20,
        side: 'ally',
      },
      {
        actorId: 'djinni',
        rulesRef: 'creature:djinni',
        hpMax: 161,
        hpCurrent: 161,
        side: 'ally',
      },
      {
        actorId: 'dog',
        rulesRef: 'creature:mastiff',
        hpMax: 5,
        hpCurrent: 5,
        side: 'ally',
      },
      {
        actorId: 'weasel',
        rulesRef: 'creature:weasel',
        hpMax: 1,
        hpCurrent: 1,
        side: 'ally',
      },
      {
        actorId: 'goblin',
        rulesRef: 'creature:goblin',
        hpMax: 7,
        hpCurrent: 7,
        side: 'ally',
      },
      {
        actorId: 'efreeti',
        rulesRef: 'creature:efreeti',
        hpMax: 200,
        hpCurrent: 200,
        side: 'ally',
      },
    ],
  });
  const domainCtx = {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    characterId: 'pc-1',
    provenance: 'test:item-grant-summons',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: NOW,
  };
  const install = (
    key: string,
    id: string,
    options: { worn?: boolean; variantId?: string; state?: boolean } = {},
  ) => {
    const record = packRecord(key);
    const created = giveItem(
      db,
      {
        id,
        name: record.name,
        packRef: record.key,
        stateful: true,
        ...(options.variantId === undefined
          ? {}
          : { variantId: options.variantId }),
      },
      domainCtx,
    );
    if (options.state !== false)
      writeItemState(
        db,
        created.id,
        createInitialItemState(record.key, record, {
          ...(options.variantId === undefined
            ? {}
            : { variantId: options.variantId }),
        }),
        domainCtx,
      );
    if (options.worn) donItem(db, { ...domainCtx, itemId: created.id });
    if ((record.data as Record<string, unknown>).requiresAttunement === true)
      attuneItem(db, {
        ...domainCtx,
        characterRef: 'pc-1',
        itemId: created.id,
        itemRef: record.key,
      });
    return created.id;
  };
  const summon = (
    effectId: string,
    source: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) =>
    call('start_effect', {
      effectId,
      kind: 'summoning',
      displayName: effectId,
      source: { kind: 'magic-item', ...source },
      actors: [{ combatantId: 'c-djinni' }],
      ...extra,
    });
  const effect = (effectId: string) =>
    listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, {
      includeEnded: true,
    }).find((row) => row.effectId === effectId);
  const hit = (combatantId: string, hpDelta: number) =>
    must('update_combatant', { combatantId, hpDelta });
  return { db, ctx, call, must, install, summon, effect, hit, domainCtx };
}

describe('olc5.12 item-granted creatures', () => {
  it('binds a printed grant with its typed duration and ends at 0 hit points', () => {
    const s = setup(waivedPack('magic-item:ring-of-djinni-summoning'));
    const ringId = s.install('magic-item:ring-of-djinni-summoning', 'ring-1', {
      worn: true,
    });
    // Spend the ring's one summon through the real operation so the cooldown
    // economy is depleted before the grant is started.
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    useItem(s.db, {
      ...s.domainCtx,
      instanceId: ringId,
      operationId: 'summon-djinni',
      rng: createSeededRng(3),
      resolveRulesPack: () => waivedPack('magic-item:ring-of-djinni-summoning'),
    } as never);
    expect(readItemState(s.db, ringId)?.economies?.cooldown?.remaining).toBe(0);

    const bound = s.summon(
      'fx-djinni',
      {
        ref: 'magic-item:ring-of-djinni-summoning',
        grantRef: 'particular-djinni',
        itemInstanceId: ringId,
      },
      { concentrationOwner: { kind: 'combatant', ref: 'c-wiz' } },
    );
    expect(bound).toMatchObject({
      ok: true,
      data: {
        effect: {
          duration: { kind: 'timed', amount: 1, unit: 'hour' },
          durationProvenance: { kind: 'typed-fixed', amount: 1, unit: 'hour' },
        },
      },
    });
    expect(
      readItemState(s.db, ringId)?.economies?.cooldown?.availableAt,
    ).toBeUndefined();

    s.hit('c-djinni', -161);
    expect(s.effect('fx-djinni')).toMatchObject({ status: 'ended' });
    // The grant ended at 0 hit points, so the depleted summon cooldown starts
    // its 24-hour wait from that moment (elapsed 0 here).
    expect(readItemState(s.db, ringId)?.economies?.cooldown?.availableAt).toBe(
      '1440',
    );
    advanceWorldTime(s.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      minutes: 1440,
      provenance: 'test:ring-zero-hp-wait',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
      resolveRulesPack: () => waivedPack('magic-item:ring-of-djinni-summoning'),
      rng: createSeededRng(5),
    });
    expect(readItemState(s.db, ringId)?.economies?.cooldown?.remaining).toBe(1);
  });

  it('accepts a printed creature and refuses a different creature, count, or duration', () => {
    const s = setup();
    const dogId = s.install(
      'magic-item:figurine-of-wondrous-power',
      'figurine-1',
      { variantId: 'onyx-dog' },
    );
    const figurine = {
      ref: 'magic-item:figurine-of-wondrous-power',
      itemInstanceId: dogId,
    };
    const wrong = s.summon(
      'fx-wrong-creature',
      { ...figurine, grantRef: 'onyx-dog' },
      {
        actors: [{ combatantId: 'c-goblin' }],
      },
    );
    expect(wrong).toMatchObject({ ok: false });
    expect(wrong.message).toMatch(/does not create/);
    const two = s.summon(
      'fx-two',
      { ...figurine, grantRef: 'onyx-dog' },
      {
        actors: [{ combatantId: 'c-dog' }, { combatantId: 'c-goblin' }],
      },
    );
    expect(two).toMatchObject({ ok: false });
    const longer = s.summon(
      'fx-longer',
      { ...figurine, grantRef: 'onyx-dog' },
      {
        duration: {
          kind: 'timed',
          amount: 5,
          unit: 'hour',
          anchor: 'effect-created',
        },
        actors: [{ combatantId: 'c-dog' }],
      },
    );
    expect(longer).toMatchObject({ ok: false });
    const ok = s.summon(
      'fx-onyx',
      { ...figurine, grantRef: 'onyx-dog' },
      {
        actors: [{ combatantId: 'c-dog' }],
      },
    );
    expect(ok).toMatchObject({
      ok: true,
      data: {
        effect: {
          duration: { amount: 6, unit: 'hour' },
          durationProvenance: { kind: 'typed-fixed', amount: 6, unit: 'hour' },
        },
      },
    });
    // The owner's command is a printed ending the DM adjudicates.
    const ended = s.must('end_effect', {
      effectId: 'fx-onyx',
      reason: 'ruled',
      note: 'owner command while touching the figurine',
    });
    expect(ended.ok).toBe(true);
    expect(s.effect('fx-onyx')).toMatchObject({
      status: 'ended',
      endReason: 'ruled',
    });
  });

  it('accepts a table row creature for the Bag of Tricks and refuses a non-row creature', () => {
    const s = setup();
    const bagId = s.install('magic-item:bag-of-tricks', 'bag-1');
    const bag = {
      ref: 'magic-item:bag-of-tricks',
      grantRef: 'bag-creature',
      itemInstanceId: bagId,
    };
    const refused = s.summon('fx-bag-djinni', bag, {
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-djinni' }],
    });
    expect(refused).toMatchObject({ ok: false });
    const accepted = s.summon('fx-bag-weasel', bag, {
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-weasel' }],
    });
    expect(accepted.ok).toBe(true);
    // Reduced to 0 hit points is a modeled ending: the weasel vanishes and the effect ends.
    s.hit('c-weasel', -1);
    expect(s.effect('fx-bag-weasel')).toMatchObject({ status: 'ended' });
  });

  it('ends a timed grant automatically at expiry', () => {
    const bottle = waivedPack('magic-item:efreeti-bottle');
    const s = setup(bottle);
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    const bottleId = s.install('magic-item:efreeti-bottle', 'bottle-1');
    // The serving grant's stopper is paid by remove-stopper, so the bind
    // follows the spend.
    spend(s.db, bottleId, 'remove-stopper', bottle);
    const bound = s.summon(
      'fx-serving',
      {
        ref: 'magic-item:efreeti-bottle',
        grantRef: 'serving-efreeti',
        itemInstanceId: bottleId,
      },
      { actors: [{ combatantId: 'c-efreeti' }] },
    );
    expect(bound.ok).toBe(true);
    const expired = expireElapsedWorldEffects(s.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      elapsedMinutes: 60,
      provenance: 'test:expiry',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(expired.map((e) => e.effectId)).toContain('fx-serving');
    expect(s.effect('fx-serving')).toMatchObject({
      status: 'ended',
      endReason: 'expired',
    });
  });

  it('refuses illusion grants, a missing concentration owner, and a missing item instance', () => {
    const s = setup();
    const deckId = s.install('magic-item:deck-of-illusions', 'deck-1', {
      state: false,
    });
    const illusion = s.summon(
      'fx-card',
      {
        ref: 'magic-item:deck-of-illusions',
        grantRef: 'card-illusion',
        itemInstanceId: deckId,
      },
      {
        duration: { kind: 'until-removed' },
        actors: [{ combatantId: 'c-goblin' }],
      },
    );
    expect(illusion).toMatchObject({ ok: false });
    expect(illusion.message).toMatch(/DM-adjudicated/);
    const ringId = s.install('magic-item:ring-of-djinni-summoning', 'ring-2', {
      worn: true,
    });
    const noConcentration = s.summon('fx-no-conc', {
      ref: 'magic-item:ring-of-djinni-summoning',
      grantRef: 'particular-djinni',
      itemInstanceId: ringId,
    });
    expect(noConcentration).toMatchObject({ ok: false });
    expect(noConcentration.message).toMatch(/concentrationOwner/);
    const noItem = s.summon('fx-no-item', {
      ref: 'magic-item:ring-of-djinni-summoning',
      grantRef: 'particular-djinni',
    });
    expect(noItem).toMatchObject({ ok: false });
    expect(noItem.message).toMatch(/itemInstanceId/);
  });

  it('fails closed on a revertOn value the engine does not map', () => {
    const mutated = {
      ...pack,
      records: pack.records.map((record) => {
        if (record.key !== 'magic-item:ring-of-djinni-summoning') return record;
        const data = record.data as Record<string, unknown>;
        const mechanics = data.mechanics as Record<string, unknown>;
        const entityGrant = mechanics.entityGrant as {
          grants: Record<string, unknown>[];
        };
        return {
          ...record,
          data: {
            ...data,
            mechanics: {
              ...mechanics,
              entityGrant: {
                ...entityGrant,
                grants: entityGrant.grants.map((grant) => ({
                  ...grant,
                  revertOn: ['djinni-is-bored'],
                })),
              },
            },
          },
        };
      }),
    };
    const s = setup(mutated);
    const ringId = s.install('magic-item:ring-of-djinni-summoning', 'ring-3', {
      worn: true,
    });
    const refused = s.summon(
      'fx-unmapped',
      {
        ref: 'magic-item:ring-of-djinni-summoning',
        grantRef: 'particular-djinni',
        itemInstanceId: ringId,
      },
      { concentrationOwner: { kind: 'combatant', ref: 'c-wiz' } },
    );
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toMatch(/does not map/);
  });

  it('maps every printed grant revertOn value in the bundled pack', () => {
    const values = new Set<string>();
    for (const record of pack.records) {
      const grants = (
        (record.data as Record<string, unknown>).mechanics as
          | { entityGrant?: { grants: { revertOn?: string[] }[] } }
          | undefined
      )?.entityGrant?.grants;
      for (const grant of grants ?? [])
        for (const value of grant.revertOn ?? []) values.add(value);
    }
    expect(values.size).toBeGreaterThan(0);
    const unmapped = [...values].filter(
      (value) => !Object.hasOwn(ITEM_GRANT_REVERT_DISPOSITIONS, value),
    );
    expect(unmapped).toEqual([]);
  });

  it('couples the Ring spend with its bind: refuses an unspent or repeated bind and hints the spend', () => {
    const ring = waivedPack('magic-item:ring-of-djinni-summoning');
    const s = setup(ring);
    const ringId = s.install('magic-item:ring-of-djinni-summoning', 'ring-4', {
      worn: true,
    });
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    const grantSource = {
      ref: 'magic-item:ring-of-djinni-summoning',
      grantRef: 'particular-djinni',
      itemInstanceId: ringId,
    };
    const owner = { concentrationOwner: { kind: 'character', ref: 'pc-1' } };
    const unspent = s.summon('fx-unspent', grantSource, owner);
    expect(unspent).toMatchObject({ ok: false });
    expect(unspent.message).toMatch(/use_item 'summon-djinni' first/);

    const spent = spend(s.db, ringId, 'summon-djinni', ring);
    expect(spent.hint).toEqual({ bindGrant: 'particular-djinni' });
    expect(spent.costs).toEqual([{ economy: 'cooldown', amount: 1 }]);

    expect(s.summon('fx-djinni', grantSource, owner)).toMatchObject({
      ok: true,
    });
    // A second live summon of the same spend is refused: the grant is bound.
    const joined = s.call('join_combat', {
      creatures: [
        { rulesRef: 'creature:djinni', side: 'ally', displayLabel: 'djinni-2' },
      ],
    });
    expect(joined).toMatchObject({ ok: true });
    const secondId = (
      joined as unknown as { data: { joined: { combatantId: string }[] } }
    ).data.joined[0]?.combatantId as string;
    const repeated = s.summon('fx-repeat', grantSource, {
      ...owner,
      actors: [{ combatantId: secondId, campaignActorId: 'djinni-2' }],
    });
    expect(repeated).toMatchObject({ ok: false });
    expect(repeated.message).toMatch(/already bound/);
  });

  it('ends a bound Ring summon by DM ruling and starts the 24-hour wait, which then resets', () => {
    const ring = waivedPack('magic-item:ring-of-djinni-summoning');
    const s = setup(ring);
    const ringId = s.install('magic-item:ring-of-djinni-summoning', 'ring-5', {
      worn: true,
    });
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    spend(s.db, ringId, 'summon-djinni', ring);
    expect(
      s.summon(
        'fx-ruled',
        {
          ref: 'magic-item:ring-of-djinni-summoning',
          grantRef: 'particular-djinni',
          itemInstanceId: ringId,
        },
        { concentrationOwner: { kind: 'character', ref: 'pc-1' } },
      ),
    ).toMatchObject({ ok: true });
    const ruled = s.must('end_effect', {
      effectId: 'fx-ruled',
      reason: 'ruled',
      note: 'the djinni returns to its plane',
    });
    expect(ruled.ok).toBe(true);
    expect(s.effect('fx-ruled')).toMatchObject({
      status: 'ended',
      endReason: 'ruled',
    });
    const advance = (minutes: number) =>
      advanceWorldTime(s.db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        minutes,
        provenance: 'test:ring-wait',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
        resolveRulesPack: () => ring,
        rng: createSeededRng(5),
      });
    expect(readItemState(s.db, ringId)?.economies?.cooldown?.availableAt).toBe(
      '1440',
    );
    advance(1439);
    expect(readItemState(s.db, ringId)?.economies?.cooldown?.remaining).toBe(0);
    advance(1);
    expect(readItemState(s.db, ringId)?.economies?.cooldown?.remaining).toBe(1);
    expect(
      readItemState(s.db, ringId)?.economies?.cooldown?.availableAt,
    ).toBeUndefined();
  });

  it('pays the Efreeti serving grant with the stopper: fresh bottle has it, the spend is required, expiry schedules the wait', () => {
    const bottle = waivedPack('magic-item:efreeti-bottle');
    const s = setup(bottle);
    const bottleId = s.install('magic-item:efreeti-bottle', 'bottle-2');
    expect(readItemState(s.db, bottleId)?.economies?.stopper?.remaining).toBe(
      1,
    );
    const serving = {
      ref: 'magic-item:efreeti-bottle',
      grantRef: 'serving-efreeti',
      itemInstanceId: bottleId,
    };
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    expect(
      s.summon('fx-unpaid', serving, {
        actors: [{ combatantId: 'c-efreeti' }],
      }),
    ).toMatchObject({
      ok: false,
    });
    const removed = spend(s.db, bottleId, 'remove-stopper', bottle);
    expect(removed.costs).toEqual([{ economy: 'stopper', amount: 1 }]);
    expect(removed.hint).toEqual({ bindGrant: 'serving-efreeti' });
    expect(readItemState(s.db, bottleId)?.economies?.stopper?.remaining).toBe(
      0,
    );
    expect(
      s.summon('fx-efreeti', serving, {
        actors: [{ combatantId: 'c-efreeti' }],
      }),
    ).toMatchObject({
      ok: true,
    });
    const advance = (minutes: number) =>
      advanceWorldTime(s.db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        minutes,
        provenance: 'test:efreeti-wait',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
        resolveRulesPack: () => bottle,
        rng: createSeededRng(5),
      });
    advance(60);
    expect(s.effect('fx-efreeti')).toMatchObject({
      status: 'ended',
      endReason: 'expired',
    });
    // The efreeti returns at the hour mark; the stopper waits 24 hours from it.
    expect(readItemState(s.db, bottleId)?.economies?.stopper?.availableAt).toBe(
      '1500',
    );
    advance(1439);
    expect(readItemState(s.db, bottleId)?.economies?.stopper?.remaining).toBe(
      0,
    );
    advance(1);
    expect(readItemState(s.db, bottleId)?.economies?.stopper?.remaining).toBe(
      1,
    );
  });

  it('binds the hostile Efreeti without stopper coupling', () => {
    const bottle = waivedPack('magic-item:efreeti-bottle');
    const s = setup(bottle);
    const bottleId = s.install('magic-item:efreeti-bottle', 'bottle-3');
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    const bound = s.summon(
      'fx-hostile',
      {
        ref: 'magic-item:efreeti-bottle',
        grantRef: 'hostile-efreeti',
        itemInstanceId: bottleId,
      },
      { actors: [{ combatantId: 'c-efreeti' }] },
    );
    expect(bound).toMatchObject({ ok: true });
    expect(readItemState(s.db, bottleId)?.economies?.stopper?.remaining).toBe(
      1,
    );
  });

  it('keeps a persistent-actor summon bound through combat closure only with a durable campaign actor', () => {
    const ring = waivedPack('magic-item:ring-of-djinni-summoning');
    const s = setup(ring);
    const ringId = s.install('magic-item:ring-of-djinni-summoning', 'ring-6', {
      worn: true,
    });
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    spend(s.db, ringId, 'summon-djinni', ring);
    const joined = s.call('join_combat', {
      creatures: [
        { rulesRef: 'creature:djinni', side: 'ally', displayLabel: 'djinni-3' },
      ],
    });
    const combatantId = (
      joined as unknown as { data: { joined: { combatantId: string }[] } }
    ).data.joined[0]?.combatantId as string;
    const grantSource = {
      ref: 'magic-item:ring-of-djinni-summoning',
      grantRef: 'particular-djinni',
      itemInstanceId: ringId,
    };
    const owner = { concentrationOwner: { kind: 'character', ref: 'pc-1' } };
    const instanceOnly = s.summon('fx-instance-only', grantSource, {
      ...owner,
      actors: [{ combatantId }],
    });
    expect(instanceOnly).toMatchObject({ ok: false });
    expect(instanceOnly.message).toMatch(/campaignActorId/);

    expect(
      s.summon('fx-durable', grantSource, {
        ...owner,
        actors: [{ combatantId, campaignActorId: 'djinni-camp' }],
      }),
    ).toMatchObject({ ok: true });
    const closed = s.call('close_combat_instance', { status: 'completed' });
    expect(closed).toMatchObject({ ok: true });
    // Combat closure rebinds the link to the campaign actor and does not end
    // the effect: the djinni keeps its hour.
    expect(s.effect('fx-durable')).toMatchObject({ status: 'active' });
    expect(
      readItemState(s.db, ringId)?.economies?.cooldown?.availableAt,
    ).toBeUndefined();
    expect(
      s
        .effect('fx-durable')
        ?.links.some(
          (link) =>
            link.target.kind === 'campaign_actor' &&
            link.target.ref === 'djinni-camp' &&
            link.status === 'active',
        ),
    ).toBe(true);
  });
});
