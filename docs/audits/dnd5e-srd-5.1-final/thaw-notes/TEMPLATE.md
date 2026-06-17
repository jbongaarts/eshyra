# Thaw Note — D&D SRD 5.1 Artifact

> **Filename convention:** copy this file to `<date>-<short-reason>.md`
> (e.g. `2026-06-20-fix-chain-shirt-description.md`) so the freeze guard
> recognises it as an active thaw note. This template file is not itself
> an active thaw note.
>
> **What happens next:** adding this file passes the thaw-note policy check,
> but the hash check still runs. After making the intended changes, update
> `freeze-manifest.json` with the new SHA-256 hashes and update the audit and
> provenance evidence consistently. The PR reviewer should verify both.

---

## Reason for thaw

<!-- Why is this frozen artifact being changed? -->

## Expected file changes

<!-- List the frozen paths you expect to modify. -->

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [ ] `packages/core/scripts/importers/dnd5e-srd-5.1/`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [ ] `docs/audits/dnd5e-srd-5.1-final/`
- [ ] Other: <!-- describe -->

## Source PDF changed?

<!-- Yes / No. If yes: new hash, new size, new version. -->

## Pack records changed?

<!-- Yes / No. If yes: which record kinds, and approximately how many added/removed/updated. -->

## Importer changed?

<!-- Yes / No. If yes: what was the parser/extractor behavior being fixed or extended. -->

## Commands run

```
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze
npm run check
npm run typecheck
npm test
```

<!-- Paste exit codes and any relevant output. -->

## Freeze manifest updated?

<!-- Confirm freeze-manifest.json was updated with new hashes after making the changes. -->

- [ ] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated

## Audit bundle path

<!-- If you regenerated the audit bundle, note its local path for the reviewer. -->

## Reviewer sign-off notes

<!-- For the reviewer: note anything that required independent verification. -->
