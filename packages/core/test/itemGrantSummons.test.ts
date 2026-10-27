/** olc5.12: item entity grants bound through start_effect summoning, their
 * printed revertOn endings, and the grant-ended cooldown anchor. Every case
 * uses the bundled pack's real grant records. */
import { describe, expect, it } from 'vitest';
import type { CharacterSheet, ToolContext } from '../src/internal.js';
import {
  advanceWorldTime,
  attuneItem,
  completeLongRest,
  createDefaultToolRegistry,
  createInitialItemState,
  createSeededRng,
  createSqliteCharacterSheetStore,
  donItem,
  expireElapsedWorldEffects,
  getBundledDnd5eSrdPack,
  giveItem,
  ITEM_GRANT_REVERT_DISPOSITIONS,
  listActiveEffects,
  mutateState,
  readItemState,
  useItem,
  validateRulesPack,
  writeCampaignRulesBinding,
  writeItemState,
} from '../src/internal.js';
import { ensureTestBindCredit } from './support/bindCredit.js';
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

function setup(
  resolvePack = pack,
  options: {
    readonly resolver?: ToolContext['resolveRulesPack'];
    readonly extraActors?: readonly Record<string, unknown>[];
  } = {},
) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(7),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'olc5-12',
    at: NOW,
    resolveRulesPack: options.resolver ?? (() => resolvePack),
  };
  // These tests exercise grant validation, not the spend that pays for the
  // bind; the credit is scaffolded (see support/bindCredit.ts).
  const call = (name: string, args: unknown) => {
    if (name === 'start_effect')
      ensureTestBindCredit(
        db,
        DEFAULT_TEST_CAMPAIGN_ID,
        ctx.resolveRulesPack,
        (args as { source?: Record<string, unknown> }).source ?? {},
      );
    return registry.invoke(name, args, ctx);
  };
  const must = (name: string, args: unknown) => {
    const result = call(name, args);
    if (!result.ok) throw new Error(`${name} failed: ${result.message}`);
    return result;
  };
  must('start_encounter', {
    combatInstanceId: 'c',
    actors: [
      ...(options.extraActors ?? []),
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
      actors: [{ combatantId: 'c-djinni' }],
    });
    expect(refused).toMatchObject({ ok: false });
    const accepted = s.summon('fx-bag-weasel', bag, {
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

/** olc5.12.6 repair (Sol r1 S1-S7). Each finding has a generalized invariant
 * over the bundled pack's real carriers, plus its named failure probe. */
const REPAIR_ACTORS: readonly Record<string, unknown>[] = [
  {
    actorId: 'griffon',
    rulesRef: 'creature:griffon',
    hpMax: 59,
    hpCurrent: 59,
    side: 'ally',
  },
  {
    actorId: 'water',
    rulesRef: 'creature:water-elemental',
    hpMax: 90,
    hpCurrent: 90,
    side: 'ally',
  },
  {
    actorId: 'fire',
    rulesRef: 'creature:fire-elemental',
    hpMax: 102,
    hpCurrent: 102,
    side: 'ally',
  },
  {
    actorId: 'air',
    rulesRef: 'creature:air-elemental',
    hpMax: 90,
    hpCurrent: 90,
    side: 'ally',
  },
  {
    actorId: 'earth',
    rulesRef: 'creature:earth-elemental',
    hpMax: 126,
    hpCurrent: 126,
    side: 'ally',
  },
  {
    actorId: 'lion-1',
    rulesRef: 'creature:lion',
    hpMax: 26,
    hpCurrent: 26,
    side: 'ally',
  },
  {
    actorId: 'lion-2',
    rulesRef: 'creature:lion',
    hpMax: 26,
    hpCurrent: 26,
    side: 'ally',
  },
  {
    actorId: 'horse',
    rulesRef: 'creature:riding-horse',
    hpMax: 19,
    hpCurrent: 19,
    side: 'ally',
  },
  {
    actorId: 'goat',
    rulesRef: 'creature:giant-goat',
    hpMax: 85,
    hpCurrent: 85,
    side: 'ally',
  },
  {
    actorId: 'elephant',
    rulesRef: 'creature:elephant',
    hpMax: 76,
    hpCurrent: 76,
    side: 'ally',
  },
  {
    actorId: 'nightmare',
    rulesRef: 'creature:nightmare',
    hpMax: 68,
    hpCurrent: 68,
    side: 'ally',
  },
  {
    actorId: 'owl',
    rulesRef: 'creature:giant-owl',
    hpMax: 19,
    hpCurrent: 19,
    side: 'ally',
  },
  {
    actorId: 'raven',
    rulesRef: 'creature:raven',
    hpMax: 1,
    hpCurrent: 1,
    side: 'ally',
  },
];

/** The figurine grant's printed creature combatant ids, by creature ref. */
const FIGURINE_ACTORS: Record<string, readonly string[]> = {
  'creature:griffon': ['c-griffon'],
  'creature:lion': ['c-lion-1', 'c-lion-2'],
  'creature:riding-horse': ['c-horse'],
  'creature:giant-goat': ['c-goat'],
  'creature:elephant': ['c-elephant'],
  'creature:nightmare': ['c-nightmare'],
  'creature:mastiff': ['c-dog'],
  'creature:giant-owl': ['c-owl'],
  'creature:raven': ['c-raven'],
};

interface PrintedGrant {
  readonly id: string;
  readonly variants?: readonly string[];
  readonly creatureRefs?: readonly string[];
  readonly count?: number;
  readonly duration?: { amount: number; unit: string };
  readonly revertOn?: readonly string[];
  readonly control?: string;
  readonly cooldownEconomy?: string;
}

function gridOf(key: string): PrintedGrant[] {
  const record = packRecord(key);
  const grants = (
    record.data as { mechanics?: { entityGrant?: { grants: PrintedGrant[] } } }
  ).mechanics?.entityGrant?.grants;
  if (grants === undefined) throw new Error(`${key} prints no entity grant`);
  return grants;
}

describe('olc5.12.6 repair: grant identity, concentration, presence, timing, refresh, goat, resolver', () => {
  it('S1 pack: every grant of a variant-bearing item names its variants, and only those that exist', () => {
    for (const record of pack.records) {
      if (record.kind !== 'magic-item') continue;
      const data = record.data as {
        variants?: { id: string }[];
        mechanics?: { entityGrant?: { grants: PrintedGrant[] } };
      };
      const grants = data.mechanics?.entityGrant?.grants;
      if (grants === undefined) continue;
      const declared = new Set(
        (data.variants ?? []).map((variant) => variant.id),
      );
      for (const grant of grants) {
        if (declared.size === 0) {
          expect(grant.variants, `${record.key} ${grant.id}`).toBeUndefined();
          continue;
        }
        expect(
          grant.variants?.length ?? 0,
          `${record.key} ${grant.id}`,
        ).toBeGreaterThan(0);
        for (const variantId of grant.variants ?? []) {
          expect(
            declared.has(variantId),
            `${record.key} ${grant.id} -> ${variantId}`,
          ).toBe(true);
        }
      }
    }
    expect(
      gridOf('magic-item:figurine-of-wondrous-power').map(
        (grant) => grant.variants?.[0],
      ),
    ).toEqual([
      'bronze-griffon',
      'ebony-fly',
      'golden-lions',
      'ivory-goats',
      'ivory-goats',
      'ivory-goats',
      'marble-elephant',
      'obsidian-steed',
      'onyx-dog',
      'serpentine-owl',
      'silver-raven',
    ]);
  });

  it('S1 schema: pack load refuses a variant-bearing grant that names no variant or an undeclared one', () => {
    const figurine = packRecord('magic-item:figurine-of-wondrous-power');
    const withoutVariants = structuredClone(figurine);
    const grants = (
      withoutVariants.data as {
        mechanics: { entityGrant: { grants: PrintedGrant[] } };
      }
    ).mechanics.entityGrant.grants;
    grants[0] = { ...grants[0], variants: undefined } as PrintedGrant;
    expect(() =>
      validateRulesPack({
        ...pack,
        records: pack.records.map((r) =>
          r.key === figurine.key ? withoutVariants : r,
        ),
      } as never),
    ).toThrow(/must name its variants/);
    const undeclared = structuredClone(figurine);
    (
      undeclared.data as {
        mechanics: { entityGrant: { grants: PrintedGrant[] } };
      }
    ).mechanics.entityGrant.grants[0] = {
      ...grants[0],
      variants: ['no-such-variant'],
    } as PrintedGrant;
    expect(() =>
      validateRulesPack({
        ...pack,
        records: pack.records.map((r) =>
          r.key === figurine.key ? undeclared : r,
        ),
      } as never),
    ).toThrow(/does not declare|names 'no-such-variant'/);
  });

  it('S1 Sol probe a: a figurine bound to another variant instance is refused (onyx-dog bound as bronze-griffon)', () => {
    const s = setup(pack, { extraActors: REPAIR_ACTORS });
    const dogId = s.install(
      'magic-item:figurine-of-wondrous-power',
      'fig-probe-a',
      { variantId: 'onyx-dog' },
    );
    const refused = s.summon(
      'fx-probe-a',
      {
        ref: 'magic-item:figurine-of-wondrous-power',
        grantRef: 'bronze-griffon',
        itemInstanceId: dogId,
      },
      { actors: [{ combatantId: 'c-griffon' }] },
    );
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toMatch(/belongs to variant\(s\) bronze-griffon/);
    expect(s.effect('fx-probe-a')).toBeUndefined();
  });

  it('S1 every figurine grant binds only to its own variant, and refuses an instance with no variant', () => {
    // S13: one shared encounter/database; each grant runs inside a savepoint
    // that is rolled back, so no per-grant setup repeats and no case sees
    // another's installs or bound creatures.
    const s = setup(pack, { extraActors: REPAIR_ACTORS });
    for (const grant of gridOf('magic-item:figurine-of-wondrous-power')) {
      s.db.exec('SAVEPOINT figurine_case');
      const own = grant.variants?.[0] as string;
      const other = own === 'onyx-dog' ? 'silver-raven' : 'onyx-dog';
      const wrongId = s.install(
        'magic-item:figurine-of-wondrous-power',
        `wrong-${grant.id}`,
        { variantId: other },
      );
      const untyped =
        grant.duration === undefined
          ? { duration: { kind: 'until-removed' } }
          : {};
      const wrong = s.summon(
        `fx-wrong-${grant.id}`,
        {
          ref: 'magic-item:figurine-of-wondrous-power',
          grantRef: grant.id,
          itemInstanceId: wrongId,
        },
        { ...untyped, actors: [{ combatantId: 'c-dog' }] },
      );
      expect(wrong, grant.id).toMatchObject({ ok: false });
      expect(wrong.message, grant.id).toMatch(/belongs to/);
      const bareId = s.install(
        'magic-item:figurine-of-wondrous-power',
        `bare-${grant.id}`,
        { state: false },
      );
      const bare = s.summon(
        `fx-bare-${grant.id}`,
        {
          ref: 'magic-item:figurine-of-wondrous-power',
          grantRef: grant.id,
          itemInstanceId: bareId,
        },
        { ...untyped, actors: [{ combatantId: 'c-dog' }] },
      );
      expect(bare, grant.id).toMatchObject({ ok: false });
      expect(bare.message, grant.id).toMatch(/variant/);
      if (grant.variants?.[0] === 'ebony-fly') {
        s.db.exec('ROLLBACK TO figurine_case; RELEASE figurine_case');
        continue;
      }
      const id = s.install(
        'magic-item:figurine-of-wondrous-power',
        `own-${grant.id}`,
        { variantId: own },
      );
      const creature = grant.creatureRefs?.[0] as string;
      const combatants = FIGURINE_ACTORS[creature] ?? [];
      const count = typeof grant.count === 'number' ? grant.count : 1;
      const bound = s.summon(
        `fx-own-${grant.id}`,
        {
          ref: 'magic-item:figurine-of-wondrous-power',
          grantRef: grant.id,
          itemInstanceId: id,
        },
        {
          ...(grant.duration === undefined
            ? { duration: { kind: 'until-removed' } }
            : {}),
          actors: combatants
            .slice(0, count)
            .map((combatantId) => ({ combatantId })),
        },
      );
      expect(bound, grant.id).toMatchObject({ ok: true });
      s.must('end_effect', {
        effectId: `fx-own-${grant.id}`,
        reason: 'ruled',
        note: 'test cleanup',
      });
      s.db.exec('ROLLBACK TO figurine_case; RELEASE figurine_case');
    }
  });

  it('S1 Sol probe b: a magic-item source with a grantRef and no ref or instance is refused and never unbound', () => {
    const s = setup(pack, { extraActors: REPAIR_ACTORS });
    const probe = s.call('start_effect', {
      effectId: 'fx-probe-b',
      kind: 'summoning',
      displayName: 'probe b',
      source: { kind: 'magic-item', grantRef: 'nonexistent' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-dog' }],
    });
    expect(probe).toMatchObject({ ok: false });
    expect(probe.message).toMatch(/source\.kind magic-item with source\.ref/);
    expect(s.effect('fx-probe-b')).toBeUndefined();
    const ruling = s.call('start_effect', {
      effectId: 'fx-ruling-grant',
      kind: 'summoning',
      displayName: 'ruling with grant',
      source: { kind: 'ruling', grantRef: 'onyx-dog', itemInstanceId: 'x' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-dog' }],
    });
    expect(ruling).toMatchObject({ ok: false });
    expect(s.effect('fx-ruling-grant')).toBeUndefined();
  });

  it('S2 Sol probe: the Bowl water elemental requires concentration; the break hands it to the uncontrolled successor', () => {
    const s = setup(pack, { extraActors: REPAIR_ACTORS });
    const bowlId = s.install(
      'magic-item:bowl-of-commanding-water-elementals',
      'bowl-1',
    );
    const bowl = {
      ref: 'magic-item:bowl-of-commanding-water-elementals',
      grantRef: 'water-elemental',
      itemInstanceId: bowlId,
    };
    const unowned = s.summon('fx-bowl-free', bowl, {
      actors: [{ combatantId: 'c-water' }],
    });
    expect(unowned).toMatchObject({ ok: false });
    expect(unowned.message).toMatch(/concentrationOwner/);
    const bound = s.summon('fx-bowl', bowl, {
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      actors: [{ combatantId: 'c-water' }],
    });
    expect(bound).toMatchObject({ ok: true });
    s.must('end_effect', {
      effectId: 'fx-bowl',
      reason: 'concentration-broken',
      detail: 'voluntary',
    });
    const successor = s.effect('fx-bowl:uncontrolled');
    expect(successor).toMatchObject({ status: 'active' });
    // The elemental stays until the spell's deadline, measured from the summoning.
    const expired = expireElapsedWorldEffects(s.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      elapsedMinutes: 60,
      provenance: 'test:bowl-successor',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(expired.map((row) => row.effectId)).toContain(
      'fx-bowl:uncontrolled',
    );
  });

  it('S2 generalized: every elemental carrier needs concentration; a figurine refuses it; the Ring ends at its break without a successor', () => {
    const vessels = [
      [
        'magic-item:bowl-of-commanding-water-elementals',
        'water-elemental',
        'c-water',
      ],
      [
        'magic-item:brazier-of-commanding-fire-elementals',
        'fire-elemental',
        'c-fire',
      ],
      [
        'magic-item:censer-of-controlling-air-elementals',
        'air-elemental',
        'c-air',
      ],
      [
        'magic-item:stone-of-controlling-earth-elementals',
        'earth-elemental',
        'c-earth',
      ],
      ['magic-item:elemental-gem', 'gem-elemental', 'c-earth'],
    ] as const;
    for (const [key, grantId, actor] of vessels) {
      const s = setup(pack, { extraActors: REPAIR_ACTORS });
      const itemId = s.install(key, `item-${grantId}`);
      const source = { ref: key, grantRef: grantId, itemInstanceId: itemId };
      const free = s.summon(`fx-free-${grantId}`, source, {
        actors: [{ combatantId: actor }],
      });
      expect(free, key).toMatchObject({ ok: false });
      expect(free.message, key).toMatch(/concentrationOwner/);
      const effectId = `fx-${grantId}`;
      expect(
        s.summon(effectId, source, {
          concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
          actors: [{ combatantId: actor }],
        }),
        key,
      ).toMatchObject({ ok: true });
      s.must('end_effect', {
        effectId,
        reason: 'concentration-broken',
        detail: 'voluntary',
      });
      expect(s.effect(`${effectId}:uncontrolled`), key).toMatchObject({
        status: 'active',
      });
      const expired = expireElapsedWorldEffects(s.db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        elapsedMinutes: 60,
        provenance: 'test:vessel-successor',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
      });
      const removed = expired.find(
        (row) => row.effectId === `${effectId}:uncontrolled`,
      );
      expect(
        removed?.cleanup.links.some((link) => link.action === 'removed'),
        key,
      ).toBe(true);
    }
    // Figurines print no concentration: an owner is refused for every one.
    for (const grant of gridOf('magic-item:figurine-of-wondrous-power')) {
      if (grant.variants?.[0] === 'ebony-fly') continue;
      const s = setup(pack, { extraActors: REPAIR_ACTORS });
      const id = s.install(
        'magic-item:figurine-of-wondrous-power',
        `fig-c-${grant.id}`,
        {
          variantId: grant.variants?.[0],
        },
      );
      const creature = FIGURINE_ACTORS[grant.creatureRefs?.[0] as string] ?? [];
      const refused = s.summon(
        `fx-conc-${grant.id}`,
        {
          ref: 'magic-item:figurine-of-wondrous-power',
          grantRef: grant.id,
          itemInstanceId: id,
        },
        {
          concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
          ...(grant.duration === undefined
            ? { duration: { kind: 'until-removed' } }
            : {}),
          actors: creature
            .slice(0, typeof grant.count === 'number' ? grant.count : 1)
            .map((combatantId) => ({ combatantId })),
        },
      );
      expect(refused, grant.id).toMatchObject({ ok: false });
      expect(refused.message, grant.id).toMatch(
        /prints no concentration requirement/,
      );
    }
  }, 60_000);

  it('S3 presence: a bound grant cannot release its creature, and its printed expiry removes it', () => {
    const s = setup(pack, { extraActors: REPAIR_ACTORS });
    const dogId = s.install('magic-item:figurine-of-wondrous-power', 'fig-s3', {
      variantId: 'onyx-dog',
    });
    const figurine = {
      ref: 'magic-item:figurine-of-wondrous-power',
      grantRef: 'onyx-dog',
      itemInstanceId: dogId,
    };
    const released = s.summon('fx-release', figurine, {
      actors: [{ combatantId: 'c-dog', cleanupOnEnd: 'release' }],
    });
    expect(released).toMatchObject({ ok: false });
    expect(released.message).toMatch(/cleanupOnEnd/);
    expect(
      s.summon('fx-s3', figurine, { actors: [{ combatantId: 'c-dog' }] }),
    ).toMatchObject({ ok: true });
    const expired = expireElapsedWorldEffects(s.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      elapsedMinutes: 360,
      provenance: 'test:s3-expiry',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    const row = expired.find((entry) => entry.effectId === 'fx-s3');
    expect(row).toBeDefined();
    expect(row?.cleanup.links.map((link) => link.action)).toContain('removed');
    expect(s.effect('fx-s3')).toMatchObject({
      status: 'ended',
      endReason: 'expired',
    });
  });

  it('S3 anchored Ring: a release policy on its concentration break or end is refused', () => {
    const ring = waivedPack('magic-item:ring-of-djinni-summoning');
    const s = setup(ring, { extraActors: REPAIR_ACTORS });
    const ringId = s.install('magic-item:ring-of-djinni-summoning', 'ring-s3', {
      worn: true,
    });
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    spend(s.db, ringId, 'summon-djinni', ring);
    for (const policy of ['cleanupOnEnd', 'cleanupOnBreak'] as const) {
      const refused = s.summon(
        `fx-ring-${policy}`,
        {
          ref: 'magic-item:ring-of-djinni-summoning',
          grantRef: 'particular-djinni',
          itemInstanceId: ringId,
        },
        {
          concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
          actors: [{ combatantId: 'c-djinni', [policy]: 'release' }],
        },
      );
      expect(refused, policy).toMatchObject({ ok: false });
      expect(refused.message, policy).toMatch(new RegExp(policy));
    }
    expect(readItemState(s.db, ringId)?.economies?.cooldown?.remaining).toBe(0);
  });

  it('S4 timing partition: the Ring wait starts at the djinni departure, not at the advance endpoint', () => {
    const timeline = (steps: readonly number[]) => {
      const ring = waivedPack('magic-item:ring-of-djinni-summoning');
      const s = setup(ring, { extraActors: REPAIR_ACTORS });
      const ringId = s.install(
        'magic-item:ring-of-djinni-summoning',
        'ring-s4',
        { worn: true },
      );
      s.must('begin_turn', { character: 'pc-1', round: 1 });
      spend(s.db, ringId, 'summon-djinni', ring);
      expect(
        s.summon(
          'fx-s4',
          {
            ref: 'magic-item:ring-of-djinni-summoning',
            grantRef: 'particular-djinni',
            itemInstanceId: ringId,
          },
          {
            concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
            actors: [{ combatantId: 'c-djinni' }],
          },
        ),
      ).toMatchObject({ ok: true });
      for (const minutes of steps)
        advanceWorldTime(s.db, {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          minutes,
          provenance: 'test:s4-ring',
          sessionId: DEFAULT_TEST_SESSION_ID,
          at: NOW,
          resolveRulesPack: () => ring,
          rng: createSeededRng(5),
        });
      const cooldown = readItemState(s.db, ringId)?.economies?.cooldown;
      return {
        remaining: cooldown?.remaining,
        availableAt: cooldown?.availableAt,
      };
    };
    const whole = timeline([2880]);
    expect(whole).toEqual({ remaining: 1, availableAt: undefined });
    // The 60-minute deadline schedules the wait to 1500, not 2880.
    expect(timeline([60])).toEqual({ remaining: 0, availableAt: '1500' });
    expect(timeline([60, 1439, 1])).toEqual(whole);
    expect(timeline([60, 1440, 1380])).toEqual(whole);
  });

  it('S4 timing partition: the Efreeti stopper wait starts at the serving expiry', () => {
    const timeline = (steps: readonly number[]) => {
      const bottle = waivedPack('magic-item:efreeti-bottle');
      const s = setup(bottle, { extraActors: REPAIR_ACTORS });
      s.must('begin_turn', { character: 'pc-1', round: 1 });
      const bottleId = s.install('magic-item:efreeti-bottle', 'bottle-s4');
      spend(s.db, bottleId, 'remove-stopper', bottle);
      expect(
        s.summon(
          'fx-serve',
          {
            ref: 'magic-item:efreeti-bottle',
            grantRef: 'serving-efreeti',
            itemInstanceId: bottleId,
          },
          {
            actors: [{ combatantId: 'c-efreeti' }],
          },
        ),
      ).toMatchObject({ ok: true });
      for (const minutes of steps)
        advanceWorldTime(s.db, {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          minutes,
          provenance: 'test:s4-efreeti',
          sessionId: DEFAULT_TEST_SESSION_ID,
          at: NOW,
          resolveRulesPack: () => bottle,
          rng: createSeededRng(5),
        });
      const stopper = readItemState(s.db, bottleId)?.economies?.stopper;
      return {
        remaining: stopper?.remaining,
        availableAt: stopper?.availableAt,
      };
    };
    const whole = timeline([1560]);
    expect(whole).toEqual({ remaining: 1, availableAt: undefined });
    expect(timeline([60])).toEqual({ remaining: 0, availableAt: '1500' });
    expect(timeline([60, 1440, 120])).toEqual(whole);
  });

  it('S5/S8 refresh: a grant-bound duration is never rewritten (override or not); an unchanged re-anchor works', () => {
    const s = setup(pack, { extraActors: REPAIR_ACTORS });
    const dogId = s.install('magic-item:figurine-of-wondrous-power', 'fig-s5', {
      variantId: 'onyx-dog',
    });
    const figurine = {
      ref: 'magic-item:figurine-of-wondrous-power',
      grantRef: 'onyx-dog',
      itemInstanceId: dogId,
    };
    expect(
      s.summon('fx-s5', figurine, { actors: [{ combatantId: 'c-dog' }] }),
    ).toMatchObject({ ok: true });
    const longer = {
      kind: 'timed',
      amount: 24,
      unit: 'hour',
      anchor: 'effect-created',
    };
    const refused = s.call('refresh_effect', {
      effectId: 'fx-s5',
      duration: longer,
    });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toMatch(/durationOverride/);
    expect(s.effect('fx-s5')).toMatchObject({
      duration: { kind: 'timed', amount: 6, unit: 'hour' },
      durationProvenance: { kind: 'typed-fixed', amount: 6, unit: 'hour' },
    });
    const sameTyped = s.call('refresh_effect', {
      effectId: 'fx-s5',
      duration: {
        kind: 'timed',
        amount: 6,
        unit: 'hour',
        anchor: 'effect-created',
      },
    });
    expect(sameTyped).toMatchObject({ ok: true });
    expect(s.effect('fx-s5')).toMatchObject({
      durationProvenance: { kind: 'typed-fixed', amount: 6, unit: 'hour' },
    });
    // S8: a grant-bound effect's lifetime is never rewritten, with or without
    // a recorded override; the route is end_effect.
    const overridden = s.call('refresh_effect', {
      effectId: 'fx-s5',
      duration: longer,
      durationOverride: {
        basis: 'dm-adjudicated',
        reason: 'the owner renewed the figurine',
      },
    });
    expect(overridden).toMatchObject({ ok: false });
    expect(overridden.message).toMatch(/end_effect/);
    expect(s.effect('fx-s5')).toMatchObject({
      duration: { kind: 'timed', amount: 6, unit: 'hour' },
      durationProvenance: { kind: 'typed-fixed', amount: 6, unit: 'hour' },
    });
    // Once time has passed, the same re-anchor would restart the printed
    // six hours from now and extend the dog's lifetime: refused, and the
    // creature still leaves at the original deadline.
    s.must('advance_time', { minutes: 60 });
    const reanchored = s.call('refresh_effect', { effectId: 'fx-s5' });
    expect(reanchored).toMatchObject({ ok: false });
    expect(reanchored.message).toMatch(/end_effect/);
    s.must('advance_time', { minutes: 300 });
    expect(s.effect('fx-s5')).toMatchObject({ status: 'ended' });
    // The Ring: until-removed would remove the timer, so it is refused too.
    const ring = waivedPack('magic-item:ring-of-djinni-summoning');
    const r = setup(ring, { extraActors: REPAIR_ACTORS });
    const ringId = r.install('magic-item:ring-of-djinni-summoning', 'ring-s5', {
      worn: true,
    });
    r.must('begin_turn', { character: 'pc-1', round: 1 });
    spend(r.db, ringId, 'summon-djinni', ring);
    expect(
      r.summon(
        'fx-ring-s5',
        {
          ref: 'magic-item:ring-of-djinni-summoning',
          grantRef: 'particular-djinni',
          itemInstanceId: ringId,
        },
        {
          concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
          actors: [{ combatantId: 'c-djinni' }],
        },
      ),
    ).toMatchObject({ ok: true });
    const untilRemoved = r.call('refresh_effect', {
      effectId: 'fx-ring-s5',
      duration: { kind: 'until-removed' },
    });
    expect(untilRemoved).toMatchObject({ ok: false });
    expect(untilRemoved.message).toMatch(/durationOverride/);
  });

  it('S6 goat: an untyped charge-driven grant binds with a DM-adjudicated timed duration or until removed', () => {
    const s = setup(pack, { extraActors: REPAIR_ACTORS });
    const goatId = s.install(
      'magic-item:figurine-of-wondrous-power',
      'goat-s6',
      { variantId: 'ivory-goats' },
    );
    const goat = {
      ref: 'magic-item:figurine-of-wondrous-power',
      grantRef: 'goat-of-traveling',
      itemInstanceId: goatId,
    };
    const timedNoOverride = s.summon('fx-goat-timed', goat, {
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'hour',
        anchor: 'effect-created',
      },
      actors: [{ combatantId: 'c-horse' }],
    });
    expect(timedNoOverride).toMatchObject({ ok: false });
    expect(timedNoOverride.message).toMatch(/DM-adjudicated/);
    const dmTimed = s.summon('fx-goat-dm', goat, {
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'hour',
        anchor: 'effect-created',
      },
      durationOverride: {
        basis: 'dm-adjudicated',
        reason: 'the goat carries the party for one hour',
      },
      actors: [{ combatantId: 'c-horse' }],
    });
    expect(dmTimed).toMatchObject({ ok: true });
    expect(s.effect('fx-goat-dm')).toMatchObject({
      durationProvenance: { kind: 'dm-override', basis: 'dm-adjudicated' },
    });
    s.must('end_effect', {
      effectId: 'fx-goat-dm',
      reason: 'ruled',
      note: 'test cleanup',
    });
    const fresh = setup(pack, { extraActors: REPAIR_ACTORS });
    const freshGoat = fresh.install(
      'magic-item:figurine-of-wondrous-power',
      'goat-s6-b',
      { variantId: 'ivory-goats' },
    );
    const untilRemoved = fresh.summon(
      'fx-goat-until',
      {
        ref: 'magic-item:figurine-of-wondrous-power',
        grantRef: 'goat-of-traveling',
        itemInstanceId: freshGoat,
      },
      {
        duration: { kind: 'until-removed' },
        actors: [{ combatantId: 'c-horse' }],
      },
    );
    expect(untilRemoved).toMatchObject({ ok: true });
  });

  it('S6 admissibility: every kept timer disposition carrier with no typed duration can bind', () => {
    const carriers: {
      key: string;
      grantId: string;
      actor: string;
      variantId?: string;
    }[] = [];
    for (const record of pack.records) {
      if (record.kind !== 'magic-item') continue;
      const grants =
        (
          record.data as {
            mechanics?: { entityGrant?: { grants: PrintedGrant[] } };
          }
        ).mechanics?.entityGrant?.grants ?? [];
      for (const grant of grants) {
        const timer = (grant.revertOn ?? []).some(
          (value) => ITEM_GRANT_REVERT_DISPOSITIONS[value]?.kind === 'timer',
        );
        if (
          !timer ||
          grant.duration !== undefined ||
          grant.creatureRefs === undefined
        )
          continue;
        carriers.push({
          key: record.key,
          grantId: grant.id,
          actor: FIGURINE_ACTORS[
            grant.creatureRefs[0] as string
          ]?.[0] as string,
          variantId: (grant.variants ?? [])[0],
        });
      }
    }
    // The goat of traveling is the one known carrier; every entry must bind.
    expect(carriers.map((carrier) => carrier.grantId)).toEqual([
      'goat-of-traveling',
    ]);
    for (const carrier of carriers) {
      const s = setup(pack, { extraActors: REPAIR_ACTORS });
      const id = s.install(carrier.key, `adm-${carrier.grantId}`, {
        variantId: carrier.variantId,
      });
      const bound = s.summon(
        `fx-adm-${carrier.grantId}`,
        { ref: carrier.key, grantRef: carrier.grantId, itemInstanceId: id },
        {
          duration: { kind: 'until-removed' },
          actors: [{ combatantId: carrier.actor }],
        },
      );
      expect(bound, carrier.grantId).toMatchObject({ ok: true });
    }
  });

  it('S7 rules stack: an available add-on resolves through every expiry, explicit end, and life-event ending', () => {
    const addon = {
      meta: {
        ...pack.meta,
        packId: 'review-addon',
        version: '1.0.0',
        role: 'addon',
        order: 1,
        compatibleBaseSystems: [
          { systemId: pack.meta.systemId, versions: [pack.meta.version] },
        ],
      },
      records: [],
    };
    const resolver = (binding: { packId: string; version: string }) =>
      [pack, addon].find(
        (candidate) =>
          candidate.meta.packId === binding.packId &&
          candidate.meta.version === binding.version,
      ) as never;
    const s = setup(pack, {
      resolver: resolver as never,
      extraActors: REPAIR_ACTORS,
    });
    writeCampaignRulesBinding(s.db, {
      base: {
        systemId: pack.meta.systemId,
        packId: pack.meta.packId,
        version: pack.meta.version,
      },
      addons: [
        {
          systemId: pack.meta.systemId,
          packId: 'review-addon',
          version: '1.0.0',
        },
      ],
      resolvedAt: NOW,
    });
    const advance = (minutes: number) =>
      advanceWorldTime(s.db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        minutes,
        provenance: 'test:s7-advance',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
        resolveRulesPack: resolver as never,
        rng: createSeededRng(5),
      });
    // Expiry: one golden lion (one hour, one use) ends at its deadline.
    const lionsId = s.install(
      'magic-item:figurine-of-wondrous-power',
      'fig-s7-lions',
      { variantId: 'golden-lions' },
    );
    expect(
      s.summon(
        'fx-s7-expiry',
        {
          ref: 'magic-item:figurine-of-wondrous-power',
          grantRef: 'golden-lions',
          itemInstanceId: lionsId,
        },
        { actors: [{ combatantId: 'c-lion-1' }] },
      ),
    ).toMatchObject({ ok: true });
    expect(() => advance(60)).not.toThrow();
    expect(() => advance(300)).not.toThrow();
    expect(s.effect('fx-s7-expiry')).toMatchObject({
      status: 'ended',
      endReason: 'expired',
    });
    // Explicit end on the same stack.
    const dogId = s.install('magic-item:figurine-of-wondrous-power', 'fig-s7', {
      variantId: 'onyx-dog',
    });
    expect(
      s.summon(
        'fx-s7-end',
        {
          ref: 'magic-item:figurine-of-wondrous-power',
          grantRef: 'onyx-dog',
          itemInstanceId: dogId,
        },
        { actors: [{ combatantId: 'c-dog' }] },
      ),
    ).toMatchObject({ ok: true });
    s.must('end_effect', {
      effectId: 'fx-s7-end',
      reason: 'ruled',
      note: 'explicit end on the add-on stack',
    });
    expect(s.effect('fx-s7-end')).toMatchObject({
      status: 'ended',
      endReason: 'ruled',
    });
    // Life event: a Bag of Tricks creature reduced to 0 hit points ends the grant.
    const bagId = s.install('magic-item:bag-of-tricks', 'bag-s7');
    expect(
      s.summon(
        'fx-s7-hp',
        {
          ref: 'magic-item:bag-of-tricks',
          grantRef: 'bag-creature',
          itemInstanceId: bagId,
        },
        { actors: [{ combatantId: 'c-weasel' }] },
      ),
    ).toMatchObject({ ok: true });
    s.hit('c-weasel', -1);
    expect(s.effect('fx-s7-hp')).toMatchObject({ status: 'ended' });
  });
  it('S7 anchored Ring on an add-on stack: the 0 hit point ending schedules the wait through the campaign resolver', () => {
    const ringPack = waivedPack('magic-item:ring-of-djinni-summoning');
    const addon = {
      meta: {
        ...ringPack.meta,
        packId: 'review-addon',
        version: '1.0.0',
        role: 'addon',
        order: 1,
        compatibleBaseSystems: [
          {
            systemId: ringPack.meta.systemId,
            versions: [ringPack.meta.version],
          },
        ],
      },
      records: [],
    };
    const resolver = (binding: { packId: string; version: string }) =>
      [ringPack, addon].find(
        (candidate) =>
          candidate.meta.packId === binding.packId &&
          candidate.meta.version === binding.version,
      ) as never;
    const s = setup(ringPack, {
      resolver: resolver as never,
      extraActors: REPAIR_ACTORS,
    });
    // Install and spend on the bundled stack (the worn install has no resolver);
    // the add-on binding is written before the summon, which resolves through it.
    const ringId = s.install('magic-item:ring-of-djinni-summoning', 'ring-s7', {
      worn: true,
    });
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    useItem(s.db, {
      ...s.domainCtx,
      instanceId: ringId,
      operationId: 'summon-djinni',
      rng: createSeededRng(3),
      resolveRulesPack: () => ringPack,
    } as never);
    writeCampaignRulesBinding(s.db, {
      base: {
        systemId: ringPack.meta.systemId,
        packId: ringPack.meta.packId,
        version: ringPack.meta.version,
      },
      addons: [
        {
          systemId: ringPack.meta.systemId,
          packId: 'review-addon',
          version: '1.0.0',
        },
      ],
      resolvedAt: NOW,
    });
    expect(
      s.summon(
        'fx-ring-s7',
        {
          ref: 'magic-item:ring-of-djinni-summoning',
          grantRef: 'particular-djinni',
          itemInstanceId: ringId,
        },
        {
          concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
          actors: [{ combatantId: 'c-djinni' }],
        },
      ),
    ).toMatchObject({ ok: true });
    s.hit('c-djinni', -161);
    expect(s.effect('fx-ring-s7')).toMatchObject({ status: 'ended' });
    expect(readItemState(s.db, ringId)?.economies?.cooldown?.availableAt).toBe(
      '1440',
    );
  });
  it('S5 item effect: a typed item power keeps its printed duration through refresh; a change needs a dm-override', () => {
    const s = setup(pack, { extraActors: REPAIR_ACTORS });
    const armor = {
      kind: 'magic-item',
      ref: 'magic-item:armor-of-invulnerability',
      effectRef: 'c2-activate-immunity-payload',
    };
    const bound = s.call('start_effect', {
      effectId: 'fx-armor-s5',
      kind: 'item-power',
      displayName: 'armor s5',
      source: armor,
      duration: {
        kind: 'timed',
        amount: 10,
        unit: 'minute',
        anchor: 'effect-created',
      },
    });
    expect(bound).toMatchObject({ ok: true });
    const longer = {
      kind: 'timed',
      amount: 20,
      unit: 'minute',
      anchor: 'effect-created',
    };
    expect(
      s.call('refresh_effect', { effectId: 'fx-armor-s5', duration: longer }),
    ).toMatchObject({ ok: false });
    expect(s.effect('fx-armor-s5')).toMatchObject({
      durationProvenance: { kind: 'typed-fixed', amount: 10, unit: 'minute' },
    });
    expect(
      s.call('refresh_effect', {
        effectId: 'fx-armor-s5',
        duration: longer,
        durationOverride: {
          basis: 'dm-adjudicated',
          reason: 'the power was renewed by the DM',
        },
      }),
    ).toMatchObject({ ok: true });
    expect(s.effect('fx-armor-s5')).toMatchObject({
      duration: { kind: 'timed', amount: 20, unit: 'minute' },
      durationProvenance: { kind: 'dm-override', basis: 'dm-adjudicated' },
    });
  });
});

/** olc5.12.10: the Ring of Djinni Summoning on a stack, with the owner either
 * a combatant or the character, and an optional compatible empty add-on. */
const RING = 'magic-item:ring-of-djinni-summoning';

function ringScenario(
  options: { addon?: boolean; owner?: 'combatant' | 'character' } = {},
) {
  const ring = waivedPack(RING);
  const addon = {
    meta: {
      ...ring.meta,
      packId: 'review-addon',
      version: '1.0.0',
      role: 'addon',
      order: 1,
      compatibleBaseSystems: [
        { systemId: ring.meta.systemId, versions: [ring.meta.version] },
      ],
    },
    records: [],
  };
  const resolver = (binding: { packId: string; version: string }) =>
    [ring, addon].find(
      (candidate) =>
        candidate.meta.packId === binding.packId &&
        candidate.meta.version === binding.version,
    ) as never;
  const s = setup(ring, {
    resolver: resolver as never,
    extraActors: REPAIR_ACTORS,
  });
  const ringId = s.install(RING, 'ring-s10', { worn: true });
  s.must('begin_turn', { character: 'pc-1', round: 1 });
  useItem(s.db, {
    ...s.domainCtx,
    instanceId: ringId,
    operationId: 'summon-djinni',
    rng: createSeededRng(3),
    resolveRulesPack: () => ring,
  } as never);
  if (options.addon === true)
    writeCampaignRulesBinding(s.db, {
      base: {
        systemId: ring.meta.systemId,
        packId: ring.meta.packId,
        version: ring.meta.version,
      },
      addons: [
        {
          systemId: ring.meta.systemId,
          packId: 'review-addon',
          version: '1.0.0',
        },
      ],
      resolvedAt: NOW,
    });
  const ownerRef =
    options.owner === 'character'
      ? { kind: 'character', ref: 'pc-1' }
      : { kind: 'combatant', ref: 'c-wiz' };
  const bind = (effectId = 'fx-ring') =>
    s.summon(
      effectId,
      {
        ref: RING,
        grantRef: 'particular-djinni',
        itemInstanceId: ringId,
      },
      {
        concentrationOwner: ownerRef,
        actors: [{ combatantId: 'c-djinni' }],
      },
    );
  const advance = (minutes: number) =>
    advanceWorldTime(s.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      minutes,
      provenance: 'test:s10-advance',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
      resolveRulesPack: resolver as never,
      rng: createSeededRng(5),
    });
  const cooldown = () => {
    const state = readItemState(s.db, ringId)?.economies?.cooldown;
    return { remaining: state?.remaining, availableAt: state?.availableAt };
  };
  return { ...s, ring, ringId, bind, advance, cooldown, resolver };
}

type RingScenario = ReturnType<typeof ringScenario>;

/** A minimal canonical sheet so pc-1 can be a rest participant. */
function installRestSheet(db: RingScenario['db']) {
  const ability = { base: 10, final: 10, modifier: 0 };
  const abilityScores = {
    strength: ability,
    dexterity: ability,
    constitution: ability,
    intelligence: ability,
    wisdom: ability,
    charisma: ability,
  };
  createSqliteCharacterSheetStore(db).save('pc-1', {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: 2,
    identity: { name: 'pc-1' },
    class: { key: 'class:warlock', name: 'Warlock' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 20,
    savingThrows: Object.fromEntries(
      Object.keys(abilityScores).map((key) => [
        key,
        { modifier: 0, proficient: false },
      ]),
    ),
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: NOW },
  } as unknown as CharacterSheet);
  setCharacterHp(db);
}

/** pc-1 starts with no hit points; give it a live pool and level 2. */
function setCharacterHp(db: RingScenario['db']) {
  for (const [field, value] of [
    ['hp_max', 20],
    ['hp_current', 10],
    ['level', 2],
  ] as const)
    mutateState(db, {
      target: 'character',
      id: 'pc-1',
      field,
      op: 'set',
      value,
      provenance: 'test:s10-hp',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
}

/** Every terminal entry point that can end an anchored Ring grant. `endsAt` is
 * the world minute at which the ending takes effect. */
const RING_TERMINAL_ENTRY_POINTS: readonly {
  readonly name: string;
  readonly owner: 'combatant' | 'character';
  readonly endsAt: number;
  readonly trigger: (r: RingScenario) => void;
}[] = [
  {
    name: 'end_effect',
    owner: 'combatant',
    endsAt: 0,
    trigger: (r) => {
      r.must('end_effect', {
        effectId: 'fx-ring',
        reason: 'ruled',
        note: 'explicit end',
      });
    },
  },
  {
    name: 'advance_time expiry',
    owner: 'combatant',
    endsAt: 60,
    trigger: (r) => {
      r.must('advance_time', { minutes: 120 });
    },
  },
  {
    name: 'complete long rest expiry',
    owner: 'character',
    endsAt: 60,
    trigger: (r) => {
      // A rest cannot run during combat; a character-owned grant survives the
      // close and expires inside the rest's own world-time advance.
      r.must('close_combat_instance', { status: 'completed' });
      expect(r.effect('fx-ring')).toMatchObject({ status: 'active' });
      installRestSheet(r.db);
      completeLongRest(r.db, {
        ...r.domainCtx,
        restId: 'rest-s10',
        participants: ['pc-1'],
        qualification: {
          durationMinutes: 480,
          sleepMinutes: 360,
          lightActivityMinutes: 0,
          strenuousInterruptionMinutes: 0,
          foodAndDrink: false,
        },
        resolveRulesPack: r.resolver,
      } as never);
    },
  },
  {
    name: 'update_combatant djinni to 0 hit points',
    owner: 'combatant',
    endsAt: 0,
    trigger: (r) => {
      r.hit('c-djinni', -161);
    },
  },
  {
    name: 'update_combatant owner to 0 hit points',
    owner: 'combatant',
    endsAt: 0,
    trigger: (r) => {
      r.hit('c-wiz', -20);
    },
  },
  {
    name: 'adjust_exhaustion owner combatant to level 6',
    owner: 'combatant',
    endsAt: 0,
    trigger: (r) => {
      r.must('adjust_exhaustion', { combatantId: 'c-wiz', delta: 6 });
    },
  },
  {
    name: 'resolve_concentration failed save',
    owner: 'combatant',
    endsAt: 0,
    trigger: (r) => {
      r.must('resolve_concentration', {
        owner: { kind: 'combatant', ref: 'c-wiz' },
        damage: 200,
      });
    },
  },
  {
    name: 'close_combat_instance owner removed',
    owner: 'combatant',
    endsAt: 0,
    trigger: (r) => {
      r.must('close_combat_instance', { status: 'completed' });
    },
  },
  {
    name: 'start_effect replaces the concentration',
    owner: 'combatant',
    endsAt: 0,
    trigger: (r) => {
      r.must('start_effect', {
        effectId: 'fx-replacement',
        kind: 'spell-effect',
        displayName: 'replacement',
        source: { kind: 'ruling' },
        concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
        duration: { kind: 'until-removed' },
      });
    },
  },
  {
    name: 'set_suffocation drop on the owner combatant',
    owner: 'combatant',
    endsAt: 0,
    trigger: (r) => {
      r.must('set_suffocation', { event: 'drop', combatantId: 'c-wiz' });
    },
  },
  {
    name: 'adjust_hp owner character to 0 hit points',
    owner: 'character',
    endsAt: 0,
    trigger: (r) => {
      setCharacterHp(r.db);
      r.must('adjust_hp', { amount: -15, character: 'pc-1' });
    },
  },
  {
    name: 'adjust_exhaustion owner character to level 6',
    owner: 'character',
    endsAt: 0,
    trigger: (r) => {
      r.must('adjust_exhaustion', { delta: 6, character: 'pc-1' });
    },
  },
  {
    name: 'add_condition incapacitated on the owner character',
    owner: 'character',
    endsAt: 0,
    trigger: (r) => {
      r.must('add_condition', { id: 'incapacitated', character: 'pc-1' });
    },
  },
  {
    name: 'start_effect projects an incapacitating condition onto the owner character',
    owner: 'character',
    endsAt: 0,
    trigger: (r) => {
      r.must('start_effect', {
        effectId: 'fx-paralysis',
        kind: 'condition-package',
        displayName: 'paralysis',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        conditions: [
          {
            target: { kind: 'character', ref: 'pc-1' },
            condition: { id: 'paralyzed' },
          },
        ],
      });
    },
  },
  {
    name: 'set_suffocation drop on the owner character',
    owner: 'character',
    endsAt: 0,
    trigger: (r) => {
      r.must('set_suffocation', { event: 'drop', character: 'pc-1' });
    },
  },
];

describe('olc5.12.10 terminal entry points and cascade event time', () => {
  for (const addon of [false, true]) {
    for (const entry of RING_TERMINAL_ENTRY_POINTS) {
      it(`S7 parity: ${entry.name} ends an anchored Ring grant on the ${addon ? 'base plus add-on' : 'base'} stack with the wait scheduled`, () => {
        const r = ringScenario({ addon, owner: entry.owner });
        expect(r.bind()).toMatchObject({ ok: true });
        expect(r.effect('fx-ring')).toMatchObject({ status: 'active' });
        entry.trigger(r);
        expect(r.effect('fx-ring')).toMatchObject({ status: 'ended' });
        expect(r.cooldown()).toEqual({
          remaining: 0,
          availableAt: String(entry.endsAt + 1440),
        });
      }, 30_000);
    }
  }

  for (const addon of [false, true]) {
    it(`S10 parity: start_effect projecting an incapacitating condition onto the owner character hands an as-spell carrier to its uncontrolled successor on the ${addon ? 'base plus add-on' : 'base'} stack`, () => {
      const bowl = 'magic-item:bowl-of-commanding-water-elementals';
      const addonPack = {
        meta: {
          ...pack.meta,
          packId: 'review-addon',
          version: '1.0.0',
          role: 'addon',
          order: 1,
          compatibleBaseSystems: [
            { systemId: pack.meta.systemId, versions: [pack.meta.version] },
          ],
        },
        records: [],
      };
      const resolver = (binding: { packId: string; version: string }) =>
        [pack, addonPack].find(
          (candidate) =>
            candidate.meta.packId === binding.packId &&
            candidate.meta.version === binding.version,
        ) as never;
      const s = setup(pack, {
        resolver: resolver as never,
        extraActors: REPAIR_ACTORS,
      });
      if (addon)
        writeCampaignRulesBinding(s.db, {
          base: {
            systemId: pack.meta.systemId,
            packId: pack.meta.packId,
            version: pack.meta.version,
          },
          addons: [
            {
              systemId: pack.meta.systemId,
              packId: 'review-addon',
              version: '1.0.0',
            },
          ],
          resolvedAt: NOW,
        });
      const itemId = s.install(bowl, 'bowl-s10');
      expect(
        s.summon(
          'fx-bowl-s10',
          {
            ref: bowl,
            grantRef: 'water-elemental',
            itemInstanceId: itemId,
          },
          {
            concentrationOwner: { kind: 'character', ref: 'pc-1' },
            actors: [{ combatantId: 'c-water' }],
          },
        ),
      ).toMatchObject({ ok: true });
      s.must('start_effect', {
        effectId: 'fx-paralysis',
        kind: 'condition-package',
        displayName: 'paralysis',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        conditions: [
          {
            target: { kind: 'character', ref: 'pc-1' },
            condition: { id: 'paralyzed' },
          },
        ],
      });
      expect(s.effect('fx-bowl-s10')).toMatchObject({ status: 'ended' });
      expect(s.effect('fx-bowl-s10:uncontrolled')).toMatchObject({
        status: 'active',
      });
    }, 30_000);
  }

  it('S4 cascade: an effect expiry that removes the concentration owner anchors the wait at the expiry minute, whatever the partition', () => {
    const timeline = (steps: readonly number[]) => {
      const r = ringScenario({ addon: true });
      expect(r.bind()).toMatchObject({ ok: true });
      // A 30-minute effect owns the Ring's concentrating combatant; its
      // expiry removes that combatant, which breaks the concentration, which
      // ends the grant: a cascade through finalizeEnd inside the sweep.
      r.must('start_effect', {
        effectId: 'fx-owner-summon',
        kind: 'summoning',
        displayName: 'owner summon',
        source: { kind: 'ruling' },
        duration: {
          kind: 'timed',
          amount: 30,
          unit: 'minute',
          anchor: 'effect-created',
        },
        actors: [{ combatantId: 'c-wiz', cleanupOnEnd: 'remove' }],
      });
      for (const minutes of steps) r.advance(minutes);
      expect(r.effect('fx-owner-summon')).toMatchObject({ status: 'ended' });
      expect(r.effect('fx-ring')).toMatchObject({
        status: 'ended',
        endReason: 'concentration-broken',
      });
      return r.cooldown();
    };
    // Cascaded at minute 30 (not 60, the Ring's own deadline, and not the
    // advance endpoint): the wait ends at 1470.
    expect(timeline([30])).toEqual({ remaining: 0, availableAt: '1470' });
    expect(timeline([40])).toEqual({ remaining: 0, availableAt: '1470' });
    expect(timeline([2880])).toEqual({ remaining: 1, availableAt: undefined });
    const whole = timeline([2880]);
    expect(timeline([30, 1440, 1410])).toEqual(whole);
    expect(timeline([30, 1439, 1, 1410])).toEqual(whole);
    expect(timeline([1469, 1411])).toEqual(whole);
    expect(timeline([1470, 1410])).toEqual(whole);
  }, 60_000);
});

describe('olc5.12.10 Ebony Fly (stat block grant)', () => {
  it('binds the Ebony Fly grant to a combatant built from stat-block:giant-fly, and refuses another creature', () => {
    const s = setup(pack, {
      extraActors: [
        {
          actorId: 'fly',
          rulesRef: 'stat-block:giant-fly',
          hpMax: 19,
          hpCurrent: 19,
          side: 'ally',
        },
      ],
    });
    const flyId = s.install(
      'magic-item:figurine-of-wondrous-power',
      'fig-fly',
      {
        variantId: 'ebony-fly',
      },
    );
    const grant = {
      ref: 'magic-item:figurine-of-wondrous-power',
      grantRef: 'ebony-fly',
      itemInstanceId: flyId,
    };
    const wrong = s.summon('fx-fly-wrong', grant, {
      actors: [{ combatantId: 'c-dog' }],
    });
    expect(wrong).toMatchObject({ ok: false });
    expect(wrong.message).toMatch(/does not create/);
    const bound = s.summon('fx-fly', grant, {
      actors: [{ combatantId: 'c-fly' }],
    });
    expect(bound).toMatchObject({
      ok: true,
      data: {
        effect: {
          duration: { kind: 'timed', amount: 12, unit: 'hour' },
          durationProvenance: { kind: 'typed-fixed', amount: 12, unit: 'hour' },
        },
      },
    });
    advanceWorldTime(s.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      minutes: 720,
      provenance: 'test:ebony-fly',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
      resolveRulesPack: () => pack,
      rng: createSeededRng(5),
    });
    expect(s.effect('fx-fly')).toMatchObject({
      status: 'ended',
      endReason: 'expired',
    });
  });
});

// ---------------------------------------------------------------------------
// olc5.12.12: lifecycle reconciliation (S8-S13). The DM declares transitions;
// the engine computes only the printed clocks.
// ---------------------------------------------------------------------------

/** The five carriers whose grants print 'as spell:conjure-elemental'. */
const AS_SPELL_CARRIERS = [
  [
    'magic-item:bowl-of-commanding-water-elementals',
    'water-elemental',
    'c-water',
  ],
  [
    'magic-item:brazier-of-commanding-fire-elementals',
    'fire-elemental',
    'c-fire',
  ],
  ['magic-item:censer-of-controlling-air-elementals', 'air-elemental', 'c-air'],
  [
    'magic-item:stone-of-controlling-earth-elementals',
    'earth-elemental',
    'c-earth',
  ],
  ['magic-item:elemental-gem', 'gem-elemental', 'c-earth'],
] as const;

function combatantStatus(db: ReturnType<typeof setup>['db'], id: string) {
  return (
    db
      .prepare(
        'SELECT status FROM encounter_combatant WHERE combatant_id = ? AND campaign_id = ?',
      )
      .get(id, DEFAULT_TEST_CAMPAIGN_ID) as { status: string } | undefined
  )?.status;
}

function liveEffects(s: ReturnType<typeof setup>) {
  return listActiveEffects(s.db, DEFAULT_TEST_CAMPAIGN_ID, {})
    .map((row) => `${row.effectId}:${row.status}`)
    .sort();
}

const OVERRIDE = {
  basis: 'dm-adjudicated',
  reason: 'the owner wants it to last longer',
};

describe('olc5.12.12 as-spell lifetime (S8) and partition invariance (S9)', () => {
  for (const [key, grantId, actor] of AS_SPELL_CARRIERS) {
    it(`S8 ${grantId}: refresh of the predecessor and of the successor never rewrites the printed hour, and the creature leaves at the deadline`, () => {
      const s = setup(pack, { extraActors: REPAIR_ACTORS });
      const itemId = s.install(key, `item-${grantId}`);
      const effectId = `fx-${grantId}`;
      expect(
        s.summon(
          effectId,
          { ref: key, grantRef: grantId, itemInstanceId: itemId },
          {
            concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
            actors: [{ combatantId: actor }],
          },
        ),
      ).toMatchObject({ ok: true });
      const changes = [
        { kind: 'until-removed' },
        { kind: 'timed', amount: 2, unit: 'hour', anchor: 'effect-created' },
      ];
      const refuseAll = (id: string) => {
        for (const duration of changes)
          for (const override of [undefined, OVERRIDE]) {
            const refused = s.call('refresh_effect', {
              effectId: id,
              duration,
              ...(override === undefined ? {} : { durationOverride: override }),
            });
            expect(refused, `${id} ${JSON.stringify(duration)}`).toMatchObject({
              ok: false,
            });
            expect(refused.message).toMatch(/end_effect/);
          }
      };
      refuseAll(effectId);
      expect(s.effect(effectId)).toMatchObject({
        status: 'active',
        duration: { kind: 'timed', amount: 1, unit: 'hour' },
      });
      s.must('end_effect', {
        effectId,
        reason: 'concentration-broken',
        detail: 'voluntary',
      });
      const successorId = `${effectId}:uncontrolled`;
      expect(s.effect(successorId)).toMatchObject({
        status: 'active',
        duration: {
          kind: 'timed',
          amount: 1,
          unit: 'hour',
          deadlineElapsedMinutes: 60,
        },
      });
      refuseAll(successorId);
      // A re-anchor that would move the printed deadline is a rewrite too.
      s.must('advance_time', { minutes: 10 });
      const moved = s.call('refresh_effect', { effectId: successorId });
      expect(moved).toMatchObject({ ok: false });
      expect(moved.message).toMatch(/end_effect/);
      expect(s.effect(successorId)).toMatchObject({
        duration: { deadlineElapsedMinutes: 60 },
      });
      expect(combatantStatus(s.db, actor)).toBe('alive');
      s.must('advance_time', { minutes: 50 });
      expect(s.effect(successorId)).toMatchObject({
        status: 'ended',
        endReason: 'expired',
      });
      expect(combatantStatus(s.db, actor)).toBe('absent');
    }, 30_000);

    it(`S9 ${grantId}: a successor created inside one advance is settled in it, whatever the partition`, () => {
      const timeline = (steps: readonly number[]) => {
        const s = setup(pack, { extraActors: REPAIR_ACTORS });
        const itemId = s.install(key, `item-${grantId}`);
        expect(
          s.summon(
            `fx-${grantId}`,
            { ref: key, grantRef: grantId, itemInstanceId: itemId },
            {
              concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
              actors: [{ combatantId: actor }],
            },
          ),
        ).toMatchObject({ ok: true });
        // A 30-minute effect owns the concentrating combatant: its expiry
        // removes the owner, breaks the concentration and creates the
        // successor, whose copied deadline (minute 60) lies in the advance.
        s.must('start_effect', {
          effectId: 'fx-owner-summon',
          kind: 'summoning',
          displayName: 'owner summon',
          source: { kind: 'ruling' },
          duration: {
            kind: 'timed',
            amount: 30,
            unit: 'minute',
            anchor: 'effect-created',
          },
          actors: [{ combatantId: 'c-wiz', cleanupOnEnd: 'remove' }],
        });
        for (const minutes of steps) s.must('advance_time', { minutes });
        return {
          presence: combatantStatus(s.db, actor),
          effects: liveEffects(s),
        };
      };
      const whole = timeline([120]);
      expect(whole.presence).toBe('absent');
      expect(whole.effects).toEqual([]);
      expect(timeline([30, 90])).toEqual(whole);
      expect(timeline([30, 30, 60])).toEqual(whole);
      expect(timeline([45, 75])).toEqual(whole);
      expect(timeline([61, 59])).toEqual(whole);
    }, 30_000);
  }
});

interface DestroyCarrier {
  readonly name: string;
  readonly key: string;
  readonly grantId: string;
  readonly actor: string;
  readonly economy: 'cooldown' | 'stopper';
  readonly operationId: string;
  readonly worn: boolean;
  readonly owner: boolean;
}

const ANCHORED_CARRIERS: readonly DestroyCarrier[] = [
  {
    name: 'Ring of Djinni Summoning',
    key: RING,
    grantId: 'particular-djinni',
    actor: 'c-djinni',
    economy: 'cooldown',
    operationId: 'summon-djinni',
    worn: true,
    owner: true,
  },
  {
    name: 'Efreeti Bottle serving grant',
    key: 'magic-item:efreeti-bottle',
    grantId: 'serving-efreeti',
    actor: 'c-efreeti',
    economy: 'stopper',
    operationId: 'remove-stopper',
    worn: false,
    owner: false,
  },
];

function anchoredScenario(carrier: DestroyCarrier) {
  const waived = waivedPack(carrier.key);
  const s = setup(waived, { extraActors: REPAIR_ACTORS });
  const itemId = s.install(carrier.key, `item-${carrier.grantId}`, {
    worn: carrier.worn,
  });
  s.must('begin_turn', { character: 'pc-1', round: 1 });
  spend(s.db, itemId, carrier.operationId, waived);
  const effectId = `fx-${carrier.grantId}`;
  const bind = (extra: Record<string, unknown> = {}) =>
    s.summon(
      effectId,
      { ref: carrier.key, grantRef: carrier.grantId, itemInstanceId: itemId },
      {
        ...(carrier.owner
          ? { concentrationOwner: { kind: 'combatant', ref: 'c-wiz' } }
          : {}),
        actors: [{ combatantId: carrier.actor }],
        ...extra,
      },
    );
  const economy = () => {
    const state = readItemState(s.db, itemId)?.economies?.[carrier.economy];
    return state === undefined
      ? undefined
      : { remaining: state.remaining, availableAt: state.availableAt };
  };
  return { ...s, itemId, effectId, bind, economy };
}

describe('olc5.12.12 destroyed source tombstone (S11) and partial removal (S12)', () => {
  for (const carrier of ANCHORED_CARRIERS) {
    it(`S11 ${carrier.name}: a destroyed source instance still lets the grant expire and be ended, with no wait scheduled; a dropped one still anchors`, () => {
      // Destroyed + advance_time past the deadline.
      const a = anchoredScenario(carrier);
      expect(a.bind()).toMatchObject({ ok: true });
      a.must('remove_item', { id: a.itemId, disposition: 'destroyed' });
      expect(a.economy()).toBeUndefined();
      a.must('advance_time', { minutes: 120 });
      expect(a.effect(a.effectId)).toMatchObject({
        status: 'ended',
        endReason: 'expired',
      });
      expect(combatantStatus(a.db, carrier.actor)).toBe('absent');
      expect(a.economy()).toBeUndefined();
      // Destroyed + explicit end_effect.
      const b = anchoredScenario(carrier);
      expect(b.bind()).toMatchObject({ ok: true });
      b.must('remove_item', { id: b.itemId, disposition: 'destroyed' });
      b.must('end_effect', {
        effectId: b.effectId,
        reason: 'ruled',
        note: 'the source was destroyed',
      });
      expect(b.effect(b.effectId)).toMatchObject({ status: 'ended' });
      expect(b.economy()).toBeUndefined();
      // Contrast: a dropped instance keeps its identity, so the wait anchors.
      const c = anchoredScenario(carrier);
      expect(c.bind()).toMatchObject({ ok: true });
      c.db.exec("UPDATE clock SET current_location_id='market' WHERE id=1");
      c.must('remove_item', { id: c.itemId, disposition: 'dropped' });
      c.must('advance_time', { minutes: 120 });
      expect(c.effect(c.effectId)).toMatchObject({ status: 'ended' });
      expect(c.economy()).toMatchObject({ availableAt: '1500' });
    }, 30_000);

    it(`S12 ${carrier.name}: remove_effect_target refuses the granted creature's target and leaves state unchanged; another target stays removable`, () => {
      const r = anchoredScenario(carrier);
      expect(
        r.bind({
          targets: [
            { kind: 'combatant', ref: carrier.actor },
            { kind: 'combatant', ref: 'c-goblin' },
          ],
        }),
      ).toMatchObject({ ok: true });
      const snapshot = () =>
        JSON.stringify({
          effects: listActiveEffects(r.db, DEFAULT_TEST_CAMPAIGN_ID, {
            includeEnded: true,
          }),
          presence: combatantStatus(r.db, carrier.actor),
          economy: r.economy(),
        });
      r.must('advance_time', { minutes: 10 });
      const afterAdvance = snapshot();
      const refused = r.call('remove_effect_target', {
        effectId: r.effectId,
        target: { kind: 'combatant', ref: carrier.actor },
        reason: 'ruled',
      });
      expect(refused).toMatchObject({ ok: false });
      expect(refused.message).toMatch(/end_effect/);
      expect(snapshot()).toBe(afterAdvance);
      expect(
        r.call('remove_effect_target', {
          effectId: r.effectId,
          target: { kind: 'combatant', ref: 'c-goblin' },
          reason: 'ruled',
        }),
      ).toMatchObject({ ok: true });
      expect(r.effect(r.effectId)).toMatchObject({ status: 'active' });
      expect(combatantStatus(r.db, carrier.actor)).toBe('alive');
    }, 30_000);
  }
});
