import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
const childEnv = sandboxMode
  ? { ...process.env, ESHYRA_TEST_SANDBOX: '1' }
  : process.env;

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

const npm = npmCommand();
for (const script of ['format', 'check', 'typecheck', 'test']) {
  checkedNative(npm, ['run', script], { cwd: repoRoot, env: childEnv });
}
