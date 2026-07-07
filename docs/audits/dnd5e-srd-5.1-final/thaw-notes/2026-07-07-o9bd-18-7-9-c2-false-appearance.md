# Thaw Note — D&D SRD 5.1 Artifact

## Reason for thaw

Implement eshyra-o9bd.18.7.9 slice C2 by projecting the deterministic
False Appearance creature-entry grammar into typed mechanics.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/`
- [x] Other: audit-bundle disposition registry and focused tests

## Source PDF changed?

No.

## Pack records changed?

Yes. Sixteen creature records now carry `falseAppearance` mechanics on their
False Appearance entries. No records were added or removed.

## Importer changed?

Yes. The creature-entry mechanics projection now recognizes the SRD sentence
shape "While the X remains ..., it is indistinguishable from ...".

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npx vitest run packages/core/test/kindSchemasEffects.test.ts packages/core/test/srdMembershipCorrections.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze
```

The first three commands passed. The initial freeze check reported expected
hash mismatches for `records.json` and `source-region-ledger.json`; the
manifest was updated afterward.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated

## Audit bundle path

Not regenerated.

## Reviewer sign-off notes

Verify that the generated diff is limited to the 16 C2 False Appearance
mechanics projections and that the C2 refs graduated out of
`CREATURE_ENTRY_REVIEWED_DISPOSITIONS`.
