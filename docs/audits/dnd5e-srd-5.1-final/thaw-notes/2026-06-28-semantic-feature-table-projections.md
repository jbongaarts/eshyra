# Thaw Note — Semantic feature and ancestry table projections

**Date:** 2026-06-28
**Bead:** eshyra-o9bd.7
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)

## Reason for thaw

The frozen SRD pack emits table records with source-complete `columns` and
`rows`, but some gameplay-critical tables are still generic scalar cells. This
first eshyra-o9bd.7 slice adds validated semantic projections for the small set
of already-linked feature/ancestry tables:

- `table:destroy-undead` — Cleric level to maximum destroyed-undead challenge
  rating.
- `table:beast-shapes` — Druid level to Wild Shape challenge-rating limits,
  limitations, and examples.
- `table:draconic-ancestry` — Dragonborn dragon type to damage type, breath
  weapon shape, and save ability.

The original source-preserving `columns` and `rows` remain unchanged.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — adds deterministic
      semantic table projection enrichment for the first feature/ancestry slice.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed freeze
      manifest hashes.
- [x] Other: `packages/core/src/rules/kindSchemas.ts` and tests validate the new
      optional table projection union.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. Regenerated through the importer (not hand-edited). Record count is
unchanged at 1812; only 3 existing table records change:

- `table:beast-shapes`
- `table:destroy-undead`
- `table:draconic-ancestry`

No records are added or removed. `manifest.json`, `source-coverage.json`, and
`source-region-ledger.json` are unchanged.

## Importer changed?

Yes. The importer now adds optional `data.projection` objects to reviewed table
extractions where the source table has a stable gameplay interpretation for
this first slice. The projection is fail-closed through rules-pack validation;
unsupported projection kinds or malformed rows reject the pack.

The original eshyra-o9bd.7 scope is intentionally split. Deferred child beads:

- `eshyra-o9bd.7.1` — price/service/lodging/trade-goods tables.
- `eshyra-o9bd.7.2` — language and equipment selection tables.
- `eshyra-o9bd.7.3` — subclass spell tables.
- `eshyra-o9bd.7.4` — object AC/HP damage-adjudication tables.

## Commands run

```
npm run import:dnd5e-srd -- --pdf packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/
npm run test -- packages/core/test/rulesPack.test.ts packages/core/test/srdGeneratedPack.test.ts
npm run verify:dnd5e-srd-pack
npm run verify:worktree
npm run verify:dnd5e-srd-freeze -- --base origin/main
```

All listed commands exited 0 after updating the reviewed partial-field baseline
for `table.data.projection`.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated

## Audit bundle path

Not regenerated. This child bead adds targeted table projection metadata and
schema/test coverage only; full audit bundle regeneration remains
eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm the generated diff is limited to the 3 expected existing table records,
that source-preserving `columns`/`rows` remain unchanged, and that the Sorcerer
Draconic Bloodline same-caption table is not projected as a Dragonborn breath
weapon table.
