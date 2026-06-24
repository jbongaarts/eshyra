# Eshyra Character Creation CLI Design

## Status

Working design for a planning PR. This document captures the CLI UX and architecture decisions from the character creation design discussion. It is intentionally more detailed than a bead description. Implementation beads may defer specific code-level choices, but should preserve the product and architecture direction here unless a later design review supersedes it.

Related open beads:

- `eshyra-4jiu` — Replace brittle character creation prompts with guided session-zero flow.
- `eshyra-x50w` — Migrate character creation off `SRD_CATALOG` and retire the legacy SRD catalog.

Those beads should be considered inputs, not constraints. The goal is an easy, complete character creation experience, not a narrow patch to the existing prompt loop.

## Product goal

Eshyra should provide an easy, complete, guided character creation flow for rules-pack-backed play.

A user should be able to create a playable level-1 D&D 5e SRD character from the CLI without:

- editing JSON;
- manually deriving hit points;
- knowing internal record IDs;
- recovering from brittle whole-draft validation errors;
- losing prior answers during revision;
- relying on the LLM as a rules source of truth.

Rules validation and derived mechanics must come from deterministic runtime rules data and the character creation engine. The LLM may later help with flavor, backstory, or coaching, but not with authoritative rules derivation.

## Core decision

Use one shared character creation CLI shell, with rule-pack-specific character creation recipes.

The user-facing command should remain stable:

```bash
eshyra character create
eshyra character create --rules dnd5e-srd-5.1
```

Inside an Eshyra play/session shell, the equivalent command can be:

```text
/character create
```

The shared CLI shell owns terminal behavior and navigation. The selected rules pack or system recipe owns step order, rules choices, validation, invalidation, and derived calculations.

This avoids prematurely building a separate CLI per rule system while also avoiding a false universal character creator that hard-codes D&D assumptions and later fights Pathfinder or other systems.

## Rule-pack recipe architecture

The D&D 5e SRD rules pack should be the first implementation recipe.

Future Pathfinder support should not be generated or designed in detail now. It is too expensive and speculative before a Pathfinder rules pack exists. However, the D&D implementation should not bake in assumptions that prevent another recipe later.

The design target is:

```text
Shared CLI shell
  - prompt rendering
  - numbered option pickers
  - search/list/filter
  - multi-select choices
  - numeric allocation UI
  - back/review/save/resume/quit
  - draft persistence
  - diagnostic display

Rule-pack character creation recipe
  - step order
  - terminology
  - available choices
  - validation rules
  - dependency invalidation rules
  - derived stat formulas
  - final character projection
```

Do not design a perfect cross-system character schema now. Use a minimal common draft envelope and let each recipe define typed selection accessors internally.

Suggested envelope:

```ts
interface CharacterCreationDraft {
  id: string;
  rulesPackId: string;
  recipeId: string;
  creationMode: string;
  createdAt: string;
  updatedAt: string;

  identity: {
    name?: string;
    concept?: string;
    description?: string;
    pronouns?: string;
  };

  selections: Record<string, unknown>;
  derived: Record<string, unknown>;
  diagnostics: CharacterCreationDiagnostic[];
}
```

D&D can then have a typed internal projection such as:

```ts
type Dnd5eCreationMode = "concept-first" | "ability-first";

interface Dnd5eCharacterDraftSelections {
  classId?: string;
  ancestryId?: string;
  backgroundId?: string;
  abilityScoreMethod?: "point-buy" | "standard-array" | "manual" | "rolled";
  baseAbilityScores?: Dnd5eAbilityScores;
  skillChoices?: string[];
  equipmentChoices?: string[];
  spellChoices?: string[];
}
```

## Initial mode choice

The first meaningful wizard branch should be:

```text
How do you want to create your character?

1. Concept-first — I know what I want to play
   Start with class, ancestry, and character idea, then assign ability scores to fit.

2. Ability-first — let the dice inspire me
   Generate or enter ability scores first, then choose a class and ancestry that fit.

>
```

These labels are canonical for the initial D&D 5e SRD character creation UX.

Both modes are important:

- Most modern players want to play a specific concept and assign/build scores to support it.
- Eshyra also has a nostalgia profile inspired by 80s-era RPGs and text adventures, where rolling or entering scores first and discovering the character is part of the appeal.

The engine must not encode “class must be selected before ability scores.” Instead:

- ability scores can exist before class;
- class can exist before ability scores;
- derived hit points wait for both class and Constitution;
- spell choices wait for class;
- class recommendations can use ability scores if present;
- ability-score recommendations can use class if present.

## Concept-first flow

Concept-first is the modern default path:

```text
identity / concept
→ class
→ ancestry
→ background
→ ability scores
→ class choices
→ spells / equipment
→ review
```

This path assumes the user has an intended character concept. It should provide class and ancestry choice first, then help the user assign scores that support that choice.

Class prompt example:

```text
Choose a class:
1. Barbarian
2. Bard
3. Cleric
4. Druid
5. Fighter
6. Monk
7. Paladin
8. Ranger
9. Rogue
10. Sorcerer
11. Warlock
12. Wizard

> fig

✓ Fighter selected.
Hit die: d10
Saving throws: Strength, Constitution
```

The user should be able to answer with a list number, display name, common alias, case-insensitive text, or unambiguous prefix/fuzzy match. The user should not need to type internal record IDs.

## Ability-first flow

Ability-first is the discovery/nostalgia path:

```text
identity / loose concept
→ ability score method
→ roll / enter / assign scores
→ class recommendations
→ class
→ ancestry
→ background
→ remaining class choices
→ spells / equipment
→ review
```

The important behavior is not merely putting ability scores earlier. The creator should help the user interpret what the scores suggest.

Example:

```text
Rolled ability scores:

16, 14, 13, 11, 9, 7

Suggested fits:
1. Fighter      STR or DEX 16, CON 14
2. Rogue        DEX 16, INT/CHA/WIS 14
3. Wizard       INT 16, CON/DEX 14
4. Cleric       WIS 16, CON/STR 14

Poor fits unless you want a challenge:
- Barbarian: possible, but CON may be low depending on assignment
- Paladin: wants both STR and CHA

Choose a class, assign scores manually, or reroll.
```

For the first implementation, recommendation quality can be simple and deterministic. It should be based on class quick-build priorities, class spellcasting ability, or explicit recipe metadata, not LLM judgment.

## Shared CLI commands

Every wizard step should support a small common command vocabulary:

```text
?              Show help for this step
list           Show valid options
search <term>  Search valid options
back           Return to previous step
review         Show current draft and missing fields
set <field>    Jump to a specific field
save           Save draft
quit           Exit after offering to save
```

Additional step-specific commands are allowed where useful, for example:

```text
str 12
dex 15
reset
done
reroll
assign
```

The CLI should keep interaction forgiving and recoverable. It should never force the user to restart character creation because one answer was wrong.

## Draft state preservation

Character creation should maintain a serializable draft object throughout the session.

Changing one field should preserve unrelated answers:

- changing name should not reset class, ancestry, scores, spells, or equipment;
- changing class should preserve identity and ability scores, but invalidate or revalidate class-specific choices, spell choices, HP, and equipment;
- changing ancestry should preserve base ability scores but recompute final scores and derived values;
- changing Constitution should recompute HP;
- changing spellcasting class should revalidate selected spells.

Drafts should be saveable and resumable.

Suggested local location:

```text
.eshyra/drafts/characters/<draft-id>.json
```

Example recovery message:

```text
Draft saved.

Resume with:
eshyra character resume Mara
```

## Ability score UX

Point buy should be the default score method in concept-first mode if point buy is already supported, because it gives predictable modern character creation.

Ability-first mode should support score generation or entry early. The engine should be able to represent at least:

- point buy;
- standard array;
- manual entry;
- rolled/imported scores.

The first implementation may stage these, but the model should distinguish the source of scores.

Point-buy validation should happen immediately, not after a whole draft is submitted.

Example:

```text
Ability scores — Point Buy

You have 27 points.

Score   Base  Ancestry  Final  Mod  Cost
STR     10    +0        10     +0   2
DEX     14    +2        16     +3   7
CON     14    +0        14     +2   7
INT     10    +0        10     +0   2
WIS     13    +1        14     +2   5
CHA     10    +0        10     +0   2

Points remaining: 2

Commands:
  str 12
  dex 15
  reset
  done

> con 16

✗ Point-buy scores must be between 8 and 15 before ancestry bonuses.
CON remains 14.
```

## Incremental, dependency-aware validation

Validation should be incremental, dependency-aware, and actionable.

Each diagnostic should include:

- field;
- severity;
- human-readable message;
- current value;
- allowed values or next action where useful;
- dependency information when blocked by missing prerequisites.

Examples:

```text
✗ Unknown class: "figher"
Did you mean "Fighter"?
```

```text
✗ Dexterity 17 is not valid for point buy.
Point-buy base scores must be between 8 and 15 before ancestry bonuses.
```

```text
⚠ Spell validation is waiting for class selection.
Choose a class before selecting spells.
```

Avoid validation cascades. If class is invalid, hit point validation should not produce a misleading derived-stat error.

Bad:

```text
level-1 hit point maximum must be -4
```

Good:

```text
Hit points will be calculated after class and Constitution are known.
```

## Derived values

The creator should compute derived fields automatically.

At minimum:

- level-1 hit point maximum;
- ability modifiers;
- proficiency bonus;
- spell save DC where applicable;
- spell attack modifier where applicable;
- passive Perception if skills are modeled;
- armor class once equipment is modeled;
- attack bonuses where practical.

Hit points should never be a required manual input in the default path.

Example:

```text
Hit points

Fighter hit die: d10
Constitution modifier: +2

Level-1 HP: 12

✓ Hit points computed automatically.
```

Manual HP override can exist later as an advanced option, but it should not be the standard path.

## Rules-pack integration

Character creation must resolve rules from the runtime generated rules pack.

The legacy hand-authored SRD catalog must not remain the source of validation truth.

Required replacement for `SRD_CATALOG` usage:

- class lookup uses generated class records;
- spell lookup uses generated spell records;
- ancestry lookup uses generated ancestry records;
- future background/equipment lookup uses generated records;
- display-name matching is centralized and shared;
- typed guards narrow generated `data: unknown` into recipe-specific data shapes.

Examples:

```ts
isGeneratedClassData(data): data is { hitDie: string; /* ... */ }
isGeneratedSpellData(data): data is { classes: string[]; level: number; /* ... */ }
```

Character creation should not import from `packages/core/src/rules/srd/`.

When the migration is complete:

- delete `packages/core/src/rules/srd/data.ts`;
- delete `packages/core/src/rules/srd/store.ts`;
- delete `packages/core/src/rules/srd/types.ts`;
- remove internal exports for `SRD_CATALOG`, `SRD_LICENSE`, `buildSrdIndex`, `lookupSrdRecord`, and related legacy types;
- delete or replace `srd.test.ts`;
- update `rules/README.md` to remove or rewrite the legacy catalog section.

## Mechanical completeness and data gaps

The generated SRD rules pack is necessary but may not be sufficient for a complete character creator.

A complete level-1 D&D character creator needs structured choice metadata, not just prose records:

- class skill choice sets;
- starting equipment choices;
- spellcasting choice counts;
- class spell lists by level;
- ancestry ability bonuses and traits;
- background proficiencies and equipment;
- languages;
- tool proficiencies;
- armor/weapon proficiencies;
- features granted at level 1;
- formulas or metadata for derived values.

If the current SRD import stores any of these only as prose, the character creator should not rely on brittle prose parsing inside the CLI. The `rules:dnd5e-srd-5.1` pack is a frozen, audited artifact, so the metadata is **not** added by re-running the importer or regenerating the pack. Instead, character creation may add a narrow, source-backed, deterministic **metadata overlay** for facts that are present in the SRD but not structured in the frozen generated pack. This overlay is consumer-side code, keyed to frozen record keys, and must not mutate or regenerate the frozen pack. If such overlays grow beyond character creation, revisit addon-pack / field-merge architecture in a separate ADR. The inventory of what is structured today versus filled by overlay lives in [`character-creation-level1-metadata-inventory.md`](./character-creation-level1-metadata-inventory.md).

The guided shell can ship before every optional polish feature exists, but it should honestly show missing required choices and avoid claiming completeness before all mechanically required choices can be represented.

## Internal components

Recommended components:

### `RulesPackCharacterResolver`

A thin adapter over the generated rules pack.

Responsibilities:

- load bundled SRD pack;
- index records by kind, id, display name, aliases;
- resolve class, ancestry, spell, background, equipment;
- expose typed data or useful diagnostics;
- hide generated-pack shape from the wizard.

### `CharacterCreationRecipe`

A rule-system-specific creation contract.

Responsibilities:

- define supported creation modes;
- define step order for each mode;
- define terminology and helper text;
- expose available choices;
- validate recipe-specific selections;
- compute recipe-specific derived values;
- finalize a draft into a character record.

Sketch:

```ts
interface CharacterCreationRecipe {
  readonly rulesPackId: string;
  readonly recipeId: string;
  readonly label: string;

  createInitialDraft(mode: string): CharacterCreationDraft;
  getModes(): CharacterCreationMode[];
  getSteps(draft: CharacterCreationDraft): CharacterCreationStep[];
  getCurrentChoices(draft: CharacterCreationDraft, stepId: string): CharacterCreationChoiceSet;
  applyAnswer(draft: CharacterCreationDraft, stepId: string, answer: ParsedAnswer): CharacterCreationDraftUpdate;
  validateDraft(draft: CharacterCreationDraft): CharacterCreationDiagnostic[];
  computeDerivedValues(draft: CharacterCreationDraft): Record<string, unknown>;
  canFinalize(draft: CharacterCreationDraft): FinalizationResult;
}
```

### `CharacterCreationDraft`

A serializable state object.

Contains:

- selected rule pack id;
- recipe id;
- creation mode;
- level;
- identity fields;
- selected ancestry;
- selected class;
- ability score method;
- base scores;
- selected background;
- selected proficiencies;
- selected equipment;
- selected spells;
- manually entered notes/flavor;
- invalidated or stale choices;
- derived values snapshot.

### `CharacterCreationEngine`

Pure domain logic.

Responsibilities:

- apply user changes to draft;
- preserve draft state;
- invalidate dependent choices;
- validate incrementally;
- compute derived values;
- determine next required choice;
- produce review summary;
- produce finishable character record.

This should be testable without terminal I/O.

### `CharacterCreationCli`

Terminal UX only.

Responsibilities:

- render prompts;
- parse simple commands;
- display options;
- call the engine;
- save/resume drafts;
- print diagnostics.

The CLI should not contain rules logic.

## Final review UX

The final step should show a compact sheet and missing-field checklist.

Example:

```text
Mara
Level 1 Wood Elf Fighter
Background: Acolyte

Ability Scores
STR 10 (+0)
DEX 16 (+3)
CON 14 (+2)
INT 10 (+0)
WIS 14 (+2)
CHA 10 (+0)

HP: 12
Proficiency Bonus: +2

Completed:
✓ Name
✓ Class
✓ Ancestry
✓ Ability scores
✓ Background
✓ Skills
✓ Equipment

Ready to create this character?

> yes
```

If incomplete:

```text
Not ready yet.

Missing required choices:
- Choose 2 Fighter skills
- Choose starting equipment
```

The wizard should provide direct navigation to fix missing fields.

## Implementation slices

Recommended sequence:

1. Add this design doc and, if desired, a later ADR for the durable architecture decisions.
2. Add generated rules-pack-backed character resolver and migrate existing validation off `SRD_CATALOG`.
3. Add D&D 5e SRD character creation recipe boundary.
4. Add serializable draft state and dependency-aware validation engine.
5. Add derived value computation, especially level-1 HP from class hit die and Constitution modifier.
6. Add concept-first guided CLI flow.
7. Add ability-first guided CLI flow.
8. Add score entry/allocation UX with immediate point-buy validation and score-source modeling.
9. Add generated-pack-backed spell/class/ancestry/background/equipment resolution.
10. Add save/resume/review/back/help navigation.
11. Add structured choice metadata needed for complete level-1 character creation.
12. Add transcript-style tests for representative CLI flows and recovery cases.

## Acceptance criteria for v1

The finished v1 should satisfy:

- User can create a valid level-1 SRD character through the CLI without editing JSON.
- User starts by choosing either:
  - `Concept-first — I know what I want to play`; or
  - `Ability-first — let the dice inspire me`.
- User can type display names like `Fighter`, `Wood Elf`, and spell names without internal IDs.
- User can revise previous answers without losing unrelated draft state.
- Point-buy validation happens immediately.
- Ability-first mode supports generating or entering scores before choosing class.
- Hit points are computed automatically.
- HP validation waits until class and Constitution are known.
- Spell validation uses generated spell records from the runtime rules pack.
- Class validation uses generated class records from the runtime rules pack.
- Ancestry validation uses generated ancestry records from the runtime rules pack.
- No character creation code imports the legacy SRD catalog.
- Legacy SRD catalog is deleted once unused.
- Final review clearly shows missing required choices.
- Error messages tell the user what to do next.
- Tests cover pure validation, dependency behavior, and representative CLI transcripts.

## Non-goals for the first implementation

- Full PHB content beyond SRD.
- Pathfinder implementation.
- Multiclassing.
- Higher-level character creation.
- Level-up flow.
- Homebrew editing UI.
- LLM-driven rules interpretation.
- Perfect final character sheet formatting.
- A universal cross-system character schema beyond a minimal draft envelope.

## ADR candidate

This may eventually deserve an ADR, but the first PR can start as a design doc.

Potential ADR decisions:

- Eshyra uses one shared character creation CLI shell with rule-pack-specific creation recipes.
- D&D 5e SRD is the first recipe.
- Recipe implementations use generated runtime rules packs as truth.
- Legacy `SRD_CATALOG` is retired.
- The D&D recipe supports both concept-first and ability-first creation modes.
