# Thaw Note - Hazard Category and Gameplay Readiness

## Reason for thaw

Normalize sample traps to carry `data.category: "trap"` alongside `trapType`,
clean the rogue fixed starting-equipment `sourceText`, and add a stable
gameplay-readiness audit-bundle report.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/`
- [x] Other: `packages/core/scripts/verify-dnd5e-srd-pack/cli.ts`,
  `packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts`,
  `packages/core/src/rules/kindSchemas.ts`, and regression tests.

## Source PDF changed?

No.

## Pack records changed?

Yes. Eight `hazard` trap records gained `data.category: "trap"`, and the
Rogue class fixed starting-equipment entry now uses the cleaned source text for
its fixed leather armor / daggers / thieves' tools grant. No records were added
or removed.

## Importer changed?

Yes. Trap emission now writes the canonical hazard-category discriminator, the
Rogue creation fact no longer preserves the stray `(a)` marker on a fixed
grant, and importer/verifier summaries now print final record-kind counts.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
```

Further verification will be recorded in the PR summary.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated

## Audit bundle path

Not regenerated yet.

## Reviewer sign-off notes

Verify that hazard filtering by `data.category` returns 8 traps, 3 diseases,
and 14 poisons, and that `verify:dnd5e-srd-pack` no longer prints a stale
`0 hazards, 8 traps` summary as final record counts.
