import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildVerificationEnvironment } from './verification-environment.mjs';
import { verifyWorkspaceResolution } from './verify-workspace-resolution.mjs';

// Resolve the active git root and run full verification from there, so the
// command works the same in the parent checkout or a linked worktree.

function checkedNative(file, args, options = {}) {
  console.log(`Running: ${file} ${args.join(' ')}`);
  const result = spawnSync(file, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(
      `${file} ${args.join(' ')} failed with exit code ${result.status}`,
    );
  }
}

function checkedNativeOutput(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `${file} ${args.join(' ')} failed with exit code ${result.status}`,
    );
  }
  return result.stdout.trim();
}

// npm is a shell wrapper on Windows; invoke it through the shell there.
function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

const sandboxMode = process.argv.includes('--sandbox');
const childEnv = buildVerificationEnvironment(process.env, sandboxMode);

if (sandboxMode) {
  console.log(
    'Restricted sandbox verification enabled: subprocess and loopback integration tests may be skipped.',
  );
}

console.log('Running: git rev-parse --show-toplevel');
const repoRoot = checkedNativeOutput('git', ['rev-parse', '--show-toplevel']);

console.log(`Verifying current worktree root: ${repoRoot}`);

if (!existsSync(join(repoRoot, 'package.json'))) {
  throw new Error(`No package.json found at resolved git root: ${repoRoot}`);
}

verifyWorkspaceResolution(repoRoot);

const npm = npmCommand();
for (const script of ['format', 'check', 'typecheck']) {
  checkedNative(npm, ['run', script], { cwd: repoRoot, env: childEnv });
}

// On POSIX the test step is wrapped so each local gate run also records wall
// clock and peak AGGREGATE process-tree RSS — the figures that justify the
// worker cap in vitest.config.ts, and the ones that were unavailable when the
// two known load-dependent flakes were filed. measure-run propagates the
// suite's exit code, so the gate's pass/fail semantics are unchanged.
//
// Windows runs the suite unwrapped and unmeasured, deliberately. There `npm` is
// `npm.cmd`, and Node refuses to spawn a `.cmd` without `shell: true`, whose
// argument quoting is a hazard this telemetry does not justify. Memory sampling
// needs POSIX `ps` anyway, so the wrap would yield wall clock alone. Optional
// telemetry must not put a cross-platform gate at risk.
if (process.platform === 'win32') {
  checkedNative(npm, ['run', 'test'], { cwd: repoRoot, env: childEnv });
} else {
  checkedNative(
    process.execPath,
    [
      join(repoRoot, 'scripts', 'measure-run.mjs'),
      '--label',
      'verify-worktree-test',
      '--out',
      join(repoRoot, 'verification-metrics.jsonl'),
      '--',
      npm,
      'run',
      'test',
    ],
    { cwd: repoRoot, env: childEnv },
  );
}
