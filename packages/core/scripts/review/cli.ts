/**
 * `review:*` command surface.
 *
 * Usage via the root npm scripts:
 *
 *   npm run review:classify   -- --bead <bead-id> [--pr <number>]
 *   npm run review:preflight  -- --bead <bead-id> [--pr <number>]
 *   npm run review:handoff    -- --bead <bead-id> --pr <number> \
 *                                --kind <contract-authorization|implementation-review>
 *   npm run review:checkpoint -- --pr <number> --input <json-file>
 *   npm run review:invalidate -- --pr <number> --bead <bead-id> \
 *                                --successor <bead-id>
 *
 * Common flags: `--verbose` (expanded human output), `--json` (complete
 * machine-readable state), `--dry-run` (publishing commands only).
 *
 * Exit codes: 0 success; 1 the reviewed state is malformed, stale,
 * under-classified, contradictory, or invalidated; 2 the command itself could
 * not run (bad arguments, unreadable policy, GitHub or Beads failure).
 *
 * Command execution lives here and nowhere else — parsing, normalization,
 * policy, and remote access are separate modules so they stay unit-testable
 * without a process or a network.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BdCliBeadsClient,
  contractSources,
  type ReviewBeadsClient,
} from './beads.js';
import {
  BOOTSTRAP_BEAD_ID,
  type BootstrapDecision,
  evaluateBootstrapException,
} from './bootstrap.js';
import { localChangedPaths } from './changedPaths.js';
import { publishCheckpoint } from './checkpointPublication.js';
import {
  type CheckpointTrust,
  parseCheckpoint,
  type ReviewCheckpoint,
} from './checkpoints.js';
import { evaluateCiGate, type GateStage } from './ciGate.js';
import { ContractError, parseReviewContract } from './contract.js';
import {
  loadProfileDocument,
  loadProtocolDocument,
  type ReviewDocument,
} from './documents.js';
import {
  GhCliGitHubClient,
  type PullRequestSnapshot,
  type ReviewGitHubClient,
} from './github.js';
import {
  formatHandoffComment,
  type HandoffKind,
  type HandoffPayload,
  upsertHandoffComment,
} from './handoff.js';
import { findInvalidation, publishInvalidation } from './invalidation.js';
import {
  type Classification,
  classifyChange,
  type LoadedPolicy,
  loadMinimumProfilePolicy,
} from './policy.js';
import { PROTOCOL_DOC_PATH, PROTOCOL_ID } from './profiles.js';
import {
  formatClassification,
  formatPreflight,
  type PreflightView,
} from './report.js';
import {
  authorizationRequired,
  computePrReviewState,
  mergeReadiness,
  type PrReviewState,
} from './state.js';

export interface ReviewCliIO {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

export interface ReviewCliDeps extends ReviewCliIO {
  readonly repoRoot: string;
  readonly github: ReviewGitHubClient;
  readonly beads: ReviewBeadsClient;
  /** Changed paths when no PR is supplied (local classification). */
  readonly localChangedPaths?: () => readonly string[];
}

class CliExit extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'CliExit';
  }
}

interface Flags {
  readonly command: string;
  readonly bead?: string;
  readonly pr?: number;
  readonly kind?: string;
  readonly input?: string;
  readonly successor?: string;
  readonly reason?: string;
  readonly stage?: string;
  readonly verbose: boolean;
  readonly json: boolean;
  readonly dryRun: boolean;
  readonly requireMergeReady: boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  const [command, ...rest] = argv;
  if (!command || command.startsWith('-')) {
    throw new CliExit(
      2,
      'Missing command. Expected one of: classify, preflight, handoff, checkpoint, invalidate, ci.',
    );
  }
  const values = new Map<string, string>();
  let verbose = false;
  let json = false;
  let dryRun = false;
  let requireMergeReady = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--verbose') {
      verbose = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--require-merge-ready') {
      requireMergeReady = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new CliExit(2, `Unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      values.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new CliExit(2, `Flag ${arg} requires a value.`);
    }
    values.set(arg.slice(2), next);
    index += 1;
  }

  const prRaw = values.get('pr');
  let pr: number | undefined;
  if (prRaw !== undefined) {
    pr = Number.parseInt(prRaw, 10);
    if (!Number.isInteger(pr) || pr <= 0) {
      throw new CliExit(2, `--pr must be a positive integer, got ${prRaw}.`);
    }
  }

  return {
    command,
    bead: values.get('bead'),
    pr,
    kind: values.get('kind'),
    input: values.get('input'),
    successor: values.get('successor'),
    reason: values.get('reason'),
    stage: values.get('stage'),
    verbose,
    json,
    dryRun,
    requireMergeReady,
  };
}

/* -------------------------------------------------------------------------
 * Shared resolution
 * ---------------------------------------------------------------------- */

interface ResolvedContext {
  readonly beadId: string;
  readonly beadTitle: string;
  readonly contract: ReturnType<typeof parseReviewContract>;
  readonly policy: LoadedPolicy;
  readonly classification: Classification;
  readonly protocolDocument: ReviewDocument;
  readonly profileDocument: ReviewDocument;
  readonly pr?: PullRequestSnapshot;
  readonly bootstrap?: BootstrapDecision;
  readonly state?: PrReviewState;
}

async function resolve(
  deps: ReviewCliDeps,
  flags: Flags,
  options: { readonly needPr: boolean },
): Promise<ResolvedContext> {
  if (!flags.bead) {
    throw new CliExit(2, '--bead <bead-id> is required.');
  }
  if (options.needPr && flags.pr === undefined) {
    throw new CliExit(2, '--pr <number> is required for this command.');
  }

  const issue = await deps.beads.getIssue(flags.bead);
  if (!issue) {
    throw new CliExit(2, `Bead ${flags.bead} not found.`);
  }

  const policy = loadMinimumProfilePolicy(deps.repoRoot);
  const protocolDocument = loadProtocolDocument(deps.repoRoot);

  let contract: ReturnType<typeof parseReviewContract>;
  try {
    contract = parseReviewContract({
      beadId: issue.id,
      sources: contractSources(issue),
    });
  } catch (error) {
    if (error instanceof ContractError) {
      throw new CliExit(1, error.message);
    }
    throw error;
  }

  const pr =
    flags.pr === undefined
      ? undefined
      : await deps.github.getPullRequest(flags.pr);

  const changedPaths = pr
    ? pr.changedPaths
    : (deps.localChangedPaths?.() ?? []);

  const classification = classifyChange(policy, {
    declaredProfile: contract.declaredProfile,
    changedPaths,
    characteristics: contract.declaredCharacteristics,
  });

  const profileDocument = loadProfileDocument(
    deps.repoRoot,
    classification.effectiveProfile,
  );

  let bootstrap: BootstrapDecision | undefined;
  let state: PrReviewState | undefined;
  if (pr) {
    bootstrap = evaluateBootstrapException({
      beadId: issue.id,
      prHeadRefName: pr.headRefName,
      baseBranchHasProtocol: await deps.github.baseBranchHasPath(
        pr.baseRefName,
        PROTOCOL_DOC_PATH,
      ),
      effectiveProfile: classification.effectiveProfile,
    });
    state = computePrReviewState({
      pr,
      comments: await deps.github.listComments(pr.number),
      contract,
      classification,
      protocolDocument,
      profileDocument,
      bootstrap,
    });
  }

  return {
    beadId: issue.id,
    beadTitle: issue.title,
    contract,
    policy,
    classification,
    protocolDocument,
    profileDocument,
    pr,
    bootstrap,
    state,
  };
}

/* -------------------------------------------------------------------------
 * Commands
 * ---------------------------------------------------------------------- */

async function commandClassify(
  deps: ReviewCliDeps,
  flags: Flags,
): Promise<number> {
  const context = await resolve(deps, flags, { needPr: false });
  if (flags.json) {
    deps.stdout.write(
      `${JSON.stringify(
        {
          beadId: context.beadId,
          prNumber: context.pr?.number,
          protocolId: PROTOCOL_ID,
          classification: context.classification,
          profileDocument: context.profileDocument.path,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    deps.stdout.write(
      `${formatClassification(
        context.beadId,
        context.classification,
        context.pr?.number,
        { verbose: flags.verbose },
      )}\n`,
    );
  }
  return context.classification.underClassified ||
    context.classification.unknownCharacteristics.length > 0
    ? 1
    : 0;
}

async function commandPreflight(
  deps: ReviewCliDeps,
  flags: Flags,
): Promise<number> {
  const context = await resolve(deps, flags, { needPr: false });
  const view: PreflightView = {
    contract: context.contract,
    beadTitle: context.beadTitle,
    classification: context.classification,
    protocolDocument: context.protocolDocument,
    profileDocument: context.profileDocument,
    pr: context.pr,
    state: context.state,
  };

  if (flags.json) {
    deps.stdout.write(`${JSON.stringify(preflightJson(context), null, 2)}\n`);
  } else {
    deps.stdout.write(`${formatPreflight(view, { verbose: flags.verbose })}\n`);
    if (flags.verbose && context.bootstrap) {
      deps.stdout.write(`\n${context.bootstrap.summary}\n`);
    }
  }

  if (context.state?.designInvalidated) {
    return 1;
  }
  if (
    context.classification.underClassified ||
    context.classification.unknownCharacteristics.length > 0
  ) {
    return 1;
  }
  if ((context.state?.problems.length ?? 0) > 0) {
    return 1;
  }
  if (flags.requireMergeReady && context.state) {
    return mergeReadiness(context.state).ready ? 0 : 1;
  }
  return 0;
}

function preflightJson(context: ResolvedContext): unknown {
  return {
    protocolId: PROTOCOL_ID,
    beadId: context.beadId,
    beadTitle: context.beadTitle,
    prNumber: context.pr?.number,
    headSha: context.pr?.headSha,
    classification: context.classification,
    hashes: {
      protocol: context.protocolDocument.hash,
      profile: context.profileDocument.hash,
      policy: context.classification.policyHash,
      contract: context.contract.contractHash,
    },
    profileDocument: context.profileDocument.path,
    authorizationRequired: authorizationRequired(
      context.classification.effectiveProfile,
      context.contract,
    ),
    contract: context.contract.normalized,
    bootstrap: context.bootstrap,
    state: context.state
      ? {
          state: context.state.state,
          designInvalidated: context.state.designInvalidated,
          authorizationRequired: context.state.authorizationRequired,
          authorizationSatisfied: context.state.authorizationSatisfied,
          authorizationDetail: context.state.authorizationDetail,
          implementationApproved: context.state.implementationApproved,
          implementationDetail: context.state.implementationDetail,
          handoffStale: context.state.handoffStale,
          handoffDetail: context.state.handoffDetail,
          problems: context.state.problems,
          nextAction: context.state.nextAction,
          mergeReadiness: mergeReadiness(context.state),
        }
      : undefined,
  };
}

async function commandHandoff(
  deps: ReviewCliDeps,
  flags: Flags,
): Promise<number> {
  const kind = flags.kind;
  if (kind !== 'contract-authorization' && kind !== 'implementation-review') {
    throw new CliExit(
      2,
      '--kind must be contract-authorization or implementation-review.',
    );
  }
  const context = await resolve(deps, flags, { needPr: true });
  const pr = context.pr;
  if (!pr) {
    throw new CliExit(2, '--pr <number> is required for this command.');
  }
  if (context.state?.designInvalidated) {
    throw new CliExit(
      1,
      `PR #${pr.number} is DESIGN_INVALIDATED. Publishing a new handoff for an invalidated PR is prohibited.`,
    );
  }
  if (context.classification.underClassified) {
    throw new CliExit(
      1,
      `Refusing to publish a handoff for an under-classified contract: declared ${context.classification.declaredProfile}, required ${context.classification.minimumProfile}.`,
    );
  }

  const payload: HandoffPayload = {
    handoffKind: kind as HandoffKind,
    beadId: context.beadId,
    beadTitle: context.beadTitle,
    protocolId: PROTOCOL_ID,
    protocolHash: context.protocolDocument.hash,
    profileId: context.profileDocument.id,
    profileHash: context.profileDocument.hash,
    policyHash: context.classification.policyHash,
    contractHash: context.contract.contractHash,
    declaredProfile: context.classification.declaredProfile,
    minimumProfile: context.classification.minimumProfile,
    effectiveProfile: context.classification.effectiveProfile,
    escalationReasons: context.classification.escalations.map(
      (entry) =>
        `[${entry.source}] ${entry.ruleId} -> ${entry.profile}: ${entry.reason}`,
    ),
    authorizationRequired: authorizationRequired(
      context.classification.effectiveProfile,
      context.contract,
    ),
    publicationHeadSha: pr.headSha,
    contract: context.contract.normalized,
  };

  const body = formatHandoffComment(payload, context.contract.normalized);
  const result = await upsertHandoffComment(deps.github, pr.number, body, {
    dryRun: flags.dryRun,
  });

  if (flags.json) {
    deps.stdout.write(
      `${JSON.stringify({ action: result.action, url: result.url, payload }, null, 2)}\n`,
    );
  } else {
    deps.stdout.write(
      `handoff     ${result.action}  kind=${payload.handoffKind}  effective=${payload.effectiveProfile}\n` +
        `head        ${payload.publicationHeadSha}\n` +
        `url         ${result.url ?? '(not published)'}\n`,
    );
    if (flags.verbose) {
      deps.stdout.write(`\n${result.body}\n`);
    }
  }
  return 0;
}

async function commandCheckpoint(
  deps: ReviewCliDeps,
  flags: Flags,
): Promise<number> {
  if (flags.pr === undefined) {
    throw new CliExit(2, '--pr <number> is required for this command.');
  }
  if (!flags.input) {
    throw new CliExit(2, '--input <json-file> is required.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(flags.input, 'utf8'));
  } catch (error) {
    throw new CliExit(
      2,
      `Cannot read checkpoint input ${flags.input}: ${(error as Error).message}`,
    );
  }

  // Publication is always a production context. A fixture checkpoint cannot be
  // published to a real PR, whatever path it was read from.
  const trust: CheckpointTrust = 'production';
  let checkpoint: ReviewCheckpoint;
  try {
    checkpoint = parseCheckpoint(raw, { trust });
  } catch (error) {
    throw new CliExit(1, (error as Error).message);
  }

  const pr = await deps.github.getPullRequest(flags.pr);
  const comments = await deps.github.listComments(flags.pr);
  if (findInvalidation(comments).invalidated) {
    throw new CliExit(
      1,
      `PR #${flags.pr} is DESIGN_INVALIDATED. No checkpoint may be published for an invalidated PR.`,
    );
  }
  if (
    checkpoint.checkpointKind === 'implementation-review' &&
    checkpoint.reviewedHeadSha !== pr.headSha
  ) {
    throw new CliExit(
      1,
      `Implementation-review checkpoint reviews head ${checkpoint.reviewedHeadSha} but the PR head is ${pr.headSha}. Any new commit invalidates implementation approval.`,
    );
  }

  const result = await publishCheckpoint(deps.github, flags.pr, checkpoint, {
    dryRun: flags.dryRun,
  });
  if (flags.json) {
    deps.stdout.write(
      `${JSON.stringify({ action: result.action, url: result.url, checkpoint }, null, 2)}\n`,
    );
  } else {
    deps.stdout.write(
      `checkpoint  ${result.action}  kind=${checkpoint.checkpointKind}  result=${checkpoint.result}\n` +
        `url         ${result.url ?? '(not published)'}\n`,
    );
    if (flags.verbose) {
      deps.stdout.write(`\n${result.body}\n`);
    }
  }
  return 0;
}

async function commandInvalidate(
  deps: ReviewCliDeps,
  flags: Flags,
): Promise<number> {
  if (flags.pr === undefined) {
    throw new CliExit(2, '--pr <number> is required for this command.');
  }
  if (!flags.bead) {
    throw new CliExit(2, '--bead <bead-id> is required.');
  }
  if (!flags.reason) {
    throw new CliExit(
      2,
      '--reason <text> is required. An invalidation without a stated reason is not an evidence record.',
    );
  }
  const context = await resolve(deps, flags, { needPr: true });
  const pr = context.pr;
  if (!pr) {
    throw new CliExit(2, '--pr <number> is required for this command.');
  }

  const result = await publishInvalidation(
    deps.github,
    pr.number,
    {
      invalidatedHeadSha: pr.headSha,
      owningBead: context.beadId,
      effectiveProfile: context.classification.effectiveProfile,
      reason: flags.reason,
      newDefectClasses: [],
      successorBead: flags.successor ?? '',
    },
    { dryRun: flags.dryRun },
  );

  deps.stdout.write(
    `invalidate  ${result.action}  pr=#${pr.number}  head=${pr.headSha}\n` +
      `successor   ${flags.successor ?? '(pending)'}\n` +
      `url         ${result.url ?? '(not published)'}\n` +
      'note        The PR and its beads were NOT mutated. Close the PR and update beads explicitly.\n',
  );
  if (flags.verbose) {
    deps.stdout.write(`\n${result.body}\n`);
  }
  return 0;
}

async function commandCi(deps: ReviewCliDeps, flags: Flags): Promise<number> {
  if (flags.pr === undefined) {
    throw new CliExit(2, '--pr <number> is required for this command.');
  }
  const stage: GateStage =
    flags.stage === 'merge-readiness'
      ? 'merge-readiness'
      : flags.stage === 'implementation' || flags.stage === undefined
        ? 'implementation'
        : (() => {
            throw new CliExit(
              2,
              '--stage must be implementation or merge-readiness.',
            );
          })();

  const pr = await deps.github.getPullRequest(flags.pr);
  const comments = await deps.github.listComments(flags.pr);
  const result = evaluateCiGate({
    repoRoot: deps.repoRoot,
    pr,
    comments,
    baseBranchHasProtocol: await deps.github.baseBranchHasPath(
      pr.baseRefName,
      PROTOCOL_DOC_PATH,
    ),
    stage,
  });

  if (flags.json) {
    deps.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }

  for (const line of result.lines) {
    deps.stdout.write(`${line}\n`);
  }
  for (const note of result.notes) {
    deps.stdout.write(`note        ${note}\n`);
  }
  if (result.failures.length === 0) {
    deps.stdout.write('gate        PASS\n');
    return 0;
  }
  deps.stdout.write('gate        FAIL\n');
  for (const failure of result.failures) {
    deps.stderr.write(`  ! ${failure}\n`);
  }
  return 1;
}

/* -------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------- */

export async function runReviewCli(
  argv: readonly string[],
  deps: ReviewCliDeps,
): Promise<number> {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    if (error instanceof CliExit) {
      deps.stderr.write(`${error.message}\n`);
      return error.code;
    }
    throw error;
  }

  try {
    switch (flags.command) {
      case 'classify':
        return await commandClassify(deps, flags);
      case 'preflight':
        return await commandPreflight(deps, flags);
      case 'handoff':
        return await commandHandoff(deps, flags);
      case 'checkpoint':
        return await commandCheckpoint(deps, flags);
      case 'invalidate':
        return await commandInvalidate(deps, flags);
      case 'ci':
        return await commandCi(deps, flags);
      default:
        deps.stderr.write(
          `Unknown command ${flags.command}. Expected classify, preflight, handoff, checkpoint, invalidate, or ci.\n`,
        );
        return 2;
    }
  } catch (error) {
    if (error instanceof CliExit) {
      deps.stderr.write(`${error.message}\n`);
      return error.code;
    }
    deps.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }
}

export const BOOTSTRAP_BEAD = BOOTSTRAP_BEAD_ID;

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const repoRoot = process.cwd();
  const code = await runReviewCli(process.argv.slice(2), {
    repoRoot,
    github: new GhCliGitHubClient({ cwd: repoRoot }),
    beads: new BdCliBeadsClient(repoRoot),
    localChangedPaths: () => localChangedPaths(repoRoot),
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exitCode = code;
}
