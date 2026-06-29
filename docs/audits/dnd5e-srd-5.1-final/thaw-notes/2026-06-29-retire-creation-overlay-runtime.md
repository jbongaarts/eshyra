# Thaw Note - Retire character-creation overlay runtime usage

Bead: `eshyra-o9bd.15`

## Scope

Removed character-creation and level-up runtime dependence on the source-cited
SRD character-creation overlay constants. Runtime code now reads deterministic
facts from generated pack metadata:

- ancestry `abilityScoreIncreases`
- ancestry/background `languages`
- class `spellcastingAbility`
- class `spellPreparation`
- class `startingEquipment.entries`

The source-cited constants remain as regression oracles only. Their tests now
assert that generated pack fields match the SRD-derived oracle values.

## Generated Pack Diff

None. This bead did not touch importer output or hand-edit generated records.

## Verification

- `npm run check`
- `npm run typecheck`
- `npm run test -- packages/core/test/srdAncestryAbilityScoreIncreases.test.ts packages/core/test/srdClassSpellcasting.test.ts packages/core/test/srdClassStartingEquipment.test.ts packages/core/test/srdLanguages.test.ts packages/core/test/requiredChoices.test.ts packages/core/test/finalizeCharacter.test.ts packages/core/test/characterDraftDerived.test.ts packages/core/test/levelUpEngine.test.ts`
- `npm run verify:worktree`
