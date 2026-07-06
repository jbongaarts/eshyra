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
  disappearsWhen: ('zero-hp' | 'spell-ends')[],   // non-empty
  onConcentrationBroken?: {                       // conjure-elemental / conjure-fey
    becomes: 'uncontrolled-hostile',
    dismissable: false,
    disappearsAfter: { amount: number, unit: 'hour' | 'minute' },
  },
  dismissal?: { cost: 'action',
                temporary?: { to: 'pocket-dimension',
                              recall: { cost: 'action', rangeFeet: number } } },
  modifications?: Modification[],                 // deltas against the source statblock
  riders?: string[],                              // verbatim residue (see §5)
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
- `onConcentrationBroken` only valid when the spell's structured duration
  has `concentration: true`.
- `reassert`/`window` require `commandEconomy`; `exclusiveInstance`
  forbids `window`.

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

Compound familiar/steed abilities stay verbatim `riders` in this slice:
find-familiar's touch-spell delivery, sense-sharing action, telepathy
100 ft; find-steed's mounted spell-sharing and telepathy 1 mi. Rationale:
each is a one-off multi-actor protocol; promoting them to typed contracts
is not justified by a single record each. The C3 `telepathy` contract MAY
later absorb the two telepathy riders — noted in C3's design space, not
required for S1 closure. `riders` non-empty strings, and a committed-pack
assertion pins the exact rider count per golden record so silent rider
growth fails the gate.

## 6. Golden examples for rollout

1. `conjure-animals` — option-menu (4 options) + multipliers {5:2,7:3,9:4},
   group initiative, verbal-no-action commands, treatedAs ['fey'].
2. `conjure-elemental` — cr-cap + perSlotAbove, onConcentrationBroken
   (1 hour), terrain-cube casting residue as rider.
3. `animate-dead` — corpse-animation (bones→skeleton, corpse→zombie),
   bonus-action commands ≤60 ft, window 24 h, reassert 4.
4. `animate-objects` — object-animation with sizeCosts + statTableRef,
   commands ≤500 ft; damage-carryover-on-revert rider.
5. `find-familiar` — form-list with creatureRefs, chooseOne type,
   cannot-attack modification, pocket-dimension dismissal,
   exclusiveInstance, 3 riders.
6. `simulacrum` — duplicate + modifications (half HP max, no equipment,
   no advancement), exclusiveInstance, repair-cost rider.

Remaining 8 after goldens: conjure-celestial, conjure-fey,
conjure-minor-elementals, conjure-woodland-beings, create-undead,
find-steed, giant-insect, phantom-steed — all instances of the six shapes
above (Codex).

Membership bookkeeping on completion: remove the 14 keys from
`ACCEPTED_METADATA_ONLY_SPELLS`, recount, negative tests per Appearance/
Control variant, committed-pack assertions per golden, pack regeneration
(S4 protocol).
