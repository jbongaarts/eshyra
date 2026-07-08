# Thaw Note — D&D SRD 5.1 Artifact

## Reason for thaw

Implement eshyra-o9bd.18.7.9 slice S2 by projecting the 17 reviewed
metadata-only spells with small deterministic clauses into typed mechanics.

## Expected file changes

- [ ] `packages/core/sources/dnd5e-srd-5.1/`
- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-inventory.json`
- [ ] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-coverage.json`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-region-ledger.json`
- [x] `docs/audits/dnd5e-srd-5.1-final/`
- [x] Other: audit-bundle disposition registry, schema validators, and focused tests

## Source PDF changed?

No.

## Pack records changed?

Yes. Seventeen spell records now carry S2 typed effects:
`spell:animal-messenger`, `spell:arcanists-magic-aura`, `spell:augury`,
`spell:commune`, `spell:control-weather`, `spell:create-food-and-water`,
`spell:create-or-destroy-water`, `spell:divination`, `spell:floating-disk`,
`spell:mage-hand`, `spell:message`, `spell:mirage-arcane`,
`spell:prestidigitation`, `spell:secret-chest`, `spell:sending`,
`spell:speak-with-dead`, and `spell:thaumaturgy`. No records were added or
removed.

PR #416 review corrections refined five emitted payloads without changing the
record set: Commune's repeat-casting chance now carries `secret: true`; Create
or Destroy Water records exposed-flame extinguishing; Mirage Arcane records
removed-piece disappearance; Prestidigitation and Thaumaturgy now carry
distinct concurrent-effect scopes.

A follow-up PR #416 review correction changed Mage Hand's 30-foot disappearance
boundary from `leashFeet` to `endsBeyondFeet` and made the two `?: true`
marker fields (`extinguishesExposedFlames`, `removedPiecesDisappear`) reject
`false` when present.

`source-region-ledger.json` also changed by one classification count
(`childOf` to direct `record` for an already-contained guard region) after the
ledger was tightened so derived `mechanics` strings cannot prove source-region
ownership or label-block coverage.

## Importer changed?

Yes. Spell mechanics projection now emits keyed S2 effects for stochastic
chance clauses, provisions/water creation, conjured utility objects, onset and
stage-shift procedure, messenger travel, communication barriers, difficult
terrain alteration, recast lockout, question/corpse limits, concurrent-effect
limits, and permanence after repeated casting.

Each keyed S2 projection now verifies the reviewed source clause shapes before
emitting constants, so a name-preserving description parsing regression fails
closed instead of retaining stale mechanics.

The source-region ledger now excludes `mechanics` from ownership and
label-fragment matching, matching its existing emission rule that derived
mechanics cannot prove source prose was emitted.

## Commands run

```
npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
npx vitest run packages/core/test/kindSchemasEffects.test.ts packages/core/test/srdMembershipCorrections.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
npx vitest run packages/core/test/importers/dnd5e-srd-5.1/mechanicsProjections.test.ts packages/core/test/kindSchemasEffects.test.ts packages/core/test/srdMembershipCorrections.test.ts packages/core/test/dnd5eSrdAuditBundle.test.ts
npm run verify:dnd5e-srd-pack
npm run verify:dnd5e-srd-freeze
npm run verify:worktree
npm run audit-bundle:dnd5e-srd
```

Focused tests, pack verification, freeze verification, full worktree
verification, and audit bundle generation passed.

## Freeze manifest updated?

- [x] `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json` updated

## Reviewer sign-off notes

Verify that the generated record diff is limited to the 17 S2 spell mechanics
projections, that those spell keys graduated out of
`ACCEPTED_METADATA_ONLY_SPELLS`, and that the source-ledger diff is limited to
the mechanics-ownership tightening described above. Also verify the PR #416
review corrections listed in "Pack records changed?" are present and that all
17 graduated spells have exact committed-pack assertions.

## Audit bundle path

`/home/jhbongaarts/src/eshyra/.worktrees/o9bd-18-7-9-s2/.audit-bundles/dnd5e-srd-audit-bundle.zip`
