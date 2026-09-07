#!/usr/bin/env node
// Verify that an approved dispatch launcher marks the implementation workers it
// starts, so the Captain classifier's defense-in-depth actually receives the
// markers it tests for.
//
// The launcher lives outside this repository and its path is supplied by the
// caller, never hardcoded here: this file checks a marker contract and carries
// no dispatch policy, so it stays safe for any agent to read.
//
// Contract:
//   1. ESHYRA_SEAT_ROLE is set to `dispatched-worker`.
//   2. ESHYRA_DISPATCH_CHILD carries the child identifier.
//   3. Both reach the CHILD process -- as an environment prefix on the launch
//      statement, or exported before it. A plain shell assignment stays in the
//      parent and does not satisfy this.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROLE = 'ESHYRA_SEAT_ROLE';
const CHILD = 'ESHYRA_DISPATCH_CHILD';
const LAUNCH_TOKENS = ['setsid', 'exec ', 'env ', 'codex'];

function reachesChild(source, name) {
  if (
    source.includes(`export ${name}=`) ||
    source.includes(`export ${name} `)
  ) {
    return true;
  }
  return source.split('\n').some((line) => {
    const assignment = line.indexOf(`${name}=`);
    if (assignment === -1) return false;
    const before = line.slice(0, assignment);
    // An env prefix sits at the start of a command, optionally after other
    // assignments; the statement then continues onto the launch itself.
    const isPrefix = /^\s*([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*$/.test(before);
    const continues = line.trimEnd().endsWith('\\');
    const launches = LAUNCH_TOKENS.some((token) => line.includes(token));
    return isPrefix && (continues || launches);
  });
}

export function checkDispatchMarkers(source) {
  const failures = [];
  if (!source.includes(`${ROLE}=`)) failures.push(`${ROLE} is never set`);
  else if (!source.includes('dispatched-worker')) {
    failures.push(`${ROLE} is not set to dispatched-worker`);
  }
  if (!source.includes(`${CHILD}=`)) failures.push(`${CHILD} is never set`);
  for (const name of [ROLE, CHILD]) {
    if (source.includes(`${name}=`) && !reachesChild(source, name)) {
      failures.push(`${name} never reaches the child process`);
    }
  }
  return failures;
}

export function digest(source) {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const [path, ...rest] = process.argv.slice(2);
  if (path === undefined) {
    process.stderr.write(
      'Usage: node scripts/seats/check-dispatch-markers.mjs <launcher-path> [--baseline <digest>] [--print-digest]\n',
    );
    process.exit(2);
  }
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    process.stderr.write(`unreadable launcher: ${path}\n`);
    process.exit(2);
  }
  const failures = checkDispatchMarkers(source);
  const baselineIndex = rest.indexOf('--baseline');
  if (baselineIndex !== -1 && digest(source) !== rest[baselineIndex + 1]) {
    failures.push(`launcher digest ${digest(source)} does not match baseline`);
  }
  if (rest.includes('--print-digest'))
    process.stdout.write(`${digest(source)}\n`);
  for (const failure of failures) process.stdout.write(`FAIL ${failure}\n`);
  if (failures.length === 0) {
    process.stdout.write(`PASS ${path} marks dispatched workers\n`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
