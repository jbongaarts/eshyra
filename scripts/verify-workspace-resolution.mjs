import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export function verifyWorkspaceResolution(repoRoot) {
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
