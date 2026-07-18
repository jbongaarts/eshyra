import type { RulesLookupHit } from '../rules/lookup.js';
import {
  parseSpellUpcastSpec,
  SpellUpcastContractError,
  type SpellUpcastSourceCorrection,
  spellUpcastOperationId,
  spellUpcastThresholdAxisKey,
  type UpcastChoice,
  type UpcastSubject,
  type UpcastThresholdValue,
} from '../rules/spellUpcastContract.js';
import type { RulesStackRecordSource } from '../rules/stack.js';
import type { RulesPackMeta, RulesRecord } from '../rules/types.js';
import { parseDice } from './dice.js';

export interface SpellUpcastAdjustment {
  readonly kind:
    | 'dice'
    | 'flat'
    | 'count'
    | 'threshold'
    | 'slot-value'
    | 'summoning';
  readonly subject:
    | UpcastSubject
    | { readonly kind: 'summoning'; readonly semanticId: string };
  readonly addedDice?: string;
  readonly amount?: number;
  readonly value?: UpcastThresholdValue;
  readonly summoningValue?: string;
  readonly threshold?: number;
  readonly scalingKind?: string;
  readonly multiplier?: number;
  readonly appliesTo?:
    | 'creation-menu-counts'
    | 'creation-candidate'
    | readonly ('creation' | 'control-reassertion')[];
  readonly selection?: 'choose-one';
  readonly choices?: readonly Record<string, unknown>[];
  readonly choice?: UpcastChoice;
  readonly sourceOperationId: string;
}

export type SpellUpcastRecordSource = Pick<
  RulesLookupHit,
  'record' | 'pack' | 'overrideChain'
>;

export interface SpellUpcastOverrideSourceBinding {
  readonly packId: string;
  readonly packVersion: string;
  readonly recordKey: string;
  readonly sourceRef: string;
  readonly locator?: string;
}

export interface SpellUpcastSourceBinding {
  readonly clauseId: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly sourceRef: string;
  readonly locator: string;
  readonly sourcePage: number;
  /** Reviewed text actually used to derive the returned operations. */
  readonly sourcePhrase: string;
  readonly sourceCorrection?: SpellUpcastSourceCorrection;
  readonly operationIds: readonly string[];
  readonly overrideChain: readonly SpellUpcastOverrideSourceBinding[];
}

export interface SpellUpcastResolution {
  readonly spellRef: string;
  readonly spellName: string;
  readonly baseSpellLevel: number;
  readonly selectedSlotLevel: number;
  readonly levelsAboveBase: number;
  readonly hasHigherSlotBenefit: boolean;
  readonly clauseIds: readonly string[];
  readonly sourceBindings: readonly SpellUpcastSourceBinding[];
  readonly adjustments: readonly SpellUpcastAdjustment[];
  readonly qualifier?: string;
}

class SpellUpcastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpellUpcastError';
  }
}

type Obj = Record<string, unknown>;
function obj(value: unknown): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SpellUpcastError('malformed spell upcast payload');
  }
  return value as Obj;
}
function integer(value: unknown, label: string, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    throw new SpellUpcastError(`${label} must be a safe integer >= ${min}`);
  }
  return value as number;
}
function finiteProduct(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value))
    throw new SpellUpcastError('upcast arithmetic overflow');
  return value;
}

function owningSourceRef(record: RulesRecord, pack: RulesPackMeta): string {
  const refs = [pack.source.sourceUrl, pack.source.sourceIdentity].filter(
    (ref): ref is string => ref !== undefined,
  );
  if (refs.length !== 1 || record.provenance.sourceRef !== refs[0]) {
    throw new SpellUpcastError(
      `spell ${record.key} provenance does not match owning pack ${pack.packId}@${pack.version}`,
    );
  }
  return refs[0];
}

function overrideSourceBinding(
  source: RulesStackRecordSource,
): SpellUpcastOverrideSourceBinding {
  return {
    packId: source.pack.meta.packId,
    packVersion: source.pack.meta.version,
    recordKey: source.record.key,
    sourceRef: owningSourceRef(source.record, source.pack.meta),
    ...(source.record.provenance.locator === undefined
      ? {}
      : { locator: source.record.provenance.locator }),
  };
}

function thresholdAxisKey(adjustment: SpellUpcastAdjustment): string {
  const semanticId = obj(adjustment.subject).semanticId;
  if (typeof semanticId !== 'string') {
    throw new SpellUpcastError('threshold subject requires a semantic id');
  }
  return spellUpcastThresholdAxisKey({ semanticId }, adjustment.choice);
}

function s1AppliesTo(
  value: unknown,
): NonNullable<SpellUpcastAdjustment['appliesTo']> {
  if (value === 'creation-menu-counts' || value === 'creation-candidate')
    return value;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) => entry === 'creation' || entry === 'control-reassertion',
    )
  )
    return [...value] as readonly ('creation' | 'control-reassertion')[];
  throw new SpellUpcastError('malformed S1 scaling application scope');
}

function resolveS1Scaling(
  scaling: Obj,
  slotLevel: number,
): SpellUpcastAdjustment | undefined {
  const kind = scaling.kind;
  const appliesTo = s1AppliesTo(scaling.appliesTo);
  if (kind === 'slot-multipliers') {
    const multipliers = obj(scaling.multipliers);
    const applicable = Object.keys(multipliers)
      .map(Number)
      .filter((level) => Number.isInteger(level) && level <= slotLevel)
      .sort((left, right) => right - left)[0];
    if (applicable === undefined) return undefined;
    const multiplier = integer(
      multipliers[String(applicable)],
      'S1 slot multiplier',
      1,
    );
    return {
      kind: 'summoning',
      subject: { kind: 'summoning', semanticId: 'creation-menu-counts' },
      sourceOperationId: 's1:creation-menu-counts:slot-multipliers',
      scalingKind: kind,
      appliesTo,
      threshold: applicable,
      multiplier,
    };
  }
  if (kind === 'per-slot-cardinality') {
    const baseSlotLevel = integer(
      scaling.baseSlotLevel,
      'S1 base slot level',
      1,
    );
    const additional = integer(scaling.additional, 'S1 cardinality', 1);
    if (slotLevel <= baseSlotLevel) return undefined;
    return {
      kind: 'summoning',
      subject: { kind: 'summoning', semanticId: 'summoning-cardinality' },
      sourceOperationId: `s1:summoning-cardinality:per-slot-cardinality:base-${baseSlotLevel}`,
      scalingKind: kind,
      appliesTo,
      amount: finiteProduct(additional, slotLevel - baseSlotLevel),
    };
  }
  if (kind === 'challenge-cap-at-slot') {
    const threshold = integer(scaling.slotLevel, 'S1 challenge threshold', 1);
    if (slotLevel < threshold || typeof scaling.maximumChallenge !== 'string')
      return undefined;
    return {
      kind: 'summoning',
      subject: { kind: 'summoning', semanticId: 'summoning-challenge-cap' },
      sourceOperationId: `s1:summoning-challenge-cap:challenge-cap-at-slot:${threshold}`,
      scalingKind: kind,
      appliesTo,
      threshold,
      summoningValue: scaling.maximumChallenge,
    };
  }
  if (kind === 'challenge-cap-per-slot') {
    const baseSlotLevel = integer(
      scaling.baseSlotLevel,
      'S1 base challenge slot level',
      1,
    );
    const increase = integer(scaling.increase, 'S1 challenge increase', 1);
    if (slotLevel <= baseSlotLevel) return undefined;
    return {
      kind: 'summoning',
      subject: { kind: 'summoning', semanticId: 'summoning-challenge-cap' },
      sourceOperationId: `s1:summoning-challenge-cap:challenge-cap-per-slot:base-${baseSlotLevel}`,
      scalingKind: kind,
      appliesTo,
      amount: finiteProduct(increase, slotLevel - baseSlotLevel),
    };
  }
  if (kind === 'slot-option-menu') {
    const options = scaling.options;
    if (!Array.isArray(options))
      throw new SpellUpcastError('malformed S1 option menu');
    const applicable = options
      .map((option) => obj(option))
      .filter(
        (option) =>
          integer(option.slotLevel, 'S1 option threshold', 1) <= slotLevel,
      )
      .sort(
        (left, right) => Number(right.slotLevel) - Number(left.slotLevel),
      )[0];
    if (applicable === undefined) return undefined;
    if (!Array.isArray(applicable.choices))
      throw new SpellUpcastError('malformed S1 option choices');
    if (scaling.selection !== 'choose-one')
      throw new SpellUpcastError('malformed S1 option selection');
    const choices = applicable.choices.map((choice) => obj(choice));
    return {
      kind: 'summoning',
      subject: { kind: 'summoning', semanticId: 'summoning-option-menu' },
      sourceOperationId: 's1:summoning-option-menu:slot-option-menu',
      scalingKind: kind,
      appliesTo,
      selection: 'choose-one',
      threshold: integer(applicable.slotLevel, 'S1 option threshold', 1),
      choices,
    };
  }
  throw new SpellUpcastError(`unsupported S1 scaling kind ${String(kind)}`);
}

/** Resolve only the source-bound, closed spell transform. It never rolls or mutates state. */
export function resolveSpellUpcast(
  source: SpellUpcastRecordSource,
  slotLevel: number,
): SpellUpcastResolution {
  const { record } = source;
  if (record.kind !== 'spell')
    throw new SpellUpcastError('upcast input must be a spell record');
  const data = obj(record.data);
  const base = integer(data.level, 'spell level');
  if (base === 0) throw new SpellUpcastError('cantrips do not use spell slots');
  if (!Number.isInteger(slotLevel) || slotLevel < 1 || slotLevel > 9) {
    throw new SpellUpcastError(
      'slot level must be an integer from 1 through 9',
    );
  }
  if (slotLevel < base)
    throw new SpellUpcastError(
      `slot level ${slotLevel} is below spell level ${base}`,
    );
  const ref = record.key;
  const name = record.name;
  const result: SpellUpcastResolution = {
    spellRef: ref,
    spellName: name,
    baseSpellLevel: base,
    selectedSlotLevel: slotLevel,
    levelsAboveBase: slotLevel - base,
    hasHigherSlotBenefit: false,
    clauseIds: [],
    sourceBindings: [],
    adjustments: [],
  };
  let upcast: ReturnType<typeof parseSpellUpcastSpec>;
  try {
    upcast = parseSpellUpcastSpec({
      recordKey: record.key,
      data: record.data,
      ...(record.provenance.locator === undefined
        ? {}
        : { provenanceLocator: record.provenance.locator }),
    });
  } catch (error) {
    if (error instanceof SpellUpcastContractError) {
      throw new SpellUpcastError(error.message);
    }
    throw error;
  }
  if (upcast === undefined) return result;
  const sourceRef = owningSourceRef(record, source.pack);
  const locator = record.provenance.locator;
  if (locator === undefined) {
    throw new SpellUpcastError(
      `spell ${record.key} requires a structured provenance locator`,
    );
  }
  const adjustments: SpellUpcastAdjustment[] = [];
  upcast.operations.forEach((operation) => {
    const kind = operation.kind;
    const subject = operation.subject;
    const sourceOperationId = spellUpcastOperationId(operation);
    if (kind === 'selected-slot-value') {
      if (slotLevel >= operation.minSlotLevel)
        adjustments.push({
          kind: 'slot-value',
          subject,
          amount: slotLevel,
          sourceOperationId,
          ...(operation.choice === undefined
            ? {}
            : { choice: operation.choice }),
        });
      return;
    }
    if (kind === 'threshold') {
      if (slotLevel >= operation.atSlotLevel)
        adjustments.push({
          kind: 'threshold',
          subject,
          threshold: operation.atSlotLevel,
          value: operation.value,
          sourceOperationId,
          ...(operation.choice === undefined
            ? {}
            : { choice: operation.choice }),
        });
      return;
    }
    // The source phrase says "above N": the first benefit is at N+1.
    const steps =
      slotLevel <= operation.startSlotLevel
        ? 0
        : Math.floor(
            (slotLevel - operation.startSlotLevel) / operation.everySlotLevels,
          );
    if (steps === 0) return;
    if (kind === 'dice-per-slot') {
      const parsed = parseDice(operation.dice);
      const count = finiteProduct(parsed.count, steps);
      const notation = `${count}d${parsed.faces}`;
      adjustments.push({
        kind: 'dice',
        subject,
        addedDice: notation,
        sourceOperationId,
        ...(operation.choice === undefined ? {} : { choice: operation.choice }),
      });
    } else {
      const unit =
        kind === 'flat-per-slot' ? operation.amount : operation.count;
      adjustments.push({
        kind: kind === 'flat-per-slot' ? 'flat' : 'count',
        subject,
        amount: finiteProduct(unit, steps),
        sourceOperationId,
        ...(operation.choice === undefined ? {} : { choice: operation.choice }),
      });
    }
  });
  if (upcast.disposition === 'existing-s1-typed-scaling') {
    if (
      typeof data.mechanics !== 'object' ||
      data.mechanics === null ||
      Array.isArray(data.mechanics)
    ) {
      throw new SpellUpcastError(
        'S1 upcast disposition requires mechanics effects',
      );
    }
    const effects = obj(data.mechanics).effects;
    if (!Array.isArray(effects) || effects.length === 0) {
      throw new SpellUpcastError(
        'S1 upcast disposition requires mechanics effects',
      );
    }
    let scalingCount = 0;
    for (const effect of effects) {
      const e = obj(effect);
      if (Array.isArray(e.scaling)) {
        if (e.kind !== 'summoning' || e.scaling.length === 0) {
          throw new SpellUpcastError('malformed S1 summoning scaling');
        }
        for (const scaling of e.scaling) {
          scalingCount += 1;
          const resolved = resolveS1Scaling(obj(scaling), slotLevel);
          if (resolved !== undefined) adjustments.push(resolved);
        }
      }
    }
    if (scalingCount === 0) {
      throw new SpellUpcastError(
        'S1 upcast disposition has no usable summoning scaling',
      );
    }
  }
  const winningThreshold = new Map<string, number>();
  for (const adjustment of adjustments) {
    if (adjustment.kind === 'threshold' && adjustment.threshold !== undefined) {
      const key = thresholdAxisKey(adjustment);
      winningThreshold.set(
        key,
        Math.max(winningThreshold.get(key) ?? 0, adjustment.threshold),
      );
    }
  }
  const resolvedAdjustments = adjustments.filter(
    (adjustment) =>
      adjustment.kind !== 'threshold' ||
      adjustment.threshold ===
        winningThreshold.get(thresholdAxisKey(adjustment)),
  );
  const applicableQualifier: string | undefined =
    upcast.qualifier !== undefined && slotLevel >= upcast.qualifier.minSlotLevel
      ? upcast.qualifier.text
      : undefined;
  return {
    ...result,
    hasHigherSlotBenefit:
      resolvedAdjustments.length > 0 || applicableQualifier !== undefined,
    clauseIds: [upcast.clauseId],
    sourceBindings: [
      {
        clauseId: upcast.clauseId,
        packId: source.pack.packId,
        packVersion: source.pack.version,
        sourceRef,
        locator,
        sourcePage: upcast.sourcePage,
        sourcePhrase:
          upcast.sourceCorrection?.reviewedSourcePhrase ?? upcast.sourcePhrase,
        ...(upcast.sourceCorrection === undefined
          ? {}
          : { sourceCorrection: upcast.sourceCorrection }),
        operationIds: resolvedAdjustments.map(
          (adjustment) => adjustment.sourceOperationId,
        ),
        overrideChain: source.overrideChain.map(overrideSourceBinding),
      },
    ],
    adjustments: resolvedAdjustments,
    ...(applicableQualifier === undefined
      ? {}
      : { qualifier: applicableQualifier }),
  };
}

export { SpellUpcastError };
