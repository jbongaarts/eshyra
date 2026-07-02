# Thaw Note - eshyra-o9bd.18 Audit Findings Batch 1

**Date:** 2026-07-02
**Beads:** eshyra-o9bd.18.2 (concentration derivation), eshyra-o9bd.18.1
(Skills prose), eshyra-o9bd.18.4 (Pact Boon prerequisite refs),
eshyra-o9bd.18.5 (CR-0 XP)
**Epic:** eshyra-o9bd.18 (2026-07-01 D&D SRD audit findings)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

First batch of fixes for the 2026-07-01 external max-effort audit round
(ChatGPT manual review + Codex GPT-5.5 + Claude Fable-5 full-coverage audit of
bundle commit beb9a21). Each bead lands as its own commit on this branch:

- **eshyra-o9bd.18.2:** `spell:protection-from-evil-and-good` emitted
  `mechanics.concentration: false` because the SRD 5.1 PDF itself prints
  "Duration: Concentration up to 10 minutes" on p. 173 **without** the comma
  the detector required (`/^Concentration,/`). The detector now accepts both
  "Concentration, up to ..." and the no-comma source-typo form, and a new
  pack-wide `spell-concentration-flag` audit check
  (`auditSrdStructure`) compares every spell's derived
  `mechanics.concentration` against its duration semantics in both
  directions.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` -
      `mechanicsProjections.ts` (comma made optional in the concentration
      duration detector).
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` -
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` - this thaw note and refreshed
      `freeze-manifest.json` hashes.
- [x] Other: `packages/core/src/rules/srdAudit.ts` (new
      `spell-concentration-flag` structure check);
      `packages/core/test/srdStructureAudit.test.ts` and
      `packages/core/test/importers/dnd5e-srd-5.1/emit.test.ts` regression
      coverage.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes, regenerated through the importer (not hand-edited). Record counts
unchanged (total 1812). eshyra-o9bd.18.2 changes exactly one record:
`spell:protection-from-evil-and-good` `mechanics.concentration`
`false` → `true`. No other spell's concentration flag changed (the new
pack-wide audit check verifies all 319 spells agree with their duration
text in both directions).

## Importer changed?

Yes. `mechanicsProjections.ts` `deriveSpellMechanics`: the concentration
detector changed from `/^Concentration,/i` to `/^Concentration,? up to\b/i`,
accepting the p. 173 no-comma source typo while still refusing
non-concentration durations. No source text was altered; the duration string
remains the faithful copy of the PDF.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npm run verify:worktree
```

`verify:dnd5e-srd-pack` reports the committed pack matches freshly
regenerated importer output exactly. `verify:worktree` results recorded in
the PR summary.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with the
      new `records.json` SHA-256 per commit (final:
      `6aebca1f0d78a4ff13e6096fe186c5788979f7800408cf2836061730d322ebd0`);
      all other pinned hashes unchanged.

## Audit bundle path

Not regenerated in this PR; the next bundle run picks up the regenerated
records automatically.

## Reviewer sign-off notes

For eshyra-o9bd.18.2, confirm the `records.json` diff is exactly the one
`"concentration": false` → `true` line inside
`spell:protection-from-evil-and-good`, and that
`npm run verify:dnd5e-srd-pack` reports an exact match.
