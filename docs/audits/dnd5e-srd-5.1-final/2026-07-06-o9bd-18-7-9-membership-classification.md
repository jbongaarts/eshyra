# eshyra-o9bd.18.7.9 — Exhaustive classification of reviewed memberships

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.9`. PR: #399. C4/C5/C6/C7/C8/C9 rollouts:
beads `eshyra-o9bd.18.7.9.11`, `eshyra-o9bd.18.7.9.12`,
`eshyra-o9bd.18.7.9.13`, `eshyra-o9bd.18.7.9.14`, and
`eshyra-o9bd.18.7.9.15`, with C4 in bead `eshyra-o9bd.18.7.9.10`.
(`eshyra-o9bd-18-7-9-membership-corrections`).

This is the authoritative, record-by-record semantic disposition source for
the reviewed creature-entry refs now represented by
`CREATURE_ENTRY_REVIEWED_DISPOSITIONS` and for
`ACCEPTED_METADATA_ONLY_SPELLS` (12 final residual keys) in
`packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts` as of this
branch. Seventy-two creature-entry refs were reviewed in total: 6 were
implemented during the original pass and the 16 C2 False Appearance refs were
implemented in the follow-up rollout, and the 10 C3 refs were implemented in a
second follow-up rollout, and the 22 C1 shape-change refs were implemented in
a later rollout. The C5 Split, C6 damage-absorption, C7 Berserk, C8 Rampage,
and C9 residual-creature rollouts described below have graduated their 14 refs,
leaving 2 permanent `accepted-prose-only` refs represented in the per-ref
registry. C4 is implemented by bead `eshyra-o9bd.18.7.9.10`. Spell
metadata-only membership remains represented separately by
`ACCEPTED_METADATA_ONLY_SPELLS`; the 14 S1 summoning/control spells and the 17
S2 small deterministic-clause spells have graduated out. Every record's full
pack text was read against SRD 5.1 source. **Do not repeat this audit.**
Implementation agents should work from the slices in §3 and consult
§1/§2/§1.6 only for per-record semantics.

Disposition vocabulary:

- **accept** — genuinely narrative/reference-only; remains represented as
  `accepted-prose-only` permanently.
- **accept\*** — contains deterministic clauses that are **already
  represented elsewhere** (casting metadata, `duration`, `area`, `scaling`,
  `tableRefs`, or typed sibling entries); remains represented as accepted,
  rationale recorded.
- **model** — deterministic clauses still unmodeled; graduates out of the
  reviewed-disposition registry when its slice (§3) lands.
- **design** — deterministic but needs a genuinely new contract/domain
  decision before rollout (Opus-tier design, then rollout).

## 1. Creature-entry refs (72 reviewed total; 0 pending findings; 2 residual registry entries)

### 1.1 Shape-change family — 22 refs — disposition: implemented (slice C1)

Deterministic clauses shared by all: action-cost polymorph; allowed-form
constraint; retained vs replaced statistics; equipment disposition;
reversion-on-death. These are implemented by the schema-validated
`changeShape` contract. Lycanthrope statline forms select existing AC/speed
variants by exact condition and expose concrete sizes where the form changes
size; they do not duplicate numeric statline values.

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
| `creature:couatl#actions:Change Shape` | forms CR ≤ own; retains game statistics + speech; **replaces** AC, movement modes, Str, Dex, other actions; gains new form's capabilities (except class features/legendary/lair); conditionally retains Bite only when the new form is capable of making that attack |
| `creature:deva#actions:Change Shape` | as couatl but replaces AC, movement modes, Str, Dex, special senses; no Bite-retention clause |
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

### 1.2 False Appearance family — 16 refs — disposition: model (slice C2; implemented)

Uniform grammar: "While the X remains motionless (±extra condition), it is
indistinguishable from Y." Deterministic auto-rule (no check/DC printed).
Implemented small contract: `falseAppearance { while: string,
indistinguishableFrom: string }`. Refs (all identical structure; `cloaker`
adds "without its underside exposed", `flying-sword` adds "and isn't
flying", `mimic` is object-form-only):

Exact refs (machine-checkable):

- `creature:animated-armor#traits:False Appearance`
- `creature:awakened-shrub#traits:False Appearance`
- `creature:awakened-tree#traits:False Appearance`
- `creature:cloaker#traits:False Appearance`
- `creature:darkmantle#traits:False Appearance`
- `creature:flying-sword#traits:False Appearance`
- `creature:gargoyle#traits:False Appearance`
- `creature:gray-ooze#traits:False Appearance`
- `creature:ice-mephit#traits:False Appearance`
- `creature:magma-mephit#traits:False Appearance`
- `creature:mimic#traits:False Appearance (Object Form Only)`
- `creature:roper#traits:False Appearance`
- `creature:rug-of-smothering#traits:False Appearance`
- `creature:shrieker#traits:False Appearance`
- `creature:treant#traits:False Appearance`
- `creature:violet-fungus#traits:False Appearance`

### 1.3 Telepathy/communication family — 6 refs — disposition: implemented (slice C3)

Implemented 2026-07-07: `telepathy` payloads carry per-record boundaries
(`rangeFeet`, `samePlaneOnly`, `oneWay`, `audience`, `commands`,
`maxCreatures`, `willingOnly`, `minIntelligence`, and direction-neutral
`content` limits); `communication { with }` covers the dryad and
`speak-with-animals`; homunculus sense sharing uses a directional
`senseSharing` effect; aboleth Probing Telepathy uses
`triggeredEffect` with an explicit result and sight condition.

| ref | deterministic boundaries |
|---|---|
| `creature:homunculus#traits:Telepathic Bond` | same-plane condition; conveys senses to master; two-way communication |
| `creature:otyugh#traits:Limited Telepathy` | 120 ft; one-way (receiver cannot respond); requires target understands a language |
| `creature:pseudodragon#traits:Limited Telepathy` | 100 ft; simple ideas/emotions/images; requires target understands a language |
| `creature:sahuagin#traits:Shark Telepathy` | command sharks within 120 ft; limited telepathy |
| `creature:dryad#traits:Speak with Beasts and Plants` | communicate with beasts and plants as if shared language (cross-reference `spell:speak-with-animals` grammar) |
| `creature:aboleth#traits:Probing Telepathy` | folded in 2026-07-06 (§1.6.9): when a creature telepathically communicates with the aboleth and the aboleth can see it, the aboleth learns that creature's greatest desires — modeled as `triggeredEffect { trigger, result, condition }`, not as telepathy payload content |

### 1.4 Innate-knowledge/state family — 4 refs — disposition: implemented (slice C3)

| ref | semantics |
|---|---|
| `creature:invisible-stalker#traits:Faultless Tracker` | knows direction+distance to designated quarry while same-plane; also knows summoner's location. Related existing kind: `locationDetectableBy` (inverse direction) — new `locationKnowledge` payload proposed |
| `creature:minotaur#traits:Labyrinthine Recall` | perfect recall of any traveled path (auto-success navigation); use path-memory semantics, not target-location knowledge |
| `creature:hydra#traits:Wakeful` | deterministic sleep-state exception: at least one head awake while sleeping (defeats asleep-based surprise/unawareness). Reclassified from accept 2026-07-06: consistency with False Appearance — a dice-free deterministic gate is model, not accept. Small `sleepException`-style payload in the C3 contract set |
| `creature:ettin#traits:Wakeful` | folded in 2026-07-06 (§1.6.9): identical grammar and semantics to the hydra's Wakeful ("when one of the ettin's heads is asleep, its other head is awake") — same `sleepException` payload, not a separate contract |

### 1.5 Genuinely accepted — 2 refs — disposition: accept\*

| ref | rationale |
|---|---|
| `creature:vampire#traits:Vampire Weaknesses` | accept\*: header line only ("has the following flaws:"); the four flaws (Forbiddance, Harmed by Running Water, Stake to the Heart, Sunlight Hypersensitivity) are separate sibling trait entries, each already typed — verified in pack 2026-07-06 |
| `creature:vampire-spawn#traits:Vampire Weaknesses` | accept\*: same as vampire |

### 1.6 Residual restored refs — 24 refs — reconciliation pass 2026-07-06

The trigger-only-readiness fix (`hasReadinessCreditableEffect`: a
`triggeredEffect` with no `result` no longer counts as substantive mechanics)
correctly stopped crediting 24 entries whose only prior mechanics was a bare
`triggeredEffect` trigger marker. Historically, restoring them to the former
`ACCEPTED_PROSE_CREATURE_ENTRY_REFS` array to keep the build green was correct
*mechanically*, but they were never carried into this artifact's per-record
disposition — leaving §1's "48 refs" claim of exhaustiveness stale against a
72-ref reviewed set. This section closes that gap: every one of the 24 is
classified below, mirroring the §1.1–§1.5 methodology. Two (aboleth, ettin)
turned out to be members of existing families and were folded into §1.3/§1.4
above rather than duplicated here; the accounting in §3 reflects that.

#### 1.6.1 Implemented this pass — 6 refs — disposition: model, contract already existed

No new contract was needed; each reused an existing typed kind with an
existing validator (`rejuvenation`, `extraDamage`, `movementRestriction`),
already established elsewhere in the pack (`rejuvenation` is the same shape
used by `creature:lemure` and `creature:mummy-lord`). Implemented in this
pass and **graduated out** of the reviewed-disposition registry.

| ref | projection |
|---|---|
| `creature:guardian-naga#traits:Rejuvenation` | `rejuvenation { afterDaysDice: '1d6', condition: 'no-wish-spell-cast-to-prevent-it' }` |
| `creature:spirit-naga#traits:Rejuvenation` | same as guardian naga |
| `creature:lich#traits:Rejuvenation` | `rejuvenation { afterDaysDice: '1d10', condition: 'has-a-phylactery' }` |
| `creature:bugbear#traits:Surprise Attack` | `extraDamage { dice: '2d6', trigger }` |
| `creature:doppelganger#traits:Surprise Attack` | `extraDamage { dice: '3d6', trigger }` |
| `creature:water-elemental#traits:Freeze` | `movementRestriction { restriction: 'speed-reduced-by-20-feet', endsBy: 'end-of-next-turn', trigger }` |

**Trigger/result linkage (final, closes out §1.6.1's original note):** all six
source texts open with "If …,". The original pass left this as the
pre-existing generic `triggeredEffect { trigger }` fallback riding alongside
the specific typed effect as a second, disconnected array entry — harmless
for readiness credit, but ambiguous: nothing in the typed representation
proved the trigger governed that particular sibling effect. The final #399
correction resolves this with explicit trigger/result linkage in the typed
mechanics themselves, per record:

- **Surprise Attack** (bugbear, doppelganger) and **Freeze** (water
  elemental): the trigger clause is attached directly to the substantive
  effect via a new optional `trigger` field on `extraDamage` and
  `movementRestriction` (`kindSchemas.ts`), and the generic trailing marker is
  suppressed for these matches. The conditional relationship is now
  unambiguous without relying on array adjacency.
- **Rejuvenation** (guardian naga, spirit naga, lich): "if it dies" / "if it
  has a phylactery" add no information beyond what the `rejuvenation` effect's
  own `condition`/timing fields already mean (a `rejuvenation` effect is
  inherently a dies-then-returns effect); the generic trailing marker is
  suppressed with no replacement field, since nothing would be added by one.

The bundle's readiness registry (`CREATURE_ENTRY_REVIEWED_DISPOSITIONS` in
`create-dnd5e-srd-audit-bundle/cli.ts`, superseding the former
`ACCEPTED_PROSE_CREATURE_ENTRY_REFS`) additionally now records a per-ref
disposition — `accepted-prose-only` for the 2 genuine accepts (§1.5), with
future findings requiring explicit `bead`/`slice` metadata — so the bucket-level `creature-entry#mechanical-prose` /
`creature-entry#narrative-prose` policy entry cannot blanket-bless an
unreviewed ref as accepted prose.

#### 1.6.2 Reckless family — 2 refs — disposition: implemented (slice C4; bead `eshyra-o9bd.18.7.9.10`)

Deterministic two-sided toggle: at the start of its turn, the creature may
elect one linked, schema-validated `recklessAttack` effect. It grants
advantage on `all-melee-weapon-attack-rolls` for the `current-turn`, trading
that for advantage on `all-attack-rolls-against-self` until
`until-start-of-next-turn`. The benefit and tradeoff remain one object so the
optional bargain cannot be split into unrelated modifiers.

- `creature:berserker#traits:Reckless`
- `creature:minotaur#traits:Reckless`

#### 1.6.3 Split family — 2 refs — disposition: implemented (slice C5)

Deterministic reproduction-on-damage: subjected to lightning/slashing damage
while Medium-or-larger and at ≥10 HP, the creature splits into two
half-HP (rounded down), one-size-smaller copies. Uniform grammar across both
refs. The schema-validated `splitOnDamage` contract now models the complete
source grammar, including explicit `resultingCreatureCount: 2`; both refs
are graduated from the reviewed-disposition registry. The importer matches
only the complete source strings and fails closed on clause drift.

- `creature:black-pudding#reactions:Split`
- `creature:ochre-jelly#reactions:Split`

#### 1.6.4 Damage-absorption family — 4 refs — disposition: implemented (slice C6)

Deterministic immune-and-heal pattern: subjected to a named damage type, the
creature takes no damage and instead regains hit points equal to the damage
that would have been dealt. Uniform grammar across all four. The closed
`damageAbsorption { type, damageTaken: 'none', healing: 'damage-dealt' }`
contract now projects all four refs; they are removed from the reviewed
disposition registry.

- `creature:clay-golem#traits:Acid Absorption`
- `creature:flesh-golem#traits:Lightning Absorption`
- `creature:iron-golem#traits:Fire Absorption`
- `creature:shambling-mound#traits:Lightning Absorption`

#### 1.6.5 Berserk family — 2 refs — disposition: implemented (slice C7)

The closed `berserk` state-machine contract projects the low-HP start-of-turn
d6 entry (only a 6 enters), persistent each-turn nearest-visible-creature
attack behavior with the smaller-object fallback, and the destroyed/full-heal
exits. Flesh Golem additionally projects its creator-only, 60-foot,
hearing-gated action-cost DC 15 Charisma (Persuasion) calming exit and its
qualified low-HP damage re-entry eligibility clause. Because the source does
not specify how that later "might" resolves, the clause is explicitly
`model-adjudicated` and does not assert a `calm`→`berserk` transition. The
contract's validator enforces the complete ordered state machine and matching
entry/re-entry thresholds, so neither source variant can degrade to a bare
trigger marker.

- `creature:clay-golem#traits:Berserk` (threshold 60 HP, no calming clause)
- `creature:flesh-golem#traits:Berserk` (threshold 40 HP, plus calming clause)

#### 1.6.6 Rampage family — 2 refs — disposition: implemented (slice C8)

Deterministic triggered bonus action: reducing a creature to 0 HP with a
melee attack on its turn grants a bonus action to move up to half speed and
make a bite attack. The existing `bonusAction` kind's `options` array models
a *menu of choices* for an already-available bonus action, not a
trigger-gated single bonus action. The implemented `triggeredBonusAction`
contract keeps the typed trigger and composite action in one object:
`{ trigger: { event: 'reduce-creature-to-0-hit-points', attackType: 'melee',
timing: 'on-its-turn' }, action: { movement: 'up-to-half-speed', attack:
'bite' } }`. The result is never associated with a trigger through array
adjacency.

- `creature:giant-hyena#traits:Rampage`
- `creature:gnoll#traits:Rampage`

#### 1.6.7 Single-record residuals — 4 refs — disposition: implemented (slice C9)

Four refs whose semantics don't share a family with each other; each needs
its own small contract, but none is large enough to warrant its own design
slice.

| ref | semantics | proposed contract |
|---|---|---|
| `creature:shrieker#reactions:Shriek` | emits an audible-300-ft shriek when bright light or a creature comes within 30 ft; continues until the disturbance leaves and for 1d4 more of the shrieker's turns | `soundAlarm { rangeFeet: 30, audibleFeet: 300, trigger: 'bright-light-or-creature-within-range', continuesAfterDisturbanceLeavesDice: '1d4', continuationUnit: 'shrieker-turns' }` |
| `creature:djinni#traits:Elemental Demise` | on death, body disintegrates (warm breeze), leaving only worn/carried equipment behind | `onDeathBodyDisposal { manner: 'disintegrates', equipment: 'left-behind' }` |
| `creature:efreeti#traits:Elemental Demise` | on death, body disintegrates (fire flash + smoke), leaving only worn/carried equipment behind | same contract as djinni |
| `creature:shield-guardian#reactions:Shield` | reaction: when a creature attacks the wearer of the guardian's amulet, the guardian (if within 5 ft of the wearer) grants the wearer a +2 AC bonus against that attack | no existing kind combines a reaction trigger, a proximity condition, and an AC bonus to *another* creature; `acFormula`/`savingThrowBonus`/`attackOrDamageBonus` all cover different shapes. Needs a small `reactionAcBonus { amount, rangeFeet, subject: 'amulet-wearer' }` contract |

Not in the same family as each other, but djinni/efreeti share one contract
(2 refs, 1 contract) — counted together in §3.

### 1.6 reconciliation

24 = 6 implemented (§1.6.1, removed from the array) + 2 folded into existing
families (§1.3/§1.4, aboleth and ettin) + 16 newly classified into slices
C4–C9 (2 Reckless + 2 Split + 4 Absorption + 2 Berserk + 2 Rampage + 4
single-record residuals: Shriek, Djinni, Efreeti, Shield). C4, C5, C6, C7,
C8, and C9 are now implemented, so the current residual registry is 2
entries: the 2 permanent accepted prose-only refs.

## 2. Metadata-only spells (53)

All 53 carry casting metadata, structured `duration`, `concentration`,
`scaling.sourceText` where printed, and `area` where geometric — the
disposition below concerns clauses **beyond** that baseline.

### 2.1 Summoned/controlled-creature family — 14 — disposition: implemented (slice S1)

Shared deterministic core: what appears (fixed form list or count×CR option
menu), statblock source (pack creature refs exist for skeleton, zombie,
ghoul, giant insects, riding horse, familiar forms), control mode + command
economy (bonus-action/verbal, command range), disappearance conditions
(0 HP / spell end), loss-of-control behavior, scaling. Existing
`summonCreature { creature, rangeFeet, target?, maximumControlled? }` covers
only the single-fixed-creature case — needs a designed extension (option
menus, control economy, statblock modification). This is the largest
remaining design decision.

Implemented 2026-07-08 and contract-reconciled 2026-07-09: the `summoning`
effect uses orthogonal creation, type-treatment, control, state-transition,
identity, protocol, scaling, and engine-hook axes. The source-bound
`S1_SUMMONING_SPECS` registry is the single executable compiler input.
Profile-aware schema validation, transition reachability, clause-removal
mutation tests, exact committed payloads, and nested-reference integrity guard
the generated pack. The 14 keys below graduated out of
`ACCEPTED_METADATA_ONLY_SPELLS`.

| key | beyond-baseline deterministic clauses |
|---|---|
| `spell:animate-dead` | skeleton/zombie by corpse type (statblocks in pack); bonus-action command ≤60 ft; 24 h control window; recast reasserts ≤4; scaling +2/slot |
| `spell:animate-objects` | max-10 weighted capacity (Tiny/Small=1, M=2, L=4, H=8); complete construct overlay (fixed abilities, conditional movement, blindsight, attack procedure, size table); mental bonus-action same-command batching ≤500 ft with persistent orders; damage carryover on revert; scaling +2/slot |
| `spell:conjure-animals` | option menu 1×CR2 / 2×CR1 / 4×CR½ / 8×CR¼; fey type; group initiative; verbal commands (no action); ×2/×3/×4 at slots 5/7/9 |
| `spell:conjure-celestial` | CR ≤4 (CR ≤5 at 9th); commands limited by alignment |
| `spell:conjure-elemental` | CR ≤5 appropriate to selected 10-ft source cube; unoccupied placement within 10 ft; **loss-of-control on broken concentration** (hostile, undismissable, removal anchored to original cast +1 h); +1 CR/slot |
| `spell:conjure-fey` | exclusive fey-creature or beast-form fey-spirit CR ≤6 choice; conditional beast→fey type replacement; alignment-limited commands; cast-anchored loss-of-control lifecycle; +1 CR/slot |
| `spell:conjure-minor-elementals` | option menu as conjure-animals; ×2/×3 at slots 6/8 |
| `spell:conjure-woodland-beings` | option menu; ×2/×3 at slots 6/8 |
| `spell:create-undead` | max 3 M/S humanoid corpses→ghouls; night-only; mental bonus-action same-command batching ≤120 ft with persistent orders; pre-expiry 24 h reassertion; exclusive maximum higher-slot menus shared by creation/reassertion |
| `spell:find-familiar` | fixed form refs; beast type replaced by one celestial/fey/fiend; persistent link independent of present/absent/pocket presence; complete sense-sharing and touch-delivery timing/range/origin/attack-modifier protocols; permanent dismissal terminates link |
| `spell:find-steed` | persistent linked identity across ordinary absence; release terminates bond; same-actor recast restoration only with active link; Int floor 6 + caster-spoken language, mounted spell sharing, telepathy ≤1 mi |
| `spell:giant-insect` | choose one maximum alternative (10 centipedes / 3 spiders / 5 wasps / 1 scorpion)→giant refs; verbal command channel separate from caster-turn initiative; per-target dismissal reverts form |
| `spell:phantom-steed` | Large ground-placed riding-horse statblock with speed 100; saddle/bit/bridle vanish beyond 10 ft; designated rider; 10/13 mph travel; damage/action/duration end starts 1-min fade |
| `spell:simulacrum` | beast/humanoid must remain at touch for full 12 h; duplicate at **half HP maximum**, no equipment/advancement/slot recovery; laboratory + rare-material repair prerequisites at 100 gp/HP; 0 HP snow/melt; dispel end; recast cleans up active duplicates |

### 2.2 Stochastic-clause family — 5 — disposition: implemented (slice S2)

One small contract covers all: `percentChance { percent, cumulative?, per,
trigger, resetOn?, secret? }`.

| key | clause |
|---|---|
| `spell:augury` | cumulative 25 %/extra casting before long rest → random reading; GM rolls secret. Omen menu itself: reference prose |
| `spell:commune` | cumulative 25 %/extra casting before long rest → no answer; 3 yes/no questions (reference) |
| `spell:divination` | cumulative 25 %/extra casting → random reading |
| `spell:sending` | flat 5 % failure when target on another plane; 25-word limit (reference) |
| `spell:secret-chest` | cumulative 5 %/day after 60 days → effect ends; chest loss rule on end (reference) |

### 2.3 Ward/trigger & spatial-boundary family — 8 — S3a/S3b/S3c implemented; S3 complete

| key | clauses / reuse |
|---|---|
| `spell:alarm` | **Implemented S3a:** `triggeredEffect` preserves the Tiny+ touch/entry trigger, ≤20-ft cube boundary, exclusions, mental/audible choice, and both alarm outputs |
| `spell:magic-mouth` | **Implemented S3a:** `triggeredEffect` preserves the ≤25-word message, visual/audible ≤30-ft trigger, and once/repeating choice |
| `spell:contingency` | **Implemented S3a:** ordered `spellStoring`, `triggeredEffect`, `exclusiveInstance`, and `componentPresenceTermination` effects preserve the reviewed lifecycle |
| `spell:private-sanctum` | **Implemented S3b:** `wardedArea` preserves the 5–100 ft cube, selectable sound/vision/divination/teleportation/planar boundaries; `permanenceAfterRepetition` preserves daily casting for one year |
| `spell:tiny-hut` | **Implemented S3b:** `wardedArea` preserves creature/object/spell barriers, nine Medium-or-smaller occupants, casting-time exemption, and `triggeredEffect` preserves caster-departure termination |
| `spell:gate` | **Implemented S3c:** existing `planeShift` plus closed `portal` dimensions/front-only contract |
| `spell:demiplane` | **Implemented S3c:** closed `extradimensionalSpace` room and end/reconnect contract |
| `spell:passwall` | **Implemented S3c:** closed `passage` dimensions and safe-ejection contract |

### 2.4 Quantified-creation family — 2 — disposition: implemented (slice S2)

| key | clauses |
|---|---|
| `spell:create-food-and-water` | 45 lb food + 30 gal water; sustains 15 humanoids / 5 steeds 24 h; food spoils in 24 h. Proposed `createsProvisions` payload |
| `spell:create-or-destroy-water` | create/destroy 10 gal, or 30-ft-cube rain (extinguishes exposed flames) / fog destruction; scaling captured |

### 2.5 Conjured-utility-object family — 2 — disposition: implemented (slice S2)

| key | clauses |
|---|---|
| `spell:mage-hand` | 10 lb capacity; 30 ft leash (vanishes beyond); move 30 ft/use; action to control; can't attack/activate magic items |
| `spell:floating-disk` | 500 lb capacity; follows within 20 ft; immobile when caster ≤20 ft; can't cross ≥10 ft elevation change; ends beyond 100 ft |

### 2.6 Table-backed — 1 — disposition: accept\* (already represented)

| key | rationale |
|---|---|
| `spell:creation` | material→duration table already `tableRefs: [table:creation-material-duration]`; cube scaling captured. Its only deterministic clause beyond baseline is the table itself |

### 2.7 Genuinely accepted — 11 — disposition: accept

Retention standard (2026-07-06 integrity pass): a record stays here only if
its deterministic-looking content is purely descriptive parameters of a
GM-narrated outcome — no dice, no DC, no persistent state transition, no
resource/limit bookkeeping, no eligibility gate that an engine would
enforce.

| key | rationale (concise) |
|---|---|
| `spell:commune-with-nature` | knowledge grant; fact count and radii are prompt parameters for narration, no state/dice |
| `spell:druidcraft` | sensory-utility option menu; all effects instantaneous or self-expiring, no concurrent-effect cap |
| `spell:fabricate` | crafting conversion; size caps are parameters, "high degree of craftsmanship" gate is inherently judgment-based (tool-proficiency check is owned by the general crafting/tools rules) |
| `spell:identify` | knowledge grant |
| `spell:illusory-script` | designated-reader illusion; truesight interaction descriptive |
| `spell:legend-lore` | knowledge grant |
| `spell:mending` | repairs break ≤1 ft; no state/dice |
| `spell:move-earth` | slow terrain reshaping; explicitly cannot trap/injure creatures — purely narrative outcome (contrast passwall, now S3) |
| `spell:planar-ally` | negotiated service; payment rates are GM reference guidance, explicitly adjustable |
| `spell:purify-food-and-drink` | area in metadata; purification narrative |
| `spell:stone-shape` | shaping utility; hinge/latch limits are parameters |

### 2.8 Small deterministic clauses reclassified from accept — 8 — disposition: implemented (slice S2)

Integrity pass 2026-07-06: these carried deterministic clauses that were
previously waved through as "low value" / "narration parameters". Under the
artifact's own taxonomy they are model.

| key | deterministic clauses to structure |
|---|---|
| `spell:control-weather` | 1d4×10-minute onset die; one-stage-per-change shift procedure against the already-structured stage tables (`tableRefs: [table:precipitation, table:temperature, table:wind]`). Moved from former §2.6 |
| `spell:animal-messenger` | travel rates: 50 mi/24 h flying, 25 mi/24 h other; 25-word cap; message-lost-on-expiry rule |
| `spell:message` | material blocking thresholds: magical silence, 1 ft stone, 1 in common metal, thin lead sheet, 3 ft wood; no-straight-line propagation |
| `spell:mirage-arcane` | deterministic creation/removal of difficult terrain within the area (interacts with modeled movement-cost semantics); removed-piece-disappears rule |
| `spell:speak-with-dead` | 10-day per-corpse recast lockout (persistent anti-repeat state); 5-question cap; not-undead / has-mouth eligibility |
| `spell:prestidigitation` | concurrent-effect cap: ≤3 non-instantaneous effects active; action to dismiss |
| `spell:thaumaturgy` | concurrent-effect cap: ≤3 one-minute effects active; action to dismiss (shared payload with prestidigitation) |
| `spell:arcanists-magic-aura` | permanence-after-repeated-casting: same effect daily × 30 days → until dispelled (shared payload shape with private-sanctum's 1-year clause in S3) |

### 2.9 C3-contract spells — 2 — disposition: implemented (contract shared with slice C3)

| key | deterministic boundaries |
|---|---|
| `spell:speak-with-animals` | comprehension grant for beasts — same `communication` contract as `creature:dryad#traits:Speak with Beasts and Plants`; keeping the spell accepted while modeling the identical trait was inconsistent |
| `spell:telepathic-bond` | 8-creature cap; willing only; unaffected below Int 3; any distance; blocked cross-plane — `telepathy` contract reuse |

## 3. Implementation slices and routing

PR #399 already contains: broad creature/spell projection deepening, new
effect kinds + payload validators (`kindSchemas.ts` +544 lines), membership
reductions (creatures 170→48, spells 109→53), committed-pack assertions
(`srdMembershipCorrections.test.ts`), and CI test repairs (this commit).
None of the remaining slices below is started unless stated.

| slice | content | new contract? | agent |
|---|---|---|---|
| **C1** shape-change | `changeShape` payload projected for 22 refs (§1.1); findings removed from the reviewed-disposition registry; schema, negative, committed-pack, and regeneration coverage added | yes — compound state transition | **Implemented** |
| **C2** false appearance | `falseAppearance` contract; 16 uniform refs | yes, trivial shape | **Implemented** |
| **C3** telepathy/knowledge/state | `telepathy`, `communication`, `locationKnowledge`, `pathMemory`, sleep-exception payloads; 10 creature refs (§1.3–1.4) + 2 spells (§2.9) | yes, small | **Implemented** |
| **S1** summoning | `summoning` payload extension (option menus, control economy, lifecycle transitions, statblock modification); 14 spells | yes — implemented | **Implemented** |
| **S2** small deterministic clauses | `percentChance` (5, §2.2), quantified creation (2, §2.4), conjured-utility-object (2, §2.5), reclassified clause set (8, §2.8: onset die/stage shift, travel rates, barrier thresholds, difficult-terrain flag, recast lockout, concurrent caps ×2, permanence) | yes, small shapes | **Implemented** |
| **S3** ward/trigger & spatial boundaries | alarm + magic-mouth via existing `triggeredEffect`; contingency via `spellStoring`+`triggeredEffect`; private-sanctum/tiny-hut ward flags; gate, demiplane, and passwall spatial-state payloads; 8 spells (§2.3) | partial reuse; ward flags + spatial payloads new | **Implemented** |
| **S4** membership bookkeeping | after each slice: exact removals/updates in the relevant registry (`CREATURE_ENTRY_REVIEWED_DISPOSITIONS` for creature-entry findings, `ACCEPTED_*` for accepted spell metadata/prose buckets), count reconciliation, readiness-report deltas, pack regeneration | no | **Codex** |
| **C4** reckless family | `recklessAttack` two-sided advantage-toggle contract; 2 refs (§1.6.2) | yes, small | **Implemented** (bead `eshyra-o9bd.18.7.9.10`) |
| **C5** split family | `splitOnDamage` reproduction-on-damage contract; 2 refs (§1.6.3) | yes, small | **Implemented** (bead `eshyra-o9bd.18.7.9.11`) |
| **C6** damage-absorption family | `damageAbsorption` contract; 4 refs (§1.6.4) | yes, trivial shape | **Implemented** (bead `eshyra-o9bd.18.7.9.12`) |
| **C7** berserk family | `berserk` state-machine contract with d6 entry, continuation/exits, and Flesh Golem calming; 2 refs (§1.6.5) | yes — genuine state machine | **Implemented** (bead `eshyra-o9bd.18.7.9.13`) |
| **C8** rampage family | `triggeredBonusAction` with linked reduction trigger and move-and-bite result; 2 refs (§1.6.6) | yes, small closed contract | **Implemented** (bead `eshyra-o9bd.18.7.9.14`) |
| **C9** single-record residuals | `soundAlarm` (shrieker), `onDeathBodyDisposal` (djinni + efreeti, shared), `reactionAcBonus` (shield guardian); 4 refs, 3 contracts (§1.6.7) | yes, small shapes | **Implemented** (bead `eshyra-o9bd.18.7.9.15`) |

Ordering: C1–C9 and S1–S3 are implemented. No implementation slices remain
under this artifact.

Reconciliation (mechanically verified 2026-07-06 against
`CREATURE_ENTRY_REVIEWED_DISPOSITIONS` and `ACCEPTED_METADATA_ONLY_SPELLS`;
every membership key appears in exactly one disposition section):

- creatures, original pass: 48 = C1 22 (§1.1) + C2 16 (§1.2) + C3 8 (§1.3 5 +
  §1.4 3) + accept\* 2 (§1.5)
- creatures, §1.6 residual reconciliation: +24 = 6 implemented this pass
  (§1.6.1, no longer in the accepted array) + 2 folded into the existing C3
  family (§1.3/§1.4: aboleth, ettin — C3 is now 10) + 16 newly classified
  (C4 2 + C5 2 + C6 4 + C7 2 + C8 2 + C9 4, C9's 4 refs sharing 3 contracts
  since djinni/efreeti share `onDeathBodyDisposal`)
- creatures total reviewed by this artifact: 72 (48 + 24); residual
  `CREATURE_ENTRY_REVIEWED_DISPOSITIONS` membership after the C4/C5/C6/C7/C8/C9
  rollouts: 2 (72 - 6 implemented - 16 C2 implemented - 10 C3 implemented
  - 22 C1 implemented - 2 C5 implemented - 4 C6 implemented - 2 C7
  implemented - 2 C8 implemented - 4 C9 implemented - 2 C4 implemented) =
  2 permanent accepted-prose-only refs. Pending findings: 0.
- spells originally classified here: 53 = S1 14 (§2.1) + S2 17 (§2.2 5 +
  §2.4 2 + §2.5 2 + §2.8 8) + S3 8 (§2.3) + C3 2 (§2.9) + accept 11 (§2.7) +
  accept\* 1 (§2.6). Residual `ACCEPTED_METADATA_ONLY_SPELLS` membership after
  C3+S2 rollout: 34 (53 - 2 C3 implemented - 17 S2 implemented) = S1 14 +
  S3 8 + accept 11 + accept\* 1. Residual membership after S1 rollout: 20
  (34 - 14 S1 implemented) = S3 8 + accept 11 + accept\* 1. S3a then
  graduated three trigger-based spells, leaving 17 = S3b/S3c 5 + accept 11
  + accept\* 1. S3b then graduated Private Sanctum and Tiny Hut, leaving 15;
  S3c graduated Gate, Demiplane, and Passwall, leaving 12 = accept 11 +
  accept\* 1. The S3 family is complete.

The exact residual metadata-only spell membership is 12 keys: `spell:commune-with-nature`,
`spell:creation`, `spell:druidcraft`, `spell:fabricate`, `spell:identify`,
`spell:illusory-script`, `spell:legend-lore`, `spell:mending`, `spell:move-earth`,
`spell:planar-ally`, `spell:purify-food-and-drink`, and `spell:stone-shape`.

**14 records total (2 creatures + 12 spells) are closed permanently by this
document.** An earlier revision claimed 26 permanent accepts (with
internally inconsistent section counts of 3+2+23); the 2026-07-06 integrity
pass reclassified 13 spells and 1 creature ref out of the acceptance bucket
under the strict taxonomy and corrected the arithmetic. Note in particular:
`spell:animate-objects` was **S1** before the rollout: its `tableRefs` link
only made the printed size table available for lookup. It did not represent the
fixed construct abilities, conditional movement, senses, attack procedure, or
summoning/control semantics. Those are now carried by the typed `summoning`
effect while the table remains the owner of size-varying AC/HP/attack values.

Final closure: all C1–C9 and S1–S3 implementation slices are complete under
this artifact; the creature readiness report has zero pending findings, and no
implementation work remains here.
