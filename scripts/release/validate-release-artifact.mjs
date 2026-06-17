// Validate a built GitHub Release CLI artifact before publication.
//
// Decision: eshyra-upef / eshyra-0p8u. This unpacks the artifact into a clean
// temp directory and asserts:
//   1. it runs using ONLY the bundled Node runtime (no system Node), and exits
//      with the expected no-config behavior;
//   2. the required license/commercial/notice/readme files are present;
//   3. the bundled third-party rules content (and its attribution NOTICE) ship;
//   4. no forbidden content leaked in (audit bundles, tsbuildinfo, temp files,
//      local secrets, stray native binaries, source tarballs, VCS/source dirs).
//
// Usage:
//   node scripts/release/validate-release-artifact.mjs [archive]
// With no argument it validates every artifact under dist-release/.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const REQUIRED_FILES = [
  'LICENSE',
  'COMMERCIAL-LICENSE.md',
  'NOTICE',
  'README.txt',
  // Redistributed license text for the bundled Node runtime binary.
  'THIRD-PARTY/node-LICENSE.txt',
];
const EXPECTED_OUTPUT = ['Eshyra', 'ANTHROPIC_API_KEY', 'eshyra play'];
// Strong marker proving the bundled Node runtime's own license text shipped
// (not just a URL reference in NOTICE).
const NODE_LICENSE_MARKER = 'Node.js is licensed';

// A path lives inside a third-party dependency (i.e. it is the published
// content of a pinned npm package, not something Eshyra's build produced).
// The staged module tree is app/node_modules/...; our own product files are
// only @eshyra/{core,cli}/{dist,data}. A path is vendored if it is a non-Eshyra
// top-level dep, or reaches a further nested node_modules/ segment.
const ESHYRA_PKG = /^app\/node_modules\/@eshyra\/(core|cli)\//;
function inThirdPartyDep(rel) {
  if (rel.replace(ESHYRA_PKG, '').includes('node_modules/')) return true;
  return (
    rel.startsWith('app/node_modules/') &&
    !rel.startsWith('app/node_modules/@eshyra/')
  );
}

// Genuinely dangerous content that must never ship regardless of origin — these
// scan the whole tree, including vendored dependencies.
const FORBIDDEN_ANYWHERE = [
  {
    why: 'audit bundle',
    test: (p) =>
      /(^|\/)\.audit-bundles(\/|$)/.test(p) || p.includes('audit-bundle'),
  },
  {
    why: 'env/secret file',
    test: (p) =>
      /(^|\/)\.env($|\.)/.test(p) ||
      /(^|\/)(id_rsa|\.npmrc)$/.test(p) ||
      p.endsWith('.pem') ||
      p.endsWith('.key'),
  },
  {
    why: 'VCS / editor dir',
    test: (p) => /(^|\/)(\.git|\.hg|\.svn|\.vscode|\.idea)(\/|$)/.test(p),
  },
  { why: 'OS junk', test: (p) => /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(p) },
  {
    why: 'packed source tarball',
    test: (p) => p.endsWith('.tgz') || p.endsWith('.tar.gz'),
  },
  {
    why: 'unexpected native binary',
    test: (p) => p.endsWith('.node') && basename(p) !== 'better_sqlite3.node',
  },
];

// Eshyra's own build artifacts leaking into the package — pinned dependencies
// legitimately ship their own src/ and tsbuildinfo, so these skip vendored
// paths and only police what our `files` allowlist controls.
const FORBIDDEN_OURS = [
  { why: 'Eshyra build info leaked', test: (p) => p.endsWith('.tsbuildinfo') },
  {
    why: 'Eshyra package source leaked (expected dist only)',
    test: (p) => /@eshyra\/(core|cli)\/src\//.test(p),
  },
];

function fail(msg) {
  throw new Error(msg);
}

/** Normalize whitespace so attribution-text matching survives reflow. */
function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function walk(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = full.slice(base.length + 1).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      acc.push({ rel, dir: true });
      walk(full, base, acc);
    } else {
      acc.push({ rel, dir: false });
    }
  }
  return acc;
}

function unpack(archive, dest) {
  const isZip = archive.endsWith('.zip');
  // bsdtar reads both .tar.gz and .zip; it is present on Linux/macOS and on
  // Windows 10+ (tar.exe), matching how the build script writes archives.
  const result = spawnSync('tar', ['-xf', archive, '-C', dest], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail(
      `failed to unpack ${basename(archive)} (${isZip ? 'zip' : 'tar.gz'}): ${result.stderr}`,
    );
  }
}

/** The archive contains a single top-level dir named after the artifact. */
function artifactRoot(dest) {
  const entries = readdirSync(dest, { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  );
  if (entries.length !== 1) {
    fail(
      `expected exactly one top-level dir in archive, found ${entries.length}`,
    );
  }
  return join(dest, entries[0].name);
}

function nodeBinary(rootDir, isWindows) {
  return join(rootDir, 'runtime', isWindows ? 'node.exe' : 'node');
}

function validate(archive) {
  console.log(`\n=== ${basename(archive)} ===`);
  const isWindows = archive.includes('-windows-');
  const dest = mkdtempSync(join(tmpdir(), 'eshyra-validate-'));
  try {
    unpack(archive, dest);
    const appRoot = artifactRoot(dest);
    const files = walk(appRoot);
    const relPaths = files.filter((f) => !f.dir).map((f) => f.rel);

    // 1. Required top-level files.
    for (const required of REQUIRED_FILES) {
      if (!existsSync(join(appRoot, required))) {
        fail(`missing required file: ${required}`);
      }
    }

    // 2. Bundled runtime + native binding + launchers.
    const node = nodeBinary(appRoot, isWindows);
    if (!existsSync(node)) fail('bundled Node runtime missing under runtime/');
    const nodeLicense = readFileSync(
      join(appRoot, 'THIRD-PARTY', 'node-LICENSE.txt'),
      'utf8',
    );
    if (!nodeLicense.includes(NODE_LICENSE_MARKER)) {
      fail(
        `bundled Node LICENSE text is missing/empty (expected "${NODE_LICENSE_MARKER}")`,
      );
    }
    if (!relPaths.some((p) => basename(p) === 'better_sqlite3.node')) {
      fail('bundled better-sqlite3 native binding missing');
    }
    const launcher = isWindows ? 'bin/eshyra.cmd' : 'bin/eshyra';
    if (!existsSync(join(appRoot, launcher)))
      fail(`launcher missing: ${launcher}`);

    // 3. Bundled rules content + its attribution. Load the bundled rules-pack
    //    manifest itself, require a non-empty license.attributionText, and
    //    assert the generated NOTICE carries that actual attribution text —
    //    not merely a heading substring that happens to share words.
    const manifestRel = relPaths.find((p) =>
      /rules-packs\/.+\/manifest\.json$/.test(p),
    );
    if (!manifestRel) fail('bundled rules-pack data missing under app/');
    const manifest = JSON.parse(
      readFileSync(join(appRoot, manifestRel), 'utf8'),
    );
    const attribution = manifest.license?.attributionText?.trim();
    if (!attribution) {
      fail(
        `bundled rules-pack manifest has empty license.attributionText (${manifestRel})`,
      );
    }
    const notice = readFileSync(join(appRoot, 'NOTICE'), 'utf8');
    // Require the full attribution text (collapsing whitespace so a reflow in
    // either source can't cause a false miss).
    if (collapse(notice).includes(collapse(attribution)) === false) {
      fail(
        'NOTICE is missing the actual SRD attribution text from the bundled ' +
          'rules-pack manifest (license.attributionText)',
      );
    }

    // 4. Forbidden-content scan over every entry.
    for (const { rel } of files) {
      for (const rule of FORBIDDEN_ANYWHERE) {
        if (rule.test(rel)) fail(`forbidden content (${rule.why}): ${rel}`);
      }
      if (!inThirdPartyDep(rel)) {
        for (const rule of FORBIDDEN_OURS) {
          if (rule.test(rel)) fail(`forbidden content (${rule.why}): ${rel}`);
        }
      }
    }

    // 5. Run from the clean unpacked dir using ONLY the bundled Node.
    //    The runtime dir is the sole PATH entry that could provide `node`, and
    //    we additionally invoke the bundled binary by absolute path, so success
    //    proves the artifact has no system-Node dependency.
    const entry = findCliEntry(appRoot);
    const sanitizedPath = [join(appRoot, 'runtime'), systemBinDirs()].join(
      delimiter,
    );
    // Fresh env (no inherited ANTHROPIC_API_KEY) forces the no-config path.
    const env = { PATH: sanitizedPath, SystemRoot: process.env.SystemRoot };
    const run = spawnSync(node, [entry], {
      cwd: dest,
      encoding: 'utf8',
      env,
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    if (run.status !== 1) {
      fail(
        `expected eshyra (no config) to exit 1, got ${run.status}\n${output}`,
      );
    }
    for (const expected of EXPECTED_OUTPUT) {
      if (!output.includes(expected)) {
        fail(`missing expected output ${JSON.stringify(expected)}:\n${output}`);
      }
    }

    // 5b. Run the bundled launcher THROUGH A SYMLINK (POSIX). The installer and
    //     the documented manual `ln -sf` both put a symlink on PATH, so "$0" is
    //     the symlink path; the launcher must resolve it to find runtime/ and
    //     the app entry. Invoking node directly (above) does not exercise that
    //     path, so without this a launcher that breaks under symlinked
    //     invocation would still pass validation.
    if (!isWindows) {
      const linkDir = mkdtempSync(join(tmpdir(), 'eshyra-launcher-'));
      try {
        const link = join(linkDir, 'eshyra');
        symlinkSync(join(appRoot, 'bin', 'eshyra'), link);
        const launcherRun = spawnSync(link, [], {
          cwd: linkDir,
          encoding: 'utf8',
          // Only system bin dirs on PATH (for dirname/readlink); the launcher
          // adds runtime/ itself. No system node is reachable.
          env: { PATH: systemBinDirs() },
        });
        const launcherOut = `${launcherRun.stdout ?? ''}${launcherRun.stderr ?? ''}`;
        if (launcherRun.status !== 1) {
          fail(
            `launcher via symlink expected exit 1, got ${launcherRun.status}\n${launcherOut}`,
          );
        }
        for (const expected of EXPECTED_OUTPUT) {
          if (!launcherOut.includes(expected)) {
            fail(
              `launcher via symlink missing expected output ${JSON.stringify(expected)}:\n${launcherOut}`,
            );
          }
        }
      } finally {
        rmSync(linkDir, { recursive: true, force: true });
      }
    }

    const bytes = walk(appRoot)
      .filter((f) => !f.dir)
      .reduce((sum, f) => sum + lstatSync(join(appRoot, f.rel)).size, 0);
    const bundledVersion =
      spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout?.trim() ??
      '?';
    console.log(
      `✓ valid — ran on bundled Node ${bundledVersion}, ` +
        `${relPaths.length} files, ${(bytes / 1e6).toFixed(1)} MB unpacked`,
    );
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

function findCliEntry(appRoot) {
  const hit = walk(join(appRoot, 'app'))
    .filter((f) => !f.dir)
    .find((f) => f.rel.endsWith('@eshyra/cli/dist/index.js'));
  if (!hit) fail('could not locate @eshyra/cli/dist/index.js for run check');
  return join(appRoot, 'app', hit.rel);
}

/** Minimal system bin dirs so the POSIX launcher's coreutils still resolve. */
function systemBinDirs() {
  return process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
    : ['/usr/bin', '/bin'].join(delimiter);
}

function discoverArchives() {
  const dir = join(root, 'dist-release');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tar.gz') || f.endsWith('.zip'))
    .map((f) => join(dir, f));
}

function main() {
  const arg = process.argv[2];
  const archives = arg ? [resolve(arg)] : discoverArchives();
  if (archives.length === 0) {
    fail(
      'no release artifacts found (build one first, or pass an archive path)',
    );
  }
  for (const archive of archives) validate(archive);
  console.log(`\n✓ ${archives.length} artifact(s) validated.`);
}

main();
