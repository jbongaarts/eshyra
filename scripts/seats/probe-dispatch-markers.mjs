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
 * Preservation is proven against an EXACT authorized patch, not a syntax class.
 * A permissive grammar always leaks: a marker assignment can prefix an
 * arbitrary command, a marker reference can be an argument to one, and a
 * comment can be a new shebang that changes the interpreter. So the allowed
 * external change is expressed as ordered hunks, each anchored to the baseline
 * line it follows, and removing exactly those hunks must leave the baseline
 * byte-for-byte.
 *
 * A hunk is { after: <exact baseline line, or null for start-of-file>,
 *             lines: [<exact added lines>] }.
 */
export function parseAuthorizedPatch(text) {
  const hunks = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('@after ')) {
      current = { after: JSON.parse(line.slice('@after '.length)), lines: [] };
      hunks.push(current);
    } else if (line.startsWith('+') && current !== null) {
      current.lines.push(line.slice(1));
    }
  }
  return hunks;
}

export function formatAuthorizedPatch(hunks) {
  return hunks
    .map(
      (hunk) =>
        `@after ${JSON.stringify(hunk.after)}\n${hunk.lines
          .map((line) => `+${line}`)
          .join('\n')}`,
    )
    .join('\n');
}

/** Derive the hunks that turn baseline into current, or null if any baseline
 * line was removed, changed, or reordered. Used to author the patch once, under
 * human review; verification then pins the launcher to it. */
export function derivePatch(current, baseline) {
  const currentLines = current.split('\n');
  const baselineLines = baseline.split('\n');
  const hunks = [];
  let i = 0;
  let j = 0;
  let pending = null;
  while (i < currentLines.length) {
    if (j < baselineLines.length && currentLines[i] === baselineLines[j]) {
      pending = baselineLines[j];
      i += 1;
      j += 1;
      continue;
    }
    const last = hunks[hunks.length - 1];
    if (last !== undefined && last.after === pending && last.open) {
      last.lines.push(currentLines[i]);
    } else {
      for (const hunk of hunks) hunk.open = false;
      hunks.push({ after: pending, lines: [currentLines[i]], open: true });
    }
    i += 1;
  }
  if (j < baselineLines.length) return null;
  return hunks.map(({ after, lines }) => ({ after, lines }));
}

export function diffAgainstBaseline(current, baseline, authorizedPatch = []) {
  const failures = [];
  const currentLines = current.split('\n');
  const baselineLines = baseline.split('\n');
  const expected = authorizedPatch.map((hunk) => ({ ...hunk }));
  let i = 0;
  let j = 0;
  let previousBaseline = null;
  let hunkIndex = 0;
  let withinHunk = 0;

  while (i < currentLines.length) {
    if (j < baselineLines.length && currentLines[i] === baselineLines[j]) {
      if (withinHunk !== 0) {
        failures.push(
          `authorized block truncated after ${JSON.stringify(currentLines[i - 1].trim().slice(0, 50))}`,
        );
        return failures;
      }
      previousBaseline = baselineLines[j];
      i += 1;
      j += 1;
      continue;
    }
    const hunk = expected[hunkIndex];
    // Diagnose only after the authorized match fails: a line that reappears
    // later in the baseline means the baseline line here was removed or moved,
    // but a duplicated line must not be mistaken for that.
    const unmatched =
      hunk === undefined || currentLines[i] !== hunk.lines[withinHunk];
    if (unmatched) {
      if (
        withinHunk === 0 &&
        j < baselineLines.length &&
        baselineLines.indexOf(currentLines[i], j + 1) !== -1
      ) {
        failures.push(
          `baseline line removed or moved: ${baselineLines[j].trim().slice(0, 60)}`,
        );
        return failures;
      }
      failures.push(
        `unauthorized addition: ${JSON.stringify(currentLines[i].trim().slice(0, 60))}`,
      );
      return failures;
    }
    if (withinHunk === 0 && hunk.after !== previousBaseline) {
      failures.push(
        `authorized block appears at the wrong anchor: expected it after ${JSON.stringify(
          (hunk.after ?? '<start of file>').trim().slice(0, 50),
        )}, found it after ${JSON.stringify(
          (previousBaseline ?? '<start of file>').trim().slice(0, 50),
        )}`,
      );
      return failures;
    }
    withinHunk += 1;
    i += 1;
    if (withinHunk === hunk.lines.length) {
      hunkIndex += 1;
      withinHunk = 0;
    }
  }

  if (j < baselineLines.length) {
    failures.push(
      `baseline line removed or moved: ${baselineLines[j].trim().slice(0, 60)}`,
    );
  }
  if (hunkIndex < expected.length) {
    failures.push('an authorized block is missing from the launcher');
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
        ? []
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
