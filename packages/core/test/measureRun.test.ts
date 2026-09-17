import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `scripts/measure-run.mjs` exists because `/usr/bin/time -v` measures the
// WRONG property for this repository's verification cost: its "Maximum resident
// set size" is getrusage(RUSAGE_CHILDREN) ru_maxrss — the peak RSS of the
// single largest child, never the sum across concurrently live children. The
// audit's causal claim about the OOM is about AGGREGATE concurrent memory, so a
// largest-child metric would report reassuring numbers in exactly the failing
// scenario.
//
// This file is the standing evidence that the replacement actually measures the
// aggregate. It is deliberately one behavioural test plus two contract tests:
// the tool gates one decision (the worker cap), so its proof burden is sized to
// that decision, not to the product's.

const restrictedSandbox = process.env.ESHYRA_TEST_SANDBOX === '1';
const isWindows = process.platform === 'win32';

// Resolved from this file, not process.cwd(): under Vitest the cwd is the repo
// root, but that is a property of the runner, not of this test.
const MEASURE_RUN = fileURLToPath(
  new URL('../../../scripts/measure-run.mjs', import.meta.url),
);

/**
 * Workload exercising the two lifecycle shapes the sampler must survive.
 *
 * `attached` children are ordinary forks. `detached` children lead their own
 * process group and session, so they escape any sampler summing one group.
 * When `orphan` is set, one detached child is launched by an intermediary that
 * EXITS while the run continues, re-parenting it away from the measured root —
 * and it allocates only afterwards, so a sampler that rebuilds membership from
 * each snapshot never attributes that memory to the run.
 *
 * Both shapes were live defects, not hypotheticals: the first escaped a
 * group-only sampler, the second escaped its snapshot-local replacement.
 */
function holdMemoryScript(
  mb: number,
  attached: number,
  detached: number,
  orphanMb = 0,
): string {
  return `
import { fork, spawn } from 'node:child_process';
const self = new URL(import.meta.url).pathname;
const hold = (megabytes, delay) => setTimeout(() => {
  const buf = Buffer.alloc(megabytes * 1024 * 1024, 1);
  setTimeout(() => { if (buf[0] !== 1) throw new Error('unreachable'); }, 2500);
}, delay);

if (process.argv[2] === 'child') {
  hold(${mb}, 0);
} else if (process.argv[2] === 'late') {
  // Allocates only AFTER the intermediary that launched it has exited, so its
  // memory is attributable solely through durable ownership.
  hold(${orphanMb}, 1500);
} else if (process.argv[2] === 'mid') {
  const c = spawn(process.execPath, [self, 'late'], {
    detached: true,
    stdio: 'ignore',
  });
  c.unref();
  setTimeout(() => process.exit(0), 700);
} else {
  for (let i = 0; i < ${attached}; i += 1) fork(self, ['child']);
  for (let i = 0; i < ${detached}; i += 1) {
    const c = spawn(process.execPath, [self, 'child'], {
      detached: true,
      stdio: 'ignore',
    });
    c.unref();
  }
  ${orphanMb > 0 ? "fork(self, ['mid']);" : ''}
  setTimeout(() => {}, 5000);
}
`;
}

function runMeasured(scriptBody: string): {
  stdout: string;
  record: Record<string, unknown>;
} {
  const dir = mkdtempSync(join(tmpdir(), 'measure-run-'));
  const script = join(dir, 'workload.mjs');
  const out = join(dir, 'record.jsonl');
  writeFileSync(script, scriptBody);
  const stdout = execFileSync(
    process.execPath,
    [
      MEASURE_RUN,
      '--label',
      'probe',
      '--out',
      out,
      '--',
      process.execPath,
      script,
    ],
    { encoding: 'utf8' },
  );
  const record = JSON.parse(readFileSync(out, 'utf8').trim());
  return { stdout, record };
}

describe('measure-run', () => {
  // The load-bearing test, distinguishing BOTH known bad states at once:
  //
  //   two attached + two detached children, ~150 MB each (~600 MB total)
  //     a largest-child metric (/usr/bin/time -v)  => ~150 MB   FAILS
  //     a process-group-only sampler               => ~350 MB   FAILS
  //     a descendant-tree sampler                  => ~650 MB   passes
  //
  // Sized to the smallest footprint that still separates the three cases
  // cleanly: this probe runs inside a memory-constrained gate, and AGENTS.md
  // "Permanent Test Evidence" makes a proof mechanism's own cost part of its
  // proportionality.
  //
  // The detached half is what the group-only sampler cannot see, so this single
  // test covers the escape without a second reproducer.
  it.skipIf(restrictedSandbox || isWindows)(
    'reports whole-tree memory, including detached and orphaned descendants',
    () => {
      // Three small children (~60 MB each) plus one detached-then-orphaned
      // child holding ~400 MB, whose allocation overlaps the others. The small
      // children are sized NOT to reach the threshold on their own, so the
      // orphan decides the assertion and each weaker sampler fails on its own
      // merits (measured, not estimated):
      //
      //   largest-child metric (/usr/bin/time -v)  ~400 MB   FAILS
      //   process-group-only sampler                ~48 MB   FAILS
      //   snapshot-local descendant sampler        ~400 MB   FAILS (loses orphan)
      //   durable-ownership sampler                ~820 MB   passes
      const { record } = runMeasured(holdMemoryScript(60, 2, 1, 400));

      expect(record.exitCode).toBe(0);
      const peak = record.peakTreeRssMb as number;

      expect(peak).toBeGreaterThan(600);
      // And bounded, so a runaway sampler that double-counts also fails.
      expect(peak).toBeLessThan(1400);
      expect(record.peakProcesses as number).toBeGreaterThanOrEqual(4);
    },
    30000,
  );

  // The record must say what it covers. An unqualified number invites being
  // read as a guarantee the mechanism cannot make — see KNOWN LIMIT in
  // scripts/measure-run.mjs.
  it.skipIf(restrictedSandbox || isWindows)(
    'states the boundary of what it measured',
    () => {
      const { record } = runMeasured(holdMemoryScript(20, 1, 0));

      expect(record.boundary).toBe('process-tree-sampling');
      expect(String(record.unmeasured)).toContain('orphaned');
    },
    30000,
  );

  it.skipIf(restrictedSandbox || isWindows)(
    'propagates the measured command exit code',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'measure-run-'));
      const script = join(dir, 'fail.mjs');
      writeFileSync(script, 'process.exit(3);\n');

      let status: number | undefined;
      try {
        execFileSync(
          process.execPath,
          [MEASURE_RUN, '--', process.execPath, script],
          { encoding: 'utf8', stdio: 'pipe' },
        );
      } catch (error) {
        status = (error as { status?: number }).status;
      }

      // A measurement wrapper that swallowed a non-zero exit would silently
      // turn a red gate green.
      expect(status).toBe(3);
    },
    30000,
  );

  // Distinguishes "the root died" from "the owned workload died". Signalling
  // only the immediate child leaves grandchildren running: POSIX delivers a
  // signal to its target alone, and a parent's death does not kill its
  // children. Before the repair, a grandchild kept writing after the wrapper
  // took SIGTERM.
  it.skipIf(restrictedSandbox || isWindows)(
    'terminates the whole owned workload on interruption, not just its root',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'measure-run-'));
      const script = join(dir, 'heartbeat.mjs');
      const beat = join(dir, 'beat.txt');
      writeFileSync(
        script,
        `
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const self = new URL(import.meta.url).pathname;
if (process.argv[2] === 'grandchild') {
  setInterval(() => appendFileSync(${JSON.stringify(beat)}, 'x'), 100);
  setTimeout(() => process.exit(0), 20000);
} else {
  spawn(process.execPath, [self, 'grandchild'], { stdio: 'ignore' });
  setTimeout(() => {}, 20000);
}
`,
      );
      writeFileSync(beat, '');

      const wrapper = spawn(
        process.execPath,
        [MEASURE_RUN, '--', process.execPath, script],
        { stdio: 'ignore' },
      );
      const wait = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      await wait(1500);
      expect(statSync(beat).size).toBeGreaterThan(0);

      wrapper.kill('SIGTERM');
      await wait(1500);
      const afterSignal = statSync(beat).size;
      await wait(1000);

      // The grandchild is silent because it was terminated, not because the
      // root exited: the root's death alone would leave it beating.
      expect(statSync(beat).size).toBe(afterSignal);
    },
    30000,
  );

  it('rejects an invocation with no command to measure', () => {
    expect(() =>
      execFileSync(process.execPath, [MEASURE_RUN, '--label', 'x'], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow();
  });
});
