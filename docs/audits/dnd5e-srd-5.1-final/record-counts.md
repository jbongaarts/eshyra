# Record Counts — `rules:dnd5e-srd-5.1` (commit `0f5b3dc`)

Authoritative `countsByKind` from `auditPack` (committed pack). Total: **1812**. (eshyra-o9bd.2/.3 split Rogue's Thieves' Cant into its own feature: 1811 → 1812, feature 183 → 184.)

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
| feature | 184 | Class/subclass features. |
| hazard | 25 | 8 traps + 14 poisons + 3 diseases (shared `hazard` kind). |
| magic-item | 240 | 125 require attunement; includes the Orb of Dragonkind artifact. |
| rule | 335 | Rules text, section intros, variants, stat-block-reading rules. |
| spell | **319** | Every spell appears on ≥1 class list (proven bidirectionally). |
| stat-block | 2 | Inline: Avatar of Death (Deck of Many Things), Giant Fly (Figurine of Wondrous Power). |
| subclass | 12 | One per class. |
| table | **108** | 1077 rows total; 0 structural issues; column-counts 2–15. |

## Reconciliation with importer hazard families

`verify:dnd5e-srd-pack` and `import:dnd5e-srd` print final record-kind counts.
The `hazard` kind maps to importer parser families as follows:

```
0 env-hazards + 8 traps + 3 diseases + 14 poisons -> hazard 25
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
