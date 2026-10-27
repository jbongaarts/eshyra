# Thaw note: source-backed creature count bound at the use_item to start_effect boundary

Bead: `eshyra-olc5.14.1` (owning spec `eshyra-olc5.14`; follows `eshyra-c58j`)

`creatureGrantLifecycleOwned` required a fixed numeric `count` because the
binder enforced only that. Two printed multiplicities were therefore left
engine-pending (PR #673 review, P2-1). This change enforces both at the real
`use_item` to `start_effect` boundary.

- **Elemental vessels** (Bowl, Brazier, Censer, Stone): each prints the
  summoning of ONE elemental ("summon a water elemental, as if you had cast the
  conjure elemental spell"). The curated spec now types `count: 1`; the binder
  already enforces a fixed count. The source phrase is checked at projection.
- **Horn of Valhalla**: the horn's type fixes the count (`table:horn-of-valhalla`:
  Silver 2d4 + 2, Brass 3d4 + 3, Bronze 4d4 + 4, Iron 5d4 + 5) and the
  requirement, and "the GM chooses the horn's type or determines it randomly".
  The type is a persistent per-instance property, so the record gains four
  source-backed **variants** (Silver, Brass, Bronze, Iron; rarity from the
  printed line "rare (silver or brass), very rare (bronze), or legendary
  (iron)"), pinned in `parseMagicItems.ts` (`HORN_OF_VALHALLA_TYPES`). Each
  variant text carries its row's count dice and requirement verbatim. The
  importer aborts if the rarity line, the description, or the table rows differ
  (`assertHornOfValhallaTypesMatchTable`). The single grant becomes four
  variant-restricted grants (`silver-berserkers` ...), each with a new typed
  `countRoll` (`2d4+2` ...), mutually exclusive with `count`.
- **Engine commitment**: `use_item` rolls the instance variant's `countRoll`
  with the seeded RNG in the same transaction that issues the bind credit,
  persists it on the credit (`item_grant_bind_credit.rolled_counts_json`,
  migration 0050: nullable column) and returns it in `hint.bindCredits[].rolledCounts`.
  `start_effect` refuses a bind whose linked-actor count differs from the
  stored total, and one whose credit holds no engine roll of that grant (every
  credit issued before the migration, or a tampered value). Nothing is accepted
  from the caller.
- **Ownership**: a grant is admitted when it has a numeric `count` OR a
  `countRoll`. The vessels and the Horn become owned; their F3/F5 hooks leave
  the entityGrant clause and each gains a hook-free adjudicated
  `m4-control-<item>` clause (the Horn's span existed from c58j.1).

Generated change: Horn of Valhalla gains four `variants` and four variant-
restricted grants; the four vessel grants gain `count: 1`; five entityGrant
clauses move engine-pending to green; five adjudicated control clauses are
added. Counts: engine-pending 788 to 783, green 228 to 233, adjudicated-by-design
361 to 366, total 1378 to 1383. Newly ready operations: Horn of Valhalla
`blow-horn` (all four variants; 13 to 17 variant-keyed entries). The vessel
operations stay NOT ready: c1-uses `F5 per-period usage reset` (eshyra-7gkh).

Numeric conservation: the variant texts' dice and the parent grants' `countRoll`
sit at different scopes (the Figurine precedent: parent grants carry
`variants`), so eight reviewed exceptions with rationale were added to
`srdGeneratedPack.test.ts`; `hornOfValhallaVariants.test.ts` traces each
variant, rarity and `countRoll` to the table rows.

The semi-structured boundary inventory was regenerated (1859 to 1860 rows: the
new `countRoll` field).

Updated `records.json` SHA-256:

`461317c41d626b1a363eee3384a0715ab0160acc96fd62dd0df00a3051531315`
