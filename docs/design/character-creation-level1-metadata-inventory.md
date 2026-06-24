# Level-1 character-creation metadata inventory (eshyra-b69j.12)

This inventory records which structured SRD metadata a complete level-1 D&D 5e
character creation needs, and — for the bundled generated pack
`rules__dnd5e-srd-5.1` — whether each datum is already **structured** (machine
readable), **partial**, or **prose-only / missing**.

Design rule (`docs/design/character-creation-cli.md`): the CLI must not parse
prose to discover core mechanical choices. Where a required choice is prose-only
today, the gap is tracked in a follow-up bead rather than worked around in the
CLI. The character-creation engine surfaces the same structured/unstructured
split at runtime via `enumerateLevel1RequiredChoices`
(`packages/core/src/character/requiredChoices.ts`).

Record counts in the bundled pack (for context): 12 `class`, 13 `ancestry`,
**1** `background` (Acolyte only), 12 `subclass`, 183 `feature`, 319 `spell`,
218 `equipment`.

## Inventory

| Required datum | Status | Where in the pack | Follow-up |
| --- | --- | --- | --- |
| Class hit die | **structured** | `class.data.hitDie` | — |
| Class primary abilities | **structured** | `class.data.primaryAbilities` | — |
| Class saving-throw proficiencies | **structured** | `class.data.savingThrowProficiencies` | — |
| Class armor/weapon proficiencies | **structured** | `class.data.armorProficiencies`, `weaponProficiencies` | — |
| Class fixed tool proficiencies | **structured** | `class.data.toolProficiencies` | — |
| Class skill choice sets | **structured** | `class.data.skillChoices[]` = `{text, choose, from[]}` | — |
| Class tool proficiency choices | **structured** | `class.data.toolProficiencyChoices[]` (where the class grants one) | — |
| Level-1 features granted | **structured** | `class.data.progression[level==1].features[]` (`{name, ref}`) | — |
| Spellcasting cantrips/known/slots at L1 | **structured** | `class.data.progression[level==1].spellcasting` = `{cantripsKnown, spellsKnown?, slots}` | — |
| Class spell list by level | **structured (derivable)** | filter `spell.data.classes` ∋ class **and** `spell.data.level` (0 = cantrip); validated in eshyra-b69j.11 | — |
| Background skill proficiencies | **structured** | `background.data.skillProficiencies[]` | — |
| Background tool proficiencies | **structured** | `background.data.toolProficiencies[]` | — |
| Ancestry size / speed | **structured** | `ancestry.data.size`, `ancestry.data.speed` | — |
| **Ancestry ability-score increases** | **prose-only** | `ancestry.data.traits[]` "Ability Score Increase" `text` (e.g. "Your Dexterity score increases by 2.") | **eshyra-b69j.12.1** |
| **Spellcasting ability (INT/WIS/CHA)** | **prose-only** | inside the `feature:<class>:spellcasting` description | **eshyra-b69j.12.2** |
| **Prepared-caster spell counts / Wizard spellbook size** | **prose-only** | spellcasting feature prose (formula: ability mod + level); Wizard's "six 1st-level spells" in spellbook | **eshyra-b69j.12.2** |
| **Starting equipment option groups** | **partial** | `class.data.startingEquipment.entries[]` are prose lines ("(a) … or (b) …"), not parsed option groups; fixed grants are mixed in | **eshyra-b69j.12.3** |
| **Languages (ancestry + background)** | **prose-only** | `background.data.languages` ("Two of your choice"); ancestry `traits[]` "Languages" `text` | **eshyra-b69j.12.4** |

## What this means for the engine today

`enumerateLevel1RequiredChoices` reads a resolved class (and optional ancestry /
background) and returns one descriptor per required choice, each tagged
`structured` or `unstructured`:

- **Martial example — Fighter:** skill choice (structured, choose 2); starting
  equipment options (unstructured → 12.3). With ancestry/background: ancestry
  ability increase (12.1) and language choice (12.4).
- **Prepared caster — Wizard:** skills (structured); cantrips (structured,
  choose 3); level-1 spells and spellcasting ability (unstructured → 12.2);
  equipment (12.3).
- **Known caster — Bard:** skills, tool choice, cantrips, **and** known spells
  all structured (Bard's `spellsKnown` is on the progression row); only the
  spellcasting ability (12.2) and equipment (12.3) remain unstructured.

The engine therefore enumerates the **pending required choices** for both a
martial and a spellcasting class today, marking every prose-only datum with the
bead that will make it structured — satisfying the design rule without parsing
any prose.

## Deferred work

The genuinely prose-only required data are tracked as children of
eshyra-b69j.12:

- **eshyra-b69j.12.1** — structured ancestry ability-score increases (unblocks
  ancestry bonuses in `deriveLevel1Values`; b69j.6 deferred final scores here).
- **eshyra-b69j.12.2** — structured per-class spellcasting ability and
  prepared-spell counts (unblocks spell save DC / spell attack and prepared
  counts).
- **eshyra-b69j.12.3** — structured starting-equipment option groups (feeds the
  equipment flow, eshyra-b69j.13).
- **eshyra-b69j.12.4** — structured language grants and choices on ancestry and
  background.

Each requires importer/extractor/schema changes and pack regeneration; per
`docs/importer-fix-protocol.md` those are kept separate from this modeling/
inventory slice, which adds only consumer-side code (resolver fields + the
enumeration) and touches no importer or generated-pack files.
