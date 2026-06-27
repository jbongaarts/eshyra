# Canonical Game State

The game-state subsystem is the single canonical store for mutable campaign
facts. Model narration may propose changes, but canon changes are committed only
through deterministic state tools.

## Tables

`character` holds one row per party member, keyed by a `TEXT` id (e.g. `pc-1`,
`pc-2`). A `role` column distinguishes player characters (`role = 'pc'`) from
companions, familiars, and hirelings. Each row tracks identity, class, level,
hit points, ability scores, and conditions. The party-wide active character is
tracked in `meta.active_character_id`; deterministic mutations resolve their
target by id, defaulting to the acting/active character. Solo play is simply a
one-member party. See `docs/character-creation.md` for the creation flow and
`docs/multi-pc-design.md` for the multi-PC model.

The `character` row owns fast-changing per-turn situation (current HP,
conditions) and mirrors a few build-defining fields (identity, class, `level`,
`hp_max`) that are authored by the core-owned canonical character sheet. Per
ADR 0011 (`docs/adr/0011-core-owned-rules-pack-bound-character-sheet.md`), the
canonical sheet — not this row — is the authority for build-defining facts
(class refs, proficiencies, features, spells, ability scores, progression
state); those mirror columns are projected from it. The per-turn store remains
the authority for `hp_current` and `conditions_json`.

`inventory` stores one row per item stack or unique carried object, owned by a
party member via the `character_id` foreign key. Each row has an
application-level `id`, display `name`, quantity, optional location, and JSON
properties for item-specific metadata. Reads are scoped strictly to the owning
character, so items never bleed across party members.

`plot_flags` stores keyed canonical story facts. Values are encoded as JSON so
booleans, strings, numbers, arrays, and small objects can be stored without
introducing table churn for every new campaign flag.

`clock` is a singleton row (`id = 1`) for in-game time and current location.

`overlay_facts` stores keyed temporary or derived facts used by world and memory
subsystems. It has the same JSON value shape as `plot_flags`, but callers should
treat overlay facts as contextual state rather than character-sheet canon.

Every mutable row carries:

- `provenance`: the deterministic source of the accepted fact.
- `session_id`: the session that accepted the write.
- `updated_at`: the accepted write timestamp.

## State Tools

`mutateState(db, input)` validates one state mutation and writes it in a SQLite
transaction. The supported operation is `set`. Unsupported targets, fields, or
operations are rejected with `MutateStateError` before canon is changed.

`mutateStateBatch(db, inputs)` applies a turn-sized list of mutations in one
transaction. If validation, SQLite, or caller code throws before the batch
finishes, SQLite rolls back the in-flight writes and preserves the last committed
state.

`getStateProvenance(db, query)` returns row-level provenance metadata for
narrative callbacks. It supports character, inventory, plot flag, clock, and
overlay fact rows.

