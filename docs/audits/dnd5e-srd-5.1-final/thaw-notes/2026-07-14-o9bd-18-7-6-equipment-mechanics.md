# Thaw Note — deterministic equipment mechanics

## Reason for thaw

Bead `eshyra-o9bd.18.7.6` closes the ordinary-equipment pack-side execution
boundary. It adds closed weapon-property projections and source-bound use
profiles without adding a parallel runtime engine.

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/`
- [x] `docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}`
- [ ] source PDF, manifest, source inventory, source coverage, or region ledger

## Source and record impact

The source PDF is unchanged (SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`).
The pack remains 1,813 records, including exactly 218 equipment records.
No records were added or removed. Exactly 70 equipment records change: all 37
weapons gain closed `weaponProperties`; 35 reviewed records gain `useProfile`
(lance and net are in both sets). No non-equipment, spell, or magic-item record
changes.

The committed inventory covers all 218 records through an explicit reviewed
registry: 174 mechanically active, 44 nonmechanical, 35 curated projection
records, and 75 source-bound clauses. The registry records 82 already-complete,
4 model-adjudicated, and 53 externally owned records and fails closed on an
unknown, removed, or unreviewed key. New
contracts are the closed weapon-property union, equipment-use clauses, and the
five-way consumption union (reusable, inventory unit, ammunition, finite uses,
and source-defined). Every curated record pins its record key, exact pages,
stable clause IDs, and exact source phrases; drift fails compilation.

## Runtime ownership

Inventory-unit consumption continues to use `remove_item`. The healer's kit's
non-recharging ten-use capacity binds to the existing item-owned F5 usage
counter. F2/F3/F9 retain action, condition/effect, roll, damage, and arithmetic
ownership. No interpreter, inventory table, counter table, or automatic item
execution was added.

## Commands

The PR verification record includes `npm run check`, `npm run typecheck`,
`npm test`, `npm run verify:worktree`, `npm run verify:dnd5e-srd-pack`,
`npm run verify:dnd5e-srd-freeze -- --base origin/main`,
`npm run audit-bundle:dnd5e-srd`, and both inventory `--check` commands.

## Freeze manifest

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated for the
  regenerated `records.json` hash.

## Audit bundle

Generated locally at `.audit-bundles/dnd5e-srd-audit-bundle.zip`.
