import type {
  AdventureModule,
  CharacterChronicleStore,
  CharacterCreationEngine,
  CharacterRegistryStore,
  Db,
  InstalledAdventureModule,
  MemoryConfig,
  ModelClient,
  ModulePack,
  Rng,
  RulesPackCharacterResolver,
  RunTurnDeps,
  RunTurnInput,
  RunTurnResult,
  SessionCheckpointRunner,
  SessionDebugSink,
  ToolRegistry,
  TurnAuditor,
  TurnDiagnosticsSink,
} from '@eshyra/core';
import type { CharacterDraftStore } from './characterDraftStore.js';

/** Player-facing input/output seam. A terminal impl is {@link nodeIO}. */
export interface CliIO {
  /** Write one line of output to the player. */
  write(line: string): void;
  /**
   * Prompt the player and resolve with their trimmed answer, or `undefined`
   * when input is exhausted (EOF / closed stream) — which the turn loop treats
   * as a graceful quit.
   */
  prompt(question: string): Promise<string | undefined>;
}

export interface PlayDeps {
  io: CliIO;
  /** Open (creating the file if absent) the campaign database at a path. */
  openDb: (path: string) => Db;
  /**
   * Model client powering the DM. Passed straight to `runTurn` for turn-time
   * narration, and used by graceful close to author the campaign arc summary
   * via {@link composeArcSummary}.
   */
  model: ModelClient;
  /** Tool registry passed straight to `runTurn`. */
  registry: ToolRegistry;
  /**
   * Mechanics-audit gate (eshyra-oobh) passed straight to `runTurn`. Enforces
   * canonical tool use before a candidate DM response is shown/persisted. Omitted
   * in tests that exercise the loop without an auditor.
   */
  auditor?: TurnAuditor;
  /**
   * Opt-in session debug sink (eshyra-iu18 / eshyra-oobh) passed to `runTurn` so
   * audit verdicts are logged alongside the model-call diagnostics.
   */
  debug?: SessionDebugSink;
  /**
   * Per-turn timing diagnostics sink (eshyra-17ng) passed straight to `runTurn`.
   * Records tool spans and turn outcomes into the shared diagnostics store so a
   * slow turn can be decomposed via `eshyra usage --timeline`. Omitted in tests
   * that do not assert on timing.
   */
  diagnostics?: TurnDiagnosticsSink;
  /**
   * Run one orchestrated turn. Injected (rather than imported) so the loop is
   * exercisable in tests without a live model — defaults to the core `runTurn`.
   */
  runTurn: (deps: RunTurnDeps, input: RunTurnInput) => Promise<RunTurnResult>;
  /**
   * Resolves a campaign-bound adventure module for turn-time DM context and
   * authored encounter lookup. The CLI wires this from its bundled/installed
   * module inventory; omitted in loop-only tests and campaigns without modules.
   */
  resolveAdventureModule?: (moduleId: string) => AdventureModule | undefined;
  /** Module template forked into a brand-new campaign. */
  pack: ModulePack;
  /**
   * Enumerate the adventure modules offered by the session-start selector when
   * a brand-new campaign begins (eshyra-47ob). Defaults (in the CLI wiring) to
   * the core-bundled modules plus any installed under
   * `<root>/adventure-modules/`. Injected rather than read from the filesystem
   * inline so the selector is testable without a populated data root; an empty
   * list makes session start fall back to the default campaign content with no
   * prompt.
   */
  listAdventureModules: () => InstalledAdventureModule[];
  /** Store for resumable guided character-creation drafts. */
  characterDraftStore: CharacterDraftStore;
  /**
   * Cross-campaign character registry: the authority for a character between
   * campaigns (ADR 0012). Play imports/attaches a registry character into the
   * campaign's per-campaign sheet.
   */
  characterRegistry: CharacterRegistryStore;
  /** Registry-backed character memories rendered into context as non-canon. */
  characterChronicle: CharacterChronicleStore;
  /** D&D 5e guided character-creation engine used by play/session-zero. */
  characterEngine: CharacterCreationEngine;
  /** D&D 5e rules-pack resolver used by play/session-zero finalization. */
  characterResolver: RulesPackCharacterResolver;
  /** RNG source for the guided wizard's rolled-score commands. */
  characterRng: Rng;
  /** ISO-8601 timestamp source. */
  now: () => string;
  /** Unique id source for new campaigns / sessions / turns. */
  nextId: (prefix: string) => string;
  /** Per-turn RNG seed source (each turn is reproducible from its seed). */
  seed: () => number;
  /**
   * Build a checkpoint runner for the campaign DB at `dbPath`, or `undefined`
   * when checkpointing is unavailable (e.g. no `dolt` binary). Injected so the
   * close path is exercisable without Dolt; the default is
   * {@link doltCheckpointRunner}.
   */
  makeCheckpointRunner: (dbPath: string) => SessionCheckpointRunner | undefined;
  /** Memory configuration: arc rollover threshold (N) and recap window (K). */
  memoryConfig: MemoryConfig;
}

export interface PlayOptions {
  /** Path to the campaign database; created on first run. */
  dbPath: string;
  /**
   * When set, the turn loop stops once this many player turns have been
   * recorded — the bounded-demo turn cap. Unset for an unbounded campaign.
   */
  turnCap?: number;
}
