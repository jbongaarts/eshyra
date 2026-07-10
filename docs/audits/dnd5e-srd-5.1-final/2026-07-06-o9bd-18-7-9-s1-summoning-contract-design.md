# eshyra-o9bd.18.7.9 slice S1: summoning contract design

Date: 2026-07-06. Reconciled: 2026-07-09. Bead:
`eshyra-o9bd.18.7.9`.

This is the source-derived design for the 14 S1 spells classified in
`2026-07-06-o9bd-18-7-9-membership-classification.md`. The licensed SRD 5.1
source is authoritative. `S1_SUMMONING_SPECS` is the sole executable semantic
registry; this document records the reviewed contract and transition matrix but
is not a second compiler input.

## 1. Architecture decision

The existing `summonCreature` effect remains for fixed creature-trait uses. S1
uses `summoning`, split into orthogonal immutable rule axes:

- `creation`: selection eligibility, cardinality, placement, and fixed stat
  overlays. Candidate eligibility never implies a resulting creature type.
- `typeTreatment`: an explicit type addition or replacement, when the source
  changes type after selection.
- `control`: relationship, initiative, and an optional command protocol.
  Command channel, cost, timing, batching, order persistence, and no-command
  behavior are independent fields and are omitted when the source is silent.
- `initialState` and `transitions`: source-defined changes to independent
  `effect`, `presence`, `link`, `control`, `attitude`, `form`, and `integrity`
  axes. They describe rules, not live actor state.
- `identity`: ordinary instances, persistent linked actors, or duplicate actors.
- `protocols`, `modifications`, `scaling`, and `hooks`: spell-specific
  deterministic rules and explicit external execution owners.

The profile discriminant is a semantic license, not merely a label. It limits
which state axes, values, triggers, operations, protocols, and identity policy a
record may use. This makes structurally valid but meaningless combinations fail
validation without constructing a universal summon runtime.

Profiles:

| Profile | Licensed state axes | S1 users |
| --- | --- | --- |
| `control-window-undead` | `control` | Animate Dead, Create Undead |
| `animated-object` | `effect`, `form` | Animate Objects |
| `ordinary-summon` | `effect`, `presence` | Animals, Celestial, Minor Elementals, Woodland Beings |
| `exceptional-concentration-summon` | `effect`, `presence`, `control`, `attitude` | Elemental, Fey |
| `persistent-familiar` | `presence`, `link` | Find Familiar |
| `persistent-steed` | `presence`, `link` | Find Steed |
| `target-transformation` | `effect`, `form` | Giant Insect |
| `phantom-steed` | `effect`, `presence` | Phantom Steed |
| `simulacrum` | `effect`, `integrity` | Simulacrum |

Runtime boundaries follow ADR 0017. Pack records contain source-derived rules,
transition preconditions, timers, and hook declarations. Encounter state,
action/reaction budgets, concentration execution, clock scheduling, derived
math, and currency spending remain external to the compiler. Contextual target
or terrain adjudication remains model-supported when the source assigns it to
the GM.

## 2. Shared contract invariants

1. Cardinality is `exact` or `maximum`. Alternatives use an exclusive
   `choose-one` menu; they are never interpreted as cumulative.
2. Candidate eligibility (`creatureTypes`, CR, forms, source objects) is
   separate from `typeTreatment`. Type `add` preserves the original type;
   `replace` removes it and selects exactly one replacement.
3. Placement records only deterministic source constraints. A `visible`,
   `unoccupied`, `onGround`, or source-relative constraint is immutable rule
   data; deciding whether a scene satisfies it is model/engine adjudication.
4. A command protocol never infers its channel from its cost. Missing cost or
   fallback fields mean the source is silent, not a shared default.
5. State selectors and changes are closed and profile-licensed. Every transition
   has an explicit trigger, precondition, changes, and (where relevant) an
   operation. The validator proves every precondition is reachable from the
   initial state or a prior transition result.
6. Relative timers carry an anchor. Elemental/Fey removal after lost
   concentration is anchored to `spell-cast`, not to the concentration break.
   Their ordinary `spell-ended` removal excludes the `concentration-broken`
   cause, so both outcomes cannot fire.
7. Control reassertion requires `control=controlled`, the actor was created by
   that spell, and completion before the current control window expires. It
   resets the window; uncontrolled actors are not eligible.
8. Persistent identity requires an active link. Physical absence does not end a
   Familiar/Steed link. A terminal link state is never a same-identity recast
   precondition.
9. Every source-derived semantic value or relationship in a spec is named by a
   semantic binding to one or more source clauses. Structural IDs,
   discriminants, and grouping keys do not require artificial prose bindings.
10. Nested `creature:*` and `table:*` references must resolve and be kind-correct
    both in curated specs and in the committed pack.

## 3. Source-derived matrix

Legend: `N/A` means the source does not define the axis. `MA` is intentionally
model-adjudicated. `EH` is an external engine hook. Counts marked `max` are not
exact. All placement satisfaction and GM-expanded option decisions are MA.

### 3.1 Creation, type, placement, control, and scaling

| Spell | Creation / eligibility / cardinality | Candidate / resulting type / placement | Control and command | Scaling |
| --- | --- | --- | --- | --- |
| Animate Dead | One M/S humanoid bones/corpse; distinct source per added actor | Bones -> skeleton; corpse -> zombie; appears in source place | Obedient; own turn; mental bonus action within 60 ft; any/all receive same command; general order persists; without active order defends itself | Create or reassert +2/slot above 3rd |
| Animate Objects | Capacity max 10; nonmagical, unworn/un-carried, <= Huge; M=2, L=4, H=8 | Existing targets animate in place; become constructs; fixed overlay below | Obedient; own turn; mental bonus action within 500 ft; any/all same command; general order persists; without active order defends itself | +2 capacity/slot above 5th |
| Conjure Animals | Choose one exact menu: 1 CR2, 2 CR1, 4 CR1/2, 8 CR1/4 | Beast candidates; add fey; visible unoccupied spaces in range | Friendly; grouped own turns; verbal, no action; without new command defend, otherwise no actions | Menu counts x2 at 5, x3 at 7, x4 at 9 |
| Conjure Celestial | Exact 1, celestial CR4 | Celestial; visible unoccupied space in range | Friendly; own turn; verbal, no action, alignment-limited; without new command defend, otherwise no actions | CR5 at slot 9 |
| Conjure Elemental | Exact 1, elemental CR5 appropriate to selected air/earth/fire/water 10-ft cube | Elemental; unoccupied within 10 ft of selected source | Friendly/controlled; own turn; verbal, no action; without new command defend, otherwise no actions | CR +1/slot above 5th |
| Conjure Fey | Choose one exact alternative: fey CR6, or beast-form fey spirit CR6 | Fey candidate unchanged; beast candidate has type replaced by fey; visible unoccupied space in range | Friendly; own turn; verbal, no action, alignment-limited; without new command defend, otherwise no actions | CR +1/slot above 6th |
| Conjure Minor Elementals | Choose one exact menu: 1 CR2, 2 CR1, 4 CR1/2, 8 CR1/4 | Elemental candidates; visible unoccupied spaces in range | Friendly; grouped own turns; verbal, no action; without new command defend, otherwise no actions | Menu counts x2 at 6, x3 at 8 |
| Conjure Woodland Beings | Choose one exact menu: 1 CR2, 2 CR1, 4 CR1/2, 8 CR1/4 | Fey candidates; visible unoccupied spaces in range | Friendly; grouped own turns; verbal, no action; without new command defend, otherwise no actions | Menu counts x2 at 6, x3 at 8 |
| Create Undead | Night only; max 3 M/S humanoid corpses -> ghouls | Corpse mapping; actor appears in source place | Obedient; own turn; mental bonus action within 120 ft; any/all same command; general order persists; without active order defends itself | Slot 7 max4 ghouls; 8 max5 ghouls or max2 ghasts/wights; 9 max6 ghouls, max3 ghasts/wights, or max2 mummies; applies to create/reassert |
| Find Familiar | Choose exact 1 from 15 fixed forms | Form stat block; replace beast with exactly one celestial/fey/fiend; unoccupied in range | Independent, always obedient; own turn; no source-defined channel/cost/fallback | N/A |
| Find Steed | Choose exact 1 from 5 fixed forms; GM may allow others | Form stat block; replace normal type with exactly one celestial/fey/fiend; unoccupied in range | Long-lasting bond and service as mount; no source-defined command/initiative economy | N/A |
| Giant Insect | Choose one maximum alternative: 10 centipedes, 3 spiders, 5 wasps, 1 scorpion | Fixed source-to-giant refs; targets transform in place; GM may allow analogous targets | Obedient to verbal commands; acts on caster turn; cost/timing/fallback unstated | N/A |
| Phantom Steed | Exact 1 Large quasi-real horselike actor; riding-horse stats | Ground, unoccupied, in range; appearance chosen | Designated rider; no command/initiative rule | Speed 100 fixed override |
| Simulacrum | Exact 1 beast/humanoid remains in touch range for full 12-hour cast | Duplicate of selected target; appears as original | Friendly to caster/designated; spoken commands; acts on caster turn; cost/fallback unstated | N/A |

### 3.2 Lifecycle and protocols

| Spell | Initial state and transitions | Recast / control window | Protocols and external ownership |
| --- | --- | --- | --- |
| Animate Dead | `control=controlled`; no spell-end/0-HP summon transition | At 24 h -> uncontrolled. Before expiry, controlled actors made by this spell may be reasserted (max4 plus scaling), resetting 24 h | F2 command budget; F3 control timer |
| Animate Objects | `effect=active, form=manifested`; spell/concentration end -> ended/original; 0 HP -> ended/original and remaining damage carries | N/A | Complete construct overlay and attack procedure; F2 command; F3 concentration; F9 attack/math execution |
| Conjure Animals | `effect=active, presence=present`; spell/concentration end or 0 HP -> ended/absent | N/A | F2 command; F3 concentration/removal |
| Conjure Celestial | Same ordinary summon lifecycle | N/A | F2/F3 |
| Conjure Elemental | Active/present/controlled/friendly; 0 HP -> ended/absent; ordinary spell end -> ended/absent except when cause is concentration break; concentration break -> uncontrolled/hostile and stays present; cast+1 h -> ended/absent | N/A | F2/F3; absolute cast-anchored timer |
| Conjure Fey | Same exceptional-concentration lifecycle as Elemental | N/A | F2/F3; absolute cast-anchored timer |
| Conjure Minor Elementals | Ordinary summon lifecycle | N/A | F2/F3 |
| Conjure Woodland Beings | Ordinary summon lifecycle | N/A | F2/F3 |
| Create Undead | Same control state lifecycle as Animate Dead | Pre-expiry reassert max3/base menu; scaling menu applies identically | F2/F3 |
| Find Familiar | `presence=present, link=active`; 0 HP -> absent/active; temporary dismissal -> pocket/active; recall -> present/active; permanent dismissal -> absent/none | With active link, cast changes form; if absent it also restores presence; if pocketed it remains pocketed. With no link a cast creates a new familiar | Telepathy 100 ft; sense share action within 100 ft until next turn with special senses and own-sense blind/deaf; touch delivery from familiar using reaction within 100 ft and caster attack modifier. F2 budgets |
| Find Steed | `presence=present, link=active`; 0 HP/action dismiss -> absent/active; release -> absent/none | Recast from absent+active link restores same actor to max HP; active link prevents a second bond; no restoration after release | Telepathy 1 mile; mounted self-only spell sharing; Int floor 6 and one caster-spoken language. F2 budgets |
| Giant Insect | `effect=active, form=manifested`; spell/concentration end, 0 HP, or per-target action dismissal -> ended/original | N/A | F2 dismissal; F3 concentration |
| Phantom Steed | `effect=active, presence=present`; duration end, damage, or action dismissal -> fading; one minute after trigger -> ended/absent | N/A | Saddle/bit/bridle vanish when >10 ft from steed; designated rider; 10/13 mph. F2 dismissal, F3 timer |
| Simulacrum | `effect=active, integrity=intact`; 0 HP -> ended/destroyed, reverts to snow and melts; dispelled -> effect ended | Recast destroys every active duplicate made by caster, then creates a new ordinary duplicate; no persistent relationship | Lab repair with rare herbs/minerals worth 100 gp/HP; F3 dispel/end, F9 stat derivation, F10 asset spend |

## 4. Fixed overlays and spell protocols

Animate Objects carries source-owned mechanics independently of the referenced
size table: creature type construct; Constitution 10, Intelligence 3, Wisdom 3,
Charisma 1; walk 30 if it has locomoting appendages, otherwise fly 30 and hover,
or speed 0 while securely attached; blindsight 30 and blind beyond; one melee
attack against a target within 5 ft; table-derived attack bonus and damage;
bludgeoning by default with contextual slashing/piercing adjudication. Object
shape classification is MA; attack and movement execution is F9.

Find Familiar records duration/range/origin/attack-modifier relationships for
sense sharing and spell delivery rather than only their action costs. Phantom
Steed records the created-equipment distance tether. Simulacrum records full-cast
target continuity, repair location/material/value prerequisites, zero-HP form,
dispel end behavior, and recast cleanup.

## 5. Source grounding and verification

Each `S1_SUMMONING_SPECS` entry owns:

- the immutable `effect` payload;
- exact source-clause assertions against the parsed spell description and
  higher-level text; and
- semantic bindings grouping every source-derived value or relationship under
  one or more clause IDs.

Projection fails if any asserted clause drifts or any binding names an unknown
clause. Tests prove exact 14-key membership, remove every bound source clause to
prove fail-closed behavior, assert exact committed payloads for all 14 records,
exercise transition reachability and profile-invalid state combinations, and
verify every nested creature/table reference resolves to the required kind.

## 6. Readiness

The compiler slice is complete when all immutable semantics above are emitted
and validated. Spells that declare F2/F3/F9/F10 remain engine-pending until those
runtime surfaces exist. This PR does not implement those surfaces and does not
promote live state into rules-pack data.
