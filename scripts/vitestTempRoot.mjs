// Gives one Vitest run (`npm run test`, `vitest run`, or interactive `vitest`)
// a single per-run temp root under the real `os.tmpdir()`, and repoints
// TMPDIR/TMP/TEMP at it before anything else in the process resolves a temp
// directory. Wired into the top of `vitest.config.ts` (bead eshyra-knh9 /
// eshyra-knh9.1 — tests and scripts were leaking thousands of temp dirs under
// TMPDIR because nothing ever swept them).
//
// WHY THIS RUNS AT CONFIG MODULE-EVALUATION TIME, NOT IN A `globalSetup` HOOK:
//
// Vitest computes its own internal SSR module-transform cache directories
// (`TestProject.tmpDir` / `Vitest._tmpDir`, both `join(tmpdir(), nanoid())`,
// ~49 MB each under this repo's suite) as class-field initializers when the
// `Vitest` / `TestProject` objects are constructed — which happens before ANY
// `globalSetup` file can run. A `globalSetup` hook only gets to redirect
// `process.env.TMPDIR` for worker processes (their env is built later, when
// tests actually execute, by spreading `process.env` again at that point) —
// it cannot retroactively change paths the orchestrator process already
// computed.
//
// Measured empirically against vitest 5.0.1 / vite 8.3.0 (recorded in the
// bead notes): reassigning `process.env.TMPDIR` at `vitest.config.ts` MODULE
// EVALUATION time — before `defineConfig()` is even called — lands inside
// every one of: the project's SSR nanoid cache, worker-spawned test temp
// dirs (`lw-*`, `measure-run-*`, ...), and even npm's own
// `node-compile-cache` (npm's CLI calls `module.enableCompileCache()` on its
// own startup, before vitest.config.ts loads, but that call only resolves its
// cache directory lazily at first write, so it still observes this
// reassignment).
//
// CLEANUP: registers a synchronous `process.on('exit', ...)` handler. Node
// still invokes `'exit'` listeners for a plain `process.exit()` call — unlike
// a `finally` block further up the call stack, which `process.exit()`
// bypasses entirely (see the `verify-dnd5e-srd-pack` root-cause fix in the
// same bead: every one of its `process.exit()` calls skipped its own
// `finally { rmSync(tmpDir, ...) }`). That covers every graceful exit. It
// cannot cover SIGKILL / OOM-kill / power loss, so `reapStaleTempRoots` is the
// actual backstop: every run's setup also removes any earlier
// `eshyra-vitest-*` root whose recorded owner PID is no longer alive. A root
// whose owner PID is still alive is left untouched, which is what makes this
// safe when another agent is running the suite concurrently on the same host.

import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEMP_ROOT_PREFIX = 'eshyra-vitest-';
const OWNER_PID_FILE = 'owner.pid';

/** Real liveness probe: POSIX signal 0 checks existence without signalling. */
function defaultIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: definitely gone -> reap. Anything else (EPERM: exists but not
    // ours to signal; or an unexpected error) -> assume alive and leave it,
    // since wrongly reaping a live concurrent run's root is the worse
    // failure mode.
    return err?.code !== 'ESRCH';
  }
}

/**
 * Remove every `eshyra-vitest-*` root directly under `baseDir` whose
 * `owner.pid` marker names a PID that `isAlive` reports as dead. A root with
 * no readable marker yet (a concurrent run still between `mkdtemp` and
 * writing the marker) is left alone rather than guessed at.
 */
export function reapStaleTempRoots(baseDir, isAlive = defaultIsAlive) {
  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_ROOT_PREFIX)) {
      continue;
    }
    const candidate = join(baseDir, entry.name);
    let pid;
    try {
      pid = Number.parseInt(
        readFileSync(join(candidate, OWNER_PID_FILE), 'utf8').trim(),
        10,
      );
    } catch {
      continue;
    }
    if (isAlive(pid)) continue;
    try {
      rmSync(candidate, { recursive: true, force: true });
    } catch {
      // Best-effort: leave it for a future run to retry.
    }
  }
}

/**
 * Create this run's temp root, reap dead roots left by earlier runs, redirect
 * TMPDIR/TMP/TEMP at the new root, and (by default) register exit-time
 * cleanup. Every parameter is injectable so this is testable without
 * mutating the real process environment or real `os.tmpdir()`.
 *
 * @param {object} [options]
 * @param {string} [options.baseDir] Directory the root is created under.
 *   Defaults to the real `os.tmpdir()`.
 * @param {NodeJS.ProcessEnv} [options.env] Environment object to mutate.
 *   Defaults to `process.env`.
 * @param {number} [options.pid] PID recorded as this root's owner. Defaults
 *   to `process.pid`.
 * @param {(pid: number) => boolean} [options.isAlive] Liveness probe used by
 *   the reaper. Defaults to a real `process.kill(pid, 0)` check.
 * @param {boolean} [options.registerExitHandler] Whether to register a real
 *   `process.on('exit', ...)` cleanup handler. Defaults to `true`.
 * @returns {{ root: string, cleanup: () => void }}
 */
export function installPerRunTempRoot(options = {}) {
  const baseDir = options.baseDir ?? tmpdir();
  const env = options.env ?? process.env;
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? defaultIsAlive;
  const registerExitHandler = options.registerExitHandler ?? true;

  reapStaleTempRoots(baseDir, isAlive);

  const root = mkdtempSync(join(baseDir, TEMP_ROOT_PREFIX));
  writeFileSync(join(root, OWNER_PID_FILE), String(pid));

  env.TMPDIR = root;
  env.TMP = root;
  env.TEMP = root;

  const cleanup = () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best-effort; the next run's reaper retries once this PID is dead.
    }
  };

  if (registerExitHandler) {
    process.on('exit', cleanup);
  }

  return { root, cleanup };
}
