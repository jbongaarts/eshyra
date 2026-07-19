/**
 * CLI for generic rules-pack audit and diff.
 *
 * Usage via the root npm scripts (recommended — `audit` / `diff` is baked
 * into each script, so callers only pass paths and flags):
 *
 *   npm run audit:rules-pack -- <packDir>
 *   npm run diff:rules-pack  -- <baselineDir> <candidateDir>
 *
 * Usage invoking the script directly (each call must name the subcommand):
 *
 *   tsx packages/core/scripts/rules-pack-audit/cli.ts audit <packDir>
 *   tsx packages/core/scripts/rules-pack-audit/cli.ts diff  <baselineDir> <candidateDir>
 *
 * Common flags:
 *   --json              Print the JSON form instead of the human-readable text.
 *   --strict            Exit nonzero when findings exist (audit) or any change
 *                       is detected (diff). Use for CI gating.
 *
 * Both subcommands load packs through `loadRulesPackFromDirectory`, so the
 * baseline `validateRulesPack` invariants are enforced before any audit or
 * diff runs. A pack that fails validation reports the validation error to
 * stderr and exits with code 2 — this is distinct from `--strict` findings,
 * which exit with code 1.
 *
 * This tool is system-agnostic. It does NOT vendor source artifacts, run
 * importers, or know anything about D&D / Pathfinder content; it operates on
 * the generic `RulesPack` shape produced by any importer.
 */

import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditHasFindings,
  auditPack,
  diffHasChanges,
  diffPacks,
  formatAuditReport,
  formatDiffReport,
  loadRulesPackFromDirectory,
  RulesPackError,
} from '../../src/internal.js';

interface SharedOptions {
  readonly json: boolean;
  readonly strict: boolean;
}

export interface RulesPackAuditCliIO {
  readonly stdout: Pick<NodeJS.WriteStream, 'write'>;
  readonly stderr: Pick<NodeJS.WriteStream, 'write'>;
  readonly cwd: string;
}

class CliExit extends Error {
  constructor(readonly code: number) {
    super(`rules-pack-audit exited with code ${code}`);
  }
}

interface AuditCommand {
  readonly kind: 'audit';
  readonly packDir: string;
  readonly options: SharedOptions;
}

interface DiffCommand {
  readonly kind: 'diff';
  readonly beforeDir: string;
  readonly afterDir: string;
  readonly options: SharedOptions;
}

type ParsedCommand = AuditCommand | DiffCommand;

function ensureAbsolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function parseArgs(
  argv: readonly string[],
  io: RulesPackAuditCliIO,
): ParsedCommand {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelpAndExit(argv.length === 0 ? 1 : 0, io);
  }
  const subcommand = argv[0];
  const rest = argv.slice(1);
  if (subcommand === 'audit') {
    return parseAuditArgs(rest, io);
  }
  if (subcommand === 'diff') {
    return parseDiffArgs(rest, io);
  }
  io.stderr.write(`unknown subcommand: ${subcommand}\n`);
  printHelpAndExit(1, io);
}

interface PartitionedArgs {
  readonly positional: readonly string[];
  readonly options: SharedOptions;
}

function partitionArgs(
  argv: readonly string[],
  io: RulesPackAuditCliIO,
): PartitionedArgs {
  let json = false;
  let strict = false;
  const positional: string[] = [];
  for (const token of argv) {
    if (token === '--json') {
      json = true;
    } else if (token === '--strict') {
      strict = true;
    } else if (token === '--help' || token === '-h') {
      printHelpAndExit(0, io);
    } else if (token.startsWith('--')) {
      io.stderr.write(`unknown flag: ${token}\n`);
      printHelpAndExit(1, io);
    } else {
      positional.push(token);
    }
  }
  return { positional, options: { json, strict } };
}

function parseAuditArgs(
  argv: readonly string[],
  io: RulesPackAuditCliIO,
): AuditCommand {
  const { positional, options } = partitionArgs(argv, io);
  if (positional.length !== 1) {
    io.stderr.write('audit: expected exactly one <packDir> argument\n');
    printHelpAndExit(1, io);
  }
  return {
    kind: 'audit',
    packDir: ensureAbsolute(positional[0], io.cwd),
    options,
  };
}

function parseDiffArgs(
  argv: readonly string[],
  io: RulesPackAuditCliIO,
): DiffCommand {
  const { positional, options } = partitionArgs(argv, io);
  if (positional.length !== 2) {
    io.stderr.write(
      'diff: expected <baselineDir> and <candidateDir> arguments\n',
    );
    printHelpAndExit(1, io);
  }
  return {
    kind: 'diff',
    beforeDir: ensureAbsolute(positional[0], io.cwd),
    afterDir: ensureAbsolute(positional[1], io.cwd),
    options,
  };
}

function printHelpAndExit(code: number, io: RulesPackAuditCliIO): never {
  const text = [
    'Usage:',
    '  rules-pack-audit audit <packDir> [--json] [--strict]',
    '  rules-pack-audit diff  <baselineDir> <candidateDir> [--json] [--strict]',
    '',
    'Subcommands:',
    '  audit    Run heuristic checks (suspicious records, partially-populated',
    '           data fields) and per-kind record counts on one pack.',
    '  diff     Compare two pack directories and report manifest deltas plus',
    '           added/removed/changed records with per-field diffs.',
    '',
    'Flags:',
    '  --json    Emit the JSON form of the report instead of plain text.',
    '  --strict  Exit nonzero when findings/changes exist (CI gating).',
    '',
    'Exit codes:',
    '  0  success (and, without --strict, regardless of findings/changes)',
    '  1  --strict and findings or changes were detected',
    '  2  pack failed validation or could not be loaded',
  ].join('\n');
  if (code === 0) {
    io.stdout.write(`${text}\n`);
  } else {
    io.stderr.write(`${text}\n`);
  }
  throw new CliExit(code);
}

function runAudit(command: AuditCommand, io: RulesPackAuditCliIO): number {
  const pack = loadOrExit(command.packDir, io);
  const audit = auditPack(pack);
  if (command.options.json) {
    io.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  } else {
    io.stdout.write(formatAuditReport(audit));
  }
  if (command.options.strict && auditHasFindings(audit)) {
    return 1;
  }
  return 0;
}

function runDiff(command: DiffCommand, io: RulesPackAuditCliIO): number {
  const before = loadOrExit(command.beforeDir, io);
  const after = loadOrExit(command.afterDir, io);
  const diff = diffPacks(before, after);
  if (command.options.json) {
    io.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
  } else {
    io.stdout.write(formatDiffReport(diff));
  }
  if (command.options.strict && diffHasChanges(diff)) {
    return 1;
  }
  return 0;
}

function loadOrExit(
  dir: string,
  io: RulesPackAuditCliIO,
): ReturnType<typeof loadRulesPackFromDirectory> {
  try {
    return loadRulesPackFromDirectory(dir);
  } catch (cause) {
    if (cause instanceof RulesPackError) {
      io.stderr.write(`pack at ${dir} failed validation: ${cause.message}\n`);
    } else {
      io.stderr.write(
        `failed to load pack at ${dir}: ${(cause as Error).message}\n`,
      );
    }
    throw new CliExit(2);
  }
}

export function runCli(
  argv: readonly string[],
  io: RulesPackAuditCliIO = {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
  },
): number {
  try {
    const command = parseArgs(argv, io);
    return command.kind === 'audit'
      ? runAudit(command, io)
      : runDiff(command, io);
  } catch (cause) {
    if (cause instanceof CliExit) {
      return cause.code;
    }
    throw cause;
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  process.exitCode = runCli(process.argv.slice(2));
}
