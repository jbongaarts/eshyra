# Thaw Note — Modeling-usability audit-bundle reports (eshyra-o9bd.13)

**Date:** 2026-06-29
**Bead:** eshyra-o9bd.13
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)

## Reason for thaw

Closes thaw scope #7 for the re-audit evidence bundle. The existing audit bundle
reported source coverage, record counts, source-region accounting, and
structure/coverage findings, but did not expose the new complete-accurate-
playable evidence that reviewers need before re-freeze:

- typed advancement coverage per SRD class and level;
- structured class-feature choice coverage;
- reviewed table owner-link / reachability coverage;
- parity between the old source-backed character-creation overlays and the
  generated pack facts now absorbed into records;
- full playable-model audit findings.

This PR changes only the audit-bundle generator so future bundles include those
reports under `reports/` and summarize them in bundle metadata. It does not
change importer behavior, extractor/parser behavior, generated rules-pack
records, source ledgers, or source/audit expectations.

## Importer-fix-protocol scope

This is deterministic SRD audit evidence work under the importer-fix protocol,
but it is not an importer bug fix and has no generated-record churn to explain.
The failure class is evidence incompleteness: the final audit bundle lacked
machine-readable reports proving the playable-model gates that prior o9bd beads
made green.

Coverage is additive. No regression test, audit expectation, or source oracle is
weakened or replaced. The new reports are projections over the committed pack
and existing audit APIs:

- `auditSrdPlayability` / `countSrdPlayabilityByCategory`;
- `SRD_5_1_TABLE_OWNERS` / `SRD_5_1_STANDALONE_TABLES`;
- source-backed overlay helpers used as parity oracles.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [ ] `packages/core/scripts/importers/dnd5e-srd-5.1/`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note only.
- [x] Other: `packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts`.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

No. No generated record, pack manifest, source inventory, source coverage, or
source-region ledger file changes in this PR.

## Importer changed?

No. No importer, extractor, parser, or generated-pack emission behavior changed.

## Generated diff review

Not applicable: there is no generated rules-pack diff. The audit-bundle smoke
run produced the new reports from the committed pack with these clean summaries:

- typed advancement rows: 240/240, 0 missing typed rows, 0 unknown advancement
  entries;
- choice coverage: 42 feature records with `choices[]`, 60 structured choice
  entries, 0 findings;
- table link/reachability: 108 table records, 71/71 reviewed owned tables
  linked, 1/1 standalone table present, 0 findings;
- overlay-vs-pack parity: 55/55 checked facts matched, 0 missing, 0 mismatched;
- playable-model audit: 0 findings.

## Commands run

```
npm run verify:worktree
npm run audit-bundle:dnd5e-srd -- /tmp/eshyra-o9bd13-audit-bundle-2 /tmp/eshyra-o9bd13-audit-bundle-copy.zip
npm run verify:dnd5e-srd-freeze -- --base origin/main
```

`verify:worktree` and the audit-bundle smoke passed before this thaw note was
added. `verify:dnd5e-srd-freeze` is the CI failure being addressed by this note
and must pass after the note is committed.

## Freeze manifest updated?

No. The only protected-path code change is the audit-bundle generator, which is
not hash-pinned in `freeze-manifest.json`. No hash-pinned evidence file or
generated pack artifact changed, so there is no hash update.

- [ ] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated

## Audit bundle path

Smoke-generated locally at:

- `/tmp/eshyra-o9bd13-audit-bundle-2`
- `/tmp/eshyra-o9bd13-audit-bundle-copy.zip`

Full official audit-bundle regeneration remains part of eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm that the PR changes only the audit-bundle generator and this thaw note;
no generated records or source artifacts changed. Confirm the new reports are
additive evidence projections over existing gates/oracles and that the freeze
guard passes because the protected-path change is intentionally documented in
this PR.
