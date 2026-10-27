# Thaw note: dawn per-day economy readiness and the Bag of Tricks next-dawn ending

Bead: `eshyra-7gkh.1` (owning spec `eshyra-7gkh`)

## Reason for thaw

Three separately owned responsibilities, none a new engine.

1. **Execution (finding, no new binding).** The hard-limit per-day dawn economy
   `{kind: 'per-day', perDay: {uses: N}, reset: [{at: 'dawn', amount: 'all'}]}`
   is executed end to end: `useItem` spends and refuses at 0
   (`insufficient uses`; the economy cost has no soft-limit marker), and
   `resolveDueItemClockEvents` restores the uses at the dawn boundary
   (`validateResetShape` accepts dawn/all; `crossedBoundaryEvents` emits dawn at
   minute 360). Real-pack proof: `itemPerDayDawnEconomy.test.ts`.
2. **Readiness.** `F5: per-period usage reset` is carried by `c1-uses` of 20
   items (19 with 1 use per day, Bag of Tricks with 3; Crystal Ball of Telepathy
   at variant scope), all with the identical economy shape and a hard-limit
   cost, so the hook is landed globally in `LANDED_MAGIC_ITEM_ENGINE_HOOKS`.
   Pipes of the Sewers' `F5 magic-item-usage-recharge` is a different contract
   (a dice-valued partial regain, `1d3` charges, with a variable cost) on a hook
   shared by 207 clauses of 53 items; it stays pending (residual).
3. **Grant termination.** Bag of Tricks: "The creature vanishes at the next dawn
   or when it is reduced to 0 hit points." `next-dawn` is now engine-computed:
   `start_effect` fills (or checks) a minute timer from the bind clock to the
   first dawn boundary strictly after it, using the same boundary helper as the
   reset executor (`state/worldClockBoundaries.ts`), and the existing
   world-time expiry ends the grant. No override is accepted. The 0-hit-point
   ending is unchanged. Pipes of the Sewers (no printed ending) and the owner
   command endings stay DM-ended.

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` (hook landed;
  `next-dawn` in `ENGINE_COMPUTED_GRANT_ENDINGS`; Bag control span)
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`

## Generated change

Only `records.json` changes; no record is added or removed. In the magic-item
executionReadiness clauses: the 20 `c1-uses` clauses move engine-pending to
green; Bag of Tricks `m4-bag-of-tricks` moves engine-pending to green (its F3,
F2 and F5 hooks leave the clause) and gains one hook-free adjudicated
`m4-control-bag-of-tricks` clause carrying the verbatim bonus-action command
sentences. Counts: engine-pending 782 to 761, green 235 to 256,
adjudicated-by-design 367 to 368, total 1385 to 1386.

Newly ready operations (12): Bag of Tricks `pull-fuzzy-object`; the four vessels
`summon-water/fire/air/earth-elemental`; Cape of the Mountebank
`cast-dimension-door`; Circlet of Blasting `cast-scorching-ray`; Crystal Ball
(Telepathy variant) `cast-suggestion`; Dragon Scale Mail
`sense-nearest-dragon`; Iron Bands of Binding `throw-bands`; Plate Armor of
Etherealness `gain-etherealness`; Rod of Rulership `command-obedience`.

Updated `records.json` SHA-256:

`19bb62635233507dd887a447235b904173073ef7f2e2d4f16577a27927ed7d44`

## PR #690 review repair (2026-10-26)

### P2: creature ownership through combat closure (runtime only, no pack change)
- **Before:** `validateItemGrantBinding` required a durable campaign actor only for `runtimeOwner: persistent-actor`. An `encounter-combatant` summon with a lifetime longer than rounds could be bound to an instance-only combatant. Combat closure then released that creature while the effect stayed active, so its printed ending could no longer remove it. This affected the Bag of Tricks, the four elemental vessels and the Horn of Valhalla.
- **Now:** durability follows the grant's lifetime. Any creature grant except a round-scale one needs a durable identity. Combat closure is not a printed ending, so the creature persists until its actual ending removes it.
- **Evidence:** `itemGrantRealPackReadiness.test.ts`, run for the Bag (next dawn) and the Bowl (one hour, character-owned concentration). An instance-only bind is refused. A durable creature survives closure with an active link and is removed (`absent`) at its deadline. Negative-proofed against the old rule.

### Creature identity (pack change)
- **Before:** the binder admits any creature named by the grant's tables or refs. For the Bag of Tricks, that is any row of any of the three color tables: the bag's color is not bound to the instance, and the d8 roll is not bound to the use. For the Elemental Gem, it is any of the four elementals, whatever the gem's type.
- **Now:** `creatureGrantLifecycleOwned` additionally requires that every grant names exactly ONE creature. The user decided, on 2026-10-26, to hold Bag readiness rather than leave the selection unbound.
- **Effect:** Bag of Tricks and Elemental Gem return to engine-pending and lose their control clauses. Bag `pull-fuzzy-object` is not ready. Its dawn economy and engine-computed next-dawn ending remain, and are tested at binder level with a directly issued credit, without a readiness waiver.
- **Counts:** engine-pending 761 → 763, green 256 → 254, adjudicated 368 → 366, total 1386 → 1384. Eleven operations become ready in this PR, not twelve.
- **Follow-up:** binding the bag color and an engine-rolled d8 is filed as a pre-freeze bead. The Elemental Gem's type is folded into eshyra-xt6m.1.
