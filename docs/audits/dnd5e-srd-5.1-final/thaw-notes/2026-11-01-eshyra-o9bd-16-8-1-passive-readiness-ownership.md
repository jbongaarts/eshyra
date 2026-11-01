# Thaw note: hook-free passive magic-item effects are engine-pending, not green

Bead: `eshyra-o9bd.16.8.1` (audit finding L3-F1 from `eshyra-o9bd.16.3`;
parent `eshyra-o9bd.16.8`)

## Reason for thaw

Independent audit L3-F1 showed that `magicItemPassiveEffects.ts` emits
representation bindings with no execution hooks and that
`magicItemCompiler.ts` marked a clause green whenever `missingHooks` was empty.
For a hook-free clause that proves only that no hook was declared. Probes on
the unmodified pack showed the Ring of Regeneration healing nothing on
`advance_time` (SRD p.237) and the Periapt of Wound Closure not stabilizing a
dying PC at `begin_turn` (SRD p.232), both green (ADR 0020 bar 4).

## Change

Captain design: green means an engine owner actually consumes the typed effect
at runtime. `magicItemCompiler.ts` adds the reviewed registry
`MAGIC_ITEM_PASSIVE_EFFECT_RUNTIME_CONSUMERS` (effect kind -> consumer
citation). A hook-free `effects` clause stays green only if its kind is listed.
Any other becomes engine-pending and names its missing owner as a declared and
missing hook: F6 `passive item effect runtime consumer: <kind>` for
`regeneration`, `stabilize`, `healingMultiplier`, `hitPointMaximumIncrease`;
F8 for every other kind.

Consumer review: every effect kind among the 92 affected clauses was searched
in `packages/core/src`. The registry is EMPTY, honestly. The only readers of
`mechanics.effects[].kind` are feature/option proficiency grants
(`character/rulesPackResolver.ts` `parseProficiencyGrants`, feature records,
never worn items), the `start_effect` duration lookup by effect id
(`orchestrator/toolStartEffect.ts`, reads `duration`, not kind) and
summoning/entityGrant paths. No derived-stat code reads a worn or attuned
item's AC, save, ability, speed, sense, movement or healing effect. No runtime
healing or stabilization was implemented. Structural/reference clauses
(structuredField, economies, operations, entityGrant, stateMachine) and the two
hooked effect clauses (Elemental Gem castSpell, Staff of Swarming Insects
triggeredEffect) are unchanged. `validateMagicItemClausesAndClassify` gained a
`passiveEffectConsumers` test seam defaulting to the registry.

## Generated change

Pack regenerated with `npm run import:dnd5e-srd -- --out
packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`; no records added or
removed, only `executionReadiness` of magic items changes. 92 clauses move
green -> engine-pending (list below). Pins, old -> new:

- magic-item clause readiness counts (`srdGeneratedPack.test.ts`): green 333 ->
  241, engine-pending 677 -> 769; adjudicated-by-design 358, design-blocked 1
  and total clauses 1369 unchanged.
- `docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}`
  (regenerated through `packages/core/scripts/inventory-semi-structured-boundary.ts`,
  not hand-edited): `engineHooks[]` 1537 -> 1629, `missingHooks[]` 1231 ->
  1323, `missingEngines[]` 677 -> 769.
- `magicItemLegacyCapabilityBacklog.test.ts` (backlog is derived from
  declared engine hooks): candidate count 798 -> 890 (the 92 clauses now
  declare their missing owner hook); identity fingerprint
  `dc9e17141a25...ba990` -> `a82540e183bd...8e8fe`; no existing identity
  changed.
- `magicItemCompiler.test.ts` "resolves concrete effect bindings" asserted a
  speedSet clause green with no consumer. Its intent is binding resolution, so
  it now supplies a registered consumer through the seam; assertions are
  unchanged.

## Expected file changes

- [x] `packages/core/scripts/importers/dnd5e-srd-5.1/magicItemCompiler.ts`
- [x] `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
- [x] `docs/inventories/o9bd-18-8-8-semi-structured-boundary.{json,md}`
- [x] tests: `magicItemPassiveEffectReadiness.test.ts` (new),
  `magicItemCompiler.test.ts`, `srdGeneratedPack.test.ts`,
  `magicItemLegacyCapabilityBacklog.test.ts`

## Evidence

`magicItemPassiveEffectReadiness.test.ts`: a generalized classifier test (a
hook-free effect outside the registry is never green), declared/missing
hook/family agreement, a positive control (an injected consumer keeps its kind
green while other kinds stay pending), structural clauses not turned pending,
exact shipped-pack witnesses for the ring (p.237) and periapt (p.232,
stabilize and healingMultiplier), and a hooked-effect control (Elemental Gem
stays green). The freeze manifest and freeze guard were not touched.

## Clauses changed (green -> engine-pending)

- magic-item:amulet-of-health/m2-amulet-of-health-constitution-score-set: green -> engine-pending [F8] abilityScoreSet
- magic-item:belt-of-dwarvenkind/m2-belt-of-dwarvenkind-constitution-score-increase: green -> engine-pending [F8] abilityScoreIncrease
- magic-item:belt-of-dwarvenkind/m2-belt-of-dwarvenkind-proficiency-speak-read-and-write-dwarvish: green -> engine-pending [F8] proficiency
- magic-item:belt-of-dwarvenkind/m3-belt-of-dwarvenkind-sense-darkvision: green -> engine-pending [F8] sense
- magic-item:belt-of-giant-strength/m2-belt-of-giant-strength-strength-score-set: green -> engine-pending [F8] abilityScoreSet
- magic-item:berserker-axe/m2-berserker-axe-hit-point-maximum-increase: green -> engine-pending [F6] hitPointMaximumIncrease
- magic-item:boots-of-speed/m3-boots-of-speed-speed-multiplier: green -> engine-pending [F8] speedMultiplier
- magic-item:boots-of-striding-and-springing/m3-boots-of-striding-and-springing-ignore-movement-restriction: green -> engine-pending [F8] ignoreMovementRestriction
- magic-item:boots-of-striding-and-springing/m3-boots-of-striding-and-springing-jump-distance-multiplier: green -> engine-pending [F8] jumpDistanceMultiplier
- magic-item:boots-of-striding-and-springing/m3-boots-of-striding-and-springing-walk-speed: green -> engine-pending [F8] speedSet
- magic-item:boots-of-the-winterlands/m3-boots-of-the-winterlands-ignore-difficult-terrain: green -> engine-pending [F8] ignoreDifficultTerrain
- magic-item:boots-of-the-winterlands/m3-boots-of-the-winterlands-temperature-tolerance: green -> engine-pending [F8] temperatureTolerance
- magic-item:bracers-of-archery/m2-bracers-of-archery-proficiency-longbow-and-shortbow: green -> engine-pending [F8] proficiency
- magic-item:broom-of-flying/m3-broom-of-flying-fly-speed: green -> engine-pending [F8] speedSet
- magic-item:carpet-of-flying/m3-carpet-of-flying-fly-speed: green -> engine-pending [F8] speedSet
- magic-item:carpet-of-flying/m3-carpet-of-flying-speed-multiplier: green -> engine-pending [F8] speedMultiplier
- magic-item:cloak-of-arachnida/m3-cloak-of-arachnida-climb-anywhere: green -> engine-pending [F8] climbAnywhere
- magic-item:cloak-of-arachnida/m3-cloak-of-arachnida-climb-speed: green -> engine-pending [F8] speedSet
- magic-item:cloak-of-arachnida/m3-cloak-of-arachnida-immunity: green -> engine-pending [F8] immunity
- magic-item:cloak-of-arachnida/m3-cloak-of-arachnida-movement-cost-multiplier: green -> engine-pending [F8] movementCostMultiplier
- magic-item:cloak-of-the-bat/m3-cloak-of-the-bat-fly-speed: green -> engine-pending [F8] speedSet
- magic-item:cloak-of-the-manta-ray/m3-cloak-of-the-manta-ray-breathe-water: green -> engine-pending [F8] breathes
- magic-item:cloak-of-the-manta-ray/m3-cloak-of-the-manta-ray-swim-speed: green -> engine-pending [F8] speedSet
- magic-item:crystal-ball/variant:crystal-ball-of-true-seeing/m3-crystal-ball-crystal-ball-of-true-seeing-sense-truesight: green -> engine-pending [F8] sense
- magic-item:demon-armor/m2-demon-armor-proficiency-understand-and-speak-abyssal: green -> engine-pending [F8] proficiency
- magic-item:dragon-scale-mail/m3-dragon-scale-mail-sense-nearest-dragon-of-matching-type: green -> engine-pending [F8] sense
- magic-item:elven-chain/m2-elven-chain-proficiency-this-armor: green -> engine-pending [F8] proficiency
- magic-item:gauntlets-of-ogre-power/m2-gauntlets-of-ogre-power-strength-score-set: green -> engine-pending [F8] abilityScoreSet
- magic-item:gem-of-seeing/m3-gem-of-seeing-sense-truesight: green -> engine-pending [F8] sense
- magic-item:gloves-of-swimming-and-climbing/m3-gloves-of-swimming-and-climbing-climb-without-extra-movement: green -> engine-pending [F8] climbWithoutExtraMovement
- magic-item:gloves-of-swimming-and-climbing/m3-gloves-of-swimming-and-climbing-swim-without-extra-movement: green -> engine-pending [F8] swimWithoutExtraMovement
- magic-item:goggles-of-night/m3-goggles-of-night-sense-darkvision: green -> engine-pending [F8] sense
- magic-item:hammer-of-thunderbolts/m2-hammer-of-thunderbolts-strength-score-increase: green -> engine-pending [F8] abilityScoreIncrease
- magic-item:headband-of-intellect/m2-headband-of-intellect-intelligence-score-set: green -> engine-pending [F8] abilityScoreSet
- magic-item:helm-of-telepathy/m3-helm-of-telepathy-telepathic-relay: green -> engine-pending [F8] telepathicRelay
- magic-item:horseshoes-of-a-zephyr/m3-horseshoes-of-a-zephyr-hover: green -> engine-pending [F8] hover
- magic-item:horseshoes-of-a-zephyr/m3-horseshoes-of-a-zephyr-ignore-difficult-terrain: green -> engine-pending [F8] ignoreDifficultTerrain
- magic-item:horseshoes-of-a-zephyr/m3-horseshoes-of-a-zephyr-immunity: green -> engine-pending [F8] immunity
- magic-item:horseshoes-of-a-zephyr/m3-horseshoes-of-a-zephyr-leaves-no-tracks: green -> engine-pending [F8] leavesNoTracks
- magic-item:horseshoes-of-a-zephyr/m3-horseshoes-of-a-zephyr-walk-on-liquids: green -> engine-pending [F8] walkOnLiquids
- magic-item:horseshoes-of-speed/m3-horseshoes-of-speed-speed-bonus: green -> engine-pending [F8] speedBonus
- magic-item:ioun-stone/variant:agility/m2-ioun-stone-agility-dexterity-score-increase: green -> engine-pending [F8] abilityScoreIncrease
- magic-item:ioun-stone/variant:fortitude/m2-ioun-stone-fortitude-constitution-score-increase: green -> engine-pending [F8] abilityScoreIncrease
- magic-item:ioun-stone/variant:insight/m2-ioun-stone-insight-wisdom-score-increase: green -> engine-pending [F8] abilityScoreIncrease
- magic-item:ioun-stone/variant:intellect/m2-ioun-stone-intellect-intelligence-score-increase: green -> engine-pending [F8] abilityScoreIncrease
- magic-item:ioun-stone/variant:leadership/m2-ioun-stone-leadership-charisma-score-increase: green -> engine-pending [F8] abilityScoreIncrease
- magic-item:ioun-stone/variant:mastery/m2-ioun-stone-mastery-proficiency-bonus-increase: green -> engine-pending [F8] proficiencyBonusIncrease
- magic-item:ioun-stone/variant:regeneration/m2-ioun-stone-regeneration-regeneration: green -> engine-pending [F6] regeneration
- magic-item:ioun-stone/variant:strength/m2-ioun-stone-strength-strength-score-increase: green -> engine-pending [F8] abilityScoreIncrease
- magic-item:ioun-stone/variant:sustenance/m3-ioun-stone-sustenance-sustenance: green -> engine-pending [F8] sustenance
- magic-item:lantern-of-revealing/m3-lantern-of-revealing-bright-light: green -> engine-pending [F8] light
- magic-item:lantern-of-revealing/m3-lantern-of-revealing-dim-light: green -> engine-pending [F8] light
- magic-item:lantern-of-revealing/m3-lantern-of-revealing-sense-reveal-invisible-in-bright-light: green -> engine-pending [F8] sense
- magic-item:necklace-of-adaptation/m3-necklace-of-adaptation-breathe-any-environment: green -> engine-pending [F8] breathes
- magic-item:periapt-of-wound-closure/m2-periapt-of-wound-closure-healing-multiplier: green -> engine-pending [F6] healingMultiplier
- magic-item:periapt-of-wound-closure/m2-periapt-of-wound-closure-stabilize: green -> engine-pending [F6] stabilize
- magic-item:potion-of-climbing/m3-potion-of-climbing-climb-speed: green -> engine-pending [F8] speedSet
- magic-item:potion-of-flying/m3-potion-of-flying-fly-speed: green -> engine-pending [F8] speedSet
- magic-item:potion-of-giant-strength/m2-potion-of-giant-strength-strength-score-set: green -> engine-pending [F8] abilityScoreSet
- magic-item:potion-of-water-breathing/m3-potion-of-water-breathing-breathe-water: green -> engine-pending [F8] breathes
- magic-item:ring-of-elemental-command/variant:ring-of-air-elemental-command/m2-ring-of-elemental-command-ring-of-air-elemental-command-proficiency-speak-and-understand-auran: green -> engine-pending [F8] proficiency
- magic-item:ring-of-elemental-command/variant:ring-of-air-elemental-command/m3-ring-of-elemental-command-ring-of-air-elemental-command-fly-speed: green -> engine-pending [F8] speedSet
- magic-item:ring-of-elemental-command/variant:ring-of-air-elemental-command/m3-ring-of-elemental-command-ring-of-air-elemental-command-slow-fall: green -> engine-pending [F8] slowFall
- magic-item:ring-of-elemental-command/variant:ring-of-earth-elemental-command/m2-ring-of-elemental-command-ring-of-earth-elemental-command-proficiency-speak-and-understand-terran: green -> engine-pending [F8] proficiency
- magic-item:ring-of-elemental-command/variant:ring-of-earth-elemental-command/m3-ring-of-elemental-command-ring-of-earth-elemental-command-earth-glide: green -> engine-pending [F8] earthGlide
- magic-item:ring-of-elemental-command/variant:ring-of-earth-elemental-command/m3-ring-of-elemental-command-ring-of-earth-elemental-command-ignore-difficult-terrain: green -> engine-pending [F8] ignoreDifficultTerrain
- magic-item:ring-of-elemental-command/variant:ring-of-fire-elemental-command/m2-ring-of-elemental-command-ring-of-fire-elemental-command-proficiency-speak-and-understand-ignan: green -> engine-pending [F8] proficiency
- magic-item:ring-of-elemental-command/variant:ring-of-water-elemental-command/m2-ring-of-elemental-command-ring-of-water-elemental-command-proficiency-speak-and-understand-aquan: green -> engine-pending [F8] proficiency
- magic-item:ring-of-elemental-command/variant:ring-of-water-elemental-command/m3-ring-of-elemental-command-ring-of-water-elemental-command-breathe-water: green -> engine-pending [F8] breathes
- magic-item:ring-of-elemental-command/variant:ring-of-water-elemental-command/m3-ring-of-elemental-command-ring-of-water-elemental-command-swim-speed: green -> engine-pending [F8] speedSet
- magic-item:ring-of-elemental-command/variant:ring-of-water-elemental-command/m3-ring-of-elemental-command-ring-of-water-elemental-command-walk-on-liquids: green -> engine-pending [F8] walkOnLiquids
- magic-item:ring-of-feather-falling/m3-ring-of-feather-falling-slow-fall: green -> engine-pending [F8] slowFall
- magic-item:ring-of-free-action/m3-ring-of-free-action-ignore-difficult-terrain: green -> engine-pending [F8] ignoreDifficultTerrain
- magic-item:ring-of-regeneration/m2-ring-of-regeneration-regeneration: green -> engine-pending [F6] regeneration
- magic-item:ring-of-swimming/m3-ring-of-swimming-swim-speed: green -> engine-pending [F8] speedSet
- magic-item:ring-of-warmth/m3-ring-of-warmth-temperature-tolerance: green -> engine-pending [F8] temperatureTolerance
- magic-item:ring-of-water-walking/m3-ring-of-water-walking-walk-on-liquids: green -> engine-pending [F8] walkOnLiquids
- magic-item:ring-of-x-ray-vision/m3-ring-of-x-ray-vision-sense-x-ray-vision: green -> engine-pending [F8] sense
- magic-item:robe-of-eyes/m3-robe-of-eyes-sense-all-around-vision: green -> engine-pending [F8] sense
- magic-item:robe-of-eyes/m3-robe-of-eyes-sense-darkvision: green -> engine-pending [F8] sense
- magic-item:robe-of-eyes/m3-robe-of-eyes-sense-see-invisible-and-ethereal: green -> engine-pending [F8] sense
- magic-item:robe-of-the-archmagi/m2-robe-of-the-archmagi-ac-formula: green -> engine-pending [F8] acFormula
- magic-item:rod-of-alertness/m3-rod-of-alertness-sense-invisible-hostile-location: green -> engine-pending [F8] sense
- magic-item:rod-of-lordly-might/m3-rod-of-lordly-might-sense-magnetic-north-and-depth: green -> engine-pending [F8] sense
- magic-item:slippers-of-spider-climbing/m3-slippers-of-spider-climbing-climb-anywhere: green -> engine-pending [F8] climbAnywhere
- magic-item:slippers-of-spider-climbing/m3-slippers-of-spider-climbing-climb-speed: green -> engine-pending [F8] speedSet
- magic-item:sun-blade/m2-sun-blade-proficiency-the-sun-blade: green -> engine-pending [F8] proficiency
- magic-item:wand-of-enemy-detection/m3-wand-of-enemy-detection-sense-nearest-hostile-direction: green -> engine-pending [F8] sense
- magic-item:wand-of-secrets/m3-wand-of-secrets-sense-nearest-secret-door-or-trap: green -> engine-pending [F8] sense
- magic-item:winged-boots/m3-winged-boots-fly-speed: green -> engine-pending [F8] speedSet
- magic-item:winged-boots/m3-winged-boots-slow-fall: green -> engine-pending [F8] slowFall
- magic-item:wings-of-flying/m3-wings-of-flying-fly-speed: green -> engine-pending [F8] speedSet

## Verification

- `npm run verify:dnd5e-srd-pack`: committed pack matches importer output exactly.
