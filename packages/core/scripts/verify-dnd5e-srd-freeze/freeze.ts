/**
 * Core logic for the D&D SRD 5.1 freeze guard (eshyra-ixcd).
 *
 * Exported separately from cli.ts so unit tests can exercise the hash and
 * thaw-policy checks without spawning the CLI process or touching real frozen
 * files.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FrozenFile {
  readonly path: string;
  readonly sha256: string;
}

export interface FreezeManifest {
  readonly artifactName: string;
  readonly status: string;
  readonly auditedCommit: string;
  readonly createdBy: string;
  readonly hashAlgorithm: 'sha256';
  readonly files: readonly FrozenFile[];
}

export interface HashFailure {
  readonly path: string;
  readonly reason: 'missing' | 'mismatch';
  readonly expected?: string;
  readonly actual?: string;
}

export interface HashCheckResult {
  readonly passed: boolean;
  readonly failures: readonly HashFailure[];
}

export interface ThawCheckResult {
  readonly passed: boolean;
  readonly protectedPathsChanged: readonly string[];
  readonly thawNotesAdded: readonly string[];
  readonly hasActiveThawNote: boolean;
}

export const FROZEN_PATH_PREFIXES: readonly string[] = [
  'packages/core/sources/dnd5e-srd-5.1/',
  'packages/core/scripts/importers/dnd5e-srd-5.1/',
  'packages/core/scripts/verify-dnd5e-srd-pack/',
  'packages/core/scripts/create-dnd5e-srd-audit-bundle/',
  'packages/core/scripts/verify-dnd5e-srd-freeze/',
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/',
  'docs/audits/dnd5e-srd-5.1-final/',
];

export const FROZEN_EXACT_PATHS: readonly string[] = [
  '.github/workflows/srd-freeze-guard.yml',
];

export const THAW_NOTES_PREFIX = 'docs/audits/dnd5e-srd-5.1-final/thaw-notes/';

/**
 * Temporary switch (eshyra-nsd1): the per-PR thaw-note requirement is
 * suspended while the eshyra-o9bd re-audit epic is in flight — the artifact is
 * already in `thawed-reaudit` status, and per-change thaw notes add churn
 * without value until the post-epic re-freeze. The hash-manifest check is NOT
 * affected. Flip back to `true` at re-freeze (eshyra-2zyy), which establishes
 * a new baseline and squashes the thaw notes accumulated since the umbrella
 * freeze note.
 */
export const THAW_NOTE_CHECK_ENABLED = false;

// Files inside thaw-notes/ that are policy/template documents, not active thaw notes.
const THAW_NOTE_EXCLUDE = new Set(['README.md', 'TEMPLATE.md']);

export function isProtectedPath(filePath: string): boolean {
  // thaw-notes/ is the escape hatch — changes there never require another thaw note.
  if (filePath.startsWith(THAW_NOTES_PREFIX)) return false;
  for (const prefix of FROZEN_PATH_PREFIXES) {
    if (filePath.startsWith(prefix)) return true;
  }
  return FROZEN_EXACT_PATHS.includes(filePath);
}

export function isActiveThawNote(filePath: string): boolean {
  if (!filePath.startsWith(THAW_NOTES_PREFIX)) return false;
  const name = filePath.slice(THAW_NOTES_PREFIX.length);
  // Must be a direct child (no further subdirectories) and end in .md.
  if (name.includes('/')) return false;
  if (!name.endsWith('.md')) return false;
  return !THAW_NOTE_EXCLUDE.has(name);
}

export function computeSha256(absPath: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(absPath));
  return hash.digest('hex');
}

export function checkHashes(
  manifest: FreezeManifest,
  repoRoot: string,
): HashCheckResult {
  const failures: HashFailure[] = [];
  for (const entry of manifest.files) {
    const absPath = join(repoRoot, entry.path);
    if (!existsSync(absPath)) {
      failures.push({ path: entry.path, reason: 'missing' });
      continue;
    }
    const actual = computeSha256(absPath);
    if (actual !== entry.sha256) {
      failures.push({
        path: entry.path,
        reason: 'mismatch',
        expected: entry.sha256,
        actual,
      });
    }
  }
  return { passed: failures.length === 0, failures };
}

export function checkThawPolicy(
  changedFiles: readonly string[],
): ThawCheckResult {
  const protectedPathsChanged = changedFiles.filter(isProtectedPath);
  const thawNotesAdded = changedFiles.filter(isActiveThawNote);
  const hasActiveThawNote = thawNotesAdded.length > 0;
  const passed = protectedPathsChanged.length === 0 || hasActiveThawNote;
  return { passed, protectedPathsChanged, thawNotesAdded, hasActiveThawNote };
}

export function getChangedFiles(base: string): string[] {
  const output = execSync(`git diff --name-only ${base}...HEAD`, {
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean);
}
