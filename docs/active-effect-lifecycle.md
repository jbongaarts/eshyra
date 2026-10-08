# Active-Effect Lifecycle & Concentration (F3)

Bead: `eshyra-2n1t.5` (engine family F3; source:
`docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-execution-boundary-classification.md`
§4). Runtime owner: `packages/core/src/state/activeEffects.ts`; durable schema:
`packages/core/data/migrations/0010_active_effects.sql` plus
`0011_active_effect_anchor_evidence.sql` and the elapsed-world columns in
`0013_rest_engine.sql`; evidence:
`packages/core/test/activeEffects.test.ts`.

This document records the reviewed contract. The executable authority is the
code and its tests; if they drift from this document, fix whichever is wrong at
the source — do not treat this file as a second compiler input.

## 1. What F3 is

F2 integrates F3 at the authoritative `begin_turn` boundary. After validation,
the previous turn is closed, the entering budget is ensured and reset, and the
requested round and active participant are made durable. F3 then settles round
deadlines followed by source- and target-turn deadlines through `finalizeEnd`.
If cleanup removes the entering combatant, the boundary still commits and
returns `turnAvailable: false` with the participant unavailable reason.
Boundary identity is separate from availability: a known dead, escaped,
inactive, or absent participant still establishes its turn-start boundary, while the
completed boundary clears the active marker and surprise and returns no usable
turn.

One canonical, deterministic lifecycle for **active effects**: durable game
state created by a spell, item power, feature, creature trait, hazard, or DM
ruling that persists across turns and must later be ended — and, when it ends,
must clean up exactly the state it owns. Concentration is the flagship
invariant, but the lifecycle is shared by non-concentration timed spells,
dismissible effects, condition packages (e.g. a sentient item's "charmed for
1d12 hours"), curses, summon control, wards, and transformations.

F3 deliberately does **not** absorb the downstream domains that will ride on
it: S1 summoning projection (`eshyra-o9bd.18.7.9`), S3 ward/spatial semantics,
magic-item activation inventories (`eshyra-o9bd.18.7.7`), F7 rest processing
(`eshyra-2n1t.9`), or F4 slot accounting. It provides the primitives, the
invariants, and representative vertical slices; rollout is tracked by child /
sibling beads.

## 2. Durable model

Four tables (migration 0010), all campaign-scoped, all carrying
provenance/session/updated-at like every other live-state table:

- **`active_effect`** — one row per effect instance. Identity
  (`effect_id`, caller-supplied, unique per campaign), typed semantic family
  (`kind`), source grounding (`source_kind` + optional pack `source_ref` +
  optional originating actor), concentration ownership, typed duration, status
  machine, and end provenance.
- **`active_effect_target`** — the creatures/scopes the effect currently
  affects. Targets are removable individually (partial multi-target cleanup)
  without ending the effect.
- **`active_effect_link`** — typed links to durable state the effect **owns**:
  today condition entries projected onto characters/combatants and linked
  actors (summoned/animated combatants), spatial zones, and transformation
  forms. Each link carries two
  cleanup policies (`cleanup_on_end`, `cleanup_on_break`) so normal spell end
  and concentration break can differ (the Conjure Elemental distinction: break
  releases the elemental, ordinary end removes it; a released elemental or fey
  creature moves to the successor effect `<id>:uncontrolled`, which removes it
  1 hour after it was summoned, see §9). The policies are `remove`,
  `release`, and `revert` (migration 0040: legal only on an actor link that
  carries a natural form, `natural_form_json`; see §8 and §9).
- **`active_effect_event`** — append-only per-effect audit ledger
  (`seq` starting at 1) with a typed, validated `detail_json` per event kind:
  `created`, `refreshed`, `suppressed`, `unsuppressed`, `concentration-check`,
  `target-removed`, `ended`. An `ended` event records `successorEffectId` when
  the end started an uncontrolled successor; that successor's `created` event
  records `predecessorEffectId` and the record's `recordTransitionId`.

### Effect kinds are semantic licenses

`kind` is not a label; like the reviewed S1 profile discriminant, it licenses
what an effect may declare (fail-closed):

| Kind | Source kinds | Link kinds | Concentration |
| --- | --- | --- | --- |
| `spell-effect` | spell, ruling | condition | record-derived |
| `summoning` | spell, feature, ruling | condition, actor | record-derived |
| `ward` | spell, magic-item, ruling | condition, zone | record-derived |
| `curse` | spell, magic-item, creature-trait, ruling | condition | record-derived |
| `transformation` | spell, magic-item, feature, creature-trait, ruling | condition, form | record-derived |
| `item-power` | magic-item | condition | declared |
| `condition-package` | spell, creature-trait, hazard, ruling | condition | forbidden |

### Source grounding

A `spell` source **requires** a `source_ref` that resolves in the campaign
rules stack (homebrew goes through `ruling`). The spell record's duration text
is authoritative where it parses:

- `Instantaneous` → refused (instantaneous spells leave no active effect),
  except a bonded summon (eshyra-qxnc): a `summoning` effect whose record has a
  summoning effect with `identity.kind: persistent-linked` and
  `initialState.link: active` (Find Familiar, Find Steed), decided by the
  record, never the spell's name. Such a bond must declare an `until-removed`
  duration (it lasts until released or dismissed), a `source.actor` (the
  caster it is bonded to, as a `character` or `campaign_actor`: the bond
  outlives any combat instance, so a `combatant` id, which names one
  projection in one instance, is refused), and between one and
  `identity.maximumLinked` actors
  entries. A caster may hold one such bond per spell: creation is refused while
  another active or suppressed effect has the same spell, the same source
  actor, and an active actor link, and points at `recast_bonded_summon`.
  Ending that effect (or closing its links) releases the bond.
- `Concentration, up to N <unit>` → concentration **required** and the declared
  timed duration must match `N <unit>` exactly.
- `N <unit>` → concentration **forbidden**; declared duration must match.
- `Until dispelled` → `until-removed` required.
- Anything else (`Special`, compound durations) → the declared typed duration
  stands; concentration is still derived from the `Concentration` prefix.

`magic-item` sources resolve their ref when provided (homebrew items are
allowed, mirroring the F5 attunement rule); item duration prose is not
machine-parsed, so the declared typed duration stands.

## 3. Duration, clocks, and anchors

Every timer records **quantity + semantic unit + explicit anchor** (PR #428
lesson). The duration is a discriminated union:

- `timed` — `amount` (≥1) + `unit` (`round` | `minute` | `hour` | `day`) +
  `anchor_kind`. Anchors are semantically validated, not just enum-checked:
  `spell-cast` requires a spell source, `effect-created` is always available,
  `source-turn-start` requires `source.actor`, `target-turn-start` requires
  exactly one reachable character/combatant target, and `trigger-occurred`
  requires non-empty semantic `anchorTrigger` evidence. At creation the engine
  stamps `anchor_at` (ISO), `anchor_game_time` (campaign clock snapshot),
  and — for `round`-unit timers, which **require an active combat
  instance** — `anchor_combat_instance_id` + `anchor_round`.
- `until-dismissed` — no deadline; requires `dismissible`.
- `until-removed` — no natural expiry (curses, until-dispelled effects); ends
  only by dispel/source/ruling operations.
- `until-trigger` — a named semantic trigger (`expiry_trigger`); expiring it
  requires naming that trigger (the semantic event, not a state delta —
  PR #420 lesson).

Deterministic expiry evaluation:

- **Ordinary round-unit timers** are code-evaluated: the global deadline is
  `anchor_round + amount` rounds (`minute` = 10 rounds under the SRD 6-second
  round when evaluated in combat is *not* auto-converted — only `round`-unit
  timers auto-expire). `expireElapsedRoundEffects` ends every ordinary timer
  whose anchoring instance has advanced past its deadline; declaring `expired`
  on a round timer **before** its deadline is refused. Source/target turn
  anchors retain `anchor_round` only as combat provenance and use their
  participant turn ordinal as the deadline.
- **World-time units** (`minute`/`hour`/`day`): the monotonic
  `clock.elapsed_minutes` is authoritative; `clock.in_game_time` remains
  narrative display text and is never parsed. Creation and refresh persist an
  anchor and exact safe-integer deadline (`anchor + amount × unit multiplier`),
  and live rows with missing or inconsistent evidence fail closed. The single
  `advanceWorldTime` operation expires due effects at or beyond the deadline;
  explicit `expired` endings before that boundary are rejected. A missing clock
  is an error, not an implicit zero. Migration-13 historical ended world timers
  may retain null elapsed evidence as a legacy terminal record; live timers and
  ended rows with partial evidence remain fail-closed.
  Turn-relative timers use `combat_turn_budget.turns_taken`: the anchor ordinal
  is completed turns plus one when the anchor participant is currently active,
  otherwise completed turns; the deadline ordinal is anchor ordinal plus
  amount. Other participants and global round jumps do not advance that clock.
  `begin_turn` settles due timers automatically; trigger-occurrence
  round timers stamp the current round while world-time units retain declared
  expiry.
  The same participant-clock validation is used by strict reads, explicit
  expiry, boundary settlement, combat closure, and integrity auditing; removed
  durable targets continue to identify their target-turn clock.

## 4. Status machine

```
            ┌─────────────┐  suppress   ┌────────────┐
  create ──►│   active    │────────────►│ suppressed │
            │             │◄────────────│            │
            └──────┬──────┘  unsuppress └─────┬──────┘
                   │  end (any reason)        │ end
                   ▼                          ▼
            ┌────────────────────────────────────┐
            │ ended (terminal; end_reason set;   │
            │ cleanup already performed)         │
            └────────────────────────────────────┘
```

End reasons (`end_reason`, with `end_detail` where noted):

- `expired` — natural duration end (validated against the typed timer).
- `dismissed` — voluntary dismissal; requires `dismissible`.
- `concentration-broken` — detail ∈ `voluntary`, `damage-save-failed`,
  `incapacitated`, `dead`, `new-concentration`, `forced`.
  `damage-save-failed` is only reachable through `resolveConcentrationCheck`
  (which validates the DC evidence); `new-concentration` only through the
  replacement path; `incapacitated`/`dead` only through the F6 life-state hook.
- `dispelled` — dispel magic and equivalents.
- `replaced` — superseded by an explicit recast with replacement semantics.
- `source-removed` — originating item destroyed / actor removed where
  mechanically relevant.
- `ruled` — explicit DM ruling (audit note required).

Cleanup runs **in the same transaction** as the end transition: every active
link is either removed (its projection deleted from the target it was written
to) or released (ownership dropped, projection left in place) according to
`cleanup_on_break` (concentration-broken ends) or `cleanup_on_end` (all other
ends); remaining active targets are marked removed with reason `effect-ended`.
`status = 'ended'` therefore **implies cleanup has occurred** — an ended effect
with active links is corrupt state and load validation flags it.

Idempotency: re-delivering the same end event (same reason) to an ended effect
is a no-op (`changed: false`); a *different* transition on an ended effect is
rejected deterministically. Refresh/reassert after final expiry is rejected —
a rule that re-creates the effect must create a new effect.

## 5. Concentration contract

- At most one active/suppressed concentration effect per owner
  (`character` or `combatant`), enforced in code **and** by a partial unique
  index.
- The owner must be **capable** at creation: a non-`alive` character or a
  0-HP/unconscious/dead combatant cannot start concentrating. This is a
  creation gate, not a hook, because the cleanup reactions below fire only on
  transitions — admitting an already-down owner would mint a live effect
  nothing ever cleans up.
- Creating a new concentration effect while the owner concentrates ends the
  prior effect first — reason `concentration-broken`, detail
  `new-concentration`, provenance naming the replacing effect — in the same
  transaction, with both audit events ordered (replacement is deterministic,
  never an error, matching the SRD).
- Voluntary stop is `concentration-broken`/`voluntary` (break cleanup), which
  is deliberately distinct from `dismissed` (end cleanup): a spell that grants
  an action dismissal and a concentration drop can differ in consequences.
- **Damage checks**: whenever a concentrating creature takes damage, the save
  DC is `max(10, floor(damage/2))` **per damage event** — computed from the
  damage dealt, not the net HP delta (temp HP absorb the loss, not the event).
  The outcome is **never model-declared**: the `resolve_concentration` tool
  rolls the d20 itself through the F9 `resolveD20` primitive (seeded RNG,
  2d20kh1/kl1 under advantage/disadvantage) against the engine-computed DC —
  the model only declares which Constitution-save modifiers apply, its normal
  F9 ruling — and applies the lifecycle transition atomically.
  `resolveConcentrationCheck` accepts only verifiable roll evidence
  (`ConcentrationSaveEvidence`: dice form, every die, kept-die selection,
  modifier arithmetic, DC) and fails closed on any inconsistency before any
  mutation; the outcome is then derived from `total >= dc`, never read from
  the caller. The full roll is recorded in the effect's audit ledger and
  rides the tool result with `category: 'saving_throw'` for the roll ledger
  and turn trace.
- **Incapacitation atomicity**: every incapacitation path breaks
  concentration inside the same transaction as the write that caused it —
  `hpLifecycle.writeHpFields` for character life-state transitions,
  `updateCombatant` for combatant HP/status/condition writes, and
  `addCondition` for character condition writes (which covers both the
  `add_condition` tool and conditions projected by `start_effect`, so a
  projected paralysis breaks its target's own concentration). Condition
  incapacitation is grounded in the pack's structured relation data — the
  condition record's `impliesCondition: incapacitated` mechanic (paralyzed,
  petrified, stunned, unconscious) or `incapacitated` itself; namespaced
  projected ids (`paralyzed:fx-hold`) resolve by base name; non-implying
  conditions (poisoned, prone, …) never break. All reactions are
  transition-gated (capable → incapacitated), so duplicate application and
  already-incapacitated creatures trigger nothing. A cleanup failure rolls
  back the entire causing write (tested via injected cleanup failure on both
  the combatant and condition paths). The creation gate mirrors the same
  three checks, so an already-incapacitated owner can never mint a live
  effect the transition hooks would miss.
- **Incapacitation/death** (F6 hook): any `life_state` transition out of
  `alive` breaks the character's concentration (`incapacitated`, or `dead`)
  inside the same HP transaction. F3 never duplicates the life-state machine —
  it only reacts. Combatant HP reaching 0 through `update_combatant` breaks a
  combatant owner's concentration the same way; combatant damage above 0
  surfaces the required check (DC included) on the tool result.

## 6. Operations (the only write paths)

All operations run inside `withTransaction`, validate **before** any mutation
(invalid input leaves canonical state, projections, and the ledger untouched),
write through the existing seams (`addCondition`/`removeCondition`,
`updateCombatant`) rather than a parallel persistence mechanism, and append
typed audit events.

- `createActiveEffect` — validates kind license, source grounding, duration,
  concentration ownership, target existence, projection collisions (a
  condition id already present on a target is refused — same-effect
  non-stacking is a rules question, silent double-ownership is corruption),
  linked-actor existence, zone identity/geometry, and one current form per
  participant; performs concentration replacement; projects conditions,
  zones, and forms; records `created`.
- `endActiveEffect` — reason-validated end + owned cleanup (see §4).
- `resolveConcentrationCheck` — evidence-validated check (see §5).
- `breakConcentrationOnLifeEvent` — F6 hook; idempotent when the owner holds
  no concentration.
- `removeEffectTarget` — partial multi-target removal: marks the target
  removed and cleans up exactly that target's owned projections; never ends
  the effect implicitly (whether a targetless effect persists is a rule, not
  an inference).
- `refreshEffect` — re-anchors an active effect's timer (Animate Dead-style
  reassertion), optionally with a new validated duration.
- `recastBondedSummon` (model tool `recast_bonded_summon`, eshyra-s02z,
  eshyra-71u1) — records the source recast of a bonded summon. The engine
  models two presences for the bonded actor and maps its status to one:
  `absent` -> `absent`, `alive` -> `present`; any other status is refused,
  naming it. The spell record's `cast-again` transition whose `when` includes
  that presence and the active link decides the result by its operation, never
  by the spell's name.
  - **Absent** (the transition changes presence -> present).
    `restore-same-actor` with `hitPoints: maximum` (Find Steed) takes no form
    and returns the same campaign actor alive at its effective hit point
    maximum (the stored maximum, halved at exhaustion level 4 or more).
    `select-new-form` (Find Familiar, `restore-and-reform-absent-familiar`)
    requires `form`, a `creatureRef` from the record's creation forms (the form
    it had before is allowed), and returns the same actor in that form with
    that creature record's hit points as its maximum and, under the same
    exhaustion rule, its current hit points.
  - **Present** (the transition changes no presence). Only `select-new-form`
    is executable (Find Familiar, `reform-present-familiar`): `form` is
    required, and the same actor stays alive in that form. The source says the
    familiar "has the statistics of the chosen form" and "transforms into the
    chosen creature", and it says nothing of damage carrying across the
    transformation (no official ruling addresses it either). The engine reads
    hit points as part of those statistics, as it does for the absent restore,
    so the reformed familiar takes the new form's hit points: the maximum is that
    creature record's hit points and the current hit points are the
    exhaustion-adjusted maximum (a damaged familiar reformed into the same
    form returns at full). Find Steed has no `cast-again` transition for a
    present steed (the SRD bonds one steed at a time; its recast only restores
    an absent steed), so a present steed is refused.
  - Any other operation is refused. Everything else about the actor
    (conditions, exhaustion, display name, location, its `vanish-bonded` rule,
    so it can vanish again) stays as stored; the effect and its link are
    untouched.
  - **Pocket presence is not modelled** (eshyra-82uk): the engine cannot tell
    a familiar dismissed to its pocket dimension from a present one, so both
    are a live actor with an active bond. The reform is still correct for a
    pocketed familiar, because `reform-pocketed-familiar` has the same
    operation and no presence change; the recorded transition is always
    `reform-present-familiar`.
  - Preconditions, validated before any write: the effect is active (not
    ended, not suppressed) and `summoning`; it is
    spell-sourced (a ruling-sourced bond is refused: the engine cannot tell
    which spell created it) and `spellRef` is its source; it holds exactly one active actor link to a
    durable campaign actor with the `vanish-bonded` rule that is `absent` or
    `alive`; and that actor has no combatant in an active combat instance (both
    spells take 10 minutes or longer to cast, and a Find Familiar reform is the
    same cast, so the recast happens outside combat). An ended effect or
    released bond (a new cast creates a new creature) is refused. The engine
    write is `restoreBondedCampaignActor` in `encounterCombatants.ts` (with
    `expectedPresence`), the only path from absent back to alive and the path
    for the present reform, and records a `recast` event (`spellRef`,
    `transitionId`, `actor`, `hpCurrent`, `hpMax`, `form` when given). It spends
    no spell slot (spend it, or cast the ritual, separately) and moves no
    creature in space (`reappearancePlacement` is narrated). Permanent dismissal
    after a 0-HP absence stays gated on
    `ambiguity:find-familiar-permanent-dismissal-after-zero-hp`.
- `suppressEffect` / `unsuppressEffect` — antimagic-style suppression without
  end/cleanup, exposed to the model as model-facing tools
  `suppress_effect` and `unsuppress_effect`.
- `expireElapsedRoundEffects` — deterministic round-deadline sweep.
- `expireElapsedWorldEffects` — deterministic minute/hour/day sweep against
  the campaign's monotonic `clock.elapsed_minutes`. Creation and refresh both
  persist the elapsed anchor and calculated deadline. Advancing world time
  first validates the due-effect cleanup, then advances the clock and ends
  every due effect through `finalizeEnd`; cleanup failure rolls the clock and
  cleanup back atomically. An explicit `expired` end is accepted only at or
  after the durable deadline, including the exact boundary. Narrative
  `in_game_time` labels never participate in this arithmetic.

Read paths: `listActiveEffects` (validated typed views — status, source,
targets, links, deadline description — consumed by the context assembler so
the DM can distinguish active/suppressed/ended without prose),
`getConcentrationEffect`, `listEffectEvents`, and
`validateActiveEffectDurableState` (load-time integrity: concentration
owner presence, timer completeness, ended-with-active-links, dangling
link/target references, duplicate concentration).

Database mutations may be nested. `withTransaction` always delegates to
better-sqlite3's transaction wrapper, so an inner operation uses a savepoint:
an inner failure can be caught and rolled back while the outer mutation
continues, whereas an uncaught inner failure rolls back the complete outer
transaction.

Short-rest Hit Die recovery is a bounded decision window. It opens only after
the rest's time advancement and all rest hooks commit within the transaction.
The window remains available across model turns while the world clock is still
at that rest's end and no combat is active. Any later elapsed-time advancement
or combat start closes all open windows; explicit recovery completion closes
only the named participant's window.

`clock.in_game_time_elapsed_minutes` records when the narrative label was last
explicitly synchronized. Elapsed-time advancement without a replacement label
marks the label stale; `update_clock` changes the synchronization minute only
when it sets a new label, not when it changes location.

## 7. Determinism & replay

Effect ids are caller-supplied; event ids are `(effect_id, seq)`; timestamps
come from the mutation context — replaying the same operation sequence on a
fresh database reproduces byte-identical `active_effect*` rows (tested).
Failed operations throw before mutating; multi-write cleanup is atomic
(tested via mid-operation collision rollback).

## 8. Participant lifecycle boundaries

The full policy (with the mechanical mutation inventory behind it) lives in
`docs/audits/2026-07-12-f3-mutation-lifecycle-audit.md` §7. In short:
combatant participants must belong to an **active** combat instance to be
referenced by new effect state; `closeCombatInstance` atomically — in
deterministic precedence — settles round timers anchored to the instance by
expiry (their clock can never advance again; round-scale remainders elapse
as combat ends), breaks combatant-owned concentration (`owner-removed`),
**releases** owned actor links (before target removal, so a combatant that
is both target and owned actor keeps the release disposition), removes
combatant targets and condition projections (`combat-ended`), and detaches
combatant source-actor pointers (the `created` event keeps the provenance),
so live effects never point at unreachable combatants or dead clocks
(character-owned effects survive closure — combat ending does not end
spells. At combat close, an explicitly persistent owned actor (or a combatant
already projected from a campaign actor) is synchronized to its durable actor
row and all eligible source, target, condition, and ownership references are
rebound to `campaign_actor`. Instance-only references retain the fail-closed
release/remove/detach behavior. Campaign actors never become concentration
owners or participant-turn anchors. Closure notes use
global rounds only for ordinary round anchors; source/target turn anchors
report remaining participant turn-start boundaries. `inactive` and `absent`
mean removed from play: such a combatant cannot start concentrating and
transitioning into either breaks concentration, which is what lets owned-actor cleanup cascade
(terminal transitions flip status before cleanup, so cycles terminate).
`escaped` combatants remain capable while the instance is active. Every
operation that invokes nested cleanup re-reads its own liveness afterwards:
non-terminal writes never land on an ended effect, cleanup provenance is
never overwritten by a superseded operation, `ended` is always the final
ledger event (enforced at the event seam), and `remove_effect_target`
reports `superseded: true` when its own cascade terminally ended the effect.
Condition
links are deliberately independent of the target list — a summoned actor may
carry an owned condition without being a spell "target"; target removal
cleans exactly the links addressed to that target. There is no generic
model-facing mutation tool: `mutateState` is a trusted `/internal` seam and
the historical `mutate_state` wrapper was deleted (audit §5).

### Remove cleanup and `absent` (S44)

A `remove` cleanup of an actor link takes the owned creature out of play
through an engine seam (`removeCombatantFromPlay` /
`removeCampaignActorFromPlay`): status becomes **`absent`** (on the
combatant, its campaign actor and the active projection) and the action is
reported `removed`. alive, unconscious, escaped, inactive, dead and already
absent creatures all become absent (dead may become absent and nothing else;
absent never returns to another status on the same row). `released` is
reported only for a stored `release` policy. A holder that is truly
unreachable (deleted, closed instance) is `missing`.

### Revert cleanup and the natural form (eshyra-ysr3)

A `revert` cleanup of an actor link restores the owned creature's recorded
**natural form** through an engine seam (`revertCombatantToNaturalForm` /
`revertCampaignActorToNaturalForm`, mirroring the remove seams: the combatant
in an active instance, else the campaign actor, delegating to its active
projection) and the creature **stays in play**: the action is reported
`reverted`, the link closes with status `removed` (there is no link status for
it), and a holder that is unreachable, dead, or already absent is `missing`.
The natural form (`{ hpCurrent, hpMax, rulesRef }`) is captured at cast
(`start_effect` actors entry `naturalForm`): required exactly when the spell
record's 0-HP rule is `revert-form`, refused for every other source including
ruling-sourced actors. Reversion restores exactly these values (the hit
points the creature had when transformed, clamped to the effective maximum, so
exhaustion still applies), sets the status alive, keeps conditions (the same
creature; effect-owned projections are cleaned by normal link cleanup),
clears the creature's 0-HP rule, and takes the armor class from the natural
form's record when it resolves (otherwise it is unset). No damage carries
over (the source states carry-over only for Animate Objects). `revert` is
refused on condition/zone/form links, on ruling-sourced links, and on any
actor link without a snapshot.

A dying or stable creature is **unreachable** under `remove`: the engine
refuses `deathRules: 'player-character'` for a creature owned under a
`remove` policy (or one whose spell has a 0-HP rule), and refuses to link a
creature already on player-character rules under `remove` or a 0-HP rule.
If the seam ever meets a dying or stable creature it raises an internal
invariant error and never translates the action. An absent combatant takes
no turn and cannot be damaged, healed, given or relieved of conditions,
save, stabilize, or suffocate. Re-admitting an absent campaign actor to an
encounter is a new manifestation: it needs `hpCurrent` above 0 and starts
alive as a new creature with a fresh lifecycle. Nothing from the manifestation
that left play carries over (conditions, exhaustion, death rules, 0-HP rule,
heads); a new owning effect sets its own 0-HP rule. An absent actor still
held by an active actor link (a `vanish-bonded` familiar or steed) is refused
instead: S1 returns it only through its spell (a Find Familiar cast restores
presence; a Find Steed recast restores the same steed to maximum HP), and
`recast_bonded_summon` executes that recast. Ending the owning effect releases
the bond; a later admission is then a new creature (S1: with no link a cast
creates a new familiar).

## 9. Downstream hooks

- **F7 rest engine**: long rest is a caller of `endActiveEffect`/
  `expire`-style sweeps; F3 exposes the typed timers it needs.
- **F4 spells**: slot spend on cast is F4's; F3 records the resulting effect.
- **S1 summons**: `summoning` kind + `actor` links encode the reviewed
  control/break matrix; per-spell projection stays in S1. For spell sources
  the record decides the defaults and a contradicting explicit policy is
  refused: a `spell-ended` transition that removes presence requires
  `cleanupOnEnd 'remove'`; a `concentration-broken` transition that leaves
  presence alone (Conjure Elemental/Fey, control -> uncontrolled) requires
  `cleanupOnBreak 'release'`; otherwise a concentration spell whose
  spell-ended transition removes presence requires `cleanupOnBreak 'remove'`.
  Omitted policies take those values.
  **Uncontrolled successor (Conjure Elemental/Fey).** SRD: after a broken
  concentration "the elemental doesn't disappear. Instead, you lose control of
  the elemental, it becomes hostile toward you and your companions ... An
  uncontrolled elemental can't be dismissed by you, and it disappears 1 hour
  after you summoned it." The concentration effect still ends terminally
  (`concentration-broken`, links `released`). When the spell record has a
  `summoning` transition triggered by `absolute-time-reached` that removes
  presence, applies only to an `uncontrolled` creature, and carries a timer
  (derived from the transitions, never from spell names), `finalizeEnd` creates
  in the same transaction one successor effect `<original id>:uncontrolled`
  (the `:uncontrolled` id suffix is engine-owned: `createActiveEffect` refuses
  a caller id ending in it, and refuses such a spell's effect when its derived
  successor id is already stored, so the break never meets a taken id; no
  other id is invented): kind
  `summoning`, display name `<original> (uncontrolled)`, the same spell source
  and source actor, no concentration, not dismissible, an active actor link
  per released creature with `remove`/`remove` cleanup (and a target entry when
  the creature was a target), and the original's timed duration copied
  verbatim, including anchor kind, `anchor_at`, `anchor_game_time`,
  `anchor_elapsed_minutes` and `deadline_elapsed_minutes`. The deadline is
  therefore 1 hour after the summoning, never 1 hour after the break. The
  original's anchor must mark the moment of summoning (`spell-cast`, or
  `effect-created`, since the effect is created at that casting), and its
  duration must equal the record timer's amount and unit. `createActiveEffect`
  refuses any other anchor for such a spell, so the break (which must never
  fail and roll back the write that caused it) always has a deadline to copy;
  the break-time check only guards corrupt rows. Everything else follows from the
  ordinary machinery: world-time advance expires the successor at its deadline
  (`expired`) and its `remove` cleanup makes the creature absent; the creature
  still vanishes at 0 HP (the successor ends `source-removed`); `dismissed` is
  refused; `dispelled` and `ruled` work; the caster, holding no concentration
  for it, may concentrate on another spell. Every break route produces it
  (failed damage save, incapacitation/death, new-concentration replacement,
  voluntary or forced break, owner removal at combat closure; at closure a
  creature with a durable campaign-actor identity has the successor link
  rebound to it like any owned actor, an instance-only creature is released).
  Break results report it as `cleanup.successorEffectId`. Spells whose break
  transition removes presence (Conjure Animals) get no successor. The 0-HP rule is a durable creature
  property (`zero_hp_rule`, mirrored into the actor's `combatLifecycle`),
  derived from the record's `zero-hit-points` transition or declared as
  `atZeroHitPoints` for a ruling-sourced creature. Find Familiar and Find Steed
  are instantaneous but keep a persistent link, so they are spell-sourced
  (see Source grounding) and derive `vanish-bonded`; a contradicting
  declaration is refused. The ruling form stays legal for homebrew bonded
  creatures, which `recast_bonded_summon` cannot recast.
  **`vanish-bonded`** (presence->absent with the effect and link left active:
  Find Familiar, Find Steed; S1 invariant 8, physical absence does not end the
  link) makes the creature absent at 0 HP while its link and effect stay
  active. It requires a durable campaign-actor identity (`campaignActorId`),
  since combat closure releases instance-only links. Restoring the same
  creature is the spell's recast, executed by `recast_bonded_summon`
  (eshyra-s02z, below); `start_encounter` refuses it meanwhile.
  **`vanish`** (integrity->destroyed, or presence->absent together with the
  effect ending: the conjure spells, Simulacrum) is executed: reaching 0 HP by any route
  (damage, suffocation, exhaustion clamping; exhaustion level 6 is death, not
  0 HP) makes the creature absent, never dead/dying/stable/unconscious; its
  concentration breaks (owner-removed), its link closes (`removed`, reason
  `zero-hit-points`) and the effect ends (`source-removed`) when no owned
  creature remains. Releasing a link does not clear the property. A knockout
  of such a creature is refused.
  **`revert-object`** (form->original on an `animated-object` profile:
  Animate Objects; the original form is an object, not a creature) is
  executed like `vanish` for the creature: at 0 HP by any route it becomes
  absent (never dead/dying/stable/unconscious), its concentration breaks
  (owner-removed), its link closes (`removed`, reason `zero-hit-points`) and
  the effect ends (`source-removed`) when no animated object remains. The
  result is `reverted` (never `vanished`) and reports `carriedOverDamage`:
  the damage beyond the hit points it had (`max(0, damage - hpBefore)`; 0 for
  a suffocation drop or exhaustion clamping). The engine does not track
  object hit points, so the amount is reported, not stored. The cleanups are
  derived: `spell-end-reversion` requires `cleanupOnEnd 'remove'` and, for a
  concentration spell, `cleanupOnBreak 'remove'` (the object stops being a
  creature, so it leaves play when the spell ends or concentration breaks);
  a contradicting explicit value (for example `release`) is refused with the
  transition id.
  **`revert-form`** (form->original on a `target-transformation` profile:
  Giant Insect; the original is the same creature at natural size) never
  removes the creature. At 0 HP by any route (damage, suffocation drop,
  exhaustion clamping; exhaustion level 6 is still death) it returns to the
  recorded natural form (hit points, maximum, rules reference), alive with
  its 0-HP rule cleared; its link closes (`removed`, reason
  `zero-hit-points`) and the effect ends (`source-removed`) when no
  transformed creature remains. The result is `reverted` with the restored
  `naturalForm`. The cleanups are derived as `revert` for both spell end and
  concentration break (explicit `remove`/`release` is refused), and the same
  restoration happens on spell end, concentration break, and per-target
  `remove_effect_target` (the "action to dismiss the effect on it"). A
  form->original zero-hit-points transition on any other profile is refused
  as an unknown reversion target rather than guessed. The knockout and
  player-character death-rule refusals apply to all four rule values. A
  present `revert-form` creature must hold an active actor link with a
  natural form: `auditActiveEffectIntegrity` reports one that does not, and
  its 0-HP reversion refuses with a message naming the missing natural form.
  Migration 0040 rewrites legacy `revert` rows (and the mirrored actor
  lifecycle JSON) to `revert-object` when any actor link, in any status,
  holding that creature belongs to a `spell:animate-objects` effect and to
  `revert-form` otherwise; legacy `revert-form` rows carry no snapshot
  (nothing was released with the old rule), so they exist only in
  development databases. Their links keep the old `remove`/`release`
  policy, which would take the creature out of play (or leave it
  transformed) instead of reverting it, so the shared cleanup seam (effect
  end, concentration break, `remove_effect_target`) refuses any non-`revert`
  policy on a live `revert-form` holder rather than translating it.
- **S3 wards / transformations / item lifecycles**: suppression tools are
  available, and `zone`/`form` link kinds use canonical S3/C1 projection
  stores through F3 cleanup: `remove` invokes the
  canonical projection operation in the terminal transaction. Zone and form
  links currently require `remove`; `release` fails closed until a supported
  clear/update/adopt lifecycle exists for unowned projections.
- **F6 life state**: one-way reaction hook (see §5); the life-state machine
  stays in `hpLifecycle.ts`.
