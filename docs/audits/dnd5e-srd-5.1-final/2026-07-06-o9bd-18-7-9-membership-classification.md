# eshyra-o9bd.18.7.9 — Exhaustive classification of remaining accepted memberships

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.9`. PR: #399
(`eshyra-o9bd-18-7-9-membership-corrections`).

This is the authoritative, record-by-record semantic disposition of **every**
entry remaining in `ACCEPTED_PROSE_CREATURE_ENTRY_REFS` (48 refs) and
`ACCEPTED_METADATA_ONLY_SPELLS` (53 keys) in
`packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts` as of this
branch. Every record's full pack text was read against SRD 5.1 source. **Do
not repeat this audit.** Implementation agents should work from the slices in
§3 and consult §1/§2 only for per-record semantics.

Disposition vocabulary:

- **accept** — genuinely narrative/reference-only; remains in the accepted
  membership permanently.
- **accept\*** — contains deterministic clauses that are **already
  represented elsewhere** (casting metadata, `duration`, `area`, `scaling`,
  `tableRefs`, or typed sibling entries); remains accepted, rationale
  recorded.
- **model** — deterministic clauses still unmodeled; graduates out of the
  accepted membership when its slice (§3) lands.
- **design** — deterministic but needs a genuinely new contract/domain
  decision before rollout (Opus-tier design, then rollout).

## 1. Creature-entry refs (48)

### 1.1 Shape-change family — 22 refs — disposition: design (slice C1)

Deterministic clauses shared by all: action-cost polymorph; allowed-form
constraint; retained vs replaced statistics; equipment disposition;
reversion-on-death. No existing contract covers this; `transformed` (a
condition-state marker) and `illusoryDisguise` are adjacent but not
sufficient. New contract proposed: `changeShape` with fields
`{ forms, retains?, replaces?, equipment: 'absorbed-or-borne' |
'not-transformed' | 'specific', reversion: 'on-death', speedOverrides?,
sizeOverrides?, notes? }`.

| ref | variant-specific semantics |
|---|---|
| `creature:adult-bronze-dragon#actions:Change Shape` | forms: humanoid/beast CR ≤ own; retains alignment, HP, Hit Dice, speech, proficiencies, Legendary Resistance, lair actions, Int/Wis/Cha, this action; equipment absorbed-or-borne; excludes class features/legendary actions of new form |
| `creature:adult-gold-dragon#actions:Change Shape` | identical grammar to bronze |
| `creature:adult-silver-dragon#actions:Change Shape` | identical grammar |
| `creature:ancient-brass-dragon#actions:Change Shape` | identical grammar |
| `creature:ancient-bronze-dragon#actions:Change Shape` | identical grammar |
| `creature:ancient-copper-dragon#actions:Change Shape` | identical grammar |
| `creature:ancient-gold-dragon#actions:Change Shape` | identical grammar |
| `creature:ancient-silver-dragon#actions:Change Shape` | identical grammar |
| `creature:couatl#actions:Change Shape` | forms CR ≤ own; retains game statistics + speech; **replaces** AC, movement modes, Str, Dex, other actions; gains new form's capabilities (except class features/legendary/lair); bite rider |
| `creature:deva#actions:Change Shape` | as couatl but replaces AC, movement modes, Str, Dex, special senses; no bite rider |
| `creature:night-hag#actions:Change Shape` | forms: Small/Medium female humanoid; statistics unchanged; equipment not transformed |
| `creature:oni#actions:Change Shape` | forms: Small/Medium humanoid or Large giant; stats same except size; **glaive transforms with it** (equipment: 'specific'); glaive reverts on death |
| `creature:doppelganger#traits:Shapechanger` | Small/Medium humanoid it has seen; stats same except size; equipment not transformed; reverts on death |
| `creature:imp#traits:Shapechanger` | fixed forms w/ printed speed overrides: rat (20), raven (20, fly 60), spider (20, climb 20); stats otherwise same; equipment not transformed |
| `creature:quasit#traits:Shapechanger` | fixed forms: bat (10, fly 40), centipede (40, climb 40), toad (40, swim 40) |
| `creature:mimic#traits:Shapechanger` | object form or amorphous true form; stats same; equipment not transformed |
| `creature:succubus-incubus#traits:Shapechanger` | Small/Medium humanoid; loses fly speed without wings; stats same except size and speed |
| `creature:werebear#traits:Shapechanger` | Large hybrid / Large bear / humanoid true form; stats same except size and AC — **AC + speed variants already structured in statline** (`speedVariants`, AC `variants`, PR #394 / 18.6) |
| `creature:wereboar#traits:Shapechanger` | hybrid/boar; stats same except AC; statline variants already structured |
| `creature:wererat#traits:Shapechanger` | hybrid/giant-rat; stats same except size; statline variants already structured |
| `creature:weretiger#traits:Shapechanger` | hybrid/tiger; stats same except size; statline variants already structured |
| `creature:werewolf#traits:Shapechanger` | hybrid/wolf; stats same except AC; statline variants already structured |

Note: vampire's Shapechanger and Misty Escape are **not** in the accepted
list (already typed); the contract design should nonetheless check those for
vocabulary compatibility.

### 1.2 False Appearance family — 16 refs — disposition: model (slice C2)

Uniform grammar: "While the X remains motionless (±extra condition), it is
indistinguishable from Y." Deterministic auto-rule (no check/DC printed).
Proposed small contract: `falseAppearance { while: string,
indistinguishableFrom: string }`. Refs (all identical structure; `cloaker`
adds "without its underside exposed", `flying-sword` adds "and isn't
flying", `mimic` is object-form-only):

`animated-armor`, `awakened-shrub`, `awakened-tree`, `cloaker`,
`darkmantle`, `flying-sword`, `gargoyle`, `gray-ooze`, `ice-mephit`,
`magma-mephit`, `mimic` (ref name `False Appearance (Object Form Only)`),
`roper`, `rug-of-smothering`, `shrieker`, `treant`, `violet-fungus` — each
as `creature:<key>#traits:False Appearance…`.

### 1.3 Telepathy/communication family — 5 refs — disposition: model (slice C3)

No `telepathy` kind exists. Proposed contract: `telepathy { rangeFeet?,
samePlane?, oneWay?, audience?, conveys? }` plus `communication { with }`
for the dryad.

| ref | deterministic boundaries |
|---|---|
| `creature:homunculus#traits:Telepathic Bond` | same-plane condition; conveys senses to master; two-way communication |
| `creature:otyugh#traits:Limited Telepathy` | 120 ft; one-way (receiver cannot respond); requires target understands a language |
| `creature:pseudodragon#traits:Limited Telepathy` | 100 ft; simple ideas/emotions/images; requires target understands a language |
| `creature:sahuagin#traits:Shark Telepathy` | command sharks within 120 ft; limited telepathy |
| `creature:dryad#traits:Speak with Beasts and Plants` | communicate with beasts and plants as if shared language (cross-reference `spell:speak-with-animals` grammar) |

### 1.4 Innate-knowledge family — 2 refs — disposition: model (slice C3)

| ref | semantics |
|---|---|
| `creature:invisible-stalker#traits:Faultless Tracker` | knows direction+distance to designated quarry while same-plane; also knows summoner's location. Related existing kind: `locationDetectableBy` (inverse direction) — new `locationKnowledge` payload proposed |
| `creature:minotaur#traits:Labyrinthine Recall` | perfect recall of any traveled path (auto-success navigation) |

### 1.5 Genuinely accepted — 3 refs — disposition: accept / accept\*

| ref | rationale |
|---|---|
| `creature:hydra#traits:Wakeful` | accept (borderline): "while the hydra sleeps, at least one head is awake" — sleep/surprise adjudication is situational DM territory; no dice/DC. Revisit only if a sleep-state engine model appears |
| `creature:vampire#traits:Vampire Weaknesses` | accept\*: header line only ("has the following flaws:"); the four flaws (Forbiddance, Harmed by Running Water, Stake to the Heart, Sunlight Hypersensitivity) are separate sibling trait entries, each already typed — verified in pack 2026-07-06 |
| `creature:vampire-spawn#traits:Vampire Weaknesses` | accept\*: same as vampire |

## 2. Metadata-only spells (53)

All 53 carry casting metadata, structured `duration`, `concentration`,
`scaling.sourceText` where printed, and `area` where geometric — the
disposition below concerns clauses **beyond** that baseline.

### 2.1 Summoned/controlled-creature family — 14 — disposition: design (slice S1)

Shared deterministic core: what appears (fixed form list or count×CR option
menu), statblock source (pack creature refs exist for skeleton, zombie,
ghoul, giant insects, riding horse, familiar forms), control mode + command
economy (bonus-action/verbal, command range), disappearance conditions
(0 HP / spell end), loss-of-control behavior, scaling. Existing
`summonCreature { creature, rangeFeet, target?, maximumControlled? }` covers
only the single-fixed-creature case — needs a designed extension (option
menus, control economy, statblock modification). This is the largest
remaining design decision.

| key | beyond-baseline deterministic clauses |
|---|---|
| `spell:animate-dead` | skeleton/zombie by corpse type (statblocks in pack); bonus-action command ≤60 ft; 24 h control window; recast reasserts ≤4; scaling +2/slot |
| `spell:animate-objects` | ≤10 objects, size costs (M=2, L=4, H=8); object statblock **already structured via `tableRefs: [table:animated-object-statistics]`**; bonus-action command ≤500 ft; damage carryover on revert; scaling +2/slot |
| `spell:conjure-animals` | option menu 1×CR2 / 2×CR1 / 4×CR½ / 8×CR¼; fey type; group initiative; verbal commands (no action); ×2/×3/×4 at slots 5/7/9 |
| `spell:conjure-celestial` | CR ≤4 (CR ≤5 at 9th); commands limited by alignment |
| `spell:conjure-elemental` | CR ≤5 by terrain type; **loss-of-control on broken concentration** (hostile, undismissable, disappears after 1 h); +1 CR/slot |
| `spell:conjure-fey` | CR ≤6; alignment-limited commands; loss-of-control on broken concentration; +1 CR/slot |
| `spell:conjure-minor-elementals` | option menu as conjure-animals; ×2/×3 at slots 6/8 |
| `spell:conjure-woodland-beings` | option menu; ×2/×3 at slots 6/8 |
| `spell:create-undead` | 3 ghouls; night-only casting constraint; bonus-action command ≤120 ft; 24 h control; scaling variants (ghast/wight/mummy counts) |
| `spell:find-familiar` | form list with statblock refs; celestial/fey/fiend type; can't attack; 0 HP → disappears; telepathy ≤100 ft; sense-sharing action (caster deaf/blind); pocket-dimension dismissal; touch-spell delivery via familiar reaction; one-at-a-time |
| `spell:find-steed` | form list; Int floor 6 + language; shared spell targeting while mounted; telepathy ≤1 mi; one-at-a-time |
| `spell:giant-insect` | ≤10 centipedes / 3 spiders / 5 wasps / 1 scorpion → giant statblock refs; commands on caster's turn; per-target dismissal |
| `spell:phantom-steed` | riding-horse statblock with speed 100 ft override; travel 10 mph / 13 mph fast; 1-min fade on end; ends on any damage |
| `spell:simulacrum` | duplicate at **half HP maximum**, no equipment; no learning/slot regen; repair 100 gp/HP; melts at 0 HP; recast destroys prior |

### 2.2 Stochastic-clause family — 5 — disposition: model (slice S2)

One small contract covers all: `percentChance { percent, cumulative?, per,
trigger, resetOn?, secret? }`.

| key | clause |
|---|---|
| `spell:augury` | cumulative 25 %/extra casting before long rest → random reading; GM rolls secret. Omen menu itself: reference prose |
| `spell:commune` | cumulative 25 %/extra casting before long rest → no answer; 3 yes/no questions (reference) |
| `spell:divination` | cumulative 25 %/extra casting → random reading |
| `spell:sending` | flat 5 % failure when target on another plane; 25-word limit (reference) |
| `spell:secret-chest` | cumulative 5 %/day after 60 days → effect ends; chest loss rule on end (reference) |

### 2.3 Ward/trigger family — 5 — disposition: design (slice S3)

| key | clauses / reuse |
|---|---|
| `spell:alarm` | trigger: Tiny+ creature touches/enters warded ≤20-ft cube; designated exclusions; mental (≤1 mi, wakes sleeper) vs audible (60 ft, 10 s) mode. Reuse candidate: `triggeredEffect { trigger, result }` is string-typed — sufficient for a first pass |
| `spell:magic-mouth` | stored ≤25-word message; visual/audible trigger ≤30 ft of object; once vs repeating mode. Reuse: `triggeredEffect` |
| `spell:contingency` | stored spell (≤5th level, 1-action cast, self-target) + trigger circumstance; one-at-a-time; ends if component leaves person. Reuse: `spellStoring { maximumSpellLevel, capacity? }` + `triggeredEffect` |
| `spell:private-sanctum` | ward-property menu (blocks sound / vision / divination sensors / divination targeting / teleport / planar travel); 5–100 ft cube; permanence after 1 year daily. Interacts with modeled `teleport`/`planeShift` kinds — genuine ward-flags design |
| `spell:tiny-hut` | dome barrier: 9-creature Medium cap; casting-time occupants pass freely, others barred; spells can't cross; caster-exit ends. Area already in `area` metadata |

### 2.4 Quantified-creation family — 2 — disposition: model (slice S2)

| key | clauses |
|---|---|
| `spell:create-food-and-water` | 45 lb food + 30 gal water; sustains 15 humanoids / 5 steeds 24 h; food spoils in 24 h. Proposed `createsProvisions` payload |
| `spell:create-or-destroy-water` | create/destroy 10 gal, or 30-ft-cube rain (extinguishes exposed flames) / fog destruction; scaling captured |

### 2.5 Conjured-utility-object family — 2 — disposition: model (slice S2)

| key | clauses |
|---|---|
| `spell:mage-hand` | 10 lb capacity; 30 ft leash (vanishes beyond); move 30 ft/use; action to control; can't attack/activate magic items |
| `spell:floating-disk` | 500 lb capacity; follows within 20 ft; immobile when caster ≤20 ft; can't cross ≥10 ft elevation change; ends beyond 100 ft |

### 2.6 Table-backed — 2 — disposition: accept\* (already represented)

| key | rationale |
|---|---|
| `spell:control-weather` | stage tables **already structured** (`tableRefs: [table:precipitation, table:temperature, table:wind]`); one-stage-per-change procedure and 1d4×10-min onset remain prose — the onset die is the only unmodeled numeric hook (note for S2 if desired; low value) |
| `spell:creation` | material→duration table already `tableRefs: [table:creation-material-duration]`; cube scaling captured |

### 2.7 Genuinely accepted — 23 — disposition: accept / accept\*

| key | rationale (concise) |
|---|---|
| `spell:animal-messenger` | accept\*: travel rates (50/25 mi per 24 h) are downtime narration parameters; duration + scaling captured |
| `spell:arcanists-magic-aura` | accept: divination-deception modes; 30-day permanence is narrative state |
| `spell:commune-with-nature` | accept: knowledge grant; radii are descriptive |
| `spell:demiplane` | accept: planar door/room; trapped-on-end is narrative state |
| `spell:druidcraft` | accept: sensory-utility option menu; no adjudication hooks |
| `spell:fabricate` | accept: crafting conversion; size caps + tool-proficiency gate are DM-adjudicated crafting |
| `spell:gate` | accept: planar portal (5–20 ft); deity discretion; named-creature draw is narrative |
| `spell:identify` | accept: knowledge grant |
| `spell:illusory-script` | accept: designated-reader illusion; truesight interaction is descriptive |
| `spell:legend-lore` | accept: knowledge grant |
| `spell:mending` | accept: repairs break ≤1 ft; utility |
| `spell:message` | accept\*: whisper + reply; material blockers (1 ft stone / 1 in metal / lead sheet / 3 ft wood) are LOS adjudication parameters |
| `spell:mirage-arcane` | accept\*: 1-mi illusory terrain; **can create/remove difficult terrain** — situational movement rider left to DM; truesight semantics descriptive |
| `spell:move-earth` | accept: slow terrain reshaping; 10-min increments descriptive |
| `spell:passwall` | accept: passage dimensions; safe ejection on end |
| `spell:planar-ally` | accept: negotiated service; payment rates (100 gp/min, 1,000 gp/h, 10,000 gp/day) are GM reference guidance, explicitly adjustable |
| `spell:prestidigitation` | accept: option menu; 3-concurrent-effect cap is minor bookkeeping |
| `spell:purify-food-and-drink` | accept: area in metadata; purification is narrative |
| `spell:speak-with-animals` | accept\*: comprehension grant; same semantic family as dryad trait (C3) — reuse `communication` contract there if promoted later |
| `spell:speak-with-dead` | accept\*: 5 questions; **10-day recast lockout per corpse** is deterministic anti-repeat state — recorded, low engine value |
| `spell:stone-shape` | accept: shaping utility |
| `spell:telepathic-bond` | accept\*: 8 willing creatures; Int ≥ 3 floor; any-distance, not cross-plane — boundaries recorded; candidate `telepathy` reuse if C3 contract generalizes |
| `spell:thaumaturgy` | accept: option menu; 3-concurrent cap minor |

## 3. Implementation slices and routing

PR #399 already contains: broad creature/spell projection deepening, new
effect kinds + payload validators (`kindSchemas.ts` +544 lines), membership
reductions (creatures 170→48, spells 109→53), committed-pack assertions
(`srdMembershipCorrections.test.ts`), and CI test repairs (this commit).
None of the remaining slices below is started unless stated.

| slice | content | new contract? | agent |
|---|---|---|---|
| **C1** shape-change | design `changeShape` payload; project 22 refs (§1.1 table has all per-record semantics); remove from accepted list; schema + negative tests; pack regen + committed-pack assertions | yes — compound state transition | **Opus** (design + representative records), Codex rollout of remaining dragons (8 identical grammars) |
| **C2** false appearance | `falseAppearance` contract; 16 uniform refs | yes, trivial shape | **Codex** (after 5-line design review) |
| **C3** telepathy/knowledge | `telepathy`, `communication`, `locationKnowledge` payloads; 7 refs (§1.3–1.4) | yes, small | **Opus** design, Codex rollout |
| **S1** summoning | design summoning contract extension (option menus, control economy, statblock modification); 14 spells | yes — largest open design | **Opus** |
| **S2** small deterministic clauses | `percentChance` (5 spells), `createsProvisions`/quantified creation (2), conjured-utility-object (2); optionally control-weather onset die | yes, small shapes | **Opus** payload sketch, **Codex** rollout |
| **S3** ward/trigger | alarm + magic-mouth via existing `triggeredEffect`; contingency via `spellStoring`+`triggeredEffect`; private-sanctum/tiny-hut ward-flags design | partial reuse; ward flags new | **Opus** for ward flags; Codex for triggeredEffect reuse |
| **S4** membership bookkeeping | after each slice: exact removals from `ACCEPTED_*`, count reconciliation, readiness-report deltas, pack regeneration | no | **Codex** |

Ordering: C2 and S2 are low-risk warm-ups; C1/S1 are the substantive
designs; S3 last (interacts with modeled teleport/planar kinds). The 26
accept/accept\* records (3 creatures + 23 spells) are closed permanently by
this document.
