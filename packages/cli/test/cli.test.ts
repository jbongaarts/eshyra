import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCampaign,
  getOpenSession,
  openDatabase,
  type ResolvedProvider,
} from '@eshyra/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBanner,
  main,
  makeGameplayClient,
  runDoltInstall,
} from '../src/index.js';

/** A resolved provider record for makeGameplayClient mapping tests. */
function provider(
  id: ResolvedProvider['id'],
  vendor: ResolvedProvider['vendor'],
  adapterFamily: ResolvedProvider['adapterFamily'],
  env: Record<string, string> = {},
): ResolvedProvider {
  return { id, vendor, adapterFamily, env };
}

describe('cli', () => {
  it('builds a banner that includes the core version', () => {
    expect(buildBanner('1.2.3')).toBe('Eshyra — core v1.2.3');
  });
});

describe('runDoltInstall', () => {
  it('reports the path and exits 0 when dolt is ready', async () => {
    const logs: string[] = [];
    const code = await runDoltInstall({
      ensure: async ({ confirm }) => {
        // already-present path: ensure() resolves without consulting confirm
        void confirm;
        return '/usr/bin/dolt';
      },
      log: (m) => logs.push(m),
    });
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('/usr/bin/dolt');
  });

  it('exits 1 with the actionable message when install is declined', async () => {
    const logs: string[] = [];
    const code = await runDoltInstall({
      ensure: async () => {
        throw new Error('a managed install was declined');
      },
      log: (m) => logs.push(m),
    });
    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('declined');
  });

  it('passes a confirm callback through to ensureDoltAvailable', async () => {
    const ensure = vi.fn().mockResolvedValue('/x/dolt');
    await runDoltInstall({ ensure, confirm: () => true });
    expect(ensure).toHaveBeenCalledOnce();
    expect(typeof ensure.mock.calls[0][0].confirm).toBe('function');
  });
});

// A CODEX_HOME with no auth.json so the codex-sub provider is never detected
// from a developer machine's real `codex login`; combined with clearing the
// other credential env vars this keeps provider selection hermetic (eshyra-6ygw).
const NO_CODEX_HOME = join(tmpdir(), 'eshyra-test-no-codex-home');
const restrictedSandbox = process.env.ESHYRA_TEST_SANDBOX === '1';
/** Clear every provider credential so a test controls exactly which are present. */
function clearProviderEnv(): void {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('CODEX_HOME', NO_CODEX_HOME);
}

describe('main', () => {
  const startExitCode = process.exitCode;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    // main() sets process.exitCode on the ConfigError path; restore it so a
    // covered failure branch never leaks into the vitest process exit status.
    process.exitCode = startExitCode;
  });

  it('prints the banner and resolved config on the happy path', () => {
    clearProviderEnv();
    vi.stubEnv('ESHYRA_DB_PATH', '/tmp/lw.db');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('ESHYRA_MODEL', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    main(['node', 'cli']);

    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Eshyra — core v');
    expect(printed).toContain('db=/tmp/lw.db');
    expect(process.exitCode).not.toBe(1);
  });

  it('reports a ConfigError to stderr and sets process.exitCode to 1', () => {
    clearProviderEnv();
    vi.stubEnv('ESHYRA_DB_PATH', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    main(['node', 'cli']);

    expect(process.exitCode).toBe(1);
    const printed = err.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('config error:');
    expect(printed).toContain('ANTHROPIC_API_KEY');
    expect(printed).toContain('eshyra play');
  });
});

/**
 * The `import.meta.url === pathToFileURL(process.argv[1]).href` guard only
 * fires when the module is the process entrypoint, so it cannot be exercised by
 * an in-process import. Spawn the built CLI as a real subprocess instead.
 * `npm test` runs the root `pretest` (`tsc --build`), and CI builds too, so
 * this runs in normal verification. The `skipIf` is only a backstop for a bare
 * `vitest run` invoked directly with no prior build.
 */
describe.skipIf(restrictedSandbox)('entrypoint guard', () => {
  it('runs main() when invoked as the entrypoint', () => {
    const cliDist = requireCliDist();
    const stdout = execFileSync(process.execPath, [cliDist], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ESHYRA_DB_PATH: '/tmp/lw-entrypoint.db',
        ANTHROPIC_API_KEY: 'sk-test',
        CLAUDE_CODE_OAUTH_TOKEN: '',
        OPENAI_API_KEY: '',
        CODEX_HOME: NO_CODEX_HOME,
      },
    });
    expect(stdout).toContain('Eshyra — core v');
    expect(stdout).toContain('db=/tmp/lw-entrypoint.db');
  });

  it.skipIf(process.platform === 'win32')(
    'runs main() when invoked through an npm-style bin symlink',
    () => {
      const cliDist = requireCliDist();
      const dir = mkdtempSync(join(tmpdir(), 'lw-bin-symlink-'));
      try {
        const bin = join(dir, 'eshyra');
        symlinkSync(cliDist, bin);
        const result = spawnSync(process.execPath, [bin], {
          encoding: 'utf8',
          env: {
            ...process.env,
            ESHYRA_DB_PATH: '',
            ANTHROPIC_API_KEY: '',
            CLAUDE_CODE_OAUTH_TOKEN: '',
            OPENAI_API_KEY: '',
            CODEX_HOME: NO_CODEX_HOME,
          },
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('ANTHROPIC_API_KEY');
        expect(result.stderr).toContain('eshyra play');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * The `bin` target is `./dist/index.js`. Without a shebang an installed
 * `eshyra` fails on POSIX shells, which exec the bin file directly. tsc
 * preserves a leading shebang from the source file into the emitted output.
 * `npm test` (root `pretest`) and CI both build first; the `skipIf` only backs
 * out a bare `vitest run` with no prior build.
 */
describe('cli bin shebang', () => {
  it('built dist/index.js starts with a node shebang', () => {
    const cliDist = requireCliDist();
    const firstLine = readFileSync(cliDist, 'utf8').split('\n', 1)[0];
    expect(firstLine).toBe('#!/usr/bin/env node');
  });
});

describe.skipIf(restrictedSandbox)('package smoke', () => {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

  it('packs publishable tarballs with dist output and no source/test files', {
    timeout: 10_000,
  }, () => {
    requireCliDist();
    const dir = mkdtempSync(join(tmpdir(), 'lw-pack-'));
    try {
      const cliFiles = packWorkspace(repoRoot, '@eshyra/cli', dir);
      expect(cliFiles).toContain('dist/index.js');
      expect(cliFiles).toContain('dist/play.js');
      expect(cliFiles).toContain('package.json');
      expect(cliFiles).not.toContain('src/index.ts');
      expect(cliFiles).not.toContain('test/cli.test.ts');

      const coreFiles = packWorkspace(repoRoot, '@eshyra/core', dir);
      expect(coreFiles).toContain('dist/index.js');
      expect(coreFiles).toContain('package.json');
      expect(coreFiles).not.toContain('src/index.ts');
      expect(coreFiles).not.toContain('test/smoke.test.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * `eshyra play` must run the graceful close pipeline on EOF/Ctrl-D, not
 * just on `/quit` — the `nodeIO` prompt contract promises a closed stdin is
 * treated as a graceful quit. Spawn the built CLI with explicit character
 * creation deferral, then EOF: no turns run, so no model call is made, and on
 * graceful close the session must end up `closed`. `npm test` (root `pretest`)
 * and CI both build first; the `skipIf` only backs out a bare `vitest run`
 * with no build.
 */
describe.skipIf(restrictedSandbox)('play graceful close on stdin EOF', () => {
  // Test wall time is 4–7s on healthy CI runners and ~6.3s locally on Windows
  // because it spawns the built CLI and runs the full graceful close pipeline
  // (Dolt `.checkpoints` write included). Vitest's 5000ms default times this
  // out on slow runners (observed under loreweaver-jqk PR CI). The vitest
  // timeout is set to match the inner `execFileSync` timeout, so a hang in the
  // spawned process surfaces from execFileSync rather than as a vitest abort.
  it('runs the close pipeline when stdin reaches EOF before any turn', () => {
    const cliDist = requireCliDist();
    const dir = mkdtempSync(join(tmpdir(), 'lw-eof-'));
    const dbPath = join(dir, 'campaign.db');
    try {
      const stdout = execFileSync(process.execPath, [cliDist, 'play'], {
        encoding: 'utf8',
        input: '/defer\n', // defer creation, then EOF before any turn
        timeout: 30_000,
        env: {
          ...process.env,
          ESHYRA_DB_PATH: dbPath,
          ANTHROPIC_API_KEY: 'sk-eof-test-not-used',
          CLAUDE_CODE_OAUTH_TOKEN: '',
          OPENAI_API_KEY: '',
          CODEX_HOME: NO_CODEX_HOME,
        },
      });

      expect(stdout).toContain('Character creation deferred');
      expect(stdout).toContain('Started session');
      expect(stdout).toContain('closed and recapped');

      const db = openDatabase(dbPath);
      try {
        const campaign = getCampaign(db);
        expect(campaign).toBeDefined();
        expect(
          getOpenSession(db, { campaignId: campaign?.campaignId }),
        ).toBeUndefined();
      } finally {
        db.close();
      }
    } finally {
      // Best-effort: the graceful close writes a Dolt `.checkpoints` repo
      // whose storage files are read-only, which can EPERM on Windows. The
      // dir lives under the OS temp root, so a failed unlink is harmless.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* leave it for OS temp cleanup */
      }
    }
  }, 30_000);
});

/**
 * Resolve the built CLI entrypoint (`dist/index.js`), failing loudly with an
 * actionable message when it is absent. These tests cover release-critical
 * installability (entrypoint guard, bin shebang, npm-pack contents, EOF close);
 * a missing build must fail verification, never silently skip. `npm test` runs
 * the root `pretest` (`tsc --build`), so this is built in normal verification;
 * a bare `vitest run` must build first.
 */
function requireCliDist(): string {
  const cliDist = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  if (!existsSync(cliDist)) {
    throw new Error(
      `CLI dist entrypoint missing: ${cliDist}\n\`npm test\` builds it via the root \`pretest\` script. For a bare \`vitest run\`, build first: \`npm run build\` (or \`npm run clean && npm run build\` if a stale tsbuildinfo suppresses emit).`,
    );
  }
  return cliDist;
}

function packWorkspace(
  repoRoot: string,
  workspace: string,
  scratchDir: string,
): string[] {
  const npmArgs = ['pack', '--workspace', workspace, '--dry-run', '--json'];
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', ['npm', ...npmArgs].join(' ')]
      : npmArgs;
  let stdout: string;
  try {
    stdout = execFileSync(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: npmPackEnv(scratchDir),
    });
  } catch (err) {
    const e = err as Error & {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    throw new Error(
      [
        e.message,
        `status=${e.status ?? 'unknown'}`,
        `stdout=${String(e.stdout ?? '')}`,
        `stderr=${String(e.stderr ?? '')}`,
      ].join('\n'),
    );
  }
  const [pack] = JSON.parse(stdout) as Array<{
    files: Array<{ path: string }>;
  }>;
  return pack.files.map((file) => file.path);
}

function npmPackEnv(scratchDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toLowerCase();
    if (
      normalized.startsWith('npm_config_') ||
      normalized.startsWith('npm_lifecycle_') ||
      normalized === 'npm_command' ||
      normalized === 'npm_execpath'
    ) {
      continue;
    }
    env[key] = value;
  }
  env.npm_config_cache = join(scratchDir, 'npm-cache');
  env.npm_config_loglevel = 'silent';
  return env;
}

describe('makeGameplayClient (provider -> adapter mapping, eshyra-6ygw)', () => {
  it('maps claude-sub to the agent-harness Anthropic adapter', () => {
    const c = makeGameplayClient(
      provider('claude-sub', 'anthropic', 'agent-harness', {
        CLAUDE_CODE_OAUTH_TOKEN: 'tok',
      }),
      'claude-opus-4-8',
      'primary DM',
    );
    expect(c.capabilities.vendor).toBe('anthropic');
    expect(c.capabilities.adapterFamily).toBe('agent-harness');
    expect(c.capabilities.gameplayCapable).toBe(true);
  });

  it('maps codex-sub to the agent-harness OpenAI adapter', () => {
    const c = makeGameplayClient(
      provider('codex-sub', 'openai', 'agent-harness'),
      'gpt-5.5',
      'primary DM',
    );
    expect(c.capabilities.vendor).toBe('openai');
    expect(c.capabilities.adapterFamily).toBe('agent-harness');
  });

  it('maps anthropic-api to the api-native Anthropic adapter', () => {
    const c = makeGameplayClient(
      provider('anthropic-api', 'anthropic', 'api-native', {
        ANTHROPIC_API_KEY: 'sk',
      }),
      'claude-opus-4-8',
      'primary DM',
    );
    expect(c.capabilities.vendor).toBe('anthropic');
    expect(c.capabilities.adapterFamily).toBe('api-native');
  });

  it('maps openai-api to the API-native OpenAI adapter', () => {
    const c = makeGameplayClient(
      provider('openai-api', 'openai', 'api-native', {
        OPENAI_API_KEY: 'sk',
      }),
      'gpt-5.5',
      'primary DM',
    );
    expect(c.capabilities.vendor).toBe('openai');
    expect(c.capabilities.adapterFamily).toBe('api-native');
    expect(c.capabilities.gameplayCapable).toBe(true);
  });
});
