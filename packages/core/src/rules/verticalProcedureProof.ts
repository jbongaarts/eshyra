import { isDeepStrictEqual } from 'node:util';
import {
  type BoundedProcedure,
  BoundedProcedureError,
  readBoundedProcedures,
} from './boundedProcedures.js';
import type { RulesRecord, RulesRecordKind } from './types.js';

export type Foundation1Facet =
  | 'save'
  | 'damage'
  | 'repeat-timing'
  | 'termination'
  | 'mode-selector'
  | 'choice-cardinality'
  | 'duplicate-selection'
  | 'option-effect'
  | 'resource-pool'
  | 'resource-maximum'
  | 'resource-reset'
  | 'create-slot-action'
  | 'create-slot-limit'
  | 'create-slot-costs'
  | 'created-slot-expiry'
  | 'convert-slot-action'
  | 'conversion-value'
  | 'adjudication-boundary'
  | 'stress-trigger'
  | 'recurring-damage'
  | 'strength-effect'
  | 'recovery-procedure'
  | 'probabilistic-transition';

export interface Foundation1SourceSpan {
  readonly sourceRef: string;
  readonly sourceHash: string;
  readonly page: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly spanHash: string;
}

export interface Foundation1Obligation {
  readonly id: string;
  readonly procedureId: string;
  readonly ordinal: number;
  readonly owner: {
    readonly kind: RulesRecordKind;
    readonly sourceHeading: string;
    readonly sourcePage: number;
  };
  readonly derivedFrom: readonly Foundation1SourceSpan[];
  readonly facet: Foundation1Facet;
  readonly localityPointer: string;
  readonly expected: unknown;
}

export interface Foundation1ProjectedAtom {
  readonly id: string;
  readonly recordKey: string;
  readonly pointer: string;
  readonly semanticPointer: string;
  readonly facet: Foundation1Facet;
  readonly value: unknown;
}

export type Foundation1ProofFailureCode =
  | 'EMPTY_OBLIGATION_SET'
  | 'DUPLICATE_OBLIGATION_ID'
  | 'OWNER_NOT_UNIQUE'
  | 'MALFORMED_PROJECTION'
  | 'MISSING_FACET'
  | 'MULTIPLICITY_CONFLICT';

export interface Foundation1ProofFailure {
  readonly code: Foundation1ProofFailureCode;
  readonly obligationId?: string;
  readonly detail: string;
}

export interface Foundation1Discharge {
  readonly obligationId: string;
  readonly atomId: string;
  readonly recordKey: string;
  readonly pointer: string;
}

export interface Foundation1ProofReport {
  readonly ok: boolean;
  readonly discharges: readonly Foundation1Discharge[];
  readonly failures: readonly Foundation1ProofFailure[];
}

function atom(
  record: RulesRecord,
  pointer: string,
  semanticPointer: string,
  facet: Foundation1Facet,
  value: unknown,
): Foundation1ProjectedAtom {
  return {
    id: `atom/${record.key}${semanticPointer}`,
    recordKey: record.key,
    pointer,
    semanticPointer,
    facet,
    value,
  };
}

function atomsForProcedure(
  record: RulesRecord,
  data: Record<string, unknown>,
  procedure: BoundedProcedure,
  index: number,
): readonly Foundation1ProjectedAtom[] {
  const base = `/data/mechanics/procedures/${index}`;
  const semanticBase = `/procedure/${procedure.id}`;
  if (procedure.kind === 'repeat-save-hazard') {
    return [
      atom(
        record,
        `${base}/initial/save`,
        `${semanticBase}/initial/save`,
        'save',
        procedure.initial.save,
      ),
      atom(
        record,
        `${base}/initial/failureDamage`,
        `${semanticBase}/initial/failureDamage`,
        'damage',
        procedure.initial.failureDamage,
      ),
      atom(
        record,
        `${base}/repeat/timing`,
        `${semanticBase}/repeat/timing`,
        'repeat-timing',
        procedure.repeat.timing,
      ),
      atom(
        record,
        `${base}/repeat/save`,
        `${semanticBase}/repeat/save`,
        'save',
        procedure.repeat.save,
      ),
      atom(
        record,
        `${base}/repeat/failureDamage`,
        `${semanticBase}/repeat/failureDamage`,
        'damage',
        procedure.repeat.failureDamage,
      ),
      atom(
        record,
        `${base}/termination`,
        `${semanticBase}/termination`,
        'termination',
        procedure.termination,
      ),
    ];
  }
  if (procedure.kind === 'weapon-damage-modes') {
    return [
      atom(
        record,
        `${base}/selector`,
        `${semanticBase}/selector`,
        'mode-selector',
        procedure.selector,
      ),
      ...procedure.modes.map((mode, modeIndex) =>
        atom(
          record,
          `${base}/modes/${modeIndex}`,
          `${semanticBase}/mode/${mode.id}`,
          'damage',
          { id: mode.id, hands: mode.hands, damage: mode.damage },
        ),
      ),
    ];
  }
  if (procedure.kind === 'feature-options') {
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const matchingChoices = choices.flatMap((value, choiceIndex) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [];
      }
      const choice = value as Record<string, unknown>;
      return choice.id === procedure.choiceId ? [{ choice, choiceIndex }] : [];
    });
    if (matchingChoices.length !== 1) {
      throw new BoundedProcedureError(
        `record.data must contain exactly one choice matching feature procedure choiceId ${JSON.stringify(procedure.choiceId)}`,
      );
    }
    const [{ choice, choiceIndex }] = matchingChoices;
    if (!Number.isInteger(choice.choose)) {
      throw new BoundedProcedureError(
        `record.data.choices[${choiceIndex}].choose must be an integer`,
      );
    }
    return [
      atom(
        record,
        `/data/choices/${choiceIndex}`,
        `${semanticBase}/choice/${procedure.choiceId}`,
        'choice-cardinality',
        {
          choiceId: choice.id,
          choose: choice.choose,
          procedureChoiceId: procedure.choiceId,
        },
      ),
      atom(
        record,
        `${base}/duplicateSelection`,
        `${semanticBase}/duplicateSelection`,
        'duplicate-selection',
        procedure.duplicateSelection,
      ),
      ...procedure.options.map((option, optionIndex) =>
        atom(
          record,
          `${base}/options/${optionIndex}`,
          `${semanticBase}/option/${option.id}`,
          'option-effect',
          { id: option.id, effect: option.effect },
        ),
      ),
    ];
  }
  if (procedure.kind === 'resource-conversion') {
    return [
      atom(record, `${base}/pool`, `${semanticBase}/pool`, 'resource-pool', {
        id: procedure.pool.id,
        name: procedure.pool.name,
      }),
      atom(
        record,
        `${base}/pool/maximumByLevel`,
        `${semanticBase}/pool/maximumByLevel`,
        'resource-maximum',
        procedure.pool.maximumByLevel,
      ),
      atom(
        record,
        `${base}/pool/reset`,
        `${semanticBase}/pool/reset`,
        'resource-reset',
        procedure.pool.reset,
      ),
      atom(
        record,
        `${base}/operations/createSpellSlot/actionCost`,
        `${semanticBase}/operations/createSpellSlot/actionCost`,
        'create-slot-action',
        procedure.operations.createSpellSlot.actionCost,
      ),
      atom(
        record,
        `${base}/operations/createSpellSlot/maximumSlotLevel`,
        `${semanticBase}/operations/createSpellSlot/maximumSlotLevel`,
        'create-slot-limit',
        procedure.operations.createSpellSlot.maximumSlotLevel,
      ),
      atom(
        record,
        `${base}/operations/createSpellSlot/costBySlotLevel`,
        `${semanticBase}/operations/createSpellSlot/costBySlotLevel`,
        'create-slot-costs',
        procedure.operations.createSpellSlot.costBySlotLevel,
      ),
      atom(
        record,
        `${base}/operations/createSpellSlot/createdSlotExpires`,
        `${semanticBase}/operations/createSpellSlot/createdSlotExpires`,
        'created-slot-expiry',
        procedure.operations.createSpellSlot.createdSlotExpires,
      ),
      atom(
        record,
        `${base}/operations/convertSpellSlot/actionCost`,
        `${semanticBase}/operations/convertSpellSlot/actionCost`,
        'convert-slot-action',
        procedure.operations.convertSpellSlot.actionCost,
      ),
      atom(
        record,
        `${base}/operations/convertSpellSlot/pointsGained`,
        `${semanticBase}/operations/convertSpellSlot/pointsGained`,
        'conversion-value',
        procedure.operations.convertSpellSlot.pointsGained,
      ),
    ];
  }
  return [
    atom(
      record,
      `${base}/adjudicationBoundary`,
      `${semanticBase}/adjudicationBoundary`,
      'adjudication-boundary',
      procedure.adjudicationBoundary,
    ),
    atom(
      record,
      `${base}/stress/trigger`,
      `${semanticBase}/stress/trigger`,
      'stress-trigger',
      procedure.stress.trigger,
    ),
    atom(
      record,
      `${base}/stress/recurringDamage`,
      `${semanticBase}/stress/recurringDamage`,
      'recurring-damage',
      procedure.stress.recurringDamage,
    ),
    atom(
      record,
      `${base}/stress/strength`,
      `${semanticBase}/stress/strength`,
      'strength-effect',
      procedure.stress.strength,
    ),
    atom(
      record,
      `${base}/stress/recovery`,
      `${semanticBase}/stress/recovery`,
      'recovery-procedure',
      procedure.stress.recovery,
    ),
    atom(
      record,
      `${base}/stress/wishLoss`,
      `${semanticBase}/stress/wishLoss`,
      'probabilistic-transition',
      procedure.stress.wishLoss,
    ),
  ];
}

/**
 * Enumerates only the reviewed evidence shapes in the five-procedure proof.
 * An unknown or malformed shape refuses the proof; an absent procedure yields
 * no atoms and therefore cannot be mistaken for satisfaction.
 */
export function enumerateFoundation1Atoms(
  record: RulesRecord,
): readonly Foundation1ProjectedAtom[] {
  const data = record.data as Record<string, unknown>;
  const mechanics = data.mechanics as Record<string, unknown> | undefined;
  if (mechanics?.procedures === undefined) return [];
  return readBoundedProcedures(record.data).flatMap((procedure, index) =>
    atomsForProcedure(record, data, procedure, index),
  );
}

function resolveOwner(
  records: readonly RulesRecord[],
  obligation: Foundation1Obligation,
): readonly RulesRecord[] {
  const sourceRefs = new Set(
    obligation.derivedFrom.map((span) => span.sourceRef),
  );
  return records.filter(
    (record) =>
      record.kind === obligation.owner.kind &&
      record.name === obligation.owner.sourceHeading &&
      sourceRefs.has(record.provenance.sourceRef) &&
      (record.provenance.locator?.match(/\d+/g)?.map(Number) ?? []).includes(
        obligation.owner.sourcePage,
      ),
  );
}

function isWithin(pointer: string, localityPointer: string): boolean {
  return (
    pointer === localityPointer || pointer.startsWith(`${localityPointer}/`)
  );
}

/** Maximum injective matching used by the bounded discharge evaluator. */
export function matchFoundation1Candidates(
  atomsByObligation: ReadonlyMap<string, readonly Foundation1ProjectedAtom[]>,
): ReadonlyMap<string, Foundation1ProjectedAtom> {
  const atomToObligation = new Map<string, string>();
  const obligationToAtom = new Map<string, Foundation1ProjectedAtom>();

  function augment(obligationId: string, visited: Set<string>): boolean {
    for (const candidate of atomsByObligation.get(obligationId) ?? []) {
      if (visited.has(candidate.id)) continue;
      visited.add(candidate.id);
      const displaced = atomToObligation.get(candidate.id);
      if (displaced === undefined || augment(displaced, visited)) {
        atomToObligation.set(candidate.id, obligationId);
        obligationToAtom.set(obligationId, candidate);
        return true;
      }
    }
    return false;
  }

  for (const obligationId of atomsByObligation.keys()) {
    augment(obligationId, new Set());
  }
  return obligationToAtom;
}

/**
 * Proves only the supplied bounded obligation set. It does not infer that
 * unenumerated records or unrecognized mechanics are complete or irrelevant.
 */
export function evaluateFoundation1Proof(
  records: readonly RulesRecord[],
  obligations: readonly Foundation1Obligation[],
): Foundation1ProofReport {
  if (obligations.length === 0) {
    return {
      ok: false,
      discharges: [],
      failures: [
        {
          code: 'EMPTY_OBLIGATION_SET',
          detail: 'the bounded proof cannot pass with no source obligations',
        },
      ],
    };
  }
  const failures: Foundation1ProofFailure[] = [];
  const ids = new Set<string>();
  for (const obligation of obligations) {
    if (ids.has(obligation.id)) {
      failures.push({
        code: 'DUPLICATE_OBLIGATION_ID',
        obligationId: obligation.id,
        detail: `obligation id ${obligation.id} occurs more than once`,
      });
    }
    ids.add(obligation.id);
  }

  const atomsByObligation = new Map<
    string,
    readonly Foundation1ProjectedAtom[]
  >();
  for (const obligation of obligations) {
    const owners = resolveOwner(records, obligation);
    if (owners.length !== 1) {
      failures.push({
        code: 'OWNER_NOT_UNIQUE',
        obligationId: obligation.id,
        detail: `expected one ${obligation.owner.kind} named ${JSON.stringify(obligation.owner.sourceHeading)}, found ${owners.length}`,
      });
      atomsByObligation.set(obligation.id, []);
      continue;
    }
    let atoms: readonly Foundation1ProjectedAtom[];
    try {
      atoms = enumerateFoundation1Atoms(owners[0]);
    } catch (error) {
      if (!(error instanceof BoundedProcedureError)) throw error;
      failures.push({
        code: 'MALFORMED_PROJECTION',
        obligationId: obligation.id,
        detail: error.message,
      });
      atomsByObligation.set(obligation.id, []);
      continue;
    }
    atomsByObligation.set(
      obligation.id,
      atoms.filter(
        (candidate) =>
          candidate.facet === obligation.facet &&
          isWithin(candidate.semanticPointer, obligation.localityPointer) &&
          isDeepStrictEqual(candidate.value, obligation.expected),
      ),
    );
  }

  const obligationToAtom = matchFoundation1Candidates(atomsByObligation);
  const byId = new Map(
    obligations.map((obligation) => [obligation.id, obligation]),
  );

  for (const obligation of obligations) {
    if (!obligationToAtom.has(obligation.id)) {
      const candidates = atomsByObligation.get(obligation.id) ?? [];
      failures.push({
        code:
          candidates.length === 0 ? 'MISSING_FACET' : 'MULTIPLICITY_CONFLICT',
        obligationId: obligation.id,
        detail:
          candidates.length === 0
            ? `no ${obligation.facet} atom matching the required value exists within ${obligation.localityPointer}`
            : `all matching ${obligation.facet} atoms are already required by distinct obligations`,
      });
    }
  }

  const discharges = [...obligationToAtom.entries()]
    .filter(([obligationId]) => byId.has(obligationId))
    .map(([obligationId, matchedAtom]) => ({
      obligationId,
      atomId: matchedAtom.id,
      recordKey: matchedAtom.recordKey,
      pointer: matchedAtom.pointer,
    }))
    .sort((left, right) => left.obligationId.localeCompare(right.obligationId));
  return {
    ok: failures.length === 0 && discharges.length === obligations.length,
    discharges,
    failures,
  };
}
