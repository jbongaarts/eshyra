# Thaw note: copied option citations and internal-splice provenance

Bead: `eshyra-o9bd.16.7.5` (Sol review `eshyra-o9bd.16.7.4` of PR #701, S1-S3)

## S1: Dragon Ancestor option citations

`deriveFeatureChoices` copies `table.source` onto each option before the final
locator enrichment, so nine options cited p. 44 although those rows print on
p. 45 (SRD 5.1 pp. 44-45: only Black is on p. 44; Red, Silver, White and the
other six rows are on p. 45). New `refineCopiedOptionSources`
(`contentSpanPages.ts`) runs after locator enrichment: an option whose source
is a single page equal to a multi-page table's first page, and whose text
contains every cell of a table row, is re-cited to the page that row is
printed on (found in the extracted page text), or to the table's final span if
the row cannot be located. Changed: `feature:draconic-bloodline:dragon-ancestor`
`/choices/0/options/1..9/source` p. 44 -> p. 45. Controls unchanged: Black
p. 44, `feature:circle-of-the-land:circle-spells` options p. 22.

## S2: internal splices

`stripEmbeddedTableProse` removed a table span from the middle of a prose
field and collapsed the seam, yet the field stayed `source-prose`.
`stripEmbeddedTableProseReporting` now reports every (record, field) whose
removal left non-whitespace source text on both sides (`proseHasInternalSplice`);
a trailing removal leaves a contiguous prefix and is not reported. `emit.ts`
turns the reports into record-scoped `source-derived` declarations
(`deriveEmbeddedTableSpliceDeclarations`) unioned with the hand declarations
and written to `field-provenance.json`. Nothing is hand-listed.

Records whose `/description` is newly `source-derived` in
`field-provenance.json` (17; record data unchanged):
- feature: `feature:draconic-bloodline:dragon-ancestor`,
  `feature:sorcerer:font-of-magic` (the review witnesses)
- spell: animate-objects, confusion, creation, reincarnate, scrying, teleport
- magic-item: candle-of-invocation, carpet-of-flying, cube-of-force,
  deck-of-many-things, feather-token, horn-of-valhalla, manual-of-golems,
  ring-of-shooting-stars, spell-scroll

The 15 non-witness records are the same defect class (a table removed from the
middle of their description) found by the generalized producer report.
`classProgression.ts` `trimEmbeddedTable` (Destroy Undead, Wild Shape) is a
separate path that does not go through this strip; its hand declarations are
left as they are.

## S3

The Foresight citation in the 16.7.1 thaw note is corrected from p. 155 to
p. 147 (the record cites `SRD 5.1 p. 147`).

## Tests

`test/importers/dnd5e-srd-5.1/internalSpliceAndOptionCitations.test.ts`: option
citations (nine p. 45 rows, Black and Circle Spells controls); producer report
with a trailing-removal control; derived declarations; committed manifest
classification; a real context packet showing neither witness under the
verbatim heading. No existing test was weakened.

Freeze manifest hashes and the freeze guard were not touched.

## Test helpers adjusted

`projectionLimitProvenance.test.ts` (`reclassified`) and
`provenanceBinding.test.ts` (the incomplete-manifest case) assumed exactly one
`(spell, /description)` declaration. Record-scoped splice declarations now share
that pointer for six spells, so both helpers target the unscoped declaration
(`recordKeys === undefined`); what they assert is unchanged.
`docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}` regenerated.
