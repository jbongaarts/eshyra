# Local Storage

Eshyra keeps one managed directory per user — the **data root** — holding
the config file, the campaign registry, managed campaign databases, installed
rules packs, and the managed Dolt binary cache. The model is recorded in
[ADR 0004](adr/0004-config-file-and-campaign-registry.md). The CLI does not load
`.env` files by itself.

## Per-User Data Root

Eshyra resolves one data root per user:

1. `ESHYRA_HOME`, when set.
2. Otherwise the platform default: `%LOCALAPPDATA%\Eshyra` on Windows,
   `~/.eshyra` on macOS and Linux.

The root contains:

```text
<root>/
  config.json     non-secret CLI preferences
  registry.json   the campaign registry
  campaigns/      managed campaign databases and their sidecars
  rules-packs/    installed (non-bundled) RPG rules packs
  dolt/           the managed Dolt binary cache
```

The root and its subdirectories are created lazily — only on a command that
writes managed data, never on a bare `eshyra` banner run.

### Config File

`config.json` holds non-secret preferences only: `defaultCampaignId`,
`doltHome`, `doltBin`, and per-profile `profiles` overrides. Settings
precedence, highest first: explicit CLI flag, environment variable,
`config.json`, built-in default. The CLI rejects a `config.json` that contains
a provider-key-shaped value or a secret-named key — credentials belong in the
environment, never in the config file (see [Provider Secrets](#provider-secrets)).

## Campaigns

Each campaign is a single SQLite database. The CLI manages campaigns through a
registry (`registry.json`) of pointer metadata — id, display name, database
path, timestamps, and the module identity — and never campaign content:

- `eshyra new <name>` creates `campaigns/<slug>.db` under the data root,
  forks the bundled starting module into it, and registers it.
- `eshyra play` opens a campaign: it plays the only registered campaign
  directly, shows a picker when several exist, or offers to create the first
  one when the registry is empty. `eshyra play <id>` opens one by id.
- `eshyra campaigns list | rename | remove | add` manage the registry.
  `remove` unregisters a campaign without deleting its database file; `add`
  registers a database that lives outside `campaigns/`.

`play` opens or creates the database, initializes the schema, forks the bundled
starting module when the database has no campaign, and stores live campaign
state there. The same file is reused when the campaign is resumed.

`ESHYRA_DB_PATH` overrides all of this: when it is set the CLI opens exactly
that database as an explicit, unmanaged campaign and does not consult the
registry. It suits scripted, CI, and synced-folder workflows.

SQLite may create transient sidecar files beside the database while it is open,
such as `dev.db-wal`, `dev.db-shm`, or `dev.db-journal`. Treat those as part of
the live local working copy, not as separate Eshyra stores.

## Schema Versions and Migration

> **Direction:** this section describes the current TypeScript migration-chain
> model. It is being replaced by migration-first SQLite schema management —
> versioned `.sql` files as the single executable authority plus a
> `schema_migrations` ledger — per
> [ADR 0015](adr/0015-migration-first-sqlite-schema-management.md). This text is
> rewritten when that work lands (`eshyra-4s0r.1`).

Every campaign SQLite database records its schema version in the `meta` table
(`key = 'schema_version'`). The current application schema version is `8`.

### Compatibility expectations (pre-release)

Eshyra is pre-release software. Campaign databases may not survive arbitrary
schema changes, but the migration framework minimises breakage:

| Situation | Outcome |
|-----------|---------|
| DB version == current | Opens normally; `initSchema` is idempotent. |
| DB version > current (newer build wrote it) | Rejected with `SchemaCompatibilityError`. Update your `eshyra` installation. |
| DB version < current, migration registered | `initSchema` runs all registered migrations in order before proceeding. Each migration step commits atomically; a partial failure leaves the DB at the last successfully migrated version. |
| DB version < current, no migration registered | Fails with `SchemaMigrationError`. The DB is not touched. |
| DB has tables but no `meta` table | Rejected with `SchemaCompatibilityError` (pre-migration legacy). |

### Adding a schema migration

When the schema changes (bump `SCHEMA_VERSION` in `schema.ts`), add an entry to
`MIGRATIONS` in `packages/core/src/persistence/migrations.ts`:

```typescript
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  8: v7_to_v8,   // existing
  9: (db) => {   // new migration
    db.exec('ALTER TABLE some_table ADD COLUMN new_col TEXT');
  },
};
```

Each migration function receives the database **inside a transaction** and must
not open its own nested transaction. The framework commits the migration and
advances `schema_version` together; a thrown error rolls back both. SQLite does
not support `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so guard with
`PRAGMA table_info(…)` when the column may already exist.

## Bundled Static Content

Static content ships with the package source/build output:

- `EMBERFALL_HOLLOW` is the bundled sample module currently forked into new
  campaigns by the CLI.
- The legacy SRD catalog and license metadata (used by character creation) are
  bundled in the core package under `src/rules/srd/`.
- The runtime D&D 5e SRD 5.1 rules pack (CC-BY-4.0) is the importer-generated
  pack shipped in `@eshyra/core` under `data/rules-packs/rules__dnd5e-srd-5.1/`
  and loaded at runtime via `getBundledDnd5eSrdPack` (ADR 0013). The former
  in-code `DND5E_SRD_RULES_PACK` placeholder has been removed.
- `PATHFINDER2E_REMASTER_RULES_PACK` (Pathfinder 2e Remaster fixture under the
  Open RPG Creative License) still ships as an in-code fixture under
  `src/rules/`. The Pathfinder fixture uses ORC-licensed mechanical content
  only — no Paizo trade dress, compatibility logo, or reserved setting material
  is bundled.

When a new campaign is created, module template records are copied into
immutable `module_*` tables in the campaign SQLite database. Later play writes
live changes and overlays into live campaign tables; it does not mutate the
pack source.

Non-bundled rules packs (additional systems, publisher-licensed packs,
user-private packs) install under `<root>/rules-packs/`. Unlike module
content, rules data is not copied into campaign databases — the per-campaign
binding identifies which packs to resolve against and lookups go through the
active stack at runtime.

Bundled or public content must be open-licensed, public domain, original, or
publisher-licensed. Fair use is not the storage or distribution policy.

## Campaign Rules Binding

Every campaign DB persists an authoritative rules binding in the singleton
`campaign_rules_binding` table: a base rules pack identity (`systemId`,
`packId`, `version`), an ordered JSON list of compatible add-on packs, and a
resolution timestamp. The binding is written by `createCampaign` (default:
D&D 5e SRD) and read by `getCampaign`, `readCampaignRulesBinding`, the
`lookup_rules` tool, and the character-creation dispatcher.

Same-schema-version campaign DBs that predate the binding row read as the
default D&D SRD binding rather than failing, so existing campaigns keep
working at the current schema version. Cross-version migration of the
binding itself is out of scope and is not attempted automatically.

Checkpoints serialize the binding alongside the rest of the campaign DB —
`serializeCampaign` walks every campaign table dynamically — so a checkpoint
restore preserves the campaign's system identity.

## Checkpoints

Dolt checkpoints are optional. If no usable `dolt` binary is available, the CLI
still closes and recaps the session without a checkpoint.

When Dolt is available, graceful session close writes a Dolt repo beside the
campaign database, at `<dbPath>.checkpoints`. For example, a campaign database
`dev.db` checkpoints into `dev.db.checkpoints`.

`<dbPath>` is the campaign database selected for the run: a registry entry for
managed campaigns, or `ESHYRA_DB_PATH` for an explicit unmanaged campaign.

Checkpoint restore and fork operations materialize a checkpoint into a new
SQLite database path chosen by the command or caller. Restore refuses to
overwrite an existing destination and builds through a temporary sibling file
before renaming it into place.

Campaign checkpoint repos are separate from beads. The checkpoint store rejects
paths or remotes that collide with the repository's `.beads` Dolt data, and
campaign history must not use the beads-reserved `refs/dolt/data` sync ref.

The serialized snapshot is optimized for restore/fork correctness, not for
semantic "what changed in the campaign?" diffs. An optional semantic projection
layer is designed — but deliberately deferred until a history UX needs it — in
[docs/checkpoint-semantic-projection.md](checkpoint-semantic-projection.md).

## Dolt Binary Cache

Eshyra resolves the Dolt binary in this order:

1. An explicit path from `ESHYRA_DOLT_BIN` (or `doltBin` in `config.json`).
2. The managed Dolt cache directory.
3. A `dolt` executable on `PATH`.

The managed cache defaults to `<root>/dolt` — `~/.eshyra/dolt` on macOS and
Linux, `%LOCALAPPDATA%\Eshyra\dolt` on Windows. Set `ESHYRA_DOLT_HOME`
(or `doltHome` in `config.json`) to use a different managed cache directory. The
CLI only downloads a managed Dolt binary through `eshyra dolt install`, and
that command requires interactive consent. Non-interactive shells decline the
download automatically.

## Provider Secrets

**Local dev.** Provider credentials come from the local process environment:
`loadConfig` accepts either `ANTHROPIC_API_KEY` (a Console API key) or
`CLAUDE_CODE_OAUTH_TOKEN` (a Claude Pro/Max subscription token) and resolves a
`ProviderAuth` describing which one is in use. See
[docs/agent-sdk-auth.md](agent-sdk-auth.md). Model profile overrides use
`ESHYRA_PROFILE_*_PROVIDER` and `ESHYRA_PROFILE_*_MODEL`. Secrets are
never read from or written to `config.json`.

**Auth-injection seam.** The Agent SDK adapter (`AgentSdkModelClient`) does not
rely on the SDK silently reading ambient `process.env`. It exposes an explicit
auth seam — an `AgentSdkAuthSource`, a fixed `{ env }` value or a function
resolved per `complete()` call. The CLI passes the key validated by
`loadConfig` through this seam; the secret is forwarded only into the SDK
process environment and is held in an ECMAScript-private field, so a client
object captured into a trace or log cannot leak it.

**Hosted BYOK.** A hosted deployment supplies each request its own provider
secret through the same seam — sourced from a dedicated secret store, never
ambient process state — so per-tenant keys and short-lived/rotating credentials
need no code change in the adapter. The function form of `AgentSdkAuthSource`
covers per-request secrets.

Provider secrets must not be written to:

- campaign SQLite databases
- the config file or campaign registry
- Dolt checkpoints or checkpoint history
- `turn_trace`
- exports
- logs

Hosted BYOK secret handling is a separate design in
[ADR 0002](adr/0002-hosted-web-pwa-byok-deployment-path.md). Hosted keys must
live in a dedicated secret store, not campaign storage.
