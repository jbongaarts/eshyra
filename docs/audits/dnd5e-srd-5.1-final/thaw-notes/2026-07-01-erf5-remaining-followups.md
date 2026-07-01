# Thaw Note - eshyra-erf5 Remaining Follow-ups

**Date:** 2026-07-01
**Beads:** eshyra-erf5.5, eshyra-erf5.6, eshyra-erf5.7, eshyra-5c7f (final
acceptance criterion)
**Epic:** eshyra-erf5
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

Closes the three follow-ups deferred out of PR #380 plus the last open
acceptance criterion of eshyra-5c7f:

- **eshyra-erf5.5:** table-rows-only pages (p69 Adventuring Gear price-list
  body with its embedded sub-group captions, p361 deity-table captions, p362
  Norse Deities row continuation) previously had zero source-region-ledger
  entries while the summary claimed `unrepresented: 0`. Design decision
  (option b of the bead): those sub-captions and continuation rows render at
  table-cell height (h≈8.9) and are typographically indistinguishable from
  rows, and their content is already represented (equipment records; `table:`
  records' rows) — so a ledger prose entry is not the right accounting
  mechanism. Instead, the ledger now emits explicit `table-rows` entries for
  any skipped cell run touching a page that would otherwise have no ledger
  entry, and a new `summary.unaccountedPages` field (asserted empty at import
  time) proves every non-empty page carries either a ledger entry or a
  coverage item.
- **eshyra-erf5.6:** `findRepresentingRecord`'s tie-break now prefers a
  section-slug match outright before falling back to heading-slug, fixing 12
  ledger entries (9 Ability Score Improvement + 3 Extra Attack) that were all
  mis-attributed to `feature:barbarian:*` because every class's identically
  worded feature satisfied the heading-slug OR-branch first.
- **eshyra-erf5.7:** `namedItemCandidates()` in the equipment-resolution
  audit now validates hard-coded named-item keys against the actual equipment
  catalog (fails closed on a typo'd key). Not a frozen path; listed for
  completeness of the PR.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` -
      `sourceRegionLedger.ts` only (table-rows run tracking + explicit
      entries + `unaccountedPages` gate; section-slug tie-break fix).
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` -
      regenerated through the importer; exactly one record changed
      (`table:norse-deities` locator `p. 361` → `pp. 361, 362`).
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json` -
      `source-region-ledger.json` regenerated (12 entries re-attributed to
      the correct class features; 6 new `table-rows` entries; new
      `unaccountedPages: []` summary field). `source-inventory.json` and
      `source-coverage.json` unchanged.
- [x] `docs/audits/dnd5e-srd-5.1-final/` - this thaw note and refreshed
      `freeze-manifest.json` hashes.
- [x] Other: `packages/core/src/rules/srdEquipmentResolutionAudit.ts`
      (catalog validation); matching importer/artifact/audit test coverage.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes, regenerated through the importer (not hand-edited). Record counts
unchanged (total 1812). Exactly one record changed: `table:norse-deities`'s
provenance locator became `pp. 361, 362`, because the new p361-l43 table-rows
ledger entry attributes the p362 row continuation (Frigga through Uller —
physically printed on p362 and already present in the record's rows) to its
owning table record, and eshyra-lpk9's provenance enrichment unions that
page in. Source-confirmed against the PDF.

## Importer changed?

Yes, `sourceRegionLedger.ts` only:

1. Skipped table-cell runs are tracked, and any run touching a page with no
   other ledger entry emits an explicit `table-rows` entry: `record:<key>`
   when the owning caption resolves to a `table:` record (rows are that
   record's own data), the owning structure's documented ignore reason when
   it has one, `table-rows-emitted-as-records` when rows are emitted as their
   own records (the p69 price list), and fail-closed `unrepresented` when no
   accounted owner exists.
2. New `summary.unaccountedPages` (non-empty pages with neither a ledger
   entry nor a coverage item) is asserted empty by
   `assertSourceRegionLedger`, closing eshyra-5c7f's "a page cannot vanish
   behind a zero-unrepresented summary" acceptance criterion.
3. `findRepresentingRecord` prefers section-slug matches over heading-slug
   matches when both branches have candidates (eshyra-erf5.6).

No change re-interprets source PDF text; all changes are audit-evidence and
attribution fixes per `docs/importer-fix-protocol.md`.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/
npm run verify:dnd5e-srd-pack
npm run verify:worktree
```

`verify:dnd5e-srd-pack` reports the committed pack matches freshly
regenerated importer output exactly. `verify:worktree` results recorded in
the PR summary.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with:
  - `records.json` SHA-256
    `7e781f9f7977fd17ef6e67b7d854d4105127537c0f8d69d3fe1dd404f888090d`
  - `source-region-ledger.json` SHA-256
    `7bf07adefbc7fda7e9248c308f0ba6065f1d6fd4c60a6fc586aaa38ef75c6180`
  - all other pinned hashes unchanged.

## Audit bundle path

Not regenerated in this PR. The bundle copies the committed
`source-region-ledger.json`, so the next bundle run picks up the explicit
table-rows accounting automatically.

## Reviewer sign-off notes

Confirm the `records.json` diff is exactly the one `table:norse-deities`
locator line; that the ledger diff is limited to the 12 re-attributed class
feature entries, the 6 new `table-rows` entries (p69 ×2, p360-361, p361 ×2
spanning to p362), and the summary counters/`unaccountedPages` field; and
that `npm run verify:dnd5e-srd-pack` still reports an exact match.
