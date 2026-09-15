import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Workload holding ~`(attached + detached) * mb` MB across concurrent
 * processes, where `detached` of them are spawned with `detached: true`.
 *
 * The detached share is the point. Node makes such a child the leader of a NEW
 * process group and session, so it escapes any sampler that sums a single
 * process group — which is what an earlier revision of measure-run did. The
 * suite's own verification run contains exactly this shape, so the escape was
 * live, not theoretical.
 */
function holdMemoryScript(
  mb: number,
  attached: number,
  detached: number,
): string {
  return `
import { fork, spawn } from 'node:child_process';
if (process.argv[2] === 'child') {
  const buf = Buffer.alloc(${mb} * 1024 * 1024, 1);
  setTimeout(() => { if (buf[0] !== 1) throw new Error('unreachable'); }, 2500);
} else {
  const self = new URL(import.meta.url).pathname;
  for (let i = 0; i < ${attached}; i += 1) fork(self, ['child']);
  for (let i = 0; i < ${detached}; i += 1) {
    const c = spawn(process.execPath, [self, 'child'], {
      detached: true,
      stdio: 'ignore',
    });
    c.unref();
  }
  setTimeout(() => {}, 3000);
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
    'reports whole-tree memory, including detached descendants',
    () => {
      const { record } = runMeasured(holdMemoryScript(150, 2, 2));

      expect(record.exitCode).toBe(0);
      const peak = record.peakTreeRssMb as number;

      // Above the ~350 MB a group-only sampler would see, and far above the
      // ~150 MB a largest-child metric would report.
      expect(peak).toBeGreaterThan(500);
      // And bounded, so a runaway sampler that double-counts also fails.
      expect(peak).toBeLessThan(1200);
      expect(record.peakProcesses as number).toBeGreaterThanOrEqual(4);
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

  it('rejects an invocation with no command to measure', () => {
    expect(() =>
      execFileSync(process.execPath, [MEASURE_RUN, '--label', 'x'], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow();
  });
});
