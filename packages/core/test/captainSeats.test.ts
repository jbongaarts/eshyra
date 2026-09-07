import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hookTrustState } from '../../../scripts/seats/install-captain-seats.mjs';
import {
  applyAuthorizedPatch,
  derivePatch,
  diffAgainstBaseline,
  digest,
  formatAuthorizedPatch,
  parseAuthorizedPatch,
  probeLauncher,
} from '../../../scripts/seats/probe-dispatch-markers.mjs';
import {
  codexRuntimeIdentity,
  extractHookDeclarationRegion,
  hookDeclarationIdentity,
  resolveSeatRoots,
} from '../../../scripts/seats/seatContext.mjs';

// Permanent evidence for eshyra-itnm. Captain routing and the advisory
// handoff boundary must remain structural across future hook changes.
describe('agent captain seats', () => {
  const claudeScript = join(
    process.cwd(),
    'scripts/seats/claude-captain-context.mjs',
  );
  const codexScript = join(
    process.cwd(),
    'scripts/seats/codex-captain-context.mjs',
  );
  const supervisorScript = join(
    process.cwd(),
    '.claude/hooks/supervisor-context.mjs',
  );
  const installerScript = join(
    process.cwd(),
    'scripts/seats/install-captain-seats.mjs',
  );
  const handoffScript = join(process.cwd(), 'scripts/seats/seat-handoff.mjs');
  let tmp: string;
  let baseEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'eshyra-captain-seats-'));
    mkdirSync(join(tmp, 'charters'));
    mkdirSync(join(tmp, 'state'));
    writeFileSync(join(tmp, 'charters', 'claude-captain.md'), 'Claude charter');
    writeFileSync(join(tmp, 'charters', 'codex-captain.md'), 'Codex charter');
    baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          key !== 'ESHYRA_SEAT_ROLE' && key !== 'ESHYRA_DISPATCH_CHILD',
      ),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function run(
    script: string,
    input: string | Record<string, unknown>,
    overrides: NodeJS.ProcessEnv = {},
  ): string {
    return execFileSync(process.execPath, [script], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      env: { ...baseEnv, ESHYRA_SEAT_TEST_ROOT: tmp, ...overrides },
      encoding: 'utf8',
    });
  }

  function runSupervisor(input: string | Record<string, unknown>): string {
    return execFileSync(process.execPath, [supervisorScript], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      env: baseEnv,
      encoding: 'utf8',
    });
  }

  it('routes an authorized Opus Claude startup to Claude Captain', () => {
    expect(
      run(claudeScript, { model: 'claude-opus-5', source: 'startup' }),
    ).toContain('<!-- eshyra-seat: claude-captain -->');
  });

  it('routes an authorized Fable Claude startup to Claude Captain', () => {
    expect(run(claudeScript, { model: 'Fable 5.1' })).toContain(
      '<!-- eshyra-seat: claude-captain -->',
    );
  });

  it('keeps the privileged supervisor overlay on both authorized Claude payloads', () => {
    for (const model of ['claude-opus-5', 'Fable 5.1']) {
      expect(runSupervisor({ model })).toContain(
        'You are the supervising agent',
      );
    }
  });

  it('does not route Sonnet to either Claude Captain or supervisor context', () => {
    const payload = { model: 'claude-sonnet-5' };
    expect(run(claudeScript, payload)).toBe('');
    expect(runSupervisor(payload)).toBe('');
  });

  it('does not route Claude subagents to either context', () => {
    const payload = { agent_id: 'agent-1', model: 'claude-opus-5' };
    expect(run(claudeScript, payload)).toBe('');
    expect(runSupervisor(payload)).toBe('');
  });

  it('fails closed for malformed, empty, absent-model, and unknown Claude identity', () => {
    for (const payload of ['{', '', {}, { model: 'gpt-5.6-sol' }]) {
      expect(run(claudeScript, payload)).toBe('');
      expect(runSupervisor(payload)).toBe('');
    }
  });

  it('routes a direct Codex SessionStart to Codex Captain', () => {
    expect(run(codexScript, { hook_event_name: 'SessionStart' })).toContain(
      '<!-- eshyra-seat: codex-captain -->',
    );
  });

  it('suppresses Codex Captain for either dispatched-worker marker', () => {
    const payload = { hook_event_name: 'SessionStart' };
    expect(
      run(codexScript, payload, { ESHYRA_SEAT_ROLE: 'dispatched-worker' }),
    ).toBe('');
    expect(
      run(codexScript, payload, { ESHYRA_DISPATCH_CHILD: 'eshyra-kusc.1' }),
    ).toBe('');
    expect(
      run(codexScript, payload, {
        ESHYRA_SEAT_ROLE: 'dispatched-worker',
        ESHYRA_DISPATCH_CHILD: 'eshyra-kusc.1',
      }),
    ).toBe('');
  });

  it('keeps supervisor policy out of every Codex route and dispatched worker', () => {
    const outputs = [
      run(codexScript, { hook_event_name: 'SessionStart' }),
      run(
        codexScript,
        { hook_event_name: 'SessionStart' },
        { ESHYRA_SEAT_ROLE: 'dispatched-worker' },
      ),
      run(
        codexScript,
        { hook_event_name: 'SessionStart' },
        { ESHYRA_DISPATCH_CHILD: 'eshyra-kusc.1' },
      ),
      run(codexScript, { agent_type: 'reviewer' }),
      run(codexScript, '{'),
    ];
    for (const output of outputs)
      expect(output).not.toContain('You are the supervising agent');
    expect(runSupervisor({ model: 'gpt-5.6-luna' })).toBe('');
  });

  it('does not route Codex subagents and only installs a SessionStart profile hook', () => {
    expect(run(codexScript, { agent_type: 'reviewer' })).toBe('');
    const installer = readFileSync(installerScript, 'utf8');
    expect(installer).toContain('[[hooks.SessionStart]]');
    expect(installer).not.toContain('SubagentStart');
  });

  it('fails closed for malformed, empty, and non-SessionStart Codex events', () => {
    for (const payload of ['{', '', { hook_event_name: 'SubagentStart' }]) {
      expect(run(codexScript, payload)).toBe('');
      expect(runSupervisor(payload)).toBe('');
    }
  });

  it('gives Claude Captain only the Claude handoff', () => {
    mkdirSync(join(tmp, 'state', 'claude-captain'));
    mkdirSync(join(tmp, 'state', 'codex-captain'));
    writeFileSync(
      join(tmp, 'state', 'claude-captain', 'handoff.md'),
      'Claude handoff',
    );
    writeFileSync(
      join(tmp, 'state', 'codex-captain', 'handoff.md'),
      'Codex handoff',
    );
    const output = run(claudeScript, { model: 'Fable 5.1' });
    expect(output).toContain('Claude handoff');
    expect(output).not.toContain('Codex handoff');
  });

  it('gives Codex Captain only the Codex handoff', () => {
    mkdirSync(join(tmp, 'state', 'claude-captain'));
    mkdirSync(join(tmp, 'state', 'codex-captain'));
    writeFileSync(
      join(tmp, 'state', 'claude-captain', 'handoff.md'),
      'Claude handoff',
    );
    writeFileSync(
      join(tmp, 'state', 'codex-captain', 'handoff.md'),
      'Codex handoff',
    );
    const output = run(codexScript, { hook_event_name: 'SessionStart' });
    expect(output).toContain('Codex handoff');
    expect(output).not.toContain('Claude handoff');
  });

  it('gives dispatched workers neither Captain handoff', () => {
    mkdirSync(join(tmp, 'state', 'claude-captain'));
    mkdirSync(join(tmp, 'state', 'codex-captain'));
    writeFileSync(
      join(tmp, 'state', 'claude-captain', 'handoff.md'),
      'Claude handoff',
    );
    writeFileSync(
      join(tmp, 'state', 'codex-captain', 'handoff.md'),
      'Codex handoff',
    );
    expect(
      run(
        claudeScript,
        { model: 'Fable 5.1' },
        { ESHYRA_SEAT_ROLE: 'dispatched-worker' },
      ),
    ).toBe('');
    expect(
      run(
        codexScript,
        { hook_event_name: 'SessionStart' },
        { ESHYRA_DISPATCH_CHILD: 'eshyra-kusc.1' },
      ),
    ).toBe('');
  });

  it('degrades safely when handoff or charter state is absent or empty', () => {
    const handoffPath = join(tmp, 'state', 'claude-captain', 'handoff.md');
    mkdirSync(join(tmp, 'state', 'claude-captain'));
    expect(run(claudeScript, { model: 'Fable 5.1' })).toContain(
      'No handoff recorded for this seat.',
    );
    writeFileSync(handoffPath, '');
    expect(run(claudeScript, { model: 'Fable 5.1' })).toContain(
      'No handoff recorded for this seat.',
    );
    rmSync(join(tmp, 'charters', 'claude-captain.md'));
    expect(run(claudeScript, { model: 'Fable 5.1' })).toBe('');
  });

  it('includes the complete reconciliation block for both seats', () => {
    const targets = [
      'beads',
      'branch',
      'worktree',
      'Git ancestry',
      'commits',
      'pull request',
      'dispatch registry',
      'recorded PGID',
      'process identity',
    ];
    for (const output of [
      run(claudeScript, { model: 'Fable 5.1' }),
      run(codexScript, { hook_event_name: 'SessionStart' }),
    ]) {
      expect(output).toContain('### Reconcile before acting');
      for (const target of targets) expect(output).toContain(target);
    }
  });

  it('wires Claude Captain before the existing supervisor hook', () => {
    const settings = readFileSync(
      join(process.cwd(), '.claude/settings.json'),
      'utf8',
    );
    const captain = settings.indexOf(
      'scripts/seats/claude-captain-context.mjs',
    );
    const supervisor = settings.indexOf('.claude/hooks/supervisor-context.mjs');
    expect(captain).toBeGreaterThan(-1);
    expect(supervisor).toBeGreaterThan(-1);
    expect(captain).toBeLessThan(supervisor);
  });

  it('resolves seat state inside the git common dir, shared by every worktree', () => {
    // The storage location is load-bearing. Inside the git common dir, every
    // linked worktree of the clone resolves the same handoff, `git status`
    // stays clean, and the state cannot ride into a commit, a clone, or a
    // release. A sibling of the checkout root would satisfy none of that.
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    const absoluteCommonDir = resolve(repoRoot, commonDir);

    const resolved = execFileSync(
      process.execPath,
      [handoffScript, 'path', 'claude-captain'],
      { env: baseEnv, encoding: 'utf8', cwd: process.cwd() },
    ).trim();

    expect(resolved).toBe(
      join(absoluteCommonDir, 'eshyra-seats', 'claude-captain', 'handoff.md'),
    );
    expect(resolved.startsWith(`${absoluteCommonDir}/`)).toBe(true);
  });

  it('keeps state shared across worktrees while content stays worktree-local', () => {
    const roots = resolveSeatRoots(process.cwd(), {});
    expect(roots).not.toBeNull();
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    const commonDir = resolve(
      topLevel,
      execFileSync('git', ['rev-parse', '--git-common-dir'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim(),
    );
    expect(roots?.stateDir).toBe(join(commonDir, 'eshyra-seats'));
    expect(roots?.checkoutRoot).toBe(topLevel);
  });

  it('pins the trusted Codex hook to code no worktree edit can change', () => {
    // Permanent evidence for the F1 trust-boundary finding on PR #527. Codex
    // runs command hooks OUTSIDE its sandbox and its one-time trust decision
    // covers only the hook declaration, not whatever that command later
    // executes. An earlier revision resolved the seat script from the active
    // worktree, so any branch -- or any dispatched implementation worker able
    // to write repository files -- could have obtained unsandboxed user-level
    // execution at the next Captain startup with no new prompt.
    const installRoot = mkdtempSync(join(tmpdir(), 'eshyra-seat-install-'));
    const env = { ...baseEnv, ESHYRA_SEAT_INSTALL_ROOT: installRoot };
    try {
      execFileSync(process.execPath, [installerScript], {
        env,
        encoding: 'utf8',
      });
      const shim = readFileSync(
        join(installRoot, '.codex/seats/codex-captain-context.sh'),
        'utf8',
      );
      // The trusted command must reach only user-local, installed code.
      expect(shim).toContain(
        join(installRoot, '.codex/seats/codex-captain-context.mjs'),
      );
      expect(shim).not.toContain('rev-parse');
      expect(shim).not.toContain(process.cwd());

      const payload = JSON.stringify({
        session_id: 's',
        cwd: process.cwd(),
        hook_event_name: 'SessionStart',
        source: 'startup',
      });
      // Charters are user-local and deliberately unmanaged, so drive the
      // installed runtime through the hermetic test root instead.
      const hookEnv = { ...baseEnv, ESHYRA_SEAT_TEST_ROOT: tmp };
      const before = execFileSync(
        'sh',
        [join(installRoot, '.codex/seats/codex-captain-context.sh')],
        { input: payload, env: hookEnv, encoding: 'utf8' },
      );
      expect(before).toContain('<!-- eshyra-seat: codex-captain -->');
      expect(before).toContain('Codex charter');

      // Poison BOTH the entrypoint and a transitive dependency in the repo.
      const entry = join(
        process.cwd(),
        'scripts/seats/codex-captain-context.mjs',
      );
      const library = join(process.cwd(), 'scripts/seats/seatContext.mjs');
      const entrySource = readFileSync(entry, 'utf8');
      const librarySource = readFileSync(library, 'utf8');
      try {
        writeFileSync(
          entry,
          `console.log('POISONED_ENTRY');
${entrySource}`,
        );
        writeFileSync(
          library,
          `console.log('POISONED_LIBRARY');
${librarySource}`,
        );
        const after = execFileSync(
          'sh',
          [join(installRoot, '.codex/seats/codex-captain-context.sh')],
          { input: payload, env: hookEnv, encoding: 'utf8' },
        );
        expect(after).not.toContain('POISONED_ENTRY');
        expect(after).not.toContain('POISONED_LIBRARY');
        expect(after).toContain('Codex charter');

        // Only an explicit install may change what the trusted hook runs, and
        // --check must surface the drift rather than hide it.
        expect(() =>
          execFileSync(process.execPath, [installerScript, '--check'], {
            env,
            encoding: 'utf8',
            stdio: 'pipe',
          }),
        ).toThrow();
      } finally {
        writeFileSync(entry, entrySource);
        writeFileSync(library, librarySource);
      }
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it('treats Codex trust states Codex would not execute as not trusted', () => {
    // Permanent evidence for the F2 rounds on PR #527. Codex runs a hook only
    // when it is enabled AND its stored trusted_hash equals the hash Codex
    // computes for the current declaration. That hash is not reproducible here,
    // so execution is proven by observation -- but an observation only counts
    // while it still DESCRIBES what Codex would run, which is why the stamp
    // carries an identity rather than a bare timestamp.
    const profile = '/tmp/example/.codex/eshyra-captain.config.toml';
    const declaration = '[[hooks.SessionStart]]\nmatcher = ""\n';
    const key = `${profile}:session_start:0:0`;
    const realHash = `sha256:${'a'.repeat(64)}`;
    const identity = `sha256:${'c'.repeat(64)}`;
    const entry = (body: string) =>
      `${declaration}\n[hooks.state.${JSON.stringify(key)}]\n${body}`;
    const call = (
      profileText: string | null,
      observedIdentity: string | null = identity,
      currentIdentity: string | null = identity,
    ) =>
      hookTrustState({
        profileText,
        declaringFile: profile,
        declaration,
        observedIdentity,
        currentIdentity,
      });

    expect(call(null)).toBe('unknown');
    expect(
      call(
        `[hooks.state.${JSON.stringify(key)}]\ntrusted_hash = "${realHash}"\n`,
      ),
    ).toBe('stale');
    expect(call(declaration)).toBe('untrusted');
    expect(call(entry('enabled = true\n'))).toBe('untrusted');
    // A fabricated hash must never read as trusted: it cannot be a real one.
    expect(call(entry('trusted_hash = "sha256:x"\n'))).toBe('untrusted');
    expect(call(entry(`trusted_hash = "${realHash}"\nenabled = false\n`))).toBe(
      'disabled',
    );
    expect(
      call(
        `${declaration}\n[hooks.state."/other/hooks.json:session_start:0:0"]\ntrusted_hash = "${realHash}"\n`,
      ),
    ).toBe('untrusted');
    // Never observed running.
    expect(call(entry(`trusted_hash = "${realHash}"\n`), null)).toBe(
      'unverified',
    );
    // Observed, but the declaration or the Codex build has changed since.
    expect(
      call(
        entry(`trusted_hash = "${realHash}"\n`),
        identity,
        `sha256:${'d'.repeat(64)}`,
      ),
    ).toBe('superseded');
    // Observed, and still describes what Codex would run.
    expect(call(entry(`trusted_hash = "${realHash}"\n`))).toBe('trusted');
  });

  it('owns the whole hook declaration, not a substring of it', () => {
    // Permanent evidence for F2-A. Codex keys hook state by the handler's real
    // group/handler indices, so a sibling SessionStart group moves the managed
    // handler off `0:0` and the checker would read the sibling's state. And an
    // extra field on the managed handler can change its semantics outright:
    // `async = true` makes Codex schedule it separately and drop it from the
    // results whose stdout becomes the session's additional context, so the
    // runtime still executes and stamps while NO Captain context is injected.
    const declaration = [
      '[[hooks.SessionStart]]',
      'matcher = ""',
      '',
      '[[hooks.SessionStart.hooks]]',
      'type = "command"',
      'command = "/p/shim.sh"',
      'statusMessage = "Loading Codex Captain seat"',
      '',
    ].join('\n');
    const region = (text: string) => extractHookDeclarationRegion(text);

    // Codex's own state tables and unrelated tables are not ours to own.
    expect(
      region(
        `${declaration}\n[hooks.state]\n\n[hooks.state."k"]\ntrusted_hash = "x"\n\n[tui.model_availability_nux]\n"gpt-5.5" = 4\n`,
      ),
    ).toBe(region(declaration));

    // A prepended sibling SessionStart group shifts the managed handler's key.
    expect(
      region(
        `[[hooks.SessionStart]]\nmatcher = ""\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "/bin/true"\n\n${declaration}`,
      ),
    ).not.toBe(region(declaration));

    // An extra field on the managed handler changes what Codex does with it.
    for (const extra of ['async = true', 'timeout = 30']) {
      expect(
        region(
          declaration.replace(
            'statusMessage = "Loading Codex Captain seat"',
            `statusMessage = "Loading Codex Captain seat"\n${extra}`,
          ),
        ),
      ).not.toBe(region(declaration));
    }

    // And each of those makes the trust state fail closed rather than certify.
    const stale = (text: string) =>
      hookTrustState({
        profileText: text,
        declaringFile: '/p/eshyra-captain.config.toml',
        declaration,
        observedIdentity: 'sha256:x',
        currentIdentity: 'sha256:x',
      });
    expect(
      stale(
        declaration.replace(
          'statusMessage = "Loading Codex Captain seat"',
          'statusMessage = "Loading Codex Captain seat"\nasync = true',
        ),
      ),
    ).toBe('stale');
  });

  it('binds the observed identity to the declaration and the Codex runtime', () => {
    const key = '/p/eshyra-captain.config.toml:session_start:0:0';
    const base = [
      '[[hooks.SessionStart]]',
      'matcher = ""',
      '',
      '[[hooks.SessionStart.hooks]]',
      'type = "command"',
      'command = "/p/shim.sh"',
      'statusMessage = "Loading Codex Captain seat"',
      '',
      `[hooks.state.${JSON.stringify(key)}]`,
      'trusted_hash = "sha256:1111"',
      '',
      '[tui.model_availability_nux]',
      '"gpt-5.5" = 4',
    ].join('\n');
    const identityOf = (text: string) => hookDeclarationIdentity(text, key);

    expect(identityOf(base.replace('sha256:1111', 'sha256:2222'))).not.toBe(
      identityOf(base),
    );
    expect(
      identityOf(
        base.replace(
          'statusMessage = "Loading Codex Captain seat"',
          'statusMessage = "Loading Codex Captain seat"\ntimeout = 30',
        ),
      ),
    ).not.toBe(identityOf(base));
    // Unrelated tables Codex writes into the same file must NOT change it.
    expect(identityOf(`${base}\n"gpt-6" = 1`)).toBe(identityOf(base));
  });

  it('identifies the Codex runtime, not the launcher that spawns it', () => {
    // The npm CLI ships a JS launcher that resolves a separate platform package
    // and spawns its native binary, so the launcher file can be byte-identical
    // while the build that actually executes hooks changes underneath it. The
    // identity must follow the runtime's own report, and must fail closed when
    // no runtime can be identified rather than collapse to a constant that
    // keeps one observation "trusted" across every future upgrade.
    const dir = mkdtempSync(join(tmpdir(), 'eshyra-codex-stub-'));
    try {
      const launcher = join(dir, 'codex');
      writeFileSync(
        launcher,
        '#!/bin/sh\necho "codex-cli $FAKE_CODEX_VERSION"\n',
        { mode: 0o755 },
      );
      const withVersion = (version: string) =>
        codexRuntimeIdentity({ PATH: dir, FAKE_CODEX_VERSION: version });
      const withInherited = (env: NodeJS.ProcessEnv, version: string) =>
        codexRuntimeIdentity({ ...env, FAKE_CODEX_VERSION: version });

      // Same launcher file, different runtime build.
      const before = withVersion('0.153.4');
      const after = withVersion('0.154.0');
      expect(before).not.toBeNull();
      expect(before).not.toBe(after);
      expect(before).toContain('0.153.4');

      // No codex on PATH at all: fail closed, never a stable placeholder.
      expect(codexRuntimeIdentity({ PATH: join(dir, 'absent') })).toBeNull();

      // A runtime that cannot report a version is equally unusable.
      writeFileSync(launcher, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      expect(codexRuntimeIdentity({ PATH: dir })).toBeNull();
      // The test seam must be unreachable in production: the installed hook
      // inherits the ambient environment, so an inherited ESHYRA_SEAT_CODEX_ID
      // must not be able to freeze the runtime half of the identity across an
      // upgrade. Without a test root it is ignored entirely.
      writeFileSync(
        launcher,
        '#!/bin/sh\necho "codex-cli $FAKE_CODEX_VERSION"\n',
        { mode: 0o755 },
      );
      const inherited = { PATH: dir, ESHYRA_SEAT_CODEX_ID: 'frozen' };
      const inheritedBefore = withInherited(inherited, '0.153.4');
      const inheritedAfter = withInherited(inherited, '0.154.0');
      expect(inheritedBefore).not.toBe('frozen');
      expect(inheritedBefore).not.toBe(inheritedAfter);
      // With the test root present it is honoured, for unit tests only.
      expect(
        codexRuntimeIdentity({
          ...inherited,
          ESHYRA_SEAT_TEST_ROOT: dir,
        }),
      ).toBe('frozen');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('round-trips a handoff and leaves the working tree untouched', () => {
    const stateDir = join(tmp, 'state');
    const env = { ...baseEnv, ESHYRA_SEAT_TEST_ROOT: tmp };
    const handoffPath = join(stateDir, 'codex-captain', 'handoff.md');

    expect(
      execFileSync(process.execPath, [handoffScript, 'show', 'codex-captain'], {
        env,
        encoding: 'utf8',
      }),
    ).toContain('No handoff recorded for codex-captain.');

    execFileSync(process.execPath, [handoffScript, 'write', 'codex-captain'], {
      input: 'Chasing the ambiguity precedence bug.',
      env,
      encoding: 'utf8',
    });
    const written = readFileSync(handoffPath, 'utf8');
    expect(written).toContain('<!-- recorded ');
    expect(written).toContain('Chasing the ambiguity precedence bug.');
    expect(
      execFileSync(process.execPath, [handoffScript, 'show', 'codex-captain'], {
        env,
        encoding: 'utf8',
      }),
    ).toContain('Chasing the ambiguity precedence bug.');

    // Writing seat state must never dirty the repository.
    expect(
      execFileSync('git', ['status', '--porcelain', '--', 'eshyra-seats'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }),
    ).toBe('');

    execFileSync(process.execPath, [handoffScript, 'clear', 'codex-captain'], {
      env,
      encoding: 'utf8',
    });
    expect(existsSync(handoffPath)).toBe(false);
  });

  it('rejects unknown seats and commands rather than guessing', () => {
    for (const args of [
      ['path', 'claude-main'],
      ['path', 'nonsense'],
      ['destroy', 'claude-captain'],
    ]) {
      expect(() =>
        execFileSync(process.execPath, [handoffScript, ...args], {
          env: { ...baseEnv, ESHYRA_SEAT_TEST_ROOT: tmp },
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      ).toThrow();
    }
  });

  it('observes the real child environment rather than reading the launcher', () => {
    // Permanent evidence for the second F3 round on PR #527. A textual check
    // accepted a launcher that exported both markers and then unset them; the
    // child received neither. Verification therefore runs the launcher with
    // `codex` replaced by a stub that records its own environment.
    const dir = mkdtempSync(join(tmpdir(), 'eshyra-launcher-fixtures-'));
    const write = (name: string, body: string) => {
      const path = join(dir, name);
      writeFileSync(path, body, { mode: 0o755 });
      return path;
    };
    try {
      const good = write(
        'good.sh',
        [
          '#!/usr/bin/env bash',
          'SEAT_ROLE="dispatched-worker"',
          'ESHYRA_SEAT_ROLE="$SEAT_ROLE" ESHYRA_DISPATCH_CHILD="$1" \\',
          'exec codex exec',
          '',
        ].join('\n'),
      );
      expect(probeLauncher(good)).toEqual([]);

      // Exported, then unset before the launch: the old textual check passed this.
      const unset = write(
        'unset.sh',
        [
          '#!/usr/bin/env bash',
          'export ESHYRA_SEAT_ROLE=dispatched-worker',
          'export ESHYRA_DISPATCH_CHILD="$1"',
          'unset ESHYRA_SEAT_ROLE ESHYRA_DISPATCH_CHILD',
          'exec codex exec',
          '',
        ].join('\n'),
      );
      expect(probeLauncher(unset)).toHaveLength(2);

      // `dispatched-worker` present only in a comment, wrong value at launch.
      const wrongValue = write(
        'wrong.sh',
        [
          '#!/usr/bin/env bash',
          '# marks each child as a dispatched-worker',
          'ESHYRA_SEAT_ROLE=captain ESHYRA_DISPATCH_CHILD="$1" exec codex exec',
          '',
        ].join('\n'),
      );
      expect(probeLauncher(wrongValue).join(' ')).toContain(
        'expected "dispatched-worker"',
      );

      // A launcher that never reaches a child is a failure, not a pass.
      const noLaunch = write(
        'nolaunch.sh',
        '#!/usr/bin/env bash\nexport ESHYRA_SEAT_ROLE=dispatched-worker\nexit 0\n',
      );
      expect(probeLauncher(noLaunch).join(' ')).toContain(
        'never reached the child process',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('reconstructs the only launcher the authorization permits', () => {
    // Permanent evidence for F3-A and F3-B. Preservation is proven by
    // reconstruction: the PINNED pre-change baseline plus the exact hunks, each
    // at an exact baseline line INDEX, must reproduce the launcher byte for
    // byte. Anchoring to line text alone let an exact block move between two
    // equal lines; trusting whatever file is handed in as the baseline let the
    // same unauthorized edit be applied to both files and still verify.
    const baseline = [
      '#!/usr/bin/env bash',
      'set -eu',
      'MODEL="luna"',
      'refuse_if_parent_checkout',
      'exec codex "$@"',
    ].join('\n');
    const marked = [
      '#!/usr/bin/env bash',
      'set -eu',
      'MODEL="luna"',
      '# mark dispatched implementation workers',
      'SEAT_ROLE="dispatched-worker"',
      'refuse_if_parent_checkout',
      'ESHYRA_SEAT_ROLE="$SEAT_ROLE" ESHYRA_DISPATCH_CHILD="$C" \\',
      'exec codex "$@"',
    ].join('\n');

    const derived = derivePatch(marked, baseline);
    expect(derived).not.toBeNull();
    const pinned = parseAuthorizedPatch(formatAuthorizedPatch(derived));
    expect(pinned.baselineDigest).toBe(digest(baseline));
    expect(diffAgainstBaseline(marked, baseline, pinned)).toEqual([]);
    // Baseline plus the patch determines the launcher exactly.
    expect(applyAuthorizedPatch(baseline, pinned.hunks)).toBe(marked);

    const reject = (text: string, base = baseline) =>
      diffAgainstBaseline(text, base, pinned).join(' ');

    // F3-B: the baseline itself must be the pinned pre-change artifact.
    const tampered = `${baseline}\nQ_UNAUTHORIZED=1`;
    expect(reject(marked, tampered)).toContain('not the pinned pre-change');
    // The same unauthorized edit applied to BOTH files must still be refused.
    expect(reject(`${marked}\nQ_UNAUTHORIZED=1`, tampered)).toContain(
      'not the pinned pre-change',
    );

    // Command hidden behind a marker assignment, and a marker-referencing one.
    for (const injected of [
      'ESHYRA_SEAT_ROLE=dispatched-worker touch /tmp/x',
      'touch $ESHYRA_SEAT_ROLE',
    ]) {
      expect(
        reject(
          marked.replace(
            'SEAT_ROLE="dispatched-worker"',
            `SEAT_ROLE="dispatched-worker"\n${injected}`,
          ),
        ),
      ).toContain('differs from baseline plus the authorized patch');
    }
    // A comment that is actually an interpreter change.
    expect(reject(`#!/bin/sh\n${marked}`)).toContain('differs from baseline');
    // Removed guard and changed default.
    expect(reject(marked.replace('refuse_if_parent_checkout\n', ''))).toContain(
      'differs from baseline',
    );
    expect(reject(marked.replace('MODEL="luna"', 'MODEL="opus"'))).toContain(
      'differs from baseline',
    );
    // Reordering cannot even be authorized.
    expect(
      derivePatch(
        [
          '#!/usr/bin/env bash',
          'MODEL="luna"',
          'set -eu',
          'refuse_if_parent_checkout',
          'exec codex "$@"',
        ].join('\n'),
        baseline,
      ),
    ).toBeNull();
  });

  it('binds an authorized block to one baseline occurrence, not its text', () => {
    // F3-A: with a repeated anchor line, an exact authorized block moved from
    // the first occurrence to the second changes the launcher's behaviour while
    // every authorized byte is unchanged.
    const baseline = ['a', 'ANCHOR', 'b', 'ANCHOR', 'c'].join('\n');
    const atFirst = ['a', 'ANCHOR', 'MARK', 'b', 'ANCHOR', 'c'].join('\n');
    const atSecond = ['a', 'ANCHOR', 'b', 'ANCHOR', 'MARK', 'c'].join('\n');

    const pinned = parseAuthorizedPatch(
      formatAuthorizedPatch(derivePatch(atFirst, baseline)),
    );
    expect(pinned.hunks[0].afterIndex).toBe(1);
    expect(diffAgainstBaseline(atFirst, baseline, pinned)).toEqual([]);
    expect(diffAgainstBaseline(atSecond, baseline, pinned).join(' ')).toContain(
      'differs from baseline plus the authorized patch',
    );
  });

  it('pins the real launcher patch to the real pre-change baseline', () => {
    // The tracked patch is the authorization for the external change, so its
    // shape is repository-reviewable evidence rather than a local artifact.
    const patch = parseAuthorizedPatch(
      readFileSync(
        join(process.cwd(), 'scripts/seats/dispatch-marker-patch.txt'),
        'utf8',
      ),
    );
    expect(patch.baselineDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(patch.hunks.length).toBeGreaterThan(0);
    for (const hunk of patch.hunks) {
      expect(Number.isInteger(hunk.afterIndex)).toBe(true);
      expect(hunk.lines.length).toBeGreaterThan(0);
    }
    // Every authorized line is marker-related or a comment: the patch must not
    // have quietly grown to authorize unrelated launcher behaviour.
    for (const line of patch.hunks.flatMap((hunk) => hunk.lines)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      expect(line).toMatch(
        /ESHYRA_SEAT_ROLE|ESHYRA_DISPATCH_CHILD|SEAT_ROLE|CHILD/,
      );
    }
  });

  it('keeps privileged supervisor text and wiring out of shared surfaces', () => {
    for (const path of ['AGENTS.md', 'CLAUDE.md']) {
      const text = readFileSync(join(process.cwd(), path), 'utf8');
      expect(text).not.toContain('You are the supervising agent');
      expect(text).not.toContain('dispatch-codex.sh');
    }
  });
});
