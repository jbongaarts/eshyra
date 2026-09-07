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
  diffAgainstBaseline,
  digest,
  probeLauncher,
} from '../../../scripts/seats/probe-dispatch-markers.mjs';
import { resolveSeatRoots } from '../../../scripts/seats/seatContext.mjs';

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
    // Permanent evidence for the second F2 round on PR #527. Codex runs a hook
    // only when it is enabled AND its persisted trusted_hash equals the hash it
    // computes for the current declaration. That hash is not reproducible here,
    // and an earlier revision papered over that by asserting a fabricated
    // `sha256:x` was trusted -- a value that could never be a real hash. The
    // checker now requires an OBSERVED run of the current declaration, which
    // covers stale hashes, disabled hooks, and Codex upgrades alike.
    const profile = '/tmp/example/.codex/eshyra-captain.config.toml';
    const declaration = '[[hooks.SessionStart]]\nmatcher = ""\n';
    const key = `${profile}:session_start:0:0`;
    const realHash = `sha256:${'a'.repeat(64)}`;
    const entry = (body: string) =>
      `${declaration}\n[hooks.state.${JSON.stringify(key)}]\n${body}`;
    const call = (profileText: string | null, observedRun = true) =>
      hookTrustState({
        profileText,
        declaringFile: profile,
        declaration,
        observedRun,
      });

    expect(call(null)).toBe('unknown');
    // Declaration absent or changed since install.
    expect(
      call(
        `[hooks.state.${JSON.stringify(key)}]\ntrusted_hash = "${realHash}"\n`,
      ),
    ).toBe('stale');
    // No state entry at all.
    expect(call(declaration)).toBe('untrusted');
    // Entry present but no hash, or a hash that cannot be a real one.
    expect(call(entry('enabled = true\n'))).toBe('untrusted');
    expect(call(entry('trusted_hash = "sha256:x"\n'))).toBe('untrusted');
    // Trusted but explicitly disabled: Codex will not run it.
    expect(call(entry(`trusted_hash = "${realHash}"\nenabled = false\n`))).toBe(
      'disabled',
    );
    // Trust recorded for a DIFFERENT hook must not count as ours.
    expect(
      call(
        `${declaration}\n[hooks.state."/other/hooks.json:session_start:0:0"]\ntrusted_hash = "${realHash}"\n`,
      ),
    ).toBe('untrusted');
    // Well-formed and enabled, but never observed running -> not trusted.
    expect(call(entry(`trusted_hash = "${realHash}"\n`), false)).toBe(
      'unverified',
    );
    // Only an observed run of this declaration counts as trusted.
    expect(call(entry(`trusted_hash = "${realHash}"\n`), true)).toBe('trusted');
  });

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

  it('permits only the intended marker injection against the baseline', () => {
    const baseline = ['set -eu', 'MODEL="luna"', 'exec codex "$@"'].join('\n');
    const marked = [
      'set -eu',
      'MODEL="luna"',
      '# mark dispatched implementation workers',
      'SEAT_ROLE="dispatched-worker"',
      'ESHYRA_SEAT_ROLE="$SEAT_ROLE" ESHYRA_DISPATCH_CHILD="$C" \\',
      'exec codex "$@"',
    ].join('\n');
    expect(diffAgainstBaseline(marked, baseline)).toEqual([]);

    // A dropped guard must be caught.
    const guardRemoved = marked.replace('set -eu\n', '');
    expect(diffAgainstBaseline(guardRemoved, baseline).join(' ')).toContain(
      'baseline line removed',
    );

    // So must an unrelated behaviour change smuggled in alongside the markers.
    const smuggled = `${marked}\nMODEL="something-else"`;
    expect(diffAgainstBaseline(smuggled, baseline).join(' ')).toContain(
      'unrelated line added',
    );

    expect(digest('a')).toBe(digest('a'));
    expect(digest('a')).not.toBe(digest('b'));
    expect(digest('a')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('keeps privileged supervisor text and wiring out of shared surfaces', () => {
    for (const path of ['AGENTS.md', 'CLAUDE.md']) {
      const text = readFileSync(join(process.cwd(), path), 'utf8');
      expect(text).not.toContain('You are the supervising agent');
      expect(text).not.toContain('dispatch-codex.sh');
    }
  });
});
