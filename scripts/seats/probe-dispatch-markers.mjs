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
 * Preservation is proven by RECONSTRUCTION: the pinned pre-change baseline plus
 * the exact authorized hunks, each at an exact baseline line index, must
 * reproduce the current launcher byte-for-byte.
 *
 * Two things this closes that an ordered walk did not. Anchoring a hunk to
 * baseline line TEXT lets the same authorized block move between two equal
 * lines; anchoring to the line INDEX does not. And trusting whatever file is
 * passed as --baseline loses the fact that it was the pre-change artifact: the
 * same unauthorized edit applied to both files would still verify. The
 * baseline's digest is therefore pinned inside the patch and checked first.
 *
 * Patch format: `@baseline "<sha256:...>"`, then `@after <index> <json text>`
 * hunks (index -1 means start of file) followed by `+<line>` additions.
 */
export function parseAuthorizedPatch(text) {
  const hunks = [];
  let baselineDigest = null;
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('@baseline ')) {
      baselineDigest = JSON.parse(line.slice('@baseline '.length));
    } else if (line.startsWith('@after ')) {
      const rest = line.slice('@after '.length);
      const space = rest.indexOf(' ');
      current = {
        afterIndex: Number.parseInt(rest.slice(0, space), 10),
        after: JSON.parse(rest.slice(space + 1)),
        lines: [],
      };
      hunks.push(current);
    } else if (line.startsWith('+') && current !== null) {
      current.lines.push(line.slice(1));
    }
  }
  return { baselineDigest, hunks };
}

export function formatAuthorizedPatch({ baselineDigest, hunks }) {
  const header = `@baseline ${JSON.stringify(baselineDigest)}`;
  const body = hunks.map(
    (hunk) =>
      `@after ${hunk.afterIndex} ${JSON.stringify(hunk.after)}\n${hunk.lines
        .map((line) => `+${line}`)
        .join('\n')}`,
  );
  return [header, ...body].join('\n');
}

/**
 * Derive the hunks that turn baseline into current, or null if any baseline
 * line was removed, changed, or reordered. Used to author the patch once, under
 * human review; verification then pins the launcher to it.
 */
export function derivePatch(current, baseline) {
  const currentLines = current.split('\n');
  const baselineLines = baseline.split('\n');
  const hunks = [];
  let i = 0;
  let j = 0;
  let open = null;
  while (i < currentLines.length) {
    if (j < baselineLines.length && currentLines[i] === baselineLines[j]) {
      open = null;
      i += 1;
      j += 1;
      continue;
    }
    if (open === null) {
      open = {
        afterIndex: j - 1,
        after: j === 0 ? '' : baselineLines[j - 1],
        lines: [],
      };
      hunks.push(open);
    }
    open.lines.push(currentLines[i]);
    i += 1;
  }
  if (j < baselineLines.length) return null;
  return { baselineDigest: digest(baseline), hunks };
}

/** Rebuild the only launcher the authorization permits. */
export function applyAuthorizedPatch(baseline, hunks) {
  const baselineLines = baseline.split('\n');
  const additions = new Map();
  for (const hunk of hunks) {
    const at = additions.get(hunk.afterIndex) ?? [];
    at.push(...hunk.lines);
    additions.set(hunk.afterIndex, at);
  }
  const out = [...(additions.get(-1) ?? [])];
  for (let index = 0; index < baselineLines.length; index += 1) {
    out.push(baselineLines[index]);
    out.push(...(additions.get(index) ?? []));
  }
  return out.join('\n');
}

export function diffAgainstBaseline(current, baseline, authorizedPatch) {
  const patch = authorizedPatch ?? { baselineDigest: null, hunks: [] };
  const failures = [];
  if (
    patch.baselineDigest !== null &&
    digest(baseline) !== patch.baselineDigest
  ) {
    failures.push(
      `baseline is not the pinned pre-change artifact: ${digest(baseline)} != ${patch.baselineDigest}`,
    );
    return failures;
  }
  for (const hunk of patch.hunks) {
    const baselineLines = baseline.split('\n');
    const at = hunk.afterIndex;
    if (at !== -1 && baselineLines[at] !== hunk.after) {
      failures.push(
        `authorized block is anchored to baseline line ${at + 1}, which is not ${JSON.stringify(hunk.after.trim().slice(0, 50))}`,
      );
      return failures;
    }
  }
  const expected = applyAuthorizedPatch(baseline, patch.hunks);
  if (expected === current) return failures;

  // Same gate either way; this only makes the failure legible.
  const expectedLines = expected.split('\n');
  const currentLines = current.split('\n');
  const at = expectedLines.findIndex(
    (line, index) => currentLines[index] !== line,
  );
  if (at === -1) {
    failures.push(
      `launcher has ${currentLines.length - expectedLines.length} unauthorized trailing line(s)`,
    );
  } else if (currentLines[at] === undefined) {
    failures.push(
      `launcher is missing an authorized line: ${JSON.stringify(expectedLines[at].trim().slice(0, 60))}`,
    );
  } else {
    failures.push(
      `launcher differs from baseline plus the authorized patch at line ${at + 1}: expected ${JSON.stringify(
        expectedLines[at].trim().slice(0, 50),
      )}, found ${JSON.stringify(currentLines[at].trim().slice(0, 50))}`,
    );
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
  const authorizeIndex = rest.indexOf('--authorize');
  const baselineIndex = rest.indexOf('--baseline');
  const patchIndex = rest.indexOf('--patch');

  // Authoring mode: derive the patch once, for human review, then pin to it.
  if (authorizeIndex !== -1) {
    if (baselineIndex === -1) {
      process.stderr.write('--authorize requires --baseline\n');
      process.exit(2);
    }
    const derived = derivePatch(
      readFileSync(launcher, 'utf8'),
      readFileSync(rest[baselineIndex + 1], 'utf8'),
    );
    if (derived === null) {
      process.stderr.write('launcher removed or reordered baseline lines\n');
      process.exit(1);
    }
    writeFileSync(
      rest[authorizeIndex + 1],
      `${formatAuthorizedPatch(derived)}\n`,
    );
    process.stdout.write(`wrote ${rest[authorizeIndex + 1]}\n`);
    process.exit(0);
  }

  const failures = probeLauncher(launcher);
  if (baselineIndex !== -1) {
    const patch =
      patchIndex === -1
        ? null
        : parseAuthorizedPatch(readFileSync(rest[patchIndex + 1], 'utf8'));
    failures.push(
      ...diffAgainstBaseline(
        readFileSync(launcher, 'utf8'),
        readFileSync(rest[baselineIndex + 1], 'utf8'),
        patch,
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
