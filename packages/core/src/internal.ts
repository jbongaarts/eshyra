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

export type { InstalledAdventureModule } from './adventure/listModules.js';
export {
  listAdventureModulesInDir,
  listBundledAdventureModules,
} from './adventure/listModules.js';
export {
  ADVENTURE_MODULE_FILE,
  adventureModuleDirName,
  loadAdventureModuleFromDir,
  parseAdventureModule,
} from './adventure/loadModule.js';
export type { AdventureReferenceContext } from './adventure/references.js';
export { validateAdventureModuleReferences } from './adventure/references.js';
// Adventure module schema (immutable authored scenario source) + validator.
export type {
  AdventureClock,
  AdventureEncounter,
  AdventureEncounterCreature,
  AdventureEndingState,
  AdventureHook,
  AdventureLocation,
  AdventureMilestone,
  AdventureModule,
  AdventureNpc,
  AdventureObjective,
  AdventureRandomTableRef,
  AdventureScene,
  AdventureSecret,
  AdventureTreasure,
  EndingKind,
  LevelRange,
  PartySizeRange,
  SceneKind,
  SettingCompatibilityRef,
} from './adventure/types.js';
export {
  AdventureModuleError,
  validateAdventureModule,
} from './adventure/validate.js';
// Campaign-owned adventure run / module binding + mutable module progress.
export type {
  AdventureClockState,
  AdventureEncounterOutcome,
  AdventureModuleDeviation,
  AdventureRun,
  AdventureRunKey,
  AdventureRunProgress,
  AdventureRunProgressDelta,
  AdventureRunStatus,
  EncounterResolution,
  RecordAdventureRunProgressInput,
  StartAdventureRunInput,
} from './campaign/adventureRun.js';
export {
  AdventureRunError,
  getAdventureRun,
  listAdventureRuns,
  recordAdventureRunProgress,
  startAdventureRun,
} from './campaign/adventureRun.js';
// Demo-mode policy + budget helpers (the high-level entrypoints are stable).
export {
  assertDemoContentAllowed,
  assertDemoTurnAllowed,
  demoTurnBudget,
  evaluateDemoContent,
  resolveDemoModel,
} from './campaign/demoMode.js';
// Shared D&D 5e ability-score rules constants/helpers (eshyra-b69j.5/.7).
export {
  ABILITY_ABBREVIATIONS,
  ABILITY_FULL_NAMES,
  ABILITY_SCORE_NAMES,
  abilityModifier,
  abilityNameFromToken,
  FREE_ENTRY_MAX_SCORE,
  FREE_ENTRY_MIN_SCORE,
  isPlausibleFreeEntryScore,
  POINT_BUY_BUDGET,
  POINT_BUY_COSTS,
  pointBuyCost,
  STANDARD_ARRAY,
} from './character/abilities.js';
// Ability-score entry and allocation domain layer (eshyra-b69j.7): the
// UI-agnostic building blocks (point-buy budget, standard-array/rolled pool
// assignment, dice rolling, class recommendations, entry-command parsing) the
// concept-first and ability-first wizard flows render on top of the engine.
export type {
  AbilityScoreCommand,
  ClassRecommendation,
  PartialAbilityScores,
  PointBuyLine,
  PointBuySummary,
  PoolAssignment,
  RecommendClassesOptions,
  RolledAbilityScore,
} from './character/abilityAllocation.js';
export {
  parseAbilityScoreCommand,
  recommendClasses,
  rollAbilityScore,
  rollAbilityScoreSet,
  summarizePointBuy,
  summarizePoolAssignment,
  summarizeStandardArray,
} from './character/abilityAllocation.js';
// Incremental character-creation draft engine (eshyra-b69j.5): a serializable
// work-in-progress draft plus a pure, dependency-aware engine that preserves
// prior answers, validates incrementally, and avoids prerequisite cascades.
export type {
  CharacterCreationDiagnostic,
  CharacterCreationEngine,
  CharacterDraft,
  CharacterDraftDerived,
  CharacterDraftIdentity,
  CreateDraftInput,
  Dnd5eDraftSelections,
  DraftDiagnosticSeverity,
  FinalizableDraftResult,
  RequiredChoice,
} from './character/characterDraft.js';
export {
  createCharacterCreationEngine,
  getDnd5eCharacterCreationEngine,
} from './character/characterDraft.js';
export type {
  AbilityScoreMethod,
  CharacterCreationMutationMetadata,
} from './character/creation.js';
// Character-creation low-level helpers + Pathfinder-specific draft validator
// (the high-level `completeCharacterCreation` is the stable entrypoint).
export {
  buildCharacterCreationMutations,
  validateCharacterDraft,
} from './character/creation.js';
// Deterministic level-1 derived-value computation (eshyra-b69j.6): the single
// pure source the draft engine and the recipe both derive from.
export type {
  CharacterDerivedValues,
  DerivedClassInput,
  DeriveLevel1Input,
  SavingThrowDerived,
} from './character/derivedValues.js';
export {
  deriveLevel1Values,
  LEVEL_1_PROFICIENCY_BONUS,
} from './character/derivedValues.js';
export type { Dnd5eCreationMode } from './character/dnd5eRecipe.js';
export {
  DND5E_SRD_CHARACTER_RECIPE,
  resolveCharacterCreationRecipe,
} from './character/dnd5eRecipe.js';
export type {
  CreatedPathfinderCharacter,
  PathfinderCharacterCreationResult,
  PathfinderCharacterDraft,
} from './character/pathfinder2e.js';
export {
  PathfinderCharacterCreationError,
  validatePathfinderCharacterDraft,
} from './character/pathfinder2e.js';
// Character-creation recipe boundary (eshyra-b69j.4): the system-agnostic
// contract plus the D&D 5e SRD recipe that owns modes, step order, validation,
// derived values, and finalization. The shared creation shell depends only on
// the contract; Pathfinder stays future-compatible without a recipe here.
export type {
  CharacterCreationMode,
  CharacterCreationRecipe,
  CharacterCreationStep,
  RecipeDraftValidation,
  RecipeFinalization,
} from './character/recipe.js';
// Level-1 required-choice enumeration (eshyra-b69j.12): turns a resolved class
// (+ ancestry/background) into structured vs prose-only (tracked) required
// choices, so the CLI never parses prose to discover core mechanical choices.
export type {
  EnumerateRequiredChoicesInput,
  Level1RequiredChoice,
  Level1RequiredChoiceKind,
  Level1RequiredChoiceSource,
  Level1RequiredChoiceStatus,
} from './character/requiredChoices.js';
export { enumerateLevel1RequiredChoices } from './character/requiredChoices.js';
// Generated-rules-pack character resolver (eshyra-b69j.3 / eshyra-x50w):
// resolves class/spell/ancestry choices for character creation against the
// runtime SRD pack, replacing the retired hand-authored SRD_CATALOG.
export type {
  CharacterResolution,
  ResolvedAncestryData,
  ResolvedAncestryTrait,
  ResolvedBackgroundData,
  ResolvedChoiceSpec,
  ResolvedClassData,
  ResolvedClassLevel1,
  ResolvedLevelSpellcasting,
  ResolvedSpellData,
  ResolvedStartingEquipment,
  RulesPackCharacterResolver,
} from './character/rulesPackResolver.js';
export {
  createRulesPackCharacterResolver,
  getBundledDnd5eCharacterResolver,
} from './character/rulesPackResolver.js';
// Source-cited ancestry ability-score-increase overlay (eshyra-b69j.12.1): a
// deterministic, consumer-side metadata layer keyed to the frozen ancestry
// record keys, supplying the increases the frozen pack carries only as prose.
export type {
  AbilityScoreIncrease,
  AbilityScoreIncreaseChoice,
  AncestryAbilityScoreIncrease,
} from './character/srdAncestryAbilityScoreIncreases.js';
export { getAncestryAbilityScoreIncrease } from './character/srdAncestryAbilityScoreIncreases.js';
// Source-cited per-class spellcasting overlay (eshyra-b69j.12.2): a
// deterministic, consumer-side layer keyed to the frozen class record keys,
// supplying the spellcasting ability and prepared-count formulas the frozen pack
// carries only as (truncated) prose.
export type {
  ClassSpellcasting,
  SpellPreparation,
} from './character/srdClassSpellcasting.js';
export {
  castsAtLevel1,
  getClassSpellcasting,
  level1PreparedSpellCount,
  level1SpellcastingAbility,
} from './character/srdClassSpellcasting.js';
// Source-cited class starting-equipment overlay (eshyra-b69j.12.3): a
// deterministic, consumer-side layer keyed to the frozen class record keys,
// structuring each class's starting equipment into choose-one groups and fixed
// grants the frozen pack carries only as prose.
export type {
  ClassStartingEquipment,
  StartingEquipmentChoice,
  StartingEquipmentEntry,
  StartingEquipmentGrant,
  StartingEquipmentOption,
} from './character/srdClassStartingEquipment.js';
export { getClassStartingEquipment } from './character/srdClassStartingEquipment.js';
// Opt-in session debug logging (eshyra-iu18): structural model-call diagnostics
// plus the sink contract the CLI implements over the data root.
export type {
  BuildModelCallEventInput,
  CandidateDisposition,
  MarkdownSectionSize,
  McpServerStatus,
  MessageShape,
  ModelCallContent,
  ModelCallDebugEvent,
  ModelCallOutcome,
  ModelCallTrace,
  SessionDebugSink,
  ToolCallDisposition,
  TurnAuditDebugEvent,
  TurnCandidateDispositionEvent,
} from './debug/sessionDebug.js';
export {
  approxTokens,
  buildModelCallEvent,
  sanitizePromptSectionName,
  splitPromptSections,
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
  ModelTierCandidate,
  ModelTierEvaluationMatrixReport,
  ModelTierEvaluationPhase,
  ModelTierEvaluationPhaseId,
  ModelTierEvaluationRole,
  ModelTierEvaluationScenario,
  ModelTierMechanicalSummary,
  ModelTierPairing,
  ModelTierPairReport,
  ModelTierPairRun,
  ModelTierProvider,
  ModelTierRollFixture,
  ModelTierScenarioTurn,
  ModelTierScenarioTurnKind,
  ModelTierTableFeelSummary,
  ModelTierTurnMetrics,
  ModelTierUsageEstimate,
  ModelTierUsageSummary,
  PremiumDmEvaluationThreshold,
  RunModelTierEvaluationInput,
} from './model/evaluation.js';
export {
  EVALUATION_DIMENSIONS,
  evaluateModelProfile,
  FIRST_COMBAT_MODEL_TIER_SCENARIO,
  MODEL_TIER_EVALUATION_PAIRINGS,
  MODEL_TIER_EVALUATION_PHASES,
  PREMIUM_DM_EVALUATION_THRESHOLD,
  runModelTierEvaluationMatrix,
  summarizeModelTierPairRun,
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
// Model usage tracking: purpose enum, per-call record, sink contract, decorator.
// Plus per-turn timing diagnostics: tool spans + turn outcomes (eshyra-17ng).
export type {
  AuditRetryCause,
  ModelFailureKind,
  ModelUsagePurpose,
  ModelUsageRecord,
  ModelUsageSink,
  ModelUsageTrackerOptions,
  ToolUsageRecord,
  ToolUsageSink,
  ToolUsageSource,
  TurnAuditRecord,
  TurnAuditSink,
  TurnDiagnosticsSink,
  TurnOutcome,
  TurnOutcomeRecord,
  TurnOutcomeSink,
} from './model/usage.js';
export {
  ModelUsageTracker,
  NoopModelUsageSink,
  NoopTurnDiagnosticsSink,
} from './model/usage.js';
export type {
  AdventureModuleSourceSummary,
  AdventureObjectiveAuditView,
  AdventureRunAudit,
  AdventureSecretAuditView,
  BuildCampaignAdventureAuditInput,
  CampaignAdventureAudit,
} from './orchestrator/adventureAudit.js';
// Adventure module progress audit/debug output.
export {
  buildCampaignAdventureAudit,
  formatCampaignAdventureAudit,
} from './orchestrator/adventureAudit.js';
export type {
  AdventureClockContext,
  AdventureCompletedElements,
  AdventureContextSlice,
  AdventureEncounterContext,
  AdventureExitContext,
  AdventureLocationContext,
  AdventureNpcContext,
  AdventureObjectiveContext,
  AdventureObjectiveStatus,
  AdventureSceneContext,
  AdventureSecretContext,
  BuildAdventureContextOptions,
} from './orchestrator/adventureContext.js';
// Bounded adventure-module context slice builder + renderer.
export {
  buildAdventureContextSlice,
  renderAdventureContextSlice,
} from './orchestrator/adventureContext.js';
export type {
  AdventureModuleResolver,
  AssembledContext,
  AssembledSceneRef,
  CharacterSnapshot,
  ClockSnapshot,
  ContextAssemblyInput,
  InventoryItem,
  RecentSceneEvidence,
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
  getLastDmOutput,
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
export type { Db } from './persistence/db.js';
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
export {
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  DND5E_SRD_VERSION,
  getBundledDnd5eSrdPack,
  RETIRED_DND5E_SRD_PLACEHOLDER_PACK_ID,
} from './rules/bundledSrdPack.js';
export { validateRecordKindSchema } from './rules/kindSchemas.js';
export type { RulesPackUsePolicy } from './rules/license.js';
export {
  assertShippableRulesPack,
  evaluateRulesPackPolicy,
} from './rules/license.js';
export type { RulesLookupInput, RulesLookupResult } from './rules/lookup.js';
export {
  lookupRulesRecord,
  RULES_LOOKUP_AMBIGUOUS_CANDIDATE_CAP,
} from './rules/lookup.js';
export {
  loadRulesPackFromDirectory,
  PACK_MANIFEST_FILE,
  PACK_RECORDS_FILE,
} from './rules/packLoader.js';
export { PATHFINDER2E_REMASTER_RULES_PACK } from './rules/pathfinder2eRemaster.js';
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
  ActorKind,
  ActorSourceKind,
  ActorStatus,
  CampaignActor,
  CloseCombatInstanceInput,
  CombatantStatus,
  CombatInstance,
  CombatInstanceStatus,
  EncounterCombatant,
  StartEncounterInput,
  StartEncounterResult,
  UpdateCombatantInput,
  UpdateCombatantResult,
  UpsertCampaignActorInput,
} from './state/encounterCombatants.js';
export {
  closeCombatInstance,
  EncounterCombatantError,
  getCampaignActor,
  listCampaignActors,
  listCombatants,
  listCombatantsForInstance,
  readCombatInstance,
  startEncounter,
  updateCombatant,
  upsertCampaignActor,
} from './state/encounterCombatants.js';
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
export type {
  CampaignOverlayLoreQuery,
  CampaignOverlayLoreRecord,
  CanonTier,
  OverlayLoreKind,
  OverlayLoreScope,
  OverlayLoreSignificance,
  OverlayLoreSource,
  OverlayLoreTruthStatus,
  OverlayLoreVisibility,
  RecordCampaignOverlayLoreInput,
} from './world/campaignOverlayLore.js';
export {
  CampaignOverlayLoreError,
  getCampaignOverlayLore,
  queryCampaignOverlayLore,
  recordCampaignOverlayLore,
} from './world/campaignOverlayLore.js';
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
  WorldCanonEvidence,
  WorldEntityVisibility,
  WorldOverlay,
  WorldQueryResult,
  WorldQueryTarget,
  WorldSearchResult,
  WorldTargetType,
} from './world/types.js';
// World module loader + validator + license/policy helpers.
export { validateModulePack, WorldModuleError } from './world/validate.js';
export { worldOverlayKey, worldQuery } from './world/worldQuery.js';
export {
  classifyVisibility,
  toPlayerSafeView,
} from './world/worldVisibility.js';
