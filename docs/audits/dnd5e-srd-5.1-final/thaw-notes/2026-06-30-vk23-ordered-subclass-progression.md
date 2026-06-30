# Thaw Note - Ordered SRD Subclass Progression

**Date:** 2026-06-30
**Beads:** eshyra-vk23.5
**Epic:** eshyra-vk23
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

The generated SRD subclass records exposed `data.features` sorted by feature
key. That ordering is stable but not playable: a subclass could list a
higher-level feature before a lower-level feature, such as Champion's
level-10 Additional Fighting Style before its level-3 Improved Critical.

This thaw keeps the same source-backed feature refs, but orders subclass
feature lists by grant level and adds a `data.featuresByLevel` projection so
deterministic tools and the primary DM model can read subclass progression in
play order without resolving every feature ref.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` -
      `classProgression.ts` orders subclass feature refs by grant level and
      emits the level-grouped projection.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` -
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` - this thaw note and refreshed
      `freeze-manifest.json` records.json hash.
- [x] Other: `packages/core/src/rules/kindSchemas.ts` validates the optional
      `featuresByLevel` projection; `packages/core/test/srdGeneratedPack.test.ts`
      covers the generated pack shape and representative subclass order.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes - 12 `subclass` records only. No records were added or removed. Each
subclass keeps the same feature refs, with `data.features` sorted by feature
grant level and a new `data.featuresByLevel` array grouping refs by distinct
grant level. Same-level features stay grouped together; the feature key remains
the stable same-level tiebreak.

Examples pinned by tests:

- `subclass:champion` now lists features at levels 3, 7, 10, 15, and 18.
- `subclass:life-domain` groups its two level-1 features in one row.

## Importer changed?

Yes - enrichment behavior only. `enrichClassChapterRecords` now records each
feature record's integer `data.level`, sorts subclass feature refs by that
level, and fails closed if a referenced subclass feature has no grant level.
No PDF extraction behavior changed.

## Commands run

```
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run verify:worktree
```

`verify:dnd5e-srd-pack` reports the committed pack matches importer output
exactly. `verify:dnd5e-srd-freeze -- --base origin/main` passes with this thaw
note present and the refreshed `records.json` hash. `verify:worktree` passes.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with:
  - `records.json` SHA-256
    `c05a0bbcbbea32ab6b21633250339281d2c057ed30aa4f57f2bbd5cf4d5590aa`
  - all other pinned hashes unchanged.

## Audit bundle path

Not regenerated. This is a targeted generated-pack modeling slice.

## Reviewer sign-off notes

Confirm the generated diff is limited to the 12 subclass records: level-ordering
their existing `data.features` refs and adding `data.featuresByLevel`. Confirm
`verify:dnd5e-srd-pack` still reports zero added, removed, or unexpected changed
records outside the generated subclass record updates.
