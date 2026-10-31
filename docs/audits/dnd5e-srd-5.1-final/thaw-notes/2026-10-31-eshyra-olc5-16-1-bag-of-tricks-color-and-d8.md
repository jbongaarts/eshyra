# Thaw note: Bag of Tricks color variants and the engine-rolled d8 creature

Bead: `eshyra-olc5.16.1` (owning spec `eshyra-olc5.16`)

## Reason for thaw

The PR #690 review held the Bag of Tricks' readiness: "it transforms into a
creature you determine by rolling a d8 and consulting the table that
corresponds to the bag's color" selected the creature from a table the binder
could not verify (any row of any of the three color tables was admitted; the
color was not on the instance and the d8 was not bound to the use). This
follows the Horn of Valhalla pattern (`eshyra-olc5.14`):

1. **Color as a variant.** The bag's cloth color (gray, rust, tan) is a
   persistent per-instance property, so it is the item's magic-item variant
   (`variants` Gray, Rust, Tan, rarity Uncommon). Extraction aborts when the
   description no longer prints "made from gray, rust, or tan cloth" or the d8
   sentence, and `assertBagOfTricksTablesMatch` (called from the emit under
   `compileExecutableSemantics`) aborts when any of the three emitted tables'
   columns (`d8`, `Creature`) or rows differ from the pinned constant.
2. **One grant per color.** `bag-creature` is replaced by `gray-`, `rust-` and
   `tan-bag-creature`: `variants: [color]`, that color's `tableRefs`, the eight
   `creatureRefs` in d8 row order, the new `creatureRoll: '1d8'`, `count: 1`.
3. **`creatureRoll`** (new grant field): a `1dN` the ENGINE rolls once per use;
   valid only on a creature grant with exactly N `creatureRefs`, no
   `statBlockRef`, a numeric `count` of 1, and exclusive with `countRoll`. Row
   k selects `creatureRefs[k-1]`.
4. **Runtime.** Migration `0051` adds `rolled_creatures_json` to
   `item_grant_bind_credit`. `use_item` rolls the d8 with the seeded RNG
   (refusing without it), persists `{grantId, notation, roll, creatureRef}` on
   the use's credit and returns it as `rolledCreatures`. `start_effect` requires
   `source.bindCreditId`, reads the stored roll (absent/malformed means refused)
   and admits only linked actors whose creature is that row's creature (by ref
   or printed name); another row of the same table, another color's creature
   and another instance's credit are refused.
5. **Ownership.** `creatureGrantLifecycleOwned` additionally treats a grant as
   naming one creature when it carries `creatureRoll` `1dN` with exactly N
   `creatureRefs` and no `statBlockRef`. The Elemental Gem stays pending
   (eshyra-xt6m.1).

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` (`parseMagicItems.ts`,
  `emit.ts`, `magicItemEntityGrants.ts`, `magicItemGrantOwnership.ts`,
  `magicItemTriage.ts`)
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [x] `packages/core/data/migrations/0051_item_grant_bind_credit_rolled_creatures.sql`
  and `packages/core/data/schema.snapshot.sql`
- [x] `docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}`

## Generated change

Only `records.json` changes; no record is added or removed. Bag of Tricks gains
the `variants` block and three variant-restricted grants. In its
executionReadiness clauses, `m4-bag-of-tricks` moves engine-pending to green
(its F3, F2 and F5 hooks leave the clause) and the item gains one hook-free
adjudicated `m4-control-bag-of-tricks` clause carrying the verbatim
bonus-action command sentences. Counts: engine-pending 763 to 762, green 254 to
255, adjudicated-by-design 366 to 367, design-blocked 1 (unchanged), total 1384
to 1385.

Newly ready operation (1): Bag of Tricks `pull-fuzzy-object`. (Eleven
operations were ready after PR #690; twelve now.)

The numeric-conservation gate gains one reviewed exception: the printed
"rolling a d8" is the typed `1d8` of `creatureRoll`.

Updated `records.json` SHA-256:

`db4e33288f32a82c9da15bfcd4b945a71b7f54743f74019756f3a6ee3188348d`

## Evidence

`itemGrantBagOfTricks.test.ts` (unmodified pack, no readiness waiver),
`bagOfTricksVariants.test.ts` (table pins and drift aborts),
`magicItemMechanicsSchema.test.ts` (`creatureRoll` validator refusals),
`magicItemGrantOwnership.test.ts` (owned set and counterfactuals),
`itemGrantRealPackReadiness.test.ts` (the dawn ending and combat-closure
durability driven through the real use).
