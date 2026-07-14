# Active-Effect Lifecycle & Concentration (F3)

Bead: `eshyra-2n1t.5` (engine family F3; source:
`docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-8-execution-boundary-classification.md`
§4). Runtime owner: `packages/core/src/state/activeEffects.ts`; durable schema:
`packages/core/data/migrations/0010_active_effects.sql` plus
`0011_active_effect_anchor_evidence.sql`; evidence:
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
  actors (summoned/animated combatants); `zone` and `form` are schema-reserved
  for S3/transformation rollout and fail closed in code. Each link carries two
  cleanup policies (`cleanup_on_end`, `cleanup_on_break`) so normal spell end
  and concentration break can differ (the Conjure Elemental distinction: break
  releases the elemental, ordinary end removes it).
- **`active_effect_event`** — append-only per-effect audit ledger
  (`seq` starting at 1) with a typed, validated `detail_json` per event kind:
  `created`, `refreshed`, `suppressed`, `unsuppressed`, `concentration-check`,
  `target-removed`, `ended`.

### Effect kinds are semantic licenses

`kind` is not a label; like the reviewed S1 profile discriminant, it licenses
what an effect may declare (fail-closed):

| Kind | Source kinds | Link kinds | Concentration |
| --- | --- | --- | --- |
| `spell-effect` | spell, ruling | condition | record-derived |
| `summoning` | spell, feature, ruling | condition, actor | record-derived |
| `ward` | spell, magic-item, ruling | condition, zone† | record-derived |
| `curse` | spell, magic-item, creature-trait, ruling | condition | record-derived |
| `transformation` | spell, feature, ruling | condition, form† | record-derived |
| `item-power` | magic-item | condition | declared |
| `condition-package` | spell, creature-trait, hazard, ruling | condition | forbidden |

† schema-reserved; creation refused until the owning rollout bead lands.

### Source grounding

A `spell` source **requires** a `source_ref` that resolves in the campaign
rules stack (homebrew goes through `ruling`). The spell record's duration text
is authoritative where it parses:

- `Instantaneous` → refused (instantaneous spells leave no active effect).
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

- **Round-unit timers** are code-evaluated: the deadline is
  `anchor_round + amount` rounds (`minute` = 10 rounds under the SRD 6-second
  round when evaluated in combat is *not* auto-converted — only `round`-unit
  timers auto-expire). `expireElapsedRoundEffects` ends every effect whose
  anchoring instance has advanced past its deadline; declaring `expired` on a
  round timer **before** its deadline is refused.
- **World-time units** (`minute`/`hour`/`day`): the campaign clock
  (`clock.in_game_time`) is narrative text, so expiry is a declared operation —
  but only a `timed`/`until-trigger` effect can expire, the audit event records
  the declared elapsed reasoning, and the typed timer is preserved for review.
  Turn-relative timers use `combat_turn_budget.turns_taken`: the anchor ordinal
  is completed turns plus one when the anchor participant is currently active,
  otherwise completed turns; the deadline ordinal is anchor ordinal plus
  amount. Other participants and global round jumps do not advance that clock.
  `begin_turn` settles due timers automatically; trigger-occurrence
  round timers stamp the current round while world-time units retain declared
  expiry.

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
  and linked-actor existence; performs concentration replacement; projects
  conditions; records `created`.
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
- `suppressEffect` / `unsuppressEffect` — antimagic-style suppression without
  end/cleanup, exposed to the model as model-facing tools
  `suppress_effect` and `unsuppress_effect`.
- `expireElapsedRoundEffects` — deterministic round-deadline sweep.

Read paths: `listActiveEffects` (validated typed views — status, source,
targets, links, deadline description — consumed by the context assembler so
the DM can distinguish active/suppressed/ended without prose),
`getConcentrationEffect`, `listEffectEvents`, and
`validateActiveEffectDurableState` (load-time integrity: concentration
owner presence, timer completeness, ended-with-active-links, dangling
link/target references, duplicate concentration).

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
spells; campaign-actor rebinding is `eshyra-2n1t.5.3`). `inactive` means
removed from play: it cannot start concentrating and transitioning into it
breaks concentration, which is what lets owned-actor cleanup cascade
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

## 9. Downstream hooks

- **F7 rest engine**: long rest is a caller of `endActiveEffect`/
  `expire`-style sweeps; F3 exposes the typed timers it needs.
- **F4 spells**: slot spend on cast is F4's; F3 records the resulting effect.
- **S1 summons**: `summoning` kind + `actor` links + `cleanup_on_break =
  'release'` encode the reviewed control/break matrix; per-spell projection
  stays in S1.
- **S3 wards / transformations / item lifecycles**: suppression tools are
  available for the future ward runtime, but `zone`/`form` link kinds remain
  schema-reserved and fail closed until their canonical S3/C1 projection
  runtimes land. Those runtimes must use F3 link cleanup: `remove` invokes the
  canonical projection operation in the terminal transaction, while `release`
  closes ownership and leaves the projection intact.
- **F6 life state**: one-way reaction hook (see §5); the life-state machine
  stays in `hpLifecycle.ts`.
