# Record Counts — `rules:dnd5e-srd-5.1` (commit `0f5b3dc`)

Authoritative `countsByKind` from `auditPack` (committed pack). Total: **1811**.

## By kind

| Kind | Count | Notes |
| --- | ---: | --- |
| action | 10 | Combat actions (Attack, Dash, Dodge, …). |
| ancestry | 13 | 9 base races + 4 subraces (`subraceOf` / `subraces` link them). |
| background | 1 | Acolyte (only SRD background). |
| class | 12 | Barbarian … Wizard. Each has a 20-row progression `table:`. |
| condition | 15 | 14 standard conditions + Exhaustion. |
| creature | 317 | 296 monsters (p.261–357) + 21 NPCs (p.394–403). 30 carry legendary actions; 2 carry `variants` (Giant Rat, Swarm of Insects). |
| equipment | 218 | gear 112, weapon 37, tool 35, armor 13, mount 8, pack 7, vehicle 6. |
| feat | 1 | Grappler (only SRD feat). |
| feature | 183 | Class/subclass features. |
| hazard | 25 | 8 traps + 14 poisons + 3 diseases (shared `hazard` kind). |
| magic-item | 240 | 125 require attunement; includes the Orb of Dragonkind artifact. |
| rule | 335 | Rules text, section intros, variants, stat-block-reading rules. |
| spell | **319** | Every spell appears on ≥1 class list (proven bidirectionally). |
| stat-block | 2 | Inline: Avatar of Death (Deck of Many Things), Giant Fly (Figurine of Wondrous Power). |
| subclass | 12 | One per class. |
| table | **108** | 1077 rows total; 0 structural issues; column-counts 2–15. |

## Reconciliation with `verify:dnd5e-srd-pack` importer categories

The importer prints category counts that map onto final `kind` as follows:

```
319 spells                          -> spell 319
296 creatures + 21 NPCs             -> creature 317
12 classes / 12 subclasses          -> class 12 / subclass 12
183 features                        -> feature 183
15 conditions                       -> condition 15
1 feat                              -> feat 1
0 env-hazards + 8 traps + 3 diseases + 14 poisons -> hazard 25
10 actions                          -> action 10
335 rules                           -> rule 335
108 tables                          -> table 108
218 equipment                       -> equipment 218
240 magic items                     -> magic-item 240
13 ancestries / 1 background        -> ancestry 13 / background 1
(2 inline stat blocks)              -> stat-block 2
                                       ------------------------------
                                       TOTAL 1811
```

## Table coverage highlights (108 tables)

- 12 class-progression tables: `The Barbarian` … `The Wizard` (20 rows each).
- Half-Dragon: `Half-Dragon Breath Weapon`, `Half-Dragon Damage Resistance`.
- Pantheons: `Celtic`/`Egyptian`/`Greek`/`Norse Deities`.
- Sentient items: Alignment / Communication / Senses / Special Purpose.
- Subclass spells: `Oath of Devotion Spells`, `Fiend Expanded Spells`, the 7
  `Circle of the Land (…)` tables, `Life Domain Spells`,
  `Draconic Bloodline Draconic Ancestry`.
- Magic-item tables: `Teleport Familiarity`, `Deck of Many Things`,
  `Necklace of Prayer Beads`, `Sphere of Annihilation`, `Staff of Power`, etc.
- Armor/weapon/gear **stats are decomposed into the 218 per-item equipment
  records** rather than monolithic table records; the meta-tables that remain
  (`Donning and Doffing Armor`, `Trade Goods`, `Services`, `Object Armor Class`,
  …) are present as `table:` records.
