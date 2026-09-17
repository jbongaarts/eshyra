import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// Measure wall clock and PEAK AGGREGATE memory for a command and everything it
// spawns, then exit with that command's exit code.
//
// WHY THIS EXISTS, AND WHY IT IS NOT `/usr/bin/time -v`:
//
//   The property that matters for this repository's verification cost is the
//   memory used by the whole process tree AT THE SAME TIME — one Vitest parent
//   plus N concurrently live workers. `/usr/bin/time -v` cannot report that.
//   Its "Maximum resident set size" comes from getrusage(RUSAGE_CHILDREN)
//   ru_maxrss, which is the peak RSS of the SINGLE LARGEST child, never the sum
//   across concurrently live children.
//
//   Measured on the primary agent host: three concurrent children holding
//   ~448 MB each (~1.34 GB aggregate) reported 458,656 KB — one child's worth.
//   Applied to the test suite, `time -v` reports roughly the largest single
//   worker while the tree is several GB, and shows NO difference between worker
//   counts whose aggregate peaks differ by hundreds of MB. It would report
//   reassuring numbers in exactly the scenario that causes an OOM kill.
//
//   See docs/audits/test-suite-and-verification/
//   2026-09-14-test-suite-and-verification-audit.md, section 2 and R7.
//
// HOW IT MEASURES:
//   Membership is DURABLE, not recomputed from scratch each sample. Once a
//   process has been observed as part of the measured workload it stays owned
//   until it exits. Each sample re-admits still-live owned processes, adds
//   anything descended from a member, adds anything sharing a process group
//   with a member (never this wrapper's own group, which the measured command
//   shares), iterates to a fixpoint, and records the result.
//
//   Durability is the load-bearing part, and two earlier revisions got it
//   wrong. Revision 1 summed a single process GROUP, which any nested detached
//   descendant escapes: Node makes such a child the leader of a new group and
//   session. Revision 2 added parent-link closure but rebuilt membership from
//   each snapshot, so it still lost this shape:
//
//     measured root -> short-lived intermediary -> detached memory holder
//
//   Once the intermediary exits, the holder is re-parented to init with no link
//   back to the root, so a snapshot-local sampler never sees it again. Measured
//   against a re-parented detached 400 MB holder, revision 2 reported 47 MB
//   across 1 process on every sample.
//
//   PID reuse is guarded by elapsed time: a recycled PID presents a smaller
//   `etimes` than when it was admitted, and is dropped rather than counted.
//
//   Sampling can miss a spike between samples, so this reports a LOWER BOUND on
//   the true peak — it can under-report, never over-report.
//
// KNOWN LIMIT (stated, not silently tolerated):
//   A descendant that BOTH detaches AND is orphaned before its first
//   observation is unreachable by any /proc walk: it has no link back to the
//   root and shares no group with a known member. Concretely
//
//     root -> intermediary that exits immediately -> detached holder
//
//   is counted at 0. Closing that needs kernel-level containment — a cgroup
//   the workload is confined to, or PR_SET_CHILD_SUBREAPER so orphans re-parent
//   to this wrapper. Neither is available to an unprivileged process here:
//   creating a sub-cgroup with the memory controller requires writing the
//   parent's `cgroup.subtree_control`, which is denied, and Node exposes no
//   prctl. The measured workload (`npm run test` -> vitest -> workers) contains
//   no such double-fork, so the gap is currently unreached — but "unreached
//   today" is not "closed", so every record carries `boundary` naming what was
//   measured and `unmeasured` naming this gap. A future workload that does
//   double-fork needs the containment approach, not a bigger ps walk.
//
// PROCESS LIFETIME:
//   The command is deliberately NOT detached: it stays in this process's group
//   so terminal signals reach it. On SIGINT/SIGTERM/SIGHUP the wrapper signals
//   THE WHOLE OWNED WORKLOAD, not just the immediate child, because POSIX does
//   not propagate a signal to descendants and a parent's death does not kill
//   its children.
//
// PORTABILITY:
//   Memory sampling needs POSIX `ps`. Where that is unavailable (Windows, or a
//   sandbox that denies it) the run still executes and wall clock is still
//   reported; memory is reported as null rather than as a wrong number. This
//   must never fail the gate it is wrapping.

// 250 ms rather than 500: the shorter the gap before the first sample, the
// smaller the window in which a descendant can be orphaned before it is ever
// observed (see KNOWN LIMIT).
const SAMPLE_INTERVAL_MS = 250;

function parseArgs(argv) {
  const separator = argv.indexOf('--');
  if (separator === -1 || separator === argv.length - 1) {
    throw new Error(
      'Usage: node scripts/measure-run.mjs [--label NAME] [--out FILE] -- <command> [args...]',
    );
  }
  const options = { label: 'run', out: undefined };
  let index = 0;
  while (index < separator) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== '--label' && flag !== '--out') {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (value === undefined || index + 1 >= separator) {
      throw new Error(`Option ${flag} requires a value`);
    }
    if (flag === '--label') options.label = value;
    else options.out = value;
    index += 2;
  }
  return { options, command: argv.slice(separator + 1) };
}

/**
 * Durable ownership of the measured workload: pid -> elapsed seconds at the
 * moment the process was admitted. This map SURVIVES BETWEEN SAMPLES so a
 * descendant re-parented away from us is not forgotten. See HOW IT MEASURES.
 */
const owned = new Map();

/**
 * This process's own group, which the measured command shares because it is
 * not detached. Never a membership signal on its own — admitting it would
 * sweep in the shell and everything beside us.
 */
const ownGroup = Number(process.pid);

function readProcessTable() {
  const result = spawnSync(
    'ps',
    ['-e', '-o', 'pid=,ppid=,pgid=,rss=,etimes='],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || typeof result.stdout !== 'string') return null;
  const rows = [];
  for (const line of result.stdout.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5) continue;
    const row = {
      pid: Number(fields[0]),
      ppid: Number(fields[1]),
      pgid: Number(fields[2]),
      rssKb: Number(fields[3]) || 0,
      etimes: Number(fields[4]) || 0,
    };
    if (Number.isNaN(row.pid)) continue;
    rows.push(row);
  }
  return rows;
}

/**
 * Aggregate RSS (KB) and process count for the measured command's whole
 * workload, or null where POSIX `ps` is unavailable.
 */
function sampleProcessTree(rootPid) {
  const rows = readProcessTable();
  if (rows === null) return null;

  const byPid = new Map(rows.map((row) => [row.pid, row]));

  // Re-admit still-live owned processes first. A PID whose elapsed time has
  // gone BACKWARDS is a different process reusing the number, so drop it
  // rather than counting a stranger's memory.
  const members = new Set([rootPid]);
  for (const [pid, admittedEtimes] of [...owned]) {
    const row = byPid.get(pid);
    if (row === undefined || row.etimes < admittedEtimes) {
      owned.delete(pid);
      continue;
    }
    members.add(pid);
  }

  const groups = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (members.has(row.pid)) {
        // A member leading its own group (detached/setsid) contributes that
        // group, so its children are admitted even before their links are seen.
        if (
          row.pid === row.pgid &&
          row.pgid !== ownGroup &&
          !groups.has(row.pgid)
        ) {
          groups.add(row.pgid);
          changed = true;
        }
        continue;
      }
      if (members.has(row.ppid) || groups.has(row.pgid)) {
        members.add(row.pid);
        changed = true;
      }
    }
  }

  let rssKb = 0;
  let processes = 0;
  for (const pid of members) {
    const row = byPid.get(pid);
    if (row === undefined) continue;
    if (!owned.has(pid)) owned.set(pid, row.etimes);
    rssKb += row.rssKb;
    processes += 1;
  }
  return { rssKb, processes };
}

/**
 * Signal the whole owned workload, not just its root. POSIX does not propagate
 * a signal to descendants and a parent's death does not kill its children, so
 * signalling only the root strands grandchildren.
 */
function signalOwnedWorkload(rootPid, signalName) {
  sampleProcessTree(rootPid);
  for (const pid of owned.keys()) {
    if (pid === rootPid || pid === ownGroup) continue;
    try {
      process.kill(pid, signalName);
    } catch {
      // Already gone.
    }
  }
}

function megabytes(kb) {
  return Math.round(kb / 1024);
}

const { options, command } = parseArgs(process.argv.slice(2));

const startedAt = Date.now();
// Not detached: see PROCESS LIFETIME above.
const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });

let peakRssKb = 0;
let peakProcesses = 0;
let samples = 0;
let memoryAvailable = true;

const timer = setInterval(() => {
  const sample = sampleProcessTree(child.pid);
  if (sample === null) {
    memoryAvailable = false;
    clearInterval(timer);
    return;
  }
  samples += 1;
  if (sample.rssKb > peakRssKb) peakRssKb = sample.rssKb;
  if (sample.processes > peakProcesses) peakProcesses = sample.processes;
}, SAMPLE_INTERVAL_MS);
timer.unref();

// Forward interruption to the WHOLE owned workload so an abandoned measurement
// cannot strand a running suite. The child shares this process group, so a
// terminal Ctrl+C already reaches it; this covers programmatic callers
// (verify:worktree spawns this wrapper directly) where no terminal signal is
// delivered, and covers descendants in either case.
//
// Signalling only `child` is not enough: POSIX delivers a signal to the target
// alone, and a parent's death does not kill its children, so a grandchild
// outlives both. Measured before this repair, a grandchild kept running after
// the wrapper took SIGTERM.
let forwardedSignal;
for (const signalName of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signalName, () => {
    forwardedSignal = signalName;
    signalOwnedWorkload(child.pid, signalName);
    try {
      child.kill(signalName);
    } catch {
      // Child already gone; nothing to forward to.
    }
  });
}

child.on('error', (error) => {
  clearInterval(timer);
  console.error(`measure-run: failed to start command: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  clearInterval(timer);
  const wallMs = Date.now() - startedAt;
  const usable = memoryAvailable && samples > 0;
  const record = {
    label: options.label,
    command: command.join(' '),
    wallSeconds: Number((wallMs / 1000).toFixed(1)),
    // Lower bound: sampled, so a spike between samples can be missed.
    peakTreeRssMb: usable ? megabytes(peakRssKb) : null,
    peakProcesses: usable ? peakProcesses : null,
    // What the number actually covers, so a reader never takes it for a
    // guarantee the mechanism cannot make. See KNOWN LIMIT.
    boundary: usable ? 'process-tree-sampling' : 'wall-clock-only',
    unmeasured: usable
      ? 'descendants that detach and are orphaned before first observation'
      : 'memory (POSIX ps unavailable)',
    samples,
    exitCode: code,
    signal,
    timestamp: new Date(startedAt).toISOString(),
  };

  const memory = usable
    ? `peak process-tree RSS ${record.peakTreeRssMb} MB across up to ${record.peakProcesses} processes (sampled lower bound)`
    : 'peak memory unavailable on this platform';
  console.log(
    `\nmeasure-run [${record.label}]: ${record.wallSeconds}s wall, ${memory}`,
  );

  if (options.out !== undefined) {
    appendFileSync(options.out, `${JSON.stringify(record)}\n`);
  }

  const exitSignal = signal ?? forwardedSignal;
  if (exitSignal) {
    process.kill(process.pid, exitSignal);
    return;
  }
  process.exit(code ?? 0);
});
