# Thaw Note — Typed class progression `advancement[]` + Rogue Thieves' Cant

**Date:** 2026-06-28
**Bead:** eshyra-o9bd.2 (folds eshyra-o9bd.3; absorbs eshyra-o9bd.17)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)

## Reason for thaw

The frozen class-progression rows carried untyped feature markers
(`{ name }` with no `ref`) and a malformed `spellcasting.spellsKnown: null`
placeholder (Ranger level 1) that a level-up engine cannot apply. eshyra-o9bd.2
replaces the progression model with a typed `progression[].advancement[]`
discriminated union so every level is deterministically applicable.

Folded **eshyra-o9bd.3**: Rogue's "Thieves' Cant" was swallowed into
`feature:rogue:sneak-attack`'s description. It is split into its own
`feature:rogue:thieves-cant` record so the level-1 row grants both as feature
refs (and so the Rogue progression types without a missing record). Doing it
here avoids a second frozen-pack regeneration.

Absorbed **eshyra-o9bd.17**: the resolver and level-up engine are cut over to the
new shape in this same change; no separate consumer-cutover remains.

## What changed

Importer (`scripts/importers/dnd5e-srd-5.1/classProgression.ts`):
- `progression[].advancement[]` replaces `features`/`resources`/`spellcasting`.
  Entry kinds: `featureGrant{ref,name,detail?}`, `subclassFeatureSlot{slotName,
  subclassLevel}`, `featureImprovement{targetRefs,label}`,
  `resourceProgression{resource,value}`, `spellcastingProgression{cantripsKnown?,
  spellsKnown?,slots?,pactSlots?,invocationsKnown?}`.
- Source-backed classification from PR #336
  (`docs/design/srd-level-up-row-classification.md`); fail-closed — an
  unclassifiable marker throws rather than emitting a raw label.
- Non-applicable spellcasting is omitted (no `null`).
- `splitRogueThievesCant` lifts the Thieves' Cant prose into its own feature.

Consumers (cut over in this change): `rulesPackResolver.ts` (typed
`ResolvedClassLevel.subclassFeatureSlots`/`featureImprovements`), `levelUpEngine.ts`
(typed slots/improvements; removed the `SUBCLASS_FEATURE_MARKER_NAMES`
name-heuristic), and the `.11` playable-model gate (`srdPlayabilityAudit.ts`)
which now validates `advancement[]`.

## Pack records changed?

Yes. Regenerated through the importer (not hand-edited):
- Every `class` record's `progression` is now typed `advancement[]`.
- New `feature:rogue:thieves-cant`; `feature:rogue:sneak-attack` description
  trimmed. Feature count 183 → 184, total records 1811 → 1812.
- `source-coverage.json` / `source-region-ledger.json` reflect the new record
  (record 1452 → 1453, childOf 456 → 455; total mapped unchanged).

## Importer changed?

Yes — see above. Deterministic; committed pack matches importer output.

## Freeze manifest updated?

- [x] Updated hashes for the 5 changed pinned files: `records.json`,
  `source-coverage.json`, `source-region-ledger.json`, plus the count-bearing
  `record-counts.md` and `evidence.json` (total/feature counts corrected to
  1812/184). Deeper audit-bundle re-derivation (coverage analysis, gate re-runs)
  remains eshyra-o9bd.14's re-freeze scope; the artifact stays `thawed-reaudit`.

## Commands run

```
npm run import:dnd5e-srd -- --pdf .../SRD_CC_v5.1.pdf --out .../rules__dnd5e-srd-5.1/
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run verify:worktree
```

Full suite green (structure audit still 0; playable-model gates for .2/.3 now
green; overlay-dependence stays red for .5). The `.11` re-freeze-readiness
ratchet (`it.fails`) still passes (overlay-dependence remains until .5/.9).

## Reviewer sign-off notes

Confirm the generated pack diff is limited to (a) typed `advancement[]` on every
class, (b) the Thieves' Cant split, and (c) the source-ledger deltas above — no
unrelated record churn. Confirm the resolver/engine/gate consume the typed shape
and the PR #336 lock test now asserts typed slots/improvements rather than
unsupported markers.
