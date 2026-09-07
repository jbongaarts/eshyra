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

const MARKER_NAMES = new Set([ROLE, CHILD, 'SEAT_ROLE']);

/**
 * An added line is authorized only if it is a comment, or it mentions a marker
 * and assigns nothing but markers. Requiring a marker TOKEN alone is not
 * enough: `MODEL=opus # ESHYRA_SEAT_ROLE` mentions one while changing a default.
 */
function isAuthorizedAddition(line) {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return true;
  if (![...MARKER_NAMES].some((name) => line.includes(name))) return false;
  const assigned = [...line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)=/g)].map(
    (match) => match[1],
  );
  if (assigned.length > 0) return assigned.every((n) => MARKER_NAMES.has(n));
  // No assignment: allow only a continuation of quoted marker references.
  return /^[\s"'$\\{}A-Za-z0-9_]*$/.test(line);
}

/**
 * Establish that the launcher is the baseline plus the authorized marker
 * injection and nothing else. This walks both files as ORDERED programs:
 * shell line order is behaviour, so a comparison that ignores sequence accepts
 * a safety guard moved after the launch while every line and count survives.
 * Removing the authorized additions must leave the baseline byte-for-byte.
 */
export function diffAgainstBaseline(current, baseline) {
  const failures = [];
  const currentLines = current.split('\n');
  const baselineLines = baseline.split('\n');
  let i = 0;
  let j = 0;
  while (i < currentLines.length && j < baselineLines.length) {
    if (currentLines[i] === baselineLines[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (isAuthorizedAddition(currentLines[i])) {
      i += 1;
      continue;
    }
    failures.push(
      `unauthorized change at baseline line ${j + 1}: expected ${JSON.stringify(
        baselineLines[j].trim().slice(0, 60),
      )}, found ${JSON.stringify(currentLines[i].trim().slice(0, 60))}`,
    );
    return failures;
  }
  for (; j < baselineLines.length; j += 1) {
    if (baselineLines[j].trim() !== '') {
      failures.push(
        `baseline line removed or moved: ${baselineLines[j].trim().slice(0, 60)}`,
      );
    }
  }
  for (; i < currentLines.length; i += 1) {
    if (!isAuthorizedAddition(currentLines[i])) {
      failures.push(
        `unrelated line added: ${currentLines[i].trim().slice(0, 60)}`,
      );
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
