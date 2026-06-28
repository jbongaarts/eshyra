# Thaw Note — Table reachability completeness (eshyra-o9bd.8.3)

**Date:** 2026-06-28
**Bead:** eshyra-o9bd.8.3 (final slice of eshyra-o9bd.8)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)
**Builds on:** `2026-06-28-magic-item-table-owner-links.md` (8.1),
`2026-06-28-rule-background-feature-table-owner-links.md` (8.2)

## Reason for thaw

Closes deficiency #7. 8.1/8.2 linked the owned tables; this slice links the
remaining section-owned reference tables, classifies the genuinely ownerless
ones, and adds the **table-reachability completeness gate** so every emitted
`table` record is provably either reachable from an owner or explicitly
allow-listed as standalone. No table can be a silent orphan again.

### Tables linked (extend `SRD_5_1_TABLE_OWNERS`), each by SRD page + prose

| Table(s) | Owner | Page |
| --- | --- | --- |
| `celtic-deities` / `egyptian-deities` / `greek-deities` / `norse-deities` | `rule:the-*-pantheon` | 360 |
| `standard-languages`, `exotic-languages` | `rule:languages` | 59 |
| `standard-exchange-rates` | `rule:coinage` | 62 |
| `donning-and-doffing-armor` | `rule:getting-into-and-out-of-armor` | 64 |
| `difficulty-classes` | `rule:ability-checks` | 77 |
| `travel-pace` | `rule:speed` (names "the Travel Pace table") | 84 |
| `damage-severity-by-level`, `trap-save-dcs-and-attack-bonuses` | `rule:trap-effects` | 196 |
| `hit-dice-by-size` | `rule:hit-points` (names "Hit Dice by Size") | 255 |
| `size-categories` | `rule:size` (names "the Size Categories table") | 254 |
| `experience-points-by-challenge-rating` | `rule:challenge-experience-points` | 258 |

### Table classified standalone (`SRD_5_1_STANDALONE_TABLES`)

- `table:proficiency-bonus-by-challenge-rating` (p. 256) — a CR → proficiency
  bonus monster-statistics reference consulted by both
  `rule:monsters-saving-throws` and `rule:monsters-skills`; it belongs to no
  single entry, so it is deliberately ownerless.

After this slice all 108 tables are classified: 107 reachable from an owner
(via `tableRefs` / `spellTableRefs` / `progressionTableRef` / ancestry-trait
links) and 1 on the standalone allow-list.

## Re-freeze gates added/confirmed

1. **Table-link completeness** — new `table-reachability` audit: every emitted
   table is referenced by some record or allow-listed, else a finding. The
   committed-pack test additionally asserts the allow-list cannot rot (every
   entry is still an emitted table).
2. **No duplicate table linearization in prose** — already enforced at import by
   `stripEmbeddedTableProse` + `assertNoEmbeddedTableLinearization`
   (eshyra-3anh), which fail the build closed if a captured table span survives
   in any owner's prose. No owner linked in o9bd.8 embeds its table rows.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — none new; the existing
      `linkOwnedTables.ts` pass consumes the extended map.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed freeze
      manifest hash.
- [x] Other: `packages/core/src/rules/srdAudit.ts` (extended
      `SRD_5_1_TABLE_OWNERS`, new `SRD_5_1_STANDALONE_TABLES` +
      `table-reachability` gate) and `packages/core/src/internal.ts` (exports).

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. Regenerated through the importer (not hand-edited). Record count is
unchanged at 1812; no records are added or removed. 13 rule owners gain a
`data.tableRefs` array covering 15 tables. Records with a `tableRefs` link rise
from 57 to 70. `manifest.json`, `source-coverage.json`, and
`source-region-ledger.json` are unchanged.

## Importer changed?

No new importer code. The map lives in `srdAudit.ts`; `linkOwnedTables.ts`
(eshyra-o9bd.8.1) already wires every present owner.

## Commands run

```
npm run import:dnd5e-srd -- --pdf packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run check
npm run typecheck
npm test
```

All listed commands exited 0 after updating the freeze-manifest hash and the
reviewed partial-field baseline for rule `tableRefs`.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated
      (`records.json` hash).

## Audit bundle path

Not regenerated. Targeted table-link metadata + audit gate + test coverage only;
full audit bundle regeneration remains eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm the generated `records.json` diff is limited to the 13 expected rule
owners gaining a `tableRefs` array (no added/removed records, no prose change),
that each owner choice matches the source evidence above, that the single
standalone classification is justified, and that the `table-reachability` and
`table-owner-link` gates are clean for the committed pack.
