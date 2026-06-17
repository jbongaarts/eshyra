/**
 * Unit tests for the D&D SRD 5.1 freeze guard (eshyra-ixcd).
 *
 * Tests cover:
 *   - Hash check: passes with a correct fixture manifest.
 *   - Hash check: fails when a listed file is missing.
 *   - Hash check: fails when a file's content hash differs.
 *   - Thaw-note policy: protected path without thaw note fails.
 *   - Thaw-note policy: protected path with active thaw note passes.
 *   - Thaw-note policy: thaw-note-only change passes.
 *   - Thaw-note policy: non-protected path change passes.
 *   - Thaw-note policy: thaw-notes/ files are not themselves protected.
 *
 * Tests operate on fixtures/temp directories only; they do not mutate or read
 * the real freeze-manifest.json or the frozen artifact files.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkHashes,
  checkThawPolicy,
  type FreezeManifest,
  isActiveThawNote,
  isProtectedPath,
} from '../scripts/verify-dnd5e-srd-freeze/freeze.js';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function makeManifest(
  files: Array<{ path: string; sha256: string }>,
): FreezeManifest {
  return {
    artifactName: 'test artifact',
    status: 'frozen',
    auditedCommit: 'abc123',
    createdBy: 'test',
    hashAlgorithm: 'sha256',
    files,
  };
}

describe('checkHashes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'srd-freeze-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when all files exist and hashes match', () => {
    writeFileSync(join(tmpDir, 'a.json'), 'content-a');
    writeFileSync(join(tmpDir, 'b.json'), 'content-b');
    const manifest = makeManifest([
      { path: 'a.json', sha256: sha256('content-a') },
      { path: 'b.json', sha256: sha256('content-b') },
    ]);
    const result = checkHashes(manifest, tmpDir);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('fails when a listed file is missing', () => {
    writeFileSync(join(tmpDir, 'a.json'), 'content-a');
    const manifest = makeManifest([
      { path: 'a.json', sha256: sha256('content-a') },
      { path: 'missing.json', sha256: 'deadbeef' },
    ]);
    const result = checkHashes(manifest, tmpDir);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.path).toBe('missing.json');
    expect(result.failures[0]?.reason).toBe('missing');
  });

  it('fails when a file content hash differs', () => {
    writeFileSync(join(tmpDir, 'a.json'), 'tampered-content');
    const manifest = makeManifest([
      { path: 'a.json', sha256: sha256('original-content') },
    ]);
    const result = checkHashes(manifest, tmpDir);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toBe('mismatch');
    expect(result.failures[0]?.expected).toBe(sha256('original-content'));
    expect(result.failures[0]?.actual).toBe(sha256('tampered-content'));
  });

  it('reports all failures when multiple files are mismatched or missing', () => {
    writeFileSync(join(tmpDir, 'a.json'), 'wrong');
    const manifest = makeManifest([
      { path: 'a.json', sha256: sha256('correct') },
      { path: 'b.json', sha256: 'anything' },
    ]);
    const result = checkHashes(manifest, tmpDir);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(2);
  });
});

describe('checkThawPolicy', () => {
  it('passes when no protected paths changed', () => {
    const result = checkThawPolicy(['src/foo.ts', 'README.md']);
    expect(result.passed).toBe(true);
    expect(result.protectedPathsChanged).toHaveLength(0);
  });

  it('fails when a protected path changed and no thaw note is present', () => {
    const result = checkThawPolicy([
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ]);
    expect(result.passed).toBe(false);
    expect(result.protectedPathsChanged).toHaveLength(1);
    expect(result.hasActiveThawNote).toBe(false);
  });

  it('passes the thaw-note check when a protected path changed and an active thaw note is present', () => {
    const result = checkThawPolicy([
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
      'docs/audits/dnd5e-srd-5.1-final/thaw-notes/2026-06-20-fix-foo.md',
    ]);
    expect(result.passed).toBe(true);
    expect(result.protectedPathsChanged).toHaveLength(1);
    expect(result.hasActiveThawNote).toBe(true);
    expect(result.thawNotesAdded).toHaveLength(1);
  });

  it('passes when only a thaw-note file changed (no protected file changed)', () => {
    const result = checkThawPolicy([
      'docs/audits/dnd5e-srd-5.1-final/thaw-notes/2026-06-20-fix-foo.md',
    ]);
    expect(result.passed).toBe(true);
    expect(result.protectedPathsChanged).toHaveLength(0);
  });

  it('passes when only non-protected paths changed', () => {
    const result = checkThawPolicy([
      'packages/cli/src/main.ts',
      'package.json',
    ]);
    expect(result.passed).toBe(true);
  });

  it('thaw-notes/ files are never themselves treated as protected paths', () => {
    const thawNotePath =
      'docs/audits/dnd5e-srd-5.1-final/thaw-notes/2026-06-20-fix-foo.md';
    expect(isProtectedPath(thawNotePath)).toBe(false);
  });

  it('TEMPLATE.md and README.md in thaw-notes/ are not active thaw notes', () => {
    expect(
      isActiveThawNote(
        'docs/audits/dnd5e-srd-5.1-final/thaw-notes/TEMPLATE.md',
      ),
    ).toBe(false);
    expect(
      isActiveThawNote('docs/audits/dnd5e-srd-5.1-final/thaw-notes/README.md'),
    ).toBe(false);
  });

  it('a dated .md in thaw-notes/ is an active thaw note', () => {
    expect(
      isActiveThawNote(
        'docs/audits/dnd5e-srd-5.1-final/thaw-notes/2026-06-20-fix-foo.md',
      ),
    ).toBe(true);
  });

  it('a nested path inside thaw-notes/ is not an active thaw note', () => {
    expect(
      isActiveThawNote(
        'docs/audits/dnd5e-srd-5.1-final/thaw-notes/subdir/2026-06-20-fix.md',
      ),
    ).toBe(false);
  });
});

describe('isProtectedPath', () => {
  it('recognises all frozen path prefixes', () => {
    expect(
      isProtectedPath('packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf'),
    ).toBe(true);
    expect(
      isProtectedPath('packages/core/scripts/importers/dnd5e-srd-5.1/index.ts'),
    ).toBe(true);
    expect(
      isProtectedPath('packages/core/scripts/verify-dnd5e-srd-pack/cli.ts'),
    ).toBe(true);
    expect(
      isProtectedPath(
        'packages/core/scripts/create-dnd5e-srd-audit-bundle/cli.ts',
      ),
    ).toBe(true);
    expect(
      isProtectedPath('packages/core/scripts/verify-dnd5e-srd-freeze/cli.ts'),
    ).toBe(true);
    expect(
      isProtectedPath(
        'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
      ),
    ).toBe(true);
    expect(isProtectedPath('docs/audits/dnd5e-srd-5.1-final/README.md')).toBe(
      true,
    );
    expect(isProtectedPath('.github/workflows/srd-freeze-guard.yml')).toBe(
      true,
    );
  });

  it('does not protect unrelated paths', () => {
    expect(isProtectedPath('packages/cli/src/main.ts')).toBe(false);
    expect(isProtectedPath('package.json')).toBe(false);
    expect(isProtectedPath('docs/adr/0001-foo.md')).toBe(false);
  });

  it('does not protect thaw-notes/ (the escape hatch)', () => {
    expect(
      isProtectedPath(
        'docs/audits/dnd5e-srd-5.1-final/thaw-notes/2026-06-20-fix.md',
      ),
    ).toBe(false);
    expect(
      isProtectedPath('docs/audits/dnd5e-srd-5.1-final/thaw-notes/TEMPLATE.md'),
    ).toBe(false);
  });
});
