# Thaw Note — Biome lint hygiene in the freeze verifier (eshyra-b69j adjacent)

**Date:** 2026-06-23
**PR:** chore/biome-strict-ci / #284

## Reason for thaw

This PR makes CI fail on any Biome warning (`--error-on-warnings`) and promotes
`complexity/useLiteralKeys` to `error` so that info-level lint noise can no
longer accumulate. The single existing `useLiteralKeys` finding is on line 78 of
`packages/core/scripts/verify-dnd5e-srd-freeze/cli.ts`:

```diff
-  const ciBase = process.env['GITHUB_BASE_REF'];
+  const ciBase = process.env.GITHUB_BASE_REF;
```

That file lives under a frozen protected path (`verify-dnd5e-srd-freeze/`), so
the change requires a thaw note even though it is a **cosmetic lint fix with no
behavioral change**: bracket access and dot access to `process.env` are
identical at runtime, and the repo does not set
`noPropertyAccessFromIndexSignature`, so the type-check is unaffected. Leaving
the finding suppressed-by-omission was rejected — it would keep info noise in the
tree forever — so the verifier is thawed to fix the code at the source and keep
the rule globally enforced.

No audited SRD artifact content (PDF, pack records, manifests, source ledgers,
audit evidence) is touched.

## Expected file changes

- [x] `packages/core/scripts/verify-dnd5e-srd-freeze/cli.ts` — `process.env`
      dot access (lint hygiene only)
- [x] `docs/audits/dnd5e-srd-5.1-final/thaw-notes/` — this thaw note
- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [ ] `packages/core/scripts/importers/dnd5e-srd-5.1/`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`
- [ ] `docs/audits/dnd5e-srd-5.1-final/` (other than this thaw note)

## Source PDF changed?

No.

## Pack records changed?

No.

## Importer changed?

No. Only the freeze-verifier CLI script changed, and only its `process.env`
access style — the thaw-policy and hash-policy logic in `freeze.ts` is untouched.

## Commands run

```
npm run verify:dnd5e-srd-freeze
npm run check
npm run typecheck
npm test
```

Clean tree: `biome ci --error-on-warnings .` exits 0; `verify:dnd5e-srd-freeze`
hash + changed-path checks pass with this thaw note present; full suite green.

## Freeze manifest updated?

Not required — `cli.ts` is not a hash-pinned file in `freeze-manifest.json`
(only the SRD artifact, source ledgers, and audit docs are hashed). The hash
check is unaffected by this change.

- [ ] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated (n/a)

## Audit bundle path

Not regenerated — no audited artifact content changed.

## Reviewer sign-off notes

Confirm the diff to `cli.ts` is limited to the `process.env` access style and
that no freeze-policy behavior (`freeze.ts`, `freeze-manifest.json`) is altered.
