# Character Progression and Leveling (Design Note)

Status: design note for epic `eshyra-lupf` — _Add rules-pack-backed character
progression and leveling_. This note records the progression **model** and the
decisions that the implementation children depend on. It does not specify the
storage shape of the canonical character sheet (that is `eshyra-lupf.13`) nor
the resolver/engine internals (`eshyra-lupf.3`, `.8`); it fixes the contract
those issues build against.

This extends the landed guided character-creation model (`eshyra-b69j`): the
`CharacterDraft` engine, the `FinalizedCharacter` record, the
`RulesPackCharacterResolver`, the required-choice descriptor pattern, and the
deterministic derived-value seams. See `docs/character-creation.md`.

## Problem

Eshyra can create and finalize a level-1 SRD character, but there is no durable
progression model. The live `character` row carries `level` and HP, but there
is no experience ledger, no advancement policy, no level-up eligibility check,
and no guided level-up flow. Sessions therefore cannot accumulate advancement,
and any level change would be ad hoc and unauditable.

## Principles

Progression obeys the same canon discipline as the rest of game state
(`docs/game-state.md`): **the model never improvises mechanics.** Narration may
describe an award or a level-up, but the numbers — XP totals, eligibility, HP
gained, features granted, spell slots — are computed deterministically from the
rules pack and written through auditable state mutations. Anything the engine
cannot derive deterministically is surfaced as an explicit player choice or
**blocked**, never inferred.

## Rules-pack binding

Progression is bound to the campaign's rules binding
(`CampaignRulesBinding`: `base.systemId` / `base.packId` / `base.version`, plus
addons — see `packages/core/src/rules/binding.ts`) and to the character sheet's
own frozen provenance (`FinalizedCharacter` already carries `schemaVersion`,
`system`, and `rulesPackId`, where `rulesPackId` encodes the pack version, e.g.
`rules__dnd5e-srd-5.1`).

A character sheet is valid **only** under the rules system and pack that
produced it. Progression APIs must fail closed when the acting pack does not
match the sheet's `rulesPackId` / `system`. Cross-pack character conversion is a
future, explicit operation that generates a *new* sheet from old character
facts — it is not in-place mutation and not part of leveling. This is the
rules-pack-bound half of the authority decision in `eshyra-lupf.13`.

## Advancement policy: XP vs milestone

Each campaign selects one advancement mode, persisted alongside the rules
binding:

- **XP** — characters accrue experience points; crossing a level threshold
  makes them eligible to advance. Thresholds are read from canonical pack data:
  the frozen SRD pack ships a `table:character-advancement` record (the
  level → XP table). Thresholds are **resolved from that record**, never
  hardcoded or overlaid. (`eshyra-lupf.4`)
- **Milestone** — the DM grants advancement directly; there is no XP total and
  thresholds are not consulted. A milestone award sets eligibility for the next
  level.

The mode is a property of the campaign/rules binding, not of an individual
character, so a party advances under one policy.

## Progression state and the event ledger

Two pieces of durable state, owned by core (the store boundary itself is
`eshyra-lupf.13`):

1. **Progression state** on the character: current XP (XP mode only), current
   level, and any outstanding per-character advancement eligibility (e.g. a
   pending milestone). The effective advancement mode is resolved from the
   campaign/rules binding, not stored as independent character authority.
   Current level remains the authority used by the resolver and derived-value
   computation.
2. **A progression-event ledger**: an append-only, auditable record of every
   award and every applied level-up. Each row records, at minimum:
   - `kind` — `xp-award` | `milestone-award` | `level-up`
   - `amount` / `milestoneLabel` — the XP delta or the milestone description
   - `source` — who/what caused it (DM ruling, encounter, quest, manual)
   - `resultingXp` / `resultingLevel` — state after the event
   - `appliedChanges` — for a `level-up`, the deterministic change set applied
     (see below) for replay/audit
   - `occurredAt` — timestamp

The ledger is append-only: corrections are new compensating events, not edits.
This makes the full advancement history reconstructable and is the audit spine
the engine and CLI read from. (`eshyra-lupf.2`, `.6`)

## Eligibility

Eligibility is a pure, read-only computation over progression state and the
campaign policy (`eshyra-lupf.7`):

- **XP mode**: compare current XP against the resolved threshold table to find
  the highest level the character now qualifies for. If that exceeds current
  level, the character is eligible — possibly for **multiple** levels at once
  (catch-up); each level is applied as its own deterministic step.
- **Milestone mode**: eligibility is set by an outstanding milestone award.

Eligibility never mutates state and never applies a level-up; it drives prompts
and the guided flow.

## Deterministic level-up effects

A single level-up step is computed from the rules pack and applied as one
auditable change set (`eshyra-lupf.8`), reusing and generalizing the existing
level-1 derivation seams rather than introducing CLI-side math
(`deriveLevel1Values` is explicitly level-1 only; the resolver's
`ResolvedClassData.level1` / `parseLevel1` is generalized to arbitrary level
rows in `eshyra-lupf.3`).

**Supported deterministically** (applied without asking):

- **HP increase** — class hit die + Constitution modifier, per the
  rules-pack/recipe HP policy (fixed average vs rolled is settled by the recipe;
  a roll must flow through the seeded dice path so it stays auditable).
- **Class level** bump and **proficiency bonus** update from the progression
  row.
- **Class features** granted at the new level, by `ref`, as listed in the
  class's progression row.
- **Spellcasting capacity** where the class supports it: cantrip/spell-known
  counts and spell slots per spell level, from the progression row's
  `spellcasting` block. Specific spell/cantrip selections and preparation
  changes are required choices, not automatic effects (see below).

This flow is single-class by contract under
[ADR 0018](../adr/0018-single-class-engine-boundary.md): `sheet.level` is both
total character level and the level of the sole `sheet.class`, and every
level-up advances that class. Multiclass-shaped state or an attempt to choose a
different target class must fail before preview or apply; it is never flattened
into this flow.

## Required choices and the fail-closed boundary

Some level-ups require a player decision. These are surfaced as explicit
required-choice descriptors, reusing the creation-time "choices keyed by
generated descriptors" pattern (`requiredChoices.ts`), and resolved through the
guided flow (`eshyra-lupf.9`, `.10`):

- Ability Score Improvement vs feat
- Subclass selection at the class's subclass level
- New spells learned / known / prepared
- Expertise and similar class-specific picks

**Fail closed.** Where a granted level requires a choice the engine cannot yet
apply deterministically — most importantly specific cantrip/spell selections and
preparation changes — the level-up is **blocked with an explicit reason**, not
inferred or silently skipped. This deliberately diverges from the lenient
creation-time seam, where the draft engine's mechanical-choice gate covers only
skills/tools/equipment/languages and the wizard treats empty spell input as
finalizable. Leveling does not copy that leniency: an unsupported choice halts
the flow with a clear message rather than producing a wrong sheet.

## Flow and surfaces

- **Guided level-up flow** (`eshyra-lupf.10`): validates eligibility, collects
  required choices, previews the deterministic change set, and commits it via
  the auditable apply path. Mechanics are never model-improvised; narration is
  optional dressing.
- **CLI/session commands** (`eshyra-lupf.11`): view progression (current
  XP/level, mode, eligibility, recent ledger events) and start/apply a level-up,
  mirroring the existing `playCharacter` / `playParty` wiring.

## Out of scope for this note

- The canonical character-sheet storage shape and the live-table relationship
  (`eshyra-lupf.13`).
- Multiclassing, explicitly deferred behind ADR 0018's fail-closed
  single-class boundary; in-place rules-pack migration; and cross-pack
  conversion.
- Non-SRD or homebrew advancement rules.
