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

/** Holds `mb` megabytes resident, then exits. */
function holdMemoryScript(mb: number, children: number): string {
  return `
import { fork } from 'node:child_process';
if (process.argv[2] === 'child') {
  const buf = Buffer.alloc(${mb} * 1024 * 1024, 1);
  setTimeout(() => { if (buf[0] !== 1) throw new Error('unreachable'); }, 2000);
} else {
  for (let i = 0; i < ${children}; i += 1) {
    fork(new URL(import.meta.url).pathname, ['child']);
  }
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
  // The load-bearing test. Four concurrent processes each holding ~200 MB must
  // report ~800 MB, NOT ~200 MB. A largest-child metric — the failure mode this
  // tool exists to avoid — reports the latter and would pass no assertion here.
  it.skipIf(restrictedSandbox || isWindows)(
    'reports aggregate process-tree memory, not the largest single process',
    () => {
      const { record } = runMeasured(holdMemoryScript(200, 4));

      expect(record.exitCode).toBe(0);
      const peak = record.peakTreeRssMb as number;

      // Well above any single child (~200 MB), so a largest-child metric fails.
      expect(peak).toBeGreaterThan(600);
      // And bounded, so a runaway sampler that double-counts also fails.
      expect(peak).toBeLessThan(1600);
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
