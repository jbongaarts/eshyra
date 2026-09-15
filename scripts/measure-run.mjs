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
//   The command is spawned detached, so it leads its own process group. We then
//   sample the aggregate RSS of every process in that group. Sampling can miss a
//   spike between samples, so this reports a LOWER BOUND on the true peak — it
//   can under-report, never over-report.
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

/** Aggregate RSS (KB) and process count for one process group, or null. */
function sampleProcessGroup(pgid) {
  const result = spawnSync('ps', ['-e', '-o', 'pgid=,rss='], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') return null;
  let rssKb = 0;
  let processes = 0;
  for (const line of result.stdout.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 2) continue;
    if (Number(fields[0]) !== pgid) continue;
    rssKb += Number(fields[1]) || 0;
    processes += 1;
  }
  return { rssKb, processes };
}

function megabytes(kb) {
  return Math.round(kb / 1024);
}

const { options, command } = parseArgs(process.argv.slice(2));

const startedAt = Date.now();
const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  detached: true,
});

let peakRssKb = 0;
let peakProcesses = 0;
let samples = 0;
let memoryAvailable = true;

const timer = setInterval(() => {
  // On POSIX a detached child leads a group whose pgid equals its pid.
  const sample = sampleProcessGroup(child.pid);
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

  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
