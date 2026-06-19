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

export type { CampaignInfo, CreateCampaignInput } from './campaign/campaign.js';
// Campaign lifecycle.
export {
  CampaignError,
  createCampaign,
  getCampaign,
} from './campaign/campaign.js';
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
} from './character/creation.js';
// Character creation (high-level, system-dispatching).
export {
  CharacterCreationError,
  completeCharacterCreation,
} from './character/creation.js';
export type {
  EshyraConfig,
  ProviderAuth,
  ProviderAuthMode,
} from './config.js';
// Configuration.
export { ConfigError, DEFAULT_AUDIT_MODEL, loadConfig } from './config.js';
export type { ComposeArcSummaryInput } from './memory/arcSummary.js';
export { composeArcSummary } from './memory/arcSummary.js';
export type { ExtractCampaignBibleInput } from './memory/campaignBibleExtractor.js';
export { extractCampaignBible } from './memory/campaignBibleExtractor.js';
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

// Model client contract + adapter capability types (ADR 0010).
export { ModelClientError, ModelRateLimitError } from './model/client.js';
export type { ConfiguredProfileEntry } from './model/profiles.js';
export type {
  JsonSchema,
  JsonSchemaType,
  ModelToolDefinition,
  ToolInputSchema,
} from './model/toolSchema.js';
export type {
  ExecutedToolCall,
  RunTurnDeps,
  RunTurnInput,
  RunTurnResult,
} from './orchestrator/orchestrator.js';
// Turn orchestrator.
export { OrchestratorError, runTurn } from './orchestrator/orchestrator.js';
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
export {
  initSchema,
  SCHEMA_VERSION,
  SchemaCompatibilityError,
} from './persistence/schema.js';
export type {
  CampaignRulesBinding,
  CampaignRulesBindingPackRef,
} from './rules/binding.js';
// Campaign rules-binding read/write API.
// Note: the built-in pack objects (DND5E_SRD_RULES_PACK, PATHFINDER2E_REMASTER_RULES_PACK) are
// intentionally NOT exported here. They are pre-importer generated-data blobs that will be
// superseded by the 0m9 deterministic importer outputs. Access them via @eshyra/core/internal
// for in-repo use only until stable, consumer-facing packs exist.
export {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
  writeCampaignRulesBinding,
} from './rules/binding.js';
export type {
  CompatibleBaseSystem,
  RecordProvenance,
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
// Built-in sample world module and module-pack shape.
export { EMBERFALL_HOLLOW } from './world/samples/emberfallHollow.js';
export type {
  ModuleMeta,
  ModulePack,
  PackLicense,
  PackLicenseClass,
  PackType,
} from './world/types.js';
