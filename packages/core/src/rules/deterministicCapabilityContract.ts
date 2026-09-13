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
  /** Provider-neutral operation or explicit callable entry point. */
  readonly operationId: string;
  /** The narrow, deterministic operation Eshyra performs. */
  readonly operation: string;
  /** Inputs that must be recognized and validated before it runs. */
  readonly requiredInputs: readonly string[];
  /** Semantics intentionally outside this deterministic operation. */
  readonly exclusions: readonly string[];
  /** Rulings that remain with the primary DM model. */
  readonly residualDmInterpretation: readonly string[];
}

/** Positive capability contract for the magic-item mutation preflight. */
export const MAGIC_ITEM_OPERATION_READINESS_CAPABILITY: DeterministicCapabilityContract =
  Object.freeze({
    revision: 'derived-magic-item-clauses-v1',
    operationId: 'assertMagicItemOperationReady',
    operation:
      'Preflight a selected magic-item operation before live state mutation.',
    requiredInputs: [
      'A magic-item RulesRecord carrying the trusted derived execution-readiness contract.',
      'The selected parent or canonical variant identity.',
      'A validated operation id and its bound economies, effects, state-machine, and spell-store inputs.',
    ],
    exclusions: [
      'Campaign rulings are contextual inputs and never discharge engine-pending readiness clauses.',
      'Does not execute the item operation or supply missing item semantics.',
      'Does not claim that every clause of the item record is implemented.',
      'Does not infer a capability from typed mechanics fields or an absent readiness binding.',
    ],
    residualDmInterpretation: [
      'Whether the player may attempt the operation and how source prose applies remain DM rulings.',
      'Any item semantics outside the positively bound operation remain with the DM or another explicit capability.',
    ],
  });
