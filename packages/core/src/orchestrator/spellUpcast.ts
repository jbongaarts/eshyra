import type { RulesRecord } from '../rules/types.js';
import { parseDice } from './dice.js';

export interface SpellUpcastAdjustment {
  readonly kind:
    | 'dice'
    | 'flat'
    | 'count'
    | 'threshold'
    | 'slot-value'
    | 'summoning';
  readonly subject: unknown;
  readonly addedDice?: string;
  readonly amount?: number;
  readonly value?: string;
  readonly threshold?: number;
  readonly scalingKind?: string;
  readonly multiplier?: number;
  readonly appliesTo?:
    | 'creation-menu-counts'
    | 'creation-candidate'
    | readonly ('creation' | 'control-reassertion')[];
  readonly selection?: 'choose-one';
  readonly choices?: readonly Record<string, unknown>[];
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
  sourceOperation: 's1',
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
      sourceOperation,
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
      sourceOperation,
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
      sourceOperation,
      scalingKind: kind,
      appliesTo,
      threshold,
      value: scaling.maximumChallenge,
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
      sourceOperation,
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
      sourceOperation,
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
        'selected-slot-value',
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
    const subjectObject = subject as Obj;
    const subjectKind = subjectObject.kind;
    const subjectProperty = subjectObject.property;
    const allowedProperties: Record<string, readonly string[]> = {
      damage: ['damage-dice'],
      healing: ['healing-dice', 'healing-points'],
      'affected-hit-points': ['affected-hit-point-pool-dice'],
      effect: [
        'duration-hours',
        'hit-points',
        'target-count',
        'projectile-count',
        'creature-count',
        'object-count',
        'volume-gallons',
        'cube-size-feet',
        'spell-level-threshold',
        'duration',
        'radius-feet',
        'bonus',
        'memory-age',
        'temporary-hit-points',
        'other-quantity',
      ],
    };
    if (
      typeof subjectKind !== 'string' ||
      typeof subjectProperty !== 'string' ||
      !allowedProperties[subjectKind]?.includes(subjectProperty)
    ) {
      throw new SpellUpcastError(
        `operation ${index} has an unsupported semantic property`,
      );
    }
    if (subjectKind === 'damage') {
      const damageType = subjectObject.damageType;
      const damageTypes = subjectObject.damageTypes;
      if (
        damageType !== undefined &&
        (typeof damageType !== 'string' || damageType.length === 0)
      )
        throw new SpellUpcastError(
          `operation ${index} has invalid damage type`,
        );
      if (damageTypes !== undefined) {
        if (
          !Array.isArray(damageTypes) ||
          damageTypes.length < 2 ||
          damageTypes.some(
            (type) => typeof type !== 'string' || type.length === 0,
          ) ||
          new Set(damageTypes).size !== damageTypes.length ||
          !(
            subjectObject.selection === 'choose-one' ||
            subjectObject.selection === 'source-determined' ||
            subjectObject.application === 'all-components'
          ) ||
          (subjectObject.selection !== undefined &&
            subjectObject.application !== undefined)
        )
          throw new SpellUpcastError(
            `operation ${index} has invalid damage type selection`,
          );
      }
      if (damageType !== undefined && damageTypes !== undefined)
        throw new SpellUpcastError(
          `operation ${index} has contradictory damage types`,
        );
    }
    if (
      subjectObject.cardinalityMode !== undefined &&
      (subjectObject.cardinalityMode !== 'maximum-total' ||
        subjectObject.includesCaster !== true)
    ) {
      throw new SpellUpcastError(
        `operation ${index} has invalid cardinality semantics`,
      );
    }
    if (kind === 'selected-slot-value') {
      const minSlotLevel = integer(
        operation.minSlotLevel,
        `operation ${index} minimum slot`,
        1,
      );
      if (operation.value !== 'selected-slot-level')
        throw new SpellUpcastError(
          `operation ${index} has invalid selected-slot value`,
        );
      if (slotLevel >= minSlotLevel)
        adjustments.push({
          kind: 'slot-value',
          subject,
          amount: slotLevel,
          sourceOperation: index,
        });
      return;
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
      if (Array.isArray(e.scaling)) {
        for (const scaling of e.scaling) {
          const resolved = resolveS1Scaling(obj(scaling), slotLevel, 's1');
          if (resolved !== undefined) adjustments.push(resolved);
        }
      }
    }
  }
  const winningThreshold = new Map<string, number>();
  for (const adjustment of adjustments) {
    if (adjustment.kind === 'threshold' && adjustment.threshold !== undefined) {
      const key = String(obj(adjustment.subject).semanticId);
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
        winningThreshold.get(String(obj(adjustment.subject).semanticId)),
  );
  const qualifier =
    upcast.qualifier === undefined ? undefined : obj(upcast.qualifier);
  const qualifierText = qualifier?.text;
  const qualifierMinSlotLevel =
    qualifier === undefined
      ? undefined
      : integer(qualifier.minSlotLevel, 'qualifier minimum slot level', 1);
  if (
    qualifier !== undefined &&
    (typeof qualifierText !== 'string' || qualifierText.length === 0)
  ) {
    throw new SpellUpcastError('malformed upcast qualifier');
  }
  const applicableQualifier: string | undefined =
    qualifierMinSlotLevel !== undefined &&
    slotLevel >= qualifierMinSlotLevel &&
    typeof qualifierText === 'string'
      ? qualifierText
      : undefined;
  return {
    ...result,
    hasHigherSlotBenefit:
      resolvedAdjustments.length > 0 || applicableQualifier !== undefined,
    clauseIds: [upcast.clauseId],
    adjustments: resolvedAdjustments,
    ...(applicableQualifier === undefined
      ? {}
      : { qualifier: applicableQualifier }),
  };
}

export { SpellUpcastError };
