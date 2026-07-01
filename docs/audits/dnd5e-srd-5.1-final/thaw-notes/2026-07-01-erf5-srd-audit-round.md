# Thaw Note - eshyra-erf5 SRD Audit Round

**Date:** 2026-07-01
**Beads:** eshyra-erf5.1, eshyra-5c7f (partial), eshyra-erf5.3 (+.3.1/.3.2/.3.3),
eshyra-txxa, eshyra-lpk9, eshyra-erf5.2, eshyra-erf5.4, eshyra-rtgi
**Epic:** eshyra-erf5
**Governing thaw:** `2026-06-28-reaudit-playable-bar-thaw.md`

## Reason for thaw

This thaw closes 7 of the 8 originally-filed children of the 2026-06-30/07-01
SRD audit round (epic eshyra-erf5), plus the pre-existing `eshyra-5c7f` and
`eshyra-rtgi` findings folded into the same epic:

- Restored the p.78 skill-to-ability mapping
  (`rule:skills.data.skillsByAbility`) and fixed the coverage-heading collision
  bug that let it go unnoticed.
- Sidebar callouts (17 records + 2 incidental) now have correct
  source-region-ledger entries.
- Weapons tagged with `weaponCategory`/`weaponRange`; focus/symbol/instrument/tool
  equipment groups tagged with `equipmentGroup`; added a resolution audit
  proving every starting-equipment filter and class proficiency phrase
  resolves to concrete candidates.
- Gameplay-readiness now counts nested creature action/reaction/legendary-action
  mechanics (314/317).
- Multi-page provenance locators added for 345 records.
- New independent class spell-list parity gate, wired as a fail-closed
  import-time check.
- Enlarge/Reduce's fake "extra"/"less" damage types remodeled as
  `weaponDamageModifiers`; canonical SRD damage-type validation added.
- Structured `armorClass` added for all 13 armor/shield records.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/` -
      `creationFacts.ts`, `emit.ts`, `enrichProvenance.ts` (new),
      `index.ts`, `mechanicsProjections.ts`, `parseEquipment.ts`,
      `parseSpells.ts`, `sourceInventoryCoverage.ts`, `sourceRegionLedger.ts`,
      `spellListParityAudit.ts` (new), `types.ts`.
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` -
      regenerated through the importer.
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json` -
      `source-coverage.json` and `source-region-ledger.json` regenerated;
      `source-inventory.json` unchanged.
- [x] `packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts` -
      gameplay-readiness report now counts nested creature mechanics.
- [x] `docs/audits/dnd5e-srd-5.1-final/` - this thaw note and refreshed
      `freeze-manifest.json` hashes.
- [x] Other: `packages/core/src/character/srdCreationChoices.ts`,
      `packages/core/src/internal.ts`, `packages/core/src/rules/kindSchemas.ts`,
      `packages/core/src/rules/srdEquipmentResolutionAudit.ts` (new); matching
      importer/generated-pack/audit-bundle test coverage for all of the above.

## Source PDF changed?

No. The source PDF remains SHA-256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.

## Pack records changed?

Yes, regenerated through the importer (not hand-edited). Record counts are
unchanged: total 1812, `countsByKind` matches `record-counts.md` exactly.
Changed records are additive/isolated tagging, provenance, and modeling fixes
scoped to the beads above (skill-to-ability rule data, sidebar-callout ledger
entries, weapon/equipment group tags, creature mechanics projections,
multi-page provenance locators, Enlarge/Reduce damage modifiers, Potion of
Healing capitalization documentation, and armor `armorClass` structures).
`source-inventory.json` content is unchanged; `source-coverage.json` and
`source-region-ledger.json` changed to reflect the sidebar-callout and
provenance-locator fixes.

## Importer changed?

Yes. Extractor/parser/emit behavior changed across the files listed above to:
add source-region-ledger entries for sidebar callouts, tag weapon/equipment
groups, emit multi-page provenance locators, add a spell-list parity audit,
and count nested creature mechanics in the gameplay-readiness report. No
change re-interprets or "fixes" source PDF text; all changes are structural/
modeling additions per `docs/importer-fix-protocol.md`.

## Commands run

```
npm run verify:worktree
npm run verify:dnd5e-srd-pack
```

`verify:worktree` (format, check, typecheck, full test suite): clean, 3292
passed / 19 skipped. `verify:dnd5e-srd-pack` reports the committed pack
matches freshly regenerated importer output exactly (0 records added/removed/
changed; all three source-coverage artifacts match).

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated with:
  - `records.json` SHA-256
    `fc9a5fbb5ef3f73dfbd6ba6af47011cb0e46a644734e82d624697b8424c7a7ae`
  - `source-coverage.json` SHA-256
    `592ed617a23342ba8c466fd78a46b7f5c49955d9149b9fb16d140cd437d79de2`
  - `source-region-ledger.json` SHA-256
    `1e3f7d9a842c85df7e71bde4dea3905812097ea4982b3fae9e47a6ee92959770`
  - all other pinned hashes unchanged.

## Audit bundle path

Not regenerated. Follow-up scope intentionally deferred to `eshyra-erf5.5`
(Adventuring Gear / deity-table continuation pages) and `eshyra-erf5.6`
(pre-existing `findRepresentingRecord` tie-break bug) is tracked separately
and out of scope for this thaw.

## Reviewer sign-off notes

Confirm the `records.json` diff is limited to the beads listed above (no
unrelated record content changed), that `source-coverage.json` and
`source-region-ledger.json` diffs are additive/isolated to the sidebar-callout
and provenance-locator fixes, and that `npm run verify:dnd5e-srd-pack` still
reports an exact match between the committed pack and regenerated importer
output.
