/**
 * `@eshyra/core` — stable public surface.
 *
 * This file is the **stable** entry point: every symbol exported below is
 * intended for use by external consumers (the CLI today; a future hosted/PWA
 * runtime tomorrow), and we will treat breaking changes here as breaking
 * changes to the whole project.
 *
 * Implementation details, scaffolding, low-level primitives, raw datasets,
 * evaluation/benchmark helpers, and anything that is expected to move as the
 * architecture evolves are intentionally **not** re-exported here. They live
 * behind the explicit `@eshyra/core/internal` subpath. Consumers should
 * never import that subpath from production code — it carries no compatibility
 * promise. Co-developed callers inside this repository (e.g. the CLI tests)
 * may import from `/internal` when they genuinely need to assert against
 * implementation details.
 *
 * Roughly, the stable surface here covers: configuration, opening/initialising
 * the campaign database, the campaign + session + turn lifecycle, the
 * high-level memory composition/read APIs, character creation, the built-in
 * sample content, the rules-binding read/write API, rules-pack types, the
 * model-client contract + Agent SDK adapter, demo-mode entrypoints, and the
 * Dolt-backed checkpoint store plus managed-binary install seam.
 */

// Core version (used by the CLI banner). The literal here is a build-time
// placeholder: the release build (scripts/release/build-release-artifact.mjs)
// stamps the real, tag-derived version into the compiled dist before packing.
// Non-release builds (local dev, CI, tests) keep the `-dev` sentinel.
export const CORE_VERSION = '0.0.0-dev';

// Adventure modules (authored scenario source): discovery, loading, and the
// module shape consumers list, render, and bind into campaigns.
export type { InstalledAdventureModule } from './adventure/listModules.js';
export {
  listAdventureModulesInDir,
  listBundledAdventureModules,
} from './adventure/listModules.js';
export {
  adventureModuleDirName,
  loadAdventureModuleFromDir,
} from './adventure/loadModule.js';
export type { AdventureModule } from './adventure/types.js';
// Campaign-owned adventure runs (bind a module into a campaign + track runs).
export {
  listAdventureRuns,
  startAdventureRun,
} from './campaign/adventureRun.js';
export {
  lookupCampaignAmbiguity,
  recordAmbiguityRuling,
} from './campaign/ambiguityResolution.js';
export type { CampaignInfo, CreateCampaignInput } from './campaign/campaign.js';
// Campaign lifecycle.
export {
  CampaignError,
  createCampaign,
  getCampaign,
} from './campaign/campaign.js';
export type { CampaignRulesContext } from './campaign/campaignContext.js';
// Campaign-owned rulings and house rules. These are stable because the CLI
// exposes their durable management workflow to external users.
export { assembleCampaignRulesContext } from './campaign/campaignContext.js';
export { getCurrentCampaignPosition } from './campaign/campaignPosition.js';
export {
  createCampaignRule,
  getCampaignRule,
  listActiveCampaignRulesAtPosition,
  listCampaignRules,
  revokeCampaignRule,
  supersedeCampaignRule,
} from './campaign/campaignRuleStore.js';
export type {
  CampaignPosition,
  CampaignRule,
  CampaignRuleKind,
  CampaignRuleProvenance,
  CampaignRuleStatus,
} from './campaign/campaignRules.js';
export {
  CampaignRuleError,
  formatCampaignPosition,
  parseCampaignPosition,
  validateCampaignRules,
} from './campaign/campaignRules.js';
export type {
  CreateDemoCampaignOptions,
  DemoCampaign,
  DemoContentPolicy,
  DemoModelDecision,
  DemoQualityLabel,
  DemoTurnBudget,
} from './campaign/demoMode.js';
// Demo mode (entrypoints — the policy/budget helpers live in /internal).
export {
  createDemoCampaign,
  DEFAULT_DEMO_PACK,
  DEMO_TURN_CAP,
  DemoModeError,
  getDemoTurnBudget,
} from './campaign/demoMode.js';
// Guided character-creation building blocks (the wizard UI renders on these):
// shared ability constants, ability-allocation helpers, the incremental draft
// engine, the SRD recipe, level-1 required-choice enumeration, the rules-pack
// resolver, and draft finalization.
export {
  ABILITY_FULL_NAMES,
  ABILITY_SCORE_NAMES,
} from './character/abilities.js';
export {
  ABILITY_SCORE_DICE_NOTATION,
  formatRolledAbilityScore,
  normalizeRolledAbilityScoreSet,
  parseAbilityScoreCommand,
  recommendClasses,
  rollAbilityScore,
  rollAbilityScoreSet,
  summarizePointBuy,
  summarizeStandardArray,
  validateRolledAbilityScore,
  validateRolledAbilityScoreSet,
} from './character/abilityAllocation.js';
// Attach a registry character into a campaign for play (ADR 0012).
export {
  type AttachCharacterSheetInput,
  attachCharacterSheetToCampaign,
} from './character/attachCharacter.js';
export type { CharacterBuildValidationOptions } from './character/characterBuild.js';
export {
  assertSupportedCharacterBuild,
  MULTICLASS_UNSUPPORTED,
  UnsupportedCharacterBuildError,
} from './character/characterBuild.js';
export type {
  CharacterChronicleCategory,
  CharacterChronicleEventKind,
  CharacterChronicleEventRecord,
  CharacterChroniclePortability,
  CharacterChronicleRecord,
  CharacterChronicleRelatedRef,
  CharacterChronicleSource,
  CharacterChronicleStore,
  CharacterChronicleTruthStatus,
  CharacterChronicleVisibility,
  CreateCharacterChronicleRecordInput,
  UpdateCharacterChronicleRecordInput,
} from './character/characterChronicle.js';
export {
  CharacterChronicleStoreError,
  createCharacterChronicleStore,
} from './character/characterChronicle.js';
// Cross-campaign character custody lifecycle (ADR 0012).
export {
  acquireCustodyOnResume,
  type CatchUpToHeadInput,
  type CatchUpToHeadResult,
  CharacterCustodyError,
  type CheckoutCharacterInput,
  type CheckoutCharacterResult,
  type CustodyHolderInput,
  catchUpCharacterToHead,
  checkCustodyResumable,
  checkoutCharacterIntoCampaign,
  classifyResumeConflict,
  type ForkCharacterInput,
  type ForkCharacterResult,
  forkCharacterTimeline,
  type ReleaseChronicleRecordInput,
  type ResumeClassification,
  type ResumeCustodyInput,
  type ResumeCustodyOutcome,
  registerNewCharacter,
  releaseCharacterFromCampaign,
  type SyncBackResult,
  syncBackCharacterFromCampaign,
} from './character/characterCustody.js';
export type {
  CharacterCreationDiagnostic,
  CharacterCreationEngine,
  CharacterDraft,
  StartingEquipmentMode,
  StartingWealthResult,
} from './character/characterDraft.js';
export { getDnd5eCharacterCreationEngine } from './character/characterDraft.js';
// Cross-campaign character registry (ADR 0012).
export {
  type CharacterRegistryStore,
  type CharacterRevision,
  type CharacterRevisionSource,
  type CustodyRecord,
  createCharacterRegistryStore,
  ensureCharacterRegistrySchema,
} from './character/characterRegistry.js';
// Canonical core-owned character sheet store (ADR 0011).
export {
  assertSheetMatchesPack,
  CharacterSheetPackMismatchError,
  type CharacterSheetStore,
  CharacterSheetStoreError,
  createSqliteCharacterSheetStore,
} from './character/characterSheetStore.js';
// Catch-up continuity bridge narration (ADR 0012, eshyra-lupf.14.4.3).
export {
  type ContinuityBridgeInput,
  composeContinuityBridge,
  summarizeSheetForBridge,
} from './character/continuityBridge.js';
export type {
  AbilityScoreMethod,
  AbilityScoreName,
  AbilityScores,
  CharacterCreationDraft,
  CharacterCreationResult,
  CharacterCreationSystem,
  CompleteCharacterCreationInput,
  CompleteCharacterCreationResult,
  CreatedCharacter,
  ImportFinalizedCharacterInput,
} from './character/creation.js';
// Character creation (high-level, system-dispatching).
export {
  CharacterCreationError,
  completeCharacterCreation,
  importFinalizedCharacter,
} from './character/creation.js';
export type {
  CharacterWalletEventKind,
  CharacterWalletEventRecord,
  CharacterWalletMutationResult,
  ConvertCurrencyInput,
  CurrencyDenomination,
  CurrencyMutationContext,
} from './character/currency.js';
export {
  adjustCharacterCurrency,
  convertCharacterCurrency,
  DND5E_CURRENCY_DENOMINATIONS,
  EMPTY_WALLET,
  getCharacterWallet,
  listCharacterWalletEvents,
} from './character/currency.js';
export { DND5E_SRD_CHARACTER_RECIPE } from './character/dnd5eRecipe.js';
export type {
  CharacterSheet,
  CharacterWallet,
} from './character/finalizeCharacter.js';
export { finalizeCharacterDraft } from './character/finalizeCharacter.js';
export type {
  GuidedLevelUpInput,
  GuidedLevelUpOutcome,
  GuidedLevelUpResult,
} from './character/guidedLevelUpFlow.js';
export { runGuidedLevelUp } from './character/guidedLevelUpFlow.js';
export type {
  AppliedAbilityScoreIncrease,
  LevelUpChangeSet,
  LevelUpChoiceSelections,
  LevelUpHitPointChoice,
  LevelUpRequiredChoice,
} from './character/levelUpEngine.js';
export { enumerateLevel1RequiredChoices } from './character/requiredChoices.js';
export type { RulesPackCharacterResolver } from './character/rulesPackResolver.js';
export { getBundledDnd5eCharacterResolver } from './character/rulesPackResolver.js';
export type {
  DerivedModifierContribution,
  DerivedSpellcastingValues,
  DeriveSpellcastingValuesInput,
} from './character/spellcastingDerivation.js';
export { deriveSpellcastingValues } from './character/spellcastingDerivation.js';
export {
  resolveStartingWealth,
  rollStartingWealth,
  validateStartingWealthResult,
} from './character/srdStartingWealth.js';
export type {
  AdapterFamily as ConfigAdapterFamily,
  EshyraConfig,
  GameplayProvider,
  ProviderProbes,
  ProviderSelection,
  ProviderVendor,
  ResolvedProvider,
} from './config.js';
// Configuration.
export {
  ConfigError,
  DEFAULT_AUDIT_MODEL,
  defaultCodexLoginPresent,
  GAMEPLAY_PROVIDERS,
  loadConfig,
} from './config.js';
// Opt-in session debug logging: the structural model-call diagnostic events and
// the sink contract a consumer implements over its data root.
export type {
  ModelCallDebugEvent,
  SessionDebugSink,
  TurnAuditDebugEvent,
  TurnCandidateDispositionEvent,
} from './debug/sessionDebug.js';
export type { ComposeArcSummaryInput } from './memory/arcSummary.js';
export { composeArcSummary } from './memory/arcSummary.js';
// Campaign arc lifecycle (read-side + idempotent open + atomic rollover).
export {
  closeOpenArcAndOpenNext,
  getClosedSessionsInOpenArc,
  listClosedArcSummaries,
  openArcIfMissing,
} from './memory/campaignArc.js';
export type { ExtractCampaignBibleInput } from './memory/campaignBibleExtractor.js';
export { extractCampaignBible } from './memory/campaignBibleExtractor.js';
// Memory configuration (N/K knobs for arc rollover and recap window).
export type { MemoryConfig } from './memory/config.js';
export {
  DEFAULT_MEMORY_CONFIG,
  validateMemoryConfig,
} from './memory/config.js';
export type {
  ComposeSessionRecapInput,
  ComposeSessionRecapResult,
} from './memory/recapBuilder.js';
// Memory: high-level composition and read APIs.
export { composeSessionRecap } from './memory/recapBuilder.js';
export type {
  ArcSummaryInput,
  ArcSummaryKey,
  ArcSummaryRecord,
  CampaignBibleEntry,
  CampaignBibleInput,
  CampaignBibleKey,
  CampaignBibleRecord,
  SessionRecapInput,
  SessionRecapRecord,
} from './memory/summary.js';
export {
  getArcSummary,
  getCampaignBible,
  getSessionRecap,
  rollupArcSummary,
} from './memory/summary.js';
export type {
  AgentSdkAuth,
  AgentSdkAuthSource,
} from './model/agentSdkClient.js';
export {
  AGENT_SDK_LEGACY_ADAPTER_CAPABILITIES,
  AgentSdkModelClient,
} from './model/agentSdkClient.js';
export type { AgentSdkMcpDebugOptions } from './model/agentSdkMcpClient.js';
// Agent SDK in-process MCP adapter — the released gameplay tool transport
// (eshyra-eznk, ADR 0010). Exposes Eshyra tools to the model through the
// SDK's SUPPORTED custom-tool path (`tool()` + `createSdkMcpServer`), so the
// subscription-backed `eshyra play` path needs no Anthropic API key.
export {
  AGENT_SDK_MCP_ADAPTER_CAPABILITIES,
  AGENT_SDK_MCP_CLIENT_NAME,
  AGENT_SDK_MCP_TOOL_PROTOCOL,
  AgentSdkMcpModelClient,
  ESHYRA_MCP_SERVER_NAME,
  fromMcpToolName,
  toMcpToolName,
} from './model/agentSdkMcpClient.js';
export type {
  AnthropicAuth,
  AnthropicAuthSource,
  AnthropicNativeDebugOptions,
} from './model/anthropicNativeClient.js';
// Lower-level Anthropic Messages adapter (eshyra-eznk, ADR 0010). Returns
// native `ModelToolCall[]` for the outer turn loop; the API-key-native
// alternative when no subscription token is in use.
export {
  ANTHROPIC_NATIVE_ADAPTER_CAPABILITIES,
  ANTHROPIC_NATIVE_TOOL_PROTOCOL,
  AnthropicNativeModelClient,
} from './model/anthropicNativeClient.js';
export type {
  AdapterFamily,
  ModelAdapterCapabilities,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
  ModelMessage,
  ModelProfileMetadata,
  ModelResponseFormat,
  ModelStopReason,
  ModelToolCall,
  ModelToolExecutionResult,
  ModelToolExecutor,
  ModelToolResult,
  ModelTraceMetadata,
  ModelUsage,
  ProviderExecutedToolCall,
  ToolTransport,
  TurnLoopOwner,
} from './model/client.js';
// Model client contract + adapter capability types (ADR 0010). The gameplay
// capability gate (eshyra-qa9d) rejects fenced-text adapters before play begins.
export {
  assertGameplayCapable,
  ModelClientError,
  ModelRateLimitError,
  UnsupportedGameplayProviderError,
} from './model/client.js';
export type { CodexSdkMcpDebugOptions } from './model/codexSdkMcpClient.js';
// Codex SDK in-process-MCP adapter (eshyra-jl8n, ADR 0010) — the OpenAI/Codex
// sibling of the Agent SDK MCP adapter. Hosts an in-process Streamable-HTTP MCP
// server so Codex executes Eshyra tools in the live turn process; authenticates
// from a Codex subscription with no API-key fallback. The Codex/MCP SDKs load
// lazily, so this re-export does not pull them into editions that omit Codex.
export {
  CODEX_SDK_MCP_ADAPTER_CAPABILITIES,
  CODEX_SDK_MCP_CLIENT_NAME,
  CODEX_SDK_MCP_TOOL_PROTOCOL,
  CodexSdkMcpModelClient,
} from './model/codexSdkMcpClient.js';
export type {
  OpenAiAuth,
  OpenAiAuthSource,
  OpenAiNativeDebugOptions,
} from './model/openaiNativeClient.js';
// OpenAI Chat Completions adapter (eshyra-fxxf, ADR 0010). Returns native
// `ModelToolCall[]` for the Eshyra-owned outer turn loop.
export {
  OPENAI_NATIVE_ADAPTER_CAPABILITIES,
  OPENAI_NATIVE_TOOL_PROTOCOL,
  OpenAiNativeModelClient,
} from './model/openaiNativeClient.js';
export type { ConfiguredProfileEntry } from './model/profiles.js';
export type {
  JsonSchema,
  JsonSchemaType,
  ModelToolDefinition,
  ToolInputSchema,
} from './model/toolSchema.js';
// Model usage tracking: per-call/tool/turn records, sink contracts, decorator.
export type {
  AuditRetryCause,
  ModelUsageRecord,
  ModelUsageSink,
  ToolUsageRecord,
  TurnAuditRecord,
  TurnDiagnosticsSink,
  TurnOutcome,
  TurnOutcomeRecord,
} from './model/usage.js';
export { ModelUsageTracker } from './model/usage.js';
// Adventure module progress audit/debug output.
export {
  buildCampaignAdventureAudit,
  formatCampaignAdventureAudit,
} from './orchestrator/adventureAudit.js';
export type { RecentSceneEvidence } from './orchestrator/contextAssembler.js';
export { rollDice } from './orchestrator/dice.js';
export type {
  ExecutedToolCall,
  RunTurnDeps,
  RunTurnInput,
  RunTurnResult,
} from './orchestrator/orchestrator.js';
// Turn orchestrator.
export { OrchestratorError, runTurn } from './orchestrator/orchestrator.js';
export type { Rng } from './orchestrator/rng.js';
// Deterministic RNG used by tools/dice.
export { createSeededRng } from './orchestrator/rng.js';
export type { Tool, ToolContext, ToolResult } from './orchestrator/tools.js';
// Tool registry contract — the supported plug-in seam for custom tools.
export {
  createDefaultToolRegistry,
  DEFAULT_TOOLS,
  ToolRegistry,
} from './orchestrator/tools.js';
export type {
  AuditVerdict,
  TurnAuditInput,
  TurnAuditor,
} from './orchestrator/turnAuditor.js';
// Mechanics-audit gate (eshyra-oobh): the turn-referee that enforces canonical
// tool use before a candidate DM response is shown or persisted.
export {
  AuditError,
  ModelTurnAuditor,
} from './orchestrator/turnAuditor.js';
export { DoltUnavailableError } from './persistence/checkpoint/doltBinary.js';
export type {
  DoltInstallPrompt,
  DoltInstallReason,
  EnsureDoltOptions,
} from './persistence/checkpoint/doltProvision.js';
export { ensureDoltAvailable } from './persistence/checkpoint/doltProvision.js';
export type { Checkpoint } from './persistence/checkpoint/doltRepo.js';
export { DoltRepo } from './persistence/checkpoint/doltRepo.js';
// Dolt-backed checkpoint store + managed-binary install seam.
export {
  CheckpointError,
  CheckpointStore,
} from './persistence/checkpoint/store.js';
export type { Db } from './persistence/db.js';
// Live campaign database.
export { openDatabase } from './persistence/db.js';
export { initSchema } from './persistence/schema.js';
export type {
  CampaignRulesBinding,
  CampaignRulesBindingPackRef,
} from './rules/binding.js';
// Campaign rules-binding read/write API.
// Note: the bundled rules packs are intentionally NOT exported from the root.
// The D&D SRD pack is loaded at runtime from the packaged data dir via
// getBundledDnd5eSrdPack (ADR 0013); the in-code Pathfinder fixture
// (PATHFINDER2E_REMASTER_RULES_PACK) is pre-importer data. Access either via
// @eshyra/core/internal for in-repo use only until a stable consumer-facing
// pack surface exists.
export {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
  writeCampaignRulesBinding,
} from './rules/binding.js';
export type {
  CompatibleBaseSystem,
  RecordProvenance,
  RulesAmbiguity,
  RulesPack,
  RulesPackLicense,
  RulesPackLicenseClass,
  RulesPackMeta,
  RulesPackRole,
  RulesPackSource,
} from './rules/types.js';
export { RulesPackError } from './rules/types.js';
export type {
  CloseSessionGracefullyInput,
  CloseSessionGracefullyResult,
  SessionCheckpointRunner,
} from './session/close.js';
// Graceful session close (commits a recap + checkpoint hand-off).
export { closeSessionGracefully } from './session/close.js';
export type { SessionLaunchState } from './session/launch.js';
// Session launch (resume-or-new view used by the play UI).
export { getSessionLaunchState } from './session/launch.js';
export type {
  CampaignSelector,
  CloseSessionInput,
  SessionKey,
  SessionRecord,
  SessionStatus,
  StartSessionInput,
} from './session/session.js';
// Session lifecycle.
export {
  closeSession,
  getOpenSession,
  getSession,
  listSessions,
  SessionError,
  startSession,
} from './session/session.js';
// Active character resolution + party roster reads.
export {
  CharacterResolutionError,
  resolveCharacterRef,
  setActiveCharacterId,
} from './state/activeCharacter.js';
export type { CampaignRulesPackResolver } from './state/campaignRecordLookup.js';
export { resolveStrictCampaignRulesStack } from './state/campaignRecordLookup.js';
export type { CombatInstance } from './state/encounterCombatants.js';
// Active-combat lookup (used by the resume conflict-resolution UX to warn
// before catching a character up mid-combat — ADR 0012, eshyra-lupf.14.4).
export { getActiveCombatInstance } from './state/encounterCombatants.js';
export type { LifeState } from './state/hpLifecycle.js';
// Compact HP/death-state roster fragment shared by the prompt and CLI (F6).
export { formatHpStatus } from './state/hpLifecycle.js';
export type { LevelUpEligibility } from './state/levelUpEligibility.js';
export { getLevelUpEligibility } from './state/levelUpEligibility.js';
export { listParty } from './state/party.js';
export type {
  ProgressionEventKind,
  ProgressionEventRecord,
  ProgressionState,
} from './state/progression.js';
export {
  getProgressionState,
  listProgressionEvents,
} from './state/progression.js';
// Built-in sample world module and module-pack shape.
export { EMBERFALL_HOLLOW } from './world/samples/emberfallHollow.js';
export type {
  ModuleMeta,
  ModulePack,
  PackLicense,
  PackLicenseClass,
  PackType,
} from './world/types.js';
