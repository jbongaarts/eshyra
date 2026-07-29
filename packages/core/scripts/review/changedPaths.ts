/**
 * Local changed-path discovery, used when `review:classify` is run without a
 * PR number.
 *
 * The authoritative path set for a PR comes from GitHub (files changed against
 * the merge base). This local variant exists so an agent can classify a change
 * BEFORE opening a PR — which is exactly when classification matters most for
 * profiles that require pre-implementation authorization.
 */

import { spawnSync } from 'node:child_process';

export function localChangedPaths(
  repoRoot: string,
  baseRef = 'origin/main',
): readonly string[] {
  const mergeBase = git(repoRoot, ['merge-base', baseRef, 'HEAD']);
  if (mergeBase === undefined) {
    return [];
  }
  const committed = git(repoRoot, ['diff', '--name-only', mergeBase, 'HEAD']);
  const working = git(repoRoot, ['status', '--porcelain']);
  const paths = new Set<string>();
  for (const line of (committed ?? '').split('\n')) {
    const path = line.trim();
    if (path !== '') {
      paths.add(path);
    }
  }
  for (const line of (working ?? '').split('\n')) {
    // Porcelain v1: two status characters, a space, then the path. Renames
    // carry `old -> new`; the new path is the one that matters for policy.
    const path = line.slice(3).trim();
    if (path === '') {
      continue;
    }
    const arrow = path.indexOf(' -> ');
    paths.add(arrow === -1 ? path : path.slice(arrow + 4));
  }
  return [...paths].sort();
}

function git(cwd: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim();
}
