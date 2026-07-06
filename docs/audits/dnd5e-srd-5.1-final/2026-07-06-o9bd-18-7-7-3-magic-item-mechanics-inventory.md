# eshyra-o9bd.18.7.7.3 — Exhaustive clause-level mechanics inventory of all SRD magic items

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.7.3` (parent epic
`eshyra-o9bd.18.7.7`).

**Coverage: COMPLETE — all 240 `magic-item:*` records** in
`packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`
(mechanically enumerated 2026-07-06; do not trust older 210/216 estimates).
Every record's full pack description was read and every deterministic
mechanical clause was assigned an owner. **Do not repeat this audit.** Derive
implementation slices from §4/§5.

## 0. Corpus and current-structure facts (mechanically derived)

- 240 `magic-item` records; the pack total is 1812 records.
- Schema: `magic-item` validates as `baseObjectKind` only
  (`packages/core/src/rules/kindSchemas.ts:2077`) — **no `mechanics` field
  exists for this kind**; all gameplay behavior lives in
  `data.description` prose.
- Structured fields already present: `itemType`, `rarity`,
  `requiresAttunement` (125 true / 115 false), `attunementRequirement`
  (26 records), `tableRefs` (29 records), `statBlockRefs` (2:
  deck-of-many-things, figurine-of-wondrous-power), `variants` (1:
  figurine-of-wondrous-power).
- Readiness dispositions in
  `packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts`: the
  `magic-item#partial-structure` and `magic-item#prose-only` buckets — no
  per-item mechanics evidence.
- Verified gap: the Orb of Dragonkind's "Random Properties" clause
  references artifact beneficial/detrimental property tables that **do not
  exist in the SRD 5.1 pack** (checked 2026-07-06: no matching `table:*`
  records) — that clause is design-blocked at the source level (GM-supplied
  content), not an importer defect.
- Inline-variant structuring gaps (variants in prose with no `variants`
  field): **ioun-stone** (13 variants), **crystal-ball** (3 legendary
  variants), **ring-of-elemental-command** (4 planes × unlock tiers),
  **feather-token** (6 kinds; has tableRef), **carpet-of-flying** /
  **belt-of-giant-strength** / **potion-of-giant-strength** /
  **horn-of-valhalla** (variant data lives in the ref'd tables — adequate).

## 1. Clause-owner vocabulary (final taxonomy, derived from the full corpus)

Every deterministic clause of every item is assigned exactly one owner tag;
items are split across owners freely (an item is **not** "done" because one
clause is owned — the epic's known failure mode).

Existing owners:

- **S** — already structured in the pack with evidence (the §0 fields).
- **C1** = `eshyra-o9bd.18.7.7.1` (charges/recharge/use economies): charge
  counts and dice, recharge timing (dawn/dusk/hour/days), per-day and
  cooldown uses, at-will markers, consumable depletion/destruction clauses
  (incl. last-charge d20 destruction rolls), command-word activation data,
  use-budget economies (boots-of-speed 10-minute pool, winged-boots
  4-hour/12-hour pool, candle burn minutes).
- **C2** = `eshyra-o9bd.18.7.7.2` (combat bonuses & defensive effects):
  attack/damage/AC/save numeric bonuses (incl. rarity-scaled +1/+2/+3),
  conditional/type-scoped riders (extra dice vs dragon/giant/undead…),
  crit riders and thresholds, save-DC'd damage/condition effects,
  resistance/immunity/vulnerability, advantage/disadvantage grants,
  spell-grant projections (which spell, fixed or own DC, level,
  targeting restrictions), activation requirements.

Residual families (new; §4 defines each with exact membership):

- **M1** consumables & single-use payloads
- **M2** passive character-rule modifiers (ability score set/raise/cap,
  PB/DC/AC-formula changes, hp-max modifiers, proficiency & language
  grants, death/rest rule hooks)
- **M3** movement, senses & environmental adaptation
- **M4** summoning & controlled-entity lifecycles
- **M5** activated forms, devices, zones & apparatus state
- **M6** extradimensional containment, storage & portals
- **M7** curses, oaths & behavioral restrictions
- **M8** random-procedure devices
- **M9** spell storage & spell-slot interop
- **M10** roll manipulation (rerolls, save replacement/flip, check doubling)
- **M11** inter-item interactions

Other tags: **DB** — design-blocked clause (exact reason/owner in the row);
**NM** — genuinely non-mechanical flavor clause (never the whole item — 0 of
240 items are purely non-mechanical); **F#-hook** — the clause must
integrate with a Phase 1 engine family from
`2026-07-06-o9bd-18-7-8-execution-boundary-classification.md` (F2 action
economy, F3 concentration, F4 spell slots, F6 death/temp-HP, F7 rest).

## 2. Master inventory (all 240 items, by key; `magic-item:` prefix elided)

| key | owners | clause dispositions |
|---|---|---|
| adamantine-armor | C2 | crit-against-wearer→normal-hit: C2 |
| ammunition-1-2-or-3 | C2,C1 | +N atk/dmg by rarity: C2; nonmagical-after-hit depletion: C1 |
| amulet-of-health | M2 | Con set to 19 (floor semantics): M2 |
| amulet-of-proof-against-detection-and-location | C2 | divination-targeting/scrying immunity: C2 |
| amulet-of-the-planes | C2,M8 | action + DC15 Int gate + plane shift cast: C2; d100 mishap procedure (inline in prose, no table record): M8 |
| animated-shield | C2,M5,C1 | hands-free shield AC: C2; bonus-action animation, 1-min duration/termination: M5; command word: C1 |
| apparatus-of-the-crab | S,M5 | levers table: S; vehicle state machine, object stats, air supply, depth damage: M5 |
| armor-1-2-or-3 | C2 | +N AC by rarity: C2 |
| armor-of-invulnerability | C2,C1 | nonmagical-damage resistance; action→10-min immunity: C2; 1/dawn: C1 |
| armor-of-resistance | C2,S | resistance one type: C2; type table: S |
| armor-of-vulnerability | C2,M7 | resistance clause + vulnerability×2 math: C2; curse attach/reveal/removal semantics: M7 |
| arrow-catching-shield | C2 | +2 AC vs ranged; reaction redirect-to-self: C2 |
| arrow-of-slaying | C2,C1 | type-scoped DC17 Con save 6d10/half: C2; becomes-nonmagical depletion: C1 |
| bag-of-beans | C1,C2,M8,S | 3d4 bean count/depletion: C1; dump explosion DC15 Dex 5d4: C2; plant→random effect: M8; effects table: S |
| bag-of-devouring | M6 | devouring orifice, 50% pull-in, escape/rescue DCs, devour-at-turn-start, daily swallow-to-plane: M6 |
| bag-of-holding | M6,M11 | capacity/weight, rupture, suffocation timer, turn-inside-out: M6; nesting→astral gate: M11 |
| bag-of-tricks | C1,M4,S | 3 pulls/dawn: C1; creature creation, dawn/0-hp vanish, bonus-action command: M4; 3 color tables: S |
| bead-of-force | M1,C2,M5 | per-bead single use: M1; DC15 Dex 5d4 force: C2; 1-min force sphere entrapment/push/move rules: M5 |
| belt-of-dwarvenkind | M2,C2,M3,NM | Con +2 (max 20), Dwarvish: M2; adv Persuasion (dwarves), non-dwarf adv saves vs poison + poison resistance: C2; darkvision 60: M3; beard chance: NM |
| belt-of-giant-strength | M2,S | Str set by belt score (floor semantics): M2; score-by-variant table: S |
| berserker-axe | C2,M2,M7 | +1 atk/dmg: C2; hp-max +1/level: M2; curse (unwilling to part, disadv other weapons, DC15 Wis berserk forced-attack state): M7 |
| boots-of-elvenkind | C2 | silent steps + adv Stealth (silent): C2 |
| boots-of-levitation | C2,C1 | levitate self at will: C2 (grant) + C1 (at-will economy) |
| boots-of-speed | M5,M3,C2,C1 | heel-click toggle: M5; walking speed ×2: M3; OA disadv: C2; cumulative 10-min budget, long-rest reset: C1 (hard case) |
| boots-of-striding-and-springing | M3 | speed floor 30, no encumbrance/heavy-armor reduction; jump ×3 capped by movement: M3 |
| boots-of-the-winterlands | C2,M3 | cold resistance: C2; ignore ice/snow difficult terrain, −50°F tolerance: M3 |
| bowl-of-commanding-water-elementals | C1,M4 | 1/dawn: C1; summon as conjure elemental: M4 |
| bracers-of-archery | M2,C2 | longbow/shortbow proficiency: M2; +2 damage with them: C2 |
| bracers-of-defense | C2 | +2 AC when unarmored/shieldless: C2 |
| brazier-of-commanding-fire-elementals | C1,M4 | as bowl (fire): C1+M4 |
| brooch-of-shielding | C2 | force resistance; magic-missile immunity: C2 |
| broom-of-flying | M5,M3 | rideable animation + remote travel commands: M5; fly 50 (30 over 200 lb), 400-lb cap: M3 |
| candle-of-invocation | C1,C2,M9 | 4-hour burn budget in 1-min increments, destruction: C1; alignment-matched adv zone + gate cast (destroys): C2; 1st-level free casting for matching cleric/druid in light: M9 |
| cape-of-the-mountebank | C2,C1,NM | dimension door cast: C2; 1/dawn: C1; smoke obscurement flavor: NM |
| carpet-of-flying | M5,M3,S | command-word vehicle: M5; fly speed by size, half over capacity: M3; size table: S |
| censer-of-controlling-air-elementals | C1,M4 | as bowl (air) |
| chime-of-opening | C1,M5 | 10 uses then cracks: C1; open lock/latch at 120 ft, sound-path requirement: M5 |
| circlet-of-blasting | C2,C1 | scorching ray at fixed +5: C2; 1/dawn: C1 |
| cloak-of-arachnida | C2,M3,C1 | poison resistance; web spell DC13: C2; climb speed = walk, ceiling movement, web immunity/web-as-difficult-terrain: M3; web 1/dawn: C1 |
| cloak-of-displacement | C2,M5 | attackers disadv: C2; suppression on damage until next turn + incapacitated/restrained suppression: M5 |
| cloak-of-elvenkind | C2,M5 | Perception disadv vs you, adv Stealth: C2; hood up/down action toggle: M5 |
| cloak-of-protection | C2 | +1 AC and saves: C2 |
| cloak-of-the-bat | C2,M3,M5,C1 | adv Stealth: C2; fly 40 in dim/darkness w/ grip conditions: M3; polymorph self into bat: M5; 1/dawn: C1 |
| cloak-of-the-manta-ray | M3 | water breathing; swim 60; hood toggle: M3 |
| crystal-ball | C2,M3,C1 | scrying DC17 + detect thoughts/suggestion DC17 variant casts: C2; truesight-through-sensor variant: M3; suggestion 1/dawn: C1. Inline legendary variants not structured (§0 gap) |
| cube-of-force | C1,M5,S | 36 charges, 1d20/dawn, per-face costs, spell-contact charge losses: C1; barrier state machine (center-on-you, face switching, duration reset, solid-object blocking): M5; 2 tables: S |
| cubic-gate | C1,C2 | 3 charges, 1d3/dawn: C1; gate / plane shift DC17 casts per keyed side: C2 |
| dagger-of-venom | C2,C1,M5 | +1; DC15 Con 2d10 + poisoned 1 min: C2; 1/dawn coat: C1; coat persists 1 min or until hit: M5 |
| dancing-sword | M5,C2 | bonus-action launch, hover, per-turn flight+attack, 4-attack counter then return/fall: M5; uses your attack roll/mods: C2 |
| decanter-of-endless-water | M5,C2 | command-word water production (3 modes): M5; geyser DC13 Str 1d4 + prone / object push: C2 |
| deck-of-illusions | M8,M4,C1,S | random draw from deck missing 1d20−1 cards: M8; illusory creature persistence, movement command, DC15 investigation reveal: M4; per-card depletion: C1; card table: S |
| deck-of-many-things | M8,M7,S | declared-draw procedure, 1-hour inter-draw limit, card resolution (XP/levels, alignment flip, Euryale −2 curse, Donjon/Void soul-state, wish grants, keep/NPC outcomes): M8 (flagship; card effects are one-time GM-mediated events touching XP/advancement engine); Euryale/Donjon/Void persistent states: M7; card table + avatar-of-death stat block: S |
| defender | C2 | +3 with per-first-attack split between atk/dmg and AC until next turn: C2 (per-turn choice state noted) |
| demon-armor | C2,M2,M7 | +1 AC; unarmed 1d8 magic +1/+1: C2; Abyssal: M2; curse (can't doff; disadv attack/saves vs demons): M7 |
| dimensional-shackles | M5,C2 | bind incapacitated target, size range, designated-remover, DC30 escape 1/30-days: M5; extradimensional-movement prevention: C2 (targeting/movement immunity inverse) |
| dragon-scale-mail | C2,S,M3,C1 | +1 AC; adv saves vs dragon Frightful Presence/breath; resistance by dragon type: C2; type table: S; sense nearest dragon 30 mi: M3; 1/dawn: C1 |
| dragon-slayer | C2 | +1; +3d6 vs dragon type: C2 |
| dust-of-disappearance | M1,C2 | one use: M1; area invisibility 2d4 min, ends-on-attack/cast: C2 |
| dust-of-dryness | M1,M5,C2 | 1d6+4 pinches: M1; water-cube↔pellet state: M5; water-elemental DC13 Con 10d6: C2 |
| dust-of-sneezing-and-choking | M1,C2 | one use: M1; DC15 Con, incapacitated + suffocating, repeat saves, lesser-restoration ending: C2 |
| dwarven-plate | C2 | +2 AC; reaction reduce forced ground movement ≤10 ft: C2 |
| dwarven-thrower | C2,M5,S | +3; thrown 20/60; +1d8 (2d8 vs giant) on ranged hit: C2; returns to hand: M5; dwarf attunement: S |
| efficient-quiver | M6 | 3 extradimensional compartments w/ typed capacities, fixed 2-lb weight: M6 |
| efreeti-bottle | M8,M4,S | first-open d100 outcome: M8; efreeti service/hostility/wish outcomes and re-use rules: M4; outcome table: S |
| elemental-gem | M1,M4,S | break → consumed: M1; conjure elemental summon: M4; gem-type table: S |
| elven-chain | C2,M2 | +1 AC: C2; considered-proficient grant: M2 |
| eversmoking-bottle | M5 | cloud radius growth 60→120, open/close command state, wind dispersal tiers: M5 |
| eyes-of-charming | C1,C2 | 3 charges, all/dawn: C1; charm person DC13 w/ sight requirement: C2 |
| eyes-of-minute-seeing | C2 | adv Investigation ≤1 ft: C2 |
| eyes-of-the-eagle | C2 | adv Perception (sight): C2 |
| feather-token | M1,M4,M5,C2,S | single-use per token: M1; bird (roc servant w/ load/range budget) + whip (attack entity): M4; anchor/fan/swan-boat/tree effects: M5; whip +9 atk 1d6+5: C2; kind table: S |
| figurine-of-wondrous-power | M4,C1,C2,M8,S | become-creature lifecycle (duration caps, 0-hp/command revert): M4 (flagship); per-variant cooldown days + goat-of-traveling 24-charge hour economy: C1; goat-of-terror aura DC15 frightened + horn weapons (+1 lance/+2 longsword): C2; obsidian-steed 10% disobedience → Hades: M8; variants + giant-fly stat block: S |
| flame-tongue | M5,C2,C1 | bonus-action flame toggle: M5; +2d6 fire while ablaze; light: C2; command word: C1 |
| folding-boat | M5 | box↔boat↔ship command states w/ capacities and fold rules: M5 |
| frost-brand | C2,C1 | +1d6 cold on hit; fire resistance; light in freezing temps: C2; extinguish-flames ≤1/hour: C1 |
| gauntlets-of-ogre-power | M2 | Str set to 19 (floor): M2 |
| gem-of-brightness | C1,C2,M5 | 50 charges, per-function costs, depletion→50 gp jewel: C1; blind save DC15 beam/cone effects: C2; no-cost light toggle: M5 |
| gem-of-seeing | C1,M3 | 3 charges, 1d3/dawn: C1; truesight 120 ft for 10 min through gem: M3 |
| giant-slayer | C2 | +1; +2d6 & DC15 Str prone vs giant type: C2 |
| glamoured-studded-leather | C2,M5,NM | +1 AC: C2; appearance command toggle: M5 (cosmetic; near-NM) |
| gloves-of-missile-snaring | C2 | reaction reduce ranged-weapon damage 1d10+Dex, catch at 0: C2 |
| gloves-of-swimming-and-climbing | M3,C2 | climb/swim no extra movement: M3; +5 Athletics (climb/swim): C2 |
| goggles-of-night | M3 | darkvision 60, or +60 range if already present: M3 |
| hammer-of-thunderbolts | C2,M2,C1,M11 | +1; nat-20 vs giant DC17 Con or die; thrown thunderclap DC17 stun: C2; Str +4 (max 30): M2; 5 charges, 1d4+1/dawn: C1; attunement requires belt-of-giant-strength + gauntlets-of-ogre-power worn: M11 |
| handy-haversack | M6,M11 | pouch capacities, always-on-top retrieval, rupture, suffocation: M6; nesting→astral gate: M11 |
| hat-of-disguise | C2,C1 | disguise self at will, ends on removal: C2+C1 |
| headband-of-intellect | M2 | Int set to 19 (floor): M2 |
| helm-of-brilliance | C1,C2,M8,M5 | gem inventory (1d10/2d10/3d10/4d10) consumed as casting components: C1; daylight/fireball/prismatic-spray/wall-of-fire DC18; undead-aura 1d6 radiant; conditional fire resistance; weapon-flame +1d6: C2; d20-on-fire-damage → beams + destruction: M8; aura/flame toggles: M5 |
| helm-of-comprehending-languages | C2,C1 | comprehend languages at will: C2+C1 |
| helm-of-telepathy | C2,C1,M3 | detect thoughts DC13; suggestion DC13: C2; suggestion 1/dawn: C1; telepathic message relay while concentrating (F3-hook): M3 |
| helm-of-teleportation | C1,C2 | 3 charges, 1d3/dawn: C1; teleport cast: C2 |
| holy-avenger | C2,M5,S | +3; +2d10 radiant vs fiend/undead; aura adv saves (10 ft; 30 ft at paladin 17+): C2 (class-level scaling noted); drawn-sword aura zone: M5; paladin attunement: S |
| horn-of-blasting | C2,M8 | 30-ft cone DC15 Con 5d6 + deafened; glass disadv/10d6: C2; 20% per-use explosion (10d6 to blower, destroyed): M8 |
| horn-of-valhalla | M4,C1,S | summon berserkers by type, 1-hour service, hostile-if-requirement-unmet: M4; 7-day cooldown: C1; type/requirement table: S |
| horseshoes-of-a-zephyr | M3 | 4-shoe set condition; hover 4 in., cross nonsolid surfaces, no tracks, ignore difficult terrain, 12 h/day no forced-march exhaustion: M3 |
| horseshoes-of-speed | M3 | +30 walking speed (4-shoe set): M3 |
| immovable-rod | M5 | button toggle fixed-in-place, 8,000-lb limit, DC30 move 10 ft: M5 |
| instant-fortress | M5,C2 | deploy/dismiss fortress, geometry, door rules, wall HP/immunities, wish repair: M5; 10d10 Dex-save appearance damage + push: C2 |
| ioun-stone | M5,M2,C2,M9,M3 | orbit state, AC 24/DC 24 grab, seize/stow action: M5; ability +2 (×6 variants), Mastery PB +1: M2; Protection +1 AC, Awareness no-surprise: C2; Reserve 3-level spell storage, Absorption/Greater cancel budgets (20/50 levels): M9; Sustenance no food/water: M3; Regeneration 15 hp/hour (F6-adjacent clock healing): M2. Variants not structured (§0 gap) |
| iron-bands-of-binding | C1,M5,C2 | 1/dawn: C1; restrained state, release command, DC20 break w/ 24-h per-creature lockout after failure: M5; ranged attack Dex+PB to hit: C2 |
| iron-flask | M6,M4,C2,M8,S | one-creature containment, no aging/needs: M6; 1-hour obedient service on release: M4; DC17 Wis trap save w/ prior-trap advantage: C2; random prior contents: M8; contents table: S |
| javelin-of-lightning | C1,C2 | 1/dawn: C1; line DC13 Dex 4d6 + ranged attack w/ +4d6 rider: C2 |
| lantern-of-revealing | M3 | invisible creatures/objects visible in bright light; 6 h/pint fuel; hood action: M3 |
| luck-blade | C2,M10,C1 | +1 atk/dmg; +1 saves; wish cast: C2; reroll one d20 (no action) 1/dawn: M10; wish 1d4−1 charges, no recharge, property loss at 0: C1 |
| mace-of-disruption | C2 | +2d6 radiant vs fiend/undead; ≤25-hp DC15 Wis destroy-or-frightened; light: C2 |
| mace-of-smiting | C2 | +1 (+3 vs constructs); nat-20 +2d6 (4d6 constructs); construct ≤25-hp destruction: C2 |
| mace-of-terror | C1,C2 | 3 charges, 1d3/dawn: C1; 30-ft fear wave DC15 w/ flee behavior, repeat saves: C2 |
| mantle-of-spell-resistance | C2 | adv saves vs spells: C2 |
| manual-of-bodily-health | M2,C1 | Con +2 and max +2 (permanent): M2; 48-h/6-day study procedure (downtime-hook), century recharge: C1 |
| manual-of-gainful-exercise | M2,C1 | as bodily-health (Str) |
| manual-of-golems | M4,C1,C2,S | golem creation + control: M4; consumed on completion, reader gating (two 5th-level slots): C1; 6d6 psychic on unqualified read: C2; time/cost table: S; downtime-hook |
| manual-of-quickness-of-action | M2,C1 | as bodily-health (Dex) |
| marvelous-pigments | M1,M5 | 1d4 pots, coverage budget (1,000 sq ft/pot, 10 min/100 sq ft): M1; painted objects/terrain become real, 25-gp value cap, energy dissipates: M5 |
| medallion-of-thoughts | C1,C2 | 3 charges, 1d3/dawn: C1; detect thoughts DC13: C2 |
| mirror-of-life-trapping | M6,C2 | 12-cell containment, activation command state, trap/release/free procedures, overflow release, shatter frees, no aging/needs: M6 (flagship); DC15 Cha save (adv if known; constructs auto-succeed): C2 |
| mithral-armor | C2 | removes stealth disadvantage and Str requirement of base armor: C2 (armor-stat override) |
| necklace-of-adaptation | M3,C2 | breathe normally in any environment: M3; adv saves vs gases/vapors: C2 |
| necklace-of-fireballs | C1,C2 | 1d6+3 detachable beads, per-bead depletion: C1; fireball DC15, +1 level per extra bead in one action: C2 |
| necklace-of-prayer-beads | C1,C2,M8,S | 1d4+2 magic beads, each 1/dawn: C1; bonus-action casts w/ own save DC: C2; random bead types: M8; bead table + cleric/druid/paladin attunement: S |
| nine-lives-stealer | C2,C1 | +2; crit vs <100-hp creature DC15 Con or slain (construct/undead immune): C2; 1d8+1 charges, −1 per slay, property loss at 0: C1 |
| oathbow | M7,C2 | sworn-enemy exclusive state (one at a time, until death or 7th dawn, re-pick gate) + disadv with other weapons: M7; adv vs sworn enemy, ignore non-total cover & long-range disadv, +3d6: C2 |
| oil-of-etherealness | M1,C2 | one use, 10-min application, size scaling: M1; etherealness effect 1 h: C2 |
| oil-of-sharpness | M1,C2 | one use (weapon or ≤5 ammo), 1-min application: M1; +3 atk/dmg for 1 h: C2 |
| oil-of-slipperiness | M1,C2,M11 | one use, apply-or-pour modes: M1; freedom of movement 8 h / grease area 8 h: C2; sovereign-glue container counter-agent: M11 |
| orb-of-dragonkind | C1,C2,M7,M4,DB | 7 charges, 1d4+3/dawn, per-spell costs + free detect magic: C1; DC15 Cha control check, suggestion DC18, cure/daylight/death ward/scrying casts, destruction conditions: C2; charmed-enslavement state on failed check: M7; 40-mile dragon call compulsion, 1/hour: M4; artifact Random Properties: **DB — property tables absent from SRD 5.1 pack (verified §0); GM-supplied content** |
| pearl-of-power | C1,M9,S | 1/dawn: C1; regain one expended slot (≥4th returns as 3rd) — F4 slot-engine hook: M9; spellcaster attunement: S |
| periapt-of-health | C2 | disease immunity + suppression of existing disease: C2 |
| periapt-of-proof-against-poison | C2 | poison-damage immunity + poisoned-condition immunity, poisons no effect: C2 |
| periapt-of-wound-closure | M2 | auto-stabilize when dying at turn start (F6-hook); double HD-roll healing (F7-hook): M2 |
| philter-of-love | M1,C2 | one use: M1; charmed by next creature seen, 1 h: C2 |
| pipes-of-haunting | C1,C2 | 3 charges, 1d3/dawn: C1; DC15 Wis frightened 1 min, friendly auto-succeed option, 24-h immunity on success: C2 |
| pipes-of-the-sewers | C1,M4,C2 | 3 charges, 1d3/dawn: C1; call rat swarms (availability-gated), Cha-vs-Wis sway contest, per-round play upkeep, 24-h lockouts: M4; rat indifference passive: C2 |
| plate-armor-of-etherealness | C1,C2 | 1/dawn: C1; etherealness 10 min w/ end conditions: C2 |
| portable-hole | M6,M11 | 6-ft circle, 10-ft-deep extradimensional space, fold/unfold, DC10 escape, suffocation: M6; nesting→astral gate: M11 |
| potion-of-animal-friendship | M1,C2 | consumable: M1; animal friendship DC13 at will 1 h: C2 |
| potion-of-clairvoyance | M1,C2 | consumable: M1; clairvoyance effect: C2 |
| potion-of-climbing | M1,M3,C2 | consumable: M1; climb speed = walk 1 h: M3; adv Athletics (climb): C2 |
| potion-of-diminution | M1,M5 | consumable: M1; reduce effect 1d4 h (no concentration): M5 |
| potion-of-flying | M1,M3 | consumable: M1; fly = walk + hover 1 h, fall at expiry: M3 |
| potion-of-gaseous-form | M1,M5 | consumable: M1; gaseous form 1 h, bonus-action end: M5 |
| potion-of-giant-strength | M1,M2,S | consumable: M1; Str set by giant type (floor): M2; type table: S |
| potion-of-growth | M1,M5 | consumable: M1; enlarge 1d4 h: M5 |
| potion-of-healing | M1,C2,S | consumable: M1; HP regain by rarity: C2; potency table: S |
| potion-of-heroism | M1,C2 | consumable: M1; 10 temp HP 1 h (F6-hook) + bless (no concentration): C2 |
| potion-of-invisibility | M1,C2 | consumable: M1; invisible 1 h, ends on attack/cast: C2 |
| potion-of-mind-reading | M1,C2 | consumable: M1; detect thoughts DC13: C2 |
| potion-of-poison | M1,C2 | consumable (disguised; identify reveals): M1; 3d6 poison + poisoned w/ per-turn 3d6 and decreasing-1d6 save ladder: C2 |
| potion-of-resistance | M1,C2,S | consumable: M1; resistance 1 h: C2; type table: S |
| potion-of-speed | M1,C2 | consumable: M1; haste 1 min (no concentration): C2 |
| potion-of-water-breathing | M1,M3 | consumable: M1; water breathing 1 h: M3 |
| restorative-ointment | M1,C2 | 1d4+1 doses: M1; 2d8+2 HP + cure poison/disease per dose: C2 |
| ring-of-animal-influence | C1,C2 | 3 charges, 1d3/dawn: C1; animal friendship/fear (Int ≤3 beasts)/speak with animals DC13: C2 |
| ring-of-djinni-summoning | M4,C1 | summon named djinni, concentration ≤1 h (F3-hook), obedience, home-plane return, ring-nonmagical-on-djinni-death: M4; 24-h cooldown: C1 |
| ring-of-elemental-command | C1,C2,M2,M3,M5 | 5 charges, 1d4+1/dawn, per-spell costs: C1; adv attacks vs linked elementals + their disadv, resistances/immunity, spell casts DC17, dominate monster 2 charges: C2; plane language: M2; plane movement modes (fly/hover, water-walk, earth-glide, terrain): M3; slay-elemental progressive-unlock state: M5. Inline 4-plane variants not structured (§0 gap) |
| ring-of-evasion | C1,M10 | 3 charges, 1d3/dawn: C1; reaction: failed Dex save → success: M10 |
| ring-of-feather-falling | M3 | fall 60 ft/round, no falling damage: M3 |
| ring-of-free-action | M3,C2 | difficult terrain costs nothing: M3; immunity to magical speed reduction/paralysis/restraint: C2 |
| ring-of-invisibility | C2,M5 | invisibility (self + carried), ends on attack/cast: C2; action on / bonus-action off toggle: M5 |
| ring-of-jumping | C2,C1 | jump spell self-only at will (bonus action): C2+C1 |
| ring-of-mind-shielding | C2,M5,M7 | immunity to thought-reading/lie-detection/alignment/type divination; consent-gated telepathy: C2; ring-invisibility toggle: M5; soul-capture on death + posthumous telepathy: M7 |
| ring-of-protection | C2 | +1 AC and saves: C2 |
| ring-of-regeneration | M2 | 1d6 HP per 10 min if ≥1 HP (clock-driven healing); limb regrowth 1d6+1 days: M2 |
| ring-of-resistance | C2,S | resistance one type: C2; type table: S |
| ring-of-shooting-stars | C1,C2,M5,S | 6 charges, 1d6/dawn, per-property costs, at-will dancing lights/light (dim/darkness gate): C1; faerie fire; shooting stars DC15 Dex 5d4/mote: C2; ball-lightning spheres (1–4, damage by count, movement, discharge-on-approach, concentration-like ≤1 min; F3-hook): M5; attunement condition + damage table: S |
| ring-of-spell-storing | M9,M8 | 5-level store, cast-in mechanics, caster-of-record DC/ability, cast-out frees space: M9 (flagship); found w/ 1d6−1 levels GM-chosen: M8 |
| ring-of-spell-turning | C2,M10 | adv saves vs single-target spells: C2; nat-20 + ≤7th-level → reflect to caster: M10 |
| ring-of-swimming | M3 | swim 40: M3 |
| ring-of-telekinesis | C2,C1 | telekinesis at will, unattended objects only: C2+C1 |
| ring-of-the-ram | C1,C2 | 3 charges, 1d3/dawn: C1; +7 spectral attack, 2d10 force + 5-ft push per charge; object-break Str check +5/charge: C2 |
| ring-of-three-wishes | C1,C2 | 3 charges, no recharge, nonmagical at 0: C1; wish cast: C2 |
| ring-of-warmth | C2,M3 | cold resistance: C2; −50°F protection: M3 |
| ring-of-water-walking | M3 | stand/move on liquid surfaces: M3 |
| ring-of-x-ray-vision | M3,C1,C2 | 30-ft x-ray vision 1 min w/ material penetration spec: M3; re-use before long rest gate (F7-hook): C1; DC15 Con or exhaustion level: C2 |
| robe-of-eyes | M3,C2 | all-direction vision; darkvision 120; see invisible + Ethereal 120: M3; adv Perception (sight); light/daylight → blinded 1 min w/ per-turn saves; cannot-avert drawback: C2 |
| robe-of-scintillating-colors | C1,C2 | 3 charges, 1d3/dawn: C1; until-end-of-next-turn dazzle: attackers disadv, DC15 Wis stunned, bright light: C2 |
| robe-of-stars | C2,C1,M6 | +1 saves; pull-star magic missile (5th level): C2; 6 stars, 1d6 regrow daily at dusk: C1; action-toggle Astral Plane travel + return: M6 |
| robe-of-the-archmagi | M2,C2,S,M7 | base AC 15+Dex when unarmored; spell save DC +2 and spell attack +2: M2; adv saves vs spells/magic: C2; class attunement: S; alignment-match attunement gate: M7 (attunement-precondition note) |
| robe-of-useful-items | C1,M8,M5,S | per-patch depletion, robe→ordinary at 0: C1; 4d4 random extra patches: M8; patch→real object creation: M5; patch table: S |
| rod-of-absorption | M9,M10 | absorb targeted spell energy (reaction), lifetime 50-level budget, stored-level tracking, convert to slots ≤5th for own prepared/known spells (F4-hook), 1d10 found-state, nonmagical at exhaustion: M9 (flagship); reaction cancel: M10 |
| rod-of-alertness | C2,C1,M5,M3 | adv Perception + initiative; detect spells at will; aura +1 AC/saves: C2; aura 1/dawn: C1; planted-rod 10-min aura state: M5; sense invisible hostiles in aura: M3 |
| rod-of-lordly-might | C2,M5,C1,M3 | +3 mace; flame-tongue/battleaxe/spear forms +3; drain life DC17 4d6 + half-heal; paralyze DC17; terrify DC17; ram +10 Str checks: C2; six-button form state machine, climbing-pole anchoring: M5; drain/paralyze/terrify each 1/dawn: C1; magnetic north + depth sense: M3 |
| rod-of-rulership | C1,C2 | 1/dawn: C1; DC15 Wis charmed 8 h w/ harm/contrary-command break: C2 |
| rod-of-security | M6,C1 | extraplanar paradise, 200-visitor cap, 200-days÷visitors budget, no aging, re-entry exit rules: M6; 10-day cooldown: C1; 1-HD-equivalent healing/hour (F7-hook) |
| rope-of-climbing | M5 | command animation, 10-ft/turn movement, fasten/knot states, AC 20 / 20 HP / self-repair 1 hp/5 min: M5 |
| rope-of-entanglement | M5,C2 | entangle command, restrained state, release word, AC 20 / 20 HP / self-repair: M5; DC15 Dex save; DC15 Str/Dex escape: C2 |
| scarab-of-protection | C2,C1,M10 | adv saves vs spells: C2; 12 charges, crumbles at 0: C1; reaction: failed save vs necromancy/undead → success: M10 |
| scimitar-of-speed | C2 | +2; one bonus-action attack per turn (F2-hook): C2 |
| shield-1-2-or-3 | C2 | +N AC by rarity (stacking with shield base): C2 |
| shield-of-missile-attraction | C2,M7 | resistance to ranged-weapon damage: C2; curse: ranged attacks within 10 ft redirect to you; remove-curse-only removal: M7 |
| slippers-of-spider-climbing | M3 | climb = walk, ceilings, hands-free; slippery-surface exclusion: M3 |
| sovereign-glue | M1,M5,M11 | 1d6+1 oz, 1 oz/sq ft, 1-min set: M1; permanent bond state: M5; breakable only by universal solvent / oil of etherealness / wish; container must be slipperiness-coated: M11 |
| spell-scroll | M1,M9,S | single-use, crumbles on cast, destroyed-on-copy: M1; casting procedure (class-list gate, higher-level DC 10+level check w/ loss-on-failure, scroll-set DC/attack by level, copy DC 10+level): M9 (flagship); level/DC/attack table: S |
| spellguard-shield | C2 | adv saves vs spells/magical effects; spell attacks disadv vs you: C2 |
| sphere-of-annihilation | M5,C2,M8,S,M11 | obliteration semantics, uncontrolled/controlled states, DC25 Arcana control + contested control, movement math (5×Int mod), space-entry DC13 4d10: M5 (flagship) + C2 (contact damage); portal-contact random outcomes: M8 + table: S; talisman-of-the-sphere / portal / extradimensional interactions: M11 |
| staff-of-charming | C1,C2,M10,S | 10 charges, 1d8+2/dawn, last-charge d20 (1: nonmagical): C1; charm person/command/comprehend languages at own DC: C2; save-flip vs enchantment 1/dawn + reflect-on-success w/ 1 charge: M10; class attunement: S |
| staff-of-fire | C1,C2,S | 10 charges, 1d6+4/dawn, last-charge d20 destruction: C1; fire resistance; burning hands/fireball/wall of fire at own DC: C2; class attunement: S |
| staff-of-frost | C1,C2,S | as staff-of-fire (cold; cone of cold/fog cloud/ice storm/wall of ice) |
| staff-of-healing | C1,C2,S | 10 charges, 1d6+4/dawn, d20 vanish: C1; cure wounds (1 charge/level ≤4th), lesser restoration, mass cure wounds w/ own DC/mod: C2; class attunement: S |
| staff-of-power | C1,C2,M8,S | 20 charges, 2d8+4/dawn, last-charge d20 dual outcome (1: lose powers; 20: regain 1d8+2): C1; +2 weapon; +2 AC/saves/spell attacks; power strike +1d6/charge; 9-spell list w/ costs: C2; retributive strike (50% planar escape, 16×charges self-damage, distance-banded DC17 area damage): M8; attunement + damage table: S |
| staff-of-striking | C1,C2 | 10 charges, 1d6+4/dawn, d20 depletion: C1; +3; +1d6 force per charge (≤3): C2 |
| staff-of-swarming-insects | C1,C2,M5,S | 10 charges, 1d6+4/dawn, d20 destruction: C1; giant insect/insect plague: C2; 30-ft insect-cloud obscurement 10 min: M5; class attunement: S |
| staff-of-the-magi | C1,C2,M9,M8,S | 50 charges, 4d6+2/dawn, last-charge d20 (20: regain): C1; +2 weapon/spell attacks; adv saves vs spells; 13-spell charged list + 6 free casts: C2; spell absorption → charges w/ >50 overflow explosion: M9; retributive strike: M8; attunement + damage table: S |
| staff-of-the-python | M4,M5,S | snake form under owner control, mental command, 0-hp death → staff shatters, early revert heals: M4+M5; class attunement: S |
| staff-of-the-woodlands | C1,C2,M5,S | 10 charges, 1d6+4/dawn, d20 depletion: C1; +2 weapon/spell attacks; 7-spell list + free pass without trace: C2; tree form plant/revert: M5; druid attunement: S |
| staff-of-thunder-and-lightning | C1,C2 | 5 named properties each 1/dawn + combined property meta-use: C1; lightning +2d6; thunder DC17 stun; line 9d6 DC17; thunderclap 2d6 DC17 deafened: C2 |
| staff-of-withering | C1,C2,S | 3 charges, 1d3/dawn: C1; +2d10 necrotic/charge; DC15 Con or disadv Str/Con checks+saves 1 h: C2; class attunement: S |
| stone-of-controlling-earth-elementals | C1,M4 | 1/dawn, ground-contact gate: C1; conjure-elemental summon: M4 |
| stone-of-good-luck-luckstone | C2 | +1 ability checks and saves: C2 |
| sun-blade | C2,M5,M2 | +2; radiant damage; +1d8 vs undead; finesse: C2; blade toggle + adjustable light radius (sunlight): M5; shortsword/longsword proficiency extension: M2 |
| sword-of-life-stealing | C2 | nat-20: +3d6 necrotic (not construct/undead), wielder gains equal temp HP (F6-hook): C2 |
| sword-of-sharpness | C2,M8,M5 | maximize damage dice vs objects; nat-20 +4d6 + nested d20 (20: sever limb, GM effect): C2+M8; light command toggle: M5 |
| sword-of-wounding | M7,C2 | wound counters (1d4/wound at turn start), once-per-turn application, DC15 Con or Medicine ending, hp-loss recoverable only via rest (healing suppression; F6/F7-hooks): M7; hit application: C2 |
| talisman-of-pure-good | C2,C1,M7,S | touch damage by alignment (6d6/8d6 radiant, per-turn); +2 spell attacks (good cleric/paladin); fissure DC20 Dex destroy: C2; 7 charges, destroyed at 0: C1; alignment interaction/eligibility: M7; good-creature attunement: S |
| talisman-of-the-sphere | M11,M10,C2 | modifies sphere-of-annihilation control: M11; double PB on control checks: M10; enhanced levitation math: C2 |
| talisman-of-ultimate-evil | C2,C1,M7,S | mirror of pure-good (necrotic; 6 charges): same owners |
| tome-of-clear-thought | M2,C1 | Int +2 and max +2 (permanent): M2; study procedure + century recharge: C1 |
| tome-of-leadership-and-influence | M2,C1 | as clear-thought (Cha) |
| tome-of-understanding | M2,C1 | as clear-thought (Wis) |
| trident-of-fish-command | C1,C2 | 3 charges, 1d3/dawn: C1; dominate beast DC15, innate-swim targets only: C2 |
| universal-solvent | M1,M11 | tube contents, per-use pour: M1; dissolves 1 sq ft adhesive incl. sovereign glue: M11 |
| vicious-weapon | C2 | nat-20: +2d6 weapon-type damage: C2 |
| vorpal-sword | C2 | +3; ignores slashing resistance; nat-20 vs headed creature: decapitate w/ immunity conditions, else +6d8: C2 |
| wand-of-binding | C1,C2,S | 7 charges, 1d6+1/dawn, d20 destruction: C1; hold monster/person DC17; assisted-escape adv (1 charge, reaction): C2; spellcaster attunement: S |
| wand-of-enemy-detection | C1,M3 | 7 charges, 1d6+1/dawn, d20 destruction: C1; nearest-hostile direction sense 60 ft 1 min (incl. ethereal/invisible/hidden): M3 |
| wand-of-fear | C1,C2 | 7 charges, 1d6+1/dawn, d20 destruction: C1; command (flee/grovel) DC15; 60-ft fear cone DC15 w/ behavior: C2 |
| wand-of-fireballs | C1,C2,S | 7 charges, multi-charge upcasting (3rd +1/charge), 1d6+1/dawn, d20 destruction: C1; fireball DC15: C2; spellcaster attunement: S |
| wand-of-lightning-bolts | C1,C2,S | as fireballs (lightning bolt) |
| wand-of-magic-detection | C1,C2 | 3 charges, 1d3/dawn: C1; detect magic: C2 |
| wand-of-magic-missiles | C1,C2 | 7 charges, upcasting, 1d6+1/dawn, d20 destruction: C1; magic missile: C2 |
| wand-of-paralysis | C1,C2,S | 7 charges, 1d6+1/dawn, d20 destruction: C1; ray, DC15 Con paralyzed 1 min w/ repeat saves: C2; spellcaster attunement: S |
| wand-of-polymorph | C1,C2,S | 7 charges, 1d6+1/dawn, d20 destruction: C1; polymorph DC15: C2; spellcaster attunement: S |
| wand-of-secrets | C1,M3 | 3 charges, 1d3/dawn: C1; nearest secret door/trap pointer 30 ft: M3 |
| wand-of-the-war-mage-1-2-or-3 | C2,S | +N spell attack by rarity; ignore half cover on spell attacks: C2; spellcaster attunement: S |
| wand-of-web | C1,C2,S | 7 charges, 1d6+1/dawn, d20 destruction: C1; web DC15: C2; spellcaster attunement: S |
| wand-of-wonder | C1,M8,S | 7 charges, 1d6+1/dawn, d20 destruction: C1; d100 table procedure w/ range/centering/random-subject meta-rules: M8 (flagship); table + spellcaster attunement: S |
| weapon-1-2-or-3 | C2 | +N atk/dmg by rarity: C2 |
| well-of-many-worlds | M6,C1 | two-way portal to GM-determined world/plane, fold-to-close: M6; 1d8-hour cooldown: C1 |
| wind-fan | C2,C1,M8 | gust of wind DC13: C2; 1/dawn: C1; cumulative 20% per-early-reuse failure + destruction: M8 |
| winged-boots | M3,C1 | fly = walking speed; 30-ft/round descent at expiry: M3; 4-hour flight budget (1-min increments), regain 2 h per 12 h unused: C1 (hard case) |
| wings-of-flying | M3,C1,M5 | fly 60: M3; 1-h duration, 1d12-h cooldown: C1; cloak↔wings form toggle: M5 |

## 3. Census and mechanical verification

Item-level dispositions (an item is **existing-owned** only if every
deterministic clause is C1, C2, or S; any M-family clause makes it
**residual**; DB is clause-level):

- **240 items total; 0 fully modeled today** (no `mechanics` field exists);
  **0 purely non-mechanical** (every item carries at least one deterministic
  clause; NM appears only as clause-level flavor on 3 rows).
- **Existing-owned (every clause C1/C2/S, no M-tag): 75.**
- **Residual (≥1 M-family clause): 165**, of which every clause still has an
  exact owner among M1–M11 (+ engine hooks).
- **Design-blocked clauses: 1** (orb-of-dragonkind artifact Random
  Properties — SRD source gap, GM-supplied).
- Row-tag frequencies (mechanically recomputed from the §2 table
  2026-07-06; regenerate on change): C1 = 105, C2 = 169, S = 50, M1 = 31,
  M2 = 23, M3 = 38, M4 = 17, M5 = 50, M6 = 10, M7 = 12, M8 = 18, M9 = 7,
  M10 = 7, M11 = 9, DB = 1, NM = 3. (75 + 165 = 240.)

Verification (run 2026-07-06; script in the landing PR): §2 key set was
mechanically compared against the 240 `magic-item:*` keys enumerated from
the committed pack — **exact equality, no duplicates, no omissions, no stale
keys**; per-tag counts above were recomputed from the table.

## 4. Residual implementation families (exact memberships from §2)

Membership lists below are the §2 rows carrying the tag (authoritative:
grep the table; counts match §3).

- **M1 — consumables & single-use payloads** (31): the potions (17), oils
  (3), dusts (3), restorative-ointment, philter-of-love, bead-of-force,
  elemental-gem, feather-token, marvelous-pigments, sovereign-glue,
  universal-solvent, spell-scroll. Shape: consumption event (remove_item /
  dose decrement) + typed effect payload reusing the C2 shapes + duration.
  Flagship: **spell-scroll** (class-gate + level-check casting procedure).
  Agent: Codex rollout once C1/C2 shapes exist; Opus for the scroll
  procedure design.
- **M2 — passive character-rule modifiers** (23): score-set-with-floor
  (amulet-of-health, gauntlets, headband, belts/potions of giant strength),
  score +2 w/ cap (belt-of-dwarvenkind, ioun variants), permanent +2 score &
  cap (3 manuals + 3 tomes), Str +4 max 30 (hammer), hp-max/level
  (berserker-axe), PB +1 (ioun Mastery), AC formula 15+Dex + DC/attack +2
  (robe-of-the-archmagi), proficiency grants (bracers-of-archery,
  elven-chain, sun-blade), languages, death/rest hooks
  (periapt-of-wound-closure F6/F7), clock healing (ring-of-regeneration,
  ioun Regeneration). Agent: Codex (regular shapes; Opus review of
  floor/cap semantics once).
- **M3 — movement, senses & environmental adaptation** (38): speed
  set/floor/increase/multiply, fly/swim/climb grants, hover, water-walk,
  feather-fall, terrain exemptions, jump multipliers, temperature/breath
  adaptation, sustenance; darkvision/truesight/see-invisible/x-ray/
  direction-sense/detection pointers. Agent: Codex.
- **M4 — summoning & controlled-entity lifecycles** (17): bag-of-tricks,
  bowl/brazier/censer/stone (conjure-elemental 1/dawn), efreeti-bottle,
  elemental-gem, feather-token (bird/whip), figurine-of-wondrous-power
  (flagship), horn-of-valhalla, iron-flask, manual-of-golems,
  pipes-of-the-sewers, ring-of-djinni-summoning, staff-of-the-python,
  deck-of-illusions. Shape: statBlockRef/creature ref + control mode +
  duration + revert/cooldown + disobedience conditions. Pack data vs live
  session state boundary is the key design question. Agent: Opus design →
  Codex rollout.
- **M5 — activated forms, devices, zones & apparatus state** (50): toggles
  (flame-tongue, sun-blade, invisibility rings, hood states), animated
  objects (dancing-sword, animated-shield, ropes), vehicles/structures
  (apparatus-of-the-crab, broom, carpet, folding-boat, instant-fortress),
  barriers/zones (cube-of-force, bead-of-force, eversmoking-bottle,
  insect cloud, auras), restraints (iron bands, dimensional-shackles,
  rope-of-entanglement), form machines (rod-of-lordly-might), orbit state
  (ioun), progressive unlocks (ring-of-elemental-command), fixed-state
  devices (immovable-rod), sphere-of-annihilation (flagship). The hardest
  family; per-item bespoke state machines over a shared
  activation/duration/termination contract. Agent: Opus.
- **M6 — extradimensional containment, storage & portals** (10):
  bag-of-holding, bag-of-devouring, efficient-quiver, handy-haversack,
  portable-hole, mirror-of-life-trapping (flagship), iron-flask,
  robe-of-stars (Astral travel), rod-of-security, well-of-many-worlds.
  Shape: capacity/occupancy state + entry/exit/rupture procedures. Agent:
  Opus design → Codex rollout.
- **M7 — curses, oaths & behavioral restrictions** (12):
  armor-of-vulnerability, berserker-axe, demon-armor,
  shield-of-missile-attraction, oathbow (exclusive sworn-enemy state),
  sword-of-wounding (wound counters + healing suppression),
  ring-of-mind-shielding (soul), orb-of-dragonkind (enslavement),
  robe-of-the-archmagi (alignment attunement gate), talismans (alignment
  interaction), deck-of-many-things persistent card states. Interacts with
  attunement (Phase 1 F5) and reveal-on-identify semantics. Agent: Opus.
- **M8 — random-procedure devices** (18): deck-of-many-things (flagship),
  wand-of-wonder (flagship), deck-of-illusions, bag-of-beans,
  efreeti-bottle, amulet-of-the-planes (inline d100), helm-of-brilliance
  (explosion roll), horn-of-blasting (20%), wind-fan (cumulative 20%),
  staff-of-power/staff-of-the-magi (retributive strike), sword-of-sharpness
  (nested d20), figurine (obsidian 10%), iron-flask/ring-of-spell-storing/
  necklace-of-prayer-beads/robe-of-useful-items (random found-state).
  Shape: seeded-roll procedure + table binding + risk clauses. Agent: Opus
  design (procedure representation); Codex for the simple percent-risk rows.
- **M9 — spell storage & spell-slot interop** (7): ring-of-spell-storing
  (flagship), rod-of-absorption (flagship), ioun Reserve/Absorption,
  pearl-of-power, spell-scroll (procedure), candle-of-invocation
  (free casting), staff-of-the-magi (absorption). Tightly coupled to the
  Phase 1 **F4 spell-slot engine** — design together. Agent: Opus.
- **M10 — roll manipulation** (7): luck-blade (reroll), ring-of-evasion
  (fail→success), scarab-of-protection (fail→success vs necromancy/undead),
  staff-of-charming (save flip/reflect), ring-of-spell-turning (nat-20
  reflect), rod-of-absorption (reaction cancel), talisman-of-the-sphere
  (PB doubling). Couples to the Phase 1 **F1 dice/roll tool** surface.
  Agent: Opus design (small), Codex rollout.
- **M11 — inter-item interactions** (9): extradimensional nesting → astral
  gate (bag-of-holding, handy-haversack, portable-hole),
  hammer-of-thunderbolts attunement precondition on belt+gauntlets,
  sovereign-glue ↔ universal-solvent / oil-of-slipperiness /
  oil-of-etherealness counter-agents, talisman-of-the-sphere ↔
  sphere-of-annihilation, sphere portal interactions. Agent: Opus (small,
  cross-cutting).

Engine-hook clauses recorded in §2 (F2 scimitar-of-speed; F3 concentration
items; F4 pearl/rod/ring storage; F6 temp-HP/stabilize/instant-death-adjacent
items; F7 rest-coupled budgets) must be designed against the Phase 1
families, not duplicated.

## 5. Recommended decomposition (child beads under eshyra-o9bd.18.7.7)

Reuse existing children exactly: **18.7.7.1 owns every C1 clause** in §2
(inventory embedded there — the C1 column is its exact worklist, including
the hard budget economies flagged: boots-of-speed, winged-boots,
candle-of-invocation, goat-of-traveling). **18.7.7.2 owns every C2 clause**
(similarly exact, including spell-grant projections and rarity-scaled
bonuses). Neither child may close green while any §2 row still carries its
tag unmodeled.

New children (create after review; exact memberships = §4 tag lists):

1. M1 consumables & single-use payloads (+ spell-scroll procedure) — Codex,
   Opus for scroll design.
2. M2+M3 passive modifiers (stats/movement/senses/environment) — Codex.
3. M4 summoning & controlled entities — Opus design, Codex rollout.
4. M5 activated forms, devices & apparatus state — Opus.
5. M6+M11 containment, portals & inter-item interactions — Opus.
6. M7 curses, oaths & restrictions — Opus.
7. M8 random-procedure devices — Opus design, Codex rollout.
8. M9+M10 spell storage, slot interop & roll manipulation — Opus (design
   with Phase 1 F4/F1).

Recommended order: 2 (highest volume, most regular) → 1 → existing .1/.2
rollout → 7 → 3 → 6 → 8 → 4 → 5. Validation expectations for every child:
committed-pack depth assertions on its exact membership, schema validation
for the new shapes, and readiness accounting that keeps every unmodeled
clause visible (mirroring the Phase 1 coverage-register principles).

Readiness guidance: until the M-families land, no magic item may be counted
green; the honest current state is 0/240 modeled, with the §2 table as the
clause-level gap register.
