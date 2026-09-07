import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export const CAPTAIN_MODEL_PATTERN = /fable|opus/i;

export const SEATS = {
  claudeCaptain: 'claude-captain',
  codexCaptain: 'codex-captain',
};

const VALID_SEATS = new Set(Object.values(SEATS));

export function readHookInput(raw) {
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function classifyClaudeSession(input) {
  if (input === null) return { eligible: false, reason: 'malformed-input' };
  if (input.agent_id) return { eligible: false, reason: 'subagent' };
  if (input.source === 'resume') return { eligible: false, reason: 'resume' };
  if (typeof input.model !== 'string' || input.model.trim() === '') {
    return { eligible: false, reason: 'no-model-identity' };
  }
  if (!CAPTAIN_MODEL_PATTERN.test(input.model)) {
    return { eligible: false, reason: 'unauthorized-model' };
  }
  return { eligible: true, reason: 'authorized-main-session' };
}

export function classifyCodexSession(input, env) {
  if (input === null) return { eligible: false, reason: 'malformed-input' };

  // The profile layer is the primary Codex Captain boundary: the dispatch
  // path never loads it. These checks are defense in depth, not the only gate.
  const seatRole = env?.ESHYRA_SEAT_ROLE;
  const dispatchChild = env?.ESHYRA_DISPATCH_CHILD;
  if (
    (typeof seatRole === 'string' &&
      seatRole.trim() !== '' &&
      seatRole !== 'captain') ||
    (typeof dispatchChild === 'string' && dispatchChild.trim() !== '')
  ) {
    return { eligible: false, reason: 'dispatched-worker' };
  }
  if (typeof input.agent_type === 'string' && input.agent_type.trim() !== '') {
    return { eligible: false, reason: 'subagent' };
  }
  if (
    Object.hasOwn(input, 'hook_event_name') &&
    input.hook_event_name !== 'SessionStart'
  ) {
    return { eligible: false, reason: 'wrong-event' };
  }
  if (input.source === 'resume') return { eligible: false, reason: 'resume' };
  return { eligible: true, reason: 'captain-profile-session' };
}

export function resolveSeatRoots(cwd, env) {
  const testRoot = env?.ESHYRA_SEAT_TEST_ROOT;
  if (typeof testRoot === 'string' && testRoot.trim() !== '') {
    const root = resolve(testRoot);
    return {
      charterDir: join(root, 'charters'),
      stateDir: join(root, 'state'),
      checkoutRoot: root,
      mode: 'test',
    };
  }

  if (typeof cwd !== 'string' || cwd.trim() === '') return null;
  try {
    if (!statSync(cwd).isDirectory()) return null;
    // Two different roots, deliberately. The common dir is shared by every
    // linked worktree of the clone; the top level is the working tree you are
    // actually standing in. State keys off the former so all worktrees agree,
    // repository content keys off the latter so a worktree reads its own files.
    const [commonDirOutput = '', topLevelOutput = ''] = execFileSync(
      'git',
      ['rev-parse', '--git-common-dir', '--show-toplevel'],
      { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 2000 },
    )
      .trim()
      .split('\n');
    if (commonDirOutput === '' || topLevelOutput === '') return null;
    const commonDir = isAbsolute(commonDirOutput)
      ? resolve(commonDirOutput)
      : resolve(cwd, commonDirOutput);
    // Inside the git common dir, never the working tree: every linked worktree
    // of the clone resolves the same directory, `git status` stays clean, the
    // state cannot be committed by accident, and it is absent from any clone,
    // archive, or release built from this repository.
    return {
      charterDir: null,
      stateDir: join(commonDir, 'eshyra-seats'),
      checkoutRoot: resolve(topLevelOutput),
      mode: 'repo',
    };
  } catch {
    return null;
  }
}

export function resolveCharterPath(seatId, env = process.env) {
  if (!VALID_SEATS.has(seatId)) return '';
  const testRoot = env?.ESHYRA_SEAT_TEST_ROOT;
  if (typeof testRoot === 'string' && testRoot.trim() !== '') {
    return join(resolve(testRoot), 'charters', `${seatId}.md`);
  }
  const seatHome = seatId === SEATS.claudeCaptain ? '.claude' : '.codex';
  return join(homedir(), seatHome, 'seats', `${seatId}.md`);
}

export function readCharter(seatId, env = process.env) {
  const path = resolveCharterPath(seatId, env);
  if (path === '') return null;
  try {
    const text = readFileSync(path, 'utf8');
    return text.trim() === '' ? null : text;
  } catch {
    return null;
  }
}

export function readHandoff(seatId, cwd, env = process.env) {
  if (!VALID_SEATS.has(seatId)) return null;
  const roots = resolveSeatRoots(cwd, env);
  if (roots === null) return null;
  const path = join(roots.stateDir, seatId, 'handoff.md');
  try {
    const text = readFileSync(path, 'utf8');
    if (text.trim() === '') return null;
    const ageHours =
      Math.round(((Date.now() - statSync(path).mtimeMs) / 3600000) * 10) / 10;
    return { text, path, ageHours };
  } catch {
    return null;
  }
}

export const RECONCILIATION_BLOCK = `### Reconcile before acting

Everything in the handoff is a lead and not a fact. The occupant must re-derive current work from live state before acting, checking beads, branch, worktree, Git ancestry, commits, pull request, dispatch registry, recorded PGID, and process identity. A handoff is never permission to kill a process, reset a branch, force-push, merge, or discard a commit without live verification.`;

function occupantValue(value) {
  return value === undefined || value === null || value === ''
    ? 'unknown'
    : value;
}

export function renderSeatContext({
  seatId,
  seatTitle,
  harness,
  charter,
  handoff,
  occupant,
}) {
  const metadata = occupant ?? {};
  const lines = [
    `<!-- eshyra-seat: ${occupantValue(seatId)} -->`,
    `# ${occupantValue(seatTitle)} — standing seat`,
    charter,
    '## Occupant (runtime metadata, not seat identity)',
    `- seat: ${occupantValue(seatId)}`,
    `- harness: ${occupantValue(harness)}`,
    `- model: ${occupantValue(metadata.model)}`,
    `- session: ${occupantValue(metadata.session)}`,
    `- started: ${new Date(Date.now()).toISOString()}`,
    'Occupant metadata never confers seat identity, and capability is not inherited from a predecessor.',
    '## Predecessor handoff (advisory — not authority)',
  ];

  if (handoff === null || handoff === undefined) {
    lines.push('No handoff recorded for this seat.');
  } else {
    lines.push(
      handoff.text,
      `Recorded ${handoff.ageHours}h ago at ${handoff.path}.`,
    );
  }
  lines.push(RECONCILIATION_BLOCK);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Hook identity
//
// Codex executes a hook only when its stored trusted_hash equals the hash Codex
// itself computes for the current declaration. That hash is not reproducible
// outside Codex, so the seat proves execution by observation instead. For an
// observation to mean anything it must be BOUND to what was observed: a bare
// timestamp cannot tell you the declaration was edited afterwards, or that
// Codex was upgraded and now hashes it differently. These helpers produce the
// identity that the stamp records and `--check` re-derives.

/** Split TOML-ish text into [{header, body}] sections, preserving order. */
export function splitTomlTables(text) {
  const sections = [];
  let current = { header: '', body: [] };
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) {
      sections.push(current);
      current = { header: line.trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);
  return sections;
}

/**
 * Everything about the profile that can change what Codex will run: the hook
 * declaration in full (including any field added beside ours, which changes the
 * normalized identity) and the persisted trust state for this hook. Unrelated
 * tables Codex writes into the same file -- UI nudges and the like -- are
 * excluded so ordinary churn does not invalidate a good observation.
 */
export function hookDeclarationIdentity(profileText, key) {
  const wanted = splitTomlTables(profileText).filter(
    (section) =>
      section.header.startsWith('[[hooks.SessionStart') ||
      section.header.startsWith('[hooks.SessionStart') ||
      section.header === `[hooks.state.${JSON.stringify(key)}]`,
  );
  return wanted
    .map((section) => `${section.header}\n${section.body.join('\n').trim()}`)
    .join('\n');
}

/**
 * Identity of the Codex RUNTIME that ran the hook, so an upgrade invalidates an
 * earlier observation.
 *
 * Stat of the `codex` entry on PATH is not sufficient. The official npm CLI
 * ships `bin/codex.js`, a launcher that resolves a separate platform package
 * and spawns its native binary: the launcher can be byte-identical while the
 * build that actually executes hooks changes underneath it. So the identity is
 * anchored on what the runtime reports about itself, with the resolved entry
 * included only as a secondary signal.
 *
 * Fails CLOSED: if the runtime cannot be identified this returns null rather
 * than a constant, because a stable placeholder would let one observation stay
 * "trusted" across every future upgrade.
 */
export function codexRuntimeIdentity(env = process.env) {
  if (env.ESHYRA_SEAT_CODEX_ID) return env.ESHYRA_SEAT_CODEX_ID;
  let version = '';
  try {
    version = execFileSync('codex', ['--version'], {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
    }).trim();
  } catch {
    return null;
  }
  if (version === '') return null;

  let entry = 'unresolved-entry';
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    try {
      const resolved = realpathSync(`${dir}/codex`);
      const stat = statSync(resolved);
      entry = `${resolved}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
      break;
    } catch {
      // not here; keep looking
    }
  }
  return `${version}|${entry}`;
}

export function seatHookIdentity(profilePath, env = process.env) {
  let profileText = '';
  try {
    profileText = readFileSync(profilePath, 'utf8');
  } catch {
    return null;
  }
  const runtime = codexRuntimeIdentity(env);
  // No runtime identity means no provable observation.
  if (runtime === null) return null;
  const key = `${profilePath}:session_start:0:0`;
  return `sha256:${createHash('sha256')
    .update(hookDeclarationIdentity(profileText, key))
    .update('\u0000')
    .update(runtime)
    .digest('hex')}`;
}
