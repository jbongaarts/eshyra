# eshyra-o9bd.18.7.9 slice S1 — summoning/controlled-creature contract design

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.9`. Status: **implemented
2026-07-08** — the 14 spells now emit typed `summoning` effects. Source semantics: §2.1 of
`2026-07-06-o9bd-18-7-9-membership-classification.md`.

## 1. Why a new kind

The existing `summonCreature { creature, rangeFeet, target?,
maximumControlled? }` models a single fixed creature and stays for the
creature-trait uses it already serves. The 14 S1 spells need option menus,
control economies, loss-of-control transitions, and statblock
modifications; stretching `summonCreature` would break its existing
payloads. New kind: `summoning`. (Do not migrate `summonCreature` callers
in this slice.)

## 2. Payload schema

```ts
{
  kind: 'summoning',
  appears: Appearance,
  creatureType?: { treatedAs: string[],           // ['fey'] "considered fey"
                   chooseOne?: boolean },         // familiar/steed: celestial/fey/fiend, caster's choice
  control?: Control,                               // optional: omit where the source
                                                   // states no command/initiative rule
                                                   // (phantom-steed is a pure mount)
  lifecycle: Lifecycle[],                          // non-empty; see source-backed union below
  sourceRequirement?: { shape: 'cube',
                        sizeFeet: number,
                        materialOrTerrain: string[] }, // conjure-elemental 10-ft cube
  // Dismissal destination and recall economy are a discriminated pair, not two
  // free knobs: pocket-dimension ⟺ action recall (with range); dismissed ⟺
  // recast recall (no range). Impossible cross-combinations are rejected.
  dismissal?: { cost: 'action',
                temporary?: { to: 'pocket-dimension',
                              recall: { cost: 'action', rangeFeet: number } }
                           | { to: 'dismissed',
                              recall: { cost: 'recast' } },
                permanent?: { cost: 'action',
                              result: 'dismissed-forever' | 'bond-released' } },
  modifications?: Modification[],                 // deltas against the source statblock
  telepathy?: { rangeFeet: number },
  senseSharing?: { cost: 'action',
                   casterConditionWhileSharing: ('deaf'|'blind')[] },
  spellDelivery?: { spellRange: 'touch',
                    cost: 'reaction',
                    familiarWithinFeet?: number },
  spellSharing?: { when: 'caster-targets-only-self',
                   requiresMounted: true,
                   alsoAffects: 'steed' },
  repair?: { costGpPerHitPoint: number },
  travel?: { normalMilesPerHour: number, fastMilesPerHour: number },
  riders?: string[],                              // narrative residue only (see §5)
}

type Appearance =
  | { kind: 'option-menu',                        // conjure-animals/minor-elementals/woodland-beings
      options: { count: number, maxChallenge: string }[],   // '2','1','1/2','1/4'
      higherSlotMultipliers?: Record<number, number> }      // {5:2, 7:3, 9:4} — structured scaling
  | { kind: 'cr-cap', maxChallenge: string, ofTypes: string[],
      higherSlot?: { level: number, maxChallenge: string }  // conjure-celestial 9th → CR 5
      | { perSlotAbove: number, challengeIncrease: number } }  // conjure-elemental/fey
  | { kind: 'form-list',
      forms: { name: string, creatureRef?: string,          // 'creature:riding-horse'
               speedOverrides?: Record<string, number> }[] } // familiar, find-steed, phantom-steed
  | { kind: 'target-transformation',                        // giant-insect
      targets: { count: number, from: string, toRef: string }[] }
  | { kind: 'corpse-animation',                             // animate-dead, create-undead
      sources: { material: string, becomesRef: string, count?: number }[],  // bones→skeleton, corpse→zombie, corpse→ghoul
      targetEligibility?: { creatureType: string,           // creation gate: Medium/Small humanoid
                            sizes: string[] },
      baseCount?: number,                                   // animate-dead: one target at base slot
      distinctSourcePerCreature?: true,                     // animate-dead: each creature a different corpse/bones
      castingConstraint?: string,                           // create-undead: 'night-only'
      higherSlotScaling?: { perSlotAbove: number, additionalTargets: number },
      higherSlotOptions?: { level: number,
                            options: { material: string, becomesRef: string,
                                       count: number }[] }[] }
  | { kind: 'object-animation',                             // animate-objects
      maxObjects: number,
      sizeCosts: Record<string, number>,                    // {medium:2, large:4, huge:8}
      statTableRef: string,                                 // table:animated-object-statistics
      targetEligibility?: { nonmagical?: true,              // creation gate: nonmagical, unworn/uncarried,
                            notWornOrCarried?: true,        // no larger than Huge
                            maxSize?: string },
      higherSlotScaling?: { perSlotAbove: number, additionalTargets: number } }
  | { kind: 'duplicate', of: string }                       // simulacrum: 'beast-or-humanoid'

// A structured field must not force the importer to invent a rule the source
// doesn't state. mode/defaultBehavior/initiative are therefore all optional and
// emitted only where the SRD defines them; a control block that would be empty
// is omitted entirely (phantom-steed). At least one field is required when
// control is present.
type Control = {
  mode?: 'obedient' | 'friendly-commanded' | 'independent-obedient',
  commandEconomy?: { cost: 'bonus-action' | 'verbal-no-action' | 'on-your-turn',
                     rangeFeet?: number },       // animate-dead 60, create-undead 120, animate-objects 500
  alignmentLimited?: boolean,                    // celestial/fey refuse violating commands
  defaultBehavior?: 'defends-only' | 'defends-otherwise-idle' | 'follows-caster-wishes',
  initiative?: 'own-turn' | 'group' | 'acts-on-casters-turn',
  window?: { amount: number, unit: 'hour' },     // 24 h control window
  reassert?: { maxCreatures: number,             // recast reasserts ≤N
               higherSlotScaling?: { perSlotAbove: number, additionalTargets: number },
               higherSlotOptions?: { level: number,
                                     options: { material: string, becomesRef: string,
                                                count: number }[] }[] },
  exclusiveInstance?: boolean,                   // familiar/steed/simulacrum one-at-a-time
}

type Lifecycle =
  | { event: 'spell-ends' | 'zero-hit-points',
      result: 'summoned-creature-disappears' }   // find-familiar and concentration summons
  | { event: 'spell-ends',
      result: 'animated-object-reverts' }        // animate-objects duration end
  | { event: 'zero-hit-points',
      result: 'animated-object-reverts',
      damageCarriesOver: true }                  // animate-objects damage carryover
  | { event: 'control-window-expires',
      result: 'animated-creature-persists-uncontrolled',
      window: { amount: 24, unit: 'hour' },
      reassertableByRecast: { maxCreatures: number,
                              higherSlotScaling?: { perSlotAbove: number, additionalTargets: number },
                              higherSlotOptions?: { level: number,
                                                    options: { material: string, becomesRef: string,
                                                               count: number }[] }[] } } // animate-dead/create-undead
  | { event: 'concentration-broken',
      result: 'uncontrolled-hostile',
      dismissable: false,
      disappearsAfter: { amount: number, unit: 'hour' | 'minute' } } // conjure-elemental/fey
  | { event: 'damage-taken' | 'spell-ends',
      result: 'effect-fades',
      transition: { amount: 1, unit: 'minute' } } // phantom-steed
  | { event: 'zero-hit-points',
      result: 'duplicate-destroyed' }            // simulacrum melts
  | { event: 'spell-ends' | 'zero-hit-points',
      result: 'transformed-target-reverts' }     // giant-insect: each target reverts
                                                 // to its natural form; NO damage
                                                 // carryover claim (source states none —
                                                 // do not import polymorph semantics)
  | { event: 'action-dismissal',
      result: 'summoned-creature-disappears' }   // find-steed action dismissal
  | { event: 'action-release',
      result: 'bond-ends-creature-disappears' }  // find-steed bond release
  // Recast semantics under exclusiveInstance are per-spell and source-backed —
  // deliberately NOT a shared generic rule. Each is state-sensitive: `priorState`
  // ('active' | 'gone') says whether the persistent actor still existed when the
  // spell was recast, and recast entries in one record must have distinct
  // priorStates. Find-familiar carries BOTH transitions (source defines two):
  | { event: 'recast', priorState: 'active',
      result: 'existing-familiar-adopts-new-form' } // find-familiar: recasting while you
                                                 // have a familiar causes it to adopt a
                                                 // new form — nothing is destroyed
  | { event: 'recast', priorState: 'gone',
      result: 'familiar-reappears' }             // find-familiar: recasting after the
                                                 // familiar dropped to 0 HP re-summons it
  | { event: 'recast', priorState: 'gone',
      result: 'same-steed-returns-restored' }    // find-steed: casting again after the
                                                 // steed disappeared (0 HP or dismissed)
                                                 // summons the SAME steed, restored to its
                                                 // HP maximum — persistent identity
  | { event: 'recast', priorState: 'active',
      result: 'prior-duplicates-instantly-destroyed' } // simulacrum only: active
                                                 // duplicates are instantly destroyed

type Modification =
  | { attribute: 'hit-point-maximum', value: 'half-of-original' }        // simulacrum
  | { attribute: 'speed', mode: string, value: number }                  // phantom steed 100
  | { attribute: 'intelligence-floor', value: number, grantsLanguage?: 1 } // find-steed Int 6
  | { attribute: 'no-equipment' }                                        // simulacrum
  | { attribute: 'cannot-attack' }                                       // find-familiar
  | { attribute: 'no-advancement-or-slot-recovery' }                     // simulacrum
```

`scaling.sourceText` remains on every spell verbatim; where the scaling is
menu-shaped it is ALSO structured in `appears`
(`higherSlotMultipliers`/`higherSlot`) — same both-representations policy
as statline `sourceText`.

## 3. Validation rules (kindSchemas)

- Discriminated unions exactly as above; unknown fields rejected per kind
  (marker-only discipline). `options`, `forms`, `sources`, `targets`
  non-empty; counts/ranges positive integers; `maxChallenge` from the CR
  token set (`0`,`1/8`,`1/4`,`1/2`,`1`..`30`).
- `creatureRef`/`toRef`/`becomesRef` must be `creature:*` refs; ref
  integrity against the pack is a committed-pack test (schema cannot see
  siblings). `statTableRef` must be a `table:*` ref present in the
  record's `tableRefs`.
- `lifecycle.event = 'concentration-broken'` only valid when the spell's
  structured duration has `concentration: true`.
- `reassert`/`window` require `commandEconomy`; `exclusiveInstance`
  forbids `window`.
- `lifecycle` non-empty. `animated-creature-persists-uncontrolled` requires
  `control.window`; `reassertableByRecast.maxCreatures` must match the
  spell's recast-control clause. `summoned-creature-disappears` is not valid
  for `corpse-animation`, because animate-dead/create-undead creatures
  persist when control expires.
- `sourceRequirement`, `telepathy`, `senseSharing`, `spellDelivery`,
  `spellSharing`, `repair`, and `travel` are typed deterministic protocols, not
  riders. Range/cost/size fields are positive integers / closed enums.
  Appearance and reassert-control scaling fields are likewise typed:
  spell-level keys/levels are positive integers, multipliers are positive
  integers, and corpse-animation higher-slot options must use concrete
  corpse-to-creature/count entries. `cr-cap.higherSlot` is an exact alternate
  union: fixed-level cap or per-slot challenge increase, never a hybrid.
- `appears.kind = 'target-transformation'` requires a
  `transformed-target-reverts` lifecycle entry and forbids
  `summoned-creature-disappears` and `animated-object-reverts` (the
  transformed creatures are pre-existing targets, not summons or objects).
  `transformed-target-reverts` carries no `damageCarriesOver` field.
- `control.exclusiveInstance: true` requires at least one `recast` lifecycle
  entry (find-familiar carries two — see below), and the four recast results are
  spell-specific: schema-level the union admits all four, but committed-pack
  assertions pin `existing-familiar-adopts-new-form` + `familiar-reappears` to
  find-familiar, `same-steed-returns-restored` to find-steed, and
  `prior-duplicates-instantly-destroyed` to simulacrum. A `recast` lifecycle
  entry is invalid without `exclusiveInstance: true`.
- Every `recast` entry carries a required `priorState` ('active' | 'gone') that
  the result implies (`existing-familiar-adopts-new-form` and
  `prior-duplicates-instantly-destroyed` ⇒ 'active';
  `familiar-reappears`/`same-steed-returns-restored` ⇒ 'gone'), and the recast
  entries within one record must have distinct `priorState` values. This makes
  Find Familiar's two source-defined recast transitions (re-form an active
  familiar; re-summon one that dropped to 0 HP) both expressible.
- `control` is optional; when present it must declare at least one field.
  `mode`, `defaultBehavior`, and `initiative` are each optional and emitted only
  where the SRD states them, so the schema never forces an invented rule.
- `corpse-animation.targetEligibility` (creature type + SRD sizes),
  `baseCount`, and `distinctSourcePerCreature`, and
  `object-animation.targetEligibility` (nonmagical / not-worn-or-carried /
  maxSize) are typed creation gates — they decide whether a cast is legal and
  how many valid targets exist, so they are structured, not narrative residue.
- `dismissal.temporary` is a discriminated pair: `to: 'pocket-dimension'`
  requires an `action` recall with `rangeFeet`; `to: 'dismissed'` requires a
  `recast` recall and forbids `rangeFeet`.

## 4. Runtime integration boundaries

- Pack carries data; live summon instances (current HP, control clock,
  uncontrolled state) are session state owned by encounter tools
  (`start_encounter`/`update_combatant`), not the pack.
- The 24 h control window and concentration-break transitions are timers:
  integration point is the clock tool + turn loop, tracked as engine
  procedures (18.7.8.3 inventory), not spell payload behavior.
- XP for summoned creatures (rule:challenge-experience-points) reads the
  referenced statblock; no payload field needed.

## 5. Riders policy (explicit, bounded)

`riders` are allowed only for genuinely narrative or source-location
residue that does not affect deterministic execution. They must not hide
eligibility gates, action/reaction economy, ranges, lifecycle transitions,
exclusive-instance limits, telepathy, sense sharing, touch-spell delivery,
mounted spell sharing, repair costs, or retained/lost capabilities.
`riders` non-empty strings, and committed-pack assertions pin the exact
rider count per golden record so silent rider growth fails the gate.

## 6. Golden examples for rollout

1. `conjure-animals` — option-menu (4 options) + multipliers {5:2,7:3,9:4},
   group initiative, verbal-no-action commands, treatedAs ['fey'].
2. `conjure-elemental` — cr-cap + perSlotAbove, 10-ft source cube
   requirement, concentration-broken lifecycle to uncontrolled hostile for
   1 hour.
3. `animate-dead` — corpse-animation (bones→skeleton, corpse→zombie),
   higher-slot +2 targets per slot above 3rd, bonus-action commands ≤60 ft,
   lifecycle control-window expiry to uncontrolled persistent undead,
   reassert 4 with the same higher-slot +2 scaling.
4. `animate-objects` — object-animation with sizeCosts + statTableRef,
   higher-slot +2 targets per slot above 5th, commands ≤500 ft; lifecycle
   spell-end reversion plus zero-HP reversion with damage carryover.
5. `find-familiar` — form-list with creatureRefs, chooseOne type,
   cannot-attack modification, pocket-dimension dismissal, permanent dismissal,
   exclusiveInstance, control with no defaultBehavior (source states none), and
   BOTH source-defined recast transitions: recast while active →
   existing-familiar-adopts-new-form (nothing destroyed), recast after 0 HP →
   familiar-reappears. Zero-HP disappearance, typed telepathy 100 ft,
   sense-sharing action, and touch-spell delivery via reaction with the
   100-foot familiar-distance requirement.
6. `simulacrum` — duplicate + modifications (half HP max, no equipment,
   no advancement), exclusiveInstance, recast →
   prior-duplicates-instantly-destroyed, zero-HP duplicate destruction,
   acts on the caster's turn according to the caster's wishes, repair
   100 gp/HP.
7. `giant-insect` — target-transformation + transformed-target-reverts
   lifecycle (spell end / 0 HP → natural form, no carryover), commands on
   caster's turn, per-target dismissal.

Remaining 7 after goldens: conjure-celestial, conjure-fey,
conjure-minor-elementals, conjure-woodland-beings, create-undead,
find-steed, phantom-steed — all instances of the golden shapes above
(Codex). find-steed must use recast (priorState 'gone') →
same-steed-returns-restored (the steed has persistent identity across castings —
represent it as the same persistent actor, restored to HP maximum, never as a
new instance), plus action dismissal and action bond release; its control block
carries only exclusiveInstance because the source states no obedience,
default-behavior, or initiative rule for the steed itself. create-undead must
carry its higher-slot ghast/wight/mummy count options for both creation and
reassertion plus its Medium/Small humanoid target eligibility, and phantom-steed
carries its 10 mph normal / 13 mph fast travel rates and NO control block (it
defines a rideable mount, not a commanded creature).

Membership bookkeeping completed 2026-07-08: removed the 14 keys from
`ACCEPTED_METADATA_ONLY_SPELLS` (34 -> 20), added negative tests for
representative Appearance/Control/Lifecycle variants, added committed-pack
assertions per golden shape, and regenerated the pack through the importer.
