/** eshyra-c58j.1: every item operation that is READY on the UNMODIFIED bundled
 * pack because its creature-grant lifecycle/identity hooks are owned per clause
 * is exercised end to end with NO readiness waiver: use_item (readiness
 * preflight, turn resource, cost) and then the start_effect grant bind
 * (bind credit or grant-anchored spend), the live identity, and the printed
 * 0-hit-point ending. This is what backs the compiler's ownership claim with
 * working runtime (the compiler test re-derives the claim from pack data). */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  attuneItem,
  createDefaultToolRegistry,
  createInitialItemState,
  createSeededRng,
  deriveItemOperationReadinessInput,
  donItem,
  getBundledDnd5eSrdPack,
  giveItem,
  listActiveEffects,
  magicItemVariantDefinitions,
  readItemState,
  useItem,
  writeItemState,
} from '../src/internal.js';
import { assertMagicItemOperationReady } from '../src/state/itemExecutionReadiness.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-10-17T10:00:00.000Z';
const pack = getBundledDnd5eSrdPack();
type Obj = Record<string, unknown>;

/** Operations of grant-bearing items that pass the readiness preflight on the
 * unmodified pack, enumerated from the pack (not hard-coded). */
function readyGrantOperations(): { key: string; operationId: string }[] {
  const ready: { key: string; operationId: string }[] = [];
  for (const record of pack.records) {
    if (record.kind !== 'magic-item') continue;
    const data = record.data as Obj;
    if ((data.mechanics as Obj | undefined)?.entityGrant === undefined)
      continue;
    const ids = new Set<string>(['activate', 'deactivate']);
    for (const operation of ((data.mechanics as Obj).operations ?? []) as Obj[])
      ids.add(String(operation.id));
    const variantIds: (string | undefined)[] =
      magicItemVariantDefinitions(record).length === 0
        ? [undefined]
        : magicItemVariantDefinitions(record).map(({ id }) => id);
    for (const variantId of variantIds)
      for (const operationId of ids) {
        try {
          assertMagicItemOperationReady(
            record,
            variantId,
            deriveItemOperationReadinessInput(record, variantId, operationId),
          );
          ready.push({ key: record.key, operationId });
        } catch {
          // not ready
        }
      }
  }
  return ready;
}

/** How each ready operation's grant is bound: the linked creature and whether
 * the printed grant needs a concentration owner (Ring: concentration ends it). */
const BIND: Record<
  string,
  { rulesRef: string; concentration: boolean; worn: boolean }
> = {
  'magic-item:horn-of-valhalla|blow-horn': {
    rulesRef: 'creature:berserker',
    concentration: false,
    worn: false,
  },
  'magic-item:ring-of-djinni-summoning|summon-djinni': {
    rulesRef: 'creature:djinni',
    concentration: true,
    worn: true,
  },
};

function world(rulesRef: string) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(7),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'c58j-1',
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
        actorId: 'wiz',
        rulesRef: 'creature:goblin',
        hpMax: 20,
        hpCurrent: 20,
        side: 'ally',
      },
      {
        actorId: 'summoned',
        rulesRef,
        hpMax: 100,
        hpCurrent: 100,
        side: 'ally',
      },
    ],
  });
  const domainCtx = {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    characterId: 'pc-1',
    provenance: 'test:c58j-1',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: NOW,
  };
  return { db, call, must, domainCtx };
}

describe('eshyra-c58j.1 real-pack conformance: ready creature-grant operations (no waiver)', () => {
  const ready = readyGrantOperations();

  it('every ready grant-bearing operation has a conformance row below', () => {
    expect(
      ready.map(({ key, operationId }) => `${key}|${operationId}`).sort(),
    ).toEqual(Object.keys(BIND).sort());
  });

  for (const { key, operationId } of ready) {
    const row = BIND[`${key}|${operationId}`];
    if (row === undefined) continue;
    it(`${key} ${operationId}: use_item, then bind, identity and printed ending`, () => {
      const record = pack.records.find((entry) => entry.key === key);
      if (record === undefined) throw new Error(`no ${key}`);
      const w = world(row.rulesRef);
      const created = giveItem(
        w.db,
        { id: 'item-1', name: record.name, packRef: key, stateful: true },
        w.domainCtx,
      );
      writeItemState(
        w.db,
        created.id,
        createInitialItemState(key, record, {}),
        w.domainCtx,
      );
      if (row.worn) donItem(w.db, { ...w.domainCtx, itemId: created.id });
      if ((record.data as Obj).requiresAttunement === true)
        attuneItem(w.db, {
          ...w.domainCtx,
          characterRef: 'pc-1',
          itemId: created.id,
          itemRef: key,
        });
      w.must('begin_turn', { character: 'pc-1', round: 1 });

      const grantSource = (grantRef: string) => ({
        kind: 'magic-item',
        ref: key,
        grantRef,
        itemInstanceId: created.id,
      });
      const grantRefs = (
        ((record.data as Obj).mechanics as { entityGrant: { grants: Obj[] } })
          .entityGrant.grants as Obj[]
      ).map((grant) => String(grant.id));
      const owner = row.concentration
        ? { concentrationOwner: { kind: 'character', ref: 'pc-1' } }
        : {};
      const bind = (effectId: string) =>
        w.call('start_effect', {
          effectId,
          kind: 'summoning',
          displayName: effectId,
          source: grantSource(grantRefs[0] as string),
          actors: [{ combatantId: 'c-summoned' }],
          ...owner,
        });

      // Before the spend the grant is unpaid: the bind is refused.
      expect(bind('fx-unpaid')).toMatchObject({ ok: false });

      // use_item on the UNMODIFIED pack: the readiness preflight passes.
      const spent = useItem(w.db, {
        ...w.domainCtx,
        instanceId: created.id,
        operationId,
        rng: createSeededRng(3),
        resolveRulesPack: () => pack,
      } as never);
      // An anchored grant (Ring) reports bindGrant; a credit-paid grant (Horn)
      // reports the bind credit the spend issued.
      expect(JSON.stringify(spent.hint)).toContain(grantRefs[0] as string);

      // The bind redeems the spend (credit or anchored coupling) ...
      expect(bind('fx-bound')).toMatchObject({ ok: true });
      const live = listActiveEffects(w.db, DEFAULT_TEST_CAMPAIGN_ID).find(
        ({ effectId }) => effectId === 'fx-bound',
      );
      expect(live).toMatchObject({
        status: 'active',
        itemGrant: {
          grantId: grantRefs[0],
          itemInstanceId: created.id,
          packRef: key,
        },
      });

      // ... exactly once: one spend pays for one bind.
      expect(bind('fx-again')).toMatchObject({ ok: false });

      // The printed 0-hit-point ending removes the grant; no waiver involved.
      w.must('update_combatant', { combatantId: 'c-summoned', hpDelta: -100 });
      expect(
        listActiveEffects(w.db, DEFAULT_TEST_CAMPAIGN_ID, {
          includeEnded: true,
        }).find(({ effectId }) => effectId === 'fx-bound'),
      ).toMatchObject({ status: 'ended' });
      expect(readItemState(w.db, created.id)).toBeDefined();
    });
  }
});
