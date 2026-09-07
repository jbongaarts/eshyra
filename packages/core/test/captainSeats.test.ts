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
import {
  checkDispatchMarkers,
  digest,
} from '../../../scripts/seats/check-dispatch-markers.mjs';
import { hookTrustState } from '../../../scripts/seats/install-captain-seats.mjs';
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

  it('reports Codex hook trust using the real key, in the declaring file', () => {
    // Measured against Codex 0.153.4: trust is keyed by the DECLARING file plus
    // event and group/handler indices, and is written back into that same file
    // rather than ~/.codex/config.toml. An earlier revision looked for the shim
    // path in config.toml, which reported a genuinely trusted hook as untrusted.
    const profile = '/tmp/example/.codex/eshyra-captain.config.toml';
    const declaration = '[[hooks.SessionStart]]\nmatcher = ""\n';
    const key = `${profile}:session_start:0:0`;
    const trustEntry = `[hooks.state.${JSON.stringify(key)}]\ntrusted_hash = "sha256:x"\n`;

    expect(hookTrustState(null, profile, declaration)).toBe('unknown');
    expect(hookTrustState(declaration, profile, declaration)).toBe('untrusted');
    expect(
      hookTrustState(`${declaration}\n${trustEntry}`, profile, declaration),
    ).toBe('trusted');
    expect(hookTrustState(trustEntry, profile, declaration)).toBe('stale');
    // Trust recorded for a different hook must not count as ours.
    expect(
      hookTrustState(
        `${declaration}\n[hooks.state."/other/hooks.json:session_start:0:0"]\n`,
        profile,
        declaration,
      ),
    ).toBe('untrusted');
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

  it('verifies that a dispatch launcher marks the workers it starts', () => {
    // Permanent evidence for the F3 producer-boundary finding on PR #527. The
    // approved launcher lives outside this repository, so its contract is
    // checked here against fixtures; the checker itself holds no dispatch
    // policy and hardcodes no launcher path, so it is safe for any agent to
    // read. Real-artifact runs are recorded on the owning bead.
    const prefixForm = [
      'SEAT_ROLE="dispatched-worker"',
      'PROMPT="$(cat "$PROMPT_FILE")"',
      'ESHYRA_SEAT_ROLE="$SEAT_ROLE" ESHYRA_DISPATCH_CHILD="$CHILD" \\',
      'setsid bash -c \'exec codex "$@"\' _ "$WT"',
    ].join('\n');
    expect(checkDispatchMarkers(prefixForm)).toEqual([]);

    const exportForm = [
      'export ESHYRA_SEAT_ROLE=dispatched-worker',
      'export ESHYRA_DISPATCH_CHILD="$CHILD"',
      'exec codex "$@"',
    ].join('\n');
    expect(checkDispatchMarkers(exportForm)).toEqual([]);

    // Unmarked launcher: both markers missing.
    expect(checkDispatchMarkers('setsid bash -c \'exec codex "$@"\'')).toEqual([
      'ESHYRA_SEAT_ROLE is never set',
      'ESHYRA_DISPATCH_CHILD is never set',
    ]);

    // Only one marker set.
    expect(
      checkDispatchMarkers(
        'ESHYRA_SEAT_ROLE=dispatched-worker setsid codex exec',
      ),
    ).toEqual(['ESHYRA_DISPATCH_CHILD is never set']);

    // Wrong role value must not pass as a marked worker.
    expect(
      checkDispatchMarkers(
        'ESHYRA_SEAT_ROLE=captain ESHYRA_DISPATCH_CHILD="$C" setsid codex exec',
      ),
    ).toContain('ESHYRA_SEAT_ROLE is not set to dispatched-worker');

    // Plain shell assignments stay in the parent and never reach the child.
    const parentOnly = [
      'ESHYRA_SEAT_ROLE=dispatched-worker',
      'ESHYRA_DISPATCH_CHILD="$CHILD"',
      'printf "%s" "$ESHYRA_SEAT_ROLE" > /dev/null',
    ].join('\n');
    expect(checkDispatchMarkers(parentOnly)).toEqual([
      'ESHYRA_SEAT_ROLE never reaches the child process',
      'ESHYRA_DISPATCH_CHILD never reaches the child process',
    ]);

    // The digest is what pins "nothing else changed" for an operator.
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
