// Build a self-contained, per-platform GitHub Release CLI artifact.
//
// Decision: eshyra-upef. The artifact bundles a pinned Node 24 runtime, the
// ABI-matched better-sqlite3 prebuild, the built @eshyra/cli + @eshyra/core
// dist (production deps only), the bundled SRD rules-pack data, and the
// license/notice files. The user installs nothing else: no system Node is
// required, and dolt stays lazy/self-provisioned (it is NOT bundled).
//
// This build is HOST-TARGETED: it packages an artifact for the platform/arch
// it runs on, using `process.execPath` as the runtime and the better-sqlite3
// prebuild that npm installed for this exact Node ABI. Cross-platform coverage
// comes from running this once per OS in the release CI matrix — the same
// model the existing install-smoke job already uses. No npm package is
// published and no package `private` guard is touched.
//
// Usage:
//   node scripts/release/build-release-artifact.mjs [--out <dir>] [--keep-stage]
//
// Output: dist-release/eshyra-<version>-<os>-<arch>.(tar.gz|zip) plus a
// matching .json metadata sidecar.

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function parseArgs(argv) {
  const opts = { out: join(root, 'dist-release'), keepStage: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      i += 1;
      opts.out = resolve(argv[i]);
    } else if (arg === '--keep-stage') {
      opts.keepStage = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

/** Map Node's platform/arch onto the artifact's published target names. */
function targetName() {
  const os =
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'darwin'
        : process.platform;
  return { os, arch: process.arch, isWindows: process.platform === 'win32' };
}

function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${cmd} ${args.join(' ')} failed with ${result.status}`,
        result.stdout,
        result.stderr,
      ].join('\n'),
    );
  }
  return result.stdout ?? '';
}

/** Invoke npm portably (Windows resolves `npm` via cmd.exe). */
function npm(args, extraEnv = {}) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], extraEnv);
  }
  if (process.platform === 'win32') {
    return run(
      'cmd.exe',
      ['/d', '/s', '/c', ['npm', ...args].join(' ')],
      extraEnv,
    );
  }
  return run('npm', args, extraEnv);
}

/** Recursively find the first file whose path ends with `suffix`. */
function findFile(dir, suffix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, suffix);
      if (hit) return hit;
    } else if (full.replaceAll('\\', '/').endsWith(suffix)) {
      return full;
    }
  }
  return undefined;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Build the THIRD-PARTY / attribution NOTICE from the live rules-pack manifest
 * so the required CC-BY 4.0 SRD attribution can never drift from the data that
 * actually ships.
 */
function buildNotice() {
  const manifestPath = join(
    root,
    'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json',
  );
  const manifest = readJson(manifestPath);
  const srd = manifest.license?.attributionText ?? '';
  return `${[
    'Eshyra — Third-Party Notices',
    '',
    'Eshyra source code is licensed under the PolyForm Noncommercial License',
    '1.0.0 (see LICENSE). Commercial rights are reserved (see',
    'COMMERCIAL-LICENSE.md). The components below are bundled in this artifact',
    'under their own licenses.',
    '',
    '== Bundled rules content: D&D System Reference Document 5.1 ==',
    '',
    'License: Creative Commons Attribution 4.0 International (CC BY 4.0).',
    'This attribution is REQUIRED on redistribution of the bundled rules data:',
    '',
    srd,
    '',
    '== Bundled runtime components ==',
    '',
    '- Node.js runtime (runtime/): see https://github.com/nodejs/node/blob/main/LICENSE',
    '- better-sqlite3 (native SQLite binding): MIT License',
    '- @anthropic-ai/claude-agent-sdk: see its bundled LICENSE under app/',
    '',
    'Full dependency license texts ship alongside each package under app/.',
  ].join('\n')}\n`;
}

function buildReadme(version, target) {
  const ext = target.isWindows ? 'zip' : 'tar.gz';
  return `${[
    `Eshyra CLI — core v${version} (${target.os}-${target.arch})`,
    '',
    'Self-contained build. A Node.js runtime is bundled under runtime/, so you',
    'do NOT need Node installed. Checkpoint/history support (dolt) is downloaded',
    'on first use into ~/.eshyra and is not bundled here.',
    '',
    'Eshyra is source-available and free for NON-COMMERCIAL use under the',
    'PolyForm Noncommercial License 1.0.0 (LICENSE). Commercial rights are',
    'reserved (COMMERCIAL-LICENSE.md). Bundled rules content (D&D SRD 5.1)',
    'is under CC BY 4.0 and carries its own attribution (NOTICE).',
    '',
    'Run:',
    target.isWindows
      ? '  bin\\eshyra.cmd            # prints setup help until a provider key is set'
      : '  ./bin/eshyra              # prints setup help until a provider key is set',
    '',
    'Set a provider key, then start a campaign:',
    '  ANTHROPIC_API_KEY=... (or CLAUDE_CODE_OAUTH_TOKEN=...)',
    target.isWindows ? '  bin\\eshyra.cmd play' : '  ./bin/eshyra play',
    '',
    `Artifact format: .${ext}. See docs for install/update instructions.`,
  ].join('\n')}\n`;
}

function writeLaunchers(stageDir, entryRel) {
  // POSIX launcher: exec the bundled node by absolute path (works with an empty
  // PATH), and prepend runtime/ to PATH so the Agent SDK's `node` subprocess
  // also resolves to the bundled runtime rather than any system Node.
  const sh = `#!/bin/sh
set -e
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/.." && pwd)
PATH="$root/runtime:$PATH"
export PATH
exec "$root/runtime/node" "$root/${entryRel}" "$@"
`;
  const cmd = `@echo off\r
setlocal\r
set "HERE=%~dp0"\r
set "ROOT=%HERE%.."\r
set "PATH=%ROOT%\\runtime;%PATH%"\r
"%ROOT%\\runtime\\node.exe" "%ROOT%\\${entryRel.replaceAll('/', '\\')}" %*\r
`;
  const binDir = join(stageDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'eshyra'), sh, { mode: 0o755 });
  writeFileSync(join(binDir, 'eshyra.cmd'), cmd);
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = targetName();
  const pkg = readJson(join(root, 'package.json'));
  const version = pkg.version ?? '0.0.0';
  const baseName = `eshyra-${version}-${target.os}-${target.arch}`;

  const scratch = mkdtempSync(join(tmpdir(), 'eshyra-release-'));
  const packDir = join(scratch, 'packs');
  const appPrefix = join(scratch, 'app');
  const stageDir = join(scratch, baseName);
  const cache = join(scratch, 'npm-cache');
  for (const d of [packDir, appPrefix, stageDir, cache]) {
    mkdirSync(d, { recursive: true });
  }

  try {
    console.log('• building workspace (tsc --build)…');
    npm(['run', 'build']);

    console.log('• packing @eshyra/core and @eshyra/cli…');
    const coreTar = packWorkspace('@eshyra/core', packDir, cache);
    const cliTar = packWorkspace('@eshyra/cli', packDir, cache);

    console.log(
      '• installing production app tree (no devDeps, prebuilt native)…',
    );
    // Production-only global install into a private prefix. --omit=dev keeps
    // tsx/pdfkit/pdfjs out; build_from_source=false keeps the better-sqlite3
    // prebuilt-binary path (ADR 0008). This reuses the exact mechanism the
    // install-smoke job already validates.
    npm(
      [
        'install',
        '--omit=dev',
        '--global',
        '--prefix',
        appPrefix,
        '--cache',
        cache,
        '--prefer-online',
        coreTar,
        cliTar,
      ],
      { npm_config_build_from_source: 'false' },
    );

    console.log('• assembling staging tree…');
    // app/node_modules: the installed production module tree only. We
    // deliberately drop npm's own global bin shims (their symlinks point at the
    // scratch prefix and would dangle after relocation); our own launcher under
    // bin/ supersedes them. The global-install layout differs by platform
    // (lib/node_modules on POSIX, node_modules on Windows), so normalize both
    // to app/node_modules.
    const installedModules = existsSync(join(appPrefix, 'lib', 'node_modules'))
      ? join(appPrefix, 'lib', 'node_modules')
      : join(appPrefix, 'node_modules');
    cpSync(installedModules, join(stageDir, 'app', 'node_modules'), {
      recursive: true,
    });

    // runtime/: the Node binary running this script (ABI-matched to the
    // better-sqlite3 prebuild we just installed). Official Node builds are
    // self-contained single binaries.
    const runtimeDir = join(stageDir, 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    const nodeName = target.isWindows ? 'node.exe' : 'node';
    const bundledNode = join(runtimeDir, nodeName);
    cpSync(process.execPath, bundledNode);
    if (!target.isWindows) chmodSync(bundledNode, 0o755);

    // Resolve the installed CLI entry relative to the staged app/.
    const cliEntryAbs = findFile(
      join(stageDir, 'app'),
      '@eshyra/cli/dist/index.js',
    );
    if (!cliEntryAbs) {
      throw new Error('could not locate @eshyra/cli/dist/index.js in app tree');
    }
    const entryRel = relative(stageDir, cliEntryAbs).replaceAll('\\', '/');
    writeLaunchers(stageDir, entryRel);

    // License + notice files.
    cpSync(join(root, 'LICENSE'), join(stageDir, 'LICENSE'));
    cpSync(
      join(root, 'COMMERCIAL-LICENSE.md'),
      join(stageDir, 'COMMERCIAL-LICENSE.md'),
    );
    writeFileSync(join(stageDir, 'NOTICE'), buildNotice());
    writeFileSync(join(stageDir, 'README.txt'), buildReadme(version, target));

    console.log('• archiving…');
    mkdirSync(opts.out, { recursive: true });
    const ext = target.isWindows ? 'zip' : 'tar.gz';
    const archive = join(opts.out, `${baseName}.${ext}`);
    rmSync(archive, { force: true });
    if (target.isWindows) {
      // bsdtar (`tar.exe`) ships with Windows 10+ and infers zip from -a.
      run('tar', ['-a', '-c', '-f', archive, '-C', scratch, baseName]);
    } else {
      run('tar', ['-czf', archive, '-C', scratch, baseName]);
    }

    const meta = {
      name: baseName,
      version,
      os: target.os,
      arch: target.arch,
      node: process.version,
      entry: entryRel,
      archive: basename(archive),
      unpackedBytes: dirSize(stageDir),
      builtAt: new Date().toISOString(),
    };
    writeFileSync(`${archive}.json`, `${JSON.stringify(meta, null, 2)}\n`);

    console.log(`\n✓ built ${relative(root, archive)}`);
    console.log(
      `  unpacked size ≈ ${(meta.unpackedBytes / 1e6).toFixed(1)} MB`,
    );
    console.log(`  entry: ${entryRel}`);
    return archive;
  } finally {
    if (opts.keepStage) {
      console.log(`(kept staging dir: ${scratch})`);
    } else {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

function packWorkspace(workspace, packDir, cache) {
  const out = npm(
    [
      'pack',
      '--workspace',
      workspace,
      '--pack-destination',
      packDir,
      '--json',
      '--silent',
    ],
    { npm_config_cache: cache },
  );
  const [pack] = JSON.parse(out);
  const tarball = join(packDir, pack.filename);
  if (!existsSync(tarball)) {
    throw new Error(`npm pack did not create ${tarball}`);
  }
  return tarball;
}
main();
