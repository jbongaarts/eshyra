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

  it('separates shared seat state from the worktree that supplies the code', () => {
    // Regression: deriving repository content from the git COMMON dir sends a
    // linked worktree to the parent checkout, where its own seat script does
    // not exist yet, and the seat silently never loads. State keys off the
    // common dir so worktrees agree; content keys off the working tree root.
    const roots = resolveSeatRoots(process.cwd(), {});
    expect(roots).not.toBeNull();
    const commonDir = resolve(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim(),
      execFileSync('git', ['rev-parse', '--git-common-dir'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim(),
    );
    expect(roots?.stateDir).toBe(join(commonDir, 'eshyra-seats'));
    expect(roots?.checkoutRoot).toBe(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim(),
    );
    expect(existsSync(join(roots?.checkoutRoot ?? '', 'AGENTS.md'))).toBe(true);

    // The installed Codex shim must locate the seat script the same way.
    const installer = readFileSync(installerScript, 'utf8');
    expect(installer).toContain('rev-parse --show-toplevel');
    expect(installer).not.toMatch(
      /dirname "\$git_common_dir"\)\/scripts\/seats/,
    );
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

  it('keeps privileged supervisor text and wiring out of shared surfaces', () => {
    for (const path of ['AGENTS.md', 'CLAUDE.md']) {
      const text = readFileSync(join(process.cwd(), path), 'utf8');
      expect(text).not.toContain('You are the supervising agent');
      expect(text).not.toContain('dispatch-codex.sh');
    }
  });
});
