import { describe, expect, it } from 'vitest';
import {
  advanceWorldTime,
  applyItemCooldownAnchorEvent,
  attuneItem,
  createInitialItemState,
  createSeededRng,
  getBundledDnd5eSrdPack,
  giveItem,
  readItemState,
  resolveRestEventItemResets,
  useItem,
  writeItemState,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const CTX = {
  campaignId: 'campaign-1',
  characterId: 'pc-1',
  provenance: 'test:item-cooldown-anchor',
  sessionId: 'session-1',
  at: '2026-10-13T00:00:00.000Z',
};
const pack = getBundledDnd5eSrdPack();

function record(name: string) {
  const found = pack.records.find(
    (entry) => entry.kind === 'magic-item' && entry.name === name,
  );
  if (found === undefined) throw new Error(`bundled pack has no ${name}`);
  return found;
}

function install(
  db: ReturnType<typeof freshDbWithSession>,
  name: string,
  item = record(name),
) {
  const created = giveItem(
    db,
    {
      id: `anchor-${name.toLowerCase().replaceAll(' ', '-')}`,
      name,
      packRef: item.key,
      stateful: true,
    },
    CTX,
  );
  writeItemState(db, created.id, createInitialItemState(item.key, item), CTX);
  if ((item.data as Record<string, unknown>).requiresAttunement === true)
    attuneItem(db, {
      ...CTX,
      characterRef: 'pc-1',
      itemId: created.id,
      itemRef: item.key,
    });
  return created.id;
}

describe('pack-bound magic-item cooldown anchors', () => {
  it('schedules Wings of Flying on dismissal and timer expiry at the entered-state boundary', () => {
    // State-machine readiness is a separate capability and deliberately stays
    // pending. For this conformance test, preserve the real pack mechanics and
    // waive only that independent preflight so the cooldown boundary itself is
    // exercised through useItem and the live timer executor.
    const wings = record('Wings of Flying');
    const data = wings.data as Record<string, unknown>;
    const readiness = data.executionReadiness as {
      source: string;
      clauses: Record<string, unknown>[];
    };
    const testRecord = {
      ...wings,
      data: {
        ...data,
        executionReadiness: {
          ...readiness,
          clauses: readiness.clauses.map((clause) =>
            (clause.representation as { block?: string } | undefined)?.block ===
            'stateMachine'
              ? { ...clause, readiness: 'green', missingHooks: undefined }
              : clause,
          ),
        },
      },
    };
    const testPack = {
      ...pack,
      records: pack.records.map((r) => (r.key === wings.key ? testRecord : r)),
    };
    const resolveRulesPack = () => testPack;
    const useWings = (
      db: ReturnType<typeof freshDbWithSession>,
      id: string,
      operationId: string,
      rng: { nextInt(maxExclusive: number): number },
    ) =>
      useItem(db, {
        ...CTX,
        instanceId: id,
        operationId,
        provenance: CTX.provenance,
        sessionId: CTX.sessionId,
        at: CTX.at,
        rng,
        resolveRulesPack,
      });
    const db = freshDbWithSession();
    const id = install(db, 'Wings of Flying', testRecord);
    const rng = { nextInt: () => 0 }; // 1d12 resolves to one hour.
    expect(
      readItemState(db, id)?.economies?.cooldown?.availableAt,
    ).toBeUndefined();
    useWings(db, id, 'manifest-wings', rng);
    expect(readItemState(db, id)?.economies?.cooldown).toMatchObject({
      remaining: 0,
    });
    expect(
      readItemState(db, id)?.economies?.cooldown?.availableAt,
    ).toBeUndefined();
    expect(() =>
      applyItemCooldownAnchorEvent(
        db,
        { ...CTX, instanceId: id, packRef: wings.key },
        { event: 'state-entered', stateId: 'inactive' },
      ),
    ).toThrow(/seeded RNG is required/);

    useWings(db, id, 'dismiss-wings', rng);
    expect(readItemState(db, id)?.economies?.cooldown).toMatchObject({
      remaining: 0,
      availableAt: '60',
    });
    db.close();

    const timerDb = freshDbWithSession();
    const timerId = install(timerDb, 'Wings of Flying', testRecord);
    useWings(timerDb, timerId, 'manifest-wings', rng);
    const expired = advanceWorldTime(timerDb, {
      ...CTX,
      minutes: 90,
      resolveRulesPack,
      rng,
    });
    expect(expired.itemTimerResolutions).toMatchObject([
      { from: 'active', to: 'inactive', deadlineElapsedMinutes: 60 },
    ]);
    expect(readItemState(timerDb, timerId)?.economies?.cooldown).toMatchObject({
      remaining: 0,
      availableAt: '120',
    });
    advanceWorldTime(timerDb, { ...CTX, minutes: 30, resolveRulesPack });
    expect(
      readItemState(timerDb, timerId)?.economies?.cooldown?.remaining,
    ).toBe(1);
    timerDb.close();
  });

  it('schedules grant-ended anchors for pack records, leaves repeats alone, and rejects unknown grant ids', () => {
    for (const [name, economy, grantId] of [
      ['Ring of Djinni Summoning', 'cooldown', 'particular-djinni'],
      ['Efreeti Bottle', 'stopper', 'serving-efreeti'],
    ] as const) {
      const db = freshDbWithSession();
      const id = install(db, name);
      expect(
        applyItemCooldownAnchorEvent(
          db,
          { ...CTX, instanceId: id, packRef: record(name).key },
          { event: 'grant-ended', grantId },
        ),
      ).toEqual([]);
      const state = readItemState(db, id);
      if (state === undefined)
        throw new Error('item state was not initialized');
      writeItemState(
        db,
        id,
        {
          ...state,
          economies: {
            ...state.economies,
            [economy]: {
              ...(state.economies?.[economy] ?? { remaining: 0 }),
              remaining: 0,
            },
          },
        },
        CTX,
      );
      const evidence = applyItemCooldownAnchorEvent(
        db,
        {
          ...CTX,
          instanceId: id,
          packRef: record(name).key,
          rng: createSeededRng(7),
        },
        { event: 'grant-ended', grantId },
      );
      expect(evidence).toHaveLength(1);
      expect(readItemState(db, id)?.economies?.[economy]?.availableAt).toBe(
        '1440',
      );
      expect(
        applyItemCooldownAnchorEvent(
          db,
          { ...CTX, instanceId: id, packRef: record(name).key },
          { event: 'grant-ended', grantId },
        ),
      ).toEqual([]);
      expect(() =>
        applyItemCooldownAnchorEvent(
          db,
          { ...CTX, instanceId: id, packRef: record(name).key },
          { event: 'grant-ended', grantId: 'unknown' },
        ),
      ).toThrow(/no cooldown anchor/);
      db.close();
    }
  });

  it('keeps initiation-anchored cooldowns scheduled from use time', () => {
    const db = freshDbWithSession();
    const id = install(db, 'Frost Brand');
    useItem(db, { ...CTX, instanceId: id, operationId: 'extinguish-flames' });
    expect(readItemState(db, id)?.economies?.cooldown).toMatchObject({
      remaining: 0,
      availableAt: '60',
    });
    advanceWorldTime(db, { ...CTX, minutes: 60 });
    expect(readItemState(db, id)?.economies?.cooldown?.remaining).toBe(1);
    db.close();
  });

  it('executes soft-limit safe-use costs from the real pack and restores them at their reset event', () => {
    const db = freshDbWithSession();
    for (const [name, operationId, event] of [
      ['Ring of X-ray Vision', 'activate-x-ray-vision', 'long-rest'],
      ['Wind Fan', 'cast-gust-of-wind', 'dawn'],
    ] as const) {
      const sourceRecord = record(name);
      const data = sourceRecord.data as Record<string, unknown>;
      if (name === 'Ring of X-ray Vision') {
        const effects = data.mechanics as Record<string, unknown>;
        expect(
          (effects.effects as Record<string, unknown>[]).some(
            (effect) => effect.id === 'c2-residual-xray-exhaustion',
          ),
        ).toBe(false);
        expect(
          (data.executionReadiness as { clauses: Record<string, unknown>[] })
            .clauses,
        ).toContainEqual(
          expect.objectContaining({
            readiness: 'adjudicated-by-design',
            representation: expect.objectContaining({
              sourceText:
                'Whenever you use the ring again before taking a long rest, you must succeed on a DC 15 Constitution saving throw or gain one level of exhaustion.',
            }),
          }),
        );
      }
      const readiness = data.executionReadiness as {
        source: string;
        clauses: Record<string, unknown>[];
      };
      const testRecord = {
        ...sourceRecord,
        data: {
          ...data,
          executionReadiness: {
            ...readiness,
            clauses: readiness.clauses.map((clause) => {
              const block = (
                clause.representation as { block?: string } | undefined
              )?.block;
              if (block === 'effects')
                return {
                  ...clause,
                  readiness: 'green',
                  missingHooks: undefined,
                };
              if (block === 'randomProcedure')
                return {
                  ...clause,
                  readiness: 'adjudicated-by-design',
                  missingHooks: undefined,
                };
              return clause;
            }),
          },
        },
      };
      const testPack = {
        ...pack,
        records: pack.records.map((r) =>
          r.key === sourceRecord.key ? testRecord : r,
        ),
      };
      const resolveRulesPack = () => testPack;
      const id = install(db, name, testRecord);
      const input = { ...CTX, instanceId: id, operationId, resolveRulesPack };
      expect(useItem(db, input).costs).toEqual([
        { economy: 'safe-use', amount: 1 },
      ]);
      expect(useItem(db, input).costs).toEqual([
        { economy: 'safe-use', amount: 0 },
      ]);
      if (event === 'long-rest')
        resolveRestEventItemResets(db, {
          ...CTX,
          campaignId: CTX.campaignId,
          event,
          participants: ['pc-1'],
        });
      else advanceWorldTime(db, { ...CTX, minutes: 1_440, resolveRulesPack });
      expect(readItemState(db, id)?.economies?.['safe-use']?.remaining).toBe(1);
    }
    db.close();
  });
});
