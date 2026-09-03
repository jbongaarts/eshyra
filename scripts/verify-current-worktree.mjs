import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { buildVerificationEnvironment } from './verification-environment.mjs';

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

function verifyWorkspaceResolution(repoRoot) {
  for (const workspace of ['core', 'cli']) {
    const packagePath = join(repoRoot, 'node_modules', '@eshyra', workspace);
    let resolvedPath;
    try {
      resolvedPath = realpathSync(packagePath);
    } catch {
      throw new Error(
        `Missing worktree-local @eshyra/${workspace} installation at ${packagePath}. ` +
          'Run "npm ci" from this worktree before verification.',
      );
    }

    const pathFromRoot = relative(repoRoot, resolvedPath);
    if (
      isAbsolute(pathFromRoot) ||
      pathFromRoot === '..' ||
      pathFromRoot.startsWith(`..${sep}`)
    ) {
      throw new Error(
        `@eshyra/${workspace} resolves outside the active worktree: ${resolvedPath}. ` +
          'Run "npm ci" from this worktree before verification.',
      );
    }
  }
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
for (const script of ['format', 'check', 'typecheck', 'test']) {
  checkedNative(npm, ['run', script], { cwd: repoRoot, env: childEnv });
}
