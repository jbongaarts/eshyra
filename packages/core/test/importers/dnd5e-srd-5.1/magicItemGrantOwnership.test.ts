/**
 * Per-clause ownership of the creature-grant lifecycle and identity hooks
 * (eshyra-c58j.1).
 *
 * The F3 lifecycle hook and the F5 identity-link hook are NOT in
 * LANDED_MAGIC_ITEM_ENGINE_HOOKS. The classifier removes them from an
 * `entityGrant` clause only for a grant the runtime binds and ends
 * (creatureGrantLifecycleOwned). This file re-derives that rule independently
 * over the whole generated pack: a hook disappears exactly from the classified
 * creature-grant clauses and stays everywhere else, with the illusion, object,
 * containment, DM-ended and no-printed-ending grants explicitly kept. The F2
 * control hook moves to an adjudicated clause (control stays DM-adjudicated);
 * F4 on the Elemental Gem quantity clause stays.
 */
import { describe, expect, it } from 'vitest';
import {
  CREATURE_GRANT_LIFECYCLE_HOOK_KEYS,
  LANDED_MAGIC_ITEM_ENGINE_HOOKS,
  magicItemEngineHookKey,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import { MAGIC_ITEM_ENTITY_GRANTS_WITH_DEATH_CONSEQUENCE } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemEntityGrants.js';
import {
  CREATURE_GRANT_LIFECYCLE_HOOKS,
  creatureGrantLifecycleOwned,
  ENGINE_COMPUTED_GRANT_ENDINGS,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemGrantOwnership.js';
import {
  getBundledDnd5eSrdPack,
  ITEM_GRANT_REVERT_DISPOSITIONS,
} from '../../../src/internal.js';

type Obj = Record<string, unknown>;
const F2_HOOK = 'controlled-entity command action budget';
const F4_HOOK = 'spell execution and summoned entity ownership';
const LIFECYCLE_KEYS = new Set(
  CREATURE_GRANT_LIFECYCLE_HOOKS.map(magicItemEngineHookKey),
);

const pack = getBundledDnd5eSrdPack();
const items = pack.records.filter((record) => record.kind === 'magic-item');
interface Clause {
  readonly clauseId: string;
  readonly readiness: string;
  readonly representation: Obj;
  readonly engineHooks?: { engine: string; hook: string }[];
  readonly missingHooks?: { engine: string; hook: string }[];
  readonly scope: { kind: string };
}
const clausesOf = (record: { data: unknown }): Clause[] =>
  ((record.data as Obj).executionReadiness as { clauses: Clause[] }).clauses;

/** The OWNED set, re-derived here independently of the compiler function. */
function independentlyOwned(record: { name: string; data: unknown }): boolean {
  // The pack strips the printed death consequence; the reviewed spec keeps it.
  if (MAGIC_ITEM_ENTITY_GRANTS_WITH_DEATH_CONSEQUENCE.has(record.name))
    return false;
  const mechanics = (record.data as Obj).mechanics as Obj | undefined;
  const block = mechanics?.entityGrant as Obj | undefined;
  if (block === undefined || mechanics?.containment !== undefined) return false;
  if (
    !['encounter-combatant', 'persistent-actor'].includes(
      String(block.runtimeOwner),
    )
  )
    return false;
  const grants = block.grants as Obj[];
  const computed = ['timer', 'zero-hit-points', 'concentration-ended'];
  return (
    grants.length > 0 &&
    grants.every((grant) => {
      const endings = (grant.revertOn as string[] | undefined) ?? [];
      return (
        grant.kind === 'creature' &&
        // PR #673 review: only a fixed printed count is bound (P2-1), and a
        // death-triggered item consequence is not applied by any runtime (P2-2).
        typeof grant.count === 'number' &&
        grant.onEntityDeath === undefined &&
        endings.length > 0 &&
        endings.every((ending) =>
          computed.includes(
            (ITEM_GRANT_REVERT_DISPOSITIONS[ending] as { kind: string }).kind,
          ),
        )
      );
    })
  );
}

const OWNED_ITEMS = ['Elemental Gem'];
/** Every grant-bearing item that keeps the hooks, with the reason it does. */
const KEPT_ITEMS: Record<string, string> = {
  'Bag of Tricks': 'next-dawn ending is DM-ended; bonus-action command budget',
  'Bowl of Commanding Water Elementals':
    'no fixed printed count ("an elemental" is untyped): any number of actors would bind',
  'Brazier of Commanding Fire Elementals': 'no fixed printed count',
  'Censer of Controlling Air Elementals': 'no fixed printed count',
  'Horn of Valhalla':
    'count is rolled on table:horn-of-valhalla (2d4+2 ... 5d4+5); the binder enforces no rolled count',
  'Ring of Djinni Summoning':
    'onEntityDeath (the ring becomes nonmagical when the djinni dies) is applied by no runtime',
  'Stone of Controlling Earth Elementals': 'no fixed printed count',
  'Deck of Illusions': 'illusion grant, not bound by start_effect',
  'Efreeti Bottle': 'third-wish-granted ending is DM-ended; outcomes (.12.4)',
  'Feather Token': 'object whip grant mixed in; DM-ended endings',
  'Figurine of Wondrous Power':
    'owner-command-while-touching and obeyed-owner-command endings are DM-ended',
  'Iron Flask': 'containment release; prints no ending',
  'Manual of Golems': 'prints no ending (remove-on-end would be inferred)',
  'Pipes of the Sewers': 'prints no ending (remove-on-end would be inferred)',
  'Staff of the Python': 'owner-bonus-action-command ending is DM-ended',
};

describe('creature-grant lifecycle hook ownership (eshyra-c58j.1)', () => {
  it('the death-consequence set is exactly the reviewed onEntityDeath grants', () => {
    expect([...MAGIC_ITEM_ENTITY_GRANTS_WITH_DEATH_CONSEQUENCE].sort()).toEqual(
      ['Efreeti Bottle', 'Ring of Djinni Summoning', 'Staff of the Python'],
    );
  });

  it('the hooks are not globally landed', () => {
    for (const key of CREATURE_GRANT_LIFECYCLE_HOOK_KEYS)
      expect(LANDED_MAGIC_ITEM_ENGINE_HOOKS.has(key)).toBe(false);
    expect(CREATURE_GRANT_LIFECYCLE_HOOK_KEYS.size).toBe(2);
  });

  it('the engine-computed ending set is exactly the runtime timer / 0-hp / concentration dispositions', () => {
    const computed = Object.entries(ITEM_GRANT_REVERT_DISPOSITIONS)
      .filter(([, d]) => d.kind !== 'dm-ended')
      .map(([value]) => value)
      .sort();
    expect([...ENGINE_COMPUTED_GRANT_ENDINGS].sort()).toEqual(computed);
  });

  it('partitions every grant-bearing item into owned or kept, exactly as pinned', () => {
    const grantItems = items.filter(
      (record) =>
        ((record.data as Obj).mechanics as Obj | undefined)?.entityGrant,
    );
    const names = grantItems.map((record) => record.name).sort();
    expect(names).toEqual([...OWNED_ITEMS, ...Object.keys(KEPT_ITEMS)].sort());
    for (const record of grantItems)
      expect(independentlyOwned(record)).toBe(
        OWNED_ITEMS.includes(record.name),
      );
  });

  it('removes F3 and F5 exactly from the owned entityGrant clauses and nowhere else', () => {
    let removed = 0;
    let kept = 0;
    for (const record of items) {
      const owned = independentlyOwned(record);
      for (const clause of clausesOf(record)) {
        const declared = (clause.engineHooks ?? []).filter((h) =>
          LIFECYCLE_KEYS.has(magicItemEngineHookKey(h as never)),
        );
        if (declared.length === 0) continue;
        // The hooks are only ever declared on the entityGrant clause.
        expect(clause.representation.block).toBe('entityGrant');
        const missing = (clause.missingHooks ?? []).filter((h) =>
          LIFECYCLE_KEYS.has(magicItemEngineHookKey(h as never)),
        );
        if (owned) {
          expect(missing).toEqual([]);
          removed += declared.length;
        } else {
          expect(missing).toEqual(declared);
          expect(clause.readiness).toBe('engine-pending');
          kept += declared.length;
        }
      }
    }
    expect(removed).toBe(OWNED_ITEMS.length * 2);
    expect(kept).toBe(Object.keys(KEPT_ITEMS).length * 2);
  });

  it('the owned entityGrant clause is green; every kept one stays engine-pending', () => {
    for (const record of items) {
      const grant = clausesOf(record).find(
        (clause) => clause.representation.block === 'entityGrant',
      );
      if (grant === undefined) continue;
      expect(grant.readiness).toBe(
        OWNED_ITEMS.includes(record.name) ? 'green' : 'engine-pending',
      );
    }
  });

  it('F2 control moves to an adjudicated clause with a verbatim source span only for owned grants', () => {
    for (const record of items) {
      const data = record.data as Obj;
      const clauses = clausesOf(record);
      const grant = clauses.find(
        (clause) => clause.representation.block === 'entityGrant',
      );
      if (grant === undefined) continue;
      const onGrant = (grant.engineHooks ?? []).some((h) => h.hook === F2_HOOK);
      const adjudicatedControl = clauses.filter((clause) =>
        clause.clauseId.includes('/m4-control-'),
      );
      if (OWNED_ITEMS.includes(record.name)) {
        expect(onGrant).toBe(false);
        expect(adjudicatedControl).toHaveLength(1);
        expect(adjudicatedControl[0]?.readiness).toBe('adjudicated-by-design');
        expect(adjudicatedControl[0]?.engineHooks).toBeUndefined();
        const text = String(adjudicatedControl[0]?.representation.sourceText);
        expect(String(data.description)).toContain(text);
        expect(text.length).toBeGreaterThan(0);
        expect((grant.missingHooks ?? []).some((h) => h.hook === F2_HOOK)).toBe(
          false,
        );
      } else {
        // Kept grants keep the engine-pending F2 hook where they declared it.
        expect(adjudicatedControl).toEqual([]);
        if (onGrant)
          expect(
            (grant.missingHooks ?? []).some((h) => h.hook === F2_HOOK),
          ).toBe(true);
      }
    }
  });

  it('the Elemental Gem quantity clause keeps F4 spell execution (not the as-spell lifetime)', () => {
    const gem = items.find((record) => record.name === 'Elemental Gem');
    const quantity = clausesOf(gem as never).find(
      (clause) => clause.representation.economyId === 'quantity',
    );
    expect(quantity?.readiness).toBe('engine-pending');
    expect((quantity?.missingHooks ?? []).map((h) => h.hook)).toEqual([
      F4_HOOK,
    ]);
  });

  describe('rule counterfactuals (synthetic entityGrant blocks)', () => {
    const creature = (
      revertOn: string[] | undefined,
      kind = 'creature',
      extra: Obj = { count: 1 },
    ) => ({
      id: 'g',
      kind,
      ...extra,
      ...(revertOn === undefined ? {} : { revertOn }),
    });
    const block = (grants: Obj[], runtimeOwner = 'encounter-combatant') => ({
      runtimeOwner,
      grants,
    });
    it('owns a creature grant whose printed endings are all engine-computed', () => {
      expect(
        creatureGrantLifecycleOwned(
          block([creature(['reduced-to-0-hit-points', 'one-hour-ended'])]),
        ),
      ).toBe(true);
      expect(
        creatureGrantLifecycleOwned(
          block(
            [creature(['concentration-ended', 'reduced-to-0-hit-points'])],
            'persistent-actor',
          ),
        ),
      ).toBe(true);
    });
    it('keeps illusion, object, containment, DM-ended, empty and mixed grants', () => {
      expect(
        creatureGrantLifecycleOwned(
          block([creature(['card-moved'], 'illusion')], 'illusory-entity'),
        ),
      ).toBe(false);
      expect(
        creatureGrantLifecycleOwned(
          block([creature(['one-hour-ended'], 'object')]),
        ),
      ).toBe(false);
      expect(
        creatureGrantLifecycleOwned(block([creature(['one-hour-ended'])]), {
          containment: {},
        }),
      ).toBe(false);
      for (const ending of [
        'owner-command-while-touching',
        'obeyed-owner-command-while-touching',
        'owner-bonus-action-command',
        'next-dawn',
        'third-wish-granted',
      ])
        expect(
          creatureGrantLifecycleOwned(
            block([creature(['reduced-to-0-hit-points', ending])]),
          ),
        ).toBe(false);
      expect(creatureGrantLifecycleOwned(block([creature(undefined)]))).toBe(
        false,
      );
      expect(creatureGrantLifecycleOwned(block([creature([])]))).toBe(false);
      expect(creatureGrantLifecycleOwned(block([]))).toBe(false);
      expect(
        creatureGrantLifecycleOwned(
          block([
            creature(['one-hour-ended']),
            creature(['one-hour-ended'], 'object'),
          ]),
        ),
      ).toBe(false);
      expect(creatureGrantLifecycleOwned(undefined)).toBe(false);
    });
    it('keeps a grant without a fixed count, or with a death-triggered item consequence (PR #673 review)', () => {
      const endings = ['reduced-to-0-hit-points', 'one-hour-ended'];
      // No count (elemental vessels) and a table-rolled count (Horn).
      expect(
        creatureGrantLifecycleOwned(block([creature(endings, 'creature', {})])),
      ).toBe(false);
      expect(
        creatureGrantLifecycleOwned(
          block([
            creature(endings, 'creature', {
              tableRefs: ['table:horn-of-valhalla'],
            }),
          ]),
        ),
      ).toBe(false);
      // A fixed count with a death consequence (Ring of Djinni Summoning).
      expect(
        creatureGrantLifecycleOwned(
          block([
            creature(endings, 'creature', {
              count: 1,
              onEntityDeath: 'make the ring nonmagical',
            }),
          ]),
        ),
      ).toBe(false);
    });
  });
});
