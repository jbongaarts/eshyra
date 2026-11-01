# Thaw note: record locators cover table continuations and inherited spans

Bead: `eshyra-o9bd.16.7.3` (parent `eshyra-o9bd.16.7`; audit lane
`eshyra-o9bd.16.1` finding L1-F1, registry `locator-completeness` / indep:008)

## Reason for thaw

Retained table rows, flattened ancestry traits and copied magic-item variant
entries sat under record locators omitting the SRD page they are printed on
(ADR-0020 bar 2). The source-region ledger never attributed those pages to the
records, so the existing ledger-based locator-completeness gate never saw them.

## Change (importer only; no new schema fields)

- `sourceRegionLedger.ts`: a table-cell run owned by an emitted `table:` record
  now always gets its `record:table:*` entry (previously only runs touching an
  otherwise unaccounted page), and the stray Appendix PH-B column-group header
  item takes the last table caption as owner instead of capturing the Celtic
  Deities rows (p. 360-361).
- New `contentSpanPages.ts`: an independent, extracted-page-text denominator.
  Chunks (a table row; an ancestry trait's first and last 8 tokens; each
  "N Name" entry of a magic-item variant) are searched whole-token on the pages
  within 3 of the record's start page. A chunk printed only on another page adds
  that page to the locator (`pp. N, M` convention). A short wrapped cell
  fallback is excluded (needs >= 5 tokens) so a heading word on a neighbouring
  page can never cite an unrelated page.
- `recordLocatorCompleteness.ts` gains check (e): every such chunk printed in
  the window must be printed on a cited page, independent of the ledger.
- `finding-registry.json` indep:008 `statusReasoning` extended to state the new
  check and its boundary.

## Changed locators (all verified against the vendored PDF, printed pages)

| record | before | after | evidence |
| --- | --- | --- | --- |
| ancestry:dragonborn | p. 5 | pp. 5, 6 | p. 6 prints "You have resistance to the damage type associated with your draconic ancestry" |
| ancestry:hill-dwarf | p. 4 | pp. 3, 4 | p. 3 prints "Dwarves mature at the same rate as humans" (parent traits) |
| ancestry:lightfoot-halfling | p. 5 | pp. 4, 5 | p. 4 prints "When you roll a 1 on the d20" (parent Lucky) |
| table:bag-of-beans | p. 209 | pp. 209, 210 | p. 210 prints "A pyramid with a 60-foot-square base..." |
| table:celtic-deities | p. 360 | pp. 360, 361 | p. 361 prints "Math Mathonwy" through "Silvanus" |
| table:gray-bag-of-tricks | p. 210 | pp. 210, 211 | p. 211 prints "Dire wolf", "Giant elk" |
| table:half-dragon-damage-resistance | p. 320 | pp. 320, 321 | p. 321 prints "Brass, gold, or red" |
| table:lifestyle-expenses | p. 72 | pp. 72, 73 | p. 73 prints "10 gp minimum" |
| table:food-drink-and-lodging | p. 73 | pp. 73, 74 | p. 74 prints "Banquet (per person)" |
| magic-item:bag-of-tricks | p. 210 | pp. 210, 211 | p. 211 prints "Giant elk" and the Rust/Tan entries |
| table:draconic-bloodline-draconic-ancestry | p. 44 | pp. 44, 45 | Found by the generalized pass: Red/Silver/White rows are on p. 45 |

`record.source` changes with the locator. Nothing else in `records.json`
changes. `source-region-ledger.json` gains the table-row entries described
above. Controls: table:the-barbarian stays p. 8 (its last rows are on p. 8).

## Pinned values / tests

New `test/importers/dnd5e-srd-5.1/continuationLocators.test.ts`: the ten audited
witnesses with PDF page evidence, a pack-wide content-chunk invariant, a
negative check that the gate rejects the pre-repair locators, and ledger
attribution of the continuation pages. No existing test was weakened.

## Freeze

Freeze manifest hashes and the freeze guard were not touched.

## Existing pins changed (stale locators / accounting, source quotes above)

- `srdGeneratedPack.test.ts`: lifestyle-expenses `p. 72` -> `pp. 72, 73`,
  food-drink-and-lodging `p. 73` -> `pp. 73, 74`, draconic-bloodline
  `p. 44` -> `pp. 44, 45`, gray-bag-of-tricks `p. 210` -> `pp. 210, 211`,
  bag-of-beans `p. 209` -> `pp. 209, 210` (pages verified in the PDF above).
- `sourceRegionLedger.test.ts`: the two tests that pinned "table-owned rows get
  no ledger entry" now pin the repaired accounting (a `record:table:*`
  table-rows entry with `targetKey`).
- `srdSourceInventoryArtifact.test.ts`: `deity-table-column-header` ignore count
  1 -> 0; those rows are now attributed to table:celtic-deities.
- `docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}` regenerated.
