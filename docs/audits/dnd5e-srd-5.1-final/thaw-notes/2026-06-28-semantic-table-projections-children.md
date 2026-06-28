# Thaw Note — Semantic table projections (eshyra-o9bd.7 children)

**Date:** 2026-06-28
**Beads:** eshyra-o9bd.7.1, eshyra-o9bd.7.2, eshyra-o9bd.7.3, eshyra-o9bd.7.4
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)
**Builds on:** `2026-06-28-semantic-feature-table-projections.md` (eshyra-o9bd.7)

## Reason for thaw

The first eshyra-o9bd.7 slice projected three feature/ancestry tables. These
four child beads complete the remaining deferred table-projection slices, adding
validated semantic `table.data.projection` views for the remaining
gameplay-critical tables so a level-up / purchase / adjudication engine can
consume them without re-parsing generic scalar cells. The source-preserving
`columns`/`rows` stay authoritative and unchanged.

Tables projected by child:

- **eshyra-o9bd.7.1 — price/service/lodging/trade-goods:**
  `table:standard-exchange-rates` (`coinExchangeRates`),
  `table:trade-goods` (`tradeGoodsPrices`),
  `table:food-drink-and-lodging` (`foodDrinkLodgingPrices`),
  `table:services` (`servicePrices`),
  `table:lifestyle-expenses` (`lifestyleExpenses`). All money values normalize to
  copper pieces on the SRD p. 62 exchange basis.
- **eshyra-o9bd.7.2 — language selection pools:**
  `table:standard-languages` and `table:exotic-languages` (`languageOptions`,
  tagged `standard`/`exotic`). No standalone *equipment-selection* table record
  exists to project — SRD equipment choices live in class/background creation
  facts (absorbed under eshyra-o9bd.5), not in `table` records — so 7.2 is
  language pools only.
- **eshyra-o9bd.7.3 — subclass/patron expanded spell tables:**
  `table:life-domain-spells`, `table:oath-of-devotion-spells`,
  `table:fiend-expanded-spells`, and the seven
  `table:circle-of-the-land-*` terrain tables (`subclassSpellGrants`). The
  varying level-column header (Cleric/Druid/Paladin/Spell Level) normalizes to a
  numeric `level`; the comma-joined spell cell becomes a `spells` name array.
  `subclass.data.spellTableRefs` is unchanged.
- **eshyra-o9bd.7.4 — object damage adjudication:**
  `table:object-armor-class` (`objectArmorClass`, with split `materials`) and
  `table:object-hit-points` (`objectHitPoints`, fragile/resilient
  average + dice).

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — adds nine new
      deterministic projection kinds in `tableProjections.ts`.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-region-ledger.json`
      — incidental coverage improvement (see below).
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note and refreshed freeze
      manifest hashes.
- [x] Other: `packages/core/src/rules/kindSchemas.ts` and tests validate the new
      projection kinds.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes. Regenerated through the importer (not hand-edited). Record count is
unchanged at 1812; no records are added or removed. Nineteen existing `table`
records gain a `data.projection` object (the 22 total projected tables = these
19 plus the 3 from the first slice). `manifest.json`, `source-inventory.json`,
and `source-coverage.json` are unchanged.

### Incidental source-region-ledger change (expected)

`source-region-ledger.json` changes by one region. Projecting
`table:circle-of-the-land-forest` puts that table's spell names
(`commune with nature`, `tree stride`) into generated record data, so the PDF
region previously classified `intentionally-ignored:spell-list-header`
(firstPhrase "Commune with Nature Tree Stride") is now attributed to
`record:table:circle-of-the-land-forest`. Net effect: `record` 2101 → 2102,
ignored `spell-list-header` 82 → 81, `unrepresented` stays 0. This is a
source-confirmed coverage *improvement* produced by the same minimal projection
change, kept rather than suppressed per `docs/importer-fix-protocol.md`
(scope-control / incidental-fix guidance).

## Importer changed?

Yes. `tableProjections.ts` adds nine projection builders
(`coinExchangeRates`, `tradeGoodsPrices`, `foodDrinkLodgingPrices`,
`servicePrices`, `lifestyleExpenses`, `languageOptions`, `subclassSpellGrants`,
`objectArmorClass`, `objectHitPoints`). Each is fail-closed through rules-pack
validation in `kindSchemas.ts`; an unsupported projection kind or a malformed
row rejects the whole pack.

## Commands run

```
npm run import:dnd5e-srd -- --pdf packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1/
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run check
npm run typecheck
npm test
```

All listed commands exited 0 after updating the freeze-manifest hashes and the
reviewed partial-field baseline for `table.data.projection`.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated
      (`records.json` and `source-region-ledger.json` hashes).

## Audit bundle path

Not regenerated. These child beads add targeted table projection metadata and
schema/test coverage only; full audit bundle regeneration remains
eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm the generated `records.json` diff is limited to the 19 expected existing
table records (no added/removed records), that source-preserving
`columns`/`rows` are unchanged, that all money projections normalize to copper
correctly, and that the single `source-region-ledger.json` delta is the
Circle of the Land (Forest) coverage improvement described above.
