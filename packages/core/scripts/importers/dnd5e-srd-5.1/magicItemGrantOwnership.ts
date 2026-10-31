/**
 * Per-clause ownership of the creature-grant lifecycle and identity hooks
 * (eshyra-c58j.1).
 *
 * `start_effect` binds a typed `kind: 'creature'` entity grant to a held (or
 * use_item-consumed) item instance with its grant identity, variant admission,
 * linked actors, printed 0-hit-point / timer / concentration endings,
 * persistent-actor durability, grant-ended cooldown anchors, bind credits,
 * consumption receipts, destroy tombstones and retired ids (eshyra-olc5.12.x).
 * That is what the two hooks below name. They are deliberately NOT in
 * `LANDED_MAGIC_ITEM_ENGINE_HOOKS`: illusion, object and containment grants
 * (Deck of Illusions, the Feather Token whip, the Iron Flask) are not bound by
 * `start_effect`, and a creature grant whose printed ending the engine does not
 * compute is only DM-ended, so the hooks are removed clause by clause.
 */
import type { EngineHookBinding } from './magicItemCompiler.js';

export const CREATURE_GRANT_LIFECYCLE_HOOKS: readonly EngineHookBinding[] = [
  {
    engine: 'F3',
    hook: 'encounter combatant, persistent actor, and owned-entity lifecycle',
  },
  {
    engine: 'F5',
    hook: 'item-instance cooldown and owned-entity identity link',
  },
];

/**
 * The printed `revertOn` values whose ending the engine COMPUTES: fixed timers
 * (the effect's own expiry), the 0-hit-point vanish, the concentration break,
 * and the next dawn (eshyra-7gkh.1: start_effect fills the minute timer to the
 * first dawn boundary strictly after the bind, the same boundary the item reset
 * executor uses, and the world-time expiry ends the grant there). Every other
 * mapped value is `dm-ended` in `ITEM_GRANT_REVERT_DISPOSITIONS`: the DM ends
 * the grant with a ruling, so the printed term (owner-command-while-touching,
 * obeyed owner commands, owner dismissal, ...) is beyond what the runtime
 * implements.
 * `magicItemGrantOwnership.test.ts` pins this set to the runtime table.
 */
export const ENGINE_COMPUTED_GRANT_ENDINGS: ReadonlySet<string> = new Set([
  'duration-ended',
  'one-hour-ended',
  'five-rounds-ended',
  'reduced-to-0-hit-points',
  'concentration-ended',
  'next-dawn',
]);

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}

/**
 * The precise rule. An `entityGrant` block is owned when ALL hold:
 *  - the effective mechanics carry no `containment` block (Iron Flask: its
 *    creature is released from containment, not started by `start_effect`);
 *  - `runtimeOwner` is `encounter-combatant` or `persistent-actor` (never
 *    `illusory-entity`);
 *  - there is at least one grant and EVERY grant is `kind: 'creature'`
 *    (illusion and object grants are DM-adjudicated and refused by
 *    `start_effect`; a block mixing one in, Feather Token, stays pending);
 *  - EVERY grant prints at least one ending and EVERY printed ending is
 *    engine-computed ({@link ENGINE_COMPUTED_GRANT_ENDINGS}). A grant that
 *    prints no ending (Pipes of the Sewers, Manual of Golems, Staff of the
 *    Python) leaves the engine's remove-on-end an inference, and any DM-ended
 *    value is a printed lifecycle term the runtime does not compute;
 *  - A grant names exactly one creature, or selects it by a `creatureRoll`
 *    (`1dN` over exactly N `creatureRefs` in table order): the engine rolls the
 *    row per use, persists it on the bind credit, and the binder admits only
 *    that creature. The bag's color is the instance's variant;
 *  - EVERY grant prints a fixed numeric `count`, or a `countRoll` (eshyra-olc5.14:
 *    Horn of Valhalla's per-horn-type 2d4+2 ... 5d4+5). The binder enforces a
 *    fixed count, and enforces a `countRoll` against the engine's own roll
 *    persisted on the use's bind credit (never a caller-supplied number). A
 *    grant with neither would admit any number of linked actors, so it stays
 *    pending;
 *  - NO grant prints an UNTYPED `onEntityDeath` item consequence. No runtime
 *    applies a curated note, so a green clause would hide it (PR #673 review,
 *    P2-2). A source-grounded consequence is either typed AND executed (the
 *    Ring of Djinni Summoning's `becomes: 'nonmagical'` transition, run by
 *    item_state_event; the Staff of the Python's `destroysItemOn`, run at the
 *    grant ending -- eshyra-olc5.15), or its grant is kept pending here with the
 *    verbatim span in an adjudicated clause. The set is empty today; the guard
 *    stays as the fail-closed mechanism for any future `onEntityDeath` note.
 */
export function creatureGrantLifecycleOwned(
  entityGrant: unknown,
  mechanics?: Obj,
): boolean {
  if (mechanics?.containment !== undefined) return false;
  const block = asObject(entityGrant);
  if (block === undefined) return false;
  if (
    block.runtimeOwner !== 'encounter-combatant' &&
    block.runtimeOwner !== 'persistent-actor'
  )
    return false;
  const grants = Array.isArray(block.grants) ? block.grants : [];
  if (grants.length === 0) return false;
  return grants.every((raw) => {
    const grant = asObject(raw);
    if (grant === undefined || grant.kind !== 'creature') return false;
    // The binder can verify the creature only when the grant names exactly one
    // (PR #690 review) or its table row is selected by an ENGINE roll bound to
    // the use (`creatureRoll`, eshyra-olc5.16: Bag of Tricks binds the bag's
    // color as the variant and the d8 per use on the bag's own table). A grant
    // whose creature is selected per instance or per use from a table WITHOUT
    // that binding (the Elemental Gem: the gem's type) admits any listed
    // creature, so it stays pending until that selection is bound
    // (eshyra-xt6m.1).
    const creatureRefs = Array.isArray(grant.creatureRefs)
      ? grant.creatureRefs
      : [];
    const rolledRows =
      typeof grant.creatureRoll === 'string'
        ? /^1d(\d+)$/.exec(grant.creatureRoll)
        : null;
    const oneCreature =
      rolledRows !== null
        ? grant.statBlockRef === undefined &&
          creatureRefs.length === Number(rolledRows[1])
        : typeof grant.statBlockRef === 'string'
          ? creatureRefs.length === 0
          : creatureRefs.length === 1;
    if (!oneCreature) return false;
    if (typeof grant.count !== 'number' && typeof grant.countRoll !== 'string')
      return false;
    if (grant.onEntityDeath !== undefined) return false;
    const revertOn = Array.isArray(grant.revertOn) ? grant.revertOn : [];
    return (
      revertOn.length > 0 &&
      revertOn.every(
        (value) =>
          typeof value === 'string' && ENGINE_COMPUTED_GRANT_ENDINGS.has(value),
      )
    );
  });
}
