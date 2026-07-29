/**
 * The CI gate.
 *
 * CI evaluates a PR from artifacts reachable on a runner: the repository
 * checkout and the PR's comments. It deliberately does NOT read the Beads
 * database — that lives in Dolt behind `refs/dolt/data` and is not available
 * to a GitHub Actions job, and installing a Beads client there would make the
 * gate depend on a mutable external store.
 *
 * The division of labour is explicit:
 *
 *   `review:preflight` (local, has `bd`)  proves handoff == bead contract
 *   `review:ci`        (runner, no `bd`)  proves the published state is
 *                                        internally consistent, current, and
 *                                        sufficient for the requested step
 *
 * CI re-derives the contract digest from the structure the handoff publishes,
 * so a handoff whose digest does not describe its own payload fails. It
 * re-runs every structural rule for the effective profile, and it recomputes
 * the path-derived minimum from the PR's actual changed paths — so lowering
 * the declared profile after authorization cannot pass.
 */

import type { BootstrapDecision } from './bootstrap.js';
import { evaluateBootstrapException } from './bootstrap.js';
import { findCheckpointComments } from './checkpointPublication.js';
import { ContractError, validateContractStructure } from './contract.js';
import { loadProfileDocument, loadProtocolDocument } from './documents.js';
import type { IssueComment, PullRequestSnapshot } from './github.js';
import { findHandoffComments } from './handoff.js';
import { findInvalidation } from './invalidation.js';
import { classifyChange, loadMinimumProfilePolicy } from './policy.js';
import {
  isAtLeast,
  PROTOCOL_DOC_PATH,
  PROTOCOL_ID,
  profileDocPath,
  profileRequiresAuthorization,
  type ReviewProfile,
} from './profiles.js';
import {
  computePrReviewState,
  type LifecycleState,
  mergeReadiness,
} from './state.js';

/** What the gate is being asked to permit. */
export type GateStage = 'implementation' | 'merge-readiness';

export interface CiGateInput {
  readonly repoRoot: string;
  readonly pr: PullRequestSnapshot;
  readonly comments: readonly IssueComment[];
  readonly baseBranchHasProtocol: boolean;
  /**
   * `merge-readiness` when the PR is ready for review or being merged;
   * `implementation` for an ordinary in-progress push, which must not be made
   * to produce an implementation checkpoint it has no reason to have.
   */
  readonly stage: GateStage;
}

export interface CiGateResult {
  readonly ok: boolean;
  readonly state: LifecycleState;
  readonly effectiveProfile?: ReviewProfile;
  readonly bootstrap?: BootstrapDecision;
  readonly failures: readonly string[];
  readonly notes: readonly string[];
  readonly lines: readonly string[];
}

export function evaluateCiGate(input: CiGateInput): CiGateResult {
  const failures: string[] = [];
  const notes: string[] = [];

  // 1. Terminal state, checked before anything else can rescue it.
  const invalidation = findInvalidation(input.comments);
  if (invalidation.invalidated) {
    return {
      ok: false,
      state: 'design-invalidated',
      failures: [
        `PR #${input.pr.number} carries a DESIGN_INVALIDATED record. It must not be merged, and no readiness or approval check can pass for it. Recovery is a successor bead and a new PR.`,
      ],
      notes,
      lines: ['state       design-invalidated'],
    };
  }

  // 2. A handoff is required for every review-governed PR.
  let handoffs: ReturnType<typeof findHandoffComments>;
  try {
    handoffs = findHandoffComments(input.comments);
  } catch (error) {
    return fail(
      [`Contract handoff comments are unreadable: ${(error as Error).message}`],
      notes,
    );
  }
  for (const comment of handoffs.malformed) {
    failures.push(`Malformed contract handoff comment: ${comment.url}`);
  }
  if (handoffs.superseded.length > 0) {
    failures.push(
      `${handoffs.superseded.length} superseded contract handoff comment(s) remain on this PR; exactly one active handoff is permitted.`,
    );
  }
  const handoff = handoffs.active;
  if (!handoff) {
    return fail(
      [
        `No \`eshyra-review-contract:v2\` handoff has been published for PR #${input.pr.number}. Run: npm run review:handoff -- --bead <bead-id> --pr ${input.pr.number} --kind contract-authorization`,
        ...failures,
      ],
      notes,
    );
  }

  // 3. The published contract must be valid on its own terms.
  const policy = loadMinimumProfilePolicy(input.repoRoot);
  const protocolDocument = loadProtocolDocument(input.repoRoot);
  let contract: ReturnType<typeof validateContractStructure>;
  try {
    contract = validateContractStructure(
      handoff.payload.contract,
      handoff.payload.beadId,
    );
  } catch (error) {
    const detail =
      error instanceof ContractError
        ? error.problems.map((p) => `[${p.code}] ${p.message}`).join('; ')
        : (error as Error).message;
    return fail(
      [`Published contract is invalid: ${detail}`, ...failures],
      notes,
    );
  }

  // 4. Recompute classification against the PR's ACTUAL changed paths.
  const classification = classifyChange(policy, {
    declaredProfile: contract.declaredProfile,
    changedPaths: input.pr.changedPaths,
    characteristics: contract.declaredCharacteristics,
  });
  const profileDocument = loadProfileDocument(
    input.repoRoot,
    classification.effectiveProfile,
  );

  if (classification.underClassified) {
    failures.push(
      `Under-classified: declared ${classification.declaredProfile} but changed paths and characteristics require ${classification.minimumProfile}.`,
    );
  }
  if (classification.unknownCharacteristics.length > 0) {
    failures.push(
      `Contract declares characteristics absent from the policy: ${classification.unknownCharacteristics.join(', ')}.`,
    );
  }

  // 5. Published identity must be current.
  if (handoff.payload.protocolId !== PROTOCOL_ID) {
    failures.push(
      `Handoff protocol ${handoff.payload.protocolId} != ${PROTOCOL_ID}.`,
    );
  }
  if (handoff.payload.protocolHash !== protocolDocument.hash) {
    failures.push(
      'Handoff was published against a different protocol document. Republish the handoff and re-review.',
    );
  }
  if (handoff.payload.profileHash !== profileDocument.hash) {
    failures.push(
      'Handoff was published against a different profile document. Republish the handoff and re-review.',
    );
  }
  if (handoff.payload.policyHash !== classification.policyHash) {
    failures.push(
      'Handoff was published against a different minimum-profile policy. Republish the handoff and re-authorize.',
    );
  }
  if (handoff.payload.effectiveProfile !== classification.effectiveProfile) {
    failures.push(
      `Handoff publishes effective profile ${handoff.payload.effectiveProfile}; current computation says ${classification.effectiveProfile}. A changed effective profile is a material contract change.`,
    );
  }

  const bootstrap = evaluateBootstrapException({
    beadId: contract.beadId,
    prHeadRefName: input.pr.headRefName,
    baseBranchHasProtocol: input.baseBranchHasProtocol,
    effectiveProfile: classification.effectiveProfile,
  });
  if (bootstrap.applies) {
    notes.push(bootstrap.summary);
  }

  const state = computePrReviewState({
    pr: input.pr,
    comments: input.comments,
    contract,
    classification,
    protocolDocument,
    profileDocument,
    bootstrap,
  });

  // 6. Stage-specific requirements.
  const needsAuthorization =
    profileRequiresAuthorization(classification.effectiveProfile) ||
    contract.authorizationRequestedByContract;

  if (needsAuthorization && !state.authorizationSatisfied) {
    if (bootstrap.applies) {
      notes.push(
        'Contract authorization is waived by the bootstrap exception for this PR only. This is not an authorization and not an approval.',
      );
    } else {
      failures.push(
        `Contract authorization is required before substantive implementation for effective profile ${classification.effectiveProfile}: ${state.authorizationDetail}.`,
      );
    }
  }
  if (!needsAuthorization) {
    notes.push(
      `Pre-implementation authorization is not required at profile ${classification.effectiveProfile}; implementation review is still required before merge.`,
    );
  }

  if (input.stage === 'merge-readiness') {
    const readiness = mergeReadiness(state);
    if (!readiness.ready) {
      failures.push(...readiness.blockers);
    }
  } else {
    notes.push(
      'In-progress push: no implementation-review checkpoint is required at this stage.',
    );
    failures.push(...state.problems);
  }

  // Malformed checkpoints never downgrade to "absent".
  let checkpointDiscovery: ReturnType<typeof findCheckpointComments>;
  try {
    checkpointDiscovery = findCheckpointComments(input.comments, 'production');
  } catch (error) {
    failures.push(
      `Checkpoint comments are unreadable: ${(error as Error).message}`,
    );
    checkpointDiscovery = {
      superseded: [],
      malformed: [],
    };
  }
  for (const entry of checkpointDiscovery.malformed) {
    failures.push(
      `Malformed checkpoint comment ${entry.comment.url}: ${entry.error}`,
    );
  }

  const unique = [...new Set(failures)];
  return {
    ok: unique.length === 0,
    state: state.state,
    effectiveProfile: classification.effectiveProfile,
    bootstrap,
    failures: unique,
    notes,
    lines: [
      `bead        ${contract.beadId}`,
      `pr          #${input.pr.number}  head ${input.pr.headSha.slice(0, 12)}  stage ${input.stage}`,
      `profile     declared=${classification.declaredProfile}  minimum=${classification.minimumProfile}  effective=${classification.effectiveProfile}`,
      `state       ${state.state}`,
      `auth        ${state.authorizationRequired ? 'required' : 'optional'} — ${state.authorizationDetail}`,
      `impl        ${state.implementationDetail}`,
      `profile doc ${profileDocPath(classification.effectiveProfile)}`,
      ...(isAtLeast(classification.effectiveProfile, 'semantic-system')
        ? [
            `protocol    ${PROTOCOL_DOC_PATH} (${protocolDocument.hash.slice(0, 12)})`,
          ]
        : []),
    ],
  };
}

function fail(failures: string[], notes: string[]): CiGateResult {
  return {
    ok: false,
    state: 'authorization-pending',
    failures: [...new Set(failures)],
    notes,
    lines: [],
  };
}
