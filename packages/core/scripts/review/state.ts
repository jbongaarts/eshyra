/**
 * The review lifecycle: one universal state machine for every profile.
 *
 *   design-invalidated  (terminal, absorbing — nothing leaves this state)
 *   authorization-pending
 *   authorized-and-in-progress
 *   ready-for-implementation-review
 *   changes-requested
 *   implementation-approved
 *
 * Profiles change WHAT EVIDENCE IS REQUIRED, never the shape of the lifecycle.
 * That is the whole point of the split: ordinary repository work runs the same
 * machine as rules-source work, with a `standard` evidence bar and optional
 * pre-implementation authorization.
 *
 * Every state here is COMPUTED from published artifacts. None is stored, and
 * none can be asserted by the author of the change — the producer of an
 * artifact may not define the standard its own output is judged by.
 */

import type { BootstrapDecision } from './bootstrap.js';
import {
  type CheckpointDiscovery,
  findCheckpointComments,
} from './checkpointPublication.js';
import {
  type AuthorizationVerdict,
  type CurrentReviewIdentity,
  evaluateAuthorization,
  evaluateImplementationApproval,
} from './checkpoints.js';
import type { ParsedContract } from './contract.js';
import type { ReviewDocument } from './documents.js';
import type { IssueComment, PullRequestSnapshot } from './github.js';
import { findHandoffComments, type HandoffComment } from './handoff.js';
import { findInvalidation } from './invalidation.js';
import type { Classification } from './policy.js';
import {
  profileDocPath,
  profileRequiresAuthorization,
  type ReviewProfile,
} from './profiles.js';

export type LifecycleState =
  | 'design-invalidated'
  | 'authorization-pending'
  | 'authorized-and-in-progress'
  | 'ready-for-implementation-review'
  | 'changes-requested'
  | 'implementation-approved';

export interface PrReviewState {
  readonly prNumber: number;
  readonly headSha: string;
  readonly state: LifecycleState;
  readonly designInvalidated: boolean;
  readonly authorizationRequired: boolean;
  readonly authorizationSatisfied: boolean;
  readonly authorizationDetail: string;
  readonly implementationApproved: boolean;
  readonly implementationDetail: string;
  readonly handoff?: HandoffComment;
  readonly handoffStale: boolean;
  readonly handoffDetail: string;
  readonly checkpoints: CheckpointDiscovery;
  readonly bootstrap?: BootstrapDecision;
  /** Blocking problems. Empty means nothing blocks the next step. */
  readonly problems: readonly string[];
  /** The single next action a human or agent should take. */
  readonly nextAction: string;
}

export interface ComputeStateInput {
  readonly pr: PullRequestSnapshot;
  readonly comments: readonly IssueComment[];
  readonly contract: ParsedContract;
  readonly classification: Classification;
  readonly protocolDocument: ReviewDocument;
  readonly profileDocument: ReviewDocument;
  readonly bootstrap?: BootstrapDecision;
}

export function currentIdentity(
  input: Omit<ComputeStateInput, 'pr' | 'comments' | 'bootstrap'>,
): CurrentReviewIdentity {
  return {
    protocolId: input.protocolDocument.id,
    protocolHash: input.protocolDocument.hash,
    profileId: input.profileDocument.id,
    profileHash: input.profileDocument.hash,
    policyHash: input.classification.policyHash,
    effectiveProfile: input.classification.effectiveProfile,
    contractHash: input.contract.contractHash,
  };
}

/**
 * Authorization is required when the effective profile compels it OR the
 * contract asks for it. The contract may only add the requirement, never
 * remove one the profile imposes.
 */
export function authorizationRequired(
  effectiveProfile: ReviewProfile,
  contract: ParsedContract,
): boolean {
  return (
    profileRequiresAuthorization(effectiveProfile) ||
    contract.authorizationRequestedByContract
  );
}

export function computePrReviewState(input: ComputeStateInput): PrReviewState {
  const problems: string[] = [];
  const identity = currentIdentity(input);
  const invalidation = findInvalidation(input.comments);
  const checkpoints = findCheckpointComments(input.comments, 'production');
  for (const entry of checkpoints.malformed) {
    problems.push(
      `Malformed checkpoint comment ${entry.comment.url}: ${entry.error}`,
    );
  }

  const handoffs = findHandoffComments(input.comments);
  for (const comment of handoffs.malformed) {
    problems.push(`Malformed contract handoff comment ${comment.url}.`);
  }
  if (handoffs.superseded.length > 0) {
    problems.push(
      `${handoffs.superseded.length} superseded contract handoff comment(s) remain active-looking on this PR; exactly one is permitted.`,
    );
  }

  const required = authorizationRequired(
    input.classification.effectiveProfile,
    input.contract,
  );

  // ---- terminal state first: nothing below can rescue an invalidated PR ----
  if (invalidation.invalidated) {
    return {
      prNumber: input.pr.number,
      headSha: input.pr.headSha,
      state: 'design-invalidated',
      designInvalidated: true,
      authorizationRequired: required,
      authorizationSatisfied: false,
      authorizationDetail:
        'DESIGN_INVALIDATED — authorization is permanently unavailable for this PR.',
      implementationApproved: false,
      implementationDetail:
        'DESIGN_INVALIDATED — implementation approval is permanently unavailable for this PR.',
      handoff: handoffs.active,
      handoffStale: true,
      handoffDetail: 'Handoffs carry no weight on an invalidated PR.',
      checkpoints,
      bootstrap: input.bootstrap,
      problems: [
        `PR #${input.pr.number} is DESIGN_INVALIDATED. Stop work: no further substantive commits, no merge, no new handoff. Recovery is a successor bead and a new PR.`,
        ...problems,
      ],
      nextAction:
        'Stop work on this PR. Open a successor bead and a new PR; do not fix forward here.',
    };
  }

  // ---- under-classification is blocking regardless of checkpoints ----
  if (input.classification.underClassified) {
    problems.push(
      `Under-classified: contract declares ${input.classification.declaredProfile} but the minimum required profile is ${input.classification.minimumProfile}. Raise the declared profile and re-authorize.`,
    );
  }
  if (input.classification.unknownCharacteristics.length > 0) {
    problems.push(
      `Contract declares change characteristics not in the policy: ${input.classification.unknownCharacteristics.join(', ')}. An unrecognized characteristic cannot be evaluated, so it cannot be trusted to escalate.`,
    );
  }

  // ---- contract authorization ----
  let authorizationSatisfied = false;
  let authorizationDetail: string;
  const authCheckpoint = checkpoints.currentAuthorization;
  if (!required) {
    authorizationSatisfied = true;
    authorizationDetail =
      'not required by profile or contract (may still be requested at any time)';
  } else if (
    authCheckpoint?.checkpoint.checkpointKind === 'contract-authorization'
  ) {
    const verdict: AuthorizationVerdict = evaluateAuthorization(
      authCheckpoint.checkpoint,
      identity,
      false,
    );
    authorizationSatisfied = verdict.valid;
    authorizationDetail = verdict.valid
      ? `granted by ${authCheckpoint.checkpoint.reviewerRole}`
      : `invalid: ${verdict.reasons.join('; ')}`;
    if (!verdict.valid) {
      problems.push(`Contract authorization ${authorizationDetail}.`);
    }
  } else if (input.bootstrap?.applies) {
    authorizationSatisfied = false;
    authorizationDetail =
      'waived by the one-time process-bootstrap exception (NOT an authorization)';
  } else {
    authorizationDetail = 'missing';
    problems.push(
      `Contract authorization is mandatory for effective profile ${input.classification.effectiveProfile} and no valid contract-authorization checkpoint exists.`,
    );
  }

  // ---- handoff freshness ----
  let handoffStale = true;
  let handoffDetail: string;
  const handoff = handoffs.active;
  if (!handoff) {
    handoffDetail = 'no contract handoff published';
  } else {
    const drift: string[] = [];
    if (handoff.payload.protocolHash !== identity.protocolHash) {
      drift.push('protocol');
    }
    if (handoff.payload.profileHash !== identity.profileHash) {
      drift.push('profile');
    }
    if (handoff.payload.policyHash !== identity.policyHash) {
      drift.push('policy');
    }
    if (handoff.payload.contractHash !== identity.contractHash) {
      drift.push('contract');
    }
    if (handoff.payload.effectiveProfile !== identity.effectiveProfile) {
      drift.push('effective profile');
    }
    if (
      handoff.payload.handoffKind === 'implementation-review' &&
      handoff.payload.publicationHeadSha !== input.pr.headSha
    ) {
      drift.push('head');
    }
    handoffStale = drift.length > 0;
    handoffDetail = handoffStale
      ? `stale (${drift.join(', ')} changed since publication)`
      : `current (${handoff.payload.handoffKind})`;
  }

  // ---- implementation review ----
  let implementationApproved = false;
  let implementationDetail: string;
  const implCheckpoint = checkpoints.currentImplementation;
  if (!implCheckpoint) {
    implementationDetail = 'no implementation-review checkpoint';
  } else if (
    implCheckpoint.checkpoint.checkpointKind === 'implementation-review'
  ) {
    const verdict = evaluateImplementationApproval(
      implCheckpoint.checkpoint,
      identity,
      input.pr.headSha,
      false,
    );
    implementationApproved = verdict.valid;
    implementationDetail = verdict.valid
      ? `approved at ${input.pr.headSha.slice(0, 12)} by ${implCheckpoint.checkpoint.reviewerRole}`
      : `not current: ${verdict.reasons.join('; ')}`;
  } else {
    implementationDetail = 'no implementation-review checkpoint';
  }

  const changesRequested =
    implCheckpoint?.checkpoint.checkpointKind === 'implementation-review' &&
    implCheckpoint.checkpoint.result !== 'approved' &&
    implCheckpoint.checkpoint.reviewedHeadSha === input.pr.headSha;

  const state: LifecycleState = implementationApproved
    ? 'implementation-approved'
    : changesRequested
      ? 'changes-requested'
      : required && !authorizationSatisfied && !input.bootstrap?.applies
        ? 'authorization-pending'
        : handoff?.payload.handoffKind === 'implementation-review' &&
            !handoffStale
          ? 'ready-for-implementation-review'
          : 'authorized-and-in-progress';

  return {
    prNumber: input.pr.number,
    headSha: input.pr.headSha,
    state,
    designInvalidated: false,
    authorizationRequired: required,
    authorizationSatisfied,
    authorizationDetail,
    implementationApproved,
    implementationDetail,
    handoff,
    handoffStale,
    handoffDetail,
    checkpoints,
    bootstrap: input.bootstrap,
    problems,
    nextAction: nextActionFor(state, input, handoffStale),
  };
}

function nextActionFor(
  state: LifecycleState,
  input: ComputeStateInput,
  handoffStale: boolean,
): string {
  const doc = profileDocPath(input.classification.effectiveProfile);
  switch (state) {
    case 'design-invalidated':
      return 'Stop work on this PR.';
    case 'authorization-pending':
      return `Publish a contract-authorization handoff (npm run review:handoff -- --bead ${input.contract.beadId} --pr ${input.pr.number} --kind contract-authorization) and obtain a contract-authorization checkpoint before substantive implementation. Read ${doc}.`;
    case 'changes-requested':
      return `Address the open findings, push, then publish a fresh implementation-review handoff. Read ${doc}.`;
    case 'ready-for-implementation-review':
      return `Awaiting an implementation-review checkpoint at head ${input.pr.headSha.slice(0, 12)}.`;
    case 'implementation-approved':
      return 'Merge-ready under the review protocol. Any new commit invalidates this approval.';
    default:
      return handoffStale
        ? `Continue implementation. Publish an implementation-review handoff (npm run review:handoff -- --bead ${input.contract.beadId} --pr ${input.pr.number} --kind implementation-review) when ready for review.`
        : 'Continue implementation.';
  }
}

/**
 * Merge readiness. Separate from `state` because CI asks a narrower question
 * than a human does, and because "ready for review" and "approved" must never
 * be conflated.
 */
export function mergeReadiness(state: PrReviewState): {
  readonly ready: boolean;
  readonly blockers: readonly string[];
} {
  const blockers: string[] = [];
  if (state.designInvalidated) {
    blockers.push('PR is DESIGN_INVALIDATED.');
  }
  if (state.authorizationRequired && !state.authorizationSatisfied) {
    blockers.push(`Contract authorization ${state.authorizationDetail}.`);
  }
  if (!state.handoff) {
    blockers.push('No contract handoff has been published.');
  } else if (state.handoffStale) {
    blockers.push(`Contract handoff is ${state.handoffDetail}.`);
  }
  if (!state.implementationApproved) {
    blockers.push(`Implementation review: ${state.implementationDetail}.`);
  }
  blockers.push(...state.problems);
  return { ready: blockers.length === 0, blockers };
}
