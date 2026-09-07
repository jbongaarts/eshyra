#!/usr/bin/env node
// Prove, by observation at the actual child boundary, that a dispatch launcher
// puts the worker markers into the environment of the process it launches.
//
// A static read of the launcher cannot establish this: exported values can be
// reassigned or unset later, a marker can sit in a branch that never runs, and
// a `dispatched-worker` string can appear anywhere in the file while the
// variable is assigned something else at the launch itself. So this runs the
// real launcher in a disposable sandbox with `codex` replaced by a stub that
// records its own environment, and asserts the exact values the stub received.
//
// The launcher lives outside this repository and its path is always supplied by
// the caller. This file holds no dispatch policy and is safe for any agent.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROLE = 'ESHYRA_SEAT_ROLE';
const CHILD = 'ESHYRA_DISPATCH_CHILD';
const EXPECTED_ROLE = 'dispatched-worker';
const CHILD_ID = 'probe-child';

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** Build a checkout shaped the way a dispatch launcher expects to find one. */
function buildSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'eshyra-dispatch-probe-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'probe@example.invalid');
  git(root, 'config', 'user.name', 'probe');
  writeFileSync(join(root, 'README.md'), 'probe\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'probe');
  mkdirSync(join(root, '.worktrees', '.dispatch'), { recursive: true });
  git(
    root,
    'worktree',
    'add',
    '-q',
    '-b',
    CHILD_ID,
    join('.worktrees', CHILD_ID),
  );
  writeFileSync(
    join(root, '.worktrees', '.dispatch', `${CHILD_ID}.prompt`),
    'probe prompt\n',
  );

  const binDir = join(root, 'stub-bin');
  mkdirSync(binDir, { recursive: true });
  const record = join(root, 'child-env.txt');
  writeFileSync(
    join(binDir, 'codex'),
    `#!/bin/sh\nenv > ${JSON.stringify(record)}\nexit 0\n`,
    { mode: 0o755 },
  );
  return { root, binDir, record };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readRecordedEnv(record, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(record)) {
      const text = readFileSync(record, 'utf8');
      // Wait for a complete write rather than racing the stub's redirect.
      if (text.includes('\n')) return text;
    }
    sleepSync(100);
  }
  return null;
}

export function probeLauncher(launcherPath, waitMs = 4000) {
  const failures = [];
  const { root, binDir, record } = buildSandbox();
  try {
    // Execute directly so the launcher's own shebang selects its interpreter.
    const run = spawnSync(launcherPath, [CHILD_ID], {
      cwd: root,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      encoding: 'utf8',
      timeout: 30000,
    });
    const env = readRecordedEnv(record, waitMs);
    if (env === null) {
      failures.push(
        `launcher never reached the child process (exit ${run.status}): ${(run.stderr || '').trim().slice(0, 200)}`,
      );
      return failures;
    }
    const seen = new Map();
    for (const line of env.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) seen.set(line.slice(0, eq), line.slice(eq + 1));
    }
    if (seen.get(ROLE) !== EXPECTED_ROLE) {
      failures.push(
        `child received ${ROLE}=${JSON.stringify(seen.get(ROLE) ?? null)}, expected ${JSON.stringify(EXPECTED_ROLE)}`,
      );
    }
    if (seen.get(CHILD) !== CHILD_ID) {
      failures.push(
        `child received ${CHILD}=${JSON.stringify(seen.get(CHILD) ?? null)}, expected ${JSON.stringify(CHILD_ID)}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return failures;
}

/**
 * Establish that the launcher differs from its pre-change baseline only by the
 * intended marker injection: nothing removed, and every added line marker- or
 * comment-related. The digest pins identity; this pins the change itself.
 */
export function diffAgainstBaseline(current, baseline) {
  const failures = [];
  // Counted, not set-based: a line present twice in the baseline and once now
  // is a removal, and a set comparison would call it unchanged.
  const tally = (text) => {
    const counts = new Map();
    for (const line of text.split('\n')) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    return counts;
  };
  const baselineCounts = tally(baseline);
  const currentCounts = tally(current);
  for (const [line, count] of baselineCounts) {
    if (line.trim() !== '' && (currentCounts.get(line) ?? 0) < count) {
      failures.push(`baseline line removed: ${line.trim().slice(0, 80)}`);
    }
  }
  const baselineLines = new Set(baseline.split('\n'));
  for (const line of current.split('\n')) {
    if (line.trim() === '' || baselineLines.has(line)) continue;
    const isComment = line.trim().startsWith('#');
    const isMarker =
      line.includes(ROLE) || line.includes(CHILD) || line.includes('SEAT_ROLE');
    if (!isComment && !isMarker) {
      failures.push(`unrelated line added: ${line.trim().slice(0, 80)}`);
    }
  }
  return failures;
}

/** Identity pin for the launcher bytes. Not semantic proof -- that is the probe. */
export function digest(source) {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const [launcher, ...rest] = process.argv.slice(2);
  if (launcher === undefined) {
    process.stderr.write(
      'Usage: node scripts/seats/probe-dispatch-markers.mjs <launcher-path> [--baseline <pre-change-path>] [--print-digest]\n',
    );
    process.exit(2);
  }
  const failures = probeLauncher(launcher);
  const baselineIndex = rest.indexOf('--baseline');
  if (baselineIndex !== -1) {
    const baselinePath = rest[baselineIndex + 1];
    failures.push(
      ...diffAgainstBaseline(
        readFileSync(launcher, 'utf8'),
        readFileSync(baselinePath, 'utf8'),
      ),
    );
  }
  if (rest.includes('--print-digest')) {
    process.stdout.write(`${digest(readFileSync(launcher, 'utf8'))}\n`);
  }
  for (const failure of failures) process.stdout.write(`FAIL ${failure}\n`);
  if (failures.length === 0) {
    process.stdout.write(
      `PASS ${launcher} placed both markers in the child environment\n`,
    );
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
