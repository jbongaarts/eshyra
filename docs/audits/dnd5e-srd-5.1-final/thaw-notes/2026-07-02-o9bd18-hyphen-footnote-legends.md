# Thaw Note - eshyra-o9bd.18.8 Hyphen Artifacts and Table Notes

**Date:** 2026-07-02
**Beads:** eshyra-o9bd.18.8.1, eshyra-o9bd.18.8.2
**Epic:** eshyra-o9bd.18 (2026-07-01 D&D SRD audit findings)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

Fable's audit found visible SRD text-quality defects and two small missing
source notes:

- mid-word hyphen-space artifacts such as `1st- level`, `15- foot`, and
  `hand- to-hand` survived into generated record strings and provenance ledger
  strings after parser-level line joins;
- the Adventuring Gear backpack footnote was ignored even though the
  `Backpack*` marker is retained in the Container Capacity table;
- the Deck of Many Things table retained `*` markers on card names but dropped
  the source legend explaining that the marked cards are found only in a
  twenty-two-card deck.

The source-backed exception is the legitimate suspended range form
`5- to 20-foot`, which remains in `creature:will-o-wisp` and the matching
source-region ledger phrase.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` - extractor/emitter
      dehyphenation normalization, Adventuring Gear footnote capture, Deck of
      Many Things table legend capture, and table extraction typing.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` -
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json` -
      `source-region-ledger.json` regenerated for normalized phrase strings.
      `source-inventory.json` and `source-coverage.json` unchanged.
- [x] `docs/audits/dnd5e-srd-5.1-final/` - this thaw note and refreshed
      `freeze-manifest.json` hashes.
- [x] Other: regression coverage in `packages/core/test/srdGeneratedPack.test.ts`
      and importer parser/extractor tests.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes, regenerated through the importer (not hand-edited). Record counts
unchanged. Records added: 0. Records removed: 0. Records changed: 58.

The generated diff is expected:

- 56 records normalize true hyphen-space extraction artifacts.
- `equipment:backpack` gains the source footnote description: "You can also
  strap items, such as a bedroll or a coil of rope, to the outside of a
  backpack."
- `table:deck-of-many-things` gains `data.legend` with the source legend
  `*Found only in a deck with twenty-two cards`.

## Importer changed?

Yes. Final emitted string serialization now normalizes PDF dehyphenation
artifacts while preserving numeric suspended `N- to` ranges. `parseEquipment`
joins the two extracted backpack footnote lines and attaches them to the
Backpack equipment record. `parseDocumentTables` carries source legends for
tables whose row cells retain marker characters.

## Commands run

```
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/extract.test.ts packages/core/test/importers/dnd5e-srd-5.1/parseDocumentTables.test.ts
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/extract.test.ts packages/core/test/importers/dnd5e-srd-5.1/parseDocumentTables.test.ts packages/core/test/importers/dnd5e-srd-5.1/parseEquipment.test.ts packages/core/test/srdGeneratedPack.test.ts
npm run verify:dnd5e-srd-pack
```

Focused tests pass. `verify:dnd5e-srd-pack` reports the committed pack matches
freshly regenerated importer output exactly.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with the
      new `records.json` and `source-region-ledger.json` SHA-256 hashes.

## Audit bundle path

Not regenerated in this PR; the next bundle run picks up the regenerated
records and ledger automatically.

## Reviewer sign-off notes

Confirm the only remaining `/[A-Za-z0-9]+- [a-z]/` match is the
source-legitimate `5- to 20-foot` suspended range in `creature:will-o-wisp` and
its matching source-region ledger phrase.
