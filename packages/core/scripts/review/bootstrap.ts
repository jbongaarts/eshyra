/**
 * The one-time process-bootstrap exception.
 *
 * This review system cannot depend on infrastructure that does not yet exist.
 * The PR that introduces `eshyra-review-v2` cannot carry a
 * contract-authorization checkpoint, because on its base branch there is no
 * protocol to authorize against and no command able to publish one.
 *
 * The exception is bounded by three independent conditions, ALL of which must
 * hold. It waives exactly one requirement — the pre-existing
 * contract-authorization checkpoint — and nothing else: the contract must
 * still parse, classify, and satisfy every `semantic-system` requirement, and
 * the PR still receives a manual full review before merge.
 *
 * After merge, condition 2 fails permanently and cannot be restored without
 * deleting the protocol document from `main`, which would itself be a
 * reviewed change. There is deliberately NO path-based exemption for review
 * system files: "the file is under docs/review" must never be a reason to skip
 * review.
 */

import { PROTOCOL_DOC_PATH, type ReviewProfile } from './profiles.js';

/** The exact bead this exception may ever apply to. */
export const BOOTSTRAP_BEAD_ID = 'eshyra-o9bd.19.1.17';

export interface BootstrapContext {
  readonly beadId: string;
  readonly prHeadRefName: string;
  /** Whether the protocol document already exists on the PR's base branch. */
  readonly baseBranchHasProtocol: boolean;
  readonly effectiveProfile: ReviewProfile;
}

export interface BootstrapDecision {
  readonly applies: boolean;
  /** Every condition and whether it held, for visible CI output. */
  readonly conditions: readonly {
    readonly condition: string;
    readonly held: boolean;
  }[];
  readonly summary: string;
}

export function evaluateBootstrapException(
  context: BootstrapContext,
): BootstrapDecision {
  const conditions = [
    {
      condition: `owning bead is exactly ${BOOTSTRAP_BEAD_ID}`,
      held: context.beadId === BOOTSTRAP_BEAD_ID,
    },
    {
      condition: `base branch lacks ${PROTOCOL_DOC_PATH}`,
      held: !context.baseBranchHasProtocol,
    },
    {
      condition: `PR head branch is exactly ${BOOTSTRAP_BEAD_ID}`,
      held: context.prHeadRefName === BOOTSTRAP_BEAD_ID,
    },
  ];
  const applies = conditions.every((entry) => entry.held);
  return {
    applies,
    conditions,
    summary: applies
      ? `BOOTSTRAP EXCEPTION ACTIVE — the pre-implementation contract-authorization checkpoint requirement is waived for this one process-bootstrap PR. This is NOT an authorization and NOT an approval: ${context.effectiveProfile} review is still required manually before merge, and this exception becomes structurally inapplicable once ${PROTOCOL_DOC_PATH} exists on the base branch.`
      : `Bootstrap exception does not apply: ${conditions
          .filter((entry) => !entry.held)
          .map((entry) => `not (${entry.condition})`)
          .join('; ')}.`,
  };
}
