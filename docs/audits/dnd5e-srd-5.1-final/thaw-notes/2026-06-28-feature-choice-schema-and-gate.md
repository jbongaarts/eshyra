# Thaw Note — Feature choice schema + choice-coverage gate (eshyra-o9bd.9.1)

**Date:** 2026-06-28
**Bead:** eshyra-o9bd.9.1 (framework slice of sub-epic eshyra-o9bd.9)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)

## Reason for thaw

Foundational slice of the eshyra-o9bd.9 choice-modeling sub-epic (re-freeze bar
#9, "choice coverage"). It lands the machine-readable shape for player build
choices on `feature` records plus the audit gate that flags every creation /
level-up choice still carried only as prose. This is pure framework: it adds the
`feature.data.choices[]` plumbing and the `choice-coverage` gate, but does **not**
yet populate any choice, so the generated artifact is unchanged. The modeling
slices (.9.2–.9.6) populate `choices[]` and flip the gate's per-slice punch list
to zero.

Two **protected importer paths** are touched, hence this thaw note:

- `packages/core/scripts/importers/dnd5e-srd-5.1/types.ts` — adds the optional
  `FeatureChoiceEntry` type and a `choices?` field on `FeatureExtraction`.
- `packages/core/scripts/importers/dnd5e-srd-5.1/emit.ts` — `buildFeatureData`
  emits `data.choices` **only when present**. Since no extractor populates
  `feature.choices` in this slice, the field is always absent and the emitted
  records are byte-for-byte identical to the committed pack.

The gate and schema themselves live outside the frozen tree
(`packages/core/src/rules/`), where most of the change is.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — `types.ts` (+`FeatureChoiceEntry`,
      `FeatureExtraction.choices?`) and `emit.ts` (emit `choices` when present).
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note only (no manifest hash
      change; see below).
- [x] Other (outside the frozen tree):
  - `packages/core/src/rules/featureChoices.ts` (new) — shared `FeatureChoice`
    shape + closed category vocabulary.
  - `packages/core/src/rules/kindSchemas.ts` — `optFeatureChoiceArray` validator
    wired into `validateDnd5eFeature`.
  - `packages/core/src/rules/srdPlayabilityAudit.ts` — `choice-coverage` gate.
  - `packages/core/src/internal.ts` — exports.
  - `packages/core/test/rulesPack.test.ts`,
    `packages/core/test/srdPlayabilityAudit.test.ts` — coverage.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

No. The generated artifact is byte-for-byte unchanged. `emit.ts` only emits the
new `choices` field when an extraction supplies it, and no extractor populates
it in this slice. `npm run verify:dnd5e-srd-pack` reports 0 records
added/removed/changed and all `source-*.json` matching exactly.

## Importer changed?

Yes, but additively and inertly: the `choices?` field is threaded through the
feature extraction type and emitter so later slices can populate it without
another importer-shape change. No parser/extractor behavior changes; no feature
currently yields a choice, so no record changes.

## Commands run

```
npm run verify:dnd5e-srd-pack            # committed pack matches importer output exactly (0 changes)
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run check
npm run typecheck
npm test                                 # 2878 passed / 19 skipped
```

All exited 0 (the freeze changed-path check passes once this thaw note is
present; the hash check passes because no hashed artifact changed).

## Freeze manifest updated?

- [ ] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated —
      **intentionally not updated.** No hashed frozen artifact changed (the
      importer output is byte-stable), so every recorded SHA-256 still matches.
      The thaw note is required only because two protected *importer source*
      files changed; the manifest covers generated artifacts, which did not.

## Audit bundle path

Not regenerated. Schema + gate + tests only; full audit bundle regeneration
remains eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm: (1) `npm run verify:dnd5e-srd-pack` shows 0 record changes — the
`emit.ts` change is inert until an extractor sets `feature.choices`;
(2) the freeze hash check passes with no `freeze-manifest.json` change, since no
hashed artifact moved; (3) the `choice-coverage` gate is the only RED
playable-model category, with the 48-finding per-slice punch list
(.9.2 subclass 12, .9.3 spell/cantrip 12, .9.4 ASI-vs-feat 12,
.9.5 fighting-style/metamagic/invocation/terrain-enemy 7,
.9.6 channel-divinity/expertise 5) that the modeling slices drive to zero.
