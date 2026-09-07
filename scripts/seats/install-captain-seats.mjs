#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// Tests install into a temporary root; operators always install into $HOME.
const installRoot = process.env.ESHYRA_SEAT_INSTALL_ROOT || homedir();

const seatsDir = join(installRoot, '.codex', 'seats');
const runtimePath = join(seatsDir, 'codex-captain-context.mjs');
const libraryPath = join(seatsDir, 'seatContext.mjs');
const shimPath = join(seatsDir, 'codex-captain-context.sh');
const profilePath = join(installRoot, '.codex', 'eshyra-captain.config.toml');
const wrapperPath = join(installRoot, '.local', 'bin', 'codex-captain');

function tomlQuote(value) {
  return JSON.stringify(value);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function repoSource(name) {
  return readFileSync(join(repoRoot, 'scripts', 'seats', name), 'utf8');
}

// Codex records hook trust against this command STRING, and that decision does
// not extend to whatever the command later chooses to execute. So everything
// reachable from here is user-local and changes only on an explicit
// `npm run seat:install`. Executing the seat script out of a worktree instead
// would let any branch, or any dispatched implementation worker able to write
// repository files, obtain unsandboxed user-level execution at the next Captain
// startup with no new trust prompt -- the one thing this boundary exists to
// prevent. `node` reads the hook payload from stdin, which exec preserves.
const shim = `#!/bin/sh
# Installed by scripts/seats/install-captain-seats.mjs. Do not edit in place:
# the executable closure behind Codex's one-time hook trust must change only
# through an explicit reinstall. Run \`npm run seat:install\` instead.
exec node ${shellQuote(runtimePath)}
`;

const PROFILE_DECLARATION = `[[hooks.SessionStart]]
matcher = ""

[[hooks.SessionStart.hooks]]
type = "command"
command = ${tomlQuote(shimPath)}
statusMessage = "Loading Codex Captain seat"
`;

const wrapper = `#!/bin/sh
if [ "\${ESHYRA_SEAT_ROLE+x}" = x ] && [ "\${ESHYRA_SEAT_ROLE}" != captain ]; then
  echo "codex-captain refuses to run for a non-captain seat role" >&2
  exit 1
fi
exec env ESHYRA_SEAT_ROLE=captain codex -p eshyra-captain "$@"
`;

const managed = [
  { path: libraryPath, content: repoSource('seatContext.mjs') },
  { path: runtimePath, content: repoSource('codex-captain-context.mjs') },
  { path: shimPath, content: shim, mode: 0o755 },
  // Codex persists hook trust INTO the file that declares the hook, so this
  // profile is shared with Codex and must not be compared or rewritten
  // byte-for-byte: doing so destroys the trust record on every reinstall and
  // silently returns the seat to "untrusted". Ownership is the declaration
  // only. When the declaration itself changes, rewriting is correct -- the old
  // trusted hash no longer describes it and Codex must prompt again.
  {
    path: profilePath,
    content: PROFILE_DECLARATION,
    ownsDeclarationOnly: true,
  },
  { path: wrapperPath, content: wrapper, mode: 0o755 },
];

const reportedCharters = [
  join(installRoot, '.claude', 'seats', 'claude-captain.md'),
  join(installRoot, '.codex', 'seats', 'codex-captain.md'),
];

function modeMatches(path, mode) {
  return mode === undefined || (statSync(path).mode & 0o777) === mode;
}

function currentMatches(entry) {
  try {
    if (!statSync(entry.path).isFile()) return false;
    const actual = readFileSync(entry.path, 'utf8');
    const matches = entry.ownsDeclarationOnly
      ? actual.includes(entry.content)
      : actual === entry.content;
    return matches && modeMatches(entry.path, entry.mode);
  } catch {
    return false;
  }
}

function status(entry) {
  if (!existsSync(entry.path)) return 'missing';
  return currentMatches(entry) ? 'current' : 'differs';
}

function backupPath(path) {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replaceAll('-', '')
    .replaceAll(':', '');
  let candidate = `${path}.bak.${stamp}`;
  let suffix = 1;
  while (existsSync(candidate)) candidate = `${path}.bak.${stamp}-${suffix++}`;
  return candidate;
}

function reportCharters() {
  for (const path of reportedCharters) {
    process.stdout.write(
      `${existsSync(path) ? 'present' : 'missing'} ${path} (not managed)\n`,
    );
  }
}

// Codex requires persisted per-hook trust and runs nothing without it, silently
// -- an untrusted seat hook is indistinguishable from a working one until you
// notice the charter never arrived. Trust is keyed by the hook's SOURCE file
// (this profile), its event, and the group/handler indices within it; the shim
// path is not part of the key and may legitimately never appear in config.toml.
export function hookTrustState(
  profileText,
  declaringFile = profilePath,
  declaration = PROFILE_DECLARATION,
) {
  if (profileText === null) return 'unknown';
  // Measured against Codex 0.153.4: trust is keyed by the DECLARING file, its
  // event, and the group/handler indices within it, and is written back into
  // that same file -- not into ~/.codex/config.toml.
  const key = `${declaringFile}:session_start:0:0`;
  if (!profileText.includes(`[hooks.state.${JSON.stringify(key)}]`)) {
    return 'untrusted';
  }
  // The recorded hash cannot be recomputed here (Codex does not expose the
  // algorithm), but it does not need to be: trust was granted for the exact
  // declaration text, so a declaration that still matches ours is still the one
  // that was trusted. A hand-edited declaration fails the byte comparison in
  // currentMatches, is reported as `differs`, and is rewritten on install --
  // which is precisely when Codex re-prompts.
  return profileText.includes(declaration) ? 'trusted' : 'stale';
}

function readProfile() {
  try {
    return readFileSync(profilePath, 'utf8');
  } catch {
    return null;
  }
}

function reportHookTrust() {
  const state = hookTrustState(readProfile());
  const message = {
    trusted: `trusted ${profilePath} (Codex hook trust recorded)`,
    untrusted: `untrusted ${profilePath} (approve once on the first codex-captain launch; until then Codex skips the hook silently)`,
    stale: `stale ${profilePath} (declaration changed since it was trusted; Codex will prompt again)`,
    unknown: `unknown ${profilePath} (profile not installed)`,
  }[state];
  process.stdout.write(`${message}\n`);
  return state;
}

// Importing this module (tests reuse hookTrustState) must never install
// anything: run the command-line behaviour only when invoked directly.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

const args = process.argv.slice(2);
if (!invokedDirectly) {
  // no-op on import
} else if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  process.stderr.write(
    'Usage: node scripts/seats/install-captain-seats.mjs [--check]\n',
  );
  process.exit(2);
}

const checkOnly = invokedDirectly && args[0] === '--check';
if (!invokedDirectly) {
  // imported: expose helpers only
} else if (checkOnly) {
  let clean = true;
  for (const entry of managed) {
    const result = status(entry);
    process.stdout.write(`${result} ${entry.path}\n`);
    if (result !== 'current') clean = false;
  }
  reportCharters();
  // An untrusted hook means the seat does not load, so the check must fail.
  if (reportHookTrust() !== 'trusted') clean = false;
  if (!clean) process.exitCode = 1;
} else {
  for (const entry of managed) {
    const result = status(entry);
    if (result === 'current') {
      process.stdout.write(`current ${entry.path}\n`);
      continue;
    }
    mkdirSync(dirname(entry.path), { recursive: true });
    if (existsSync(entry.path)) {
      const backup = backupPath(entry.path);
      copyFileSync(entry.path, backup);
      process.stdout.write(`backup ${backup}\n`);
    }
    writeFileSync(entry.path, entry.content, { mode: entry.mode });
    if (entry.mode !== undefined) chmodSync(entry.path, entry.mode);
    process.stdout.write(`wrote ${entry.path}\n`);
  }
  reportCharters();
  reportHookTrust();
}
