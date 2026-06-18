// Functional smoke test for the one-line POSIX installer (scripts/release/install.sh).
//
// This exercises the REAL install path against locally built release assets:
//   1. Build a release artifact (npm run release:build) if dist-release/ has none.
//   2. Generate sha256sums.txt (npm run release:checksums).
//   3. Run install.sh in ESHYRA_BASE_URL=file:// mode, pointed at dist-release/,
//      installing into throwaway ESHYRA_INSTALL_ROOT / ESHYRA_BIN_DIR locations
//      (never the developer's real ~/.local). HOME is also redirected to a temp
//      dir as a belt-and-suspenders guard.
//   4. Assert the installer actually verified the checksum ("SHA-256 verified").
//   5. Assert the resulting `eshyra` command exists and, in no-config mode,
//      exits 1 with the expected Eshyra setup guidance (ANTHROPIC_API_KEY).
//   6. Clean up all temp files.
//
// POSIX only: it shells out to `sh install.sh` and uses file:// URLs via curl.
// On Windows it exits 0 with a skip notice (the PowerShell installer is covered
// by script-level checks in releaseInstallerPolicy.test.ts).
//
// Usage:
//   node scripts/release/smoke-installer.mjs

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const distRelease = join(root, 'dist-release');
const installScript = join(root, 'scripts', 'release', 'install.sh');

function fail(msg) {
  console.error(`\nSMOKE FAILED: ${msg}\n`);
  process.exit(1);
}

if (process.platform === 'win32') {
  console.log('installer smoke: POSIX-only; skipping on Windows.');
  process.exit(0);
}

function npm(args) {
  const cli = process.env.npm_execpath;
  const result = cli
    ? spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'inherit',
      })
    : spawnSync('npm', args, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`npm ${args.join(' ')} exited ${result.status}`);
  }
}

/** Node platform/arch -> the artifact target triple the builder publishes. */
function target() {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform;
  return `${os}-${process.arch}`;
}

function findArchive() {
  if (!existsSync(distRelease)) return undefined;
  const want = `-${target()}.tar.gz`;
  return readdirSync(distRelease).find((f) => f.endsWith(want));
}

function releaseVersionFromArchive(archive) {
  const prefix = 'eshyra-';
  const suffix = `-${target()}.tar.gz`;
  if (!archive.startsWith(prefix) || !archive.endsWith(suffix)) {
    fail(`unexpected archive name for ${target()}: ${archive}`);
  }

  const version = archive.slice(prefix.length, -suffix.length);
  if (!version) {
    fail(`could not derive release version from archive name: ${archive}`);
  }

  return version;
}

const scratch = mkdtempSync(join(tmpdir(), 'eshyra-installer-smoke-'));
const installRoot = join(scratch, 'data');
const binDir = join(scratch, 'bin');
const fakeHome = join(scratch, 'home');
for (const d of [installRoot, binDir, fakeHome]) {
  mkdirSync(d, { recursive: true });
}

try {
  // 1. Always build a fresh artifact from current source so the smoke can never
  //    pass against a stale archive that predates a launcher/installer fix.
  console.log('• building release artifact (npm run release:build)…');
  npm(['run', 'release:build']);
  const archive = findArchive();
  if (!archive) {
    fail(`no ${target()} archive found under dist-release/ after build`);
  }
  console.log(`• using artifact: ${archive}`);
  const releaseVersion = releaseVersionFromArchive(archive);
  console.log(`• using release version: ${releaseVersion}`);

  // 2. Generate checksums so the installer's verification path is exercised.
  npm(['run', 'release:checksums']);
  if (!existsSync(join(distRelease, 'sha256sums.txt'))) {
    fail('release:checksums did not produce dist-release/sha256sums.txt');
  }

  // 3. Run install.sh against the local dist-release via a file:// base URL,
  //    with ESHYRA_VERSION pinned to the artifact just built. Local-base mode has
  //    no GitHub release API asset list, so the smoke must provide the version.
  //    Install into throwaway install/bin/home locations.
  console.log('• running install.sh (file:// base URL, temp install root)…');
  const install = spawnSync('sh', [installScript], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: fakeHome,
      ESHYRA_BASE_URL: `file://${distRelease}`,
      ESHYRA_VERSION: releaseVersion,
      ESHYRA_INSTALL_ROOT: installRoot,
      ESHYRA_BIN_DIR: binDir,
    },
  });
  const installOut = `${install.stdout ?? ''}${install.stderr ?? ''}`;
  console.log(installOut);
  if (install.status !== 0) {
    fail(`install.sh exited ${install.status}`);
  }

  // 4. Checksum verification must have actually run.
  if (!installOut.includes('SHA-256 verified')) {
    fail('installer did not report "SHA-256 verified" — checksum was not used');
  }

  // 5. The command must exist and run in no-config mode.
  const bin = join(binDir, 'eshyra');
  if (!existsSync(bin)) {
    fail(`installed eshyra command not found at ${bin}`);
  }
  const run = spawnSync(bin, [], {
    encoding: 'utf8',
    // Clean provider env so the no-config setup path is taken.
    env: { PATH: process.env.PATH, HOME: fakeHome },
  });
  const runOut = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (run.status !== 1) {
    fail(`expected eshyra (no config) to exit 1, got ${run.status}\n${runOut}`);
  }
  for (const expected of ['Eshyra', 'ANTHROPIC_API_KEY', 'eshyra play']) {
    if (!runOut.includes(expected)) {
      fail(
        `missing expected setup guidance ${JSON.stringify(expected)}:\n${runOut}`,
      );
    }
  }

  console.log(
    '\n✓ installer smoke passed (real install.sh + checksum verify + no-config run)',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
