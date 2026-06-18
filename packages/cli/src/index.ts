#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  AgentSdkModelClient,
  CORE_VERSION,
  ConfigError,
  createDefaultToolRegistry,
  DEMO_TURN_CAP,
  type DoltInstallPrompt,
  EMBERFALL_HOLLOW,
  type EnsureDoltOptions,
  type EshyraConfig,
  ensureDoltAvailable,
  loadConfig,
  openDatabase,
  runTurn,
} from '@eshyra/core';
import {
  type AgentSdkDebugOptions,
  DEFAULT_MEMORY_CONFIG,
} from '@eshyra/core/internal';
import {
  type CampaignDeps,
  resolvePlayCampaign,
  runCampaignsCommand,
  runNewCommand,
} from './campaigns.js';
import { runCheckpointCommand } from './checkpoints.js';
import {
  type CliConfigFile,
  ConfigFileError,
  installConfigDefaults,
  loadConfigFile,
} from './configFile.js';
import { campaignsDir, ensureDataRoot, resolveDataRoot } from './dataRoot.js';
import {
  type CliIO,
  doltCheckpointRunner,
  nodeIO,
  type PlayDeps,
  runDemo,
  runPlay,
} from './play.js';
import { resolveSessionDebug } from './sessionDebug.js';

export function buildBanner(version: string): string {
  return `Eshyra — core v${version}`;
}

/** Format provider-auth config failures with the next command to run. */
export function formatConfigError(err: ConfigError): string {
  return [
    `config error: ${err.message}`,
    'For the Claude Agent SDK adapter, set ANTHROPIC_API_KEY (a Console API',
    'key) or CLAUDE_CODE_OAUTH_TOKEN (a Claude Pro/Max subscription token).',
    'Then run: eshyra play',
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
 * Resolve opt-in session debug wiring for the model client (eshyra-iu18).
 * Returns `undefined` when `ESHYRA_DEBUG_SESSION` is unset/off, so the adapter
 * stays silent by default. When enabled, builds the file-backed sink, prints a
 * one-line notice, and attaches the model/profile/auth labels — never secrets.
 */
function buildModelDebug(
  cfg: EshyraConfig,
  dataRoot: string,
  io: PlayDeps['io'],
): AgentSdkDebugOptions | undefined {
  const resolved = resolveSessionDebug(dataRoot);
  if (resolved.sink === undefined) {
    return undefined;
  }
  if (resolved.notice !== undefined) {
    io.write(resolved.notice);
  }
  return {
    debug: resolved.sink,
    profile: 'premium_dm',
    tier: cfg.dmProfile.tier,
    authMode: cfg.auth.mode,
  };
}

/**
 * Build the real, terminal-and-model-backed dependencies for `eshyra play`.
 */
function buildPlayDeps(
  cfg: EshyraConfig,
  io: PlayDeps['io'],
  debug?: AgentSdkDebugOptions,
): PlayDeps {
  return {
    io,
    openDb: (path) => openDatabase(path),
    // Inject the resolved provider credential through the explicit auth seam
    // rather than letting the Agent SDK read ambient process.env.
    model: new AgentSdkModelClient(cfg.model, { env: cfg.auth.env }, debug),
    registry: createDefaultToolRegistry(),
    runTurn,
    pack: EMBERFALL_HOLLOW,
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
        buildModelDebug(config.cfg, cli.dataRoot, io),
      ),
      { dbPath },
    );
  } finally {
    io.close();
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
  try {
    return await runDemo(
      buildPlayDeps(
        config.cfg,
        io,
        buildModelDebug(config.cfg, cli.dataRoot, io),
      ),
      {
        dbPath: demoDbPath(cli, config.cfg),
        turnCap: DEMO_TURN_CAP,
      },
    );
  } finally {
    io.close();
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

  runBanner();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main();
}
