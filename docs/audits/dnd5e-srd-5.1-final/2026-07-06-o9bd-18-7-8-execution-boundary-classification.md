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
  `eshyra-o9bd-18-7-8-1-disposition-design`) — §5 below specified the
  required delta, which has since been applied on that branch; §5 is kept as
  the historical specification.

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
  `set_world_fact`/`record_world_fact` (**world-template overlay lore only**
  — divergences from the base module and improvised lore; per the tool
  descriptions and the system prompt this is NOT a generic mechanics-counter
  store, and `world_query` reads module canon + overlay lore, not arbitrary
  keys), `world_query`, `memory_drilldown`.
- **The Hybrid Contract** (`buildSystemPrompt`,
  `packages/core/src/orchestrator/protocol.ts`): *"All dice and math go
  through the `roll` tool. Never invent a die result."* The model is
  contractually not the owner of deterministic arithmetic — but the current
  `roll` surface computes only `NdM+K`. Any rule whose procedure requires the
  model to *produce derived numbers* (modifier composition, vs-DC/AC
  resolution, halving/doubling, capacity/jump/threshold formulas,
  aggregation) therefore has a support gap today; those clauses route to the
  F9 derived-math family rather than being classified model-supported.
- **Currency**: deterministic wallet code exists
  (`packages/core/src/character/currency.ts`; CLI `/money` commands in
  `packages/cli/src/playCurrency.ts`) but **no registered DM tool reads or
  writes it and the turn-context snapshot does not include it** (verified
  against `contextAssembler.ts` 2026-07-06). Economy procedures requiring
  canonical coin mutation are unsupported at the gameplay boundary → F10.
- **Durable character state**: character condition entries (extensible
  `{id, …}` JSON, decoded and shown in the turn-context snapshot) are the
  legitimate mechanism for temporary *character states* (prone, held
  breath, deprivation, casting-in-progress, dodge/ready windows). They are
  **not** a home for resources or counters that aren't conditions
  (inspiration). Inventory `properties_json` is durable via `give_item`
  upsert but unvalidated. What does **not** exist is any invariant-enforcing
  owner: nothing counts attunement slots, decrements spell slots, tracks
  death saves, buffers temp HP, or runs rest/recharge resets.
- **Auditability**: every canon write is a logged tool call; rolls are
  ledgered; `turnAuditor.ts` reviews turns.

**Revision 2026-07-06 (same day, post-review):** an internal-consistency
review found the initial classification over-granted MODEL where (a) the
Hybrid Contract reserves math for tools, (b) currency has no gameplay
surface, and (c) `overlay_facts` was misused as a generic counter store.
30 rows were reclassified (28 → PARTIAL, 2 → IMPL), families F9/F10 were
added, and F2/F5/F6 gained clause members (surprise, conflict/inspiration,
suffocating). A bounded sweep of all remaining MODEL rows for cross-turn
counters, resets, once-per-X usage, and action restrictions was part of the
pass.

**Second revision 2026-07-06 (MODEL-integrity sweep):** a follow-up
MODEL-only sweep against the terminal MODEL definition ("no deterministic
derived-number production left to the model") found 8 further rows whose
procedures still left deterministic arithmetic, dice-expression
transformation, or formula-derived numbers with the model after input
selection: `abilities`, `armor-guidance`, `casting-a-spell-at-a-higher-level`,
`cover`, `critical-hits`, `falling`, `proficiency-bonus`,
`two-weapon-fighting` — all reclassified to PARTIAL with exact clauses (7
route to F1/F9/F2/F4; `armor-guidance`'s AC-derivation clause is externally
owned by the pre-existing derived-values bead `eshyra-b69j.13`, which
`packages/core/src/character/derivedValues.ts` already names as the AC/attack
owner). The sweep also fixed notes on rows that stay MODEL so the boundary is
principled, not accidental. Three calibration principles were made explicit
(recorded here so future rows classify consistently):

**Third revision 2026-07-06 (slow-time-arithmetic-exception correction):** a
final-review pass found the second revision's own calibration prose had
carved out a frequency/stakes exception for deterministic arithmetic — "One-shot
slow-time derivations with durable condition-entry state and low stakes
(food/water deprivation thresholds, forced-march DC) also stay MODEL" — that
directly contradicted the Hybrid Contract this same artifact grounds every
other F9 clause in (§0: arithmetic clauses always route to F9; no frequency
carve-out). Two rows had a deterministic formula riding this now-removed
exception: `food` (3 + Constitution modifier, minimum 1, deprivation-day
threshold) and `speed` (forced-march save DC 10 + 1 per hour past 8); both
move MODEL → PARTIAL for that one clause each, routed to F9. A third row,
`recuperating`, cites the same "slow-time counter" language but was verified
to have **no** arithmetic clause (fixed DC 15, no derivation) — it is
unaffected and stays MODEL. The exception was never about state-machine
ownership (a low-frequency clock legitimately does not need a dedicated
engine the way death saves do) — it is about whether the model may perform
forbidden arithmetic, which frequency and stakes cannot license.

- **F9-clause criteria.** A deterministic derivation is an F9 clause when
  (a) the derived number feeds a code-owned surface — a dice expression,
  modifier composition, vs-DC/AC/opposed resolution, or an HP/damage
  transform — or (b) it is a formula over structured character/creature data
  yielding a reusable derived stat or threshold (passive score, carry
  capacity, jump distance, escape DC).
- **Narrative-magnitude arithmetic stays MODEL.** Arithmetic whose operands
  and result live only in narration — movement costs/rates in this grid-less,
  text-first game (difficult terrain, squeezing, crawl/climb costs,
  cross-mode speed subtraction) — is part of narration under boundary rule 1,
  because the movement budget is deliberately not code-owned (F2 excludes
  it).
- **Frequency/stakes governs state-machine ownership, never whether the
  model performs arithmetic.** A prior revision of this artifact stayed
  MODEL on two rows' deterministic formulas — the food deprivation
  day-threshold (3 + Constitution modifier, minimum 1) and the forced-march
  save DC (10 + 1 per hour past 8) — reasoning that low-frequency,
  durable-condition-entry-backed derivations were an exception to the Hybrid
  Contract. That was wrong: the Hybrid Contract ("all dice and math go
  through the `roll` tool") draws no frequency or stakes carve-out, and §0
  is explicit that *any* rule whose procedure requires the model to produce
  a derived number is an F9 gap. Frequency and stakes are the correct test
  for whether a *state machine* is warranted (durable generic
  condition-entry storage is sufficient for these low-frequency clocks —
  they do not need a dedicated engine the way death saves or concentration
  do) — they are not a test for whether forbidden arithmetic may be
  performed by the model. Both rows are corrected to PARTIAL below: the
  clock/state/ruling portion stays MODEL-adjudicated; the derivation itself
  routes to F9.
- **Single-owner factoring.** Generic resolution gaps are owned once by the
  generic rows (`ability-checks`/`saving-throws`/`attack-rolls`/`contests` own
  vs-DC/AC/opposed resolution; `modifiers-to-the-roll` owns composition;
  `limited-usage` owns X/Day-reset economies for monster entries). Rows that
  merely *apply* those surfaces (search, hide, trap checks,
  innate-spellcasting) stay MODEL rather than duplicating the clause.

The censuses below are the corrected ones.

## 1. Execution-boundary taxonomy (final)

Exactly one primary disposition per rule:

- **`code-enforced`** — all deterministic semantics that require enforcement
  are owned by runtime code with test evidence. (Currently **0** rules fully
  qualify; the class exists for the disposition layer's end state.)
- **`model-adjudicated-supported`** (`MODEL` in the table) — DM-model
  adjudication over the deterministic primitives is the *intended terminal
  architecture* for this rule, and the §0 surface is sufficient: full rule
  text retrievable via `lookup_rules`; all randomness through seeded `roll`
  with visible ledger; **no deterministic derived-number production left to
  the model** (per the Hybrid Contract — arithmetic clauses route to F9);
  required canon mutations available through typed tools; any cross-turn
  state durably representable as *semantically apt* character/combatant
  condition entries readable from the context snapshot (not overlay facts,
  not model memory); violations
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
| abilities | magic-items | unimplemented | PARTIAL | GM-time generation rulings (method choice, array assignment) stay adjudicated; missing: 4d6-drop-lowest keep/drop grammar → F1 — the four-roll workaround leaves the drop selection model-computed, the same defect that makes advantage-and-disadvantage IMPL |
| ability-checks | core-d20 | partial | PARTIAL | seeded d20 + code-owned PC modifiers + visible ledger; DC setting is a ruling; missing: vs-DC resolution in the roll surface (Hybrid Contract: math is tool-owned) → F9 |
| ability-scores-and-modifiers | core-d20 | partial | PARTIAL | formula + PC bounds code-owned; missing: generic 1–30 range validation on non-PC ability writes → F8 |
| activating-an-item | magic-items | unimplemented | MODEL | activation-vs-Use-an-Object distinction is a per-turn ruling |
| advantage-and-disadvantage | core-d20 | unimplemented | IMPL | F1: 2d20 keep-high/low + cancellation/no-stacking belong in the roll tool; highest-frequency mechanic; two-roll workaround leaves selection unenforced |
| ammunition | monster-conventions | unimplemented | MODEL | statblock convention; inventory + ledger suffice |
| areas-of-effect | spellcasting | unimplemented | MODEL | narrative geometry; shape rows retrievable |
| armor-guidance | gear-payload | unimplemented | PARTIAL | per-armor stats structured; penalty application per roll stays a ruling; missing: AC derivation from equipped armor (base + Dex, medium cap 2, heavy flat, shield +2) — `derivedValues.ts` defers AC/attack bonuses to eshyra-b69j.13 (externally owned clause); per-record payload completeness clause → eshyra-o9bd.18.7.6 |
| armor-weapon-and-tool-proficiencies | monster-conventions | unimplemented | MODEL | default statblock assumption; no state |
| attack | combat-core | unimplemented | MODEL | one-attack grant adjudicated; F2 budget makes the action itself checkable; attack counting stays adjudicated (Extra Attack/Multiattack feature-dependent) |
| attack-rolls | core-d20 | partial | PARTIAL | seeded attack rolls, natural die visible; missing: modifier composition + vs-AC resolution → F9 |
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
| casting-a-spell-at-a-higher-level | spellcasting | unimplemented | PARTIAL | choosing to upcast is a ruling; missing: upcast scaling transform (extra dice/targets per slot level above base, from structured `scaling`) → F9; slot-level legality gate → F4 |
| casting-a-spell-attack-rolls | spellcasting | partial | MODEL | spellAttackModifier code-owned for PCs; monster values structured; within-5-ft clause is a per-roll ruling |
| casting-a-spell-range | spellcasting | unimplemented | MODEL | narrative range/targeting validation |
| casting-a-spell-saving-throws | spellcasting | partial | PARTIAL | base DC code-owned; missing: special-modifier application in derivation; item-bonus data clause → eshyra-o9bd.18.7.7.2; application hook → F8 |
| casting-in-armor | spellcasting | unimplemented | MODEL | armor-proficiency data structured; gate is per-cast check |
| channel-divinity | multiclassing | design-blocked | DESIGN | D1 multiclass decision |
| charges | magic-items | unimplemented | PARTIAL | identify-reveal clause MODEL; pack-side charge data clause → eshyra-o9bd.18.7.7.1; live expenditure/recharge state clause → F5 |
| class-features | multiclassing | design-blocked | DESIGN | D1 |
| climb | movement-environment | unimplemented | MODEL | cost-exemption ruling; speeds structured |
| climbing-swimming-and-crawling | movement | unimplemented | MODEL | movement-cost ruling |
| coinage | economy | partial | PARTIAL | exchange math code-owned in currency.ts but NOT exposed to the DM (no wallet tool, no context field) → F10; coin weight is an encumbrance ruling |
| combat-step-by-step | combat-core | partial | MODEL | encounter lifecycle state code-owned; the 5-step narration procedure is the DM's job |
| combining-magical-effects | spellcasting | unimplemented | MODEL | same-effect non-stacking ruling; F3's active-effect registry will improve visibility (dependency note, not a blocker) |
| command-word | magic-items | unimplemented | MODEL | silence/sound gating ruling |
| complex-traps | hazards | unimplemented | MODEL | trap initiative/actions procedure; encounter tools suffice |
| concentration | spellcasting | unimplemented | IMPL | F3: durable concentration marker, auto Con save DC max(10, ⌊dmg/2⌋) on every damage instance, single-instance invariant, break conditions — high-frequency cross-turn state machine |
| cone | spellcasting | unimplemented | MODEL | geometry ruling |
| conflict | sentient-items | unimplemented | PARTIAL | contest procedure model-adjudicated over seeded dice; missing: charmed 1d12 h duration, repeat-on-damage trigger, and 1/dawn reset ownership → F5 |
| constitution-hit-points | advancement | partial | PARTIAL | per-level Con applied in levelUpEngine; missing: retroactive hp_max recalc on Con-mod change → F8 |
| consumables | magic-items | unimplemented | MODEL | one-shot consumption = `remove_item` mutation; supported today |
| contests | core-d20 | unimplemented | PARTIAL | opposed seeded rolls code-owned; missing: opposed-comparison resolution (tie = status quo) → F9 |
| controlling-a-mount | mounted | unimplemented | MODEL | controlled/independent ruling; initiative sync narratable |
| cover | combat-core | unimplemented | PARTIAL | degree-of-cover selection is the classic ruling; missing: ±2/±5 AC and Dex-save modifier composition into vs-AC/DC resolution → F9 |
| crafting | downtime | unimplemented | PARTIAL | pacing/eligibility are rulings; missing: DM-accessible canonical currency read/write for costs and progress (currency.ts exists; no gameplay tool) → F10 |
| critical-hits | combat-core | unimplemented | PARTIAL | nat-20 detection visible in `rolls[]`; missing: crit dice-doubling transform on the damage-roll surface → F9 — today the model rewrites the dice expression (deterministic transformation) |
| cube | spellcasting | unimplemented | MODEL | geometry ruling |
| customizing-a-background | char-build | unimplemented | DESIGN | D2: whether the code-owned creation flow offers background customization is a product decision, not a play-time ruling |
| cylinder | spellcasting | unimplemented | MODEL | geometry ruling |
| damage-resistance-and-vulnerability | combat-core | unimplemented | PARTIAL | resistances structured; missing: halve/double-after-modifiers transform as a tool operation → F9; which resistances apply stays a ruling |
| damage-rolls | combat-core | partial | PARTIAL | seeded dice code-owned; missing: add-ability-mod / never-negative composition and roll-once-multi-target application → F9 |
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
| expenses-lifestyle-expenses | economy | unimplemented | PARTIAL | missing: canonical currency mutation surface for lifestyle costs → F10 |
| experience-points | advancement | partial | PARTIAL | XP→level thresholds code-owned; multiclass total-level clause → D1 |
| extra-attack | multiclassing | design-blocked | DESIGN | D1 |
| falling | environment | unimplemented | PARTIAL | fall-distance determination and landing narration stay rulings; missing: distance → ⌊d/10⌋d6 (cap 20d6) dice-expression derivation → F9; prone via condition entry |
| falling-unconscious | rest-death | unimplemented | IMPL | F6: 0 HP → unconscious should be an adjust_hp-time invariant, not a remembered step |
| feats | char-build | unimplemented | DESIGN | D2: variant-feat adoption + prerequisite tracking in the code-owned advancement flow (SRD ships one feat) |
| fly | movement-environment | unimplemented | MODEL | hover/death-fall ruling; flags structured |
| flying-movement | movement | unimplemented | MODEL | fall-when-prone/speed-0 ruling |
| food | survival | unimplemented | PARTIAL | deprivation-day state durably representable as character condition entries (semantically apt temporary character state, read back from the context snapshot); clock stays model-adjudicated (low-frequency, no dedicated state machine needed); missing: the 3+Con-mod (minimum 1) day-threshold derivation is deterministic arithmetic feeding a gameplay threshold, not narration — the Hybrid Contract routes it to F9 regardless of frequency → F9 |
| food-and-water | survival | unimplemented | MODEL | as `food` (condition-entry state, clock model-adjudicated); no formula of its own — this row is the exhaustion-not-removable-until-fed gate, a rest-time ruling (F7 hook noted); the deprivation-day arithmetic itself is `food`'s clause, not duplicated here |
| gaining-inspiration | inspiration | unimplemented | IMPL | F5: inspiration is a durable boolean resource with a no-stockpile cap; overlay_facts is a world-template overlay store, not a mechanics resource, and conditions are semantically wrong for a resource — needs a character-state owner |
| grapple-rules-for-monsters | monster-conventions | unimplemented | PARTIAL | missing: default escape DC derivation (10 + Str(Athletics) mod) as derived math → F9 |
| grappling | combat-contests | unimplemented | MODEL | contest rolls + grappled condition + half-speed drag ruling |
| group-checks | core-d20 | unimplemented | PARTIAL | individual checks roll-owned; missing: half-succeed aggregation arithmetic → F9 |
| half-dragon-template | templates | unimplemented | MODEL | GM-time content-creation procedure; tables structured |
| healing | rest-death | partial | PARTIAL | add + clamp code-owned; missing: dead-creature regain gate (needs F6's durable dead state on the HP write path) |
| help | action | unimplemented | MODEL | advantage grant; per-roll |
| hide | action | unimplemented | MODEL | Stealth check per hiding ruling |
| hiding | perception | unimplemented | PARTIAL | Stealth contest and hiding eligibility are rulings; missing: passive-Perception derived score → F9 (shared with passive-checks) |
| hit-points | monster-conventions | unimplemented | MODEL | per-creature HP/HD structured; the size-die formula is GM-time creature design |
| hit-points-and-hit-dice | multiclassing | design-blocked | DESIGN | D1 |
| improvised-weapons | gear-payload | unimplemented | MODEL | 1d4 / proficiency-analogy ruling; per-record payload clause → eshyra-o9bd.18.7.6 |
| innate-spellcasting | monster-conventions | unimplemented | MODEL | statblock convention; per-creature entries structured; the X/day usage economies are owned once by limited-usage → F5 (single-owner factoring) |
| instant-death | rest-death | unimplemented | IMPL | F6: needs the damage overflow that `adjust_hp` currently clamps away — the tool surface hides the trigger; deterministic threshold, not a ruling |
| interacting-with-objects | objects | unimplemented | MODEL | GM-set object stats; auto-fail/immunity rulings |
| jumping | movement | unimplemented | PARTIAL | missing: long/high-jump distance formulas as derived math → F9; movement narration stays a ruling |
| knocking-a-creature-out | rest-death | unimplemented | MODEL | declared choice at damage time → unconscious+stable conditions (durable once F6 defines stable) |
| lair-actions | monster-conventions | unimplemented | MODEL | initiative-20 scheduling ruling; once-per-round is structural when the lair is entered as an initiative-20 combatant in the code-owned turn order; F5's per-round reset vocabulary can host the no-repeat clause if drift is observed |
| legendary-actions | monster-conventions | unimplemented | IMPL | F5: per-round counter economy (spend on others' turns, regain at start) — encounter-scoped reset state machine |
| legendary-creatures | monster-conventions | unimplemented | MODEL | form-assumption exclusion gate; ruling over structured data |
| lifting-and-carrying | encumbrance | unimplemented | PARTIAL | missing: capacity arithmetic (Str×15, push/drag ×2, size doubling) as derived math over structured Str + inventory → F9 |
| limited-usage | monster-conventions | unimplemented | IMPL | F5: X/Day + Recharge X–Y + rest resets — durable per-entry usage state and reset procedure; per-entry economies structured, runtime owner missing |
| line | spellcasting | unimplemented | MODEL | geometry ruling |
| long-rest | rest-death | unimplemented | IMPL | F7: 8 h gate, 1/24 h, ≥1 HP requirement, full HP + half-HD restore, resource reset orchestration (hooks F4/F5) |
| longer-casting-times | spellcasting | unimplemented | MODEL | rare multi-turn casting; in-progress state durably representable as a character condition entry (readable in context); slot-kept-on-break ruling |
| madness-effects | hazards | unimplemented | MODEL | table rolls + durations; seeded dice + clock |
| making-an-attack | combat-core | unimplemented | MODEL | 3-step narration procedure over code-owned rolls |
| material-m | spellcasting | unimplemented | MODEL | focus/pouch substitution + cost-component gating rulings; per-spell components structured |
| melee-attacks | combat-core | unimplemented | MODEL | reach semantics are rulings; unarmed 1+Str composition rides the F9 modifier surface (note) |
| modifiers-to-the-roll | core-d20 | unimplemented | PARTIAL | PC mod/PB values code-owned; missing: modifier-composition surface on rolls (contract: math is tool-owned) → F9 |
| mounted-combat | combat-core | unimplemented | MODEL | eligibility gate ruling (size/anatomy/willing) |
| mounting-and-dismounting | mounted | unimplemented | MODEL | movement-cost + save rulings |
| mounts-and-vehicles | economy | unimplemented | PARTIAL | mount stats structured as equipment records; missing: purchase currency surface → F10 and pull-capacity arithmetic → F9 |
| movement-and-position | movement | unimplemented | MODEL | budget-spending narration |
| movement-and-position-difficult-terrain | movement | unimplemented | MODEL | +1 ft/ft cost — narrative-magnitude arithmetic; movement costs live only in narration (boundary rule 1) |
| moving-around-other-creatures | movement | unimplemented | MODEL | pass-through/occupancy ruling |
| moving-between-attacks | movement | unimplemented | MODEL | narrative movement |
| multiattack | combat-core | unimplemented | MODEL | no-OA restriction ruling; routines structured (18.7.9) |
| multiclassing | multiclassing | design-blocked | DESIGN | D1 |
| multiclassing-proficiency-bonus | multiclassing | design-blocked | DESIGN | D1 |
| objects | objects | unimplemented | MODEL | AC/HP tables structured; threshold/immunity rulings |
| opportunity-attacks | combat-core | unimplemented | MODEL | trigger/exclusion ruling; reaction budget dependency → F2 |
| other-activity-on-your-turn | action-economy | unimplemented | IMPL | F2: one free object interaction — same turn-budget record as actions/bonus/reaction (marginal cost ~0 once F2 exists) |
| paired-items | magic-items | unimplemented | MODEL | both-of-pair requirement ruling; inventory visible |
| passive-checks | core-d20 | unimplemented | PARTIAL | missing: 10+mods (±5 adv/dis) derived-score computation → F9; which modifiers apply stays a ruling |
| poisons | hazards | unimplemented | MODEL | delivery-type exposure rulings; hazard data structured |
| practicing-a-profession | downtime | unimplemented | PARTIAL | missing: canonical currency surface for earnings → F10 |
| proficiency-bonus | core-d20 | partial | PARTIAL | PB values code-owned; whether PB applies stays a per-roll ruling; missing: PB multiplier composition (×2/×½/×0, apply-once) on the F9 declared-modifier surface — halved/doubled PB is a derived number the model currently computes |
| range | combat-core | unimplemented | MODEL | normal/long-range disadv ruling; ranges structured |
| ranged-attacks-in-close-combat | combat-core | unimplemented | MODEL | within-5-ft disadv ruling |
| reactions | action-economy | unimplemented | IMPL | F2: one reaction per round crosses turn boundaries — budget state, not a ruling |
| ready | action | unimplemented | MODEL | held trigger + readied-spell concentration representable as condition; reaction spend → F2 |
| recuperating | downtime | unimplemented | MODEL | fixed DC 15, no derivation (not an arithmetic clause, so the `food`/`speed` correction does not apply); the 3-day counter is durably representable as a character condition entry over the owned clock (low-frequency state-ownership principle, as food/water) |
| researching | downtime | unimplemented | PARTIAL | missing: canonical currency surface for the gp/day cost → F10 |
| rituals | spellcasting | unimplemented | MODEL | +10 min, no-slot casting; ritual flags structured |
| rolling-1-or-20 | combat-core | unimplemented | MODEL | natural die visible in `rolls[]`; auto-hit/miss applied per roll; candidate roll-tool annotation, not required — but F9's vs-AC/DC resolution MUST honor nat-1/20 overrides when it lands (spec note recorded in F9) |
| saving-throws | core-d20 | partial | PARTIAL | seeded saving_throw rolls + code-owned save modifiers; missing: vs-DC resolution → F9 |
| search | action | unimplemented | MODEL | check-based action |
| self-sufficiency | downtime | unimplemented | PARTIAL | lifestyle-equivalence is a ruling; missing: currency-offset accounting surface → F10 |
| selling-treasure | economy | unimplemented | PARTIAL | half/full-price policy is deterministic; missing: canonical currency mutation surface → F10 |
| short-rest | rest-death | unimplemented | IMPL | F7: HD spending needs a durable hit-dice pool (roll + Con each) and reset interaction |
| shoving-a-creature | combat-contests | unimplemented | MODEL | contest → prone/push ruling |
| silvered-weapons | economy | unimplemented | PARTIAL | missing: canonical currency surface for the flat costs → F10 |
| somatic-s | spellcasting | unimplemented | MODEL | free-hand gating ruling |
| special-traits-spellcasting | monster-conventions | unimplemented | MODEL | statblock convention; entries structured |
| special-weapons | gear-payload | unimplemented | PARTIAL | generic semantics MODEL; missing per-record payloads (net restraint DC/AC, lance rules) — clause externally owned by eshyra-o9bd.18.7.6 |
| speed | movement-environment | unimplemented | PARTIAL | travel-pace table structured; movement rates/costs stay MODEL (narrative-magnitude arithmetic, F2 deliberately excludes the movement budget); exhaustion as condition entry; missing: the forced-march save DC (10 + 1 per hour past 8) is a deterministic derived-number formula feeding a saving-throw DC, not narration — Hybrid Contract clause, not a frequency-exempt one → F9 |
| speed-difficult-terrain | movement-environment | unimplemented | MODEL | half-pace ruling |
| spell-slots | spellcasting | unimplemented | IMPL | F4: durable expenditure/restoration economy (expend ≥ spell level; long-rest restore); progression structured, live-state owner missing |
| spellcasting | multiclassing | design-blocked | DESIGN | D1 (multiclass slot formula) |
| spells | magic-items | unimplemented | MODEL | item-casting procedure ruling; per-item spell data completeness → 18.7.7 corpus work |
| sphere | spellcasting | unimplemented | MODEL | geometry ruling |
| squeezing-into-a-smaller-space | movement | unimplemented | MODEL | size/cost/disadv ruling |
| stabilizing-a-creature | rest-death | unimplemented | IMPL | F6: stable flag + 1d4 h → 1 HP timer inside the death state machine |
| strength-attack-rolls-and-damage | core-d20 | unimplemented | MODEL | which-ability ruling |
| suffocating | survival | unimplemented | PARTIAL | breath duration formula (1+Con min, min 30 s) and the Con-mod round countdown are deterministic cross-turn counters that can silently drift; missing: countdown state + the 0-HP dying transition → F6 |
| surprise | combat-core | unimplemented | PARTIAL | encounter-start Stealth-vs-passive determination is a ruling (passive score → F9); missing: turn-1 no-move/action/reaction restriction enforcement → F2 |
| swim | movement-environment | unimplemented | MODEL | cost-exemption ruling |
| targeting-yourself | spellcasting | unimplemented | MODEL | self-target eligibility ruling |
| telepathy | monster-conventions | unimplemented | MODEL | communication semantics ruling; per-creature payloads (18.7.9 C3) |
| temporary-hit-points | rest-death | unimplemented | IMPL | F6: separate durable buffer, no-stacking choice, consumed-before-HP, not-healing, long-rest expiry — `adjust_hp` cannot represent any of it |
| the-order-of-combat | combat-core | partial | MODEL | round/turn state code-owned; cycle narration is the DM's job |
| the-order-of-combat-initiative | combat-core | partial | MODEL | rolls + combatant state code-owned; group-roll/tie rulings |
| training | downtime | unimplemented | PARTIAL | missing: canonical currency surface for 250 days × 1 gp → F10 |
| tremorsense | perception-senses | unimplemented | MODEL | ground-contact detection ruling |
| truesight | perception-senses | unimplemented | MODEL | auto-success bundle applied as per-event rulings; radii structured |
| two-weapon-fighting | combat-core | unimplemented | PARTIAL | light-property/weapon eligibility stays a ruling; missing: omit-positive-ability-mod damage composition → F9; bonus-attack spend → F2 |
| unarmored-defense | multiclassing | design-blocked | DESIGN | D1 |
| underwater-combat | environment | unimplemented | MODEL | melee/ranged/fire-resistance rulings |
| unseen-attackers-and-targets | combat-core | unimplemented | MODEL | adv/disadv + wrong-guess auto-miss rulings |
| use-an-object | action | unimplemented | MODEL | action definition; interaction budget → F2 |
| using-different-speeds | movement | unimplemented | MODEL | narrative-magnitude arithmetic (boundary rule 1): the movement budget is deliberately not code-owned, so the cross-mode subtraction operates on narrated quantities only; F9's calc primitive is an available aid once it lands, not a gap |
| using-inspiration | inspiration | unimplemented | IMPL | F5: spend/gift semantics against the durable inspiration boolean; spend grants advantage (F1) |
| variant-encumbrance | encumbrance | unimplemented | PARTIAL | missing: 5×Str / 10×Str threshold arithmetic → F9; variant adoption is a table ruling |
| variant-skills-with-different-abilities | core-d20 | unimplemented | MODEL | optional recombination ruling, play-time |
| verbal-v | spellcasting | unimplemented | MODEL | gag/silence gating ruling |
| vision-and-light | environment | unimplemented | MODEL | obscurement/light-level rulings |
| water | survival | unimplemented | MODEL | as `food`: condition-entry deprivation state + Con saves |
| weapon-proficiency | equipment | unimplemented | MODEL | PB gating per roll over structured proficiencies |
| weapon-properties | gear-payload | unimplemented | MODEL | property semantics applied per roll over structured tags; per-record payload completeness clause → eshyra-o9bd.18.7.6 |
| wizard-your-spellbook | downtime | unimplemented | PARTIAL | missing: canonical currency surface for copy costs → F10 |
| working-together | core-d20 | unimplemented | MODEL | leader-rolls-with-advantage ruling (advantage dice via F1) |
| your-turn | action-economy | unimplemented | IMPL | F2: the core turn budget (move + one action, forgo allowed) — the record every other F2 row hangs off |

## 3. Census and mechanical verification

**code-enforced 0 · model-adjudicated-supported 97 · partial 47 ·
implementation-required 21 · design-blocked 10 = 175** (corrected census
after the 2026-07-06 third (slow-time-arithmetic-exception) revision;
supersedes the initial 0/137/9/19/10, the first-revision 0/107/37/21/10, and
the second (MODEL-integrity) revision 0/99/45/21/10 — `food` and `speed`
move MODEL → PARTIAL, each for one F9 arithmetic clause; §0/§1 no longer
carve out a frequency/stakes exception for deterministic arithmetic).

- partial (47): abilities, ability-checks, ability-scores-and-modifiers,
  armor-guidance, attack-rolls, backgrounds-equipment, beyond-1st-level,
  casting-a-spell-at-a-higher-level, casting-a-spell-saving-throws, charges,
  coinage, conflict, constitution-hit-points, contests, cover, crafting,
  critical-hits, damage-resistance-and-vulnerability, damage-rolls,
  expenses-lifestyle-expenses, experience-points, falling, food,
  grapple-rules-for-monsters, group-checks, healing, hiding, jumping,
  lifting-and-carrying, modifiers-to-the-roll, mounts-and-vehicles,
  passive-checks, practicing-a-profession, proficiency-bonus, researching,
  saving-throws, self-sufficiency, selling-treasure, silvered-weapons,
  special-weapons, speed, suffocating, surprise, training,
  two-weapon-fighting, variant-encumbrance, wizard-your-spellbook.
- implementation-required (21): advantage-and-disadvantage, attunement,
  backgrounds-proficiencies, bonus-action, bonus-actions, concentration,
  death-saving-throws, falling-unconscious, gaining-inspiration,
  instant-death, legendary-actions, limited-usage, long-rest,
  other-activity-on-your-turn, reactions, short-rest, spell-slots,
  stabilizing-a-creature, temporary-hit-points, using-inspiration,
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

Net movement from #402 (mechanically joined on key, 2026-07-06, corrected
through the third (slow-time-arithmetic-exception) revision): 148
`unimplemented` → 92 MODEL + 34 PARTIAL + 20 IMPL + 2 DESIGN (feats,
customizing-a-background; `food` and `speed` moved from this revision's prior
94 MODEL into PARTIAL for one F9 arithmetic clause each); 19 `partial` → 5
MODEL (code-owned portion plus a legitimate ruling remainder) + 13 stay
PARTIAL + 1 IMPL (death-saving-throws); 8 `design-blocked` → 8 DESIGN. The
headline stands: **the majority of PROC rules are already architecturally
supported as rulings** — but the honest engine backlog is 21 IMPL rules + 47
clause-level PARTIALs, clustering into ten families, two of which (F9
derived-math, F10 currency surface) are shared primitives that unblock many
PARTIALs at once.

## 4. Actionable implementation families (derived from the completed corpus)

Only rules classified IMPL/PARTIAL/DESIGN generate work. Memberships are
exact and artifact-backed; nothing else in the 175 belongs to a family.

- **F1 — dice-grammar extension** (Codex). Members: advantage-and-disadvantage;
  clause: abilities (4d6-drop-lowest keep/drop grammar); dependency
  beneficiaries: every MODEL row that applies adv/dis. Need:
  `2d20kh1`/`kl1` + `NdMkhX`/`klX`/drop notation in `dice.ts`
  + roll-tool schema; cancellation/no-stacking documented in the tool
  description. Small, highest leverage.
- **F2 — action-economy turn budget** (Opus design, Codex rollout). Members:
  your-turn, bonus-actions, reactions, other-activity-on-your-turn,
  bonus-action; clauses: surprise (turn-1 no-move/action/reaction denial),
  two-weapon-fighting (bonus-attack spend).
  Need: per-combatant per-turn budget record (action, bonus,
  reaction-per-round, free interaction, movement note) on encounter state +
  turn-loop reset + bonus-action-spell timing check + surprised-turn
  restriction flag. Deliberately *not* a full action legality engine —
  attack counting and action choice stay adjudicated.
- **F3 — concentration & active-effect lifecycle** (Opus). Members:
  concentration. Need: durable active-effect/concentration marker
  (caster, spell ref, started-at), single-instance invariant, auto save
  prompt on damage (DC max(10, ⌊dmg/2⌋) per source), break-on
  incapacitated/death/new-concentration. Benefits combining-magical-effects
  visibility.
- **F4 — spell-slot economy** (Codex, small design). Members: spell-slots;
  clause: casting-a-spell-at-a-higher-level (slot-level legality gate; its
  upcast scaling transform → F9). Need: per-level slot counters on character
  live state seeded from the code-owned progression; expend(≥ level)
  validation; long-rest restore hook (F7).
- **F5 — usage/recharge, resource & attunement state** (Opus design, Codex
  rollout). Members: limited-usage, legendary-actions, attunement,
  gaining-inspiration, using-inspiration; clauses: charges (live
  expenditure/recharge; pack data → 18.7.7.1), conflict (charmed 1d12 h
  duration, repeat-on-damage, 1/dawn reset). Need: durable per-entity usage
  counters (X/day, recharge X–Y, legendary per-round) with reset events
  (turn-start d6 recharge, short/long rest, dawn) + attunement slot machine
  (max 3, no duplicates, ending conditions) + the inspiration boolean
  resource (no-stockpile cap, spend→advantage, gifting).
- **F6 — death, dying & HP-buffer state** (Opus). Members:
  death-saving-throws, falling-unconscious, instant-death,
  stabilizing-a-creature, temporary-hit-points; clauses: healing (dead-gate),
  suffocating (breath/round countdown state → 0-HP dying transition).
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
- **F9 — deterministic resolution & derived-math primitives** (Codex, small
  design; added in the 2026-07-06 revision). The shared primitive that
  reconciles the Hybrid Contract ("all dice and math go through the roll
  tool") with a `roll` surface that today computes only `NdM+K`. Clause
  members (the F9-tagged PARTIAL rows): ability-checks / attack-rolls /
  saving-throws / contests (modifier composition + vs-DC/AC/opposed
  resolution), group-checks (half-succeed aggregation), passive-checks and
  hiding (passive score 10+mods±5), modifiers-to-the-roll, damage-rolls
  (add-mod, never-negative, multi-target application),
  damage-resistance-and-vulnerability (halve/double transform),
  grapple-rules-for-monsters (derived DC), lifting-and-carrying /
  variant-encumbrance (capacity/threshold formulas), jumping (distance
  formulas), mounts-and-vehicles (pull-capacity arithmetic), cover (±2/±5
  AC/Dex-save modifier composition), critical-hits (crit dice-doubling
  transform), falling (distance→dice-count derivation), proficiency-bonus
  (PB ×2/×½/×0 multiplier composition), two-weapon-fighting
  (omit-positive-ability-mod damage composition),
  casting-a-spell-at-a-higher-level (upcast scaling transform), food
  (deprivation day-threshold: 3 + Constitution modifier, minimum 1 — a
  non-roll `calc` formula, corrected from a prior frequency-based MODEL
  exception), speed (forced-march saving-throw DC: 10 + 1 per hour past 8 —
  same correction), melee-attacks and surprise (notes). Need: extend the
  roll tool with declared modifier
  lists, `vsDc`/opposed resolution, and post-roll transforms
  (half/double/min-0), plus a small deterministic `calc` primitive for
  non-roll formulas — the *choice of inputs* stays a DM ruling; the
  arithmetic becomes code-owned. Spec note: the vs-AC/DC resolution must
  honor nat-1/20 auto-miss/hit overrides (rolling-1-or-20). High leverage:
  lands with F1 in the same tool surface.
- **F10 — canonical currency & trade gameplay surface** (Codex, small
  design; added in the 2026-07-06 revision). Deterministic wallet code
  exists (`currency.ts`, CLI `/money`) but no DM tool or context field
  exposes it. Clause members (the F10-tagged PARTIAL rows): coinage,
  crafting, expenses-lifestyle-expenses, practicing-a-profession,
  researching, selling-treasure, silvered-weapons, training,
  wizard-your-spellbook, self-sufficiency, mounts-and-vehicles (purchase).
  Need: wallet read in the turn-context snapshot + a canonical
  currency-mutation tool (earn/spend/convert over `currency.ts`, logged like
  other canon writes); trade/downtime pacing stays a DM ruling.
- **D1 — multiclass decision** (design bead; owner: eshyra-o9bd.18.7.8 parent
  pending a dedicated decision bead under an engine epic). Members: the 8
  multiclass rows + experience-points' multiclass clause. Decide: in/out of
  product scope for v1; if in, an engine epic.
- **D2 — creation-variant policy** (design decision, small). Members: feats,
  customizing-a-background. Decide whether the creation/advancement flow
  offers variant feats and background customization; if yes, F8-style Codex
  slices.

Ordering recommendation: F1+F9 → F6 → F2 → F4 → F10 → F7 → F5 → F3 → F8
(F1/F9 are one small tool-surface change unblocking the largest number of
rows; F6 is the highest-stakes safety gap; F2/F4 are the most common
play-loop invariants; F10 is independent and small; F7 depends on F4/F5/F6
hooks; F3 is self-contained; F8 is independent cleanup). F5/F6/F7 state
shapes should be designed together (shared reset-event vocabulary) even if
implemented separately. These are engine slices **outside** the
importer/audit scope of 18.7.8 and belong under an engine epic, per the
#402 recommendation.

## 5. Delta to PR #401 (disposition-layer design) — specified here, since applied

The original #401 design predated this classification and its coverage
vocabulary was incomplete. The revisions below were specified by this
artifact and **have since been applied on the #401 branch** (they are kept
here, clearly labeled, as the historical specification). The one live
dependency: #401's pinned execution-boundary census must track this
artifact's current census (see item 5).

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
   TABLE 19/DUP 12) and execution-boundary (0/97/47/21/10 as of the
   2026-07-06 third, slow-time-arithmetic-exception revision) — so drift is
   a reviewed diff. Do not pin
   any execution-boundary census into registry constants until this PR has
   been reviewed and merged; the numbers are review-gated, not
   self-certifying.
6. **Seeding**: transcribe this artifact's §2 table (not "all
   unimplemented") as the initial `ENGINE_PROCEDURE_COVERAGE`. The families
   F1–F10/D1–D2 map to the `missing`/`designOwner` fields.

## 6. Handoff

- Implementation of the disposition layer (per revised #401) — Codex; #401
  has been updated per §5, and its census pin tracks this artifact's current
  census (0/97/47/21/10).
- Engine families F1–F10 — bead under an engine epic (not under 18.7.8);
  recommended agents per family in §4.
- This artifact is the authoritative execution boundary. A future change of
  boundary for any rule is a reviewed diff to §2 with census update, not a
  re-audit.
