# Thaw Note - feature option catalogs (eshyra-ngcj.2)

**Date:** 2026-06-29
**Beads:** eshyra-ngcj.2, eshyra-ngcj.2.1, eshyra-ngcj.2.2, eshyra-ngcj.2.3
**Epic:** eshyra-ngcj (close D&D SRD gameplay-modeling gaps from the 2026-06-29 audit)
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

Class and subclass feature option menus were still present only as prose in
the generated SRD pack. This thaw adds source-backed structured option
catalogs and spell-choice filters so deterministic character creation and
level-up code can enumerate, validate, and persist selected feature options by
stable id without parsing prose.

The generated `records.json` changes and the importer feature-choice derivation
code changes are protected by the freeze guard, so this note and a refreshed
`freeze-manifest.json` hash are required.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` - feature-choice
      derivation now emits inline option catalogs and structured spell filters.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` -
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/` - this thaw note plus refreshed
      `freeze-manifest.json` `records.json` hash.
- [x] Other: feature-choice schema/validator/audit updates and tests.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes - regenerated through the importer, not hand-edited. Record count is
unchanged at 1812; no records were added or removed. The generated diff adds
structured `feature.data.choices[]` catalogs/filters for:

- Warlock Pact Boons and Eldritch Invocations, including invocation
  prerequisites and contingent Pact of the Tome / Book of Ancient Secrets spell
  filters.
- Fighting Style, Champion Additional Fighting Style, Metamagic, and Hunter
  subclass option features.
- Magical Secrets, Additional Magical Secrets, Spell Mastery, and Signature
  Spells spell filters.

`manifest.json`, `source-inventory.json`, `source-coverage.json`, and
`source-region-ledger.json` are unchanged; `verify:dnd5e-srd-pack` reports the
committed pack matches regenerated output exactly.

## Importer changed?

Yes. `deriveFeatureChoices.ts` now derives inline option catalogs from existing
feature prose headings, preserves each option's SRD text and source label, and
captures printed prerequisites where present. It also emits structured spell
filters for feature spell selections. `types.ts` mirrors the expanded choice
shape.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:dnd5e-srd-pack
npm run audit:rules-pack -- packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npm run verify:worktree
```

Relevant results:

- `verify:dnd5e-srd-pack`: committed pack matches importer output exactly.
- Source PDF SHA-256:
  `2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.
- Importer counts: 319 spells, 296 creatures, 21 NPCs, 12 classes, 12
  subclasses, 183 features, 15 conditions, 1 feats, 0 hazards, 8 traps, 10
  actions, 335 rules, 108 tables, 218 equipment, 240 magic items, 13
  ancestries, 1 backgrounds.
- Rules-pack audit: suspicious records 0.
- `verify:worktree`: passed.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with the new
      `records.json` SHA-256
      (`c99d7b9ee7c1ad88caecf05a77eb52f7ccc66d265ee6983fcd8ea2a2bf1d32d5`).

## Audit bundle path

Not regenerated. This is a targeted gameplay-modeling thaw; the generated pack
was verified directly against importer output and rules-pack audit.

## Reviewer sign-off notes

Confirm that the `records.json` diff is limited to generated feature choice
catalog/filter data, that option text and prerequisites are source-backed, and
that no source PDF or source inventory artifacts changed.
