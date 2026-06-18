/**
 * `@eshyra/core/internal` — non-stable surface.
 *
 * Everything re-exported below is **explicitly unstable**: low-level
 * primitives, raw datasets, model-profile/benchmarking helpers, world/rules
 * loaders, dolt provisioning innards, and system-specific character-creation
 * pieces. Names, signatures, and locations may change in any release with
 * no migration path.
 *
 * Use the stable root export (`@eshyra/core`) from production code.
 * Imports of this subpath belong in co-developed callers inside this
 * repository (tests, evaluation tooling) that genuinely need to assert
 * against implementation details. See the header of `./index.ts` for the
 * stability contract.
 *
 * For convenience to those in-repo callers this subpath also re-exports the
 * stable surface, so a single import from `@eshyra/core/internal` (or, for
 * core's own tests, `'../src/internal.js'`) covers both buckets.
 */

// Demo-mode policy + budget helpers (the high-level entrypoints are stable).
export {
  assertDemoContentAllowed,
  assertDemoTurnAllowed,
  demoTurnBudget,
  evaluateDemoContent,
  resolveDemoModel,
} from './campaign/demoMode.js';
export type { CharacterCreationMutationMetadata } from './character/creation.js';
// Character-creation low-level helpers + Pathfinder-specific draft validator
// (the high-level `completeCharacterCreation` is the stable entrypoint).
export {
  buildCharacterCreationMutations,
  validateCharacterDraft,
} from './character/creation.js';
export type {
  CreatedPathfinderCharacter,
  PathfinderCharacterCreationResult,
  PathfinderCharacterDraft,
} from './character/pathfinder2e.js';
export {
  PathfinderCharacterCreationError,
  validatePathfinderCharacterDraft,
} from './character/pathfinder2e.js';
// Opt-in session debug logging (eshyra-iu18): structural model-call diagnostics
// plus the sink contract the CLI implements over the data root.
export type {
  BuildModelCallEventInput,
  MarkdownSectionSize,
  MessageShape,
  ModelCallContent,
  ModelCallDebugEvent,
  ModelCallOutcome,
  ModelCallTrace,
  SessionDebugSink,
} from './debug/sessionDebug.js';
export {
  approxTokens,
  buildModelCallEvent,
  splitMarkdownSections,
} from './debug/sessionDebug.js';
export * from './index.js';
export type {
  CampaignArcRecord,
  CampaignSessionInArc,
  CloseOpenArcAndOpenNextInput,
  CloseOpenArcAndOpenNextResult,
  OpenArcIfMissingInput,
} from './memory/campaignArc.js';
// Campaign arc lifecycle (read-side + idempotent open + atomic rollover).
export {
  closeOpenArcAndOpenNext,
  getClosedArcCount,
  getClosedSessionsInOpenArc,
  getOpenArc,
  listClosedArcSummaries,
  openArcIfMissing,
  stampSessionWithOpenArc,
} from './memory/campaignArc.js';
// Memory configuration (N and K knobs for arc rollover and recap window).
export {
  DEFAULT_MEMORY_CONFIG,
  type MemoryConfig,
  validateMemoryConfig,
} from './memory/config.js';
export type {
  AlwaysOnMemoryContext,
  AlwaysOnMemorySelector,
  MemoryDrilldownResult,
  MemoryDrilldownSelector,
  MemoryRef,
  SceneSummaryRecord,
  SceneSummarySelector,
} from './memory/summary.js';
// Memory low-level primitives (scene summaries, drilldown, always-on
// selection, low-level rollups).
export {
  listSceneSummaries,
  MemorySummaryError,
  memoryDrilldown,
  recordSceneSummary,
  rollupSessionRecap,
  selectAlwaysOnMemory,
  summarizeSceneFromLog,
} from './memory/summary.js';
export type {
  RecordTurnFailureDiagnosticInput,
  TurnFailureDiagnosticKey,
  TurnFailureDiagnosticRecord,
} from './memory/turnFailureDiagnostic.js';
export {
  getTurnFailureDiagnostic,
  listTurnFailureDiagnostics,
  recordTurnFailureDiagnostic,
  redactSecrets,
  sanitizeDiagnosticMessage,
  TurnFailureDiagnosticError,
} from './memory/turnFailureDiagnostic.js';
export type {
  TraceJsonValue,
  TurnTraceConsentScope,
  TurnTraceKey,
  TurnTraceRecord,
} from './memory/turnTrace.js';
// Turn trace recorder.
export {
  getTurnTrace,
  listTurnTraces,
  recordTurnTrace,
  TurnTraceError,
} from './memory/turnTrace.js';
export type { AgentSdkDebugOptions } from './model/agentSdkClient.js';
export type {
  EvaluateModelProfileInput,
  EvaluationCostInput,
  EvaluationCostReport,
  EvaluationDimension,
  EvaluationLatencyReport,
  EvaluationReport,
  EvaluationScenario,
  EvaluationScenarioReport,
  EvaluationScores,
  EvaluationTurn,
  EvaluationTurnRecord,
  PremiumDmEvaluationThreshold,
} from './model/evaluation.js';
export {
  EVALUATION_DIMENSIONS,
  evaluateModelProfile,
  PREMIUM_DM_EVALUATION_THRESHOLD,
} from './model/evaluation.js';
export type {
  ConfiguredProfileEntry,
  ModelProfileName,
  ProfileEntry,
  ProfileRegistry,
  ProfileTier,
  ProviderId,
  UnconfiguredProfileEntry,
} from './model/profiles.js';
// Model profiles + evaluation harness.
export {
  DEFAULT_PROFILE_REGISTRY,
  getProfile,
  isProviderId,
  MODEL_PROFILES,
  PREMIUM_DM_CAPABILITY_FLOOR,
  PROVIDER_IDS,
  ProfileConfigError,
  resolveProfileRegistry,
} from './model/profiles.js';
export {
  validateJsonSchema,
  validateToolInput,
} from './model/toolSchemaValidation.js';
export type {
  AssembledContext,
  AssembledSceneRef,
  CharacterSnapshot,
  ClockSnapshot,
  ContextAssemblyInput,
  InventoryItem,
  StateSnapshot,
} from './orchestrator/contextAssembler.js';
// Context assembler + state-snapshot reader.
export {
  assembleContext,
  readStateSnapshot,
  renderContextMessage,
} from './orchestrator/contextAssembler.js';
export type { DiceNotation, DiceRoll } from './orchestrator/dice.js';
// Dice notation parser + roller.
export { DiceError, parseDice, rollDice } from './orchestrator/dice.js';
// DM-protocol prompt building and fenced tool-call parsing.
export {
  buildSystemPrompt,
  parseToolCalls,
  renderToolResults,
} from './orchestrator/protocol.js';
export type { Rng } from './orchestrator/rng.js';
// Deterministic RNG used by tools/dice.
export { createSeededRng } from './orchestrator/rng.js';
export type {
  CloseSceneInput,
  OpenSceneInput,
  SceneKey,
  SceneLogInput,
  SceneLogRecord,
  SceneLogRole,
  SceneLogWindowInput,
  SceneRecord,
  SceneStatus,
  SessionSelector,
} from './orchestrator/scene.js';
// Scene + scene-log primitives.
export {
  appendSceneLog,
  closeScene,
  countSceneLog,
  getOpenScene,
  getScene,
  listSceneLog,
  listSceneLogWindow,
  openScene,
  SceneError,
} from './orchestrator/scene.js';
export type {
  ToolRequest,
  ToolRequestSource,
} from './orchestrator/toolRequest.js';
// Transport-neutral model-requested tool action abstraction.
export { normalizeNativeToolCalls } from './orchestrator/toolRequest.js';
export type { MarkSceneToolData } from './orchestrator/tools.js';
// Tool-data helpers (the registry itself is stable; these are internals).
export { isMarkSceneToolData } from './orchestrator/tools.js';
export type { ResolveDoltOptions } from './persistence/checkpoint/doltBinary.js';
export {
  managedDoltDir,
  managedDoltRoot,
  resolveDoltBinary,
} from './persistence/checkpoint/doltBinary.js';
export { DoltCli, sqlLiteral } from './persistence/checkpoint/doltCli.js';
export type {
  DoltAsset,
  DoltConfirmFn,
  ProvisionOptions,
} from './persistence/checkpoint/doltProvision.js';
export {
  DOLT_PINNED_VERSION,
  DoltUnverifiedError,
  doltAssetFor,
  extractInvocation,
  provisionDolt,
  sha256File,
  verifyArchive,
} from './persistence/checkpoint/doltProvision.js';
export type { DoltRemote } from './persistence/checkpoint/separation.js';

// Checkpoint internals (separation guard, snapshot serialization, raw dolt
// install/provision helpers).
export {
  assertSeparateFromBeads,
  BEADS_RESERVED_REF,
  normalizeRemoteUrl,
  readDoltRemotes,
  SeparationError,
} from './persistence/checkpoint/separation.js';
export type { SnapshotRecord } from './persistence/checkpoint/serialize.js';
export {
  canonicalize,
  serializeCampaign,
} from './persistence/checkpoint/serialize.js';
// Database internals.
export { withTransaction } from './persistence/db.js';
// Built-in rules pack objects (pre-importer; superseded by 0m9 deterministic importer outputs).
// Not on the stable public surface — use @eshyra/core for consumer-facing API.
export type {
  ChangedRecord,
  FieldDelta,
  MissingFieldGroup,
  PackAudit,
  PackDiff,
  RecordDelta,
  SuspiciousRecord,
} from './rules/audit.js';
export {
  auditHasFindings,
  auditPack,
  diffHasChanges,
  diffPacks,
  formatAuditReport,
  formatDiffReport,
} from './rules/audit.js';
export { DND5E_SRD_RULES_PACK } from './rules/dnd5eSrd.js';
export { validateRecordKindSchema } from './rules/kindSchemas.js';
export type { RulesPackUsePolicy } from './rules/license.js';
export {
  assertShippableRulesPack,
  evaluateRulesPackPolicy,
} from './rules/license.js';
export type { RulesLookupInput, RulesLookupResult } from './rules/lookup.js';
export { lookupRulesRecord } from './rules/lookup.js';
export {
  loadRulesPackFromDirectory,
  PACK_MANIFEST_FILE,
  PACK_RECORDS_FILE,
} from './rules/packLoader.js';
export { PATHFINDER2E_REMASTER_RULES_PACK } from './rules/pathfinder2eRemaster.js';
// SRD raw catalog data and lookup index.
export { SRD_CATALOG, SRD_LICENSE } from './rules/srd/data.js';
export { buildSrdIndex, lookupSrdRecord } from './rules/srd/store.js';
export type {
  SrdBaseRecord,
  SrdCatalog,
  SrdClassRecord,
  SrdKind,
  SrdLicenseMetadata,
  SrdLookupInput,
  SrdLookupResult,
  SrdMonsterRecord,
  SrdRecord,
  SrdSpellRecord,
} from './rules/srd/types.js';
export type {
  SrdAuditCategory,
  SrdAuditFinding,
  SrdCoverageExpectations,
  SrdStructureAudit,
} from './rules/srdAudit.js';
export {
  auditSrd,
  auditSrdCoverage,
  auditSrdStructure,
  formatSrdAuditReport,
  srdAuditHasFindings,
} from './rules/srdAudit.js';
export type {
  ResolvedRulesStack,
  ResolveRulesStackInput,
  RulesStackKindIndex,
  RulesStackRecordEntry,
  RulesStackRecordSource,
} from './rules/stack.js';
export { normalizeRulesRecordName, resolveRulesStack } from './rules/stack.js';
export type {
  RecordProvenance,
  RulesPackSource,
  RulesRecord,
  RulesRecordKind,
} from './rules/types.js';
// Rules engine internals (pack validation, license policy, stack resolution,
// record lookup, record-shape types).
export { validateRulesPack } from './rules/validate.js';
// Active character resolution.
export {
  CharacterResolutionError,
  ensureCharacterRow,
  getActiveCharacterId,
  NoActiveCharacterError,
  resolveActingCharacterId,
  resolveCharacterId,
  resolveCharacterRef,
  setActiveCharacterId,
  tryGetActiveCharacterId,
} from './state/activeCharacter.js';
export type {
  AddConditionInput,
  AddConditionResult,
  AdjustHpResult,
  DomainMutationContext,
  GiveItemInput,
  RemoveConditionResult,
  RemoveItemResult,
  UpdateClockInput,
} from './state/domainMutations.js';
// Domain-level state mutations (higher-level wrappers over mutateState).
export {
  addCondition,
  adjustHp,
  giveItem,
  removeCondition,
  removeItem,
  setPlotFlag,
  setWorldFact,
  updateClock,
} from './state/domainMutations.js';
export type {
  AbilityScoreName,
  AbilityScores,
  CharacterConditionEntry,
  InventoryItemProperties,
  JsonValue,
} from './state/liveStateSchema.js';
// Live-state JSON schema validators (internal — no stability promise).
export {
  LiveStateSchemaError,
  validateAbilityScoresJson,
  validateConditionsJson,
  validateInventoryPropertiesJson,
} from './state/liveStateSchema.js';
export type {
  MutateStateBatchOptions,
  MutateStateInput,
  MutateStateOp,
  MutateStateTarget,
  MutateStateValue,
  StateProvenanceQuery,
  StateProvenanceRecord,
} from './state/mutateState.js';
// State mutation primitives.
export {
  getStateProvenance,
  MutateStateError,
  mutateState,
  mutateStateBatch,
} from './state/mutateState.js';
export type { PartyMember } from './state/party.js';
// Party roster reads.
export { listParty } from './state/party.js';
export { forkModuleIntoCampaign } from './world/forkCampaign.js';
export type { PackUsePolicy } from './world/license.js';
export {
  assertShippablePack,
  evaluatePackPolicy,
} from './world/license.js';
export {
  loadModuleFromDir,
  MODULE_FILE,
  parseModulePack,
} from './world/loadModule.js';
export type {
  Encounter,
  EncounterCreature,
  Location,
  LocationExit,
  Lore,
  LoreScope,
  Npc,
  Trigger,
  WorldEntityVisibility,
  WorldOverlay,
  WorldQueryResult,
  WorldQueryTarget,
  WorldTargetType,
} from './world/types.js';
// World module loader + validator + license/policy helpers.
export { validateModulePack, WorldModuleError } from './world/validate.js';
export { worldOverlayKey, worldQuery } from './world/worldQuery.js';
export {
  classifyVisibility,
  toPlayerSafeView,
} from './world/worldVisibility.js';
