# ADR 0011: Core-owned, Rules-pack-bound Canonical Character Sheet

- **Status:** Accepted
- **Date:** 2026-06-27
- **Bead:** eshyra-lupf.13

## Context

Eshyra can create and finalize a level-1 character, but the character's durable
data is split across two stores that disagree on richness and authority, and
nothing owns the long-term "character sheet."

**The live `character` table** (`packages/core/data/migrations/0001_initial.sql`)
is the per-turn canonical store for mutable campaign facts (see
`docs/game-state.md`). It is intentionally sparse:

```
character(id, name, ancestry, class_name, level, hp_current, hp_max,
          ability_scores_json, conditions_json, role, provenance,
          session_id, updated_at)
```

This is exactly what the per-turn hot path needs for prompt context and fast
mutation, and nothing more.

**The `FinalizedCharacter` record** (`packages/core/src/character/finalizeCharacter.ts`)
is much richer: `schemaVersion`, `system`, `rulesPackId`, `recipeId`,
`creationMode`, frozen class/ancestry/background refs, base/final ability
scores, proficiency bonus, max HP, saving throws, spell DC/attack,
proficiencies, equipment, languages, spells, and metadata. But its **type** lives
in core while its **persistence** is CLI-side: `createFileFinalizedCharacterStore`
writes JSON files under the CLI data root (wired in `packages/cli/src/index.ts`).

Leveling (epic `eshyra-lupf`) needs a single authoritative record for class
refs, rules-pack provenance, progression events, proficiencies, equipment,
languages, spells, HP, ability scores, and derived values. It cannot be built on
a character sheet whose only rich persistence lives in `packages/cli`: the
product targets a swappable CLI/web/app UX over a UI-agnostic core
(`docs/architecture-report.md`, ADR 0001), so a future web or app UX would have
no authoritative sheet to read. See `docs/design/character-progression.md` for
the progression model this decision unblocks.

## Decision

### 1. The canonical character sheet is core-owned

The authoritative character sheet lives behind a core-owned model and
persistence/API boundary in `@eshyra/core`. CLI, future web, and future app
UXes all read and write it through the same core API. CLI-side JSON persistence
is **no longer authoritative**.

### 2. Evolve `FinalizedCharacter` into a versioned `CharacterSheet`

We evolve the existing `FinalizedCharacter` into the canonical, versioned
`CharacterSheet` document rather than introducing a parallel type. It already
carries the binding identity (`schemaVersion`, `system`, `rulesPackId`) and the
rich fields; a second type would only duplicate them and create a conversion
seam with no consumer. `CharacterSheet` is the public, root-exported surface;
character creation produces one, and leveling mutates one.

The sheet is persisted as a **versioned JSON document**, not a wide normalized
schema. A `character_sheet` table keyed by character id carries the binding
columns needed to validate and route reads — `schema_version`, `system`,
`rules_pack_id` — plus a `sheet_json` document column. This avoids prematurely
normalizing every D&D 5e / Pathfinder field into SQL columns while still giving
core full ownership of storage. Normalized projections or query columns can be
added later behind the same store API without changing the authority model.

### 3. The sheet is bound to its rules pack

A `CharacterSheet` is valid only under the rules system and pack that produced
it. The store persists `system` and `rules_pack_id` (which encodes the pack
version, e.g. `rules__dnd5e-srd-5.1`). Core progression APIs **fail closed**
when the acting rules pack does not match the sheet's `rulesPackId` / `system`:
they refuse rather than apply mechanics from a different pack.

Cross-pack character conversion is a **future, explicit operation** that
generates a *new* sheet from an old character's facts (new-sheet generation with
imported source data) — it is not in-place mutation and not part of leveling. A
rules-pack upgrade must never silently rewrite an existing character; the sheet
stays pinned to the pack it was created under.

### 4. Authority is split by data volatility, not duplicated

The canonical sheet and the live `character` row hold different classes of data
rather than two copies of the same data:

- **`CharacterSheet` (slow / build-defining):** class/ancestry/background refs,
  rules-pack provenance, ability scores, proficiency bonus, **max HP**,
  **level**, features, known/prepared spells, languages, equipment-selection
  provenance and equipment-derived build facts, saving throws, derived values,
  and the progression state/ledger. The sheet owns everything that defines
  *who the character is and what they can do*.
- **Live game state (fast / per-turn situation):** current HP (`hp_current`),
  `conditions_json`, carried inventory item stacks / unique objects, item
  quantities, item locations, and the identity/class mirror columns needed for
  prompt context. The live `character` row plus the `inventory` table own *the
  character's current situation in play* and remain the per-turn store (SQLite
  stays the hot path, per ADR 0003 / the architecture principles).

The handful of overlapping columns — `level`, `hp_max`, and the
identity/class mirrors — are **owned by the sheet and projected into the live
row**. A level-up writes the sheet (new level, new max HP, new features, …) and
re-projects the affected live columns; per-turn damage writes only
`hp_current`/`conditions_json` on the live row. The live row is therefore a
**projection/cache** of the sheet for the fields they share, and the source of
truth for fast per-turn fields; it is rematerializable from the sheet plus
current-situation state. No field has two authorities.

Mutable inventory is **not** duplicated into `CharacterSheet`: creation-time
starting-equipment choices may seed `inventory` rows, but after projection the
`inventory` table is authoritative for carried objects, quantities, and
locations. The sheet retains only equipment-selection provenance and the
build facts those choices imply. Likewise, the progression-event ledger is part
of the sheet's authority boundary, though it may be stored in a separate
append-only table keyed to the sheet rather than embedded inside `sheet_json`.

### 5. Migration path off CLI JSON

`createFileFinalizedCharacterStore` is demoted to a non-authoritative
import/interop helper and then removed once the core store lands. A one-time
importer reads any existing finalized-character JSON files and writes them into
the core `CharacterSheetStore`; the CLI creation/selection wiring
(`packages/cli/src/index.ts`, `playCharacter.ts`) switches to call the core
store. Because this is pre-release, the importer is best-effort and need not
preserve the CLI file layout.

## Consequences

- A new core `CharacterSheet` model + `CharacterSheetStore` (save/load/list,
  SQLite-backed, root-exported API) must be implemented, with the
  sheet→live-row projection and the CLI migration. This is implementation work
  beyond this decision and is tracked as a dedicated child bead that the
  progression ledger (`eshyra-lupf.2`) and the level-up engine
  (`eshyra-lupf.8`) build on.
- The progression-event ledger and per-character progression state
  (current XP, level, outstanding eligibility) attach to the canonical sheet's
  authority; the effective advancement mode is still resolved from the campaign
  rules binding (`docs/design/character-progression.md`).
- The level-up engine reads and writes the canonical sheet, enforces the
  pack-match guard from §3, and re-projects the live row.
- `FinalizedCharacter` consumers (tests, CLI creation/selection) migrate to the
  `CharacterSheet` name/shape; the root export surface changes accordingly.
- The per-turn path is unchanged: turn loops keep reading/writing the live
  `character` row for HP and conditions.

## Out of scope

- The concrete `CharacterSheet` field-by-field schema and store implementation
  (the follow-up implementation bead).
- Multiclassing, in-place rules-pack migration, and cross-pack conversion.
- Normalized per-field SQL projections (deferred; can be added behind the store
  API later).
