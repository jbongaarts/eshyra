# D&D 5e SRD 5.1 Importer

Deterministic extractor for the D&D 5th Edition System Reference Document 5.1
(CC-BY-4.0). Reads a vendored PDF, extracts canonical `RulesRecord`s, and
writes a `manifest.json` + `records.json` pair compatible with
`loadRulesPackFromDirectory`.

Tracked work: beads `loreweaver-0m9.5` (remaining unimplemented kinds are
tracked as child issues).

## Scope today

| Record kind | Status |
|-------------|--------|
| `spell`     | Implemented. Stat-block parser extracts name, level, school, ritual flag, casting time, range, components (incl. material text), duration, description, and "At Higher Levels" upcast text. Class lists are cross-referenced from the class-spell-list section. The seven spells with embedded tables carry optional `data.tableRefs` links to the nine emitted table records (Control Weather owns three); spell prose remains source-preserving and still contains the flattened table text. |
| `action`    | Implemented. Parser extracts the 10 standard SRD combat actions (Attack, Cast a Spell, Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an Object) from the combat-actions section into `kind=action` records with `data.description`. |
| `creature`  | Implemented (317 records: 296 monsters + 21 NPCs). Stat-block parser extracts every creature from the Monsters section AND Appendix MM-A into `kind=creature` records satisfying the `dnd5e-srd` creature kindSchema: `size`, `type` (subtype parenthetical preserved; validation applied to the bare type word), `alignment`, `armorClass`, `hitPoints`, `speed` (mode→feet map; the unlabeled base speed keyed as `walk`), `challengeRating` (bare fraction/integer), and `abilityScores`, plus the optional keyed defensive/sense fields the SRD prints between the ability-score row and the Challenge line — `savingThrows`, `skills`, `damageVulnerabilities`, `damageResistances`, `damageImmunities`, `conditionImmunities`, `senses`, `languages` — each preserved verbatim and emitted only when its source label is present (eshyra-ez6v / eshyra-4a7.5). Those values are reassembled by label-position slicing over the bounded ability-row→Challenge region, so a value that wraps across extracted lines (Deva's Damage Resistances) or a next-field label the PDF column flow merged onto the previous line (Wereboar's `… silvered weapons Senses …`) is captured correctly; the singular `Damage Resistance` a conditional block prints (Archmage's stoneskin) is accepted as an alias. After the keyed fields, the narrative body is parsed into named `{name, text}` entries (eshyra-yevt / eshyra-4a7.5): an implicit `traits` run, the header-delimited `actions` and `reactions` sections, and `legendaryActions` (`{ description?, entries }` — the intro paragraph plus options). Each is optional and emitted only when the creature prints that section; entry names keep their usage parenthetical ("Enslave (3/Day)", "Fire Breath (Recharge 5-6)") and bodies preserve attack bonuses, damage expressions, save DCs, and spell lists verbatim (a Spellcasting/Innate Spellcasting trait carries its full spell list as text). Splitting mirrors the `parseAncestries` "Name. body" splitter with a sentence-completeness guard (so a wrapped sentence beginning with a capitalized phrase like "Constitution saving throw. …" is not mis-promoted) plus a spell-list guard (so the trait after a spell list still opens). Structural heading lines — SRD creature-group headings ("Angels", "Dragons"), running page headers ("Monsters (B)"), and leaked creature names — are dropped from the body by font height (>= ~12pt, vs. <= 10.8pt for stat-block content). The two boxed `Variant: …` sidebars the SRD prints in the creature chapters (Diseased Giant Rats p378, Insect Swarms p391) end the preceding creature's narrative (so their bold-lead-in lines do not pollute it — e.g. the Giant Rat's duplicate Bite) and are attached as a `variants` `{name, text}` array on the creature each one modifies via a reviewed caption→target map (Giant Rat, Swarm of Insects); a new unmapped `Variant:` caption fails closed (eshyra-70xr). SRD 5.1 prints no per-creature Lair Actions / Regional Effects (those terms appear only in the general Legendary Creatures rules on p260); the Half-Dragon Template and dragon reference tables are owned by `eshyra-4a7.10`. A stat block is confirmed by its size/type/alignment meta line plus the AC/HP/ability-table signature. **Appendix MM-B: Nonplayer Characters** (the 21 generic NPC stat blocks — Acolyte, Bandit Captain, Berserker, …) is imported too (loreweaver-bn0): an NPC stat block has the identical shape and is equally encounter-usable, so it emits under the same `creature` kind via the same parser, distinguished by a `data.category: 'npc'` discriminator. Monster records carry no `category` field — its absence means "monster" — so the 296 monster records stay byte-identical and the two coverage baselines never mix. Section anchors: `monsters` (`startHeading: /^Monsters$/`, `requireEndHeading: true`), `miscellaneousCreatures` (Appendix MM-A, best-effort), and `nonplayerCharacters` (Appendix MM-B, best-effort start, runs to EOF). `runImporter` fails closed via two independent coverage guards: an empty Monsters parse always throws, the real import (CLI + `verify:dnd5e-srd-pack`) validates monster names against the exact `EXPECTED_SRD_5_1_CREATURE_NAMES` set (296) and NPC names against `EXPECTED_SRD_5_1_NPC_NAMES` (21) — any missing, renamed, or spuriously-extracted entry throws by name (`CreatureCoverageError` / `NpcCoverageError`) and writes nothing (loreweaver-0m9.5.14, loreweaver-bn0). Both sets are reviewed, checked-in regression baselines (the monster candidate is generated via `npm run generate:dnd5e-srd-creature-names`, reviewed against the SRD source, then committed), not runtime-derived expected data. Fixture pipelines that exercise a reduced Monsters section omit the exact sets and rely on the empty-result guard or the coarse `minCreatureCount` floor; a fixture without an MM-B appendix degrades to zero NPCs. |
| `class`     | Implemented (base classes only). Parser keys off each base class's "Hit Dice: 1dN per <class> level" signature line and reads the labeled proficiency / saving-throw lines from its Class Features block into `kind=class` records satisfying the `dnd5e-srd` class kindSchema (`hitDie`, `armorProficiencies`, `weaponProficiencies`, `savingThrowProficiencies`, best-effort `primaryAbilities`). Options/progression modeling (eshyra-4a7.6): `parseClasses` also parses the `Tools:` line (fixed grants in `toolProficiencies`; "of your choice" grants preserved verbatim in `toolProficiencyChoices`), the `Skills:` line (`skillChoices` with parsed `choose`/`from`, including the Bard's "Choose any three"), and the `Equipment` block (`startingEquipment` with per-option `entries`). The Druid's "(druids will not wear armor or use shields made of metal)" parenthetical is normalized off the `shields` token into `proficiencyNotes`. `enrichClassChapterRecords` (in `classProgression.ts`) then adds `progressionTableRef` (`table:the-<class>`), the class's `features` reference list, and `progression`: one entry per level with `proficiencyBonus`, parsed `features` (`{ name, ref?, detail? }`, repeated-use parentheticals kept as `detail`), `resources` (Rages, Sneak Attack, Ki Points, Sorcery Points, …), and `spellcasting` (cantrips/spells known, Pact Magic columns, and the per-level spell-slot map) — derived from the emitted progression `table` rows, never re-parsed from JSON. Section anchor: `classes` (`startHeading: /^Classes$/`, `endHeading: /^Using Ability Scores$/`, `requireEndHeading: true`). `runImporter` fails closed via a class-coverage guard (`MIN_EXPECTED_SRD_5_1_CLASSES`). `primaryAbilities` is filled from the Multiclassing "Prerequisites" listing (see `parseMulticlassing.ts`) because the Class Features block prints no key-ability line (ADR 0007); this enrichment is best-effort, so a class absent from that listing keeps an empty array and a PDF without a locatable Multiclassing section is not a failure. Subclasses and class features are separate kinds (ADR 0009). |
| `subclass`  | Implemented. Parser extracts the 12 SRD 5.1 subclasses (one per base class: Champion, Life Domain, School of Evocation, …) from the same Classes-chapter slice by exact heading-name match (after whitespace normalization, so column-spaced multi-word headings like `School   of   Evocation` still match) into `kind=subclass` records. Each links to its parent base class via `data.parentClass` (the `class:<slug>` key — data-side linkage per ADR 0009, never `overrides`) and carries the subclass body prose in `data.description`. Base-class names bound a subclass's description so the next class's intro prose cannot bleed in; a gray callout-box heading (the generic class/DM sidebars printed after a subclass's last feature — Wizard "Your Spellbook", Warlock "Your Pact Boon", Paladin "Breaking Your Oath", Druid "Sacred Plants and Wood"/"Druids and the Gods") also bounds the description by its distinct font-height tier. The dedicated class-callout parser owns that bounded prose and emits it as a standalone parent-qualified `rule` record rather than leaving it inside the subclass (loreweaver-6fw, loreweaver-0m9.5.23). `runImporter` fails closed via a subclass-coverage guard: an empty subclass parse (or a count below `minSubclassCount`, which the CLI sets to `MIN_EXPECTED_SRD_5_1_SUBCLASSES`) throws `SubclassCoverageError` and writes nothing. Granted features are separate `feature` records, referenced from `data.features`. The four subclasses with spell tables also carry `data.spellTableRefs` (Life Domain, the seven Circle of the Land terrain tables, Oath of Devotion, and the Fiend's expanded list — eshyra-4a7.6), linked rather than duplicated into the description. Sub-subsection prose that is neither a granted feature nor a spell-table heading is captured as an optional `data.sections` array of `{ name, text }` entries (eshyra-citg): the Oath of Devotion's "Tenets of Devotion" (Honesty, Courage, Compassion, Honor, Duty) is the only such section in the SRD 5.1 subclasses after the audit. |
| `feature`   | Implemented. Parser extracts class- and subclass-granted features from the Classes-chapter slice into `kind=feature` records satisfying the `dnd5e-srd` feature kindSchema (`data.source` keyed to the grantor `class:<slug>` / `subclass:<slug>`, integer `data.level`, `data.description`). Grantor context is tracked by known base-class and subclass names (the same anchors `parseSubclasses` uses). Feature identity and grant level come primarily from class/subclass progression-table rows; leading prose clauses like "At 3rd level" are used only as a fallback when no table anchor exists. Unanchored title-case option subheadings inside feature bodies remain in the parent feature description, but a gray callout-box heading (a generic class/DM sidebar at its own font-height tier, e.g. Wizard "Your Spellbook" after Overchannel) bounds the last feature's body. The dedicated class-callout parser owns that bounded prose and emits it as a standalone parent-qualified `rule` record rather than leaving it inside the feature (loreweaver-6fw, loreweaver-0m9.5.23). `runImporter` fails closed via a feature-coverage guard: an empty feature parse (or a count below `minFeatureCount`, which the CLI sets to `MIN_EXPECTED_SRD_5_1_FEATURES`) throws `FeatureCoverageError` and writes nothing. The two feature-owned class tables carry `data.tableRefs` (eshyra-4a7.6): `feature:cleric:destroy-undead` → `table:destroy-undead` and `feature:druid:wild-shape` → `table:beast-shapes`; the flattened table rows are trimmed out of those two descriptions while the prose that introduces the table is kept. Shares the `classes` slice (ADR 0009 / loreweaver-0m9.5.18). |
| `background`| Implemented (**1 record**, eshyra-0m9.17). The SRD 5.1 "Backgrounds" chapter (pp60-61) publishes exactly one background, **Acolyte**; `parseBackgrounds` extracts it into a `kind=background` record satisfying the `dnd5e-srd` background kindSchema: re-flowed `data.description`, structured `data.skillProficiencies` (parsed list), optional `data.toolProficiencies` / `data.languages` / `data.equipment` (verbatim grant text, wrapped lines re-joined), the NESTED `data.feature = { name, text }` ("Shelter of the Faithful" — not a top-level `feature` record, because `validateDnd5eFeature` requires a class/subclass grantor key and integer grant level a background feature does not have; mirrors how ancestry traits nest), and `data.suggestedCharacteristics` (the section's intro prose). The entry's four caption-less roll tables (d8 Personality Trait, d6 Ideal/Bond/Flaw) emit as `table` records with synthesized "<Background> <Label>s" names (see Reference-table coverage); the chapter-intro sections emit as `rule` records from a `truncateBeforeFirst(/^Acolyte$/)` sub-slice. An entry is detected at the h≈13.9 sub-subsection tier (heading-case heuristic on uniform-font fixtures) and only counts as a background when a `Skill Proficiencies:` line follows it, so intro headings are never promoted. The real import fails closed against the exact `EXPECTED_SRD_5_1_BACKGROUND_NAMES` set (`BackgroundCoverageError`). Section anchor: `backgrounds` (`startHeading: /^Backgrounds$/`, exact-line end alternation — a prefix `^Equipment\b` would close fixture slices at the entry's own "Equipment:" grant label — `requireEndHeading: true`, best-effort start). |
| `ancestry`  | Implemented. Parser extracts the SRD 5.1 races and subraces by known-name match into `kind=ancestry` records (`data.source = 'race'` per ADR 0005). Parents and subraces are **separate records**; each subrace record is **flattened/self-contained** — its `data.traits` merge the parent's shared traits with the subrace's own additions, with `data.subraceOf` back-referencing the parent and the parent's `data.subraces` listing its children (no `overrides`). A racial trait that chooses from a printed option table carries a `tableRefs` link on that trait (eshyra-4a7.7; mirrors `feature.data.tableRefs`): the Dragonborn "Draconic Ancestry" trait links to `table:draconic-ancestry` (the dragon-type → damage-type/breath-weapon rows already emitted by eshyra-4a7.3), so the options are reachable as structured data rather than prose only. The link is added by `ancestryOptions.ts` (`linkAncestryOptionTables`) as a post-emit step that matches each `"the <Name> table"` prose reference to an emitted `table` record on the **same SRD page**, which disambiguates it from the identically-named Sorcerer Draconic Bloodline table on p. 44. The `srdAudit` `ancestry-unlinked-table` check fails if any ancestry trait names an option table in prose without such a link. Section anchor: `races` (`startHeading: /^Races$/`, `endHeading: /^Classes$/`, `requireEndHeading: true`). |
| `equipment` | Implemented (218 records). Parser projects the Equipment chapter and the Mounts and Vehicles section into per-item `kind=equipment` records, all carrying `category` plus verbatim `cost`/`weight` where the source lists them: armor (13: `ac`, `armorType` from the AC cell, `stealthDisadvantage`, optional `strengthRequirement`), weapons (37: `damageDie`, `damageType`, `properties[]`), tools (35), Adventuring Gear (99) + Tack/Harness/Drawn Vehicles (13) as `category='gear'`, Equipment Packs (7: `category='pack'`, verbatim contents `description`), mounts (8: `category='mount'`, `speed`, `carryingCapacity`), and waterborne vehicles (6: `category='vehicle'`, `speed`). The real SRD 5.1 PDF extracts Armor and Weapons as two physical columns (left/right blocks zipped positionally) while Tools extracts row-major. **Adventuring Gear (loreweaver-4zu)** is the hard case: its left column's item names arrive as one bare run, then the left cost/weight values interleave line-by-line with the right column's complete rows, and four category-header rows (Ammunition, Arcane focus, Druidic focus, Holy symbol) carry no value. Reconstruction removes those four reviewed headers from the name run, then length-checks and zips the de-headered names against the left values (a mismatch throws `EquipmentColumnMismatchError('Gear', …)`); the right column's rows are self-contained. The **Container Capacity** table is attached as a verbatim `capacity` field to the matching gear record via a reviewed name-alias map (an unmatched row throws `ContainerCapacityError`). The Tack table's "Saddle" sub-header variants are qualified to "Saddle, <variant>"; its non-priced "Barding ×4 ×2" multiplier row is skipped. Section anchors: `equipment` (`startHeading: /^Equipment$/`, `requireEndHeading: true`) and `mountsAndVehicles` (`startHeading: /^Mounts and Vehicles$/`; end-bounded by "Trade Goods" but `requireEndHeading` is off because `parseMountsAndVehicles` is internally header-bounded). |
| `magic-item` | Implemented (240 records). Parser extracts the full Magic Items A-Z section into `kind=magic-item` records with `data.itemType`, `data.rarity`, `data.requiresAttunement`, optional `data.attunementRequirement`, and `data.description`. The section is two-column and includes item-specific tables and bullets; `parseMagicItems` preserves embedded table text in the parent description while `parseDocumentTables` emits reviewed structured table records, skips interleaved body/stat/bullet/table lines when locating headings, recognizes category lines that begin after a prose prefix on the same extracted line, and handles category headers whose rarity wraps to a continuation line. Figurine of Wondrous Power carries nine structured `data.variants` and links its embedded Giant Fly stat block. The 239 Magic Items A-Z entries are joined by the lone "Artifacts"-subsection entry, **Orb of Dragonkind** (`rarity: "artifact"`, eshyra-0m9.16): it sits after the "Sentient Magic Items" DM guidance that bounds the A-Z slice, so it is sliced and parsed separately by the same `parseMagicItems` and concatenated. The real import fails closed against the exact `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES` set (240), so missing items or promoted prose/table artifacts throw `MagicItemCoverageError` before writing output. Section anchors: `magicItems` (`startHeading: /^Magic Items A-Z$/`, `endHeading: /^(Sentient Magic Items\|Artifacts\|Monsters\|Appendix)\b/i`, `requireEndHeading: true`) and `artifacts` (`startHeading: /^Artifacts$/`, `endHeading: /^(Monsters\|Appendix)\b/i`, `requireEndHeading: true`, best-effort start). |
| `feat`      | Implemented. Parser extracts feat entries (SRD 5.1: Grappler) with optional prerequisites and description text in `data.description`. Section anchor: `feats` (`startHeading: /^Feats?$\|^Feat Descriptions?$/`, `requireEndHeading: true`). |
| `condition` | Implemented. Parser extracts all 15 SRD conditions (blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious). Exhaustion carries a structured `levels` array (6 entries). Section anchor: `conditions` (`startHeading: /^Appendix A: Conditions$\|^Conditions$/`). |
| `hazard`    | Implemented. The canonical SRD 5.1 pack carries **25** `hazard` records from three gamemastering sub-families: **8 sample traps** (loreweaver-hvp: Collapsing Roof, Falling Net, Fire-Breathing Statue, Pits, Poison Darts, Poison Needle, Rolling Sphere, Sphere of Annihilation), **3 sample diseases** (loreweaver-6ra: Cackle Fever, Sewer Plague, Sight Rot), and **14 sample poisons** (loreweaver-6ra: Assassin's Blood … Wyvern Poison). All emit under the `hazard` kind (decision below); the SRD groups Traps with Diseases/Madness/Poisons and each is a description-only danger with a save DC and effects, so they share the `hazard` kindSchema (only `description` is required). They are discriminated within the kind: **traps** carry `data.trapType` (`"mechanical"` \| `"magic"`, the SRD subtitle); **diseases** carry `data.category: "disease"`; **poisons** carry `data.category: "poison"` plus `data.poisonType` (`contact`\|`ingested`\|`inhaled`\|`injury`) and `data.price` (per-dose, from the Poisons reference table). Each carries a re-flowed `data.description` (for poisons, the save DC and damage stay inside the description rather than being parsed out); "Pits" is one trap record describing its four inlined variants. Parsers: `parseTraps` keys each entry off its name line + standalone `Mechanical trap` / `Magic trap` subtitle; `parseDiseases` keys off the exact disease name lines (like `parseHazards`); `parsePoisons` keys off the inline `Name (Type). …` bold lead-in and cross-references the price table by normalized name. The leading guidance prose of the Diseases and Poisons sections (disease/poison framing, the four poison-type definitions) is **not** emitted — DM-facing procedure, not a lookupable entity. The Traps general guidance prose **is** emitted as `rule` records via the `trapRulePages` sub-slice (eshyra-0m9.20): Traps chapter intro, Traps in Play, Triggering a Trap, Detecting and Disabling a Trap, Trap Effects, and Complex Traps. Section anchors: `traps` (end at `Diseases`), `diseases` (`/^Diseases$/`, end at `Madness`), `poisons` (`/^Poisons$/`, end at `Magic Items`), all `requireEndHeading: true`, best-effort start. The real import fails closed against `EXPECTED_SRD_5_1_TRAP_NAMES` / `_DISEASE_NAMES` / `_POISON_NAMES` (a missing/renamed/spurious entry throws `TrapCoverageError` / `DiseaseCoverageError` / `PoisonCoverageError`). The two trap reference tables emit as `table` records (see Reference-table coverage); the Poisons price table is folded into the poison records, not emitted separately. **No `trap` / `disease` / `poison` record kinds:** all three fit the `hazard` kindSchema exactly, and new kinds would force changes across the exhaustive `Record<RulesRecordKind, …>` validators/indexes for no schema benefit. SRD 5.1 has no environmental-hazard chapter (Brown Mold / Green Slime / Webs / Yellow Mold are absent), but the environmental-hazard parser (`parseHazards`, exact-name match, best-effort `hazards` anchor `/^Dungeon Hazards$\|^Hazards$/`) is retained for fixtures and future editions; it emits zero records here. **Extractor note (loreweaver-6ra):** the p205 "Sample Poisons" page is a single column whose entries open with a short indented bold lead-in followed by the justified remainder of the first line on the same baseline; that pattern opened a phantom column gutter that scrambled each poison's first sentence, so `partitionItemsByColumn` now merges such a page back to one column (it straddles ≥2 contiguous baselines with no real gutter, the widest cut is also the most balanced, and the right side owns no standalone line). |
| `table`     | Implemented (**102 records**). The canonical pack contains 25 section-scoped reference tables, four Acolyte suggested-characteristics tables, and 73 document-wide tables reconstructed from reviewed typography and row-layout specifications. The document-wide set includes the original 24 class, subclass, equipment, and representative magic-item tables from eshyra-4a7.3, all 27 remaining Magic Items chapter tables from eshyra-4a7.8 (paired resistance tables, Cube of Force's nested tables, Deck of Illusions/Many Things, sentient-item construction tables, and reviewed reconstructions for layouts whose extracted columns lose row boundaries), the 13 class-chapter tables from eshyra-4a7.6 (the 11 remaining base-class progression tables `The Bard` … `The Wizard` plus the feature-owned `Beast Shapes` and `Destroy Undead`), and nine spell-embedded tables from eshyra-o4j7 (Animate Objects, Confusion, Control Weather's three stage tables, Creation, Reincarnate, Scrying, and Teleport). `EXPECTED_SRD_5_1_TABLE_NAMES` is an exact fail-closed baseline, and each document-wide specification pins its source fingerprint and expected row count. See "Reference-table coverage" and "Document-wide tables" below. |
| `rule`      | Implemented (**272 records**): the existing core, spellcasting, gamemastering, class-callout, Beyond 1st Level, Magic Items, Traps, Monsters, Backgrounds, and Spellcasting Services rules, plus 16 source-bounded Races/Equipment guidance records (eshyra-4a7.10.1): the Racial Traits intro and seven category explanations, Getting Into and Out of Armor, Weapons Guidance with Weapon Proficiency / Weapon Properties / Improvised Weapons / Silvered Weapons / Special Weapons, and the Self-Sufficiency sidebar. The four racial headings that collide with later rule names use `rule:racial-traits-*` keys. Equipment table-cell lines are removed only from these prose-only slices; the Donning and Doffing Armor and Weapons tables remain represented by table/equipment records. The real import fails closed against the exact combined `EXPECTED_SRD_5_1_RULE_KEYS` set. Full body text is stored in `data.text`. |

The importer does **not** emit empty stubs for unimplemented kinds. Per the
ADR 0007 ingestion policy and the `loreweaver-0m9.5` scope rule, a generated
pack that omits a kind reflects "the parser doesn't cover that yet" -- not "the
SRD doesn't contain those records". The generated manifest's `description`
field lists the included kinds explicitly so downstream callers can tell.

## How to regenerate

1. The SRD 5.1 PDF is vendored in-repo at
   `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf` (CC-BY-4.0; pinned by
   SHA-256 in `packages/core/sources/dnd5e-srd-5.1/manifest.json`). No download
   step is required for a fresh clone.
2. From the repo root:

   ```bash
   npm run import:dnd5e-srd
   ```

   This runs against the default vendored PDF path and writes to a scratch
   directory at `packages/core/scripts/importers/dnd5e-srd-5.1/.generated/`.
   It does NOT overwrite the canonical pack location.

3. Inspect the output. When a parser/source/schema change is intended to alter
   pack content, overwrite the committed canonical pack:

   ```bash
   npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
   ```

   Then review the diff (`npm run audit:rules-pack` / `npm run diff:rules-pack`),
   update the `srdGeneratedPack` baselines, and commit the regenerated pack so
   `npm run verify:dnd5e-srd-pack` returns to exit 0 (see the regeneration
   procedure below).

The CLI prints the source PDF's SHA-256 on each run. The pinned value lives in
`packages/core/sources/dnd5e-srd-5.1/manifest.json` (`artifact.sha256`); a
mismatch means the PDF in `sources/` was swapped without updating the manifest
-- treat that as a vendoring change, not a routine importer run.

## Regenerating the committed pack

Per the 0m9.6 design, the SRD importer is a one-shot construction tool, not a
per-PR generator. The committed pack at
`packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` is the canonical
importer output from the vendored SRD 5.1 PDF (regenerated under
`loreweaver-1pw`). The default vitest suite asserts that committed pack is
well-formed and matches its reviewed baselines
(`packages/core/test/srdGeneratedPack.test.ts`); the importer is **not** re-run
on every PR. Reproducibility against the vendored PDF is a separate, path-gated
CI job (`.github/workflows/srd-importer-reproducibility.yml`) that runs
`npm run verify:dnd5e-srd-pack` and **fails the PR check on any nonzero exit**.

`npm run verify:dnd5e-srd-pack` is the local-and-CI verification command. Its
exit codes are strict:

- `0` — importer output matches the committed pack byte-for-byte (steady state).
- `1` — importer succeeded but its output differs from the committed pack.
- `2` — verification could not produce a meaningful diff (importer/runtime
  failure, pack-loading failure).

When a change to a gated path (importer/parser code, the vendored PDF + its
manifest, the rules schemas/audit/loader, the verify script, or the lockfile)
is intended to alter pack content, regenerate the committed pack in the same
PR:

1. Regenerate over the committed pack location:

   ```bash
   npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
   ```

2. Review the result with the audit/diff tooling:

   ```bash
   npm run audit:rules-pack -- packages/core/data/rules-packs/rules__dnd5e-srd-5.1
   ```

   `auditPack` must report zero suspicious records. Any partially-populated
   optional field must be a genuinely-optional SRD field — fix the parser, or
   add it to `EXPECTED_PARTIAL_FIELDS` in `srdGeneratedPack.test.ts` with a
   one-line justification, before merging.

3. Update `EXPECTED_COUNTS_BY_KIND`, `EXPECTED_STABLE_KEYS`,
   `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`, and `EXPECTED_PARTIAL_FIELDS` in
   `packages/core/test/srdGeneratedPack.test.ts` / `index.ts` to match the
   regenerated pack.

4. Run `npm run verify:dnd5e-srd-pack` and confirm it exits 0. Paste into the
   PR description: the reported source PDF SHA-256 (must match
   `packages/core/sources/dnd5e-srd-5.1/manifest.json` `artifact.sha256`), the
   importer's per-kind counts line, and confirmation that the command exited 0.

## Architecture

```
sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf
        |
        v  extract.ts (pdfjs-dist)
   PageText[]
        |
        v  sections.ts (sliceSection)
   PageText[] narrowed per kind (e.g. spell-descriptions, spell-lists)
        |
        v  parseSpells.ts
   SpellExtraction[]  +  SpellClassIndex
        |
        v  emit.ts
   RulesPack  (validated by validateRulesPack)
        |
        v
   manifest.json + records.json
```

- `extract.ts` -- PDF -> per-page text via `pdfjs-dist`. Groups text items by
  y-coordinate (with rounding) and sorts each line left-to-right. Pure
  function over the PDF buffer.
- `sections.ts` -- `PageText[]` -> per-kind `PageText[]` slice via deterministic
  chapter-heading anchors. Fails closed: an unmatched anchor throws
  `SectionNotFoundError` rather than silently feeding the whole PDF to a kind
  parser. See "Section-anchor table" below.
- `parseSpells.ts` -- narrowed text -> `SpellExtraction[]` by scanning for
  level-school marker lines, then walking backward for the name and forward
  for keyed metadata + description. Class lists are a second pass over the
  spell-lists slice.
- `parseActions.ts` -- narrowed text -> `ActionExtraction[]` by exact heading
  match over the 10 standard SRD combat-action names. Body text is re-flowed
  into `description`.
- `parseCreatures.ts` -- narrowed stat-block text -> `CreatureExtraction[]`
  by scanning for each stat block's size/type/alignment meta line, validating
  the type against the 14 SRD creature types, then reading the keyed stat lines
  (Armor Class, Hit Points, Speed, the STR/DEX/… ability table, Challenge). A
  meta-like sentence without the AC/HP/ability signature is skipped; a
  confirmed block missing Speed or Challenge throws. The same parser drives both
  the Monsters chapter / Appendix MM-A (default `category: 'monster'`) and
  Appendix MM-B: Nonplayer Characters (`category: 'npc'`, passed by the
  orchestrator for the MM-B slice — loreweaver-bn0); the `category` argument is
  stamped onto every extraction and surfaces as `data.category` on NPC records
  only.
- `parseConditions.ts` -- narrowed text -> `ConditionExtraction[]` by exact
  match against the 15 known condition names. Bullet-point lines become
  `effects[]`; exhaustion's level table becomes a structured `levels[]` array.
- `parseHazards.ts` -- narrowed text -> `HazardExtraction[]` by exact match
  against the 4 known SRD 5.1 environmental-hazard names (Brown Mold, Green
  Slime, Webs, Yellow Mold). Body is re-flowed prose paragraphs. Emits nothing
  for SRD 5.1 (those hazards are absent from the source).
- `parseTraps.ts` -- narrowed "Traps"-section text -> `TrapExtraction[]` by each
  sample trap's name line + standalone `Mechanical trap` / `Magic trap`
  subtitle. Skips the leading trap-running guidance prose and the two trap
  tables. Body is re-flowed prose; `trapType` records the subtitle. Emitted
  under the `hazard` kind (loreweaver-hvp). The general trap-rules prose is
  imported separately via the `trapRulePages` sub-slice (eshyra-0m9.20) — see
  the `parseRules.ts` entry.
- `parseDiseases.ts` -- narrowed "Diseases"-section text -> `DiseaseExtraction[]`
  by exact match against the 3 known SRD 5.1 disease names (Cackle Fever, Sewer
  Plague, Sight Rot). Skips the leading guidance prose and the "Sample Diseases"
  caption. Body is re-flowed prose. Emitted under the `hazard` kind with
  `data.category: "disease"` (loreweaver-6ra).
- `parsePoisons.ts` -- narrowed "Poisons"-section text -> `PoisonExtraction[]` by
  each sample poison's inline `Name (Type). …` bold lead-in (the four-type
  guidance prose has no parenthetical, so it is not promoted). Price per dose is
  read from the reference-table rows (`Name Type <n> gp`) and attached by
  normalized name. Body is the re-flowed effect prose (lead-in stripped).
  Emitted under the `hazard` kind with `data.category: "poison"`, `poisonType`,
  and `price` (loreweaver-6ra).
- `parseRules.ts` -- narrowed core-rules text -> `RuleExtraction[]`, one per
  heading across the subsection/sub-subsection/leaf font tiers
  (`PageText.lineHeights`), bounding each body at the next heading and
  parent-qualifying colliding keys (loreweaver-yli). Body is re-flowed prose in
  `text`; the disambiguated record-key slug is in `keySlug`. Falls back to a
  flat text-heuristic for uniform-font fixtures.
- `parseAncestries.ts` -- narrowed races text -> `AncestryExtraction[]` by
  known-name race/subrace heading match plus "Label. body" trait detection.
  Emits one entry per race and per subrace; subrace entries carry flattened
  (parent + own) traits and a `subraceOf` back-reference.
- `ancestryOptions.ts` -- post-emit enrichment (`linkAncestryOptionTables`)
  that adds a per-trait `tableRefs` link on any ancestry trait whose prose names
  `"the <Name> table"` to the emitted `table` record on the same SRD page
  (eshyra-4a7.7). The only SRD 5.1 races-chapter case is the Dragonborn Draconic
  Ancestry trait → `table:draconic-ancestry`; the same-page match keeps it
  distinct from the Sorcerer Draconic Bloodline table.
- `spellTables.ts` -- post-emit enrichment (`linkSpellEmbeddedTables`) that
  adds `spell.data.tableRefs` for spell-owned table extractions and fails closed
  on missing owners, missing table records, unreviewed ownership, or dangling
  references.
- `parseSubclasses.ts` -- narrowed Classes-chapter text (the same slice
  `parseClasses` consumes) -> `SubclassExtraction[]` by known-name subclass
  heading match. Each subclass's body re-flows into `description`, bounded by
  the next subclass heading or base-class name so the next class's prose does
  not bleed in; `parentClass` carries the parent base-class name, which `emit.ts`
  keys to the `class:<slug>` record (ADR 0009).
- `parseFeatures.ts` -- narrowed Classes-chapter text -> `FeatureExtraction[]`
  by class/subclass progression-table anchors plus leading-level prose fallback.
  Progression rows supply the canonical grant level and prevent option
  subheadings inside feature bodies from being promoted to feature records.
- `parseClassCallouts.ts` -- narrowed Classes-chapter text ->
  `RuleExtraction[]` by the same structural heading tiers that bound subclass
  and feature bodies. Every detected gray box is retained as a standalone,
  parent-qualified rule, regardless of whether its content is procedural,
  illustrative, or lore; semantic filtering is intentionally not performed.
- `parseMulticlassing.ts` -- narrowed Multiclassing-section text -> a
  class-name → primary-ability map from the "Prerequisites" listing
  ("Fighter Strength 13 or Dexterity 13", ...). `emit.ts` merges it into each
  class record's `primaryAbilities` when the Class Features block carried none
  (loreweaver-0m9.5.19). Best-effort: a missing section yields an empty map and
  empty `primaryAbilities` rather than a failure (ADR 0007).
- `parseTables.ts` -- narrowed core-rules, Traps, Madness, Objects, and
  treasure-table text ->
  `TableExtraction[]` by per-table anchors plus conservative row
  reconstruction for simple reference tables and column-block reconstruction
  for SRD treasure tables. Rows are emitted as structured arrays in
  `data.rows`.
- `parseDocumentTables.ts` -- the FULL extracted document -> 64
  `TableExtraction`s by typography anchors (eshyra-4a7.3, extended by
  eshyra-4a7.8 and eshyra-4a7.6): each reviewed spec names a leaf-tier anchor
  heading, the table's exact cell-tier column-header line(s) (or, for the
  sheared class tables, the pinned source block(s)), a row rule, and an exact
  expected row count. Fails closed per table; emits nothing for uniform-font
  fixtures. The class-chapter specs live in `classProgressionTables.ts`. See
  "Document-wide tables" below.
- `parseGamemasteringRules.ts` -- narrowed Madness and Objects text -> five
  `RuleExtraction` records. It preserves the Madness root introduction,
  separates Going Mad / Madness Effects / Curing Madness, and removes the
  structured Object AC/HP rows from the consolidated Objects prose.
- `parseEquipment.ts` -- narrowed Equipment-chapter text ->
  `EquipmentExtraction[]` for armor, weapons, tools, Adventuring Gear (+
  Container Capacity), and Equipment Packs; `parseMountsAndVehicles` handles the
  separate Mounts and Vehicles slice (mounts, tack/harness/drawn vehicles,
  waterborne vehicles). The real SRD 5.1 PDF lays out the Armor and Weapons
  tables as two physical columns, so each table arrives split into a left
  column-block (Name/Cost/AC or Name/Cost/Damage) and a right column-block
  (Strength/Stealth/Weight or Weight/Properties); the parser collects both and
  zips them positionally. Tools extract row-major. Adventuring Gear interleaves
  its left cost/weight values with the right column's complete rows and carries
  four valueless category headers, so the de-headered left names are
  length-checked and zipped against the left values, the right rows are
  self-contained, and Container Capacity is attached as a verbatim `capacity`.
  Armor weight class is derived from the AC cell (light/medium/heavy/shield),
  not the table sub-headers, which the body prose duplicates. The reconstruction
  fails closed on column drift (`EquipmentColumnMismatchError`) or an unmatched
  container (`ContainerCapacityError`) per ADR 0007 (see the file header).
- `parseMagicItems.ts` -- narrowed Magic Items A-Z text ->
  `MagicItemExtraction[]` by scanning for item category/rarity lines and walking
  backward to the item heading. Handles wrapped names/categories, `rarity
  varies`, two-column interleaving where body lines sit between a heading and
  category, and category substrings that begin after same-line prose prefixes.
  Item-specific tables/bullets remain in the parent `description`; they do not
  emit as freestanding `table` records. The real import validates the exact
  reviewed 237-name set (`EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`).
- `emit.ts` -- extraction arrays + class index -> validated `RulesPack`,
  written deterministically (records sorted by key, fixed field order, 2-space
  indent, trailing newline).
- `index.ts` -- programmatic API + orchestrator: `runImporter({ pdfPath, outDir })`.
  Dispatches each per-kind slice to its parser.
- `cli.ts` -- command-line wrapper.

## Reference-table coverage

The table parser intentionally covers only cases whose extracted text has a
reviewed deterministic reconstruction rule. Coverage splits into table families
that are **present in the vendored SRD 5.1 source** (and therefore emitted into
the committed canonical pack) and reconstruction rules that are **wired and
tested but match no section in the SRD 5.1 PDF**. The latter emit nothing for
this source; they exist for fixtures and future editions, mirroring the retained
`hazards` / `treasureTables` section anchors (see the section-anchor notes
below). The exact canonical name set is guarded by
`EXPECTED_SRD_5_1_TABLE_NAMES` / `TableCoverageError`.

### Present in the committed SRD 5.1 pack

| Table | Record key | Reconstruction rule |
|-------|------------|---------------------|
| Difficulty Classes | `table:difficulty-classes` | Two-column label/DC rows reconstruct cleanly from line text ("Typical Difficulty Classes", p77). |
| Ability Scores and Modifiers | `table:ability-scores-and-modifiers` | Sixteen score-range/modifier rows reconstruct from line text. Anchored on the unique "Score Modifier" header row because the caption is also the chapter's h≈18 subsection title (p76; eshyra-10t). Score ranges keep the SRD en-dash and modifiers the typographic minus sign (U+2212) verbatim. |
| Travel Pace | `table:travel-pace` | Three pace rows whose cells span up to three extracted lines: the numeric row ("Fast 400 4 30 −5 penalty to passive"), the "feet miles miles" units row whose remainder continues the Effect cell, and further Effect wrap lines. Units fold into standalone distance cells ("400 feet", "4 miles", "30 miles"); the Normal "—" effect stays verbatim; the "Difficult Terrain" heading bounds the table. Anchored on the unique "Pace Distance Traveled per . . ." header row because the caption is also the Speed section's prose heading (p84; eshyra-10t). |
| Trap Save DCs and Attack Bonuses | `table:trap-save-dcs-and-attack-bonuses` | Three-column danger/DC-range/attack-bonus rows reconstruct from line text (p196, gamemastering Traps section; loreweaver-hvp). Cell ranges keep the SRD en-dash verbatim. |
| Damage Severity by Level | `table:damage-severity-by-level` | Four-column level-range/setback/dangerous/deadly dice rows reconstruct from line text (p196; loreweaver-hvp). |
| Short-Term Madness | `table:short-term-madness` | Ten wrapped d100/effect rows reconstruct from the Madness slice (p201). |
| Long-Term Madness | `table:long-term-madness` | Twelve wrapped d100/effect rows reconstruct from the Madness slice (p201). |
| Indefinite Madness | `table:indefinite-madness` | Twelve wrapped d100/flaw rows reconstruct from the Madness slice (p202). |
| Object Armor Class | `table:object-armor-class` | Seven substance/AC rows reconstruct from line text (p203). |
| Object Hit Points | `table:object-hit-points` | Four size/fragile/resilient rows support both inline and split-column extraction layouts (p203). |
| Character Advancement | `table:character-advancement` | Twenty XP/level/proficiency-bonus rows reconstruct from line text; XP thousands separators are stripped to integers (p56; eshyra-0m9.23). |
| Multiclassing Prerequisites | `table:multiclassing-prerequisites` | Twelve class/ability-minimum rows; the value cell keeps its spaces ("Strength 13 or Dexterity 13") because the leading token is a known base-class name (p56; eshyra-0m9.23). |
| Multiclassing Proficiencies | `table:multiclassing-proficiencies` | Twelve class/proficiencies rows whose proficiency cell wraps across extracted lines (the same shape as the Madness tables); rejoined by class-name row starts and bounded by the "Class Features" heading. The Sorcerer/Wizard "—" cells are preserved verbatim (p57; eshyra-0m9.23). |
| Standard Languages | `table:standard-languages` | Eight language/speakers/script rows split by known language prefix + last-token script, so a multi-word speakers cell ("Ogres, giants") stays intact (p59; eshyra-0m9.23). |
| Exotic Languages | `table:exotic-languages` | Eight rows split the same way; the two-word "Deep Speech" language and its "—" script cell are handled by the known-name prefix match (p59; eshyra-0m9.23). |
| Standard Exchange Rates | `table:standard-exchange-rates` | Five coin rows ("Copper (cp) 1 1/10 …") reconstruct from line text; fractional cross-rate cells are preserved verbatim as strings. Anchored on the unique "Coin CP SP EP GP PP" header because the title also appears as a section heading (p62; eshyra-0m9.19). |
| Trade Goods | `table:trade-goods` | Thirteen cost/goods rows; the leading number+denomination ("1 cp", "500 gp") is the cost and the remainder the goods. Anchored on the "Cost Goods" header (p72; eshyra-0m9.19). |
| Lifestyle Expenses | `table:lifestyle-expenses` | Seven lifestyle/price rows anchored on the known lifestyle name so the value cell keeps "—" (Wretched) and "10 gp minimum" (Aristocratic) verbatim (pp72-73; eshyra-0m9.19). |
| Food, Drink, and Lodging | `table:food-drink-and-lodging` | Twenty rows. The SRD prints grouped sub-headings (Ale, Inn stay, Meals, Wine) with indented sub-items; a reviewed group→members map folds each sub-item into a qualified name ("Inn stay, squalid (per day)") and ungrouped items (Banquet, Bread, Cheese, Meat) keep their bare name. Values come from extraction; only the grouping is reviewed (pp73-74; eshyra-0m9.19). |
| Services | `table:services` | Seven rows, grouped the same way (Coach cab, Hireling) with three ungrouped services. A value-less line that is not a known group header bounds the table, dropping the trailing explanatory prose (p74; eshyra-0m9.19). |
| Multiclass Spellcaster: Spell Slots per Spell Level | `table:multiclass-spellcaster-spell-slots-per-spell-level` | Twenty ordinal-level rows of nine slot cells each. Anchored on the unique first caption line "Multiclass Spellcaster:" (the trailing colon keeps the wrapped body-prose mention "consulting the Multiclass Spellcaster table." from matching). Slot counts emit as integers; the "no slots at this level" em-dash cells are preserved verbatim (p58; eshyra-0m9.18). |
| Size Categories | `table:size-categories` | Six size/space/examples rows from the Monsters chapter (p254; eshyra-0m9.22). The caption is shared with the core-rules Combat chapter's two-column Size/Space table (p92), and both captions appear in the concatenated `parseTables` input, so the parser anchors on the Monsters version's unique three-column header row ("Size Space Examples"). The core p92 occurrence is not emitted. |
| Hit Dice by Size | `table:hit-dice-by-size` | Six size/hit-die/average rows; the half-point averages ("2½" … "10½") are preserved verbatim (p256; eshyra-0m9.22). |
| Proficiency Bonus by Challenge Rating | `table:proficiency-bonus-by-challenge-rating` | Thirty-four challenge/bonus rows printed as PAIRED columns — each physical line carries two logical rows ("1/8 +2 15 +5"). A four-group row regex splits each line; every left pair emits in document order followed by every right pair so rows run CR 0 → 30 (p256; eshyra-0m9.22). |
| Experience Points by Challenge Rating | `table:experience-points-by-challenge-rating` | Thirty-four challenge/XP rows, paired-column like the proficiency table. XP cells are verbatim strings (thousands separators kept; the CR 0 cell is the SRD's prose "0 or 10") (p258; eshyra-0m9.22). |

The committed pack holds exactly these twenty-five reconstructed `table`
records plus the four Acolyte suggested-characteristics roll tables emitted by
`parseBackgrounds` and the sixty-four document-wide tables emitted by
`parseDocumentTables` (93 `table` records total — see the document-wide table
section below). `srdGeneratedPack.test.ts` pins the table key/name set (and
the per-kind `table: 93` count) so coverage cannot silently collapse or grow
without a reviewed baseline update.

### Document-wide tables (eshyra-4a7.3, eshyra-4a7.8)

`parseDocumentTables.ts` consumes the FULL extracted document (not a section
slice) and locates each table in `SRD_5_1_DOCUMENT_TABLE_SPECS` by typography:
a leaf-tier (h≈12.0) anchor heading plus the table's exact cell-tier (h≈8.9)
column-header line(s). Row collection consumes only cell-tier lines, so a
table can never swallow resuming body prose, and a prose sidebar (whose box
body also renders at cell height — e.g. "Self-Sufficiency" p73) can never
satisfy a spec because its exact header line is absent. Anchors are either the
printed `caption` or, for tables the SRD prints caption-less, the owning
`item` entry's heading (the scan aborts at the next heading so a spec cannot
claim a neighboring entry's table). Each spec carries an EXACT expected row
count; count, shape, or reviewed source-fingerprint drift fails the table
closed, and the missing name then trips `TableCoverageError` via
`EXPECTED_SRD_5_1_TABLE_NAMES` before any output is written. Row rules include
`line-per-row` (one cell line per row),
`paired-line-per-row` (two logical rows on each physical line),
`wrapped-last-column` (subclass spell tables, the d100 dice tables, and the
Fighter/Rogue class tables, whose row starts are a d100 range, a zero-padded
single "01"/"00", or a level ordinal so a wrapped cell beginning with a bare
number cannot open a phantom row), reviewed exact row reconstructions for
source layouts whose columns are irrecoverably interleaved, the Barbarian
progression's wrapped-Features shape, and the `class-progression-reconstruction`
rule for the nine spellcaster/monk class tables (see below).
Uniform-font fixtures never satisfy the tier requirements and emit nothing.

#### Class progression tables (eshyra-4a7.6)

All twelve base classes now emit a `table` record (`The Barbarian` … `The
Wizard`), as do the two feature-owned class tables `Beast Shapes` (Druid Wild
Shape) and `Destroy Undead` (Cleric). The Barbarian, Fighter, and Rogue tables
extract as one physical line per row and use `wrapped-features-column` /
`wrapped-last-column`. The other nine are sheared by the two-column page layout
into separate cell-tier runs — a Level/Features run and one or more
spell-slot/resource runs — interleaved with the proficiency and Equipment prose
that flows around the table, so neither the caption-immediate header nor a
single contiguous cell run can reach the data. Their specs live in
`classProgressionTables.ts` and use `class-progression-reconstruction`: each
pins the exact contiguous source block(s) in document order
(`locateClassProgression` finds them past the interleaving prose, bounded to the
class's own chapter) and carries the reviewed row reconstruction, with every
block line required to match verbatim at table-cell tier or the table fails
closed. The reconstructed rows preserve source tokens verbatim ("+2", "1d6",
"Unlimited", "+10 ft.", and extraction artifacts like "Land s Stride") and
expose each class's resource columns (Rages, Sneak Attack, Ki Points, Sorcery
Points, Pact Magic Spell Slots / Slot Level / Invocations Known, cantrips/spells
known, and the per-level spell-slot progression). Structured per-level
`class.data.progression` is a separate follow-up; this layer only preserves the
source tables as reviewed `table` records.

Blank vs. dash cells: SRD 5.1 leaves an unavailable cell BLANK and does not
print a dash there. Verified against the source text layer, the only genuine
table-cell em dashes in the entire Classes chapter are the Monk's level-1 Ki
Points / Unarmored Movement and the Beast Shapes level-8 Limitations cell —
those are emitted as "—". Every unavailable spell-slot cell and empty Features
row (Bard L7/L11, Cleric L3, the half-caster slots before they come online, …)
carries no glyph in the source, so it is emitted as "" rather than a fabricated
"—" (ADR 0007). `srdGeneratedPack.test.ts` pins both conventions.

Source-table accounting (the rest of the eshyra-4a7.3 scope) lives in the
coverage gate: every `table-caption` / `table-shape` inventory item now
resolves to an emitted record, structured child data, a documented ignore, or
a NARROW known-gap naming the bead that owns its representation. The 12 class
progression tables and the two feature-owned class tables (Beast Shapes,
Destroy Undead) are emitted `table` records (eshyra-4a7.6). The broad
class-chapter known-gap is gone (eshyra-4a7.6 PR2): the progression tables'
column-header fragments are `ignore`d as table internals; the 86 feature-option
and spellcasting-boilerplate leaf subheadings (Fighting Styles, Metamagic, ki
options, Pact Boons, Eldritch Invocations, "Ritual Casting"/"Spellcasting
Focus", …) plus the Rogue's "Thieves' Cant" map `child-of` the owning feature
whose body the parser folds them into (verified present); the two subclass
spell-table headings are `ignore`d because their tables are emitted and linked
via `subclass.data.spellTableRefs`; the eight subclass-group section headings
fall to the document-structure default; and the Oath of Devotion's "Tenets of
Devotion" heading maps `child-of:subclass:oath-of-devotion` (its prose is a
named section on that record — eshyra-citg). The nine spell-embedded tables
(Animated Object Statistics, Confusion, Control Weather's three stage tables,
Creation, Reincarnate, Scrying, and Teleport) are emitted as table records
(eshyra-o4j7); caption-less tables use owner-qualified names, and reviewed
reconstructions preserve wrapped cells for Animated Objects, Scrying, and
Teleport. Each owning spell links those records through optional
`data.tableRefs`; Control Weather links all three weather tables. The original
spell descriptions remain source-preserving and retain their flattened table
prose. The Appendix PH-B deity tables and Half-Dragon Template tables stay
with eshyra-4a7.10 because those source regions remain unimported. A
table caption that shares its name with an emitted record is normally claimed
by that record via the name auto-match (e.g. the exhaustion-levels caption
resolves to `condition:exhaustion`, which carries structured `levels[]`). The
Cleric's `Destroy Undead` table caption collides by name with the
`feature:cleric:destroy-undead` heading, so an explicit `recordRule` maps the
table caption to `table:destroy-undead` while the feature heading still
auto-matches the feature record.

The core-rules Combat chapter's own "Size Categories" table (p92, Size/Space
only) is an intentional omission: its Space cells are identical to the
Monsters-chapter `table:size-categories` (p254), which is a strict superset
(it adds the Examples column), so emitting the p92 occurrence would only
duplicate the same data under a colliding key (eshyra-10t).

The Beyond-1st-Level tables (Character Advancement, Multiclassing Prerequisites,
Multiclassing Proficiencies, Standard Languages, Exotic Languages, Multiclass
Spellcaster: Spell Slots per Spell Level) are
reconstructed from the dedicated `beyondFirstLevel` section slice; each table
title and column-header line is unique within that chapter, so the per-table
anchors cannot collide with the wrapped body-prose mentions ("as shown in the
Character / Advancement table"). The same slice feeds `parseRules` for the
chapter's prose rules (eshyra-0m9.18; see the `rule` row above). The money/downtime tables (Standard Exchange
Rates, Trade Goods, Lifestyle Expenses, Food/Drink/Lodging, Services) are
reconstructed from the `equipment` slice (Standard Exchange Rates) and the
dedicated `expenses` slice (the rest), and anchored on their unique
column-header lines because each title also occurs as a section heading.
The Spellcasting Services subsection in the same `expenses` slice has no rate
table, so it is emitted as a `rule` (`rule:spellcasting-services`) via
`parseSpellcastingServices`, not as a table.

### Reconstruction-capable but absent from SRD 5.1

These are DM-reference / encounter-building tables that the Creative-Commons SRD
5.1 does **not** include (they live in non-SRD sourcebooks). The parser keeps a
reviewed reconstruction rule for each, exercised by `parseTables.test.ts` unit
fixtures and the `pipeline.test.ts` end-to-end fixture, so a future SRD edition —
or any other source — that *does* carry them is imported without new parser
work. None of them emit a record from the vendored SRD 5.1 PDF.

| Table | Record key | Reconstruction rule |
|-------|------------|---------------------|
| XP Thresholds by Character Level | `table:xp-thresholds-by-character-level` | Fixed five-column numeric threshold rows reconstruct cleanly from line text. |
| Individual Treasure challenge tables | `table:individual-treasure-challenge-<range>` | The `treasureTables` slice is wired through `runImporter`; d100 ranges form a leading block and each currency column forms an equal-length block that can be pivoted into rows. |
| Treasure Hoard challenge tables | `table:treasure-hoard-challenge-<range>` | The `treasureTables` slice is wired through `runImporter`; d100 ranges, coin columns, gems/art-object column, and magic-item column can be reconstructed from equal-length column blocks. Empty dash cells are stored as `null`. |

Tables not covered by the current parser at all (each is explicitly accounted
in the source-coverage gate as a `known-gap:<bead>` — see the document-wide
table section above):

| Table family | Reason deferred | Follow-up |
|--------------|-----------------|-----------|
| Appendix PH-B deity tables (Celtic/Greek/Egyptian/Norse) + Half-Dragon Template tables | The deity tables' name and alignment/domain/symbol column blocks interleave across pages in extraction order; both regions are unimported. | `eshyra-4a7.10` |

## Section-anchor table

The SRD 5.1 PDF is a single multi-chapter document; each kind parser is only
correct against its own chapter. `sections.ts` exposes a small table of
chapter-heading regexes that the orchestrator uses to narrow input before
dispatch. Each entry is a `SectionAnchorOptions` value:

| Field                | Purpose                                                                                              |
|----------------------|------------------------------------------------------------------------------------------------------|
| `startHeading`       | Regex matched against `line.trim()` to find the section's first content line (heading itself excluded). |
| `endHeading`         | Regex matched against any line after `startHeading` to mark the boundary (end line excluded).         |
| `requireEndHeading`  | If `true`, an unmatched `endHeading` throws `SectionNotFoundError('end')` instead of slicing to EOF.   |
| `matchHeadings`     | If `true`, anchors match only at the line positions the extractor flagged as chapter/section headings (`PageText.headingLineIndexes` — indexes into `lines`, not just heading text). Disambiguates a chapter title from a body-font line that happens to spell the same text — e.g. "Equipment" appears as a class-block subsection at body font in every base-class chapter, and a text-only check could not tell those two occurrences apart. Fixtures with uniform font sizes leave `headingLineIndexes` undefined and fall back to line matching. |

`SRD_5_1_DEFAULT_SECTION_ANCHORS` is the live table consumed by the
orchestrator. Freestanding `table` records use the `coreRules` slice for the
Difficulty Classes table, the `traps` slice for the two trap tables, the
`treasureTables` slice for treasure challenge tables, the `beyondFirstLevel`
slice (p56-60, best-effort start, end-bounded at "Backgrounds") for the six
Beyond-1st-Level reference tables (eshyra-0m9.23, eshyra-0m9.18) AND the
chapter's 18 prose rules (eshyra-0m9.18), the `equipment` slice for
Standard Exchange Rates (p62), and the `expenses` slice (p72-74, best-effort
start, end-bounded at "Feats") for Trade Goods, Lifestyle Expenses,
Food/Drink/Lodging, and Services plus the Spellcasting Services rule
(eshyra-0m9.19). The four Acolyte suggested-characteristics roll tables come
from `parseBackgrounds` over the `backgrounds` slice (pp60-61, best-effort
start, end-bounded at "Equipment"), not from `parseTables` — the SRD prints
them caption-less, so their names are synthesized (eshyra-0m9.17); the same
slice yields the `background:acolyte` record and (via a
`truncateBeforeFirst(/^Acolyte$/)` sub-slice) the chapter's six intro rules.
The `traps` anchor is
best-effort on its START (a fixture without a Traps section degrades to no
traps) but `requireEndHeading: true`, so a Traps section that begins without
its `Diseases` boundary fails closed rather than letting the last trap's body
run on (the contamination loreweaver-7ok removed from Zone of Truth). Two other
anchors (`hazards`, `treasureTables`) target sections that do NOT exist in the
SRD 5.1 PDF; the orchestrator wraps those slices in a best-effort try/catch and
emits empty results when the start anchor doesn't match, so a missing canonical
section is not a run-time failure.

Real-PDF mapping note (`loreweaver-0m9.5.20`): the SRD 5.1 has no aggregate
"Classes" chapter heading; each base class is its own h=25.9 chapter title
("Barbarian" through "Wizard"). Multi-line chapter titles ("Using Ability" +
"Scores", "Appendix PH-A:" + "Conditions") are re-joined into a single
logical line by the extractor's heading-merge pass before slicing.

| Anchor key           | `startHeading`                                 | `endHeading`                                                | `requireEndHeading` | `matchHeadings` |
|----------------------|------------------------------------------------|-------------------------------------------------------------|---------------------|-----------------|
| `races`              | `/^Races$/`                                     | `/^Barbarian$\|^Classes$/`                                  | `true`              | `true`          |
| `classes`            | `/^Barbarian$\|^Classes$/`                      | `/^Beyond 1st Level$\|^Using Ability Scores$/`              | `true`              | `true`          |
| `coreRules`          | `/^Using Ability Scores$/`                      | `/^Spellcasting$\|^Spell Lists$/`                           | `true`              | `true`          |
| `spellLists`         | `/^Spell Lists$/`                              | `/^Spells$\|^Spell Descriptions$/`                          | `true`              | `true`          |
| `spellDescriptions`  | `/^Spells$\|^Spell Descriptions$/`             | `/^(Monsters\|Magic Items\|Creatures\|NPCs\|Treasure\|Appendix)\b/` | `true`        | `true`          |
| `combatActions`      | `/^Actions in Combat$/`                        | `/^(Making an Attack\|Movement and Position\|Reactions?\|Bonus Actions?\|Mounted Combat\|Underwater Combat\|Contests in Combat\|Cover)$/i` | `true` | `true` |
| `monsters`           | `/^Monsters$/`                                 | `/^(Nonplayer Characters\|NPCs\|Appendix \|Open Game License\|Legal Information)/i` | `true`     | `true`          |
| `nonplayerCharacters`| `/^Appendix MM-B:\s*Nonplayer Characters$/`    | _(none — runs to EOF)_                                       | false (best-effort start; last section) | `true` |
| `conditions`         | `/^(Appendix [A-Z]{0,3}-?[A-Z]?:?\s*)?Conditions$\|^Appendix [A-Z]{0,3}-?[A-Z]?: Conditions$/` | `/^Appendix [A-Z]{0,3}-?[A-Z]?:\|^Open Game License\|^Legal Information/i` | false (may run to EOF) | `true` |
| `feats`              | `/^Feats?$\|^Feat Descriptions?$/`             | `/^(Using Ability Scores\|...)$\|^Appendix\b/i`             | `true`              | `true`          |
| `traps`              | `/^Traps$/`                                     | `/^(Diseases\|Madness\|Objects\|Poisons\|Monsters\|Magic Items\|Appendix)\b/` | `true` (best-effort start) | `true` |
| _(derived)_ `trapRulePages` | n/a — derived inline from `trapPages` via `truncateBeforeFirst(/^Sample Traps$/)` | `/^Sample Traps$/` (pattern, not a section anchor) | throws if `trapPages` non-empty and "Sample Traps" absent | n/a (below h≥14 threshold) |
| `diseases`           | `/^Diseases$/`                                  | `/^(Madness\|Objects\|Poisons\|Monsters\|Magic Items\|Appendix)\b/` | `true` (best-effort start) | `true` |
| `poisons`            | `/^Poisons$/`                                   | `/^(Magic Items\|Monsters\|Appendix)\b/`                    | `true` (best-effort start) | `true` |
| `madness`            | `/^Madness$/`                                   | `/^Objects$/`                                                | `true` (best-effort start) | `true` |
| `objects`            | `/^Objects$/`                                   | `/^Poisons$/`                                                | `true` (best-effort start) | `true` |
| `hazards`            | `/^Dungeon Hazards$\|^Hazards$/`               | `/^(Traps\|...)$/i`                                         | `true` (best-effort) | `true`         |
| `equipment`          | `/^Equipment$/`                                | `/^(Mounts and Vehicles\|...\|Feats)$/i`                    | `true`              | `true`          |
| `mountsAndVehicles`  | `/^Mounts and Vehicles$/`                      | `/^(Trade Goods\|Expenses\|...\|Feats)$/i`                  | false (best-effort; parser is header-bounded) | `true` |
| `magicItemRules`     | `/^Magic Items$/`                              | `/^Magic Items A-Z$/`                                   | `true` (best-effort start) | `true`     |
| `magicItems`         | `/^Magic Items A-Z$/`                          | `/^(Sentient Magic Items\|Artifacts\|Monsters\|Appendix)\b/i` | `true`            | `true`          |
| `artifacts`          | `/^Artifacts$/`                                | `/^(Monsters\|Appendix)\b/i`                            | `true` (best-effort start) | `true`     |
| `treasureTables`     | `/^Treasure$/`                                 | `/^Using (a )?Magic Items?$/i`                          | `true` (best-effort) | false          |
| `multiclassing`      | `/^Multiclassing$/`                            | `/^(Proficiencies\|...)/i`                                  | false (best-effort) | `true`         |
| `beyondFirstLevel`   | `/^Beyond 1st Level$/`                         | `/^(Backgrounds\|Equipment\|Feats\|...\|Appendix)\b/`        | `true` (best-effort start) | `true`     |
| `backgrounds`        | `/^Backgrounds$/`                              | `/^(Equipment|Feats|...)$\|^Appendix/`                    | `true` (best-effort start) | `true`     |
| `expenses`           | `/^Trade Goods$/`                              | `/^(Feats?\|Using Ability Scores\|...\|Appendix)\b/`         | `true` (best-effort start) | `true`     |

Anchors are deliberately tight (`^...$`) so a body-prose mention of a chapter
title can't false-positive. Tests in `test/importers/dnd5e-srd-5.1/sections.test.ts`
cover both the happy paths and the fail-closed behavior. Callers can override
the live table via the `sectionAnchors` option on `runImporter` -- useful if a
future vendored PDF uses variant heading text.

## Adding a new record kind

To add a parser for a new kind (e.g. creatures, classes, conditions):

1. **Add a new anchor entry** to `SRD_5_1_DEFAULT_SECTION_ANCHORS` in
   `sections.ts` (and to `Srd51SectionAnchors`). Pick regexes that match the
   exact chapter heading text observed in the vendored PDF. Default to
   `requireEndHeading: true` unless the section legitimately runs to EOF --
   failing closed is the whole point of the slicer.
2. **Write the kind parser** under `scripts/importers/dnd5e-srd-5.1/` (e.g.
   `parseCreatures.ts`). It must accept a narrowed `readonly PageText[]` --
   never re-slice the full PDF. The parser is responsible only for its
   chapter's grammar; the orchestrator guarantees the input doesn't span
   adjacent chapters.
3. **Wire the orchestrator**: in `runImporter` (`index.ts`), call
   `sliceSection(pages, anchors.<newKind>)` and pass the result to the new
   parser. Feed its output into `buildPack`.
4. **Update `emit.ts` / `buildPack`** if the new kind requires a new
   record-builder branch.
5. **Add tests**: unit tests for the parser (against inline SRD text excerpts,
   like `parseSpells.test.ts`), an anchor sanity test in `sections.test.ts`,
   and an end-to-end fixture page in `pipeline.test.ts` exercising the new
   slice through the orchestrator. The pipeline test should also assert that
   text from the new chapter does not bleed into adjacent kinds (and vice
   versa).
6. **Update the "Scope today" table** above when the new kind ships.

Per the `loreweaver-0m9.5` scope rule, the importer must not emit empty stubs
for kinds it does not yet cover -- landing a stub parser without real
extraction would let the generated pack pose as more complete than it is.

## Source-structure coverage gate

The importer is self-auditing against the source PDF (eshyra-4a7.1): every
source structure the PDF's own typography identifies must be accounted for,
or the import refuses to write a pack.

**Inventory** (`sourceInventory.ts`): a pure scan of the extracted
`PageText[]` driven by per-line rendered font heights (`lineHeights`).
Measured tier map for the vendored `SRD_CC_v5.1.pdf`:

| height | tier         | examples                                              |
| ------ | ------------ | ----------------------------------------------------- |
| ≈25.9  | `chapter`    | chapter titles, class names                           |
| ≈18.0  | `section`    | section titles ("Spell Lists", "Sacred Oaths")        |
| ≈13.9  | `subsection` | subsection headings, subclass names                   |
| ≈12.0  | `leaf`       | spells, magic items, creatures, features, captions    |
| ≈10.8  | `sidebar`    | gray callout-box headings                             |
| ≈10.0  | (excluded)   | page-1/2 legal front matter                           |
| ≈9.8   | (excluded)   | body prose                                            |
| ≈8.9   | table cells  | become `table-shape` runs / `table-caption` evidence  |

Structural classification on top of the tiers: a heading followed by a
size/type/alignment line is a `stat-block`; a heading followed by
table-cell-height lines is a `table-caption`; a table-cell run not owned by a
caption is a `table-shape` item of its own.

**Coverage** (`sourceInventoryCoverage.ts`): every inventory item resolves to
exactly one status — name auto-match against the emitted records first, then
the curated `SRD_5_1_COVERAGE_RULES` (first match wins), then a
document-structure default for unmatched chapter/section tiers, else
`unaccounted`, which makes `runImporter` throw before writing anything. The
gate is opt-in per run (`RunImporterInput.sourceCoverageRules`) because
fixture PDFs render at one body size and carry no tier signal; the CLI and
`verify:dnd5e-srd-pack` always pass the curated rules.

**Artifacts**: a gated run writes two review artifacts next to the pack
files (the pack loader reads only `manifest.json`/`records.json` by name and
tolerates them):

- `source-inventory.json` — the raw inventory:
  `[{ page, lineIndex, text, tier, structure, section, context }, …]`.
- `source-coverage.json` — `{ summary, entries }` where `summary` rolls up
  counts (per ignore reason and per known-gap bead) and each entry carries
  the item's locator fields plus a one-line `status`:
  `record:<key>` | `child-of:<key>` | `ignored:<reason>` |
  `known-gap:<beadId>` | `unaccounted`.

**Rule curation lifecycle**: rules are predicates over understood classes of
source structure, never per-item allowlists. `ignored` is reserved for
genuine non-content (e.g. spell-list level headers; equipment tables whose
rows ARE the equipment records) and documented intentional exclusions.
Anything that should become a record or child data is a
`known-gap:<beadId>` pointing at the bead that will close it — when that
bead lands and starts emitting the records, the auto-match claims the items,
the known-gap rule is REMOVED, the canonical artifacts are regenerated, and
the sentinel tests in `srdSourceInventoryArtifact.test.ts` are updated in
the same change. Leaving a stale known-gap rule in place would let a future
regression of that coverage pass silently.

`verify:dnd5e-srd-pack` byte-diffs the regenerated artifacts against the
committed copies (the same exact-match contract as `records.json`), and the
audit bundle copies both artifacts into `reports/` with the accounting
summary in `metadata.json`. The hand-curated name lists in
`sourceCoverage.ts` remain as an independent source-truth regression net;
the typography inventory is the structural superset that also catches
structures nobody has listed yet.

## Determinism

The importer is deterministic in two senses:

- **Byte-stable output**: given identical input PDF bytes, two runs produce
  byte-identical `manifest.json` + `records.json` files. `JSON.stringify`
  preserves object insertion order; the record builder uses literal field
  order; `Map.set` insertion order is also preserved.
- **Source pin**: the PDF's SHA-256 is computed and embedded in
  `manifest.json` under `source.sourceHash`, so any byte-level swap of the
  source artifact is detectable on the next run.

## Testing

- `packages/core/test/importers/dnd5e-srd-5.1/parseSpells.test.ts` -- unit
  tests for the spell parser against inline real SRD 5.1 spell text excerpts
  (used under CC-BY-4.0; attribution preserved in the test file header).
- `packages/core/test/importers/dnd5e-srd-5.1/emit.test.ts` -- emitter
  determinism: two passes over the same input produce byte-identical files;
  output passes `validateRulesPack`.
- `packages/core/test/importers/dnd5e-srd-5.1/parseTables.test.ts` -- unit
  tests for the freestanding table parser, including Madness wrapped rows,
  both Object Hit Points extraction layouts, trap/DC tables, treasure
  column-block reconstruction, and incomplete tables that must fail closed.
- `packages/core/test/importers/dnd5e-srd-5.1/parseDocumentTables.test.ts` --
  unit tests for the document-wide table parser against synthetic tiered
  fixtures: one representative table per row rule, the shared-caption
  Draconic Ancestry disambiguation, cross-page cell runs, item-anchored scans
  that must abort at the next heading, prose sidebars at cell height, and
  fail-closed row-count/header drift.
- `packages/core/test/importers/dnd5e-srd-5.1/parseGamemasteringRules.test.ts`
  -- unit tests for the five Madness/Objects prose records and table-row
  exclusion.
- `packages/core/test/importers/dnd5e-srd-5.1/pipeline.test.ts` -- end-to-end
  test against a small fixture PDF generated at test time via `pdfkit`, to
  exercise the full extract -> parse -> emit pipeline without requiring the
  full SRD PDF to be present. The fixture includes a bounded treasure section
  so `runImporter` must emit both individual-treasure and treasure-hoard table
  records.
