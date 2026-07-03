# Deep pre-freeze audit — D&D 5e SRD 5.1 rules pack

`npm run audit:dnd5e-srd-deep` is the independent oracle layer for the
committed SRD pack (bead eshyra-o9bd.18.9.1). It is a durable port of the
2026-07-01 external audit harness (`~/src/dnd5e-srd-audit-harness-070126`,
Python): it re-derives everything from the vendored PDF text and the
committed pack alone, sharing **no parser code** with the importer, so an
importer bug can never vouch for itself.

## When to run it

- **Before any freeze / sign-off decision** on the SRD pack. A green run is
  part of the freeze evidence (eshyra-o9bd.18.10).
- After any regeneration PR that changes many records, as an independent
  cross-check on top of `verify:dnd5e-srd-pack`.

It is **not** a per-PR CI gate: extraction plus bidirectional shingle
verification takes minutes, and CI already runs the byte-exact
regeneration check (`verify:dnd5e-srd-pack`, path-gated workflow) and the
full test suite, which covers the importer's fail-closed gates (statline
fidelity, CR/XP, concentration, reference integrity, region-ledger emission
proofs, condition-relation safety).

## Usage

```bash
npm run audit:dnd5e-srd-deep                 # reports to a temp dir
npm run audit:dnd5e-srd-deep -- --out <dir>  # reports to <dir>
```

Exit codes: `0` clean, `1` findings, `2` operational failure. Reports:
`deep-audit-findings.json` (all failures) and `page-coverage-report.json`
(per-page uncovered runs, including the review-only "reordered" runs).

## What it checks

All checks compare 6-token shingles over a normalization that removes
hyphen/apostrophe/case/whitespace differences
(`packages/core/scripts/deep-audit-dnd5e-srd/shingles.ts`):

1. **record-check (pack → source).** Every strict prose field (description,
   text, higherLevels, componentMaterials, suggestedCharacteristics,
   effects, statline sourceText) of every record must be reproducible from
   its cited pages (±1 page, +2 forward). Uncovered runs of ≥4 tokens fail.
2. **digit-check (pack → source).** Every digit-bearing token in a strict
   prose field must sit inside a covered shingle, catching single-number
   corruption (DCs, dice, ranges) below the run-length threshold.
3. **page-coverage (source → pack).** Every content page's token stream is
   covered by shingles built from the whole pack. Runs with novel tokens
   (absent from the entire pack vocabulary) fail — dropped source content.
   Runs whose tokens all exist in the pack ("reordered": statline labels,
   table projections, headers) are reported for review only; the
   region-ledger emission gate (eshyra-o9bd.18.9.2, enforced inside the
   importer on every run) is the fail-closed owner of prose-level drops.
   Reviewed exceptions (front matter, the p.3 errata notice, structural
   running headers) are documented in the CLI source.
4. **consistency (pack-internal).** Dice averages vs printed means, class
   progression rows vs the class table record (proficiency bonus, spell
   slots, cantrips known, feature names), creature attack bonuses and save
   DCs vs their own entry text, and spell damage dice / save abilities /
   spell-attack flags vs spell text.

## Baseline

2026-07-03, pack regenerated at eshyra-o9bd.18.9.2: **0 findings** across
1,812 records and 403 pages (1,996 review-only reordered runs across 349
pages — statline labels and table projections whose content is carried by
structured fields).
