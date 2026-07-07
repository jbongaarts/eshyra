# eshyra-o9bd.18.7.9 slice S1 — summoning/controlled-creature contract design

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.9`. Status: **design** — rollout
of the 14 spells is Codex work after review. Source semantics: §2.1 of
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
  control: Control,
  lifecycle: Lifecycle[],                          // non-empty; see source-backed union below
  sourceRequirement?: { shape: 'cube',
                        sizeFeet: number,
                        materialOrTerrain: string[] }, // conjure-elemental 10-ft cube
  dismissal?: { cost: 'action',
                temporary?: { to: 'pocket-dimension',
                              recall: { cost: 'action', rangeFeet: number } } },
  modifications?: Modification[],                 // deltas against the source statblock
  telepathy?: { rangeFeet: number },
  senseSharing?: { cost: 'action',
                   casterConditionWhileSharing: ('deaf'|'blind')[] },
  spellDelivery?: { spellRange: 'touch', cost: 'reaction' },
  spellSharing?: { when: 'caster-targets-only-self',
                   requiresMounted: true,
                   alsoAffects: 'steed' },
  repair?: { costGpPerHitPoint: number },
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
      sources: { material: string, becomesRef: string }[],  // bones→skeleton, corpse→zombie, corpse→ghoul
      castingConstraint?: string }                          // create-undead: 'night-only'
  | { kind: 'object-animation',                             // animate-objects
      maxObjects: number,
      sizeCosts: Record<string, number>,                    // {medium:2, large:4, huge:8}
      statTableRef: string }                                // table:animated-object-statistics
  | { kind: 'duplicate', of: string }                       // simulacrum: 'beast-or-humanoid'

type Control = {
  mode: 'obedient' | 'friendly-commanded' | 'independent-obedient',
  commandEconomy?: { cost: 'bonus-action' | 'verbal-no-action' | 'on-your-turn',
                     rangeFeet?: number },       // animate-dead 60, create-undead 120, animate-objects 500
  alignmentLimited?: boolean,                    // celestial/fey refuse violating commands
  defaultBehavior: 'defends-only' | 'defends-otherwise-idle',
  initiative: 'own-turn' | 'group' | 'acts-on-casters-turn',
  window?: { amount: number, unit: 'hour' },     // 24 h control window
  reassert?: { maxCreatures: number },           // recast reasserts ≤N
  exclusiveInstance?: boolean,                   // familiar/steed/simulacrum one-at-a-time
}

type Lifecycle =
  | { event: 'spell-ends' | 'zero-hit-points',
      result: 'summoned-creature-disappears' }   // find-familiar and concentration summons
  | { event: 'spell-ends',
      result: 'animated-object-reverts',
      damageCarriesOver: true }                  // animate-objects
  | { event: 'control-window-expires',
      result: 'animated-creature-persists-uncontrolled',
      window: { amount: 24, unit: 'hour' },
      reassertableByRecast: { maxCreatures: number } } // animate-dead/create-undead
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
  // Recast semantics under exclusiveInstance are per-spell and source-backed —
  // deliberately NOT a shared generic rule:
  | { event: 'recast',
      result: 'existing-familiar-adopts-new-form' } // find-familiar: recasting while you
                                                 // have a familiar causes it to adopt a
                                                 // new form — nothing is destroyed
  | { event: 'recast',
      result: 'same-steed-returns-restored' }    // find-steed: casting again after the
                                                 // steed disappeared summons the SAME
                                                 // steed, restored to its HP maximum —
                                                 // persistent identity, not replacement
  | { event: 'recast',
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
  `spellSharing`, and `repair` are typed deterministic protocols, not
  riders. Range/cost/size fields are positive integers / closed enums.
- `appears.kind = 'target-transformation'` requires a
  `transformed-target-reverts` lifecycle entry and forbids
  `summoned-creature-disappears` and `animated-object-reverts` (the
  transformed creatures are pre-existing targets, not summons or objects).
  `transformed-target-reverts` carries no `damageCarriesOver` field.
- `control.exclusiveInstance: true` requires exactly one `recast` lifecycle
  entry, and the three recast results are spell-specific: schema-level the
  union admits all three, but committed-pack assertions pin
  `existing-familiar-adopts-new-form` to find-familiar,
  `same-steed-returns-restored` to find-steed, and
  `prior-duplicates-instantly-destroyed` to simulacrum. A `recast` lifecycle
  entry is invalid without `exclusiveInstance: true`.

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
   bonus-action commands ≤60 ft, lifecycle control-window expiry to
   uncontrolled persistent undead, reassert 4.
4. `animate-objects` — object-animation with sizeCosts + statTableRef,
   commands ≤500 ft; lifecycle spell-end reversion with damage carryover.
5. `find-familiar` — form-list with creatureRefs, chooseOne type,
   cannot-attack modification, pocket-dimension dismissal,
   exclusiveInstance, recast → existing-familiar-adopts-new-form (the
   familiar is never destroyed by recasting), zero-HP disappearance, typed
   telepathy 100 ft, sense-sharing action, and touch-spell delivery via
   reaction.
6. `simulacrum` — duplicate + modifications (half HP max, no equipment,
   no advancement), exclusiveInstance, recast →
   prior-duplicates-instantly-destroyed, zero-HP duplicate destruction,
   repair 100 gp/HP.
7. `giant-insect` — target-transformation + transformed-target-reverts
   lifecycle (spell end / 0 HP → natural form, no carryover), commands on
   caster's turn, per-target dismissal.

Remaining 7 after goldens: conjure-celestial, conjure-fey,
conjure-minor-elementals, conjure-woodland-beings, create-undead,
find-steed, phantom-steed — all instances of the golden shapes above
(Codex). find-steed must use recast → same-steed-returns-restored (the
steed has persistent identity across castings — represent it as the same
persistent actor, restored to HP maximum, never as a new instance).

Membership bookkeeping on completion: remove the 14 keys from
`ACCEPTED_METADATA_ONLY_SPELLS`, recount, negative tests per Appearance/
Control variant, committed-pack assertions per golden, pack regeneration
(S4 protocol).
