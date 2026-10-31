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
  const computed = [
    'timer',
    'zero-hit-points',
    'concentration-ended',
    'next-dawn',
  ];
  return (
    grants.length > 0 &&
    grants.every((grant) => {
      const endings = (grant.revertOn as string[] | undefined) ?? [];
      const creatureRefs = (grant.creatureRefs as unknown[] | undefined) ?? [];
      // eshyra-olc5.16.1: or the creature is selected by the engine's `1dN`
      // roll over exactly N creatureRefs (the table rows), bound to the use.
      const rolled =
        typeof grant.creatureRoll === 'string'
          ? /^1d(\d+)$/.exec(grant.creatureRoll)
          : null;
      return (
        grant.kind === 'creature' &&
        // PR #690 review: the binder verifies the creature only when the grant
        // names exactly one (one creatureRef, or one statBlockRef).
        (rolled !== null
          ? grant.statBlockRef === undefined &&
            creatureRefs.length === Number(rolled[1])
          : typeof grant.statBlockRef === 'string'
            ? creatureRefs.length === 0
            : creatureRefs.length === 1) &&
        // PR #673 review: only a fixed printed count is bound (P2-1), and a
        // death-triggered item consequence is not applied by any runtime (P2-2).
        // eshyra-olc5.14: a printed rolled count (`countRoll`) is bound too,
        // against the engine's own roll persisted on the use's bind credit.
        (typeof grant.count === 'number' ||
          typeof grant.countRoll === 'string') &&
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

const OWNED_ITEMS = [
  // eshyra-olc5.16.1: the color is the variant; the d8 row is rolled per use
  // (creatureRoll) and the binder admits only that row's creature
  'Bag of Tricks',
  'Bowl of Commanding Water Elementals',
  'Brazier of Commanding Fire Elementals',
  'Censer of Controlling Air Elementals',
  // countRoll per horn-type variant (eshyra-olc5.14)
  'Horn of Valhalla',
  // eshyra-olc5.15: its printed death consequence is TYPED (a stateMachine
  // condition transition with becomes: nonmagical) and executed by
  // item_state_event, so the guard no longer holds the grant pending.
  'Ring of Djinni Summoning',
  'Stone of Controlling Earth Elementals',
];
/** Every grant-bearing item that keeps the hooks, with the reason it does. */
const KEPT_ITEMS: Record<string, string> = {
  'Elemental Gem':
    'creature selected by the gem type (four elementals) not bound to the instance',
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
  it('the death-consequence guard holds only untyped onEntityDeath notes, and none remain (eshyra-olc5.15)', () => {
    // The Ring (typed transition), the Staff (typed destroysItemOn) and the
    // Efreeti Bottle (the source prints no death-triggered item transition)
    // left the guard; it stays as the fail-closed mechanism for any future
    // curated onEntityDeath note.
    expect([...MAGIC_ITEM_ENTITY_GRANTS_WITH_DEATH_CONSEQUENCE].sort()).toEqual(
      [],
    );
  });

  it('every typed death consequence the pack carries is one the runtime executes (triage never strips an unexecuted one)', () => {
    // A source-grounded consequence is either typed AND executed, or its grant
    // stays pending (the guard above). Pin the typed forms and who runs them.
    const ring = items.find(
      (record) => record.name === 'Ring of Djinni Summoning',
    );
    const machine = (((ring as { data: unknown }).data as Obj).mechanics as Obj)
      .stateMachine as Obj;
    expect(
      (machine.transitions as Obj[]).filter(
        (transition) => transition.becomes !== undefined,
      ),
    ).toEqual([
      {
        from: 'magical',
        to: 'nonmagical',
        condition: 'the djinni dies',
        becomes: 'nonmagical',
      },
    ]);
    const typedForms = new Set<string>();
    for (const record of items) {
      const mechanics = (record.data as Obj).mechanics as Obj | undefined;
      const scopes = [
        mechanics,
        ...(((record.data as Obj).variants as Obj[] | undefined) ?? []).map(
          (variant) => variant.mechanics as Obj | undefined,
        ),
      ];
      for (const scope of scopes) {
        for (const transition of ((scope?.stateMachine as Obj | undefined)
          ?.transitions ?? []) as Obj[])
          if (transition.becomes !== undefined)
            typedForms.add(`${record.name}|becomes:${transition.becomes}`);
        for (const grant of ((scope?.entityGrant as Obj | undefined)?.grants ??
          []) as Obj[])
          if (grant.destroysItemOn !== undefined)
            typedForms.add(
              `${record.name}|destroysItemOn:${grant.destroysItemOn}`,
            );
      }
    }
    // Executed by item_state_event (becomes) and by the grant-ending choke
    // point (destroysItemOn): itemStateEventNonmagical.test.ts and
    // itemGrantDestroysSource.test.ts drive each on the real pack.
    expect([...typedForms].sort()).toEqual([
      'Ring of Djinni Summoning|becomes:nonmagical',
      'Staff of the Python|destroysItemOn:reduced-to-0-hit-points',
    ]);
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
      extra: Obj = { count: 1, creatureRefs: ['creature:x'] },
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
    it('owns a next-dawn ending (engine-computed, eshyra-7gkh.1) and keeps a DM-ended one beside it', () => {
      expect(
        creatureGrantLifecycleOwned(
          block([creature(['next-dawn', 'reduced-to-0-hit-points'])]),
        ),
      ).toBe(true);
      expect(
        creatureGrantLifecycleOwned(
          block([creature(['next-dawn', 'owner-dismisses-as-action'])]),
        ),
      ).toBe(false);
    });
    it('keeps a grant that does not name exactly one creature (PR #690 review)', () => {
      const ends = ['one-hour-ended'];
      // A creature chosen from a table (Bag of Tricks) or among several refs
      // (Elemental Gem) is not verified by the binder.
      for (const extra of [
        { count: 1, tableRefs: ['table:t'] },
        { count: 1, creatureRefs: ['creature:x', 'creature:y'] },
        {
          count: 1,
          creatureRefs: ['creature:x'],
          statBlockRef: 'stat-block:s',
        },
      ])
        expect(
          creatureGrantLifecycleOwned(
            block([creature(ends, 'creature', extra)]),
          ),
        ).toBe(false);
      for (const extra of [
        { count: 1, creatureRefs: ['creature:x'] },
        { count: 1, statBlockRef: 'stat-block:s' },
      ])
        expect(
          creatureGrantLifecycleOwned(
            block([creature(ends, 'creature', extra)]),
          ),
        ).toBe(true);
    });
    it('owns a creatureRoll over exactly N creatureRefs and keeps any other multi-creature grant (eshyra-olc5.16.1)', () => {
      const endings = ['next-dawn', 'reduced-to-0-hit-points'];
      const refs8 = Array.from({ length: 8 }, (_, i) => `creature:c${i}`);
      const rolled = {
        count: 1,
        creatureRefs: refs8,
        tableRefs: ['table:t'],
        creatureRoll: '1d8',
      };
      expect(
        creatureGrantLifecycleOwned(
          block([creature(endings, 'creature', rolled)]),
        ),
      ).toBe(true);
      // Counterfactuals: a roll whose N differs from the number of rows, a
      // statBlockRef beside the roll, and the same refs without the roll are
      // all not owned (the binder could not verify the creature).
      for (const extra of [
        { ...rolled, creatureRoll: '1d6' },
        { ...rolled, creatureRefs: refs8.slice(0, 7) },
        { ...rolled, statBlockRef: 'stat-block:s' },
        { ...rolled, creatureRoll: undefined },
      ])
        expect(
          creatureGrantLifecycleOwned(
            block([creature(endings, 'creature', extra)]),
          ),
        ).toBe(false);
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
    it('admits a countRoll (the engine-rolled, binder-enforced count) exactly where it is present (eshyra-olc5.14)', () => {
      const endings = ['reduced-to-0-hit-points', 'one-hour-ended'];
      const withRoll = creature(endings, 'creature', {
        creatureRefs: ['creature:berserker'],
        tableRefs: ['table:horn-of-valhalla'],
        countRoll: '2d4+2',
      });
      expect(creatureGrantLifecycleOwned(block([withRoll]))).toBe(true);
      const { countRoll: _removed, ...withoutRoll } = withRoll;
      expect(creatureGrantLifecycleOwned(block([withoutRoll]))).toBe(false);
      // Every grant of the block must carry a count or a roll.
      expect(
        creatureGrantLifecycleOwned(
          block([withRoll, creature(endings, 'creature', {})]),
        ),
      ).toBe(false);
      // The rest of the rule is unchanged for a rolled count.
      expect(
        creatureGrantLifecycleOwned(
          block([{ ...withRoll, onEntityDeath: 'make the horn nonmagical' }]),
        ),
      ).toBe(false);
      expect(
        creatureGrantLifecycleOwned(
          block([{ ...withRoll, revertOn: ['owner-dies'] }]),
        ),
      ).toBe(false);
    });
    it('keeps a grant without a fixed count, or with a death-triggered item consequence (PR #673 review)', () => {
      const endings = ['reduced-to-0-hit-points', 'one-hour-ended'];
      // No count at all, and a table-referenced count with no typed count or
      // countRoll (the Horn before eshyra-olc5.14): either would admit any
      // number of linked actors.
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
