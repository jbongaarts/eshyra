import type { Db } from './db.js';
import { migrateDatabase } from './migrationRunner.js';

/**
 * JSON columns: live state vs archival/generated
 *
 * Live queryable state — validated at both the mutateState write boundary and
 * the contextAssembler read boundary via `state/liveStateSchema.ts`:
 *   - `character.ability_scores_json`   (shape: AbilityScores — exactly 6 keys, int 0–30)
 *   - `character.conditions_json`       (shape: CharacterConditionEntry[] — array of {id}+)
 *   - `inventory.properties_json`       (shape: InventoryItemProperties — plain JSON object)
 *
 * Opaque extension points — validated as plain JSON root-type only:
 *   - `plot_flags.value_json`           (any JSON value)
 *   - `overlay_facts.value_json`        (any JSON value)
 *   - `progression_event.applied_changes_json`
 *                                       (deterministic level-up change set on a
 *                                        progression-event ledger row; validated
 *                                        only as JSON-serializable at the
 *                                        `state/progression.ts` write boundary,
 *                                        with its internal shape owned by the
 *                                        level-up engine, eshyra-lupf.8)
 *   - `character_wallet_event.amounts_json`
 *   - `character_wallet_event.resulting_wallet_json`
 *                                       (deterministic wallet deltas and the
 *                                        resulting sheet wallet snapshot;
 *                                        validated by `character/currency.ts`)
 *
 * Typed live campaign canon:
 *   - `campaign_overlay_lore`           (improvised lore and continuity
 *                                        dressing promoted during play;
 *                                        append-friendly rows with truth status,
 *                                        significance, and visibility)
 *   - `combat_instance`                 (live/historical tactical combat
 *                                        episode lifecycle)
 *   - `campaign_actor`                  (persistent named/recurring actor
 *                                        mechanics across combat instances)
 *   - `encounter_combatant`             (live/historical tactical projection
 *                                        of anonymous creatures or actors into
 *                                        one combat instance)
 *
 * Archival / trace / generated — deliberately opaque, jsonColumn<TraceJsonValue[]>.
 * Do not add shape validation here; these blobs are owned by the memory subsystem:
 *   - `turn_trace.*_json`
 *   - `scene_summary.*_json`
 *   - `session_recap.*_json`
 *   - `arc_summary.*_json`
 *   - `campaign_bible.*_json`
 *
 * Module template columns (`module_*.data_json`) are read-only post-fork and
 * validated by the pack importer at load time — not by mutateState or the
 * context assembler.
 *
 * Campaign-owned adventure run progress — mutable campaign-instance state typed
 * at the adventure-run module's own read/write boundary
 * (`campaign/adventureRun.ts`), not by mutateState. The referenced adventure
 * module source is never written back here:
 *   - `adventure_run.progress_json`     (shape: AdventureRunProgress)
 *
 * Operational diagnostics are non-canon debugging records, not game history:
 *   - `turn_failure_diagnostic`
 *
 * ---
 *
 * Schema authority is migration-first (ADR 0015). The executable schema lives
 * entirely in versioned SQL migrations under `packages/core/data/migrations/`;
 * the comments above document column *semantics*, not schema authority. There is
 * no hand-maintained latest-schema DDL and no `SCHEMA_VERSION` constant here
 * anymore — applied state is recorded in the `schema_migrations` ledger.
 */

/**
 * Initialize, or bring up to date, a campaign database's schema.
 *
 * Migration-first (ADR 0015): this delegates entirely to the migration runner
 * via {@link migrateDatabase}. There is no hand-maintained latest-schema DDL and
 * no `CREATE TABLE IF NOT EXISTS` repair path that could mask an incomplete
 * migration. Concretely:
 *
 * - An empty database has every migration applied from `0001_initial.sql`.
 * - An existing migration-first database has only pending migrations applied,
 *   after its already-applied migration checksums are verified.
 * - A legacy `meta.schema_version` database is adopted in place at the baseline
 *   when it structurally matches, or fails closed with an actionable
 *   `SchemaResetRequiredError` (pre-1.0 reset/recreate) otherwise.
 *
 * Bootstrap/default rows (the `pc-1` character, the `clock` singleton, and the
 * `active_character_id` pointer) are one-time seed inside `0001_initial.sql`,
 * not always-on startup repair.
 *
 * Idempotent: calling it again on an up-to-date database applies nothing and
 * leaves the database unchanged.
 *
 * @throws SchemaResetRequiredError if an existing database must be recreated.
 * @throws SchemaMigrationError on a defect in the migration set itself.
 */
export function initSchema(db: Db): void {
  migrateDatabase(db);
}
