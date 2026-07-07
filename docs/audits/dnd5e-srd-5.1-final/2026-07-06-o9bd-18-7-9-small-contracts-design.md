# eshyra-o9bd.18.7.9 slices C2/C3/S2/S3 — small-contract payload designs

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.9`. Status: **design**. With the
C1 and S1 designs, this completes the contract-design surface for every
remaining slice: rollout is now fully Codex-executable from the
classification artifact plus these shapes. Memberships per slice: artifact
§3 reconciliation (corrected 2026-07-06).

## C2 — `falseAppearance` (16 refs)

```ts
{ kind: 'falseAppearance',
  while: string,                 // 'motionless' (+ 'without its underside exposed', "and isn't flying")
  indistinguishableFrom: string }  // 'a normal suit of armor', …
```

Both fields required non-empty. No DC — the rule is an unconditional
indistinguishability state; discovery is DM adjudication (contrast
`illusoryDisguise`/`mimicry`, which carry `discernDc`). Golden:
`animated-armor`; the other 15 are grammar-identical.

## C3 — communication/knowledge/state contracts (10 creature refs + 2 spells)

Implemented 2026-07-07. The rollout included the original 8 creature refs plus
the folded aboleth Probing Telepathy and ettin Wakeful refs from the
classification artifact's residual reconciliation.

```ts
{ kind: 'telepathy',
  rangeFeet?: number,            // absent = unlimited (telepathic-bond: any distance)
  samePlaneOnly?: boolean,       // homunculus, telepathic-bond (blocked cross-plane)
  oneWay?: boolean,              // otyugh (receiver cannot respond)
  requiresLanguage?: boolean,    // target must understand ≥1 language
  audience?: string,             // 'sharks' (sahuagin), 'master' (homunculus)
  commands?: boolean,            // sahuagin: command, not converse
  maxCreatures?: number,         // telepathic-bond 8
  willingOnly?: boolean,         // telepathic-bond
  minIntelligence?: number }     // telepathic-bond 3

{ kind: 'communication',
  with: string[] }               // ['beasts','plants'] dryad; ['beasts'] speak-with-animals

{ kind: 'locationKnowledge',
  knows: ('direction'|'distance'|'location')[],
  of: string,                    // 'designated quarry' | 'summoner'
  condition?: string }           // 'same plane of existence'

{ kind: 'pathMemory',
  scope: 'any-previously-traveled-path',
  recall: 'perfect' }             // minotaur Labyrinthine Recall

{ kind: 'sleepException',
  detail: string }               // hydra: 'at least one head is awake while sleeping'
```

Validation: `telepathy` fields all optional but at least one of
`rangeFeet`/`audience`/`maxCreatures` present (empty payload rejected);
`communication.with` non-empty; `locationKnowledge.knows` non-empty.
Use `pathMemory`, not `locationKnowledge`, for navigation/path-recall
semantics where no target entity location is being tracked.
Global telepathy semantics (initiation, incapacitation, antimagic) live in
`rule:telepathy` (engine procedure, 18.7.8.3) — payloads carry only the
per-record boundaries. Goldens: otyugh (oneWay), invisible-stalker (two
`locationKnowledge` effects: quarry + summoner), minotaur (`pathMemory`),
`spell:telepathic-bond`.

## S2 — small deterministic clause payloads (17 spells)

Existing sub-family shapes (artifact §2.2/2.4/2.5):

```ts
{ kind: 'percentChance', percent: number, per: string, cumulative?: boolean,
  trigger: string, resetOn?: 'long-rest', effect: string, secret?: boolean }
// augury/commune/divination: 25 %/extra casting, cumulative, reset long rest, secret
// sending: 5 % flat, per 'casting', trigger 'target on another plane'
// secret-chest: 5 %/day, cumulative, trigger 'after 60 days', effect 'spell ends'

{ kind: 'createsProvisions',
  food?: { pounds: number, spoilsAfterHours: number },
  water?: { gallons: number },
  sustains?: { humanoids: number, steeds: number, hours: number } }
// create-food-and-water; create-or-destroy-water uses water + destroy mode:
{ kind: 'createsOrDestroysWater',
  gallons: number, areaAlternative?: string, destroyAlternative?: string }

{ kind: 'conjuredUtilityObject',
  capacityPounds?: number,        // mage-hand 10, floating-disk 500
  leashFeet?: number,             // hand 30; disk follow-within 20
  endsBeyondFeet?: number,        // disk 100
  moveFeetPerUse?: number,        // hand 30
  restrictions?: string[] }       // "can't attack/activate magic items", "can't cross ≥10 ft elevation change"
```

Reclassified-clause payloads (artifact §2.8):

```ts
{ kind: 'onsetTime', roll: string, multiplierMinutes: number }   // control-weather 1d4 × 10
{ kind: 'stagedTableShift', tableRefs: string[], stepsPerChange: 1 } // control-weather
{ kind: 'messengerTravel', ratesMilesPer24h: { flying: 50, other: 25 }, maxWords: 25, lostIfUndelivered: true } // animal-messenger
{ kind: 'communicationBarriers',
  magicalSilenceBlocks: true,
  noStraightLineRequired?: boolean,
  materials: {
    material: 'stone'|'common-metal'|'lead'|'wood',
    thickness?: { amount: number, unit: 'foot'|'inch' },
    threshold: 'blocks-at-or-above'|'any-thin-sheet'
  }[] } // message: 1 ft stone, 1 in common metal, thin lead sheet, 3 ft wood
{ kind: 'terrainAlteration', canCreate: ['difficult-terrain'], canRemove: ['difficult-terrain'] } // mirage-arcane
{ kind: 'recastLockout', scope: 'per-target', days: number }     // speak-with-dead 10
{ kind: 'questionLimit', maxQuestions: number }                  // commune 3, speak-with-dead 5
{ kind: 'corpseEligibility',
  target: 'corpse',
  requiresMouth?: boolean,
  excludesUndead?: boolean }                                     // speak-with-dead
{ kind: 'concurrentEffectLimit', max: 3, dismissCost: 'action' } // prestidigitation, thaumaturgy
{ kind: 'permanenceAfterRepetition', period: 'day', count: number, result: 'until-dispelled' | 'permanent' }
// arcanists-magic-aura {count:30}; private-sanctum {count:365, result:'permanent'} (S3 record, shared payload)
```

Question caps and creature/corpse eligibility are deterministic when they
limit executable behavior. `commune` uses `questionLimit { maxQuestions: 3 }`;
`speak-with-dead` uses `recastLockout`, `questionLimit { maxQuestions: 5 }`,
and `corpseEligibility { target: 'corpse', requiresMouth: true,
excludesUndead: true }`. Augury's omen menu remains prose because it is the
GM-narrated result rather than a state gate.

## S3 — ward/trigger & spatial boundaries (8 spells)

- `alarm`, `magic-mouth`: reuse `triggeredEffect { trigger, result }`
  verbatim (first pass; no new kind).
- `contingency`: `spellStoring { maximumSpellLevel: 5, capacity: 1,
  castingTime: '1-action', target: 'self' }` + `triggeredEffect` +
  `{ kind: 'exclusiveInstance', maxActive: 1, replacement: 'previous-ends' }`
  + `{ kind: 'componentPresenceTermination',
       component: 'ivory-statuette-of-self',
       location: 'on-your-person' }`. These are deterministic limits, not
  riders.
- `private-sanctum`, `tiny-hut`:
  ```ts
  { kind: 'wardedArea',
    blocks: ('sound'|'vision'|'divination-sensors'|'divination-targeting'|
             'teleportation'|'planar-travel'|'spell-effects'|'objects'|'creatures')[],
    chooseProperties?: boolean,       // private-sanctum menu
    occupantLimit?: { count: 9, maxSize: 'medium' },  // tiny-hut
    castingTimeOccupantsExempt?: boolean }
  ```
  plus `permanenceAfterRepetition` on private-sanctum (S2 shape).
- `gate`: existing `planeShift` payload + `{ kind: 'portal', diameterFeetMin: 5,
  diameterFeetMax: 20, frontOnly: true }`; named-creature draw stays prose.
- `demiplane`: `{ kind: 'extradimensionalSpace', dimensionsFeet: 30,
  onEnd: 'occupants-trapped', reconnect?: 'previous-or-known' }`.
- `passwall`: `{ kind: 'passage', maxWidthFeet: 5, maxHeightFeet: 8,
  maxDepthFeet: 20, onEnd: 'safe-ejection' }`.

Ward `blocks: ['teleportation','planar-travel']` interacts with the
modeled `teleport`/`planeShift` kinds — runtime enforcement is engine
territory; the payload is data only (same boundary as C1/S1).

## Rollout notes

Every new kind: add to `MECHANICS_EFFECT_KINDS`, a validator with the
non-empty/enum rules above, negative tests in `kindSchemasEffects.test.ts`,
committed-pack assertions for at least one golden per kind, membership
removals + recount per S4. Kind names are proposals — Codex should keep
them unless a collision with existing vocabulary appears.
