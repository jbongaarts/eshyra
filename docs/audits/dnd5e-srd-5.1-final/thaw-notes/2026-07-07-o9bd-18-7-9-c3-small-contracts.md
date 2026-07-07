# Thaw Note — D&D SRD 5.1 Artifact

## Reason for thaw

Implement eshyra-o9bd.18.7.9 slice C3 by projecting deterministic
telepathy, communication, location-knowledge, path-memory, and sleep-exception
creature/spell semantics into typed mechanics.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-*.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/`
- [x] Other: audit-bundle disposition registry and focused tests

## Source PDF changed?

No.

## Pack records changed?

Yes. Ten creature records now carry C3 typed effects on the reviewed entries:
aboleth, dryad, ettin, homunculus, hydra, invisible stalker, minotaur, otyugh,
pseudodragon, and sahuagin. Two spell records now carry typed C3 effects:
`spell:speak-with-animals` and `spell:telepathic-bond`. No records were added
or removed. A post-review correction kept the same record set but refined four
payload shapes: homunculus now separates two-way telepathy from directional
sense sharing, aboleth now uses `triggeredEffect { trigger, result, condition
}`, and otyugh/pseudodragon no longer put communicated content in the
directional `conveys` field. A second post-review correction restored those
two Limited Telepathy content limits as direction-neutral `telepathy.content`
values.

## Importer changed?

Yes. Creature-entry and spell mechanics projection now recognize the reviewed
C3 SRD sentence shapes and suppress duplicate bare trigger markers when the
typed C3 effect owns the trigger/condition. `telepathy` is limited to
communication boundaries plus direction-neutral content limits; directional
sense sharing and triggered information learning are separate effects.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npx vitest run packages/core/test/kindSchemasEffects.test.ts packages/core/test/srdMembershipCorrections.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
npm run verify:dnd5e-srd-pack
npm run audit-bundle:dnd5e-srd
```

Focused tests and pack verification passed. `audit-bundle:dnd5e-srd` completed
and produced a clean bundle; its internal `npm run check` step ran before the
format pass and reported formatting drift, which was corrected afterward.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated

## Audit bundle path

`/home/jhbongaarts/src/eshyra/.worktrees/o9bd-18-7-9-c3/.audit-bundles/dnd5e-srd-audit-bundle.zip`

## Reviewer sign-off notes

Verify that the generated diff is limited to the 10 C3 creature-entry
mechanics projections and the 2 C3 spell projections, and that those refs
graduated out of `CREATURE_ENTRY_REVIEWED_DISPOSITIONS` /
`ACCEPTED_METADATA_ONLY_SPELLS`.
