import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Functional fail-closed regression tests for the POSIX installer
// (scripts/release/install.sh). These run install.sh against a fake local
// dist-release served over a file:// base URL and assert that the checksum
// gate fails closed. They do NOT build a real artifact: every case here either
// fails at the verification step (before extraction) or only needs to prove the
// verifier ran, so a placeholder archive file is sufficient.
//
// POSIX only: the script is `/bin/sh`. Skipped on Windows, where the PowerShell
// installer's equivalent fail-closed behavior is asserted at the source level in
// releaseInstallerPolicy.test.ts.

const isWindows = process.platform === 'win32';
const repoRoot = resolve(process.cwd());
const installScript = join(repoRoot, 'scripts', 'release', 'install.sh');

// Resolve an absolute /bin/sh so PATH overrides in the "no hashing tool" case
// don't affect which shell interprets the script.
const shPath =
  spawnSync('sh', ['-c', 'command -v sh'], {
    encoding: 'utf8',
  }).stdout?.trim() || '/bin/sh';

/** Node platform/arch -> the artifact target triple install.sh resolves to. */
function target(): string {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform;
  return `${os}-${process.arch}`;
}

const ARCHIVE_NAME = `eshyra-0.0.0-${target()}.tar.gz`;

interface RunResult {
  status: number | null;
  output: string;
}

describe.skipIf(isWindows)('POSIX installer checksum fail-closed', () => {
  let scratch: string;
  let baseDir: string;
  let installRoot: string;
  let binDir: string;
  let fakeHome: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'eshyra-checksum-test-'));
    baseDir = join(scratch, 'dist-release');
    installRoot = join(scratch, 'data');
    binDir = join(scratch, 'bin');
    fakeHome = join(scratch, 'home');
    for (const d of [baseDir, installRoot, binDir, fakeHome]) {
      mkdirSync(d, { recursive: true });
    }
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Write the placeholder archive (returns its real sha256) and a
   * sha256sums.txt built from the given lines.
   */
  function seed(sumsLines: string[]): string {
    const archivePath = join(baseDir, ARCHIVE_NAME);
    const bytes = Buffer.from('not-a-real-archive\n');
    writeFileSync(archivePath, bytes);
    writeFileSync(join(baseDir, 'sha256sums.txt'), `${sumsLines.join('\n')}\n`);
    return createHash('sha256').update(bytes).digest('hex');
  }

  /** Run install.sh in file:// base-URL mode with optional PATH override. */
  function runInstaller(pathOverride?: string): RunResult {
    const result = spawnSync(shPath, [installScript], {
      encoding: 'utf8',
      env: {
        PATH: pathOverride ?? process.env.PATH,
        HOME: fakeHome,
        ESHYRA_BASE_URL: `file://${baseDir}`,
        ESHYRA_INSTALL_ROOT: installRoot,
        ESHYRA_BIN_DIR: binDir,
      },
    });
    return {
      status: result.status,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  }

  it('fails when sha256sums.txt exists but has no entry for the archive', () => {
    seed([
      'deadbeef00000000000000000000000000000000000000000000000000000000  some-other-file.tar.gz',
    ]);
    const { status, output } = runInstaller();
    expect(status).not.toBe(0);
    expect(output).toMatch(/no checksum entry/i);
  });

  it('fails when the checksum does not match (tampered/corrupt download)', () => {
    seed([
      `0000000000000000000000000000000000000000000000000000000000000000  ${ARCHIVE_NAME}`,
    ]);
    const { status, output } = runInstaller();
    expect(status).not.toBe(0);
    expect(output).toMatch(/SHA-256 mismatch/i);
  });

  it('fails when checksums are published but no SHA-256 tool is available', () => {
    // Any entry for the archive is enough; the failure is that no hashing tool
    // can compute the actual hash to compare against it.
    seed([
      `1111111111111111111111111111111111111111111111111111111111111111  ${ARCHIVE_NAME}`,
    ]);
    // Build a PATH containing only the tools install.sh needs to reach the
    // verification step, deliberately omitting sha256sum and shasum.
    const toolBin = join(scratch, 'toolbin');
    mkdirSync(toolBin, { recursive: true });
    for (const tool of [
      'uname',
      'mktemp',
      'curl',
      'tar',
      'grep',
      'cut',
      'basename',
      'rm',
    ]) {
      const resolved = spawnSync('sh', ['-c', `command -v ${tool}`], {
        encoding: 'utf8',
      }).stdout?.trim();
      if (resolved) symlinkSync(resolved, join(toolBin, tool));
    }
    const { status, output } = runInstaller(toolBin);
    expect(status).not.toBe(0);
    expect(output).toMatch(/no SHA-256 tool/i);
  });

  it('passes verification when the checksum matches (verifier actually runs)', () => {
    const hash = seed([]);
    // Re-seed with the correct hash now that we have it.
    writeFileSync(
      join(baseDir, 'sha256sums.txt'),
      `${hash}  ${ARCHIVE_NAME}\n`,
    );
    const { output } = runInstaller();
    // The install fails later (the placeholder is not a real artifact), but it
    // must get past verification, proving the gate accepted a good hash rather
    // than skipping it.
    expect(output).toContain('SHA-256 verified');
  });
});

describe('installer test knobs are present in install.sh', () => {
  it('install.sh honors ESHYRA_INSTALL_ROOT and ESHYRA_BIN_DIR', () => {
    const sh = readFileSync(installScript, 'utf8');
    expect(sh).toContain('ESHYRA_INSTALL_ROOT');
    expect(sh).toContain('ESHYRA_BIN_DIR');
  });
});
