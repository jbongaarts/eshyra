# Thaw note: Elemental Gem type variants and exact castSpell readiness

Bead: `eshyra-xt6m.1.1` (owning spec `eshyra-xt6m.1`)

## Reason for thaw

The Elemental Gem's previous single grant named four creatures without binding
the printed gem type to an inventory instance. Its `break-gem` operation also
had no exact readiness clause for the `summon-elemental` castSpell effect. The
2026-10-18 user decision keeps deterministic item use, quantity consumption,
receipts and creature lifecycle in the engine; the DM adjudicates remaining
spell semantics. No deterministic spell executor is selected.

## Change

`parseMagicItems.ts` now extracts Blue Sapphire, Yellow Diamond, Red Corundum,
and Emerald as Uncommon variants with their printed elemental mapping. It
fails closed if the description loses the type-selection sentence or if the
`table:elemental-gem` columns or pinned rows drift. `magicItemEntityGrants.ts`
emits one variant-restricted, single-creature grant per type, with the printed
one-hour duration, 0-HP and one-hour endings, quantity economy and
`as spell:conjure-elemental` control.

The quantity clause no longer claims spell execution or entity ownership:
`use_item` owns the single-use quantity spend, while the M4 clause owns the
summoned creature lifecycle. The new exact `m1-effect-summon-elemental` clause
is ready only when the effect is a concentration-required `castSpell`, every
operation listing it spends an economy, the scoped grant lifecycle is owned,
and every creature grant tied to those economies has matching spell control
and duration. This owns creature identity, concentration, the one-hour timer
and 0-HP ending only. It does not execute conjure elemental. Counterfactuals
keep effects pending when the grant is absent, duration differs, or the
spellRef/control differs. No hook was added to
`LANDED_MAGIC_ITEM_ENGINE_HOOKS`.

`give_item` now requires the gem type as `variantId`, with one type per stack.
`use_item` explains that an item printed to cast or summon “as if you had cast”
a spell uses the item's printed activation, preserving the Gem's action cost.
The existing verbatim adjudicated source clause remains. Feather Token semantics
are unchanged: `use-token` remains refused with its hooks named, the bird grant
remains pending on DM-ended endings, and its payloads remain DM-adjudicated.

## Generated change

Only `magic-item:elemental-gem` changes in `records.json`; no records are added
or removed. It gains four variants and four matching grants in place of the
former `gem-elemental` grant. Its quantity and M4 lifecycle clauses move from
engine-pending to green; the exact castSpell clause is added green; its
source-grounded control clause returns as adjudicated-by-design. Counts:
engine-pending 762 to 760, green 255 to 258, adjudicated-by-design 367 to 368,
design-blocked 1 unchanged, total clauses 1385 to 1387.

Newly ready operation: Elemental Gem `break-gem` for Blue Sapphire, Yellow
Diamond, Red Corundum and Emerald (one operation across four variants).

## Expected file changes

- [x] Importer/compiler ownership and source-mapping tests under
  `packages/core/scripts/importers/dnd5e-srd-5.1/` and
  `packages/core/test/importers/dnd5e-srd-5.1/`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [x] `docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}`
- [x] `packages/core/src/orchestrator/toolGiveItem.ts`
- [x] `packages/core/src/orchestrator/toolUseItem.ts`
- [x] Real-pack readiness and generated count pins

## Evidence

`elementalGemVariants.test.ts` pins the variants, grants, table rows and drift
failure. `magicItemGrantOwnership.test.ts` covers the owner predicate and
counterfactual mismatches. `itemGrantRealPackReadiness.test.ts` exercises the
unmodified bundled pack without a readiness waiver: emerald use consumes a
typed receipt, binds only the water elemental with concentration, and refuses
wrong creature, wrong variant, absent concentration, repeated redemption and a
bind without a receipt. Feather Token's unchanged disposition is recorded
above.

## Verification

- `npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` — passed; regenerated the canonical output from the vendored SRD.
- `npm run verify:dnd5e-srd-pack` — passed; 0 records added, removed or changed by the independent regeneration comparison.
- `npm run verify:worktree` — passed. Formatting, hidden-Unicode, lint and typecheck gates passed; Vitest reported 7,152 passed, 3 skipped across 383 files (2 skipped files). The skips are the documented live-API tests.

Negative proofs cover the absent matching grant, mismatched grant duration,
mismatched spell control / spellRef, and a castSpell effect whose operation
does not spend an economy. Table drift aborts the compiler assertion. The
unmodified-pack test exercises emerald's typed receipt and successful water
elemental bind, then refuses a fire elemental, the wrong grant variant, no
concentration owner, a second redemption, and a bind without a receipt.
