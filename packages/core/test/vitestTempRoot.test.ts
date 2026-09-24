import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installPerRunTempRoot,
  reapStaleTempRoots,
  TEMP_ROOT_PREFIX,
  // @ts-expect-error - .mjs tooling script without type declarations
} from '../../../scripts/vitestTempRoot.mjs';

// This is the load-bearing contract behind eshyra-knh9 / eshyra-knh9.1: a
// Vitest run must get a single per-run temp root, and whatever env object it
// is given must end up pointing at that root — that's what makes
// `os.tmpdir()` inside every worker and spawned child process resolve there,
// so a `rm -rf` of the root at teardown sweeps up everything the run created
// under TMPDIR. `baseDir`/`env`/`pid`/`isAlive` are all injectable so this
// never touches the real process environment or the real `os.tmpdir()`
// (which the running suite itself depends on).

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), 'eshyra-vitest-root-test-sandbox-'));
}

describe('installPerRunTempRoot', () => {
  const sandboxes: string[] = [];

  afterEach(() => {
    for (const dir of sandboxes.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates a root under baseDir and points TMPDIR/TMP/TEMP at it', () => {
    const baseDir = sandbox();
    sandboxes.push(baseDir);
    const env: Record<string, string | undefined> = {};

    const { root } = installPerRunTempRoot({
      baseDir,
      env,
      pid: 4242,
      registerExitHandler: false,
    });

    expect(root.startsWith(join(baseDir, TEMP_ROOT_PREFIX))).toBe(true);
    expect(env.TMPDIR).toBe(root);
    expect(env.TMP).toBe(root);
    expect(env.TEMP).toBe(root);
    expect(existsSync(root)).toBe(true);
    expect(readFileSync(join(root, 'owner.pid'), 'utf8').trim()).toBe('4242');
  });

  it('cleanup() removes the created root', () => {
    const baseDir = sandbox();
    sandboxes.push(baseDir);

    const { root, cleanup } = installPerRunTempRoot({
      baseDir,
      env: {},
      registerExitHandler: false,
    });
    expect(existsSync(root)).toBe(true);

    cleanup();

    expect(existsSync(root)).toBe(false);
  });

  it('does not register a process exit handler when told not to', () => {
    const baseDir = sandbox();
    sandboxes.push(baseDir);
    const before = process.listenerCount('exit');

    installPerRunTempRoot({ baseDir, env: {}, registerExitHandler: false });

    expect(process.listenerCount('exit')).toBe(before);
  });
});

describe('reapStaleTempRoots', () => {
  const sandboxes: string[] = [];

  afterEach(() => {
    for (const dir of sandboxes.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeRoot(baseDir: string, name: string, pid?: number): string {
    const dir = join(baseDir, `${TEMP_ROOT_PREFIX}${name}`);
    mkdirSync(dir, { recursive: true });
    if (pid !== undefined) {
      writeFileSync(join(dir, 'owner.pid'), String(pid));
    }
    return dir;
  }

  it('removes a root whose owner PID is reported dead', () => {
    const baseDir = sandbox();
    sandboxes.push(baseDir);
    const deadRoot = makeRoot(baseDir, 'dead', 111);

    reapStaleTempRoots(baseDir, () => false);

    expect(existsSync(deadRoot)).toBe(false);
  });

  it('leaves a root whose owner PID is reported alive', () => {
    const baseDir = sandbox();
    sandboxes.push(baseDir);
    const liveRoot = makeRoot(baseDir, 'live', 222);

    reapStaleTempRoots(baseDir, () => true);

    expect(existsSync(liveRoot)).toBe(true);
  });

  it('leaves a root with no owner.pid marker alone (a concurrent run still creating it)', () => {
    const baseDir = sandbox();
    sandboxes.push(baseDir);
    const partialRoot = makeRoot(baseDir, 'partial');

    reapStaleTempRoots(baseDir, () => false);

    expect(existsSync(partialRoot)).toBe(true);
  });

  it('ignores directories that do not carry the eshyra-vitest- prefix', () => {
    const baseDir = sandbox();
    sandboxes.push(baseDir);
    const unrelated = join(baseDir, 'some-other-tool-cache');
    mkdirSync(unrelated, { recursive: true });

    reapStaleTempRoots(baseDir, () => false);

    expect(existsSync(unrelated)).toBe(true);
  });
});
