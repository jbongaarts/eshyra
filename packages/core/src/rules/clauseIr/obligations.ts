import type { ObligationId, SourceObligationRecord } from './types.js';

/**
 * The per-clause evaluator consumes obligations from an independently owned
 * source. This boundary deliberately has no constructor or validator: source
 * census, evidence authority, identity uniqueness, and aggregate closure are
 * owned by the obligation-authority and scope beads.
 */
export interface ObligationSource {
  readonly get: (
    obligationId: ObligationId,
  ) => SourceObligationRecord | undefined;
}
