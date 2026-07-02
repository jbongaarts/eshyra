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

- **eshyra-o9bd.18.4:** the five `pact-boon:*` prerequisite refs in
  `feature:warlock:eldritch-invocations` are inline option ids (the
  eshyra-ldqb addressing scheme), not record keys — the 2026-07-01 audits
  read them as dangling record refs. Each `pactBoon` clause now also carries
  `featureRef: 'feature:warlock:pact-boon'`, making it a structured predicate
  resolvable without pack-wide scanning: the kind schema requires the field,
  the `unresolvable-inline-option-ref` gate additionally verifies the option
  is offered by that specific feature's choices (not merely by *some*
  choice), and `reference-integrity` now traverses
  `choices[].options[].prerequisites[]` (`level.classRef`,
  `pactBoon.featureRef`, `cantrip.ref`) reporting the full JSON path of any
  dangling nested ref.

- **eshyra-o9bd.18.5:** CR-0 experience points were underdetermined: the
  creature kind stored only `challengeRating`, and the CR-to-XP table cannot
  reconstruct CR 0, which the source prints per creature as either "(0 XP)"
  or "(10 XP)". The creature parser now captures the printed XP award from
  every Challenge line (failing closed when a Challenge line lacks one), all
  317 creature records emit `experiencePoints` (source-verified: 27 CR-0
  creatures print 10 XP; Frog and Sea Horse print 0 XP), the creature kind
  schema requires the field, and a new `creature-cr-xp` audit check
  round-trips every creature's XP against the SRD XP-by-CR table (CR 0
  allowing exactly 0 or 10).

- **eshyra-o9bd.18.1:** `rule:skills` silently dropped the p. 78 prose that
  resumes after the embedded per-ability skill list — the SRD's operative
  statement that skill proficiency adds the proficiency bonus, plus the
  climbing-a-cliff example. The per-ability bullet captions are excluded from
  becoming their own rules (`skillsByAbility` enrichment owns the mapping),
  but the exclusion dropped the caption's *entire* body, swallowing the
  section prose that follows the final Charisma bullet. `parseRules` now
  re-flows post-bullet prose from an excluded bullet-scaffolding caption into
  the most recent emitted rule — the same mechanism table-caption exclusions
  already use (eshyra-0m9.22). The source-region ledger reclassifies that
  region from `child-of:rule:skills` (heading-owned) to `record:rule:skills`
  with a text-containment guard note, so the region is now accounted by
  emitted prose, not by heading ownership alone. The general
  owned-region-requires-emitted-prose gate is tracked separately as
  eshyra-o9bd.18.9.2.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` -
      `mechanicsProjections.ts` (comma made optional in the concentration
      duration detector); `deriveFeatureChoices.ts` / `types.ts` (`pactBoon`
      prerequisite clauses gain `featureRef`); `parseCreatures.ts` /
      `types.ts` / `emit.ts` (printed creature XP captured and emitted);
      `parseRules.ts` (post-bullet prose resumption for excluded
      bullet-scaffolding captions).
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` -
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json` -
      `source-region-ledger.json` regenerated for eshyra-o9bd.18.1 (the p78
      skill-proficiency region reclassifies `child-of:rule:skills` →
      `record:rule:skills` with a containment guard note).
      `source-inventory.json` and `source-coverage.json` unchanged.
- [x] `docs/audits/dnd5e-srd-5.1-final/` - this thaw note and refreshed
      `freeze-manifest.json` hashes.
- [x] Other: `packages/core/src/rules/srdAudit.ts` (new
      `spell-concentration-flag` structure check; nested prerequisite
      traversal in `reference-integrity`);
      `packages/core/src/rules/kindSchemas.ts`, `featureChoices.ts`,
      `inlineFeatureOptions.ts`, `srdPlayabilityAudit.ts` (pactBoon
      `featureRef` schema + ownership gate); regression coverage in
      `packages/core/test/srdStructureAudit.test.ts`,
      `srdPlayabilityAudit.test.ts`, `srdGeneratedPack.test.ts`, and
      `packages/core/test/importers/dnd5e-srd-5.1/` tests.

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
      new `records.json` SHA-256 at each commit in this batch (final value is
      the one committed with this note); all other pinned pack hashes
      unchanged.

## Audit bundle path

Not regenerated in this PR; the next bundle run picks up the regenerated
records automatically.

## Reviewer sign-off notes

For eshyra-o9bd.18.2, confirm the `records.json` diff is exactly the one
`"concentration": false` → `true` line inside
`spell:protection-from-evil-and-good`, and that
`npm run verify:dnd5e-srd-pack` reports an exact match.
