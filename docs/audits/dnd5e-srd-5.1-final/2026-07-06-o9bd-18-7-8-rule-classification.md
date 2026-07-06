# eshyra-o9bd.18.7.8 — Exhaustive classification of SRD rule records

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.8`.

**Coverage: COMPLETE — all 335 `rule:*` records** in
`packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json` (sorted by
key), which includes the 306 prose-only records from the readiness report
plus the 29 that already carry `tableRefs`. Every record's full pack text was
read. **Do not repeat this audit.** Derive implementation work from §3.

## 0. Classification vocabulary

- **REF** — reference/narrative only (GM guidance, flavor, section intros).
  Acceptable prose permanently.
- **DEF** — glossary definition backing structured data elsewhere (sense
  radii, movement modes, damage-type vocabulary, stat-block notation).
  Acceptable prose; the numeric instances are already structured in
  creature/spell/gear records.
- **PROC** — deterministic procedure/formula the record itself carries
  (dice, DCs, formulas, state machines). The actionable category; each PROC
  row names its family (§3).
- **TABLE** — table-backed; `tableRefs` already present and the referenced
  table records are structured.
- **DUP** — duplicate of another rule record; canonical owner noted.

A PROC/DEF row with "→18.7.6" means the deterministic payload belongs to the
gear bead, not to rule-record modeling.

## 1. Master matrix (all 335, by key)

| key | class | family / note |
|---|---|---|
| a-clear-path-to-the-target | PROC | spellcasting: total-cover targeting block; AoE origin lands near side of obstruction |
| a-legendary-creatures-lair | REF | |
| abilities | PROC | sentient-items: 4d6-drop-lowest per mental score |
| ability-checks | PROC+TABLE | core-d20: d20+mod vs DC; DC table ref'd |
| ability-score-increase | REF | ASIs structured per ancestry |
| ability-scores | REF | monster-book pointer |
| ability-scores-and-modifiers | PROC+TABLE | core-d20: mod = floor((score−10)/2); table ref'd |
| actions | REF | |
| actions-in-combat | REF | |
| activating-an-item | PROC | magic-items: action-activation is not Use-an-Object (Fast Hands exclusion) |
| advantage-and-disadvantage | PROC | core-d20: no stacking, adv+dis cancel, single reroll |
| adventuring-gear | REF | |
| age | REF | |
| alignment | REF | |
| alignment-in-the-multiverse | REF | |
| ammunition | PROC | monster-conventions: assumed ammo 2d4 thrown / 2d10 projectile |
| appendix-mm-a-miscellaneous-creatures | REF | |
| appendix-mm-b-nonplayer-characters | REF | |
| arcane-traditions | REF | |
| areas-of-effect | PROC | spellcasting: AoE geometry framework (shapes in cone/cube/cylinder/line/sphere rows) |
| armor-class | DUP | canonical: gear armor records + armor-guidance |
| armor-guidance | PROC | equipment: non-proficiency penalties (disadv Str/Dex rolls, no casting); heavy-armor Str speed −10; stealth disadv; shield +2, one shield max. Per-armor stats structured in gear →18.7.6 for payload |
| armor-weapon-and-tool-proficiencies | REF | monster equipment-swap guidance |
| attack | DEF | Attack action definition |
| attack-rolls | PROC | core-d20: d20+mods ≥ AC |
| attunement | PROC | magic-items: attunement state machine (short rest, max 3, no duplicate copies, 100 ft/24 h ending, death, voluntary) |
| backgrounds | REF | |
| backgrounds-equipment | REF | either-package-or-coin constraint |
| backgrounds-languages | REF | |
| backgrounds-proficiencies | PROC | char-build: duplicate-proficiency replacement rule |
| being-prone | PROC | movement: stand = half speed; crawl +1 ft/ft; speed 0 can't stand |
| between-adventures | REF | |
| beyond-1st-level | PROC | advancement: HP per level (roll or fixed average), retroactive Con, ASI cap 20. **Flag: references Character Advancement table but carries no tableRef** (table is ref'd from rule:experience-points) |
| beyond-the-material | REF | |
| beyond-the-material-outer-planes | REF | |
| blindsight | DEF | DUP pair with senses-blindsight (canonical: this p. 86 row for PC-facing; radii per creature) |
| bonus-action | PROC | spellcasting: bonus-action spell → only action-cantrip same turn |
| bonus-actions | PROC | action-economy: one per turn, timing |
| breaking-up-your-move | PROC | movement: split move around action |
| burrow | DEF | movement mode; can't burrow solid rock without trait |
| cantrips | DEF | |
| cast-a-spell | REF | |
| casting-a-spell | REF | |
| casting-a-spell-at-a-higher-level | DEF | upcasting; per-spell scaling structured |
| casting-a-spell-attack-rolls | PROC | spellcasting: spell attack = ability mod + PB |
| casting-a-spell-range | DEF | |
| casting-a-spell-saving-throws | PROC | spellcasting: spell save DC = 8 + mod + PB |
| casting-in-armor | PROC | spellcasting: must be proficient in worn armor |
| casting-time | DEF | |
| casting-time-reactions | DEF | |
| challenge | REF | CR guidance; CR-0 XP already structured per creature |
| challenge-experience-points | TABLE | XP by CR |
| channel-divinity | PROC | multiclassing: no extra uses; effects union |
| charges | PROC | magic-items: charge count revealed on identify/attunement |
| charisma | DEF | |
| charisma-checks | REF | skill descriptions |
| charisma-spellcasting-ability | DUP | canonical: class records `spellcastingAbility` |
| class-features | PROC | multiclassing: features minus starting equipment; special cases listed |
| climb | DEF | monster movement mode |
| climbing-swimming-and-crawling | PROC | movement: +1 ft/ft (+2 in difficult terrain) without climb/swim speed; optional Athletics |
| coinage | TABLE+PROC | exchange rates ref'd; coin weight 50/lb |
| combat-step-by-step | PROC | combat-core: 5-step encounter loop |
| combining-magical-effects | PROC | spellcasting: same-spell effects don't stack, most potent applies |
| command-word | DEF | silence interaction |
| communication | TABLE | sentient items |
| complex-traps | PROC | hazards: trap initiative + per-round actions |
| components | DEF | V/S/M gating; per-spell components structured |
| concentration | PROC | spellcasting: Con save DC = max(10, ⌊damage/2⌋) per source; break conditions |
| conditions | REF | intro; conditions are separate structured records |
| cone | PROC | spellcasting: geometry (width = distance) |
| conflict | PROC | sentient-items: contested Cha check; control save DC 12+Cha mod; charmed 1d12 h; repeat on damage; 1/dawn |
| constitution | DEF | |
| constitution-checks | REF | |
| constitution-hit-points | PROC | advancement: retroactive Con-mod HP formula |
| consumables | DEF | |
| contests | PROC | core-d20: contest resolution, tie = status quo |
| contests-in-combat | REF | |
| controlling-a-mount | PROC | mounted: controlled vs independent; initiative sync; Dash/Disengage/Dodge only |
| cover | PROC | combat-core: +2 / +5 AC & Dex saves; total cover untargetable; no stacking |
| crafting | PROC | downtime: 5 gp/day progress, half-value materials, cooperation, lifestyle offset |
| creating-sentient-magic-items | REF | |
| creating-sentient-magic-items-alignment | TABLE | |
| creating-sentient-magic-items-senses | TABLE | |
| creature-size | REF | **Flag: references Size Categories table, no tableRef** (rule:size carries it) |
| critical-hits | PROC | combat-core: double all damage dice |
| cube | PROC | spellcasting geometry |
| curing-madness | REF | madness: cross-spell pointers |
| customizing-a-background | PROC | char-build: swap feature/skills/tools rule |
| customizing-npcs | REF | |
| cylinder | PROC | spellcasting geometry |
| damage-and-healing | REF | |
| damage-and-healing-hit-points | DEF | |
| damage-resistance-and-vulnerability | PROC | combat-core: halve/double after other modifiers; instances don't stack |
| damage-rolls | PROC | combat-core: add ability mod; min 0; roll once for multi-target |
| damage-types | DEF | vocabulary |
| darkvision | DEF | DUP pair with senses-darkvision (this is PC-facing canonical) |
| dash | PROC | action: extra movement = current speed |
| death-saving-throws | PROC | rest-death: flat DC 10 d20; 3-count; nat 1 = 2 fails; nat 20 = 1 HP; damage-at-0 = fail (2 on crit) |
| demiplanes | REF | |
| detecting-and-disabling-a-trap | PROC | hazards: Perception vs trap DC; Investigation + thieves' tools; Arcana for magic traps |
| dexterity | DEF | |
| dexterity-attack-rolls-and-damage | PROC | core-d20: Dex for ranged/finesse |
| dexterity-checks | REF | |
| dexterity-initiative | PROC | combat-core: initiative = Dex check |
| diseases | REF | |
| disengage | PROC | action: no opportunity attacks this turn |
| dodge | PROC | action: attackers disadv, Dex saves adv; void if incapacitated/speed 0 |
| downtime-activities | PROC | downtime: 8 h/day minimum, non-consecutive |
| dropping-to-0-hit-points | REF | |
| druid-druids-and-the-gods | REF | |
| druid-sacred-plants-and-wood | REF | |
| duration | DEF | |
| equipment | REF | monster equipment |
| equipment-packs | REF | pack contents in gear records |
| expenses | REF | |
| expenses-lifestyle-expenses | PROC | economy: lifestyle costs/week or month. **Flag: references Expenses table, no tableRef**; DUP pair with lifestyle-expenses (p. 88) |
| experience-points | TABLE+PROC | char advancement table; multiclass XP by total level |
| extra-attack | PROC | multiclassing: no stacking |
| falling | PROC | environment: 1d6/10 ft, max 20d6, land prone |
| falling-unconscious | PROC | rest-death: 0 HP → unconscious, ends on any HP |
| fantasy-historical-pantheons | REF | |
| feats | PROC | char-build: once each; prerequisite loss disables |
| fly | DEF | hover semantics; hover flag structured per creature |
| flying-movement | PROC | movement: fall when prone/speed 0 unless hover |
| food | PROC | survival: 1 lb/day; half rations; limit 3+Con mod days then exhaustion/day |
| food-and-water | PROC | survival: exhaustion from deprivation not removable until fed |
| food-drink-and-lodging | TABLE | |
| gaining-inspiration | REF | GM discretion; no stockpiling |
| getting-into-and-out-of-armor | TABLE | don/doff times |
| going-mad | REF | madness sources; Wis/Cha saves |
| grapple-rules-for-monsters | PROC | monster-conventions: default escape DC = 10 + Str(Athletics) mod |
| grappling | PROC | combat-contests: Athletics vs Athletics/Acrobatics; drag at half speed |
| group-checks | PROC | core-d20: half-succeed rule |
| half-dragon-template | TABLE+PROC | templates: stat deltas + 2 tables ref'd |
| healing | PROC | rest-death: cap at HP max |
| heavy-armor-category | DUP | canonical: gear armor records (no Dex to AC) |
| help | PROC | action: advantage grant, 5-ft attack aid |
| hide | PROC | action: Stealth check per hiding rules |
| hiding | PROC | perception: Stealth vs active Perception / passive score (10+mods, ±5 adv/dis) |
| hit-points | TABLE+PROC | monster-conventions: HD by size table; HP = HD avg + Con×HD |
| hit-points-and-hit-dice | PROC | multiclassing: pooled HD by die type |
| improvised-weapons | PROC | equipment: 1d4, range 20/60, proficiency analogy →18.7.6 |
| innate-spellcasting | PROC | monster-conventions: lowest-level casting, CR for cantrip scaling |
| inner-planes | REF | |
| inspiration | REF | |
| instant-death | PROC | rest-death: remaining damage ≥ HP max → death |
| instantaneous | DEF | |
| intelligence | DEF | |
| intelligence-checks | REF | |
| intelligence-spellcasting-ability | DUP | canonical: class records |
| interacting-with-objects | PROC | objects: GM-set AC/HP; immune poison/psychic; auto-fail Str/Dex saves; break at 0 |
| interacting-with-objects-around-you | REF | free-interaction examples |
| jumping | PROC | movement: long = Str score ft (half standing); high = 3+Str mod (half standing); DC 10 checks; reach = height + 1.5×height |
| knocking-a-creature-out | PROC | rest-death: melee nonlethal choice → unconscious+stable |
| known-and-prepared-spells | REF | per-class detail structured |
| lair-actions | PROC | monster-conventions: initiative 20 (lose ties); restrictions |
| languages | TABLE | standard + exotic tables |
| legendary-actions | PROC | monster-conventions: end-of-others'-turns economy, regain at start; per-creature counts structured |
| legendary-creatures | DEF | form-assumption exclusion note |
| lifestyle-expenses | TABLE | DUP pair with expenses-lifestyle-expenses; this p. 88 row carries the tableRef — canonical |
| lifting-and-carrying | PROC | encumbrance: capacity = Str×15; push/drag ×2 at speed 5; size doubling/halving (kind `carryingCapacitySize` exists) |
| light-armor | DUP | canonical: gear armor records |
| limited-usage | DEF | X/Day & Recharge X–Y semantics; instances structured per entry (18.7.3) |
| line | PROC | spellcasting geometry |
| long-rest | PROC | rest-death: 8 h, interruption ≥1 h strenuous, all HP + half HD (min 1), 1/24 h, needs ≥1 HP |
| longer-casting-times | PROC | spellcasting: action per turn + concentration; slot kept on break |
| madness | REF | |
| madness-effects | TABLE+PROC | 3 tables ref'd; durations 1d10 min / 1d10×10 h |
| magic-items | REF | |
| magic-items-a-z | REF | |
| making-an-attack | PROC | combat-core: 3-step attack procedure |
| martial-archetypes | REF | |
| material-m | PROC | spellcasting: focus/pouch substitution; cost components required; consumption; free-hand |
| medium-armor | DUP | canonical: gear armor records (Dex max +2) |
| melee-and-ranged-attacks | DEF | Hit/Miss notation |
| melee-attacks | PROC | combat-core: reach 5 ft; unarmed = 1 + Str, proficient |
| modifiers-to-the-roll | PROC | core-d20: ability mod + PB rules |
| modifying-creatures | REF | |
| monastic-traditions | REF | |
| monsters | REF | |
| monsters-alignment | REF | |
| monsters-and-death | REF | GM convention |
| monsters-armor-class | DEF | |
| monsters-languages | DEF | |
| monsters-reactions | DEF | |
| monsters-saving-throws | DEF | save bonus = mod + PB-by-CR; per-creature values structured |
| monsters-skills | DEF | skill bonus = mod + PB (double for expertise); structured |
| monsters-speed | DEF | |
| mounted-combat | DEF | eligibility: willing, size+1, anatomy |
| mounting-and-dismounting | PROC | mounted: cost = half speed; DC 10 Dex save vs falling off; reaction dismount |
| mounts-and-vehicles | PROC | economy: vehicle pull ×5 capacity; barding ×4 cost ×2 weight; current +3 mph. **Flag: references Mounts and Other Animals table, no tableRef** |
| movement | REF | |
| movement-and-position | PROC | movement: budget spending across modes |
| movement-and-position-difficult-terrain | PROC | movement: +1 ft/ft; non-stacking; creature spaces count. DUP pair with speed-difficult-terrain (travel) — both canonical for their scale |
| moving-around-other-creatures | PROC | movement: hostile pass-through needs ±2 sizes; can't end in occupied space |
| moving-between-attacks | PROC | movement: split between attacks |
| multiattack | DEF | can't Multiattack on opportunity attacks; per-creature routines structured (18.7.9) |
| multiclassing | PROC | multiclassing: character level = sum |
| multiclassing-proficiency-bonus | PROC | multiclassing: PB by total level |
| multiple-items-of-the-same-kind | REF | common-sense slots |
| oath-of-devotion-oath-spells | DUP | canonical: feature records |
| objects | TABLE+PROC | object AC/HP tables ref'd; damage threshold; immunities |
| opportunity-attacks | PROC | combat-core: trigger + teleport/forced-move exclusions |
| other-activity-on-your-turn | PROC | action-economy: one free object interaction |
| otherworldly-patrons | REF | |
| outer-planes-outer-planes | REF | |
| paired-items | PROC | magic-items: both of pair required |
| paladin-breaking-your-oath | REF | |
| passive-checks | PROC | core-d20: 10 + mods, ±5 adv/dis |
| planar-travel | REF | |
| poisons | PROC | hazards: 4 delivery types w/ deterministic exposure semantics |
| practicing-a-profession | PROC | downtime: lifestyle earned by work/Performance |
| prerequisites | TABLE | multiclass prereqs |
| proficiencies | TABLE | multiclass proficiencies |
| proficiency-bonus | PROC | core-d20: apply once; multiply/divide once; ×0 when not proficient |
| psionics | DEF | |
| racial-traits | REF | |
| racial-traits-alignment | REF | |
| racial-traits-languages | REF | |
| racial-traits-size | REF | |
| racial-traits-speed | REF | |
| range | PROC | combat-core: normal/long; disadv beyond normal |
| ranged-attacks | REF | |
| ranged-attacks-in-close-combat | PROC | combat-core: disadv within 5 ft of seeing hostile |
| ranger-archetypes | REF | |
| reactions | PROC | action-economy: one per round; interrupt semantics |
| ready | PROC | action: trigger + readied spell concentration |
| recuperating | PROC | downtime: 3 days + DC 15 Con save → benefit menu |
| regional-effects | REF | |
| researching | PROC | downtime: 1 gp/day |
| resting | REF | |
| rituals | PROC | spellcasting: +10 min, no slot, no upcast, feature-gated |
| roguish-archetypes | REF | |
| rolling-1-or-20 | PROC | combat-core: nat 20 auto-hit/crit, nat 1 auto-miss |
| sacred-oaths | REF | |
| sample-diseases | REF | |
| sample-poisons | REF | |
| sample-traps | REF | |
| saving-throws | PROC | core-d20: d20 + mod (+PB if proficient) |
| search | PROC | action |
| self-sufficiency | PROC | downtime: wilderness lifestyle equivalents |
| selling-treasure | PROC | economy: half-price gear; full-value gems/trade goods |
| senses | DEF | |
| senses-blindsight | DEF | DUP with blindsight (monster-facing copy) |
| senses-darkvision | DEF | DUP with darkvision |
| senses-truesight | DEF | DUP with truesight |
| sentient-magic-items | REF | |
| services | TABLE | hireling rates |
| short-rest | PROC | rest-death: ≥1 h; spend HD (roll + Con each) |
| shoving-a-creature | PROC | combat-contests: contest → prone or push 5 ft |
| silvered-weapons | PROC | economy: 100 gp per weapon / 10 ammo |
| size | TABLE | size categories |
| skills | DEF | skill-proficiency semantics |
| somatic-s | PROC | spellcasting: free hand required |
| sorcerous-origins | REF | |
| space | DEF | surround-count guidance |
| special-purpose | TABLE | sentient items |
| special-traits | DEF | |
| special-traits-spellcasting | PROC | monster-conventions: class-list casting, upcast by slots, class membership for items |
| special-types-of-movement | REF | |
| special-weapons | PROC | equipment: lance (disadv <5 ft, two-handed unmounted), net (restrained, DC 10 Str escape, AC 10/5 slashing, one attack) →18.7.6 |
| speed | TABLE+PROC | travel pace table ref'd; forced march Con save DC 10+1/h; gallop ×2 |
| speed-difficult-terrain | PROC | travel: half speed. DUP pair with combat difficult terrain |
| spell-level | DEF | |
| spell-slots | DEF | slot economy; per-class tables structured |
| spellcasting | TABLE+PROC | multiclassing: slot formula (full + half⌊⌋ classes → shared table); pact-magic interop |
| spellcasting-chapter | REF | |
| spellcasting-services | REF | price guidance |
| spells | PROC | magic-items: item casting (lowest level, no components/slots; UMD ability +0, PB applies) |
| sphere | PROC | spellcasting geometry |
| squeezing-into-a-smaller-space | PROC | movement: one-size squeeze; +1 ft/ft; disadv attacks & Dex saves; attackers adv |
| stabilizing-a-creature | PROC | rest-death: DC 10 Wis (Medicine); stable semantics; 1d4 h → 1 HP (kind `stabilize` exists) |
| strength | DEF | |
| strength-attack-rolls-and-damage | PROC | core-d20: Str for melee |
| strength-checks | REF | |
| subraces | REF | |
| suffocating | PROC | survival: hold breath 1+Con mod min (min 30 s); then Con-mod rounds (min 1) → 0 HP dying |
| suggested-characteristics | REF | |
| surprise | PROC | combat-core: Stealth vs passive Perception; surprised = no move/action/reaction turn 1 |
| swim | DEF | |
| tags | DEF | |
| targeting-yourself | PROC | spellcasting: self-targeting eligibility |
| targets | DEF | |
| telepathy | DEF | monster telepathy semantics — cross-reference 18.7.9 slice C3 `telepathy` contract |
| temporary-hit-points | PROC | rest-death: buffer, no stacking (choose), no healing, long-rest expiry (kind `temporaryHitPoints` exists) |
| the-celtic-pantheon | TABLE | |
| the-egyptian-pantheon | TABLE | |
| the-environment | REF | |
| the-fiend-expanded-spell-list | DUP | canonical: warlock feature records |
| the-greek-pantheon | TABLE | |
| the-material-plane | REF | |
| the-norse-pantheon | TABLE | |
| the-order-of-combat | PROC | combat-core: round/turn cycle (6 s) |
| the-order-of-combat-initiative | PROC | combat-core: Dex check; group rolls; tie handling |
| the-planes-of-existence | REF | |
| the-schools-of-magic | DEF | |
| time | REF | |
| tools | DEF | tool proficiency semantics |
| trade-goods | TABLE | |
| training | PROC | downtime: 250 days × 1 gp |
| transitive-planes | REF | |
| trap-effects | TABLE | severity dice + DC/attack tables ref'd |
| traps | REF | |
| traps-in-play | REF | |
| tremorsense | DEF | |
| triggering-a-trap | REF | |
| truesight | DEF | DUP with senses-truesight; deterministic bundle (auto-detect illusions + auto-succeed saves) noted |
| two-weapon-fighting | PROC | combat-core: light weapons, bonus attack, no positive ability mod to damage |
| type | DEF | creature-type vocabulary |
| unarmored-defense | PROC | multiclassing: no re-gain |
| underwater-combat | PROC | environment: melee disadv unless listed weapons; ranged auto-miss beyond normal; fire resistance immersed |
| unseen-attackers-and-targets | PROC | combat-core: disadv vs unseen, adv when unseen; auto-miss wrong guess |
| use-an-object | PROC | action |
| using-ability-scores | REF | |
| using-different-speeds | PROC | movement: cross-mode subtraction |
| using-each-ability | REF | |
| using-inspiration | PROC | inspiration: spend → advantage; gifting |
| variant-encumbrance | PROC | encumbrance (variant): >5×Str → speed −10; >10×Str → −20 + disadv Str/Dex/Con rolls |
| variant-skills-with-different-abilities | PROC | core-d20 (variant): skill/ability recombination |
| verbal-v | PROC | spellcasting: gag/silence blocks V |
| vision-and-light | PROC | environment: lightly obscured → Perception disadv; heavily obscured → blinded-equivalent; 3 light levels |
| vulnerabilities-resistances-and-immunities | DEF | DUP with damage-resistance-and-vulnerability (that row canonical for the math) |
| warlock-your-pact-boon | REF | |
| water | PROC | survival: 1 gal/day (2 hot); half → DC 15 Con save or exhaustion; less → automatic |
| weapon-proficiency | PROC | equipment: PB gating on attack rolls |
| weapon-properties | PROC | equipment: property semantics (ammunition + half recovery, finesse, heavy/Small disadv, light, loading, range, reach +5, thrown, two-handed, versatile) →18.7.6 |
| weapons | REF | |
| wearing-and-wielding-items | REF | |
| what-is-a-spell | REF | |
| wisdom | DEF | |
| wisdom-checks | REF | |
| wisdom-spellcasting-ability | DUP | canonical: class records |
| wizard-your-spellbook | PROC | downtime: copy 2 h + 50 gp per level; backup 1 h + 10 gp |
| working-together | PROC | core-d20: leader rolls with advantage; eligibility constraints |
| your-turn | PROC | action-economy: move + one action, any order, may forgo |

## 2. Census

REF 92 · DEF 55 · PROC 132 (incl. 9 carrying/next-to tables) · TABLE 29 ·
DUP 12 (armor-class, charisma/intelligence/wisdom-spellcasting-ability ×3,
heavy/light/medium-armor ×3, oath-of-devotion-oath-spells,
the-fiend-expanded-spell-list, plus 5 cross-scale pairs noted in place:
blindsight/darkvision/truesight vs senses-*, lifestyle ×2, difficult terrain
×2, resistance ×2). Rows tagged with two classes count once under the first.
Exact counts should be regenerated mechanically when the readiness
classifier is built; the classes per key above are the source of truth.

## 3. Emergent taxonomy and implementation guidance

The decisive finding: **the PROC corpus is overwhelmingly the 5e core
engine, not record data.** Unlike spells/creatures/features (where mechanics
are per-record payloads), these rules define the procedures a deterministic
rules engine executes. Projecting them as per-record `mechanics.effects`
would be the wrong representation. The recommended architecture decision for
child beads: introduce a rule-record disposition layer (mirroring
`GAMEPLAY_READINESS_DISPOSITIONS`) that classifies each rule as
`engine-procedure` (owned by engine tools), `reference-prose`,
`definition`, `table-backed`, or `duplicate(canonical)` — and separately
track which engine procedures the runtime actually implements.

PROC families (grouped for child beads):

1. **core-d20** (~15): checks, saves, attacks, adv/disadv, contests, group
   checks, passive checks, proficiency-bonus rules, modifier formula.
2. **combat-core & action economy** (~30): initiative, surprise, turn
   structure, the standard actions, OAs, cover, crits, nat 1/20,
   two-weapon, grapple/shove, unseen, range, underwater, mounted (3 rows),
   squeezing, prone.
3. **movement & environment** (~15): difficult terrain (both scales),
   climb/swim/crawl, jumping, falling, suffocation, food/water, vision &
   light, flying fall, speed switching, travel pace/forced march.
4. **spellcasting procedures** (~18): concentration, components (V/S/M),
   rituals, bonus-action casting, longer casting times, combining effects,
   AoE geometry (5 shapes + framework + clear-path), spell attack/DC
   formulas, targeting, casting in armor.
5. **rest, death & HP** (~12): short/long rest, death saves, stabilizing,
   instant death, knockout, healing cap, temp HP, falling unconscious.
6. **character build & advancement** (~12): leveling HP, retroactive Con,
   feats, background proficiency swap, the multiclassing suite (7 rows),
   encumbrance (base + variant).
7. **downtime & economy** (~14): crafting, profession, recuperating,
   research, training, spellbook copying, lifestyle, selling, silvering,
   services pricing, self-sufficiency, mounts/vehicles.
8. **objects & hazards** (~8): object statistics, traps (detect/complex/
   effects), poisons delivery types, madness durations.
9. **monster-statblock conventions** (~8): assumed ammunition, default
   grapple escape DC, innate/class spellcasting, lair/legendary economy,
   monster HP formula.
10. **magic-item procedures** (~7): attunement, activation, charges, item
    spellcasting, paired items, sentient-item generation/conflict.
11. **templates** (1): half-dragon.
12. **gear-payload rows** (3): weapon-properties, special-weapons,
    improvised-weapons (+armor-guidance payload) — route to
    `eshyra-o9bd.18.7.6`, not to a rules child.

Anomalies to fix regardless of architecture (small Codex slice) — verified
against the committed pack 2026-07-06: **3 confirmed missing tableRefs** —
rule:beyond-1st-level → `table:character-advancement` (exists; currently
ref'd only by rule:experience-points), rule:creature-size →
`table:size-categories` (exists; ref'd by rule:size),
rule:expenses-lifestyle-expenses → `table:lifestyle-expenses` (exists; ref'd
by the p. 88 lifestyle-expenses row). rule:mounts-and-vehicles is **not** a
gap: the Mounts and Other Animals data is structured as `equipment` records
with `category: "mount"` (speed + carryingCapacity fields), and no
mounts table record exists by design. Follow
`docs/importer-fix-protocol.md`: add the refs in the importer, not by
editing the pack.

Routing recommendation: the disposition-layer design and the
engine-procedure inventory decision are **Opus** work; the missing-tableRef
fixes, the readiness-report classifier wiring, and DUP canonical-owner
annotations are **Codex** work once the layer shape is decided.
