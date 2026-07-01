# Thaw Note — vk23 Recharge Range Parsing Fix

**Date:** 2026-06-30
**Beads:** eshyra-54di
**Epic:** eshyra-ajpc
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

The vk23 gameplay audit found that the generated `mechanics.recharge`
projection for creature recharge abilities mis-parsed ranges such as
"Recharge 5–6" and "Recharge 4–6", setting `maximum` equal to the lower bound
instead of 6. This is a deterministic gameplay bug: combat automation would
under-trigger recharge abilities (treating a 5–6 recharge as if it only
recharged on a roll of exactly 5).

Root cause: `parseRecharge` in `mechanicsProjections.ts` matched the range
separator with an ASCII hyphen (`-`) only. The SRD source text (and the
PDF-extracted feature/action names in the pack) use an en dash (`–`,
U+2013) for these ranges, so the optional second capture group never
matched and `maximum` fell back to the single-value branch.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` —
      `mechanicsProjections.ts`: `parseRecharge` now matches hyphen, en dash,
      and em dash range separators.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer; only `mechanics.recharge.maximum`
      values changed.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed
      `freeze-manifest.json` hash for `records.json`.
- [x] Other:
      `packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts`
      (new) — regression coverage for en-dash ranges (5–6, 4–6), the single
      fixed-value case (Recharge 6), and the no-match case.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. The canonical pack was regenerated through the importer, not hand-edited.
Record counts are unchanged (317 creatures, same kind counts across the board);
no records were added or removed.

`git diff --stat` on `records.json` after regeneration: 57 `maximum` fields
changed from the (incorrect) lower-bound value to the correct value 6 — 54
records previously had `maximum: 5` for "Recharge 5–6" abilities and 3 had
`maximum: 4` for "Recharge 4–6" abilities (Air Elemental's Whirlwind, Blink
Dog's Teleport, Water Elemental's Whelm). No other fields in `records.json`
changed; the diff is limited to the targeted failure class.

## Importer changed?

Yes. `parseRecharge`'s range regex changed from
`/\bRecharge\s+(\d)(?:-(\d))?\b/i` to
`/\bRecharge\s+(\d)(?:[-–—](\d))?\b/i`, matching the existing dash-variant
handling pattern already used elsewhere in this importer (e.g.
`sourceRegionLedger.ts`, `parseFeatures.ts`). No extractor behavior changed.

## Commands run

```
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run check
npm run typecheck
npm run test
npm run verify:worktree
```

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with the
  new `records.json` SHA-256.

## Audit bundle path

Not regenerated. This is a targeted parser bug fix; the affected record IDs
and before/after example are documented above and in the bead.

## Reviewer sign-off notes

Confirm `verify:dnd5e-srd-pack` shows the committed pack matches importer
output exactly, `verify:dnd5e-srd-freeze -- --base origin/main` passes, and
the generated diff is limited to the 57 `mechanics.recharge.maximum`
corrections described above.
