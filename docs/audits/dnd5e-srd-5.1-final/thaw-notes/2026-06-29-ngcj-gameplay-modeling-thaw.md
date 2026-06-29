# Thaw Note — ngcj gameplay-modeling slice (eshyra-ngcj.1/.3/.4/.5)

**Date:** 2026-06-29
**Beads:** eshyra-ngcj.1, eshyra-ngcj.3, eshyra-ngcj.4, eshyra-ngcj.5
**Epic:** eshyra-ngcj (close D&D SRD gameplay-modeling gaps from the 2026-06-29 audit)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

The pack is source-complete but not yet gameplay-ready: important character-
creation choices and inventory grants are still buried in prose. This slice
makes them deterministic, addressable data so character creation can grant
equipment and resolve build choices without parsing prose. The generated
`records.json` changes (new typed fields on class / equipment-pack / ancestry /
background records) and new importer modules (protected paths) are added, so
this thaw note plus a freeze-manifest hash update are required.

## What changed

- **ngcj.1 — choice-bearing prose coverage gate.** New report-only audit
  `srdChoiceProseAudit` (no pack change) emitted into the audit bundle. Scans
  feature/class/subclass/ancestry/background prose for build-choice menus and
  flags records lacking a structured catalog. Per-signal/category coverage so
  one modeled choice cannot mask a different unmodeled menu on the same record.
- **ngcj.3 — class starting equipment grants.** Each class `startingEquipment`
  option/fixed entry gains typed `grants` (item ref + quantity, or a typed
  weapon/focus filter). Shared resolver `srdStartingEquipmentGrants`.
- **ngcj.4 — equipment pack contents.** The 7 equipment packs gain typed
  `contents` (quantity + name + optional `equipment:` ref + detail).
- **ngcj.5 — ancestry/background creation choices.** 5 ancestries gain typed
  `choices[]` (Dragonborn draconic ancestry → table; Dwarf/Hill Dwarf tool;
  Half-Elf skills; High Elf wizard cantrip → the pack's 14 wizard cantrip spell
  keys + extra language). `background:acolyte` gains `choices[]` (personality/
  ideal/bond/flaw rollable table choices) and `equipmentGrants[]` (the holy
  symbol modeled as a `holy-symbol` selectable grant). Module
  `srdCreationChoices`.

All new data is generated through the importer (`creationFacts` / `emit` /
`equipmentPackContents`), never hand-edited; cross-record refs are validated
fail-closed by a new `validateCrossReferences` import path (set by the import +
verify CLIs).

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — new
      `equipmentPackContents.ts`; `creationFacts.ts` / `emit.ts` / `index.ts` /
      `cli.ts` wire-ups.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note + refreshed
      `freeze-manifest.json` `records.json` hash.
- [x] Other (outside the frozen tree): new `src/character/` modules
      (`srdStartingEquipmentGrants`, `srdEquipmentPacks`, `srdCreationChoices`);
      `kindSchemas`, `rulesPackResolver`, `srdAudit`, `srdChoiceProseAudit`,
      `internal.ts`; `verify-dnd5e-srd-pack/cli.ts`; tests + the
      `srdGeneratedPack.test.ts` partial-field baseline.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes — regenerated through the importer (not hand-edited). Record count is
**unchanged at 1812**; no records added or removed. The diff is purely additive
typed fields:

- 12 `class` records gain `startingEquipment` option/fixed `grants`.
- 7 `equipment` pack records gain `data.contents`.
- 5 `ancestry` records gain `data.choices`.
- 1 `background` record (Acolyte) gains `data.choices` + `data.equipmentGrants`.

`manifest.json`, `source-inventory.json`, `source-coverage.json`, and
`source-region-ledger.json` are unchanged (`verify:dnd5e-srd-pack` reports
0 added / 0 removed / 0 changed against the regenerated output and all
`source-*.json` matching exactly).

## Importer changed?

Yes: a new `equipmentPackContents.ts` module plus enrichment wire-ups in
`creationFacts.ts` / `emit.ts` and fail-closed ref guards in `index.ts`. No
extractor/parser behavior over the source PDF changed (the additions are typed
projections of already-extracted prose, authored as source-cited maps).

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack            # committed == importer output exactly (0 record changes)
npm run typecheck                        # clean
npm run check                            # Biome clean (--error-on-warnings)
npm test                                 # full suite: 3132 passed / 19 skipped
```

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with the new
      `records.json` SHA-256
      (`7c6d2f485b798b2c6dec81c3ef87d22dd3ec072b0c1949bc8ecc9ca23f7e5f24`).

## Audit bundle path

Not regenerated. Targeted gameplay-modeling pass + audit-gate + test coverage
only; full audit bundle regeneration remains epic-level work.

## Reviewer sign-off notes

Confirm: (1) `verify:dnd5e-srd-pack` shows the committed pack is exactly the
importer output (the new fields are generated, not hand-edited); (2) the
`records.json` diff is limited to additive typed fields on the 12 class, 7 pack,
5 ancestry, and 1 background records, with no records added/removed and no prose
change; (3) every fixed item grant / pack content / creation-choice ref resolves
to a real record (the importer fails closed otherwise); (4) record count is
unchanged at 1812.
