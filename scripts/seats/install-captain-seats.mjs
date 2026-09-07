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

const userHome = homedir();
const shimPath = join(userHome, '.codex', 'seats', 'codex-captain-context.sh');
const profilePath = join(userHome, '.codex', 'eshyra-captain.config.toml');
const wrapperPath = join(userHome, '.local', 'bin', 'codex-captain');

function tomlQuote(value) {
  return JSON.stringify(value);
}

const shim = `#!/bin/sh
payload=$(cat 2>/dev/null) || exit 0
cwd=$(printf '%s' "$payload" | node -e 'let raw=""; process.stdin.on("data", chunk => { raw += chunk; }); process.stdin.on("end", () => { try { const value = JSON.parse(raw); if (value && typeof value.cwd === "string" && value.cwd !== "") process.stdout.write(value.cwd); } catch {} });' 2>/dev/null) || exit 0
[ -n "$cwd" ] || exit 0
# The working tree root, not the git common dir: a linked worktree must run its
# own checked-out seat script, and the common dir would resolve every worktree
# back to the parent checkout instead.
top_level=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$top_level" ] || exit 0
seat_script="$top_level/scripts/seats/codex-captain-context.mjs"
[ -f "$seat_script" ] || exit 0
printf '%s' "$payload" | exec node "$seat_script"
`;

const profile = `[[hooks.SessionStart]]
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
  { path: shimPath, content: shim, mode: 0o755 },
  { path: profilePath, content: profile },
  { path: wrapperPath, content: wrapper, mode: 0o755 },
];

const reportedCharters = [
  join(userHome, '.claude', 'seats', 'claude-captain.md'),
  join(userHome, '.codex', 'seats', 'codex-captain.md'),
];

function modeMatches(path, mode) {
  return mode === undefined || (statSync(path).mode & 0o777) === mode;
}

function currentMatches(entry) {
  try {
    return (
      statSync(entry.path).isFile() &&
      readFileSync(entry.path, 'utf8') === entry.content &&
      modeMatches(entry.path, entry.mode)
    );
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

// Codex requires persisted per-hook trust and silently runs nothing when it is
// absent, so an untrusted seat hook looks identical to a working one until you
// notice the charter never arrived. Report it rather than let it fail quietly.
// Trust is granted once, interactively, on the first `codex-captain` launch;
// the recorded hash covers the hook COMMAND STRING, so editing the shim body or
// the charter never revokes it.
function reportHookTrust() {
  const configPath = join(userHome, '.codex', 'config.toml');
  let config = '';
  try {
    config = readFileSync(configPath, 'utf8');
  } catch {
    process.stdout.write(`missing ${configPath} (Codex hook trust unknown)\n`);
    return;
  }
  const trusted =
    config.includes('[hooks.state]') || config.includes('[hooks.state.');
  process.stdout.write(
    trusted && config.includes(shimPath)
      ? `trusted ${shimPath} (Codex hook trust recorded)\n`
      : `untrusted ${shimPath} (approve once on the first codex-captain launch; until then Codex skips the hook silently)\n`,
  );
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  process.stderr.write(
    'Usage: node scripts/seats/install-captain-seats.mjs [--check]\n',
  );
  process.exit(2);
}

const checkOnly = args[0] === '--check';
if (checkOnly) {
  let clean = true;
  for (const entry of managed) {
    const result = status(entry);
    process.stdout.write(`${result} ${entry.path}\n`);
    if (result !== 'current') clean = false;
  }
  reportCharters();
  reportHookTrust();
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
