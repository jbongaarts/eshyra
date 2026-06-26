import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  renderPosixLauncher,
  renderWindowsLauncher,
} from '../../../scripts/release/build-release-artifact.mjs';

/**
 * Generated release-launcher coverage (eshyra-4s0r.3).
 *
 * Release artifacts target both Linux (GNU userland) and macOS (BSD userland),
 * so the generated POSIX `eshyra` launcher must run identically under dash,
 * bash-as-sh, and macOS's /bin/sh. These tests pin the portability properties of
 * the rendered script and prove its symlink-resolution behavior end-to-end under
 * the host shell. The release workflow's `installer-smoke` job additionally runs
 * the real install path on a macOS runner; this test is the fast, local guard.
 */

const ENTRY_REL = 'lib/node_modules/@eshyra/cli/dist/index.js';

describe('generated POSIX launcher portability', () => {
  const sh = renderPosixLauncher(ENTRY_REL);
  // Executable lines only — drop `#` comments (which intentionally NAME the
  // GNU-isms being avoided) and the shebang, so the checks below see real code.
  const code = sh
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('is a /bin/sh script that execs the bundled node + entry', () => {
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true);
    expect(sh).toContain(`exec "$root/runtime/node" "$root/${ENTRY_REL}" "$@"`);
    // Prepends the bundled runtime so the SDK's `node` subprocess resolves to it.
    expect(sh).toContain('PATH="$root/runtime:$PATH"');
  });

  it('resolves the launcher symlink chain before locating runtime/', () => {
    expect(sh).toContain('while [ -L "$src" ]; do');
    expect(sh).toContain('readlink "$src"');
  });

  it('avoids GNU-only argument forms unsupported by BSD/macOS userland', () => {
    // BSD `dirname` / `readlink` historically reject the `--` end-of-options
    // operand; using it makes the launcher fail on macOS. The fix uses bare
    // `readlink` plus a parameter-expansion `dirname`, so neither GNU-ism
    // should appear in the executable code.
    expect(code).not.toMatch(/\breadlink\s+--/);
    expect(code).not.toMatch(/\bdirname\s+--/);
    // No external `dirname` call at all (the `dirname_of` shell helper, whose
    // name merely contains the substring, replaces it). A real call would be
    // `dirname ` followed by an argument, never `dirname_of`.
    expect(code).not.toMatch(/\bdirname\s+["$]/);
  });

  it('keeps `--` only on `cd`, a POSIX built-in that guarantees it', () => {
    // `cd --` is safe everywhere and lets install prefixes starting with `-`
    // still work; it is the only place `--` is allowed to remain.
    for (const line of code.split('\n')) {
      if (line.includes(' -- ')) {
        expect(line).toMatch(/\bcd\s+--\s/);
      }
    }
  });
});

describe('generated Windows launcher', () => {
  const cmd = renderWindowsLauncher(ENTRY_REL);

  it('uses CRLF line endings and execs node.exe with the backslashed entry', () => {
    expect(cmd.startsWith('@echo off\r\n')).toBe(true);
    expect(cmd).toContain(
      '"%ROOT%\\runtime\\node.exe" "%ROOT%\\lib\\node_modules\\@eshyra\\cli\\dist\\index.js" %*',
    );
  });
});

// Functional proof: drive the rendered launcher through a 2-hop symlink chain
// (one absolute target, one relative) under the host's /bin/sh and assert it
// resolves back to the real app root. POSIX-only; the cmd launcher is covered by
// the static assertions above.
describe('generated POSIX launcher behavior under /bin/sh', () => {
  let base: string | undefined;

  afterEach(() => {
    if (base) {
      rmSync(base, { recursive: true, force: true });
      base = undefined;
    }
  });

  it.skipIf(process.platform === 'win32')(
    'follows the install symlink chain to the real runtime and entry',
    () => {
      base = mkdtempSync(join(tmpdir(), 'eshyra-launcher-'));
      const app = join(base, 'app', 'eshyra-full-1.0.0-linux-x64');
      mkdirSync(join(app, 'bin'), { recursive: true });
      mkdirSync(join(app, 'runtime'), { recursive: true });
      const entryAbs = join(app, ENTRY_REL);
      mkdirSync(join(entryAbs, '..'), { recursive: true });
      writeFileSync(entryAbs, '// entry\n');
      writeFileSync(
        join(app, 'bin', 'eshyra'),
        renderPosixLauncher(ENTRY_REL),
        {
          mode: 0o755,
        },
      );
      // Stand-in for the bundled node: echo the entry + args, and the head of
      // PATH so we can assert runtime/ was prepended.
      const fakeNode = join(app, 'runtime', 'node');
      writeFileSync(
        fakeNode,
        '#!/bin/sh\necho "ENTRY=$1"\necho "ARG2=$2"\necho "PATH_FULL=$PATH"\n',
        { mode: 0o755 },
      );
      chmodSync(fakeNode, 0o755);

      // ~/.local/bin/eshyra (relative symlink) -> staging/eshyra (absolute) ->
      // the real app/bin/eshyra, mirroring an installer-created PATH entry.
      const staging = join(base, 'staging');
      const localBin = join(base, 'home', '.local', 'bin');
      mkdirSync(staging, { recursive: true });
      mkdirSync(localBin, { recursive: true });
      symlinkSync(join(app, 'bin', 'eshyra'), join(staging, 'eshyra'));
      symlinkSync(
        join('..', '..', '..', 'staging', 'eshyra'),
        join(localBin, 'eshyra'),
      );

      const run = spawnSync('sh', [join(localBin, 'eshyra'), 'hello'], {
        encoding: 'utf8',
      });

      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain(`ENTRY=${entryAbs}`);
      expect(run.stdout).toContain('ARG2=hello');
      // runtime/ is prepended to PATH (so it sits at the very front, before `:`).
      expect(run.stdout).toContain(`PATH_FULL=${join(app, 'runtime')}:`);
    },
  );
});
