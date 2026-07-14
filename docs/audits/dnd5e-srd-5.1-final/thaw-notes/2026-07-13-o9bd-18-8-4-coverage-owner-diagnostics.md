# Thaw Note — eshyra-o9bd.18.8.4 source-coverage owner diagnostics

## Reason for thaw

The source-coverage report reconstructed ambiguity after evaluation, invented
implicit winners for duplicate record names, and reduced repeated source
text to counts. This change adds first-class resolution provenance and
deterministic duplicate-text, record-collision, suspicious-owner, and
unresolved-owner diagnostics.

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/sourceInventoryCoverage.ts`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-coverage.json`
- [x] audit-bundle summary output and focused regression tests

## Source PDF changed?

No. The source hash is unchanged.

## Pack records changed?

No. `records.json`, record counts, spell-list groups, and memberships are
unchanged. Only the generated source-coverage diagnostic artifact changed.

## Importer changed?

Yes. Coverage entries now retain a closed typed resolution union. Diagnostics
are derived from that provenance and preserve exact source coordinates and
ownership candidates.

## Commands run

Focused importer tests, `npm run typecheck`, and `npm run verify:dnd5e-srd-pack`
were run during this change. Full repository gates are recorded in the PR.

## Freeze manifest updated?

- [x] `freeze-manifest.json` source-coverage hash updated
