# F3 mutation, reachability & lifecycle audit (PR #437)

Date: 2026-07-12. Bead: `eshyra-2n1t.5`. Scope: prove one coherent
active-effect lifecycle across every reachable canonical mutation path,
participant transition, effect transition, cleanup cascade, and load/integrity
boundary — by mechanical enumeration, not review intuition.

Method: the inventories below were produced by repository searches over
`packages/core/src`, `packages/cli/src`, tests, and docs for every SQL writer
(`UPDATE|INSERT|DELETE` per canonical table), every caller of the mutation
primitives (`mutateState(`, `mutateStateBatch(`, domain operations), and every
`ToolRegistry` construction / `register(` / `DEFAULT_TOOLS` reference. Every
production hit is classified; the classification key is:
**MIG** migration, **SEED** initial creation/import, **PRIM** trusted internal
primitive, **DOM** runtime domain transition, **TOOL** model-facing tool,
**PUB** stable public API, **LEGACY** legacy compatibility surface,
**DEAD** unreachable/orphaned, **TEST** test-only.

## 1. Tool & API reachability inventory

There is exactly **one** production registry construction:
`createDefaultToolRegistry()` (`orchestrator/tools.ts`), consumed by the CLI
(`packages/cli/src/index.ts`). No production code calls
`registry.register(...)` outside it; model adapters receive
`ToolRegistry.definitions()` from that same registry. Therefore: **a tool is
model-reachable iff it is in `DEFAULT_TOOLS`** (pinned by
`tools.test.ts` "lists the default tool set").

Every `orchestrator/tool*.ts` file is imported into `DEFAULT_TOOLS`, with one
exception:

| Tool file | In `DEFAULT_TOOLS` | Imported by anything | Classification |
| --- | --- | --- | --- |
| every other `tool*.ts` | yes | tools.ts | TOOL |
| `toolMutateState.ts` | **no** | **nothing** (zero imports repo-wide) | **DEAD → removed by this PR** (§5) |

Lifecycle-relevant stable root exports (`index.ts`): none expose raw
mutation of lifecycle-owned fields. `/internal` exports the domain operations
and the `mutateState` primitive for co-developed callers (tests, CLI debug) —
`/internal` carries no compatibility or safety promise by charter.

## 2. Mutation-path inventory

Writers per canonical state, from the SQL/primitive sweeps. "Reachability"
names the outermost reachable surface. All domain transitions run inside
`withTransaction` (better-sqlite3 nests via savepoints).

### Character state

| State | Writer path | Reach | Enforcement | Atomic | Gap/action |
| --- | --- | --- | --- | --- | --- |
| `hp_current`/`hp_temp`/`life_state`/death saves | `hpLifecycle.ts` (`adjustHp`, `recordDeathSave`, `stabilizeCharacter`, `grantTemporaryHp`, `expireTemporaryHp`) via `mutateStateBatch` | TOOL (`adjust_hp`, `record_death_save`, `stabilize_character`, `grant_temporary_hp`) | F6 machine; death→attunement release; leaving-`alive`→concentration break, same txn | yes | none |
| `hp_max`, abilities, identity | `character/creation.ts`, `levelUpEngine.ts` via `mutateStateBatch` | PUB (creation/level-up flows) | build validators; SEED/projection — no live effects can exist before a character does; level-up never lowers `life_state`/conditions | yes | none (build-owned; see §6 policy) |
| `conditions_json` | `domainMutations.addCondition`/`removeCondition` | TOOL (`add_condition`, `remove_condition`) + DOM (F3 projections/cleanup) | shape validation; **incapacitation→concentration break, same txn** | yes | none (this PR) |
| `conditions_json` (whole-array set) | `mutateState` PRIM direct | /internal only (tests, creation) | shape validation only — **no lifecycle reactions** | yes | trusted-seam policy (§6); not model-reachable |
| `inspiration` | `state/inspiration.ts` | TOOL | own domain op; no lifecycle interaction | yes | none |
| character row create/attach | `ensureCharacterRow`, creation, custody attach | PUB | no effects can pre-exist a row | yes | none |
| character removal | **none** — no production path deletes a `character` row (verified: zero `DELETE FROM character`); custody release drops registry locks only | — | — | — | character participant refs cannot dangle in production |

### Encounter & actor state

| State | Writer path | Reach | Enforcement | Atomic | Gap/action |
| --- | --- | --- | --- | --- | --- |
| combatant rows (create) | `startEncounter` INSERT | TOOL (`start_encounter`) | record-derived statlines | yes | none |
| combatant HP/status/conditions | `updateCombatant` (sole UPDATE) | TOOL (`update_combatant`) + DOM (F3 cleanup) | one txn: write + actor sync + **incapacitation/`inactive` break** | yes (this PR wraps) | none (this PR) |
| campaign-actor sync | `upsertCampaignActor` ← `startEncounter`/`updateCombatant` | DOM | derived projection of combatant state | yes | actors are projections, never concentration owners (owner kinds are `character`/`combatant` only) |
| combat-instance close | `closeCombatInstance` (sole status writer) | TOOL (`close_combat_instance`) | **was: no F3 reaction — combatant-scoped effect state became unreachable** | now yes | **fixed by this PR** (§7 policy) |
| combat round | `beginTurn` UPDATE `combat_instance.round_number` | TOOL (`begin_turn`) | monotonic; F3 round deadlines key off it | yes | expiry sweep integration = `eshyra-2n1t.5.1` |

### Active-effect state

All four tables are written **only** by `state/activeEffects.ts` (verified:
no other file touches them). Transitions: create (+concentration
replacement), suppress/unsuppress, refresh, target removal, declared/round
expiry, dismissal, dispel, source removal, ruled end, concentration check,
life-event breaks, combat-close reactions. Every path validates before any
write, appends typed ledger events, and cleans owned projections in the same
transaction. Reachability: five F3 tools + DOM hooks from `hpLifecycle`,
`domainMutations`, `encounterCombatants`.

## 3. Invariants (single authoritative list)

1. Every live effect has a valid source (spell refs resolve; kind licenses
   source/link kinds) and participant topology per its kind.
2. Every live concentration effect has an owner that exists, is mechanically
   reachable, and is capable: not dead/dying/stable (characters), not 0-HP/
   `dead`/`unconscious`/`inactive`, not in a closed combat instance
   (combatants), not carrying a condition whose record implies
   `incapacitated`.
3. At most one live concentration effect per owner (code + partial unique
   index).
4. Closing a combat instance cannot leave live effect state pointing at its
   combatants (§7).
5. An ended effect has complete end provenance, exactly one terminal
   transition/event, no active links or targets, and its `ended` event is
   the FINAL ledger event — no transition event may follow terminal state
   (enforced defensively at the `appendEvent` seam and audited).
6. Every active condition link names the exact condition entry it created on
   its holder.
7. Every active actor link points at a reachable combatant with typed
   remove-vs-release cleanup.
8. Every source-actor, owner, target, and link reference is covered by
   integrity validation (structural violations throw at the read boundary;
   referential/reachability violations are reported by the audit — same
   helper definitions, §8).
9. Target/link/event rows cannot exist without their owning effect row
   (audited as orphans).
10. Condition links are deliberately independent of the target list (a summon
    may carry an owned condition without being a spell "target"); a target's
    removal cleans exactly the links addressed to it. This asymmetry is
    documented in `docs/active-effect-lifecycle.md` §2.
11. Every cleanup cascade is atomic with its cause.
12. Nested cascades terminate: a terminal transition flips status **before**
    cleanup runs, so re-entrant breaks see the effect as ended and no-op —
    no double-end, no recursion, no iteration-order dependence.
13. Failed validation or cleanup leaves canonical state and every ledger
    unchanged (transaction rollback; validated before first write).
14. No model-reachable or stable-root path bypasses the semantic operations
    that own lifecycle transitions (§1 reachability + §5 disposition +
    registry pin test).
15. Generic mutation primitives are trusted internal seams, never model
    tools (§6).
16. The documented protocol matches `DEFAULT_TOOLS` (docs corrected, §5).
17. No dormant tool wrapper remains ambiguous (§5).
18. **Re-entrant non-terminal mutation policy**: any operation that invokes
    nested cleanup (projection removal can cascade through combatant
    inactivation into other effects' terminal transitions — including back
    onto the operating effect) must re-read its own effect's and links'
    status after every nested mutation, never write non-terminal state to an
    ended effect, never overwrite the winning cleanup's removal provenance,
    and report supersession honestly (`removeEffectTarget` marks the target
    with its own provenance FIRST, skips terminally-closed links, suppresses
    its `target-removed` event when superseded, and returns
    `superseded: true`; `createActiveEffect` throws and rolls back entirely
    when its own projection cascade ends the effect mid-creation; the
    closure reactions re-read liveness before every step).
19. No committed live effect may retain a timer whose clock can never
    advance: round-unit timers anchored to a closing instance are settled
    (expired) at the closure boundary, and the audit reports any live round
    timer whose anchoring instance is missing or inactive.
20. **Snapshot enumeration never grants authority to terminalize.** The
    terminal primitive (`finalizeEnd`) claims the transition with a
    conditional UPDATE against the DURABLE row (`… AND status IN ('active',
    'suppressed')`) and reports `performed: false` when the row was already
    ended by a nested cascade — the first winning reason, detail,
    provenance, cleanup, and terminal event are untouched, cleanup never
    re-runs, and result summaries (`timersExpired`, `expired`,
    `concentrationBroken`, `broken`, `replaced`) count only transitions the
    reporting operation actually performed. Defense in depth at the ledger
    seam: `appendEvent` refuses a second `'ended'` event outright, so a
    duplicate terminal event is impossible even for a hypothetical future
    caller that bypasses the primitive's claim.

    `finalizeEnd` caller classification (all verified): fresh rows —
    `endActiveEffect`, `createActiveEffect` replacement (validation-phase
    read, no mutations between), `resolveConcentrationCheck` (only its own
    check event between read and end), `breakCombatantConcentration`;
    snapshot loops (a prior iteration's cascade can end a later row — all
    gate their reports on `performed`) — combat-closure timer settlement,
    combat-closure owner breaks, `expireElapsedRoundEffects`,
    `breakConcentrationOnLifeEvent` (multi-campaign rows).

## 4. Unsupported topologies (fail-closed at preflight)

- A concentration effect that projects an incapacitating condition onto its
  own concentration owner (it would end itself during creation) — rejected
  before any write.
- Round-unit timers outside an active combat instance.
- Turn/trigger anchors (reserved for `eshyra-2n1t.5.1`).
- `spell-cast` anchors on non-spell sources.
- `zone`/`form` links (reserved for S3/C1 rollout).
- Combatant participants (owner/target/link/source-actor) outside an active
  combat instance.
- Concentration owners that are already incapacitated by any route.
- Duplicate targets/projections; projections colliding with existing
  conditions; actors owned by another live effect.

## 5. `mutate_state` disposition

Findings: `toolMutateState.ts` was the pre-semantic-tools general canon-write
wrapper. It is imported by **nothing** (not `DEFAULT_TOOLS`, not tests, not
the CLI); the execution-boundary classification artifact already records
"exists in code but is **not registered**" as the known state, and gameplay
architecture moved to semantic tools (`adjust_hp`, `add_condition`,
`start_effect`, …) precisely so lifecycle transitions cannot be bypassed. Its
field allowlist (`hp_current`, `life_state`, death saves, `conditions_json`)
would bypass F6 and F3 semantics if it were ever registered.

**Disposition: deleted.** It is legacy residue, not a dormant feature; a
generic model-facing setter over lifecycle-owned fields is architecturally
wrong under the current design, and nothing consumes it. A registry-level
test now pins that no production tool named `mutate_state` exists. The
`protocol.test.ts` fixture label and `docs/character-creation.md` wording
(which refer to the *primitive's input shape*, not the tool) are clarified.
Re-introducing a generic tool would require satisfying §6 policy: it may only
expose **simple canonical facts**, never lifecycle-owned fields.

## 6. Generic vs semantic mutation policy

- **Lifecycle-owned fields** (mutating them has transition/cleanup/audit
  semantics): character HP/temp-HP/life-state/death saves/conditions,
  combatant HP/status/conditions, spell slots, usage counters, attunement,
  inspiration, active-effect tables. Written **only** through their domain
  operations. `mutateState`/`mutateStateBatch` remain the trusted internal
  persistence seam those domain operations (and creation/import/level-up
  projection) are built on: they validate shape/allowlist/provenance but
  deliberately perform no lifecycle reactions, so calling them directly with
  lifecycle-owned fields is reserved for trusted domain code and test setup.
  They are `/internal`-only and MUST NOT be wrapped into a model tool.
  (Documented in `state/mutateState.ts` header.)
- **Simple canonical facts** (no hidden transition semantics): plot flags,
  overlay facts, clock time/location, inventory name/quantity/location.
  These have semantic tools today (`set_plot_flag`, `update_clock`, …); a
  generic setter over only these would be safe but is unnecessary.
- **Build-owned fields** (`hp_max`, abilities, class/ancestry, sheet store):
  authority belongs to creation/level-up/import projections.

## 7. Participant lifecycle policy

- **Combat-instance closure** (`closeCombatInstance`, one transaction, F3
  reactions run *before* the status flip while combatants are still
  mutable), deterministic precedence:
  1. **Round timers anchored to the closing instance settle by expiry**
     (reason `expired`) — regardless of owner kind, source, targets, links,
     or suppression. Rationale: the clock can never advance again, and
     round-scale durations (6 s/round) deterministically elapse before
     anything mechanically relevant can happen after combat; the terminal
     note distinguishes deadline-reached from remaining-rounds settlements.
     Expiry precedes owner breaks: natural end wins over break when both
     apply.
  2. Combatant-owned live concentration breaks with cause `owner-removed`
     (break-policy cleanup).
  3. Active **actor links** to the instance's combatants are **released**
     (reason `combat-ended`) — before target removal, so a combatant that is
     both a target and an owned actor keeps the release disposition; the
     engine relinquishes ownership rather than inactivating entities at
     closure.
  4. Live effects' active combatant targets of the instance are removed
     (reason `combat-ended`) with their owned condition projections cleaned;
     leftover condition links on non-target holders are removed likewise.
  5. **Source actors are detached**: a live effect whose
     `source_actor_kind/ref` names a closing combatant has the pointer
     nulled (recorded as `sourceActorDetached` in the effect's
     `combat-closed` event; the `created` event preserves the original actor
     permanently). The effect itself survives — an NPC-cast curse on the PC
     outlives combat. Interactions are ordered out: a source actor that is
     also the concentration owner never reaches detach (the effect ended in
     step 2); already dead/escaped/inactive source combatants detach
     identically; the operation is idempotent (already-NULL columns are
     skipped).
  Character-owned effects with no combatant references (e.g. Bless) survive
  closure untouched. Promotion/rebinding of persistent summons to
  campaign-actor identity is the follow-up `eshyra-2n1t.5.3`.
- **`inactive`** means removed from active play: an inactive combatant
  cannot start concentrating, and a transition into `inactive` breaks its
  concentration (cause `owner-removed`) atomically — including when the
  transition is itself F3 cleanup (owned-actor removal), which is what makes
  cascades chain deterministically (invariant 12 guards termination).
- **`escaped`** (documented policy): the creature is alive and capable
  elsewhere; concentration persists while the instance is active, and it may
  even start concentrating (it remains mutable); instance closure then
  applies the closure policy above.
- **Predicates** are distinct and centralized in `activeEffects.ts`:
  row-exists, reachable (combatants: active instance), can-be-targeted,
  can-own-an-effect (source actors), can-concentrate, can-receive-mutations.
  Row existence alone answers none of the other questions.

## 8. Integrity coverage

Shared helpers back both boundaries. The strict read boundary
(`listActiveEffects`/`effectView`) throws on structural corruption:
concentration without owner, ended without provenance, ended with active
links **or targets**, malformed timers. The diagnostic audit
(`auditActiveEffectIntegrity`) additionally reports, without stopping at the
first: missing/unreachable source actors, owners, targets, link holders
(including closed-instance combatants); incapable concentration owners;
condition links whose claimed entry is absent on the holder; actor links
whose combatant is missing/unreachable; orphan target/link/event rows;
non-contiguous event sequences; multiple terminal events; an `ended` event
that is not the final ledger event; live round timers whose anchoring combat
instance is missing or inactive (a clock that can never advance); unlicensed
link kinds.

## 9. Test mapping

Every inventory row maps to tests in `activeEffects.test.ts` /
`tools.test.ts`: the owner-state × start-concentration matrix; the
mutation-route matrix (each route asserting a clean integrity audit
afterward); cascade cases (chained inactive-breaks, deliberate ownership
cycle terminating with single terminal events, self-incapacitation preflight
rejection, projection breaking a third party's concentration mid-create,
mixed cleanup policies on one target); combat-closure policy; corruption
cases per audited invariant; injected-failure rollbacks (combatant,
condition, and combat-closure timer-settlement paths); replay determinism;
the `mutate_state` registry pin; source-actor closure topologies
(owner-coincident, target+link-coincident, escaped, targets-elsewhere);
round-timer settlement (character/combatant-owned, suppressed,
no-combatant-refs, deadline reached and unreached); and the re-entrancy
suite (the 4-node target-removal cascade returning `superseded: true` with
un-overwritten provenance and a final terminal event, the same cycle settled
by closure, and a creation superseded by its own projection cascade rolling
back completely); and the stale-snapshot terminalization suite (the
A-expires→B-breaks cascade proven through both the closure timer settlement
and the ordinary round-expiry sweep — first reason wins, one terminal event
each, summaries report only the operation's own transitions — plus a full
re-run of every terminal path against ended rows proving byte-identical
durable state).
