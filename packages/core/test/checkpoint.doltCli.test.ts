import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DoltConfigError,
  ensureDoltRoot,
  sqlLiteral,
} from '../src/persistence/checkpoint/doltCli.js';

describe('sqlLiteral', () => {
  it("doubles a single quote (it can't → 'it can''t')", () => {
    expect(sqlLiteral("it can't")).toBe("'it can''t'");
  });

  it("escapes a backslash (a\\b → 'a\\\\b')", () => {
    // Source string is the two characters: a  \  b
    // Expected output:  '  a  \\  b  '  (the backslash is doubled)
    expect(sqlLiteral('a\\b')).toBe("'a\\\\b'");
  });

  it('regression guard: JSON-style \\n (backslash + n) stays two characters', () => {
    // A payload containing the two-character sequence backslash-n — which is
    // what JSON encoding produces for fields that hold newlines — must NOT
    // collapse to a real newline character after dolt processes the literal.
    // Without escaping backslashes first, dolt/MySQL would interpret `\n` as
    // a real newline and silently corrupt every stored value that came from
    // JSON-encoded text.
    //
    // Source string: the two characters  \  n
    // Expected SQL literal:  '  \\  n  '  (backslash doubled, n unchanged)
    expect(sqlLiteral('\\n')).toBe("'\\\\n'");
  });

  it('escapes both a single quote and a backslash in the same string', () => {
    // Source: it's\done  (apostrophe + backslash)
    // Expected: 'it''s\\done'
    expect(sqlLiteral("it's\\done")).toBe("'it''s\\\\done'");
  });
});

describe('ensureDoltRoot (managed dolt config_global.json)', () => {
  // A fresh root per test: ensureDoltRoot caches prepared roots per-process, so
  // unique dirs keep each assertion independent of the others.
  function freshRoot(): string {
    return mkdtempSync(join(tmpdir(), 'lw-doltroot-'));
  }
  function cfgPath(root: string): string {
    return join(root, '.dolt', 'config_global.json');
  }
  function readCfg(root: string): Record<string, unknown> {
    return JSON.parse(readFileSync(cfgPath(root), 'utf8'));
  }
  function seedCfg(root: string, contents: string): void {
    mkdirSync(join(root, '.dolt'), { recursive: true });
    writeFileSync(cfgPath(root), contents);
  }

  it('creates config_global.json with metrics disabled when none exists', () => {
    const root = freshRoot();
    ensureDoltRoot(root);
    expect(readCfg(root)).toEqual({ 'metrics.disabled': 'true' });
  });

  it('enforces metrics.disabled on an existing config that lacks it, preserving other keys', () => {
    const root = freshRoot();
    seedCfg(
      root,
      JSON.stringify({ 'user.name': 'someone', 'init.defaultBranch': 'main' }),
    );
    ensureDoltRoot(root);
    expect(readCfg(root)).toEqual({
      'user.name': 'someone',
      'init.defaultBranch': 'main',
      'metrics.disabled': 'true',
    });
  });

  it('treats an empty existing file as {} and writes metrics.disabled', () => {
    const root = freshRoot();
    seedCfg(root, '   \n');
    ensureDoltRoot(root);
    expect(readCfg(root)).toEqual({ 'metrics.disabled': 'true' });
  });

  it('fails fast on invalid JSON rather than overwriting unrelated data', () => {
    const root = freshRoot();
    seedCfg(root, '{ this is not json');
    expect(() => ensureDoltRoot(root)).toThrow(DoltConfigError);
    // original content is left intact (not silently clobbered)
    expect(readFileSync(cfgPath(root), 'utf8')).toBe('{ this is not json');
  });

  it('fails fast when the config is valid JSON but not an object', () => {
    const root = freshRoot();
    seedCfg(root, '["a","b"]');
    expect(() => ensureDoltRoot(root)).toThrow(DoltConfigError);
  });
});
