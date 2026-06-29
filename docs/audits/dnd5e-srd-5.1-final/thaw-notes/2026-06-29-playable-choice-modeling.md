# Thaw Note — Playable choice modeling (eshyra-o9bd.9.2–.9.6)

**Date:** 2026-06-29
**Beads:** eshyra-o9bd.9.2, .9.3, .9.4, .9.5, .9.6 (the five modeling slices of sub-epic eshyra-o9bd.9)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md` (epic eshyra-o9bd)
**Builds on:** `2026-06-28-feature-choice-schema-and-gate.md` (eshyra-o9bd.9.1, schema + gate)

## Reason for thaw

Closes deficiency #9 (choice coverage). The eshyra-o9bd.9.1 framework added the
`feature.data.choices[]` schema, the named out-of-scope marker convention, and
the `choice-coverage` audit gate, which was RED with a 48-finding punch list.
These five slices attach the actual structured choices via a new importer pass,
driving the gate to **zero** — the pack now clears epic bar #9.

A new importer module is added (a protected path) and the generated
`records.json` changes (42 features gain a `data.choices[]` array), so this thaw
note plus a freeze-manifest hash update are required.

## What changed

New importer pass `deriveFeatureChoices.ts` (post-emit, after class-chapter
enrichment), composed of one deriver per slice. Only structural anchors are
matched (ADR 0007); every option list / count / level is read from the records,
never invented; choices the SRD 5.1 pack cannot enumerate carry a named
`unsupported` marker rather than being dropped.

- **.9.2 subclass** — the base-class selector feature (found via the class's
  `subclassFeatureSlot` label) gains a `subclass` choice whose `from` is the
  parent class's subclass record keys. (12 features)
- **.9.3 spell/cantrip** — each spell-acquisition feature (Spellcasting, Pact
  Magic, Mystic Arcanum) gains cantrip/spell choices; `choose` is the initial
  count from the `spellcastingProgression` row, `from` names the class spell
  list. Restricted to the actual spell-acquisition features so no other feature
  at a caster level inherits a spurious choice. (8 features)
- **.9.4 ASI-vs-feat** — each Ability Score Improvement feature gains a
  structured ASI choice (distribute 2 points among the six abilities) plus a
  named marker for the optional feat variant (SRD 5.1 has only Grappler). (12
  features)
- **.9.5 Fighting Style / Metamagic / Invocations / terrain-enemy** — Favored
  Enemy and Natural Explorer parse their colon-delimited option lists into an
  enumerated `from`; Fighting Style / Metamagic / Eldritch Invocations carry the
  parsed pick `count` plus a named option pool (their labels are inline
  title-case prose / a separate section and cannot be enumerated without
  hard-coding option values). (7 features)
- **.9.6 Expertise / Channel Divinity** — Expertise is a structured
  skill-proficiency choice; Channel Divinity carries a named marker because its
  effects are granted (per-use selection, not a build choice). (5 features)

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` — new `deriveFeatureChoices.ts`;
      `emit.ts` invokes it; `types.ts` (`FeatureExtraction.choices?`) was added in .9.1.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` —
      regenerated through the importer; 42 feature records gain `data.choices`.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` — this thaw note + refreshed
      `freeze-manifest.json` `records.json` hash.
- [x] Other (outside the frozen tree): `srdPlayabilityAudit.ts` header (gate now
      GREEN); tests (`deriveFeatureChoices.test.ts`, `srdPlayabilityAudit.test.ts`,
      `rulesPack.test.ts`, `srdGeneratedPack.test.ts` partial-field baseline).

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes — regenerated through the importer (not hand-edited). Record count is
unchanged at 1812; no records added or removed. 42 `feature` records gain a
`data.choices[]` array. `manifest.json`, `source-inventory.json`,
`source-coverage.json`, and `source-region-ledger.json` are unchanged
(`verify:dnd5e-srd-pack` reports 0 added / 0 removed / 0 changed against the
regenerated output and all `source-*.json` matching exactly).

## Importer changed?

Yes: new `deriveFeatureChoices.ts` pass + a one-line `emit.ts` wire-up. No other
parser/extractor behavior changed.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack            # committed == importer output exactly (0 record changes)
npm run verify:dnd5e-srd-freeze -- --base origin/main
npm run check
npm run typecheck
npm test                                 # full suite green
```

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with the new
      `records.json` SHA-256
      (`a052ba5b80db8125e003442330463069bed2294879869ec6cb5767080b205e78`).

## Audit bundle path

Not regenerated. Targeted choice-modeling pass + audit-gate green + test coverage
only; full audit bundle regeneration remains eshyra-o9bd.14.

## Reviewer sign-off notes

Confirm: (1) `verify:dnd5e-srd-pack` shows the committed pack is exactly the
importer output (the choices are generated, not hand-edited); (2) the
`records.json` diff is limited to 42 feature records gaining a `data.choices`
array, no records added/removed, no prose change; (3) the `choice-coverage` gate
is zero and `auditSrdPlayability` has no findings; (4) each marker (ASI feat
side, Channel Divinity) is an honest out-of-scope statement, not a hidden gap;
(5) option pools given as a named `from` restriction (Fighting Style, Metamagic,
Invocations) are the cases whose labels are not machine-enumerable without
hard-coding option values.
