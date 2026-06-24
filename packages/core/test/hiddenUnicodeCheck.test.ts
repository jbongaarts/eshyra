import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// The guard script is plain ESM at the repo root (outside the core tsconfig's
// `src` include), so it is imported here by relative path and exercised through
// its pure exports.
import {
  FORBIDDEN_CODE_POINTS,
  formatCodePoint,
  formatFinding,
  scanContent,
  shouldScan,
} from '../../../scripts/check-hidden-unicode.mjs';

// Forbidden characters are built from code points so this test file stays free
// of the very characters it asserts on (it is itself scanned by the gate).
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), path), 'utf8'));
}

describe('hidden/bidi Unicode guard', () => {
  it('flags a bidirectional override with its position and Unicode name', () => {
    const findings = scanContent(`const label = 'admin${RLO}nimda';`);

    expect(findings).toEqual([
      {
        line: 1,
        column: 21,
        codePoint: 0x202e,
        name: 'RIGHT-TO-LEFT OVERRIDE',
      },
    ]);
  });

  it('allows benign visible Unicode punctuation', () => {
    const content =
      'Dash — en–dash, arrow →, “curly quotes”, ‘apostrophes’, 90° angle.';

    expect(scanContent(content)).toEqual([]);
  });

  it('reports 1-based line and column across multiple lines', () => {
    const findings = scanContent(`line one\nzero${ZWSP}width`);

    expect(findings).toEqual([
      { line: 2, column: 5, codePoint: 0x200b, name: 'ZERO WIDTH SPACE' },
    ]);
  });

  it('detects every code point in the forbidden set', () => {
    for (const [codePoint, name] of FORBIDDEN_CODE_POINTS) {
      const findings = scanContent(`x${String.fromCodePoint(codePoint)}y`);
      expect(findings, formatCodePoint(codePoint)).toEqual([
        { line: 1, column: 2, codePoint, name },
      ]);
    }
  });

  it('formats code points and diagnostics in the documented shape', () => {
    expect(formatCodePoint(0x202e)).toBe('U+202E');
    expect(formatCodePoint(0x00ad)).toBe('U+00AD');
    expect(
      formatFinding('path/to/file.ts', {
        line: 2,
        column: 5,
        codePoint: 0x200b,
        name: 'ZERO WIDTH SPACE',
      }),
    ).toBe(
      'path/to/file.ts:2:5: forbidden hidden/bidi Unicode U+200B ZERO WIDTH SPACE',
    );
  });

  it('scans tracked text files including generated rules-pack data, skipping binaries and vendor paths', () => {
    expect(shouldScan('packages/core/src/index.ts')).toBe(true);
    expect(shouldScan('README.md')).toBe(true);
    expect(shouldScan('package.json')).toBe(true);
    expect(shouldScan('migration.sql')).toBe(true);
    expect(shouldScan('scripts/verify-current-worktree.ps1')).toBe(true);
    // Generated SRD rules-pack JSON is the path most likely to carry
    // PDF-extracted text, so it IS scanned (not skipped like a vendor dir).
    expect(shouldScan('packages/core/data/dnd5e-srd-rules.json')).toBe(true);

    expect(shouldScan('assets/logo.png')).toBe(false);
    expect(shouldScan('Makefile')).toBe(false);
    expect(shouldScan('node_modules/foo/index.js')).toBe(false);
    expect(shouldScan('dist/index.js')).toBe(false);
  });

  it('is wired into the repo-wide check gate', () => {
    const root = readJson('package.json');
    const scripts = (root.scripts ?? {}) as Record<string, string>;

    expect(scripts['check:hidden-unicode']).toBe(
      'node scripts/check-hidden-unicode.mjs',
    );
    expect(scripts.check).toContain('check:hidden-unicode');
    expect(scripts.check).toContain('biome ci --error-on-warnings .');

    const biome = readJson('biome.json') as {
      linter?: { rules?: { suspicious?: Record<string, unknown> } };
    };
    expect(biome.linter?.rules?.suspicious?.noIrregularWhitespace).toBe(
      'error',
    );
  });

  it('passes on the current repository', () => {
    const result = execFileSync(
      process.execPath,
      ['scripts/check-hidden-unicode.mjs'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result).toMatch(
      /no forbidden hidden\/bidi Unicode characters found/,
    );
  });
});
