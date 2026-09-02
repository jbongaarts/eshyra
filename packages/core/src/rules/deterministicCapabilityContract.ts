/**
 * ADR 0020 §3's positive, bounded deterministic-capability declaration.
 *
 * A declaration describes Eshyra's selected operation only. It is never an
 * assertion that a source record is complete, or that an unbound operation is
 * mechanically irrelevant.
 */
export interface DeterministicCapabilityContract {
  /** Stable capability identity, including its revision. */
  readonly revision: string;
  /** The narrow, deterministic operation Eshyra performs. */
  readonly operation: string;
  /** Inputs that must be recognized and validated before it runs. */
  readonly requiredInputs: readonly string[];
  /** Semantics intentionally outside this deterministic operation. */
  readonly exclusions: readonly string[];
  /** Rulings that remain with the primary DM model. */
  readonly residualDmInterpretation: readonly string[];
}
