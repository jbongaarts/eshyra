# Thaw Note — D&D SRD 5.1 Artifact

## Reason for thaw

Dependabot's `github-actions` group update (PR #279) bumps
`actions/checkout@v6` → `v7` inside `.github/workflows/srd-freeze-guard.yml`.
That workflow file is a protected exact path
(`FROZEN_EXACT_PATHS` in `packages/core/scripts/verify-dnd5e-srd-freeze/freeze.ts`)
because it is the freeze guard's own definition and must not change silently.
A routine CI action version bump trips the changed-path check; this note is the
documented escape hatch acknowledging the change is intentional and benign.

No SRD source, importer, or generated rules-pack content is touched — only the
`uses:` pin on the checkout action. The freeze hash check (13 files) is
unaffected and continues to pass.

## Expected file changes

- [x] Other: `.github/workflows/srd-freeze-guard.yml` — `actions/checkout` pin
  bumped from `v6` to `v7` by Dependabot.

## Source PDF changed?

No.

## Pack records changed?

No.

## Importer changed?

No.

## Commands run

```
npm run verify:dnd5e-srd-freeze
```

The changed-path check passes with this thaw note present; the hash check
(13 files, sha256) passes unchanged.

## Freeze manifest updated?

Not applicable — no hashed frozen artifact changed.

- [ ] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated

## Audit bundle path

Not regenerated — no content change.

## Reviewer sign-off notes

Verify the only diff to the protected path is the `actions/checkout` version
pin and that no SRD content/manifest files changed.
