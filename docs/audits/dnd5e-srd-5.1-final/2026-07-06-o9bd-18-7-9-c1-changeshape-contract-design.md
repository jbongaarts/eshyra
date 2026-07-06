# eshyra-o9bd.18.7.9 slice C1 — `changeShape` contract design

Date: 2026-07-06. Bead: `eshyra-o9bd.18.7.9`. Status: **design** — rollout
of the 22 refs is Codex work after review. Source semantics: §1.1 of
`2026-07-06-o9bd-18-7-9-membership-classification.md` (every per-record
clause is already inventoried there; this document only designs the shape).

## 1. Corpus shape

The 22 refs fall into exactly two statistics grammars and five form-
constraint shapes. Cross-checked against the already-typed
`creature:vampire#traits:Shapechanger` and `Misty Escape` for vocabulary
compatibility (they add conditional gates — "isn't in sunlight or running
water" — which this contract carries as `conditions`).

Statistics grammars:

- **retain-listed** — "retains X; statistics otherwise replaced by the new
  form" (8 dragons), with the couatl/deva variant "retains game statistics;
  listed attributes replaced; gains missing capabilities".
- **same-except** — "statistics are the same in each form, except listed
  deltas" (night-hag, oni, doppelganger, imp, quasit, mimic,
  succubus-incubus, 5 lycanthropes).

Form-constraint shapes: CR-capped category (dragons, couatl, deva);
size/type descriptor with optional qualifiers (night-hag "female",
doppelganger "it has seen", oni's two-descriptor menu); fixed named forms
with printed speed overrides (imp, quasit); object form (mimic); named
alternate forms whose AC/speed deltas are **already structured in the
statline** (`speedVariants` / AC `variants`, PR #394) for the 5
lycanthropes — the contract references those rather than duplicating them.

## 2. Payload schema

New `mechanics.effects` kind `changeShape` (kindSchemas.ts):

```ts
{
  kind: 'changeShape',
  cost: 'action',                       // reqEnum; all 22 print an action
  conditions?: string[],                // e.g. vampire's sunlight/running-water gate; absent for all 22 current refs
  forms: Form[],                        // non-empty; 'true-form' implied, not listed
  statistics:
    | { model: 'retain-listed', retains: string[],
        gainsMissingCapabilities?: boolean,   // couatl/deva
        replaces?: string[] }                 // couatl/deva explicit list
    | { model: 'same-except', except?: ('size'|'ac'|'speed')[] },
  equipment:
    | { disposition: 'absorbed-or-borne' }     // dragons, couatl, deva (chooser: self)
    | { disposition: 'not-transformed' }
    | { disposition: 'specific',
        items: { name: string, behavior: 'transforms-with-form',
                 revertsOnDeath: true }[] },   // oni glaive
  reversion: { on: ['death'] },               // closed enum today; extensible
  excludedCapabilities?:
    ('class-features'|'legendary-actions'|'lair-actions')[],
  retainedCapabilities?: RetainedCapability[],
  speedConditions?: SpeedCondition[],
  riders?: string[],                    // narrative residue only; not deterministic clauses
}

type Form =
  | { kind: 'category', types: string[],          // ['humanoid','beast']
      maxChallenge: 'own' }                       // only value printed in SRD
  | { kind: 'descriptor', sizes: ('small'|'medium'|'large')[],
      type: string, qualifiers?: string[] }       // 'female', 'it has seen', 'giant'
  | { kind: 'fixed', name: string,
      speedOverrides?: Record<string, number> }   // imp rat {walk:20}, raven {walk:20, fly:60}…
  | { kind: 'object' }                            // mimic
  | { kind: 'statline-variant', variant: string } // lycanthropes: names the structured statline speed/AC variant

type RetainedCapability =
  | { name: 'bite', whenFormHas: { anatomy: 'jaws' } } // couatl conditional Bite retention

type SpeedCondition =
  | { mode: 'fly', lostUnlessFormHas: { anatomy: 'wings' } } // succubus/incubus
```

## 3. Validation rules (kindSchemas)

- `forms` non-empty; each form discriminated on `kind` with the exact
  required fields above and no extras (marker-only discipline as existing
  kinds).
- `statistics.model = 'retain-listed'` requires non-empty `retains`;
  `replaces`/`gainsMissingCapabilities` allowed only on that model.
- `equipment.disposition = 'specific'` requires non-empty `items`.
- `speedOverrides` values positive integers; keys from the structured
  speed-mode vocabulary (walk/fly/climb/swim/burrow).
- `statline-variant` is valid only on creatures whose statline actually
  carries `speedVariants`/AC `variants` — enforced by a committed-pack
  test, not the schema (schema can't see siblings).
- `excludedCapabilities`, `retainedCapabilities`, `speedConditions`, and
  `riders` are non-empty when present. `riders` must not carry
  deterministic eligibility gates, retained/lost capabilities, speed
  changes, or action economy.

## 4. Runtime integration boundaries

- Projection only: the importer derives `changeShape` from the entry
  grammar fail-closed (unrecognized retain/except clause → no effect →
  entry lands in the membership gate and fails the build until reviewed).
- Interacts with `rule:legendary-creatures` (assumed forms never gain
  legendary/lair/regional — an engine-procedure rule, coverage tracked in
  18.7.8.3) and `rule:truesight` (perceives original form). The contract
  carries data; those procedures own behavior.
- Transformation *state* at play time (current form, reverting) is
  live-state territory (DM model + tools), out of scope for the pack.

## 5. Golden examples for rollout (representative, one per variant)

1. `adult-bronze-dragon#actions:Change Shape` — category form, retain-listed
   (8-item retains list incl. Legendary Resistance + "this action"),
   absorbed-or-borne, excludedCapabilities [class-features,
   legendary-actions].
2. `couatl#actions:Change Shape` — retain-listed variant with `replaces` +
   `gainsMissingCapabilities` + typed conditional Bite retention; excluded
   adds lair-actions.
3. `oni#actions:Change Shape` — two descriptor forms, same-except [size],
   equipment 'specific' (glaive).
4. `imp#traits:Shapechanger` — fixed forms with speedOverrides,
   same-except [], not-transformed.
5. `werebear#traits:Shapechanger` — statline-variant forms, same-except
   [size, ac], not-transformed.

Dragon rollout after example 1 is 7 verbatim-identical grammars (Codex).
Remaining: deva (as couatl minus Bite retention, replaces senses),
night-hag, doppelganger, quasit, mimic (object form), succubus/incubus
(typed wing-dependent fly-speed loss), wereboar/wererat/weretiger/werewolf.

Membership bookkeeping on completion: remove all 22 refs from
`ACCEPTED_PROSE_CREATURE_ENTRY_REFS` (the 8 `mechanical-prose` +
14 `narrative-prose` shape rows), recount, extend
`kindSchemasEffects.test.ts` negative cases, committed-pack assertions per
golden example, pack regeneration (S4 protocol).
