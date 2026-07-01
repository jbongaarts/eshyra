// Build a self-contained, per-platform GitHub Release CLI artifact.
//
// Decision: eshyra-upef. The artifact bundles a pinned Node 24 runtime, the
// ABI-matched better-sqlite3 native addon (compiled from source on this
// runner, per ADR 0016), the built @eshyra/cli + @eshyra/core dist
// (production deps only), the bundled SRD rules-pack data, and the
// license/notice files. The user installs nothing else: no system Node is
// required, and dolt stays lazy/self-provisioned (it is NOT bundled).
//
// This build is HOST-TARGETED: it packages an artifact for the platform/arch
// it runs on, using `process.execPath` as the runtime and the better-sqlite3
// native addon that npm just compiled for this exact Node ABI. Cross-platform
// coverage comes from running this once per OS in the release CI matrix — the same
// model the existing install-smoke job already uses. No npm package is
// published and no package `private` guard is touched.
//
// Editions (ADR 0011 / bead eshyra-7zhm): the build produces a per-EDITION
// archive. An edition is a named subset of the heavy, per-platform agent SDK
// packages (Claude Agent SDK / Codex CLI) that ship in the packed app tree. The
// full production tree is installed once, then PRUNED down to the edition's
// subset, so excluded provider binaries never travel in that edition's archive.
//
// Usage:
//   node scripts/release/build-release-artifact.mjs \
//     [--edition <api|claude|codex|full>] [--out <dir>] [--keep-stage]
//   (ESHYRA_EDITION may set the edition when --edition is omitted; default
//    edition = DEFAULT_EDITION from editions.mjs.)
//
// Output: dist-release/eshyra-<edition>-<version>-<os>-<arch>.(tar.gz|zip) plus
// a matching .json metadata sidecar.

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EDITION,
  editionPackages,
  excludedProviderKeys,
  isEdition,
  isRemovablePackage,
} from './editions.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function parseArgs(argv) {
  const opts = { out: join(root, 'dist-release'), keepStage: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      i += 1;
      opts.out = resolve(argv[i]);
    } else if (arg === '--version') {
      i += 1;
      opts.version = argv[i];
    } else if (arg === '--edition') {
      i += 1;
      opts.edition = argv[i];
    } else if (arg === '--keep-stage') {
      opts.keepStage = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

/**
 * Resolve the edition to build, in precedence order:
 *   1. explicit `--edition` argument
 *   2. ESHYRA_EDITION env var
 *   3. DEFAULT_EDITION (preserves today's `claude` artifact behavior)
 * Validates against the edition catalogue so a typo fails the build loudly.
 */
function resolveEdition(explicit, env = process.env) {
  const candidate = explicit ?? env.ESHYRA_EDITION ?? DEFAULT_EDITION;
  if (!isEdition(candidate)) {
    throw new Error(
      `invalid edition: "${candidate}" (known: api, claude, codex, full)`,
    );
  }
  return candidate;
}

/**
 * Yield every installed package directory (`@scope/name` and bare `name`) under
 * any `node_modules` reachable from `startDir`, recursing into nested
 * `node_modules` (npm may hoist provider binaries under `@eshyra/core` rather
 * than the top level). Each yielded entry is `{ name, dir }` where `name` is the
 * full npm package name.
 */
function* walkInstalledPackages(startDir) {
  const modulesDir = join(startDir, 'node_modules');
  if (!existsSync(modulesDir)) return;
  for (const entry of readdirSync(modulesDir)) {
    if (entry === '.bin') continue;
    const entryDir = join(modulesDir, entry);
    if (!statSync(entryDir).isDirectory()) continue;
    if (entry.startsWith('@')) {
      // Scoped: one more level down to the actual package directories.
      for (const sub of readdirSync(entryDir)) {
        const pkgDir = join(entryDir, sub);
        if (!statSync(pkgDir).isDirectory()) continue;
        yield { name: `${entry}/${sub}`, dir: pkgDir };
        yield* walkInstalledPackages(pkgDir);
      }
    } else {
      yield { name: entry, dir: entryDir };
      yield* walkInstalledPackages(entryDir);
    }
  }
}

/**
 * Prune the staged app tree down to the edition's provider subset. For every
 * provider the edition EXCLUDES, remove that provider's wrapper AND its heavy
 * per-platform CLI binary / launcher siblings (see `AGENT_SDK_REMOVAL` /
 * `isRemovablePackage` in editions.mjs) wherever they are nested in the staged
 * `node_modules`. Pruning the wrapper alone would save almost nothing — the
 * weight is the ~223 MB platform binary the wrapper pulls in. Returns the sorted
 * list of full package names actually removed.
 */
function pruneAgentSdks(stageDir, edition) {
  const excludedKeys = excludedProviderKeys(edition);
  if (excludedKeys.length === 0) {
    return { removed: [], prunedBins: [] };
  }
  const appDir = join(stageDir, 'app');
  const removed = [];
  const prunedBins = [];
  // Collect first so removing a directory cannot disturb an in-progress walk.
  const targets = [];
  for (const pkg of walkInstalledPackages(appDir)) {
    if (isRemovablePackage(pkg.name, excludedKeys)) {
      targets.push(pkg);
    }
  }
  for (const pkg of targets) {
    if (!existsSync(pkg.dir)) continue;
    // Remove the package's launcher shims FIRST, reading its `bin` field while
    // the package.json is still present. The staging copy dereferences symlinks,
    // so a leftover `.bin/codex` is a real file (not a dangling link) that a
    // resolve-based sweep would miss — drive it from the manifest instead, so a
    // non-codex edition never ships a broken `codex` launcher on PATH.
    prunedBins.push(...removeBinShimsFor(pkg));
    rmSync(pkg.dir, { recursive: true, force: true });
    removed.push(pkg.name);
  }
  return {
    removed: [...new Set(removed)].sort(),
    prunedBins: [...new Set(prunedBins)].sort(),
  };
}

/**
 * Remove the `.bin` launcher shims a package owns, in the `node_modules/.bin`
 * dir that sibling-hosts it. Shim names come from the package's `bin` field
 * (string → the package's unscoped name; object → its keys). Also clears the
 * Windows `.cmd`/`.ps1` companions npm writes. Returns the removed shim names.
 */
function removeBinShimsFor(pkg) {
  const manifestPath = join(pkg.dir, 'package.json');
  if (!existsSync(manifestPath)) return [];
  let bin;
  try {
    bin = readJson(manifestPath).bin;
  } catch {
    return [];
  }
  if (!bin) return [];
  const names = Array.isArray(bin)
    ? []
    : typeof bin === 'string'
      ? [pkg.name.split('/').pop()]
      : Object.keys(bin);
  // The hosting node_modules is the package dir's parent (unscoped) or its
  // grandparent (scoped `@scope/name`). `.bin` sits directly inside it.
  const hostModules = pkg.name.startsWith('@')
    ? dirname(dirname(pkg.dir))
    : dirname(pkg.dir);
  const binDir = join(hostModules, '.bin');
  const removed = [];
  for (const name of names) {
    for (const shim of [name, `${name}.cmd`, `${name}.ps1`]) {
      const shimPath = join(binDir, shim);
      if (existsSync(shimPath) || isSymlink(shimPath)) {
        rmSync(shimPath, { force: true });
        if (shim === name) removed.push(name);
      }
    }
  }
  return removed;
}

/** True if `p` exists as a symbolic link (even a dangling one). */
function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

// The placeholder literal compiled into packages/core/dist/index.js (and used
// as the artifact-label fallback). The release build replaces it with the real
// tag-derived version; non-release builds keep it.
const VERSION_SENTINEL = '0.0.0-dev';

/** Strip a leading `v` and reject anything that is not a semver-like version. */
function normalizeVersion(raw) {
  const stripped = String(raw).trim().replace(/^v/, '');
  if (
    !/^\d+\.\d+(\.\d+)?(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(stripped)
  ) {
    throw new Error(
      `invalid release version: "${raw}" (expected a semver-like version, e.g. 1.2.3)`,
    );
  }
  return stripped;
}

/**
 * Resolve the release version, in precedence order:
 *   1. explicit `--version` argument
 *   2. ESHYRA_RELEASE_VERSION env var
 *   3. the pushed git tag (GITHUB_REF_NAME when GITHUB_REF_TYPE=tag)
 *   4. the VERSION_SENTINEL fallback (local/PR/dev builds)
 * The first three are normalized (and validated); the sentinel is returned
 * verbatim so dev builds are clearly marked and never get stamped.
 */
function resolveVersion(explicit, env = process.env) {
  const tag = env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : undefined;
  const candidate = explicit ?? env.ESHYRA_RELEASE_VERSION ?? tag;
  if (candidate && String(candidate).trim()) {
    return normalizeVersion(candidate);
  }
  return VERSION_SENTINEL;
}

/**
 * Stamp the resolved version into the compiled core dist so the running CLI's
 * banner reports the true release version. Replaces the single VERSION_SENTINEL
 * occurrence in packages/core/dist/index.js, asserting exactly one match so a
 * refactor that drops or duplicates the constant fails the release loudly.
 * No-op for sentinel (dev/PR) builds, which intentionally keep the `-dev` mark.
 */
function stampCoreVersion(version) {
  if (version === VERSION_SENTINEL) return;
  const distIndex = join(root, 'packages/core/dist/index.js');
  const before = readFileSync(distIndex, 'utf8');
  const occurrences = before.split(VERSION_SENTINEL).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `expected exactly one "${VERSION_SENTINEL}" in ${relative(root, distIndex)} ` +
        `to stamp CORE_VERSION, found ${occurrences}`,
    );
  }
  writeFileSync(distIndex, before.replace(VERSION_SENTINEL, version));
  console.log(`• stamped CORE_VERSION ${version} into core dist`);
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

/**
 * Invoke npm without constructing a shell command string. We run the npm CLI
 * JS directly with `node <npm_execpath> <args...>`, which is cross-platform and
 * avoids a `cmd.exe /c "<joined string>"` invocation (CodeQL command-injection
 * surface). These scripts are meant to run via `npm run release:*`, where
 * `npm_execpath` is always set; fail clearly otherwise instead of falling back
 * to a stringified shell command.
 */
function npm(args, extraEnv = {}) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error(
      'npm_execpath is not set — run this via `npm run release:build` / ' +
        '`npm run release:validate` so the bundled npm CLI is used.',
    );
  }
  return run(process.execPath, [npmCli, ...args], extraEnv);
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
 * Locate the bundled Node runtime's LICENSE text. Official Node builds ship a
 * LICENSE file next to (Windows) or one level above (POSIX) the `node` binary.
 * Returns its contents, or throws — the artifact bundles the Node binary, so we
 * must redistribute its license text and never rely on a URL alone.
 */
function readNodeLicense() {
  const binDir = dirname(process.execPath);
  const candidates = [
    join(binDir, '..', 'LICENSE'),
    join(binDir, 'LICENSE'),
    join(binDir, '..', 'share', 'doc', 'node', 'LICENSE'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const text = readFileSync(candidate, 'utf8');
      if (text.includes('Node.js is licensed')) return text;
    }
  }
  throw new Error(
    `could not find the Node runtime LICENSE near ${process.execPath}; ` +
      'refusing to ship the bundled Node binary without its license text.',
  );
}

/**
 * Build the THIRD-PARTY / attribution NOTICE from the live rules-pack manifest
 * so the required CC-BY 4.0 SRD attribution can never drift from the data that
 * actually ships.
 */
function buildNotice(edition, providers) {
  const manifestPath = join(
    root,
    'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json',
  );
  const manifest = readJson(manifestPath);
  const srd = manifest.license?.attributionText ?? '';
  // Only list provider SDKs this edition actually bundles, so the NOTICE never
  // claims an attribution for a package pruned out of the archive (ADR 0011).
  const providerLines = providers.map(
    (name) => `- ${name}: see its bundled LICENSE under app/.`,
  );
  return `${[
    'Eshyra — Third-Party Notices',
    '',
    `Edition: ${edition}.`,
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
    '- Node.js runtime (runtime/): full license text bundled at',
    '  THIRD-PARTY/node-LICENSE.txt.',
    '- better-sqlite3 (native SQLite binding): MIT License.',
    ...providerLines,
    '',
    'Full dependency license texts ship alongside each package under app/.',
  ].join('\n')}\n`;
}

function buildReadme(version, target, edition) {
  const ext = target.isWindows ? 'zip' : 'tar.gz';
  return `${[
    `Eshyra CLI — core v${version} (${edition} edition, ${target.os}-${target.arch})`,
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

/**
 * Render the POSIX `eshyra` launcher.
 *
 * It execs the bundled node by absolute path (works with an empty PATH) and
 * prepends runtime/ to PATH so the Agent SDK's `node` subprocess also resolves
 * to the bundled runtime rather than any system Node.
 *
 * Portability (eshyra-4s0r.3): release artifacts target both Linux (GNU
 * userland) and macOS (BSD userland), so the script must run identically under
 * dash, bash-as-sh, and macOS's /bin/sh. We therefore avoid GNU-only argument
 * forms — `dirname --` and `readlink --` are NOT portable to BSD `dirname`/
 * `readlink`, which historically reject the `--` end-of-options operand. The
 * symlink walk uses bare `readlink` (universally available, no flags) and
 * computes the parent directory with POSIX parameter expansion instead of the
 * external `dirname`. `cd --` is kept: `cd` is a POSIX shell built-in whose
 * `--` is guaranteed, and it lets install paths that start with `-` still work.
 */
function renderPosixLauncher(entryRel) {
  return `#!/bin/sh
set -e
# Resolve symlinks before computing our own location: the installer puts a
# symlink on PATH (e.g. ~/.local/bin/eshyra -> .../app/<artifact>/bin/eshyra),
# and "$0" is then the symlink path. Walk the symlink chain so runtime/ and the
# app entry resolve relative to the REAL launcher, not the symlink's directory.
#
# Portable across GNU and BSD/macOS userland: bare \`readlink\` (no \`--\`) plus
# parameter-expansion \`dirname\` (no external \`dirname --\`). A symlink target
# may be relative to the symlink's OWN directory, so resolve it against that.
dirname_of() {
    case $1 in
        */*)
            d=\${1%/*}
            # A single leading slash strips to empty; that means filesystem root.
            [ -z "$d" ] && d=/
            printf '%s\\n' "$d"
            ;;
        *) printf '%s\\n' "." ;;
    esac
}
src=$0
while [ -L "$src" ]; do
    target=$(readlink "$src")
    case $target in
        /*) src=$target ;;
        *) src=$(dirname_of "$src")/$target ;;
    esac
done
here=$(CDPATH= cd -- "$(dirname_of "$src")" && pwd)
root=$(CDPATH= cd -- "$here/.." && pwd)
PATH="$root/runtime:$PATH"
export PATH
exec "$root/runtime/node" "$root/${entryRel}" "$@"
`;
}

/** Render the Windows `eshyra.cmd` launcher (CRLF line endings). */
function renderWindowsLauncher(entryRel) {
  return `@echo off\r
setlocal\r
set "HERE=%~dp0"\r
set "ROOT=%HERE%.."\r
set "PATH=%ROOT%\\runtime;%PATH%"\r
"%ROOT%\\runtime\\node.exe" "%ROOT%\\${entryRel.replaceAll('/', '\\')}" %*\r
`;
}

function writeLaunchers(stageDir, entryRel) {
  const binDir = join(stageDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'eshyra'), renderPosixLauncher(entryRel), {
    mode: 0o755,
  });
  writeFileSync(join(binDir, 'eshyra.cmd'), renderWindowsLauncher(entryRel));
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
  const version = resolveVersion(opts.version);
  const edition = resolveEdition(opts.edition);
  // Edition is encoded in the artifact name so all four editions can coexist on
  // one Release and the installer can select by name: eshyra-<edition>-<ver>-…
  const baseName = `eshyra-${edition}-${version}-${target.os}-${target.arch}`;

  const scratch = mkdtempSync(join(tmpdir(), 'eshyra-release-'));
  const packDir = join(scratch, 'packs');
  const appPrefix = join(scratch, 'app');
  const stageDir = join(scratch, baseName);
  const cache = join(scratch, 'npm-cache');
  for (const d of [packDir, appPrefix, stageDir, cache]) {
    mkdirSync(d, { recursive: true });
  }

  try {
    // Release packaging must never trust incremental tsbuildinfo. A stale build
    // graph can report success while leaving old files under dist/, causing the
    // archive to ship behavior that no longer matches source. `typecheck` uses
    // `tsc --build --force` and deterministically refreshes every workspace
    // output before npm pack reads it.
    console.log('• building workspace (tsc --build --force)…');
    npm(['run', 'typecheck']);

    // Stamp the resolved version into the built core dist BEFORE packing, so the
    // packed @eshyra/core tarball (and thus the bundled CLI banner) carries it.
    stampCoreVersion(version);

    console.log('• packing @eshyra/core and @eshyra/cli…');
    const coreTar = packWorkspace('@eshyra/core', packDir, cache);
    const cliTar = packWorkspace('@eshyra/cli', packDir, cache);

    console.log(
      '• installing production app tree (no devDeps, native from source)…',
    );
    // Production-only global install into a private prefix. --omit=dev keeps
    // tsx/pdfkit/pdfjs out. This is a --global install outside the repo root,
    // so it does not inherit the root .npmrc; build_from_source=true is
    // passed explicitly here to compile better-sqlite3 from source on this
    // exact runner/ABI rather than downloading a prebuild-install prebuilt
    // binary (ADR 0016). This reuses the exact mechanism the install-smoke
    // job already validates.
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
      { npm_config_build_from_source: 'true' },
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

    // Edition prune: drop the agent-SDK provider packages this edition excludes
    // from the staged module tree (ADR 0011). The api edition removes both heavy
    // agent SDKs; claude/codex keep exactly one; full keeps both. Packages not
    // declared in the dependency graph yet (e.g. @openai/codex-sdk before the
    // adapter stream adds it) are skipped — the edition simply ships without it.
    const { removed: pruned, prunedBins } = pruneAgentSdks(stageDir, edition);
    console.log(
      `• edition "${edition}": ${
        pruned.length
          ? `pruned ${pruned.join(', ')}`
          : 'no provider packages pruned'
      }${prunedBins.length ? ` (+ .bin shims: ${prunedBins.join(', ')})` : ''}`,
    );

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
    writeFileSync(
      join(stageDir, 'NOTICE'),
      buildNotice(edition, editionPackages(edition)),
    );
    writeFileSync(
      join(stageDir, 'README.txt'),
      buildReadme(version, target, edition),
    );

    // THIRD-PARTY/: redistribute the bundled Node runtime's own license text
    // (the binary under runtime/ is not an npm package, so its license does not
    // otherwise travel with the artifact).
    const thirdPartyDir = join(stageDir, 'THIRD-PARTY');
    mkdirSync(thirdPartyDir, { recursive: true });
    writeFileSync(join(thirdPartyDir, 'node-LICENSE.txt'), readNodeLicense());

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
      edition,
      providers: editionPackages(edition),
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

export {
  normalizeVersion,
  removeBinShimsFor,
  renderPosixLauncher,
  renderWindowsLauncher,
  resolveEdition,
  resolveVersion,
  VERSION_SENTINEL,
};

// Run only when invoked directly (not when imported by a test).
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
