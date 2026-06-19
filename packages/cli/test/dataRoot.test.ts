import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  campaignsDir,
  configFilePath,
  diagnosticsDir,
  doltCacheDir,
  ensureDataRoot,
  registryFilePath,
  resolveDataRoot,
  rulesPacksDir,
} from '../src/dataRoot.js';

describe('resolveDataRoot', () => {
  it('honors ESHYRA_HOME on every platform', () => {
    expect(resolveDataRoot({ ESHYRA_HOME: '/custom/root' }, 'linux')).toBe(
      '/custom/root',
    );
    expect(resolveDataRoot({ ESHYRA_HOME: 'C:\\custom' }, 'win32')).toBe(
      'C:\\custom',
    );
  });

  it('ignores a blank ESHYRA_HOME and falls back to the default', () => {
    expect(resolveDataRoot({ ESHYRA_HOME: '   ' }, 'linux')).toBe(
      join(homedir(), '.eshyra'),
    );
  });

  it('uses ~/.eshyra on macOS and Linux', () => {
    const expected = join(homedir(), '.eshyra');
    expect(resolveDataRoot({}, 'linux')).toBe(expected);
    expect(resolveDataRoot({}, 'darwin')).toBe(expected);
  });

  it('uses %LOCALAPPDATA%\\Eshyra on Windows', () => {
    expect(
      resolveDataRoot(
        { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
        'win32',
      ),
    ).toBe(join('C:\\Users\\x\\AppData\\Local', 'Eshyra'));
  });

  it('falls back to ~/AppData/Local on Windows when LOCALAPPDATA is unset', () => {
    expect(resolveDataRoot({}, 'win32')).toBe(
      join(homedir(), 'AppData', 'Local', 'Eshyra'),
    );
  });
});

describe('data-root paths', () => {
  it('places every managed artifact under the root', () => {
    const root = join('any', 'root');
    expect(configFilePath(root)).toBe(join(root, 'config.json'));
    expect(registryFilePath(root)).toBe(join(root, 'registry.json'));
    expect(campaignsDir(root)).toBe(join(root, 'campaigns'));
    expect(rulesPacksDir(root)).toBe(join(root, 'rules-packs'));
    expect(doltCacheDir(root)).toBe(join(root, 'dolt'));
    expect(diagnosticsDir(root)).toBe(join(root, 'diagnostics'));
  });
});

describe('ensureDataRoot', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the root with campaigns/ and rules-packs/ subdirectories', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'lw-root-')), 'data');
    dirs.push(root);
    ensureDataRoot(root);
    expect(statSync(campaignsDir(root)).isDirectory()).toBe(true);
    expect(statSync(rulesPacksDir(root)).isDirectory()).toBe(true);
  });

  it('is idempotent — a second call on an existing root does not throw', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'lw-root-')), 'data');
    dirs.push(root);
    ensureDataRoot(root);
    expect(() => ensureDataRoot(root)).not.toThrow();
    expect(existsSync(campaignsDir(root))).toBe(true);
  });
});
