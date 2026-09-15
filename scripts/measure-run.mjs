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
//   Each sample builds the DESCENDANT CLOSURE of the measured command from
//   parent/child links, then unions in every process sharing a process group
//   with a discovered descendant, iterating to a fixpoint.
//
//   Both halves are load-bearing. An earlier revision sampled only the process
//   GROUP of a `detached: true` child, which a nested detached descendant
//   escapes entirely: Node makes such a child the leader of a NEW group and
//   session, so it falls outside the group being summed. Measured against a
//   workload holding a detached 600 MB grandchild, the group-only sampler
//   reported 47 MB across 1 process. This is not hypothetical — the suite's own
//   measureRun.test.ts spawns exactly that shape, so a group-only sampler
//   under-reports the very verification run it claims to measure.
//
//   Parent links alone are also insufficient: a descendant re-parented to init
//   after its intermediate parent exits loses its link to us. Recording the
//   process groups of descendants we have already seen keeps those visible.
//
//   Sampling can miss a spike between samples, so this reports a LOWER BOUND on
//   the true peak — it can under-report, never over-report.
//
// PROCESS LIFETIME:
//   The command is deliberately NOT detached: it stays in this process's group
//   so terminal signals reach it, and SIGINT/SIGTERM are forwarded explicitly so
//   an interrupted measurement cannot strand a running test suite.
//
// PORTABILITY:
//   Memory sampling needs POSIX `ps`. Where that is unavailable (Windows, or a
//   sandbox that denies it) the run still executes and wall clock is still
//   reported; memory is reported as null rather than as a wrong number. This
//   must never fail the gate it is wrapping.

const SAMPLE_INTERVAL_MS = 500;

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
 * Aggregate RSS (KB) and process count for the measured command's whole tree,
 * or null where POSIX `ps` is unavailable.
 *
 * Membership is the fixpoint of: the root, anything descended from a member,
 * and anything sharing a process group with a member. See HOW IT MEASURES.
 */
function sampleProcessTree(rootPid) {
  const result = spawnSync('ps', ['-e', '-o', 'pid=,ppid=,pgid=,rss='], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') return null;

  const rows = [];
  for (const line of result.stdout.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) continue;
    const row = {
      pid: Number(fields[0]),
      ppid: Number(fields[1]),
      pgid: Number(fields[2]),
      rssKb: Number(fields[3]) || 0,
    };
    if (Number.isNaN(row.pid)) continue;
    rows.push(row);
  }

  const members = new Set([rootPid]);
  const groups = new Set();
  // This wrapper's own group is never a membership signal: without `detached`
  // the measured command shares it, so admitting it would sweep in unrelated
  // siblings (the shell, the agent). Descendants are found by parent link, and
  // only the NEW groups they create are added below.
  const ownGroup = process.pid === undefined ? -1 : Number(process.pid);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (members.has(row.pid)) {
        if (
          row.pgid !== ownGroup &&
          row.pid === row.pgid &&
          !groups.has(row.pgid)
        ) {
          // A descendant that leads its own group (detached/setsid). Record the
          // group so its children stay visible even if it is re-parented.
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
  for (const row of rows) {
    if (!members.has(row.pid)) continue;
    rssKb += row.rssKb;
    processes += 1;
  }
  return { rssKb, processes };
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

// Forward interruption so an abandoned measurement cannot strand a running
// suite. The child shares this process group, so a terminal Ctrl+C already
// reaches it; this covers programmatic callers (verify:worktree spawns this
// wrapper directly) where no terminal signal is delivered.
let forwardedSignal;
for (const signalName of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signalName, () => {
    forwardedSignal = signalName;
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
