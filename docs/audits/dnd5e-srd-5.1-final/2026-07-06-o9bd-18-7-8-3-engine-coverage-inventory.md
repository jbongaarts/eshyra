# eshyra-o9bd.18.7.8.3 — Engine coverage inventory for deterministic rule procedures

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.8.3`.

Maps **every** PROC rule from the corrected 18.7.8 classification
(`2026-07-06-o9bd-18-7-8-rule-classification.md`, 175 rows incl. the 23
promoted during the integrity pass) to exactly one implementation-coverage
status, per rule — no family-level blanket claims. This inventory seeds
`ENGINE_PROCEDURE_COVERAGE` in the 18.7.8.1 disposition-layer design and
makes repeating the 335-record semantic audit unnecessary.

## Method

Survey of the actual deterministic runtime in `@eshyra/core`
(2026-07-06): the orchestrator tool surface
(`packages/core/src/orchestrator/` — seeded `dice.ts`/`toolRoll.ts` with
roll categories, `toolAdjustHp` clamping to `[0, hp_max]`, condition
add/remove, encounter lifecycle/combatant tools, clock), character math
(`abilities.ts`, `derivedValues.ts`, `levelUpEngine.ts`, `currency.ts`),
and rules utilities (`advancementTable.ts`). Architecture context: per ADR
0001, deterministic math/dice/canon writes live in tools while rulings go
through the DM model — so "unimplemented" below means *no code-owned
procedure*; the behavior is currently DM-model adjudication over primitive
tools, which is the honest readiness gap this inventory exists to expose.

Status vocabulary (18.7.8.1 design §2): `implemented` (runtime owner +
test evidence), `partial` (owner + named missing semantics),
`unimplemented`, `design-blocked` (explicit design owner).

For `implemented` and `partial` rows, runtime/evidence cells use explicit
`path:` labels for exact repo-relative filesystem paths and separate
`symbol/detail:` labels for functions, categories, or explanatory ownership.

## Census

**implemented 0 · partial 19 · unimplemented 148 · design-blocked 8 = 175.**

Headline gaps worth naming: the dice grammar supports only `NdM+K` — no
advantage/disadvantage or keep/drop, so even the most fundamental d20
mechanic is model-enforced; death-save counters, temp-HP, and rest
procedures have no state owner; the entire multiclassing suite (8 rules)
is design-blocked on a scope decision, since `levelUpEngine.ts` is
single-class by design. The previous four `implemented` rows were tightened
to `partial` after a bounded source-semantics recheck found missing
multi-clause ownership.

## Inventory (all 175 PROC rules, by key)

| key | status | runtime owner | evidence | detail |
|---|---|---|---|---|
| a-clear-path-to-the-target | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| abilities | unimplemented | — | — | 4d6-drop-lowest generation for sentient items; note the dice grammar also lacks keep/drop modifiers |
| ability-checks | partial | path: packages/core/src/orchestrator/toolRoll.ts; path: packages/core/src/orchestrator/playerVisibleRollLedger.ts; symbol/detail: ability_check category, seeded dice, visible ledger | path: packages/core/test/tools.test.ts | dice + categorized ledger code-owned; DC comparison and outcome are DM-adjudicated |
| ability-scores-and-modifiers | partial | path: packages/core/src/character/abilities.ts; path: packages/core/src/character/derivedValues.ts; symbol/detail: abilityModifier, deriveLevel1Values abilityModifiers | path: packages/core/test/derivedValues.test.ts; path: packages/core/test/characterCreation.test.ts | modifier formula code-owned, and PC creation validates current player-character free-entry bounds; missing generic creature ability-score range / modifier-range enforcement for the full SRD 1-30 table contract |
| activating-an-item | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| advantage-and-disadvantage | unimplemented | — | — | concrete named gap: dice grammar (packages/core/src/orchestrator/dice.ts, NdM+K only) has no advantage/disadvantage (2d20 keep-high/low) support; the model must roll twice and pick, unenforced |
| ammunition | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| areas-of-effect | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| armor-guidance | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| armor-weapon-and-tool-proficiencies | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| attack | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| attack-rolls | partial | path: packages/core/src/orchestrator/toolRoll.ts; symbol/detail: attack category, seeded dice | path: packages/core/test/tools.test.ts | dice code-owned; hit determination vs AC is DM-adjudicated |
| attunement | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| backgrounds-equipment | partial | path: packages/core/src/character/srdStartingEquipmentGrants.ts; path: packages/core/src/character/srdEquipmentPacks.ts; symbol/detail: package grants | path: packages/core/test/srdPlayabilityAudit.test.ts | equipment-package granting code-owned; the coin-purchase alternative and the package-XOR-coin gate are not implemented (no coin path found in creation choices) |
| backgrounds-proficiencies | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| being-prone | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| beyond-1st-level | partial | path: packages/core/src/character/levelUpEngine.ts; symbol/detail: fixed-average HP, PB, features, spellcasting capacity per pack progression | path: packages/core/test/levelUpEngine.test.ts | rolled-HP alternative not wired through seeded dice (deliberate deferral); ASI-cap-20 enforcement at improvement time not verified |
| blindsight | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| bonus-action | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| bonus-actions | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| breaking-up-your-move | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| burrow | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| casting-a-spell-at-a-higher-level | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| casting-a-spell-attack-rolls | partial | path: packages/core/src/character/derivedValues.ts; symbol/detail: spellAttackModifier | path: packages/core/test/derivedValues.test.ts | bonus formula code-owned; the within-5-ft ranged-disadvantage clause is DM-adjudicated |
| casting-a-spell-range | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| casting-a-spell-saving-throws | partial | path: packages/core/src/character/derivedValues.ts; symbol/detail: spellSaveDc = 8 + mod + PB | path: packages/core/test/derivedValues.test.ts | base formula code-owned at character-derivation time; source also includes special modifiers, which are not modeled or applied by the derived-value runtime |
| casting-in-armor | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| channel-divinity | design-blocked | — | — | multiclassing is out of current engine scope: levelUpEngine.ts is single-class by design (no multiclass path exists); design owner: eshyra-o9bd.18.7.8 parent pending a multiclass decision bead |
| charges | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| class-features | design-blocked | — | — | multiclassing is out of current engine scope: levelUpEngine.ts is single-class by design (no multiclass path exists); design owner: eshyra-o9bd.18.7.8 parent pending a multiclass decision bead |
| climb | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| climbing-swimming-and-crawling | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| coinage | partial | path: packages/core/src/character/currency.ts; symbol/detail: denominations, convertCharacterCurrency | path: packages/core/test/characterCurrency.test.ts | exchange rates code-owned; coin weight (50/lb) not modeled |
| combat-step-by-step | partial | path: packages/core/src/orchestrator/toolStartEncounter.ts; symbol/detail: encounter lifecycle | path: packages/core/test/tools.test.ts | encounter lifecycle state code-owned; the 5-step procedure itself DM-adjudicated |
| combining-magical-effects | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| command-word | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| complex-traps | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| concentration | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| cone | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| conflict | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| constitution-hit-points | partial | path: packages/core/src/character/levelUpEngine.ts; symbol/detail: per-level Con modifier applied to each HP step | path: packages/core/test/levelUpEngine.test.ts | retroactive hp_max recalculation when the Con modifier changes is missing |
| consumables | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| contests | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| controlling-a-mount | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| cover | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| crafting | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| critical-hits | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| cube | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| customizing-a-background | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| cylinder | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| damage-resistance-and-vulnerability | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| damage-rolls | partial | path: packages/core/src/orchestrator/dice.ts; symbol/detail: parse/roll NdM+K under seeded RNG | path: packages/core/test/tools.test.ts | dice math code-owned; add-ability-mod, never-negative, roll-once-for-multi-target procedure DM-adjudicated |
| darkvision | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| dash | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| death-saving-throws | partial | path: packages/core/src/orchestrator/toolRoll.ts; symbol/detail: death_save category | path: packages/core/test/tools.test.ts | death-save rolls categorized in the ledger; success/failure counters, nat-1/nat-20 effects, and damage-at-0 escalation are not tracked in code |
| detecting-and-disabling-a-trap | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| dexterity-attack-rolls-and-damage | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| dexterity-initiative | partial | path: packages/core/src/orchestrator/toolRoll.ts; path: packages/core/src/orchestrator/toolStartEncounter.ts; path: packages/core/src/orchestrator/toolUpdateCombatant.ts; symbol/detail: initiative category and encounter combatant state | path: packages/core/test/tools.test.ts | initiative rolls + combatant tracking code-owned; ordering/tie procedure DM-adjudicated |
| disengage | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| dodge | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| downtime-activities | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| equipment | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| expenses-lifestyle-expenses | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| experience-points | partial | path: packages/core/src/rules/advancementTable.ts; symbol/detail: levelForXp, xpThresholdForLevel, ADVANCEMENT_TABLE_REF | path: packages/core/test/advancementTable.test.ts | XP-to-level thresholds are code-owned from the structured table; missing runtime ownership for the multiclass total-character-level rule because the current level-up engine is single-class and multiclassing is design-blocked |
| extra-attack | design-blocked | — | — | multiclassing is out of current engine scope: levelUpEngine.ts is single-class by design (no multiclass path exists); design owner: eshyra-o9bd.18.7.8 parent pending a multiclass decision bead |
| falling | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| falling-unconscious | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| feats | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| fly | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| flying-movement | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| food | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| food-and-water | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| gaining-inspiration | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| grapple-rules-for-monsters | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| grappling | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| group-checks | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| half-dragon-template | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| healing | partial | path: packages/core/src/state/domainMutations.ts; path: packages/core/src/orchestrator/toolAdjustHp.ts; symbol/detail: adjustHp / adjust_hp adds HP delta and clamps to [0, hp_max] | path: packages/core/test/domainMutations.test.ts; path: packages/core/test/tools.test.ts | HP addition and maximum cap are enforced on HP writes; missing dead-creature eligibility semantics: a dead creature cannot regain HP until magic restores it to life |
| help | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| hide | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| hiding | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| hit-points | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| hit-points-and-hit-dice | design-blocked | — | — | multiclassing is out of current engine scope: levelUpEngine.ts is single-class by design (no multiclass path exists); design owner: eshyra-o9bd.18.7.8 parent pending a multiclass decision bead |
| improvised-weapons | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| innate-spellcasting | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| instant-death | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| interacting-with-objects | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| jumping | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| knocking-a-creature-out | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| lair-actions | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| legendary-actions | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| legendary-creatures | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| lifting-and-carrying | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| limited-usage | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| line | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| long-rest | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| longer-casting-times | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| madness-effects | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| making-an-attack | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| material-m | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| melee-attacks | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| modifiers-to-the-roll | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| mounted-combat | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| mounting-and-dismounting | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| mounts-and-vehicles | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| movement-and-position | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| movement-and-position-difficult-terrain | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| moving-around-other-creatures | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| moving-between-attacks | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| multiattack | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| multiclassing | design-blocked | — | — | multiclassing is out of current engine scope: levelUpEngine.ts is single-class by design (no multiclass path exists); design owner: eshyra-o9bd.18.7.8 parent pending a multiclass decision bead |
| multiclassing-proficiency-bonus | design-blocked | — | — | multiclassing is out of current engine scope: levelUpEngine.ts is single-class by design (no multiclass path exists); design owner: eshyra-o9bd.18.7.8 parent pending a multiclass decision bead |
| objects | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| opportunity-attacks | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| other-activity-on-your-turn | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| paired-items | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| passive-checks | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| poisons | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| practicing-a-profession | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| proficiency-bonus | partial | path: packages/core/src/character/derivedValues.ts; path: packages/core/src/character/levelUpEngine.ts; symbol/detail: LEVEL_1_PROFICIENCY_BONUS and per-level PB from pack | path: packages/core/test/derivedValues.test.ts; path: packages/core/test/levelUpEngine.test.ts | PB values code-owned; apply-once / multiply-once / x0-without-proficiency roll semantics are DM-adjudicated |
| range | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| ranged-attacks-in-close-combat | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| reactions | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| ready | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| recuperating | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| researching | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| rituals | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| rolling-1-or-20 | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| saving-throws | partial | path: packages/core/src/orchestrator/toolRoll.ts; path: packages/core/src/character/derivedValues.ts; symbol/detail: saving_throw category and save modifiers | path: packages/core/test/tools.test.ts; path: packages/core/test/derivedValues.test.ts | dice + save modifiers code-owned; DC comparison DM-adjudicated |
| search | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| self-sufficiency | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| selling-treasure | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| short-rest | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| shoving-a-creature | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| silvered-weapons | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| somatic-s | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| special-traits-spellcasting | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| special-weapons | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| speed | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| speed-difficult-terrain | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| spell-slots | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| spellcasting | design-blocked | — | — | multiclassing is out of current engine scope: levelUpEngine.ts is single-class by design (no multiclass path exists); design owner: eshyra-o9bd.18.7.8 parent pending a multiclass decision bead |
| spells | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| sphere | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| squeezing-into-a-smaller-space | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| stabilizing-a-creature | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| strength-attack-rolls-and-damage | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| suffocating | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| surprise | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| swim | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| targeting-yourself | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| telepathy | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| temporary-hit-points | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| the-order-of-combat | partial | path: packages/core/src/orchestrator/toolStartEncounter.ts; path: packages/core/src/orchestrator/toolCloseCombatInstance.ts; path: packages/core/src/orchestrator/turnLoop.ts; symbol/detail: encounter round/turn state | path: packages/core/test/tools.test.ts | round/turn state tracked; 6-second-round cycle procedure DM-adjudicated |
| the-order-of-combat-initiative | partial | path: packages/core/src/orchestrator/toolStartEncounter.ts; path: packages/core/src/orchestrator/toolUpdateCombatant.ts; symbol/detail: encounter combatant initiative state | path: packages/core/test/tools.test.ts | same as dexterity-initiative: state tracked, group-roll/tie rules DM-adjudicated |
| training | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| tremorsense | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| truesight | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| two-weapon-fighting | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| unarmored-defense | design-blocked | — | — | multiclassing is out of current engine scope: levelUpEngine.ts is single-class by design (no multiclass path exists); design owner: eshyra-o9bd.18.7.8 parent pending a multiclass decision bead |
| underwater-combat | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| unseen-attackers-and-targets | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| use-an-object | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| using-different-speeds | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| using-inspiration | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| variant-encumbrance | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| variant-skills-with-different-abilities | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| verbal-v | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| vision-and-light | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| water | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| weapon-proficiency | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| weapon-properties | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| wizard-your-spellbook | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| working-together | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |
| your-turn | unimplemented | — | — | no code-owned procedure; adjudicated by the DM model over the primitive tool surface (seeded roll / adjust_hp / conditions / encounter state) |

## Derived implementation slices (recommendation, not yet beaded)

1. **Dice-grammar extension** (unblocks many partials): advantage/
   disadvantage and keep/drop notation in `dice.ts` + `roll` tool, so
   adv/dis and 4d6-drop-lowest become code-owned. Small, high leverage.
2. **Death & dying state owner**: death-save counters, stabilization,
   instant-death threshold, temp-HP pool on the character projection.
3. **Rest engine**: short/long-rest procedure (HD spending, reset rules)
   — touches resources, HP, and the limited-usage reset procedure.
4. **Coverage-register seeding** (Codex): transcribe this inventory into
   `ENGINE_PROCEDURE_COVERAGE` per the 18.7.8.1 design.

Slices 1–3 are engine work outside the importer/audit scope of 18.7.8 and
should be beaded under an engine epic after review; slice 4 belongs to
18.7.8.1's implementation.
