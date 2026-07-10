# Thaw Note — C1 `changeShape` projection

## Reason for thaw

Implement slice C1 of `eshyra-o9bd.18.7.9`: project the reviewed deterministic
shape-change mechanics for 22 SRD creature entries. The frozen records gain a
typed, schema-validated `changeShape` effect rather than leaving action cost,
form constraints, retained/replaced statistics, equipment handling, and
death reversion in prose only.

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/mechanicsProjections.ts`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json`
- [x] Audit classification/design evidence and focused regression tests

## Source PDF changed?

No. The pinned SRD 5.1 PDF remains unchanged.

## Pack records changed?

Yes. Exactly 22 existing creature records changed; no records were added or
removed. Each changed entry is a reviewed C1 `Change Shape`/`Shapechanger`
entry and receives one `changeShape` effect.

## Importer changed?

Yes. A fail-closed C1 grammar recognizes only the complete reviewed source
forms. Any source drift removes the projection, which returns the entry to the
per-ref readiness membership gate.

## Commands run

```text
npm test -- --run packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts packages/core/test/kindSchemasEffects.test.ts
# 106 passed

npm test -- --run packages/core/test/srdMembershipCorrections.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
# 47 passed

npm run verify:dnd5e-srd-pack
# committed pack matches importer output exactly

npm run verify:dnd5e-srd-freeze
# all 13 hashes match

npm run check
npm run typecheck
# passed

npm test
# 3669 passed, 19 documented skips
```

`npm run audit-bundle:dnd5e-srd` completed with clean pack/source/audit
findings and produced the archive below. Its nested full-test command reported
13 unrelated 5–10-second timeout failures under concurrent audit-bundle load;
the immediately preceding isolated `npm test` run passed in full. No global
Vitest timeout or parallelism setting was changed.

## Freeze manifest updated?

Yes. `records.json` is pinned to
`9f6dd38a2fb2a3aec13f7c1b87ee34f66c82b9019371ac426074c309e2dea37b`.

## Audit bundle path

`.audit-bundles/dnd5e-srd-audit-bundle.zip`

## Reviewer sign-off notes

The committed-pack tests pin the five reviewed golden forms and assert that all
22 C1 entries carry `changeShape`; the generated diff contains only those 22
existing creature records.
