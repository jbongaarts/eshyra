# eshyra-o9bd.18.7.8 — Execution-boundary classification of the 175 deterministic rule procedures

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.8` (second-stage classification over
the merged PR #400 semantic classification and PR #402 code-ownership
inventory).

**Question answered here** (not answered by the prior artifacts): which PROC
rules truly require new deterministic engine/tool/state ownership for Eshyra
to be complete, accurate, and playable — and which are intentionally and
adequately adjudicated by the DM model over the existing deterministic
primitives? PR #402's `unimplemented` was a factual code-ownership statement,
**not** an implementation backlog; this artifact draws the architecture
boundary rule by rule. **Do not repeat this pass.**

Inputs (read, not re-derived):

- `2026-07-06-o9bd-18-7-8-rule-classification.md` — 335-record semantic
  classification; the 175 PROC keys and 13 families used here.
- `2026-07-06-o9bd-18-7-8-3-engine-coverage-inventory.md` — per-rule current
  code ownership (implemented 0 / partial 19 / unimplemented 148 /
  design-blocked 8).
- PR #401 design artifact
  (`2026-07-06-o9bd-18-7-8-1-rule-disposition-layer-design.md`, branch
  `eshyra-o9bd-18-7-8-1-disposition-design`) — provisional; §5 below is the
  required delta.

## 0. Runtime support evidence (surveyed 2026-07-06 on `main`)

The model-adjudicated bar below is grounded in the actual registered tool
surface (`packages/core/src/orchestrator/tools.ts` `DEFAULT_TOOLS`), not in
"the model can read the prose":

- **Rule/record retrieval**: `lookup_rules`
  (`packages/core/src/orchestrator/toolLookupRules.ts`) serves every pack
  record — including all 335 `rule:*` records' full text — by name or ref,
  pull-based, on the live gameplay path. Retrieval capability exists for every
  rule; the DM system prompt must direct the model to look rules up rather
  than trust parametric memory (context requirement, shared by every
  model-adjudicated row).
- **Randomness**: `roll` (`toolRoll.ts` over `dice.ts`) — seeded, categorized
  (attack/damage/initiative/saving_throw/death_save/ability_check/other),
  grammar `NdM+K` only. The result exposes **individual die values**
  (`rolls[]`) and totals in the player-visible roll ledger
  (`playerVisibleRollLedger.ts`), so natural 1/20 and per-die crit math are
  auditable. No advantage/disadvantage or keep/drop notation (named gap).
- **Canon writes** (typed tools only; the general `mutate_state` tool exists
  in code but is **not registered** in `DEFAULT_TOOLS`): `adjust_hp` (delta
  clamped to `[0, hp_max]`; **overflow below 0 is discarded**, which hides
  the instant-death signal), `add_condition`/`remove_condition`
  (`CharacterConditionEntry` = `{id}` **plus arbitrary JSON extension
  fields** — levels, sources, expiry notes are representable),
  `give_item`/`remove_item` (inventory rows carry free-form
  `properties_json`), `start_encounter`/`update_combatant`/
  `close_combat_instance` (per-combatant hp/ac/conditions/status/initiative/
  placement), `update_clock` (in-game time + location), `set_plot_flag`,
  `set_world_fact`/`record_world_fact` + `overlay_facts` (durable keyed JSON
  store), `world_query`, `memory_drilldown`.
- **Durable generic state**: conditions extensions, inventory
  `properties_json`, and `overlay_facts` give the DM model a durable,
  auditable place to persist ad-hoc counters (deprivation days, held
  reactions, inspiration). What does **not** exist is any invariant-enforcing
  owner: nothing counts attunement slots, decrements spell slots, tracks
  death saves, buffers temp HP, or runs rest/recharge resets.
- **Auditability**: every canon write is a logged tool call; rolls are
  ledgered; `turnAuditor.ts` reviews turns.

## 1. Execution-boundary taxonomy (final)

Exactly one primary disposition per rule:

- **`code-enforced`** — all deterministic semantics that require enforcement
  are owned by runtime code with test evidence. (Currently **0** rules fully
  qualify; the class exists for the disposition layer's end state.)
- **`model-adjudicated-supported`** (`MODEL` in the table) — DM-model
  adjudication over the deterministic primitives is the *intended terminal
  architecture* for this rule, and the §0 surface is sufficient: full rule
  text retrievable via `lookup_rules`; all randomness through seeded `roll`
  with visible ledger; required canon mutations available through typed
  tools; any cross-turn state durably representable (conditions extensions /
  `properties_json` / `overlay_facts`), not model-memory-only; violations
  visible in the transcript/ledger rather than silent; and the remaining
  judgment is legitimately a ruling (situational interpretation), not a
  missing state machine or invariant. Applied conservatively: the common
  profile is a **per-turn, stateless or narratively-scoped procedure** in a
  text-first game with no grid — geometry, movement, positioning, situational
  modifiers, downtime, statblock conventions.
- **`partial`** (`PARTIAL`) — some clauses are code-owned or adequately
  model-supported; others are missing and actionable. Exact missing clauses
  named per row.
- **`implementation-required`** (`IMPL`) — correct, safely-playable behavior
  needs a new deterministic owner (state machine, invariant, dice-grammar
  extension, validator, or engine hook). The deciding profile: **cross-turn
  or cross-session counters, hard invariants, and reset economies** where the
  current tool surface can silently violate the rule (or, as with
  `adjust_hp` clamping, actively hides the needed signal), and where the
  behavior is deterministic rather than a ruling. Frequency and stakes were
  weighed: high-frequency combat-critical state machines are IMPL;
  low-frequency slow-time counters with durable generic storage are MODEL.
- **`design-blocked`** (`DESIGN`) — a domain/architecture decision is
  required first; exact owner named.

**External ownership is clause-specific, never row-level**: a row with an
externally-owned clause (e.g. gear payloads → `eshyra-o9bd.18.7.6`, magic-item
charge data → `eshyra-o9bd.18.7.7.1`) keeps its own primary disposition for
the remaining clauses, and bead closure alone is not evidence — coverage is
re-evaluated against runtime evidence when the owning bead lands.

Two boundary rules of thumb applied throughout, recorded so future
classification stays consistent:

1. **Play-time situational rules → MODEL.** Cover, AoE geometry, terrain,
   hiding, range, squeezing, mounts, underwater, travel, downtime, traps,
   object interaction: in a text-first, grid-less game these are exactly the
   rulings ADR 0001 routes through the DM model. Building geometry/position
   engines for them would contradict the product architecture.
2. **Deterministic cross-turn state with invariants → IMPL.** Death saves,
   temp HP, rests, concentration, slots, recharge/usage economies,
   attunement, the per-turn action budget: these are state machines, not
   rulings; model memory is not durable state and the tool surface cannot
   currently stop a violation.

## 2. Master matrix (all 175 PROC rules, by key)

Family abbreviations follow the #400 taxonomy. `#402` is the merged
code-ownership status. `F*`/`D*` reference the §4 implementation families.

| key | family | #402 | boundary | notes |
|---|---|---|---|---|
| a-clear-path-to-the-target | spellcasting | unimplemented | MODEL | targeting/obstruction ruling; no grid; rule text retrievable |
| abilities | magic-items | unimplemented | MODEL | GM-time sentient-item generation; 4d6-drop-lowest via four seeded rolls today; F1 keep/drop removes the workaround |
| ability-checks | core-d20 | partial | MODEL | seeded d20 + code-owned PC modifiers + visible ledger; DC setting/comparison is the DM's ruling role |
| ability-scores-and-modifiers | core-d20 | partial | PARTIAL | formula + PC bounds code-owned; missing: generic 1–30 range validation on non-PC ability writes → F8 |
| activating-an-item | magic-items | unimplemented | MODEL | activation-vs-Use-an-Object distinction is a per-turn ruling |
| advantage-and-disadvantage | core-d20 | unimplemented | IMPL | F1: 2d20 keep-high/low + cancellation/no-stacking belong in the roll tool; highest-frequency mechanic; two-roll workaround leaves selection unenforced |
| ammunition | monster-conventions | unimplemented | MODEL | statblock convention; inventory + ledger suffice |
| areas-of-effect | spellcasting | unimplemented | MODEL | narrative geometry; shape rows retrievable |
| armor-guidance | gear-payload | unimplemented | MODEL | per-armor stats structured in gear records; penalty application is per-roll adjudication; per-record payload completeness clause → eshyra-o9bd.18.7.6 |
| armor-weapon-and-tool-proficiencies | monster-conventions | unimplemented | MODEL | default statblock assumption; no state |
| attack | combat-core | unimplemented | MODEL | one-attack grant adjudicated; F2 budget makes the action itself checkable; attack counting stays adjudicated (Extra Attack/Multiattack feature-dependent) |
| attack-rolls | core-d20 | partial | MODEL | seeded attack-category rolls, natural die visible; AC comparison adjudicated |
| attunement | magic-items | unimplemented | IMPL | F5: durable cross-session state machine (max 3, no duplicates, distance/24 h/death/voluntary endings); nothing counts slots today |
| backgrounds-equipment | char-build | partial | PARTIAL | package grants code-owned; missing: coin-purchase alternative + package-XOR-coin gate in the code-owned creation flow → F8 |
| backgrounds-proficiencies | char-build | unimplemented | IMPL | F8: duplicate-proficiency replacement is a creation-engine validator; creation is a code-owned flow, so the gap is engine work (small) |
| being-prone | movement | unimplemented | MODEL | prone condition + movement-cost ruling |
| beyond-1st-level | advancement | partial | PARTIAL | fixed-average HP path code-owned; missing: rolled-HP via seeded dice, ASI-cap-20 enforcement at improvement time → F8 |
| blindsight | perception-senses | unimplemented | MODEL | per-creature radii structured; detection ruling |
| bonus-action | spellcasting | unimplemented | IMPL | F2: bonus-action-spell → action-cantrip-only timing is a deterministic per-turn invariant models reliably violate |
| bonus-actions | action-economy | unimplemented | IMPL | F2: one bonus action per turn — turn-budget state |
| breaking-up-your-move | movement | unimplemented | MODEL | narrative movement |
| burrow | movement-environment | unimplemented | MODEL | movement-mode ruling; speeds structured |
| casting-a-spell-at-a-higher-level | spellcasting | unimplemented | MODEL | per-spell `scaling` structured; upcast arithmetic per cast; slot-level legality depends on F4 |
| casting-a-spell-attack-rolls | spellcasting | partial | MODEL | spellAttackModifier code-owned for PCs; monster values structured; within-5-ft clause is a per-roll ruling |
| casting-a-spell-range | spellcasting | unimplemented | MODEL | narrative range/targeting validation |
| casting-a-spell-saving-throws | spellcasting | partial | PARTIAL | base DC code-owned; missing: special-modifier application in derivation; item-bonus data clause → eshyra-o9bd.18.7.7.2; application hook → F8 |
| casting-in-armor | spellcasting | unimplemented | MODEL | armor-proficiency data structured; gate is per-cast check |
| channel-divinity | multiclassing | design-blocked | DESIGN | D1 multiclass decision |
| charges | magic-items | unimplemented | PARTIAL | identify-reveal clause MODEL; pack-side charge data clause → eshyra-o9bd.18.7.7.1; live expenditure/recharge state clause → F5 |
| class-features | multiclassing | design-blocked | DESIGN | D1 |
| climb | movement-environment | unimplemented | MODEL | cost-exemption ruling; speeds structured |
| climbing-swimming-and-crawling | movement | unimplemented | MODEL | movement-cost ruling |
| coinage | economy | partial | MODEL | exchange code-owned (`currency.ts`); coin weight (50/lb) is an encumbrance ruling — adequately adjudicated, #402 partial resolved as no engine need |
| combat-step-by-step | combat-core | partial | MODEL | encounter lifecycle state code-owned; the 5-step narration procedure is the DM's job |
| combining-magical-effects | spellcasting | unimplemented | MODEL | same-effect non-stacking ruling; F3's active-effect registry will improve visibility (dependency note, not a blocker) |
| command-word | magic-items | unimplemented | MODEL | silence/sound gating ruling |
| complex-traps | hazards | unimplemented | MODEL | trap initiative/actions procedure; encounter tools suffice |
| concentration | spellcasting | unimplemented | IMPL | F3: durable concentration marker, auto Con save DC max(10, ⌊dmg/2⌋) on every damage instance, single-instance invariant, break conditions — high-frequency cross-turn state machine |
| cone | spellcasting | unimplemented | MODEL | geometry ruling |
| conflict | sentient-items | unimplemented | MODEL | occasional contest procedure; seeded dice suffice |
| constitution-hit-points | advancement | partial | PARTIAL | per-level Con applied in levelUpEngine; missing: retroactive hp_max recalc on Con-mod change → F8 |
| consumables | magic-items | unimplemented | MODEL | one-shot consumption = `remove_item` mutation; supported today |
| contests | core-d20 | unimplemented | MODEL | opposed seeded rolls; tie = status quo is per-contest arithmetic |
| controlling-a-mount | mounted | unimplemented | MODEL | controlled/independent ruling; initiative sync narratable |
| cover | combat-core | unimplemented | MODEL | classic ruling; ±2/±5 applied per visible roll |
| crafting | downtime | unimplemented | MODEL | slow-time gp/day arithmetic; clock + currency code-owned |
| critical-hits | combat-core | unimplemented | MODEL | double the dice per roll; natural die visible in ledger |
| cube | spellcasting | unimplemented | MODEL | geometry ruling |
| customizing-a-background | char-build | unimplemented | DESIGN | D2: whether the code-owned creation flow offers background customization is a product decision, not a play-time ruling |
| cylinder | spellcasting | unimplemented | MODEL | geometry ruling |
| damage-resistance-and-vulnerability | combat-core | unimplemented | MODEL | per-application halving/doubling over structured resistances; visible via ledger + HP deltas; a typed damage pipeline is a future option, not required for safe play |
| damage-rolls | combat-core | partial | MODEL | seeded dice code-owned; add-mod/min-0/roll-once arithmetic per-roll and auditable |
| darkvision | perception-senses | unimplemented | MODEL | lighting-substitution ruling; radii structured |
| dash | action | unimplemented | MODEL | extra-movement grant; narrative movement |
| death-saving-throws | rest-death | partial | IMPL | F6: success/failure counters, nat-1 double / nat-20 revive, damage-at-0 escalation — the canonical silent-violation state machine; only the roll category exists |
| detecting-and-disabling-a-trap | hazards | unimplemented | MODEL | check-based procedure; seeded rolls + trap DCs retrievable |
| dexterity-attack-rolls-and-damage | core-d20 | unimplemented | MODEL | which-ability ruling; finesse tags structured |
| dexterity-initiative | combat-core | partial | MODEL | initiative rolls + combatant state code-owned; ordering visible |
| disengage | action | unimplemented | MODEL | until-end-of-turn effect; condition entry representable |
| dodge | action | unimplemented | MODEL | until-next-turn effect representable as combatant condition; per-roll adv/dis application |
| downtime-activities | downtime | unimplemented | MODEL | 8 h/day scheduling ruling; clock owned |
| equipment | monster-conventions | unimplemented | MODEL | component default assumption |
| expenses-lifestyle-expenses | economy | unimplemented | MODEL | slow-time cost arithmetic; currency owned |
| experience-points | advancement | partial | PARTIAL | XP→level thresholds code-owned; multiclass total-level clause → D1 |
| extra-attack | multiclassing | design-blocked | DESIGN | D1 |
| falling | environment | unimplemented | MODEL | 1d6/10 ft, max 20d6, prone — per-event seeded dice |
| falling-unconscious | rest-death | unimplemented | IMPL | F6: 0 HP → unconscious should be an adjust_hp-time invariant, not a remembered step |
| feats | char-build | unimplemented | DESIGN | D2: variant-feat adoption + prerequisite tracking in the code-owned advancement flow (SRD ships one feat) |
| fly | movement-environment | unimplemented | MODEL | hover/death-fall ruling; flags structured |
| flying-movement | movement | unimplemented | MODEL | fall-when-prone/speed-0 ruling |
| food | survival | unimplemented | MODEL | deprivation-day counters durably representable (overlay_facts/conditions); clock owned; low-frequency slow-time procedure |
| food-and-water | survival | unimplemented | MODEL | as `food`; exhaustion-not-removable-until-fed gate is a rest-time ruling (F7 hook noted) |
| gaining-inspiration | inspiration | unimplemented | MODEL | boolean resource durably representable via overlay_facts; low stakes; candidate future character field, not required |
| grapple-rules-for-monsters | monster-conventions | unimplemented | MODEL | default escape DC arithmetic from structured Str |
| grappling | combat-contests | unimplemented | MODEL | contest rolls + grappled condition + half-speed drag ruling |
| group-checks | core-d20 | unimplemented | MODEL | half-succeed arithmetic over visible rolls |
| half-dragon-template | templates | unimplemented | MODEL | GM-time content-creation procedure; tables structured |
| healing | rest-death | partial | PARTIAL | add + clamp code-owned; missing: dead-creature regain gate (needs F6's durable dead state on the HP write path) |
| help | action | unimplemented | MODEL | advantage grant; per-roll |
| hide | action | unimplemented | MODEL | Stealth check per hiding ruling |
| hiding | perception | unimplemented | MODEL | Stealth vs active/passive Perception; passive derivable (10+mods) |
| hit-points | monster-conventions | unimplemented | MODEL | per-creature HP/HD structured; the size-die formula is GM-time creature design |
| hit-points-and-hit-dice | multiclassing | design-blocked | DESIGN | D1 |
| improvised-weapons | gear-payload | unimplemented | MODEL | 1d4 / proficiency-analogy ruling; per-record payload clause → eshyra-o9bd.18.7.6 |
| innate-spellcasting | monster-conventions | unimplemented | MODEL | statblock convention; per-creature entries structured |
| instant-death | rest-death | unimplemented | IMPL | F6: needs the damage overflow that `adjust_hp` currently clamps away — the tool surface hides the trigger; deterministic threshold, not a ruling |
| interacting-with-objects | objects | unimplemented | MODEL | GM-set object stats; auto-fail/immunity rulings |
| jumping | movement | unimplemented | MODEL | Str-based distance arithmetic; narrative movement |
| knocking-a-creature-out | rest-death | unimplemented | MODEL | declared choice at damage time → unconscious+stable conditions (durable once F6 defines stable) |
| lair-actions | monster-conventions | unimplemented | MODEL | initiative-20 scheduling ruling |
| legendary-actions | monster-conventions | unimplemented | IMPL | F5: per-round counter economy (spend on others' turns, regain at start) — encounter-scoped reset state machine |
| legendary-creatures | monster-conventions | unimplemented | MODEL | form-assumption exclusion gate; ruling over structured data |
| lifting-and-carrying | encumbrance | unimplemented | MODEL | Str×15 arithmetic over structured scores + inventory |
| limited-usage | monster-conventions | unimplemented | IMPL | F5: X/Day + Recharge X–Y + rest resets — durable per-entry usage state and reset procedure; per-entry economies structured, runtime owner missing |
| line | spellcasting | unimplemented | MODEL | geometry ruling |
| long-rest | rest-death | unimplemented | IMPL | F7: 8 h gate, 1/24 h, ≥1 HP requirement, full HP + half-HD restore, resource reset orchestration (hooks F4/F5) |
| longer-casting-times | spellcasting | unimplemented | MODEL | rare multi-turn casting; in-progress state durably representable as condition; slot-kept-on-break ruling |
| madness-effects | hazards | unimplemented | MODEL | table rolls + durations; seeded dice + clock |
| making-an-attack | combat-core | unimplemented | MODEL | 3-step narration procedure over code-owned rolls |
| material-m | spellcasting | unimplemented | MODEL | focus/pouch substitution + cost-component gating rulings; per-spell components structured |
| melee-attacks | combat-core | unimplemented | MODEL | reach/unarmed arithmetic per roll |
| modifiers-to-the-roll | core-d20 | unimplemented | MODEL | mod+PB composition; PC values code-owned |
| mounted-combat | combat-core | unimplemented | MODEL | eligibility gate ruling (size/anatomy/willing) |
| mounting-and-dismounting | mounted | unimplemented | MODEL | movement-cost + save rulings |
| mounts-and-vehicles | economy | unimplemented | MODEL | purchase/pull-capacity arithmetic; mount stats structured as equipment records |
| movement-and-position | movement | unimplemented | MODEL | budget-spending narration |
| movement-and-position-difficult-terrain | movement | unimplemented | MODEL | +1 ft/ft ruling |
| moving-around-other-creatures | movement | unimplemented | MODEL | pass-through/occupancy ruling |
| moving-between-attacks | movement | unimplemented | MODEL | narrative movement |
| multiattack | combat-core | unimplemented | MODEL | no-OA restriction ruling; routines structured (18.7.9) |
| multiclassing | multiclassing | design-blocked | DESIGN | D1 |
| multiclassing-proficiency-bonus | multiclassing | design-blocked | DESIGN | D1 |
| objects | objects | unimplemented | MODEL | AC/HP tables structured; threshold/immunity rulings |
| opportunity-attacks | combat-core | unimplemented | MODEL | trigger/exclusion ruling; reaction budget dependency → F2 |
| other-activity-on-your-turn | action-economy | unimplemented | IMPL | F2: one free object interaction — same turn-budget record as actions/bonus/reaction (marginal cost ~0 once F2 exists) |
| paired-items | magic-items | unimplemented | MODEL | both-of-pair requirement ruling; inventory visible |
| passive-checks | core-d20 | unimplemented | MODEL | 10+mods (±5) derivable arithmetic; candidate derived value, not required |
| poisons | hazards | unimplemented | MODEL | delivery-type exposure rulings; hazard data structured |
| practicing-a-profession | downtime | unimplemented | MODEL | slow-time earnings |
| proficiency-bonus | core-d20 | partial | MODEL | PB values code-owned; apply-once/multiply-once/×0 discipline is per-roll adjudication over visible rolls |
| range | combat-core | unimplemented | MODEL | normal/long-range disadv ruling; ranges structured |
| ranged-attacks-in-close-combat | combat-core | unimplemented | MODEL | within-5-ft disadv ruling |
| reactions | action-economy | unimplemented | IMPL | F2: one reaction per round crosses turn boundaries — budget state, not a ruling |
| ready | action | unimplemented | MODEL | held trigger + readied-spell concentration representable as condition; reaction spend → F2 |
| recuperating | downtime | unimplemented | MODEL | 3-day + DC 15 Con procedure; clock + dice |
| researching | downtime | unimplemented | MODEL | slow-time gp/day |
| rituals | spellcasting | unimplemented | MODEL | +10 min, no-slot casting; ritual flags structured |
| rolling-1-or-20 | combat-core | unimplemented | MODEL | natural die visible in `rolls[]`; auto-hit/miss applied per roll; candidate roll-tool annotation, not required |
| saving-throws | core-d20 | partial | MODEL | seeded saving_throw rolls + code-owned save modifiers; DC comparison adjudicated |
| search | action | unimplemented | MODEL | check-based action |
| self-sufficiency | downtime | unimplemented | MODEL | wilderness lifestyle equivalence ruling |
| selling-treasure | economy | unimplemented | MODEL | half/full-price arithmetic |
| short-rest | rest-death | unimplemented | IMPL | F7: HD spending needs a durable hit-dice pool (roll + Con each) and reset interaction |
| shoving-a-creature | combat-contests | unimplemented | MODEL | contest → prone/push ruling |
| silvered-weapons | economy | unimplemented | MODEL | flat-cost arithmetic |
| somatic-s | spellcasting | unimplemented | MODEL | free-hand gating ruling |
| special-traits-spellcasting | monster-conventions | unimplemented | MODEL | statblock convention; entries structured |
| special-weapons | gear-payload | unimplemented | PARTIAL | generic semantics MODEL; missing per-record payloads (net restraint DC/AC, lance rules) — clause externally owned by eshyra-o9bd.18.7.6 |
| speed | movement-environment | unimplemented | MODEL | travel-pace table structured; forced-march Con saves per hour over clock |
| speed-difficult-terrain | movement-environment | unimplemented | MODEL | half-pace ruling |
| spell-slots | spellcasting | unimplemented | IMPL | F4: durable expenditure/restoration economy (expend ≥ spell level; long-rest restore); progression structured, live-state owner missing |
| spellcasting | multiclassing | design-blocked | DESIGN | D1 (multiclass slot formula) |
| spells | magic-items | unimplemented | MODEL | item-casting procedure ruling; per-item spell data completeness → 18.7.7 corpus work |
| sphere | spellcasting | unimplemented | MODEL | geometry ruling |
| squeezing-into-a-smaller-space | movement | unimplemented | MODEL | size/cost/disadv ruling |
| stabilizing-a-creature | rest-death | unimplemented | IMPL | F6: stable flag + 1d4 h → 1 HP timer inside the death state machine |
| strength-attack-rolls-and-damage | core-d20 | unimplemented | MODEL | which-ability ruling |
| suffocating | survival | unimplemented | MODEL | breath/round countdown narratable over clock; the drop-to-0 endpoint lands in F6 (note) |
| surprise | combat-core | unimplemented | MODEL | encounter-start determination; passive Perception derivable |
| swim | movement-environment | unimplemented | MODEL | cost-exemption ruling |
| targeting-yourself | spellcasting | unimplemented | MODEL | self-target eligibility ruling |
| telepathy | monster-conventions | unimplemented | MODEL | communication semantics ruling; per-creature payloads (18.7.9 C3) |
| temporary-hit-points | rest-death | unimplemented | IMPL | F6: separate durable buffer, no-stacking choice, consumed-before-HP, not-healing, long-rest expiry — `adjust_hp` cannot represent any of it |
| the-order-of-combat | combat-core | partial | MODEL | round/turn state code-owned; cycle narration is the DM's job |
| the-order-of-combat-initiative | combat-core | partial | MODEL | rolls + combatant state code-owned; group-roll/tie rulings |
| training | downtime | unimplemented | MODEL | 250 days × 1 gp slow-time |
| tremorsense | perception-senses | unimplemented | MODEL | ground-contact detection ruling |
| truesight | perception-senses | unimplemented | MODEL | auto-success bundle applied as per-event rulings; radii structured |
| two-weapon-fighting | combat-core | unimplemented | MODEL | light-property check per roll; bonus-attack spend → F2; no-positive-mod per-roll arithmetic |
| unarmored-defense | multiclassing | design-blocked | DESIGN | D1 |
| underwater-combat | environment | unimplemented | MODEL | melee/ranged/fire-resistance rulings |
| unseen-attackers-and-targets | combat-core | unimplemented | MODEL | adv/disadv + wrong-guess auto-miss rulings |
| use-an-object | action | unimplemented | MODEL | action definition; interaction budget → F2 |
| using-different-speeds | movement | unimplemented | MODEL | cross-mode subtraction arithmetic |
| using-inspiration | inspiration | unimplemented | MODEL | spend → advantage; durable boolean via overlay_facts |
| variant-encumbrance | encumbrance | unimplemented | MODEL | optional-rule threshold arithmetic, play-time |
| variant-skills-with-different-abilities | core-d20 | unimplemented | MODEL | optional recombination ruling, play-time |
| verbal-v | spellcasting | unimplemented | MODEL | gag/silence gating ruling |
| vision-and-light | environment | unimplemented | MODEL | obscurement/light-level rulings |
| water | survival | unimplemented | MODEL | as `food`: durable slow-time counters + Con saves |
| weapon-proficiency | equipment | unimplemented | MODEL | PB gating per roll over structured proficiencies |
| weapon-properties | gear-payload | unimplemented | MODEL | property semantics applied per roll over structured tags; per-record payload completeness clause → eshyra-o9bd.18.7.6 |
| wizard-your-spellbook | downtime | unimplemented | MODEL | copy-cost arithmetic, slow-time |
| working-together | core-d20 | unimplemented | MODEL | leader-rolls-with-advantage ruling |
| your-turn | action-economy | unimplemented | IMPL | F2: the core turn budget (move + one action, forgo allowed) — the record every other F2 row hangs off |

## 3. Census and mechanical verification

**code-enforced 0 · model-adjudicated-supported 137 · partial 9 ·
implementation-required 19 · design-blocked 10 = 175.**

- partial (9): ability-scores-and-modifiers, backgrounds-equipment,
  beyond-1st-level, casting-a-spell-saving-throws, charges,
  constitution-hit-points, experience-points, healing, special-weapons.
- implementation-required (19): advantage-and-disadvantage, attunement,
  backgrounds-proficiencies, bonus-action, bonus-actions, concentration,
  death-saving-throws, falling-unconscious, instant-death, legendary-actions,
  limited-usage, long-rest, other-activity-on-your-turn, reactions,
  short-rest, spell-slots, stabilizing-a-creature, temporary-hit-points,
  your-turn.
- design-blocked (10): the 8 multiclass rows (channel-divinity,
  class-features, extra-attack, hit-points-and-hit-dice, multiclassing,
  multiclassing-proficiency-bonus, spellcasting, unarmored-defense → D1) +
  customizing-a-background, feats (→ D2). Note: `feats` and
  `customizing-a-background` were `unimplemented` in #402; they are
  design-blocked here because they are creation/advancement-flow options —
  a code-owned domain — whose adoption is a product decision, not a play-time
  ruling.

Verification (run 2026-07-06, script inline in the PR that lands this file):
the §2 key set was mechanically compared against the 175 PROC keys parsed
from the #400 master matrix (`| PROC` / `| PROC+TABLE` rows) — **exact
equality, no duplicates, no omissions, no stale extras**; the census above is
recomputed from the §2 rows and sums to 175. The #400-vs-#402 key sets were
also re-verified equal. Regenerate mechanically whenever the matrix changes.

Net movement from #402 (mechanically joined on key, 2026-07-06): 148
`unimplemented` → 126 MODEL + 18 IMPL + 2 PARTIAL (charges, special-weapons)
+ 2 DESIGN (feats, customizing-a-background); 19 `partial` → 11 MODEL (the
code-owned portion plus a legitimate ruling remainder) + 7 stay PARTIAL +
1 IMPL (death-saving-throws); 8 `design-blocked` → 8 DESIGN. The headline: **the
great majority of PROC rules are already architecturally supported** — the
genuine engine backlog is 19 IMPL rules + 9 clause-level PARTIALs, clustering
into seven families.

## 4. Actionable implementation families (derived from the completed corpus)

Only rules classified IMPL/PARTIAL/DESIGN generate work. Memberships are
exact and artifact-backed; nothing else in the 175 belongs to a family.

- **F1 — dice-grammar extension** (Codex). Members: advantage-and-disadvantage;
  dependency beneficiaries: abilities (4d6kh3), every MODEL row that applies
  adv/dis. Need: `2d20kh1`/`kl1` + `NdMkhX`/`klX`/drop notation in `dice.ts`
  + roll-tool schema; cancellation/no-stacking documented in the tool
  description. Small, highest leverage.
- **F2 — action-economy turn budget** (Opus design, Codex rollout). Members:
  your-turn, bonus-actions, reactions, other-activity-on-your-turn,
  bonus-action. Need: per-combatant per-turn budget record (action, bonus,
  reaction-per-round, free interaction, movement note) on encounter state +
  turn-loop reset + bonus-action-spell timing check. Deliberately *not* a
  full action legality engine — attack counting and action choice stay
  adjudicated.
- **F3 — concentration & active-effect lifecycle** (Opus). Members:
  concentration. Need: durable active-effect/concentration marker
  (caster, spell ref, started-at), single-instance invariant, auto save
  prompt on damage (DC max(10, ⌊dmg/2⌋) per source), break-on
  incapacitated/death/new-concentration. Benefits combining-magical-effects
  visibility.
- **F4 — spell-slot economy** (Codex, small design). Members: spell-slots.
  Need: per-level slot counters on character live state seeded from the
  code-owned progression; expend(≥ level) validation; long-rest restore hook
  (F7). Unblocks upcast legality (casting-a-spell-at-a-higher-level stays
  MODEL).
- **F5 — usage/recharge & attunement state** (Opus design, Codex rollout).
  Members: limited-usage, legendary-actions, attunement; clause: charges
  (live expenditure/recharge; pack data → 18.7.7.1). Need: durable per-entity
  usage counters (X/day, recharge X–Y, legendary per-round) with reset events
  (turn-start d6 recharge, short/long rest, dawn) + attunement slot machine
  (max 3, no duplicates, ending conditions).
- **F6 — death, dying & HP-buffer state** (Opus). Members:
  death-saving-throws, falling-unconscious, instant-death,
  stabilizing-a-creature, temporary-hit-points; clause: healing (dead-gate).
  Need: dying/stable/dead status on the HP write path; `adjust_hp` must
  surface sub-zero overflow (instant-death threshold) instead of discarding
  it; death-save counters w/ nat-1/nat-20 semantics; damage-at-0 escalation;
  temp-HP buffer consumed before HP with no-stacking choice and long-rest
  expiry.
- **F7 — rest engine** (Opus). Members: short-rest, long-rest. Need: durable
  hit-dice pool + spend procedure; long-rest gates (8 h, 1/24 h, ≥1 HP) +
  restore orchestration calling F4/F5/F6 reset hooks; exhaustion/food-water
  interaction note.
- **F8 — character-build gap closures** (Codex). Clause members:
  ability-scores-and-modifiers (non-PC range validation),
  backgrounds-equipment (coin XOR path), backgrounds-proficiencies
  (duplicate-swap validator), beyond-1st-level (rolled HP via seeded dice;
  ASI cap 20), constitution-hit-points (retroactive recalc),
  casting-a-spell-saving-throws (special-modifier application hook; data →
  18.7.7.2).
- **D1 — multiclass decision** (design bead; owner: eshyra-o9bd.18.7.8 parent
  pending a dedicated decision bead under an engine epic). Members: the 8
  multiclass rows + experience-points' multiclass clause. Decide: in/out of
  product scope for v1; if in, an engine epic.
- **D2 — creation-variant policy** (design decision, small). Members: feats,
  customizing-a-background. Decide whether the creation/advancement flow
  offers variant feats and background customization; if yes, F8-style Codex
  slices.

Ordering recommendation: F1 → F6 → F2 → F4 → F7 → F5 → F3 → F8 (F1 is
trivial and universal; F6 is the highest-stakes safety gap; F2/F4 are the
most common play-loop invariants; F7 depends on F4/F5/F6 hooks; F3 is
self-contained; F8 is independent cleanup). F5/F6/F7 state shapes should be
designed together (shared reset-event vocabulary) even if implemented
separately. These are engine slices **outside** the importer/audit scope of
18.7.8 and belong under an engine epic, per the #402 recommendation.

## 5. Required delta to PR #401 (disposition-layer design)

The #401 design predates this classification and its coverage vocabulary is
incomplete. Required revisions (do not merge #401 as-is):

1. **Coverage vocabulary**: `RuleCoverageStatus` gains
   `model-adjudicated-supported` as a first-class, *reviewed, evidence-backed*
   terminal status — not a synonym of `unimplemented`. Its row shape needs:
   `primitives` (the tool names relied on), `contextRequirement` (what must be
   retrievable/structured), and optional `dependencyNote` (e.g. "F2 budget
   improves enforcement"). Readiness treats it as **green-by-design** but
   reported in its own bucket, never merged with `implemented`.
2. **`unimplemented` becomes transitional**: after this artifact is
   transcribed, no rule should remain `unimplemented` except newly added or
   newly promoted rules, which still fail closed until reviewed into one of
   the terminal statuses. The final readiness/re-freeze gate (eshyra-2zyy
   era) fails on any remaining `unimplemented`/`partial` engine-procedure
   rows; day-to-day CI fails only on registry-integrity errors
   (missing/stale/malformed rows), keeping incremental introduction possible.
3. **External ownership is clause-level**: replace the row-level `crossBead`
   exemption with a `clauses` list — each clause carrying its own
   status/owner (bead or family) — or at minimum keep the row's primary
   status and an `externalClauses: [{clause, bead}]` field. Bead closure
   never auto-upgrades: the transition from externally-owned to covered
   requires new runtime/pack evidence recorded in a reviewed diff.
4. **Machine-readable evidence**: keep `runtimeOwner`/`evidence` as exact
   repo-relative paths + symbol strings (as #402 does), existence-checked in
   tests; `model-adjudicated-supported` rows carry primitive names checked
   against the registered tool list (`DEFAULT_TOOLS`) so a tool removal
   fails the register.
5. **Census pins**: pin both censuses — semantic (PROC 175/REF 96/DEF 33/
   TABLE 19/DUP 12) and execution-boundary (0/137/9/19/10 as of this
   artifact) — so drift is a reviewed diff.
6. **Seeding**: transcribe this artifact's §2 table (not "all
   unimplemented") as the initial `ENGINE_PROCEDURE_COVERAGE`. The families
   F1–F8/D1–D2 map to the `missing`/`designOwner` fields.

## 6. Handoff

- Implementation of the disposition layer (per revised #401) — Codex, after
  #401 is updated per §5.
- Engine families F1–F8 — bead under an engine epic (not under 18.7.8);
  recommended agents per family in §4.
- This artifact is the authoritative execution boundary. A future change of
  boundary for any rule is a reviewed diff to §2 with census update, not a
  re-audit.
