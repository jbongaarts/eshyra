# ADR 0015: Migration-First SQLite Schema Management

Status: accepted

Date: 2026-06-25

## Context

Eshyra's campaign SQLite store currently has **two** authorities over schema
shape, and they can disagree:

1. A hand-maintained *latest-schema* block in `initSchema`
   (`packages/core/src/persistence/schema.ts`). It is one large
   `CREATE TABLE IF NOT EXISTS … / CREATE INDEX IF NOT EXISTS …` `exec`, run on
   every database open, that asserts the full current schema. A
   `SCHEMA_VERSION` integer constant lives next to it.
2. A TypeScript migration chain (`packages/core/src/persistence/migrations.ts`,
   `MIGRATIONS[8..15]`) that incrementally evolves an older DB up to
   `SCHEMA_VERSION`, with `meta.schema_version` recording where a DB sits.

Both affect the schema, which creates real problems:

- **Duplicate authority / drift.** A column or index can be added to the
  `initSchema` block and forgotten in a migration (or vice versa). Fresh
  databases (built by the `initSchema` block) and migrated databases (built by
  the chain) can then end up with *different* schemas at the same
  `schema_version`. Nothing proves they match.
- **`IF NOT EXISTS` masks incomplete migrations.** Because `initSchema` runs the
  full latest schema on every open with `IF NOT EXISTS` guards, a table or index
  that a migration *should* have created but didn't gets silently created by the
  bootstrap block instead. The migration looks like it worked; the bug is
  invisible. This is "hidden schema repair": startup quietly papering over a
  migration gap.
- **Bootstrap rows ride along with schema repair.** `initSchema` also runs
  `INSERT OR IGNORE` for the default `pc-1` character, the `clock` singleton, and
  the `active_character_id` meta row on *every* open, then unconditionally
  rewrites `meta.schema_version`. Seed data and schema assertion are tangled
  together in the same always-on path.

Eshyra is pre-1.0 with an explicit policy of **no backwards-compatibility
compromises or migration effort before v1.0.0** (see ADR 0013). There is no
installed user base whose databases must survive. This is therefore the cheapest
possible moment to move to a durable, single-authority schema model before that
freedom goes away.

This ADR records the policy. It is the design note required by `eshyra-4s0r.1.2`
and governs the implementation beads under epic `eshyra-4s0r.1`:

- `eshyra-4s0r.1.3` — SQL migration runner and ledger.
- `eshyra-4s0r.1.4` — baseline the current schema as `0001_initial.sql`.
- `eshyra-4s0r.1.5` — legacy `meta.schema_version` adoption / reset path.
- `eshyra-4s0r.1.6` — remove the latest-schema repair DDL from `initSchema`.
- `eshyra-4s0r.1.7` — parity, idempotency, and checksum tests.

## Decision

Adopt **migration-first** schema management: versioned SQL migration files are
the single executable source of truth for the campaign SQLite schema. The
hand-maintained latest-schema DDL is retired as authority.

### 1. SQL migration files are the canonical executable schema source

- Schema changes are expressed **only** as ordered SQL migration files under
  `packages/core/data/migrations/`. (The runner bead `eshyra-4s0r.1.3` settled
  this load location: it mirrors the bundled SRD pack under `data/`, which is
  listed in `package.json` `files` and ships in every edition. The provisional
  `src/persistence/migrations/` location named in earlier drafts of this ADR was
  not packageable — `tsc --build` does not copy non-TS assets into `dist`.)
- Files are named `NNNN_snake_case_name.sql` with a **zero-padded 4-digit**
  version prefix: `0001_initial.sql`, `0002_add_party_index.sql`, …
- Versions are **strictly contiguous from `0001`, monotonically increasing, with
  no gaps, no reuse, and no reordering.** The numeric prefix is the migration
  version.
- Each file contains plain SQLite DDL/DML for exactly one migration. The runner
  executes the file text verbatim.
- The current intended schema (everything `initSchema` asserts today, at the
  schema state corresponding to the present `SCHEMA_VERSION = 15`) is captured as
  `0001_initial.sql` — a single squashed baseline, **not** a replay of the
  historical `v7→v8 … v14→v15` steps. See §6 for why the old chain is not
  carried forward.

**This explicitly rejects hand-maintained latest-schema DDL as executable
authority.** After `eshyra-4s0r.1.6`, `initSchema` no longer contains a
`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` latest-schema block,
no longer carries a `SCHEMA_VERSION` constant as the schema authority, and the
`MIGRATIONS` TypeScript chain in `migrations.ts` is removed. The only thing that
creates or alters **application schema** is the migration runner applying `.sql`
files. The `schema_migrations` ledger is the sole runner-owned infrastructure
exception: the runner creates and maintains it before applying migrations (see
§2). It is never declared in a migration file, and the runner never creates any
other schema outside migrations.

### 2. `schema_migrations` ledger is the applied-state authority

A `schema_migrations` table records what has been applied. It replaces
`meta.schema_version` as the source of truth for schema state.

```sql
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,   -- the snake_case name, without the NNNN_ prefix or .sql
  checksum   TEXT NOT NULL,   -- see §4
  applied_at TEXT NOT NULL    -- ISO-8601 UTC timestamp when the migration was applied
);
```

- Exactly one row per applied migration.
- The ledger, not `meta.schema_version`, answers "which migrations has this DB
  seen?". `meta.schema_version` is retired as schema authority (it survives only
  as a read-only legacy signal for the adoption check in §5).
- The `schema_migrations` table itself is created by the runner before it applies
  any migration (it is runner infrastructure, not a migration), so an empty DB
  gains the ledger and then has `0001_initial.sql` recorded in it.

### 3. Initialization behavior

- **Empty DB (no user tables):** the runner creates `schema_migrations`, then
  applies **all** migration files in ascending version order from `0001`. Each
  file's ledger row is written as part of applying it.
- **Existing migration-first DB (has `schema_migrations`):** the runner verifies
  the checksums of already-applied migrations (§4), then applies **only** the
  pending files (version greater than the max applied version), in order.
- **Legacy DB (`meta.schema_version`, no `schema_migrations`):** handled by the
  adoption/reset path in §5.

Result: a freshly created DB and an up-to-date existing DB converge on the
identical schema, because both are the cumulative application of the same
ordered `.sql` files. The parity guard in §7 proves this.

### 4. Checksum policy

- The checksum is the **SHA-256 hex digest of the migration file's normalized
  text**. Normalization: decode as UTF-8, convert CRLF → LF, and ensure a single
  trailing newline. (The runner bead fixes the exact normalization; the
  invariant is that the same logical file text always produces the same digest
  across platforms and git autocrlf settings.)
- The checksum is stored in `schema_migrations.checksum` when a migration is
  applied.
- On every open of an existing DB, the runner recomputes the checksum of each
  already-applied migration file and compares it to the stored value.
  **A mismatch is a hard error** (`SchemaMigrationError`): it means a committed,
  already-applied migration file was edited after the fact. The runner does
  **not** auto-heal, re-run, or rewrite the ledger. It fails fast and names the
  offending version.
- A pending migration whose version is greater than the max applied version is
  applied normally; its checksum is recorded at apply time.
- An applied ledger version with **no** corresponding migration file is also a
  hard error (the file was deleted or renamed). Migration files are append-only
  and immutable once committed.

This makes "never edit a committed migration" a checked invariant, not a
convention.

### 5. Legacy `meta.schema_version` adoption vs. reset

Pre-migration-first databases carry `meta.schema_version = N` and have **no**
`schema_migrations` table. Because `0001_initial.sql` encodes the schema as of
`SCHEMA_VERSION = 15`, a legacy DB already at 15 is structurally identical to a
fresh `0001` DB.

- **Adopt (baseline) when `meta.schema_version` equals the baseline version
  (15).** The runner creates `schema_migrations` and inserts the `0001_initial`
  ledger row (with the real computed checksum) marking it applied **without
  re-running its DDL** — the tables already exist. Any later migrations
  (`0002+`) are then applied as normal pending migrations. The DB is now a
  migration-first DB.
- **Reset otherwise.** If `meta.schema_version` is **less than** the baseline
  (a genuinely older schema) or **greater than** the baseline (written by a
  newer build), the runner does **not** attempt to bring it forward. Consistent
  with the pre-v1 no-migration-effort policy, it **rejects** the DB with a clear
  pre-1.0 reset message: the database predates (or postdates) the migration
  baseline and must be recreated (it names the file and the expected baseline
  version). The historical TS migration chain that previously walked
  `v8…v15` is **not** preserved to service these DBs.
- **Reject ambiguous / corrupt:** a DB with user tables but neither
  `schema_migrations` nor a valid integer `meta.schema_version` is rejected with
  a clear error, exactly as `assertSchemaCompatible` does today. The runner never
  silently "repairs" an unknown DB into shape.

Rationale: pre-1.0, the only databases in existence are developer/playtest DBs.
Adopting the one current version (15) keeps live dev DBs working across this
change; rejecting everything else costs nothing real and avoids carrying a
legacy migration chain forward purely to service databases we are free to
discard.

### 6. Why `0001_initial.sql` is squashed, not a replay of v7→v15

The historical TS migrations include destructive table rebuilds (e.g. the
`v8→v9` singleton-to-party `character` rebuild) that only make sense against a
DB that already held the *old* shape. Replaying them from zero on an empty DB is
pointless work and extra surface for drift. The baseline captures the **current
end state** as one authoritative file. The old chain's value was getting
existing DBs to v15; §5 handles that for the only DBs that exist (already at 15)
by adoption, so the chain can be retired.

### 7. Generated schema snapshot (review artifact, not authority)

A human-readable schema snapshot **may** exist for review and diffing —
`packages/core/data/schema.snapshot.sql`.

- It **must not** live inside `packages/core/data/migrations/`. That directory
  contains **only** executable `NNNN_name.sql` migration files; the runner
  discovers every `.sql` there and treats it as a migration (a non-migration
  filename like `schema.snapshot.sql` placed there is rejected as malformed). The
  snapshot is a sibling under `data/`, on a non-migration path.
- It is **generated-only**: produced by applying all migrations to a fresh
  in-memory DB and dumping the resulting schema in a deterministic order. It
  carries a header comment marking it generated — *do not hand-edit*.
- It is **never executed at runtime** and is **never** an authority over schema.
  It exists so reviewers can see the cumulative schema in one place and so PRs
  show a readable schema diff.
- A test regenerates it and asserts it matches the committed file (so it cannot
  silently drift), and a **migrated-vs-fresh parity** test asserts that a DB
  adopted from the legacy baseline and a DB built fresh from migrations produce
  the same schema.

### 8. Bootstrap / default rows are seed data, not schema repair

The default `pc-1` character, the `clock` singleton, and the
`active_character_id` meta row are **initial seed state**, expressed as `INSERT`
statements **inside `0001_initial.sql`**. They are applied **once**, when the
baseline migration runs, and recorded by the ledger like any other migration
effect.

- They are **not** re-asserted on every database open. The recurring
  `INSERT OR IGNORE` calls in `initSchema` are removed.
- After the baseline applies, those rows are ordinary live state owned by the
  application/user. If the user or app deletes `pc-1`, it does **not** silently
  reappear on next open — that would be the schema-repair anti-pattern this ADR
  removes, applied to data.
- If a future invariant genuinely needs a guaranteed singleton row, it is
  introduced as a new migration, not as always-on startup repair.

`meta.schema_version` is **not** written on every open anymore; ledger rows
carry applied-state. (`meta` remains a table for other key/values; only its use
as the schema-version authority is retired.)

## Developer workflow after this lands

To change the schema:

1. **Add a new file** `packages/core/data/migrations/NNNN_name.sql`,
   where `NNNN` is the next contiguous version after the current highest. Write
   plain SQLite DDL/DML. Remember SQLite has no `ALTER TABLE … ADD COLUMN
   IF NOT EXISTS`; a forward-only migration runs exactly once, so unguarded
   `ALTER TABLE … ADD COLUMN` is correct here (the ledger guarantees single
   application — do not add `IF NOT EXISTS`/`PRAGMA table_info` guards that would
   re-mask incompleteness).
2. **Never edit or rename a committed migration file.** Its checksum is recorded
   in every DB that applied it; editing it is a checked hard error (§4). Fix
   mistakes with a *new* migration.
3. **Regenerate the schema snapshot** (§7) and commit it with the migration.
4. **Run the migration tests** (`eshyra-4s0r.1.7`): fresh init, repeated init
   (idempotency), pending-migration application, checksum-drift rejection,
   legacy adoption/reset, and migrated-vs-fresh parity.
5. **Do not** add tables/indexes/columns to any latest-schema block or bump a
   `SCHEMA_VERSION` constant — those authorities no longer exist.
6. **Bundle the file.** Migration `.sql` files (and the generated snapshot) must
   ship in the published `@eshyra/core` package (`files`) and resolve at runtime
   in every shipped edition. The runner bead (`eshyra-4s0r.1.3`) owns the load
   mechanism; the requirement here is that the canonical authority is the `.sql`
   text, and its checksum is computed over that text.

### Transaction policy

- Each migration is applied inside **its own transaction**, together with its
  `schema_migrations` ledger insert, so applying a migration and recording it are
  atomic. A failure rolls back both; a partial multi-migration run leaves the DB
  at the last fully-applied version (matching today's per-step semantics).
- A migration file must **not** open its own nested transaction (`BEGIN`/`COMMIT`
  in the `.sql`); the runner owns the transaction boundary.
- Migrations are applied with normal pragmas. A migration that performs a SQLite
  table rebuild and needs `foreign_keys` temporarily off must follow SQLite's
  documented table-rebuild procedure explicitly within the runner's contract
  (the runner bead specifies how `PRAGMA foreign_keys` is handled around the
  transaction, since `foreign_keys` cannot be changed inside a transaction).

## Consequences

### Positive

- **One schema authority.** Fresh and existing DBs are the same ordered `.sql`
  files applied cumulatively; the parity test proves they match. Drift between a
  bootstrap block and a migration chain becomes impossible.
- **No hidden schema repair.** Removing the always-on `IF NOT EXISTS`
  latest-schema block means a missing/incomplete migration surfaces as a real
  failure instead of being silently patched at startup.
- **Tamper-evident history.** Checksums make "someone edited an applied
  migration" a hard, named error rather than silent divergence.
- **Seed data is honest.** Default rows are applied once as initial state, not
  re-asserted forever.
- **Durable before v1.** Establishes the long-term model now, while pre-v1 policy
  still lets us squash history and discard incompatible dev DBs for free.

### Negative / risks

- **Legacy dev DBs below baseline are dropped.** Any developer/playtest DB at
  `meta.schema_version < 15` must be recreated. Acceptable under the pre-v1
  no-migration policy; mitigated by adopting DBs already at 15.
- **New runtime dependency on bundled `.sql` files.** The migrations must be
  packaged and resolvable in every edition; the install/edition smoke must cover
  fresh-DB init after this lands.
- **Checksum normalization must be cross-platform.** A sloppy normalization
  (CRLF, BOM, trailing newline) would cause false drift errors on Windows
  checkouts; the runner bead must pin and test normalization.
- **Snapshot determinism.** The generated snapshot must dump schema in a stable
  order or it will churn; the generator and its test must enforce that.

### Follow-ups

- `eshyra-4s0r.1.3` implements the runner + ledger + checksum + transaction
  policy.
- `eshyra-4s0r.1.4` writes `0001_initial.sql` from the current schema.
- `eshyra-4s0r.1.5` implements adoption/reset.
- `eshyra-4s0r.1.6` removes the latest-schema DDL and the TS migration chain.
- `eshyra-4s0r.1.7` adds the parity/idempotency/checksum/legacy tests.
- `docs/storage.md` "Schema Versions and Migration" is rewritten to describe the
  migration-first model when `eshyra-4s0r.1.6` lands (it currently documents the
  retired TS-chain model and a stale version number).
