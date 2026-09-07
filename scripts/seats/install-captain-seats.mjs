#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  extractHookDeclarationRegion,
  seatHookIdentity,
} from './seatContext.mjs';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// Tests install into a temporary root; operators always install into $HOME.
const installRoot = process.env.ESHYRA_SEAT_INSTALL_ROOT || homedir();

const seatsDir = join(installRoot, '.codex', 'seats');
const runtimePath = join(seatsDir, 'codex-captain-context.mjs');
const libraryPath = join(seatsDir, 'seatContext.mjs');
const shimPath = join(seatsDir, 'codex-captain-context.sh');
const profilePath = join(installRoot, '.codex', 'eshyra-captain.config.toml');
const wrapperPath = join(installRoot, '.local', 'bin', 'codex-captain');
const lastRunPath = join(seatsDir, '.last-run');

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
ESHYRA_SEAT_STAMP=${shellQuote(lastRunPath)} \\
ESHYRA_SEAT_PROFILE=${shellQuote(profilePath)} \\
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
for arg in "$@"; do
  if [ "$arg" = --dangerously-bypass-hook-trust ]; then
    echo "codex-captain refuses --dangerously-bypass-hook-trust: a bypassed run is not evidence that the seat hook is trusted" >&2
    exit 1
  fi
done
# The Captain seat always runs unsandboxed with approvals off. This is an
# approvals/sandbox decision only; it says nothing about hook trust, which the
# guard above still refuses to bypass. Passing the flag again is harmless.
exec env ESHYRA_SEAT_ROLE=captain codex -p eshyra-captain \\
  --dangerously-bypass-approvals-and-sandbox "$@"
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
      ? extractHookDeclarationRegion(actual) ===
        extractHookDeclarationRegion(entry.content)
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

// Codex requires persisted per-hook trust and runs nothing without it,
// silently -- an untrusted seat hook is indistinguishable from a working one
// until you notice the charter never arrived. Trust is keyed by the DECLARING
// file (this profile), its event, and the group/handler indices within it, and
// Codex writes the record back into that same file.
//
// Codex executes a hook only when it is enabled AND its persisted trusted_hash
// equals the hash it computes for the current declaration. That hash is not
// reproducible here: its normalisation is undocumented, and mirroring it would
// rot the moment Codex changed normalisation or a default. So execution is not
// inferred from config text at all. The installed shim stamps `.last-run` when
// Codex actually dispatches the hook, and the stamp carries the identity of the
// declaration and the Codex build that produced it -- so an old observation
// cannot certify a hook that has since been edited, re-trusted with a different
// hash, disabled, or handed to an upgraded Codex.
export function parseHookState(profileText, key) {
  const header = `[hooks.state.${JSON.stringify(key)}]`;
  const start = profileText.indexOf(header);
  if (start === -1) return null;
  const rest = profileText.slice(start + header.length);
  const next = rest.search(/^\s*\[/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const hash = body.match(/^\s*trusted_hash\s*=\s*"([^"]*)"/m)?.[1] ?? null;
  const enabled = body.match(/^\s*enabled\s*=\s*(true|false)/m)?.[1];
  return { trustedHash: hash, enabled: enabled !== 'false' };
}

export function hookTrustState({
  profileText,
  declaringFile = profilePath,
  declaration = PROFILE_DECLARATION,
  observedIdentity = null,
  currentIdentity = null,
}) {
  if (profileText === null || profileText === undefined) return 'unknown';
  // Exact ownership of every hook-declaring table, not a substring: a sibling
  // SessionStart group moves this handler's persisted state key off `0:0`, and
  // an extra field on the handler (notably `async = true`) can stop Captain
  // context being injected at all while the runtime still runs and stamps.
  if (
    extractHookDeclarationRegion(profileText) !==
    extractHookDeclarationRegion(declaration)
  ) {
    return 'stale';
  }
  const state = parseHookState(
    profileText,
    `${declaringFile}:session_start:0:0`,
  );
  if (state === null) return 'untrusted';
  if (!/^sha256:[0-9a-f]{64}$/.test(state.trustedHash ?? '')) {
    return 'untrusted';
  }
  if (!state.enabled) return 'disabled';
  // A recorded hash cannot be compared against Codex's computed one, so the
  // only sound evidence that this declaration executes is that it has. The
  // observation must also still DESCRIBE what Codex would run now: a
  // syntactically valid but wrong trusted_hash, an identity-changing field
  // added beside the declaration, and a Codex upgrade each change the identity
  // while leaving an old timestamp perfectly intact.
  if (observedIdentity === null) return 'unverified';
  // Fail closed: an unidentifiable runtime cannot certify anything, and must
  // never collapse to a constant that keeps an old observation alive forever.
  if (currentIdentity === null) return 'runtime-unknown';
  return observedIdentity === currentIdentity ? 'trusted' : 'superseded';
}

function readProfile() {
  try {
    return readFileSync(profilePath, 'utf8');
  } catch {
    return null;
  }
}

function readLastRun() {
  try {
    const stamp = JSON.parse(readFileSync(lastRunPath, 'utf8'));
    return typeof stamp?.identity === 'string' ? stamp : null;
  } catch {
    return null;
  }
}

function reportHookTrust() {
  const lastRun = readLastRun();
  const state = hookTrustState({
    profileText: readProfile(),
    observedIdentity: lastRun?.identity ?? null,
    currentIdentity: seatHookIdentity(profilePath),
  });
  const message = {
    trusted: `trusted ${profilePath} (observed running ${lastRun?.at})`,
    unverified: `unverified ${profilePath} (trust recorded, but this declaration has not been observed running; start one codex-captain session)`,
    superseded: `superseded ${profilePath} (the declaration or the Codex build changed since the last observed run ${lastRun?.at}; start one codex-captain session)`,
    untrusted: `untrusted ${profilePath} (approve once on the first codex-captain launch; until then Codex skips the hook silently)`,
    disabled: `disabled ${profilePath} (hook trusted but disabled; Codex will not run it)`,
    stale: `stale ${profilePath} (declaration changed since install; run npm run seat:install)`,
    'runtime-unknown': `runtime-unknown ${profilePath} (the Codex runtime could not be identified, so no observation can be trusted)`,
    unknown: `unknown ${profilePath} (profile not installed)`,
  }[state];
  process.stdout.write(`${message}\n`);
  return state;
}

// Importing this module (tests reuse the trust helpers) must never install
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
    if (entry.path === profilePath || entry.path === shimPath) {
      // The declaration or the trusted command changed, so any earlier
      // observation no longer describes what Codex will now run.
      rmSync(lastRunPath, { force: true });
    }
  }
  reportCharters();
  reportHookTrust();
}
