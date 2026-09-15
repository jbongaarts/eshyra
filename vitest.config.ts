import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

/**
 * Worker cap (bead eshyra-9l5s.2).
 *
 * Vitest defaults `maxWorkers` to `os.availableParallelism()`. On the primary
 * agent host that is 20, against 7.8 GB RAM whose swap is ~91% consumed at
 * idle — so the default projects to well past the memory envelope and has
 * produced OOM kills of the supervising agent.
 *
 * Measured on that host after the F1 repair (peak AGGREGATE process-tree RSS,
 * via `node scripts/measure-run.mjs`):
 *
 *   workers │ wall   │ peak tree RSS
 *   ────────┼────────┼───────────────
 *      2    │ 84.8 s │ 1,362 MB
 *      4    │ 49.5 s │ 1,977 MB
 *      6    │ 42.2 s │ 2,506 MB
 *      8    │ 38.1 s │ 3,206 MB
 *
 * Past 6 the trade turns bad: 6→8 buys 4.1 s for 700 MB. 6 is the knee, so
 * that is the local cap. CI runners are smaller and run nothing alongside the
 * suite, so they take the cheaper 4.
 *
 * These are ABSOLUTE caps, not percentages, so a 20-CPU agent host and a
 * 4-CPU CI runner both land inside a measured envelope. `Math.min` lets a
 * smaller host scale down rather than oversubscribing its CPUs.
 *
 * This caps how the suite EXECUTES. It excludes no test: the authoritative
 * gate still runs the full union. See
 * docs/audits/test-suite-and-verification/2026-09-14-test-suite-and-verification-audit.md
 */
const MAX_WORKERS = process.env.CI ? 4 : 6;

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    maxWorkers: Math.min(MAX_WORKERS, availableParallelism()),
  },
});
