import type { RulesRecord } from '../rules/types.js';
import { parseDice } from './dice.js';

export interface SpellUpcastAdjustment {
  readonly kind: 'dice' | 'flat' | 'count' | 'threshold' | 'summoning';
  readonly subject: unknown;
  readonly addedDice?: string;
  readonly amount?: number;
  readonly value?: string;
  readonly threshold?: number;
  readonly sourceOperation: number | 's1';
}

export interface SpellUpcastResolution {
  readonly spellRef: string;
  readonly spellName: string;
  readonly baseSpellLevel: number;
  readonly selectedSlotLevel: number;
  readonly levelsAboveBase: number;
  readonly hasHigherSlotBenefit: boolean;
  readonly clauseIds: readonly string[];
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

/** Resolve only the source-bound, closed spell transform. It never rolls or mutates state. */
export function resolveSpellUpcast(
  record: RulesRecord,
  slotLevel: number,
): SpellUpcastResolution {
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
  const upcast = data.upcast === undefined ? undefined : obj(data.upcast);
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
    adjustments: [],
  };
  if (upcast === undefined) return result;
  if (
    data.scalingSourceKind !== undefined &&
    data.scalingSourceKind !== 'higher-slot'
  ) {
    throw new SpellUpcastError(
      'character-level scaling cannot be used as slot upcast data',
    );
  }
  if (
    upcast.sourceKind !== 'higher-slot' ||
    typeof upcast.clauseId !== 'string' ||
    typeof upcast.sourcePhrase !== 'string'
  ) {
    throw new SpellUpcastError(
      'malformed or unsupported upcast source binding',
    );
  }
  const rawHigher = data.higherLevels;
  if (typeof rawHigher !== 'string' || rawHigher !== upcast.sourcePhrase) {
    throw new SpellUpcastError(
      'upcast source phrase drifted from higherLevels',
    );
  }
  const page = /p\.\s*(\d+)/i.exec(record.source)?.[1];
  if (
    page !== undefined &&
    integer(upcast.sourcePage, 'upcast source page', 1) !== Number(page)
  ) {
    throw new SpellUpcastError(
      'upcast source page drifted from record provenance',
    );
  }
  if (!Array.isArray(upcast.operations))
    throw new SpellUpcastError('upcast operations must be an array');
  const seen = new Set<string>();
  const adjustments: SpellUpcastAdjustment[] = [];
  upcast.operations.forEach((raw, index) => {
    const operation = obj(raw);
    const key = JSON.stringify(operation);
    if (seen.has(key))
      throw new SpellUpcastError(`duplicate upcast operation ${index}`);
    seen.add(key);
    const kind = operation.kind;
    const subject = operation.subject;
    if (
      ![
        'dice-per-slot',
        'flat-per-slot',
        'count-per-slot',
        'threshold',
      ].includes(String(kind))
    ) {
      throw new SpellUpcastError(`unsupported upcast operation ${index}`);
    }
    if (
      typeof subject !== 'object' ||
      subject === null ||
      Array.isArray(subject)
    ) {
      throw new SpellUpcastError(`operation ${index} has no semantic subject`);
    }
    if (kind === 'threshold') {
      const threshold = integer(
        operation.atSlotLevel,
        `operation ${index} threshold`,
        1,
      );
      if (
        threshold > 9 ||
        typeof operation.value !== 'string' ||
        operation.value.length === 0
      ) {
        throw new SpellUpcastError(`invalid threshold operation ${index}`);
      }
      if (slotLevel >= threshold)
        adjustments.push({
          kind: 'threshold',
          subject,
          threshold,
          value: operation.value,
          sourceOperation: index,
        });
      return;
    }
    const start = integer(
      operation.startSlotLevel,
      `operation ${index} start`,
      1,
    );
    const every = integer(
      operation.everySlotLevels,
      `operation ${index} interval`,
      1,
    );
    if (start > 9 || every > 9)
      throw new SpellUpcastError(`unreachable operation ${index}`);
    // The source phrase says "above N": the first benefit is at N+1.
    const steps =
      slotLevel <= start ? 0 : Math.floor((slotLevel - start) / every);
    if (steps === 0) return;
    if (kind === 'dice-per-slot') {
      if (typeof operation.dice !== 'string')
        throw new SpellUpcastError(`operation ${index} has no dice`);
      const parsed = parseDice(operation.dice);
      const count = finiteProduct(parsed.count, steps);
      const notation = `${count}d${parsed.faces}`;
      adjustments.push({
        kind: 'dice',
        subject,
        addedDice: notation,
        sourceOperation: index,
      });
    } else {
      const unit = integer(
        kind === 'flat-per-slot' ? operation.amount : operation.count,
        `operation ${index} amount`,
        1,
      );
      adjustments.push({
        kind: kind === 'flat-per-slot' ? 'flat' : 'count',
        subject,
        amount: finiteProduct(unit, steps),
        sourceOperation: index,
      });
    }
  });
  const s1 = obj(data.mechanics).effects;
  if (upcast.disposition === 'existing-s1-typed-scaling' && Array.isArray(s1)) {
    for (const effect of s1) {
      const e = obj(effect);
      if (Array.isArray(e.scaling))
        adjustments.push({
          kind: 'summoning',
          subject: e.kind,
          sourceOperation: 's1',
          value: JSON.stringify(e.scaling),
        });
    }
  }
  const winningThreshold = new Map<string, number>();
  for (const adjustment of adjustments) {
    if (adjustment.kind === 'threshold' && adjustment.threshold !== undefined) {
      const key = JSON.stringify(adjustment.subject);
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
        winningThreshold.get(JSON.stringify(adjustment.subject)),
  );
  return {
    ...result,
    hasHigherSlotBenefit:
      resolvedAdjustments.length > 0 || typeof upcast.qualifier === 'string',
    clauseIds: [upcast.clauseId],
    adjustments: resolvedAdjustments,
    ...(typeof upcast.qualifier === 'string'
      ? { qualifier: upcast.qualifier }
      : {}),
  };
}

export { SpellUpcastError };
