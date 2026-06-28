#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  AgentSdkMcpModelClient,
  AnthropicNativeModelClient,
  assertGameplayCapable,
  CORE_VERSION,
  CodexSdkMcpModelClient,
  ConfigError,
  createDefaultToolRegistry,
  createSeededRng,
  DEFAULT_MEMORY_CONFIG,
  DEMO_TURN_CAP,
  type DoltInstallPrompt,
  EMBERFALL_HOLLOW,
  type EnsureDoltOptions,
  type EshyraConfig,
  ensureDoltAvailable,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
  type InstalledAdventureModule,
  listAdventureModulesInDir,
  listBundledAdventureModules,
  loadConfig,
  type ModelClient,
  ModelTurnAuditor,
  ModelUsageTracker,
  OpenAiNativeModelClient,
  openDatabase,
  type ResolvedProvider,
  runTurn,
  type SessionDebugSink,
  UnsupportedGameplayProviderError,
} from '@eshyra/core';
import { runAdventuresCommand } from './adventures.js';
import {
  type CampaignDeps,
  resolvePlayCampaign,
  runCampaignsCommand,
  runNewCommand,
} from './campaigns.js';
import { createFileCharacterDraftStore } from './characterDraftStore.js';
import { openCharacterRegistryStores } from './characterRegistry.js';
import { runCheckpointCommand } from './checkpoints.js';
import {
  type CliConfigFile,
  ConfigFileError,
  installConfigDefaults,
  loadConfigFile,
} from './configFile.js';
import { runCreateCharacterSubcommand } from './createCharacter.js';
import {
  adventureModulesDir,
  campaignsDir,
  characterDraftsDir,
  ensureDataRoot,
  resolveDataRoot,
} from './dataRoot.js';
import {
  type CloseableModelUsageSink,
  createUsageSink,
} from './modelUsageStore.js';
import {
  type CliIO,
  doltCheckpointRunner,
  nodeIO,
  type PlayDeps,
  runDemo,
  runPlay,
} from './play.js';
import { runForkCharacterSubcommand } from './playFork.js';
import { resolveSessionDebug } from './sessionDebug.js';
import { runUsageCommand } from './usage.js';

export function buildBanner(version: string): string {
  return `Eshyra — core v${version}`;
}

/** Format provider-auth config failures with the next command to run. */
export function formatConfigError(err: ConfigError): string {
  return [
    `config error: ${err.message}`,
    'Provide exactly one gameplay provider:',
    '  - claude-sub:    CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`)',
    '  - codex-sub:     `codex login` (a ChatGPT/Codex subscription under CODEX_HOME)',
    '  - anthropic-api: ANTHROPIC_API_KEY (an Anthropic Console key)',
    '  - openai-api:    OPENAI_API_KEY (an OpenAI API key)',
    'If more than one is available, pick with ESHYRA_AUTH_MODE=<provider> so play',
    'is never silently billed to the wrong account. Then run: eshyra play',
  ].join('\n');
}

/** ISO-8601 timestamp source shared by the play and campaign deps. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Unique, order-stable id source: a timestamp plus randomness. */
function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Interactive consent for a managed dolt install. Default answer is NO, and a
 * non-interactive stdin always declines so automation/CI can never trigger an
 * unattended binary download.
 */
export async function ttyConfirm(prompt: DoltInstallPrompt): Promise<boolean> {
  const head =
    prompt.reason === 'explicit-path-missing'
      ? `ESHYRA_DOLT_BIN="${prompt.explicitPath}" is set, but no file exists there.`
      : 'dolt was not found (PATH, managed cache, or ESHYRA_DOLT_BIN).';
  console.log(head);
  console.log(
    `Proposed: download dolt ${prompt.version} and install it to ${prompt.targetDir}`,
  );
  console.log(`Source:   ${prompt.assetUrl} (sha256-verified, fail-closed)`);
  if (!process.stdin.isTTY) {
    console.log('Non-interactive shell — declining automatically.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question('Install managed dolt now? [y/N] '))
      .trim()
      .toLowerCase();
    return ans === 'y' || ans === 'yes';
  } finally {
    rl.close();
  }
}

export interface DoltInstallDeps {
  ensure?: (opts: EnsureDoltOptions) => Promise<string>;
  confirm?: EnsureDoltOptions['confirm'];
  log?: (message: string) => void;
}

/** `eshyra dolt install` — installs only if dolt is absent and consented. */
export async function runDoltInstall(
  deps: DoltInstallDeps = {},
): Promise<number> {
  const ensure = deps.ensure ?? ensureDoltAvailable;
  const confirm = deps.confirm ?? ttyConfirm;
  const log = deps.log ?? ((m: string) => console.log(m));
  try {
    const path = await ensure({ confirm });
    log(`dolt ready: ${path}`);
    return 0;
  } catch (err) {
    log(`dolt unavailable: ${(err as Error).message}`);
    return 1;
  }
}

/**
 * Per-call debug labels. Structurally shared by every gameplay adapter's debug
 * options (Agent SDK MCP / Codex MCP / Anthropic native), so one shape works for
 * whichever provider is resolved.
 */
interface GameplayDebugOptions {
  readonly debug?: SessionDebugSink;
  readonly profile?: string;
  readonly tier?: string;
  readonly authMode?: string;
}

/** Resolved debug wiring for `eshyra play`: the shared sink plus per-call labels. */
interface PlayDebug {
  /** The shared file-backed sink, or `undefined` when debug is off. */
  readonly sink?: SessionDebugSink;
  /** Debug labels for the primary DM (gameplay) model call. */
  readonly modelDebug?: GameplayDebugOptions;
  /** Debug labels for the mechanics-audit model call. */
  readonly auditDebug?: GameplayDebugOptions;
}

/**
 * Resolve opt-in session debug wiring (eshyra-iu18 / eshyra-oobh). Returns an
 * empty bundle when `ESHYRA_DEBUG_SESSION` is unset/off, so both adapters and the
 * audit gate stay silent by default. When enabled, builds the file-backed sink,
 * prints a one-line notice, and attaches model/profile/auth labels — never
 * secrets. The primary and auditor calls share the sink but carry distinct
 * profile labels so the two model calls are separable in the log.
 */
function buildDebug(
  cfg: EshyraConfig,
  dataRoot: string,
  io: PlayDeps['io'],
): PlayDebug {
  const resolved = resolveSessionDebug(dataRoot);
  if (resolved.sink === undefined) {
    return {};
  }
  if (resolved.notice !== undefined) {
    io.write(resolved.notice);
  }

  return {
    sink: resolved.sink,
    modelDebug: {
      debug: resolved.sink,
      profile: 'premium_dm',
      tier: cfg.dmProfile.tier,
      authMode: cfg.auth.id,
    },
    auditDebug: {
      debug: resolved.sink,
      profile: 'mechanics_auditor',
      tier: 'auditor',
      authMode: cfg.auth.id,
    },
  };
}

/**
 * Construct the gameplay model client for the resolved provider (eshyra-6ygw)
 * and assert it can transport Eshyra tools natively before play begins
 * (eshyra-qa9d, ADR 0010). Each of the four providers maps to exactly one
 * adapter. API-native providers return tool calls to the Eshyra-owned loop.
 */
export function makeGameplayClient(
  provider: ResolvedProvider,
  model: string,
  role: string,
  debugOptions?: GameplayDebugOptions,
): ModelClient {
  const auth = { env: provider.env };
  let client:
    | AgentSdkMcpModelClient
    | CodexSdkMcpModelClient
    | AnthropicNativeModelClient
    | OpenAiNativeModelClient;
  switch (provider.id) {
    case 'claude-sub':
      client = new AgentSdkMcpModelClient(model, auth, debugOptions);
      break;
    case 'codex-sub':
      // Codex authenticates from the CODEX_HOME login; it takes no auth arg.
      client = new CodexSdkMcpModelClient(model, debugOptions);
      break;
    case 'anthropic-api':
      client = new AnthropicNativeModelClient(model, auth, debugOptions);
      break;
    case 'openai-api':
      client = new OpenAiNativeModelClient(model, auth, debugOptions);
      break;
  }
  assertGameplayCapable(client.capabilities, role);
  return client;
}

/**
 * Build the real, terminal-and-model-backed dependencies for `eshyra play`.
 *
 * The primary DM and the mechanics auditor run on the SAME resolved gameplay
 * provider (eshyra-6ygw) — never an independently billed call (eshyra-oobh). The
 * auditor targets the (typically smaller/faster) `cfg.auditModel`. Both calls
 * are wrapped with a {@link ModelUsageTracker} that records per-call token and
 * timing data to the shared diagnostics store (eshyra-cuxm).
 */
/**
 * The adventure modules offered by the session-start selector: the core-bundled
 * modules plus any the user has installed under `<root>/adventure-modules/`. The
 * two lists are merged with installed taking precedence over a bundled module of
 * the same id (a user override wins), then sorted by id for a stable menu order.
 */
function availableAdventureModules(
  dataRoot: string,
): InstalledAdventureModule[] {
  const byId = new Map<string, InstalledAdventureModule>();
  for (const entry of listBundledAdventureModules()) {
    byId.set(entry.module.id, entry);
  }
  for (const entry of listAdventureModulesInDir(
    adventureModulesDir(dataRoot),
  )) {
    byId.set(entry.module.id, entry);
  }
  return [...byId.values()].sort((a, b) =>
    a.module.id.localeCompare(b.module.id),
  );
}

function buildPlayDeps(
  cfg: EshyraConfig,
  io: PlayDeps['io'],
  usageStore: CloseableModelUsageSink,
  dataRoot: string,
  debug?: PlayDebug,
): PlayDeps {
  const adapterFamily = cfg.auth.adapterFamily;

  // Build the primary DM and mechanics-auditor clients for the resolved provider
  // (eshyra-6ygw). Both run on the SAME provider — never an independently billed
  // call (eshyra-oobh) — and gameplay is gated on native tool transport BEFORE
  // play begins (eshyra-qa9d, ADR 0010); makeGameplayClient asserts that.
  const primaryClient = makeGameplayClient(
    cfg.auth,
    cfg.model,
    'primary DM',
    debug?.modelDebug,
  );
  const auditClient = makeGameplayClient(
    cfg.auth,
    cfg.auditModel,
    'mechanics auditor',
    debug?.auditDebug,
  );

  // Wrap each adapter with a usage tracker sharing the same store so a single
  // session's calls are co-located in the diagnostics DB under the same filters.
  const model = new ModelUsageTracker(primaryClient, {
    model: cfg.model,
    authMode: cfg.auth.id,
    adapterFamily,
    sink: usageStore,
  });
  const auditModel = new ModelUsageTracker(auditClient, {
    model: cfg.auditModel,
    authMode: cfg.auth.id,
    adapterFamily,
    sink: usageStore,
  });
  const characterStores = openCharacterRegistryStores(dataRoot);

  return {
    io,
    openDb: (path) => openDatabase(path),
    // The SDK authenticates from the subscription token just as well as an API
    // key, so this path needs no Console API key. The resolved provider
    // credential is injected through the explicit auth seam rather than read from
    // ambient process.env.
    model,
    registry: createDefaultToolRegistry(),
    // Mechanics-audit gate: a second, lightweight subscription-backed call that
    // rejects a candidate response asserting an un-tooled mechanical outcome.
    auditor: new ModelTurnAuditor(auditModel, cfg.auditModel),
    ...(debug?.sink ? { debug: debug.sink } : {}),
    // Same store as the model trackers, so model, tool, and outcome records for
    // one session are co-located in usage.db (eshyra-17ng).
    diagnostics: usageStore,
    runTurn,
    pack: EMBERFALL_HOLLOW,
    listAdventureModules: () => availableAdventureModules(dataRoot),
    characterDraftStore: createFileCharacterDraftStore(
      characterDraftsDir(dataRoot),
    ),
    characterRegistry: characterStores.registry,
    characterChronicle: characterStores.chronicle,
    characterEngine: getDnd5eCharacterCreationEngine(),
    characterResolver: getBundledDnd5eCharacterResolver(),
    characterRng: createSeededRng((Math.random() * 0x7fffffff) | 0),
    now: nowIso,
    nextId: makeId,
    seed: () => (Math.random() * 0x7fffffff) | 0,
    makeCheckpointRunner: doltCheckpointRunner,
    memoryConfig: { ...DEFAULT_MEMORY_CONFIG },
  };
}

/** Build the dependencies for the campaign-management commands and picker. */
function buildCampaignDeps(dataRoot: string, io: CliIO): CampaignDeps {
  return {
    root: dataRoot,
    io,
    log: (message: string) => console.log(message),
    now: nowIso,
    nextId: makeId,
    pack: EMBERFALL_HOLLOW,
    openDb: (path) => openDatabase(path),
  };
}

/** A non-interactive {@link CliIO} for subcommands that never prompt. */
const SILENT_IO: CliIO = {
  write: () => {},
  prompt: async () => undefined,
};

interface CliEnv {
  dataRoot: string;
  configFile: CliConfigFile;
}

/**
 * Resolve the data root and load `config.json`, applying its non-secret
 * defaults to the environment so core resolvers honor them. Returns
 * `undefined` (after reporting to stderr) when the config file is malformed.
 */
function resolveCliEnv(): CliEnv | undefined {
  const dataRoot = resolveDataRoot();
  try {
    const configFile = loadConfigFile(dataRoot);
    installConfigDefaults(configFile);
    return { dataRoot, configFile };
  } catch (err) {
    if (err instanceof ConfigFileError) {
      console.error(`config error: ${err.message}`);
      return undefined;
    }
    throw err;
  }
}

/**
 * Load provider/model config, or report a {@link ConfigError} to stderr and
 * yield an exit code. Shared by the `play` and `demo` subcommands.
 */
function loadCliConfig():
  | { ok: true; cfg: EshyraConfig }
  | { ok: false; code: number } {
  try {
    return { ok: true, cfg: loadConfig() };
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(formatConfigError(err));
      return { ok: false, code: 1 };
    }
    throw err;
  }
}

/** `eshyra play [campaign-id]` — the interactive campaign front-end. */
export async function runPlaySubcommand(campaignArg?: string): Promise<number> {
  const cli = resolveCliEnv();
  if (cli === undefined) {
    return 1;
  }
  const config = loadCliConfig();
  if (!config.ok) {
    return config.code;
  }
  const io = nodeIO();
  const usageStore = createUsageSink(cli.dataRoot, (msg) => io.write(msg));
  try {
    let dbPath: string;
    if (config.cfg.campaignDbPath !== undefined) {
      // ESHYRA_DB_PATH set: an explicit, unmanaged campaign database
      // (ADR 0004). The registry and picker are bypassed entirely.
      dbPath = config.cfg.campaignDbPath;
    } else {
      const target = await resolvePlayCampaign(
        buildCampaignDeps(cli.dataRoot, io),
        {
          campaignArg,
          defaultCampaignId: cli.configFile.defaultCampaignId,
        },
      );
      if (!target.ok) {
        console.error(target.message);
        return 1;
      }
      io.write(
        `Playing campaign '${target.entry.name}' (id: ${target.entry.id}).`,
      );
      dbPath = target.entry.dbPath;
    }
    return await runPlay(
      buildPlayDeps(
        config.cfg,
        io,
        usageStore,
        cli.dataRoot,
        buildDebug(config.cfg, cli.dataRoot, io),
      ),
      { dbPath },
    );
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(formatConfigError(err));
      return 1;
    }
    if (err instanceof UnsupportedGameplayProviderError) {
      console.error(`gameplay provider error: ${err.message}`);
      return 1;
    }
    throw err;
  } finally {
    io.close();
    usageStore.close();
  }
}

/** Resolve the demo campaign database path. */
function demoDbPath(cli: CliEnv, cfg: EshyraConfig): string {
  if (cfg.campaignDbPath !== undefined) {
    return join(dirname(cfg.campaignDbPath), 'eshyra-demo.db');
  }
  ensureDataRoot(cli.dataRoot);
  return join(campaignsDir(cli.dataRoot), 'eshyra-demo.db');
}

/** `eshyra demo` — the bounded public demo campaign. */
export async function runDemoSubcommand(): Promise<number> {
  const cli = resolveCliEnv();
  if (cli === undefined) {
    return 1;
  }
  const config = loadCliConfig();
  if (!config.ok) {
    return config.code;
  }
  const io = nodeIO();
  const usageStore = createUsageSink(cli.dataRoot, (msg) => io.write(msg));
  try {
    return await runDemo(
      buildPlayDeps(
        config.cfg,
        io,
        usageStore,
        cli.dataRoot,
        buildDebug(config.cfg, cli.dataRoot, io),
      ),
      {
        dbPath: demoDbPath(cli, config.cfg),
        turnCap: DEMO_TURN_CAP,
      },
    );
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(formatConfigError(err));
      return 1;
    }
    if (err instanceof UnsupportedGameplayProviderError) {
      console.error(`gameplay provider error: ${err.message}`);
      return 1;
    }
    throw err;
  } finally {
    io.close();
    usageStore.close();
  }
}

/** `eshyra new [name]` — create and register a managed campaign. */
export function runNewSubcommand(argv: string[]): number {
  const cli = resolveCliEnv();
  if (cli === undefined) {
    return 1;
  }
  return runNewCommand(
    argv.slice(3),
    buildCampaignDeps(cli.dataRoot, SILENT_IO),
  );
}

/** `eshyra campaigns <list|add|remove|rename>` — manage the registry. */
export function runCampaignsSubcommand(argv: string[]): number {
  const cli = resolveCliEnv();
  if (cli === undefined) {
    return 1;
  }
  return runCampaignsCommand(
    argv.slice(3),
    buildCampaignDeps(cli.dataRoot, SILENT_IO),
  );
}

/** `eshyra checkpoint <list|restore|fork>` — campaign checkpoint workflow. */
export function runCheckpointSubcommand(argv: string[]): number {
  const cli = resolveCliEnv();
  if (cli === undefined) {
    return 1;
  }
  return runCheckpointCommand(argv.slice(3), {
    root: cli.dataRoot,
    env: process.env,
    log: (message: string) => console.log(message),
  });
}

/** `eshyra adventures [campaign-id]` — inspect adventure module state. */
export function runAdventuresSubcommand(argv: string[]): number {
  const cli = resolveCliEnv();
  if (cli === undefined) {
    return 1;
  }
  return runAdventuresCommand(argv.slice(3), {
    root: cli.dataRoot,
    env: process.env,
    log: (message: string) => console.log(message),
  });
}

/** `eshyra usage` — display model usage summary from the diagnostics store. */
export function runUsageSubcommand(argv: string[]): number {
  const cli = resolveCliEnv();
  if (cli === undefined) {
    return 1;
  }
  return runUsageCommand(argv.slice(3), {
    dataRoot: cli.dataRoot,
    log: (message: string) => console.log(message),
  });
}

/** Print the bare-invocation banner and resolved configuration summary. */
function runBanner(): void {
  console.log(buildBanner(CORE_VERSION));
  const cli = resolveCliEnv();
  if (cli === undefined) {
    process.exitCode = 1;
    return;
  }
  try {
    const cfg = loadConfig();
    console.log(`data-root=${cli.dataRoot} model=${cfg.model}`);
    if (cfg.campaignDbPath !== undefined) {
      console.log(`db=${cfg.campaignDbPath}`);
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(formatConfigError(err));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

export function main(argv: string[] = process.argv): void {
  if (argv[2] === 'dolt' && argv[3] === 'install') {
    void runDoltInstall().then((code) => {
      process.exitCode = code;
    });
    return;
  }

  if (argv[2] === 'play') {
    void runPlaySubcommand(argv[3]).then((code) => {
      process.exitCode = code;
    });
    return;
  }

  if (argv[2] === 'demo') {
    void runDemoSubcommand().then((code) => {
      process.exitCode = code;
    });
    return;
  }

  if (argv[2] === 'new') {
    process.exitCode = runNewSubcommand(argv);
    return;
  }

  if (argv[2] === 'campaigns') {
    process.exitCode = runCampaignsSubcommand(argv);
    return;
  }

  if (argv[2] === 'checkpoint') {
    process.exitCode = runCheckpointSubcommand(argv);
    return;
  }

  if (argv[2] === 'usage') {
    process.exitCode = runUsageSubcommand(argv);
    return;
  }

  if (argv[2] === 'adventures') {
    process.exitCode = runAdventuresSubcommand(argv);
    return;
  }

  if (argv[2] === 'create-character') {
    void runCreateCharacterSubcommand(argv.slice(3)).then((code) => {
      process.exitCode = code;
    });
    return;
  }

  if (argv[2] === 'fork-character') {
    void runForkCharacterSubcommand().then((code) => {
      process.exitCode = code;
    });
    return;
  }

  runBanner();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main();
}
