# Thaw Note - vk23 Remaining Gameplay-Readiness and Source-Page Fixes

**Date:** 2026-06-30
**Beads:** eshyra-vk23.6, eshyra-vk23.7, eshyra-vk23.8
**Epic:** eshyra-vk23
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

This thaw closes the remaining vk23 children from the ngcj SRD gameplay-modeling
audit follow-up:

- The audit-bundle gameplay-readiness report now distinguishes partially
  structured records from prose-only records, so structured condition records
  such as Blinded (`effects[]`) and Exhaustion (`levels[]`) are not counted as
  fully prose-only.
- Warlock feature option source labels now use the page where each option
  heading appears. Eldritch Invocation options span SRD pages 48-50 instead of
  inheriting the parent feature heading page 47.
- The local Biome installation was refreshed with `npm ci` so `npm run check`
  uses the lockfile-pinned Biome 2.5.1 CLI and the existing 2.5.1 schema,
  eliminating the non-blocking schema-version info output without suppressing
  diagnostics.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` -
      `parseFeatures.ts` records option-heading source pages inside feature
      bodies, `emit.ts` maps those pages to option source labels, and
      `deriveFeatureChoices.ts` uses the labels for inline option catalogs.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` -
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts` -
      gameplay-readiness report gains a `partial structure` bucket.
- [x] `docs/audits/dnd5e-srd-5.1-final/` - this thaw note and refreshed
      `freeze-manifest.json` records.json hash.
- [x] Other: `packages/core/src/rules/featureChoices.ts` types the already
      validated structured option prerequisite clauses; parser/deriver/generated
      pack/audit-bundle tests cover the changed behavior.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. The canonical pack was regenerated through the importer, not hand-edited.
Record counts are unchanged; no records were added or removed.

Only two `feature` records changed:

- `feature:warlock:eldritch-invocations`: the 32 invocation option `source`
  labels now point to SRD 5.1 pages 48, 49, or 50 according to each option
  heading.
- `feature:warlock:pact-boon`: `pact-boon:pact-of-the-tome` now points to
  `SRD 5.1 p. 48`, where that option heading appears after the parent feature's
  page-47 intro and prior Pact Boon options.

No `manifest.json`, `source-inventory.json`, `source-coverage.json`, or
`source-region-ledger.json` content changed; `verify:dnd5e-srd-pack` confirms
all source-accounting artifacts still match regenerated output exactly.

## Importer changed?

Yes - feature parsing/enrichment behavior only. `parseFeatures` keeps a
heading-to-page map for option headings inside a feature body. `emit` converts
that map to source labels keyed by feature record key. `deriveFeatureChoices`
uses those labels when building inline option catalogs, falling back to the
parent feature source when no per-option label exists.

No PDF extraction behavior changed.

## Commands run

```
npm ci
npm run format
npm test -- packages/core/test/importers/dnd5e-srd-5.1/parseFeatures.test.ts packages/core/test/importers/dnd5e-srd-5.1/deriveFeatureChoices.test.ts packages/core/test/srdGeneratedPack.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
```

`verify:dnd5e-srd-pack` reports the committed pack matches importer output
exactly.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with:
  - `records.json` SHA-256
    `ba39da045fb2ab316c8a991ad17064c229814daf078ea90c6d9825393aae019d`
  - all other pinned hashes unchanged.

## Audit bundle path

Not regenerated. This is a targeted report-generation and source-attribution
fix; the report helper has focused unit coverage.

## Reviewer sign-off notes

Confirm that the generated `records.json` diff is limited to the expected
Warlock option `source` labels, that the gameplay-readiness report now has a
partial-structure bucket, and that `npm run check` is clean with Biome 2.5.1
from the lockfile.
