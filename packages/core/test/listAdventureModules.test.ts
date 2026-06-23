import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listAdventureModulesInDir,
  listBundledAdventureModules,
} from '../src/internal.js';

const HOLLOW_ID = 'eshyra:hollow-beneath-emberfall';

// The real bundled module pack, used as a guaranteed-valid fixture source so
// these tests assert enumeration behavior without hand-authoring a full module.
const BUNDLED_HOLLOW_DIR = fileURLToPath(
  new URL(
    '../data/adventure-modules/eshyra_hollow-beneath-emberfall/',
    import.meta.url,
  ),
);

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eshyra-adventure-modules-'));
  tmpDirs.push(dir);
  return dir;
}

/** Install a valid pack (copied from the bundled module) under `root/dirName`, rewriting its id. */
function installModule(root: string, dirName: string, id: string): string {
  const dir = join(root, dirName);
  cpSync(BUNDLED_HOLLOW_DIR, dir, { recursive: true });
  const file = join(dir, 'adventure-module.json');
  // The module's own id appears exactly once; settingCompatibility references a
  // different id, so a single targeted replace is safe.
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace(`"${HOLLOW_ID}"`, JSON.stringify(id)),
  );
  return dir;
}

describe('listBundledAdventureModules', () => {
  it('includes the bundled Hollow Beneath Emberfall module', () => {
    const ids = listBundledAdventureModules().map((entry) => entry.module.id);
    expect(ids).toContain(HOLLOW_ID);
  });
});

describe('listAdventureModulesInDir', () => {
  it('returns [] for a missing directory', () => {
    expect(
      listAdventureModulesInDir(join(tmpRoot(), 'does-not-exist')),
    ).toEqual([]);
  });

  it('returns [] for an empty directory', () => {
    expect(listAdventureModulesInDir(tmpRoot())).toEqual([]);
  });

  it('loads well-formed packs and skips malformed dirs, missing packs, and stray files', () => {
    const root = tmpRoot();
    const validDir = installModule(root, 'hollow', HOLLOW_ID);
    // A directory whose pack file is present but unparseable.
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', 'adventure-module.json'), '{ not json');
    // A directory with no pack file at all.
    mkdirSync(join(root, 'no-pack'));
    // A stray top-level file (not a directory).
    writeFileSync(join(root, 'README.txt'), 'ignore me');

    const found = listAdventureModulesInDir(root);
    expect(found.map((entry) => entry.module.id)).toEqual([HOLLOW_ID]);
    expect(found[0]?.dir).toBe(validDir);
  });

  it('sorts results by module id, not directory name', () => {
    const root = tmpRoot();
    // Directory names sort opposite to the module ids they carry.
    installModule(root, 'zzz-first-dir', 'eshyra:alpha-adventure');
    installModule(root, 'aaa-second-dir', 'eshyra:zeta-adventure');

    expect(listAdventureModulesInDir(root).map((e) => e.module.id)).toEqual([
      'eshyra:alpha-adventure',
      'eshyra:zeta-adventure',
    ]);
  });
});
