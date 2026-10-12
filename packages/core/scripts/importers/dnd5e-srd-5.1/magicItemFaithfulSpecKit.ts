/**
 * Shared vocabulary for the reviewed faithful-or-absent operation tables
 * (eshyra-o9bd.19.4.6.1 and .6.2): patch shapes and clause builders.
 */
import type { MagicItemActivationSpec } from '../../../src/rules/magicItemMechanics.js';

export type ActivationCost = NonNullable<MagicItemActivationSpec['cost']>;

/** `null` removes the field; a string for requirement/trigger/target must be a
 * verbatim span of the item's printed description. */
export interface ActivationPatch {
  readonly cost?: ActivationCost | null;
  readonly commandWord?: true | null;
  readonly requirement?: string | null;
  readonly trigger?: string | null;
  readonly target?: string | null;
}

export interface OperationPatch {
  readonly operationId: string;
  readonly activation?: ActivationPatch;
  /** Remove the operation's economy `cost` (a charge committed only on an
   * outcome the cost vocabulary cannot state). Requires `activation` to name
   * the sentence in a clause. */
  readonly dropEconomyCost?: true;
}

export interface ContainmentPatch {
  readonly procedure: 'entry' | 'exit' | 'release';
  readonly activation: ActivationPatch;
}

export type AdjudicatedOwner =
  | { readonly operation: string }
  | {
      readonly block:
        | 'entityGrant'
        | 'containment'
        | 'stateMachine'
        | 'randomProcedure'
        | 'economies';
    };

export interface ActivationClause {
  readonly id: string;
  readonly owner: AdjudicatedOwner;
  readonly sourceText: string;
  readonly note?: string;
}

export interface FaithfulItemSpec {
  readonly operations?: readonly OperationPatch[];
  readonly containment?: readonly ContainmentPatch[];
  readonly clauses?: readonly ActivationClause[];
}

export const NOTE =
  'The typed activation fields state only the printed predicates they can carry exactly; the DM model interprets the rest of this printed activation sentence from the printed text.';
export const NO_COST_NOTE =
  'The printed text names no action cost for this use, so none is typed; the DM model interprets the printed sentence.';

export const clause = (
  id: string,
  owner: AdjudicatedOwner,
  sourceText: string,
  note: string = NOTE,
): ActivationClause => ({ id, owner, sourceText, note });

/** One clause per operation for a sentence that governs several operations. */
export const clausesFor = (
  prefix: string,
  operationIds: readonly string[],
  sourceText: string,
  note: string = NOTE,
): readonly ActivationClause[] =>
  operationIds.map((operation) =>
    clause(`${prefix}-${operation}`, { operation }, sourceText, note),
  );

export const op = (
  operationId: string,
  activation: ActivationPatch,
): OperationPatch => ({ operationId, activation });
