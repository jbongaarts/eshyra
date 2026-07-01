# Thaw Note — D&D SRD 5.1 Artifact

## Reason for thaw

ADR 0016 (`docs/adr/0016-native-dependency-install-policy-by-environment.md`,
bead `eshyra-le7p`) flips the repo's native-dependency install policy from
prebuilt-first to source-build-first via a new root `.npmrc`
(`build-from-source=true`). Every workflow that previously set an explicit
`npm_config_build_from_source: "false"` job env var — including
`.github/workflows/srd-freeze-guard.yml` — had that now-redundant env block
removed so the policy comes from one place instead of drifting per workflow.

That workflow file is a protected exact path
(`FROZEN_EXACT_PATHS` in `packages/core/scripts/verify-dnd5e-srd-freeze/freeze.ts`)
because it is the freeze guard's own definition and must not change silently.
Removing an unrelated CI env var trips the changed-path check; this note is
the documented escape hatch acknowledging the change is intentional and
benign.

No SRD source, importer, or generated rules-pack content is touched — only
the removed `env:`/`npm_config_build_from_source` block. The workflow's
actual freeze-verification logic (hash check invocation) is unchanged. The
freeze hash check (13 files) is unaffected and continues to pass.

## Expected file changes

- [x] Other: `.github/workflows/srd-freeze-guard.yml` — removed the
  `env: npm_config_build_from_source: "false"` block (now governed by the
  root `.npmrc` instead).

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

Verify the only diff to the protected path is the removal of the
`npm_config_build_from_source` env block and that no SRD content/manifest
files changed.
