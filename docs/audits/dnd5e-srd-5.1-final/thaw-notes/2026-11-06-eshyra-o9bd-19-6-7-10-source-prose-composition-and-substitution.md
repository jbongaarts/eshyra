# Thaw note: source-prose composition and substitution (A3-F1 / A3-F2)

Bead: `eshyra-o9bd.19.6.7.10` (dispatch `.19.6.7.10.1`); audit lane
`eshyra-o9bd.19.6.7.3` findings A3-F1, A3-F2. Extends the o9bd.16.7.2 /
16.7.5 mechanism (producer-reported splices become generated scoped
`source-derived` declarations); no parallel mechanism.

Governing adjustment (2026-11-05): `source-prose` must be faithful with no
undisclosed composition or substitution; legitimate extraction/layout
differences (whitespace, hyphenation, column flow, glyph encoding) are
accommodated. Literal contiguity across extractions is NOT a universal rule.

## Producers changed

Extractions gain an optional `composedBy` (`interior-removal` | `bullet-join`),
set by the producer and omitted when verbatim. `emit.ts`
(`producerComposedProseSplices`) turns reports into splices;
`deriveEmbeddedTableSpliceDeclarations` now groups by (kind, pointer, cause
set) and writes the reason from the cause. Nothing is hand-listed.

- `parseRules.ts` / `removeTableCellLines`: records removed table-cell rows
  (`PageText.removedBefore`) and the caption-resumption re-flows; reports an
  entry only when the removal follows a printed sentence end (see layout control).
- `parseGamemasteringRules.ts` (Objects), `parseHalfDragonTemplate.ts`,
  `parseConditions.ts` (Exhaustion table, bullets), `parseFeats.ts`,
  `parseActions.ts`: report interior removal and/or bullet joins via the shared
  `proseComposition.ts`.
- `parseDocumentTables.ts`: Iron Flask emits the printed `1-50` (was
  hand-written `01-50`; SRD p. 228 prints `1`, dash glyph, `50`). New gate
  `assertReconstructionUsesOnlySourceTokens` runs for every
  `reviewed-reconstruction` spec: the multiset of alphanumeric tokens in the
  reconstructed rows must equal the pinned source lines, so a future curated
  row cannot invent characters. All eight existing specs pass it; the only
  failure was Iron Flask. `class-progression-reconstruction` is not covered
  (its rows omit header tokens; separate shape).

## Generated declaration membership vs the audit's list

Record-scoped `source-derived` declarations added (derived from producers):

- rule `/text`, interior removal (9): ability-checks,
  ability-scores-and-modifiers, expenses-lifestyle-expenses,
  half-dragon-template, hit-points, objects, services, skills, speed.
- condition `/description`, interior removal (1): exhaustion.
- condition `/description`, bullet join (11): blinded, charmed, frightened,
  grappled, invisible, paralyzed, petrified, prone, restrained, stunned,
  unconscious.
- feat `/description`, bullet join (1): grappler.

Reconciliation: the ten interior-splice records match the audit exactly.
Differences from the audit's A3-F2 sibling list:
- `feature:monk:martial-arts` is NOT a member. Its description keeps the
  printed bullet glyphs and is one contiguous span of the importer extraction
  of pp. 26-27 (checked token-for-token); the audit's flag came from hyphen
  line-break handling. It stays `source-prose`.
- A first producer pass also flagged `rule:weapon-proficiency` (p. 64) and
  `rule:improvised-weapons` (p. 65). Those are column-flow interleaving: the
  armor/weapon table cells appear mid-sentence in extraction order ("Most
  people / [cells] / can use simple weapons"), the printed prose is one
  contiguous passage. Reporting them would over-claim, so a removal in the
  middle of a sentence is not a splice (`endsPrintedSentence`). They stay
  `source-prose`.
- The unscoped `condition /description` reason ("the condition's intro line")
  was wrong for bullet-only conditions; reworded to the truth (intro prose or a
  single printed bullet; a lone leading glyph is a layout marker). Deafened,
  Incapacitated and Poisoned (one bullet) stay `source-prose` under it.

Pack churn: `records.json` changes exactly one value pair (Iron Flask
`01-50` -> `1-50`); `field-provenance.json` gains the four scoped
declarations and the reworded reason.

## Tests

`test/importers/dnd5e-srd-5.1/proseCompositionAndSubstitution.test.ts`:
producer-report units with trailing/leading/mid-sentence controls; derivation
of declarations; the reconstruction gate rejecting `01-50`; the reproducer set
in the committed pack (with the monk/weapon-proficiency/improvised-weapons/
single-bullet controls); a generalized invariant that every `source-prose`
rule/condition/feat/action string is contiguous in the cited importer
extraction modulo case, quotes, dashes, hyphenation and spacing (the two
column-flow records are the only exemptions, each verified still needed); and
every `source-prose` table cell uses only tokens printed on its cited pages.

Existing expectations: `parseGamemasteringRules.test.ts` (Objects) and
`parseHalfDragonTemplate.test.ts` use whole-object `toEqual`; each gains
`composedBy: ['interior-removal']`, which is the new report for text those
fixtures really splice. Text assertions are unchanged; nothing weakened.

Not changed: `classProgression.ts` `trimEmbeddedTable` keeps its existing hand
declarations (16.7.2 note). Freeze manifest hashes and the freeze guard were
not touched.
