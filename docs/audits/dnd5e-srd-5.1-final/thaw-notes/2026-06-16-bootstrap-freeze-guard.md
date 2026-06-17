# Thaw Note — Bootstrap freeze guard infrastructure (eshyra-ixcd)

**Date:** 2026-06-16
**PR:** eshyra-ixcd / #234

## Reason for thaw

This is the initial commit that *adds* the freeze guard itself. No audited SRD
artifact was modified. The thaw-note policy check fires because the PR touches
protected paths to install the guard infrastructure:

- `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` — new file (the manifest)
- `docs/audits/dnd5e-srd-5.1-final/README.md` — added "Freeze protection" section
- `docs/audits/dnd5e-srd-5.1-final/thaw-notes/TEMPLATE.md` — new file (template)
- `packages/core/scripts/verify-dnd5e-srd-freeze/` — new script directory
- `.github/workflows/srd-freeze-guard.yml` — new CI workflow
- `package.json` — added `verify:dnd5e-srd-freeze` script entry

This thaw note satisfies the policy check for this bootstrap PR only. All
subsequent PRs that change audited SRD artifact content must supply their own
thaw note describing the actual change.

## Expected file changes

All changes in this PR are additive infrastructure. No previously-committed
frozen artifact was modified:

- [x] `docs/audits/dnd5e-srd-5.1-final/` — README.md updated, freeze-manifest.json and thaw-notes/TEMPLATE.md added
- [x] `packages/core/scripts/verify-dnd5e-srd-freeze/` — new script added
- [x] `.github/workflows/srd-freeze-guard.yml` — new workflow added

## Source PDF changed?

No.

## Pack records changed?

No. `records.json`, `manifest.json`, `source-coverage.json`,
`source-inventory.json`, and `source-region-ledger.json` are unchanged.

## Importer changed?

No.

## Commands run

```
npm run verify:dnd5e-srd-freeze   # exit 0 — all 13 hashes match
npm run check                     # exit 0 — no warnings
npm run typecheck                 # exit 0
npm test                          # 1804 passed / 19 skipped
```

## Freeze manifest updated?

- [x] `freeze-manifest.json` reflects the README.md hash after the
  "Freeze protection" section was added. All other hashes are the
  audited-commit values from `provenance.md`.

## Reviewer sign-off notes

Verify that `npm run verify:dnd5e-srd-freeze` exits 0 after merging. The
freeze guard will then enforce hash integrity on all future PRs that touch
these paths without requiring further bootstrap thaw notes.
