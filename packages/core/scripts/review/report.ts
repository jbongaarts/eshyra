/**
 * Human-readable output.
 *
 * Default output is compact and action-oriented, because recurring agent
 * context cost is a first-class acceptance criterion for this system: an agent
 * that must read 300 lines of review state before starting work pays that cost
 * on every task, forever. Default `review:preflight` output stays under
 * `PREFLIGHT_MAX_DEFAULT_LINES`, and the profile document it names is the ONLY
 * profile document the caller is told to read.
 *
 * `--verbose` expands the same state; `--json` emits all of it.
 */

import type { ParsedContract } from './contract.js';
import type { ReviewDocument } from './documents.js';
import type { PullRequestSnapshot } from './github.js';
import { shortHash } from './hashing.js';
import type { Classification } from './policy.js';
import { profileDocPath } from './profiles.js';
import type { PrReviewState } from './state.js';

/** Enforced by test; the ceiling exists so compact output stays compact. */
export const PREFLIGHT_MAX_DEFAULT_LINES = 40;

export interface OutputOptions {
  readonly verbose: boolean;
}

export function formatClassification(
  beadId: string,
  classification: Classification,
  prNumber: number | undefined,
  options: OutputOptions,
): string {
  const lines: string[] = [
    `bead              ${beadId}${prNumber === undefined ? '' : `  (PR #${prNumber})`}`,
    `declared          ${classification.declaredProfile}`,
    `path minimum      ${classification.pathMinimum}`,
    `characteristic    ${classification.characteristicMinimum}`,
    `effective         ${classification.effectiveProfile}`,
    `policy hash       ${shortHash(classification.policyHash)}`,
  ];

  if (classification.escalations.length === 0) {
    lines.push('escalations       none');
  } else if (options.verbose) {
    lines.push('escalations:');
    for (const escalation of classification.escalations) {
      lines.push(
        `  [${escalation.source}] ${escalation.ruleId} -> ${escalation.profile}`,
        `    ${escalation.reason}`,
        `    evidence: ${escalation.evidence.join(', ')}`,
      );
    }
  } else {
    lines.push(
      `escalations       ${classification.escalations
        .map((entry) => `${entry.ruleId} -> ${entry.profile}`)
        .join(', ')}`,
    );
  }

  if (classification.unknownCharacteristics.length > 0) {
    lines.push(
      `UNKNOWN CHARACTERISTICS  ${classification.unknownCharacteristics.join(', ')}`,
    );
  }
  if (classification.underClassified) {
    lines.push(
      `UNDER-CLASSIFIED  declared ${classification.declaredProfile} < required ${classification.minimumProfile}`,
    );
  } else if (classification.overClassified) {
    lines.push(
      `over-classified   declared ${classification.declaredProfile} > required ${classification.minimumProfile} (permitted)`,
    );
  }
  lines.push(
    `read              ${profileDocPath(classification.effectiveProfile)}`,
  );
  return lines.join('\n');
}

export interface PreflightView {
  readonly contract: ParsedContract;
  readonly beadTitle: string;
  readonly classification: Classification;
  readonly protocolDocument: ReviewDocument;
  readonly profileDocument: ReviewDocument;
  readonly pr?: PullRequestSnapshot;
  readonly state?: PrReviewState;
}

export function formatPreflight(
  view: PreflightView,
  options: OutputOptions,
): string {
  const { classification: cls } = view;
  const lines: string[] = [];

  lines.push(
    `bead        ${view.contract.beadId}  ${truncate(view.beadTitle, 52)}`,
  );
  if (view.pr) {
    lines.push(
      `pr          #${view.pr.number}  head ${view.pr.headSha.slice(0, 12)}  base ${view.pr.baseRefName}${view.pr.isDraft ? '  (draft)' : ''}`,
    );
  }
  lines.push(
    `profile     declared=${cls.declaredProfile}  minimum=${cls.minimumProfile}  effective=${cls.effectiveProfile}`,
  );
  lines.push(
    `hashes      protocol=${shortHash(view.protocolDocument.hash)}  profile=${shortHash(view.profileDocument.hash)}  policy=${shortHash(cls.policyHash)}  contract=${shortHash(view.contract.contractHash)}`,
  );

  if (view.state) {
    lines.push(
      `state       ${view.state.state}`,
      `auth        ${view.state.authorizationRequired ? 'required' : 'optional'} — ${view.state.authorizationDetail}`,
      `impl        ${view.state.implementationDetail}`,
      `handoff     ${view.state.handoffDetail}`,
    );
    if (view.state.bootstrap?.applies) {
      lines.push('bootstrap   EXCEPTION ACTIVE (waives authorization only)');
    }
  } else {
    lines.push(
      'state       no PR supplied — contract validity only',
      `auth        ${view.contract.authorizationRequestedByContract || cls.effectiveProfile !== 'standard' ? 'required before substantive implementation' : 'optional'}`,
    );
  }

  const problems = view.state?.problems ?? [];
  if (problems.length === 0) {
    lines.push('problems    none');
  } else {
    lines.push('problems:');
    const shown = options.verbose ? problems : problems.slice(0, 6);
    for (const problem of shown) {
      lines.push(`  ! ${wrapProblem(problem, options.verbose)}`);
    }
    if (shown.length < problems.length) {
      lines.push(
        `  ... ${problems.length - shown.length} more (use --verbose)`,
      );
    }
  }

  if (options.verbose) {
    lines.push(
      '',
      'contract sections:',
      ...view.contract.normalized.sections.map(
        (section) => `  ### ${section.title} (${section.fields.length} fields)`,
      ),
      '',
      'full hashes:',
      `  protocol  ${view.protocolDocument.hash}`,
      `  profile   ${view.profileDocument.hash}`,
      `  policy    ${cls.policyHash}`,
      `  contract  ${view.contract.contractHash}`,
    );
  }

  lines.push(
    `next        ${view.state?.nextAction ?? nextActionWithoutPr(view)}`,
    `read        ${profileDocPath(cls.effectiveProfile)}  (only this profile)`,
  );
  return lines.join('\n');
}

function nextActionWithoutPr(view: PreflightView): string {
  return view.classification.underClassified
    ? `Raise the declared profile to ${view.classification.minimumProfile} in the bead contract.`
    : 'Contract is valid. Supply --pr <number> to evaluate handoff and checkpoint state.';
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function wrapProblem(problem: string, verbose: boolean): string {
  const collapsed = problem.replace(/\s+/g, ' ').trim();
  return verbose ? collapsed : truncate(collapsed, 150);
}
