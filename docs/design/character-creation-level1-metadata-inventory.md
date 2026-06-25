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
| Ancestry ability-score increases | **structured (overlay)** | source-cited overlay `srdAncestryAbilityScoreIncreases.ts` keyed by frozen ancestry key (fixed `{ability,bonus}` plus the Half-Elf choice); applied in `deriveLevel1Values` | **eshyra-b69j.12.1 (done)** |
| Spellcasting ability (INT/WIS/CHA) | **structured (overlay)** | source-cited overlay `srdClassSpellcasting.ts` keyed by frozen class key; gated to level-1 casters via the progression row; drives spell save DC / attack in `deriveLevel1Values` | **eshyra-b69j.12.2 (done)** |
| Prepared-caster spell counts / Wizard spellbook size | **structured (overlay)** | same overlay: `preparation` (known/prepared) + `spellbookStartingSpells` (Wizard = 6); prepared count = ability mod + level via `level1PreparedSpellCount` | **eshyra-b69j.12.2 (done)** |
| Starting equipment option groups | **structured (overlay)** | source-cited overlay `srdClassStartingEquipment.ts` keyed by frozen class key: choose-one groups (labelled options) + fixed grants; each entry's `sourceText` deep-equals the pack's `startingEquipment.entries` | **eshyra-b69j.12.3 (done)** |
| Languages (ancestry + background) | **structured (overlay)** | source-cited overlay `srdLanguages.ts` keyed by frozen ancestry/background key: fixed granted languages + free-choice `choose` counts; choices draw from the SRD standard languages. `sourceText` is a faithful prefix of the ancestry trait / exact background `languages` | **eshyra-b69j.12.4 (done)** |

## What this means for the engine today

`enumerateLevel1RequiredChoices` reads a resolved class (and optional ancestry /
background) and returns one descriptor per required choice, each tagged
`structured` or `unstructured`:

- **Martial example — Fighter:** skill choice (structured, choose 2); starting
  equipment groups (structured, four choose-one groups via overlay, 12.3). With
  ancestry/background: a fixed ancestry ability increase and fixed ancestry
  languages are applied automatically (overlays, 12.1/12.4) and are not prompts;
  only a Half-Elf-style ability choice and a free language choice (Acolyte's
  "two of your choice", structured via 12.4) remain as prompts.
- **Prepared caster — Wizard:** skills (structured); cantrips (structured,
  choose 3); starting spellbook (structured, choose 6 via overlay, 12.2); the
  spellcasting ability is an auto-resolved overlay fact (12.2), not a prompt;
  equipment (structured, three choose-one groups; the spellbook is a fixed
  grant, 12.3).
- **Known caster — Bard:** skills, tool choice, cantrips, **and** known spells
  all structured (Bard's `spellsKnown` is on the progression row); the
  spellcasting ability is resolved from the overlay (12.2); equipment groups are
  structured (12.3).

The engine therefore enumerates the **pending required choices** for both a
martial and a spellcasting class today, marking every prose-only datum with the
bead that will make it structured — satisfying the design rule without parsing
any prose.

## Deferred work

The genuinely prose-only required data are tracked as children of
eshyra-b69j.12:

- **eshyra-b69j.12.1** — *done.* Structured ancestry ability-score increases via
  the source-cited overlay; `deriveLevel1Values` now applies ancestry bonuses to
  final scores (and the HP/saves derived from them), closing the b69j.6 deferral.
- **eshyra-b69j.12.2** — *done.* Structured per-class spellcasting ability and
  prepared-spell counts via the source-cited overlay (`srdClassSpellcasting.ts`);
  `deriveLevel1Values` now computes spell save DC / spell attack, and
  `enumerateLevel1RequiredChoices` structures the level-1 spell-selection count
  (known `spellsKnown`, Wizard spellbook, or prepared ability mod + level),
  closing the remaining b69j.6 deferral.
- **eshyra-b69j.12.3** — *done.* Structured starting-equipment option groups via
  the source-cited overlay (`srdClassStartingEquipment.ts`): each SRD class's
  choose-one groups become structured equipment choices and fixed grants are
  auto-applied; `enumerateLevel1RequiredChoices` emits them. Feeds the equipment
  flow (eshyra-b69j.13).
- **eshyra-b69j.12.4** — *done.* Structured language grants and choices via the
  source-cited overlay (`srdLanguages.ts`): fixed ancestry/background languages
  are auto-granted and free-choice picks (Half-Elf/Human, Acolyte) are surfaced
  as structured `choose`/`from` choices drawn from the SRD standard languages.
  `enumerateLevel1RequiredChoices` emits them.

With 12.1–12.4 all landed, every level-1 required choice an SRD class +
ancestry + background implies is now structured from source-cited overlays or
the generated pack — no prose parsing remains. The guided equipment/proficiency
flow (eshyra-b69j.13) can consume these directly.

## How the gaps get filled — a consumer-side overlay, not pack regeneration

The `rules:dnd5e-srd-5.1` pack is a **frozen, hash-pinned, signed-off** artifact
(`docs/audits/dnd5e-srd-5.1-final/`; freeze guard via
`npm run verify:dnd5e-srd-freeze`). The prose-only facts above must therefore
**not** be added by re-running the importer/extractor or regenerating the pack —
that would require thawing and re-auditing a closed artifact.

Instead, the design rule's sanctioned alternative applies — a **deterministic
derived metadata layer** — under this governing policy:

> For the frozen D&D 5e SRD pack, character creation may add a narrow,
> source-backed, deterministic **metadata overlay** for facts that are present
> in the SRD but not structured in the frozen generated pack. This overlay is
> **consumer-side code, keyed to frozen record keys, and must not mutate or
> regenerate the frozen pack.** If such overlays grow beyond character creation,
> revisit addon-pack / field-merge architecture in a separate ADR.

So each child bead is fulfilled by authored, SRD-cited constant tables keyed by
the frozen record keys (e.g. `ancestry:elf → [{ ability: 'dexterity', bonus: 2 }]`,
`class:wizard → spellcastingAbility: 'intelligence'`), living in the
character-creation code next to `requiredChoices.ts` / `rulesPackResolver.ts`.
This is ordinary consumer-side work — **not** importer-fix-protocol work, and it
touches no importer, extractor, or generated-pack files.
