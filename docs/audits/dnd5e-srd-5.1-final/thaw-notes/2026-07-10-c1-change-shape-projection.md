# Thaw Note — C1 `changeShape` projection

## Reason for thaw

Implement slice C1 of `eshyra-o9bd.18.7.9`: project the reviewed deterministic
shape-change mechanics for 22 SRD creature entries. The frozen records gain a
typed, schema-validated `changeShape` effect rather than leaving action cost,
form constraints, retained/replaced statistics, equipment handling, and
death reversion in prose only. Review repair tightened the five lycanthrope
grammars to exact fail-closed source matches, added explicit statline selectors
and concrete sizes, and changed Couatl Bite retention to an attack predicate.

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
# focused projection/schema tests passed

npm test -- --run packages/core/test/srdMembershipCorrections.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
# focused committed-pack/audit tests passed

npm run verify:dnd5e-srd-pack
# committed pack matches importer output exactly

npm run verify:dnd5e-srd-freeze
# all 13 hashes match

npm run check
npm run typecheck
# passed

npm test
# 3670 passed, 19 documented skips
```

`npm run audit-bundle:dnd5e-srd` completed with clean pack/source/audit
findings and produced the archive below. Its nested full-test command also
completed successfully. No global Vitest timeout or parallelism setting was
changed.

## Freeze manifest updated?

Yes. `records.json` is pinned to
`87101422301c516813a8df376f3ff228a33a741fe1e4b2a61dcd3f16bfe6e44d`.

## Review repair verification

The committed-pack regression walks all five lycanthrope effects and resolves
each `armor-class-variant` or `speed-variant` selector by exact condition
equality, requiring exactly one sibling match. Size-changing forms carry
explicit `small`, `medium`, or `large` values. The regenerated diff remains
exactly the same 22 existing C1 creature records, with no additions or
removals.

## Audit bundle path

`.audit-bundles/dnd5e-srd-audit-bundle.zip`

## Reviewer sign-off notes

The committed-pack tests pin the five reviewed golden forms and assert that all
22 C1 entries carry `changeShape`; the generated diff contains only those 22
existing creature records.
