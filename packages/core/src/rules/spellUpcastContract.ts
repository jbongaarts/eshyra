import { createHash } from 'node:crypto';

/** Closed, system-specific contract shared by pack validation and runtime. */

export const SRD_DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;

export type UpcastDamageType = (typeof SRD_DAMAGE_TYPES)[number];

export type UpcastSubject =
  | {
      readonly kind: 'damage';
      readonly damageType?: UpcastDamageType;
      readonly damageTypes?: readonly UpcastDamageType[];
      readonly selection?: 'choose-one' | 'base-spell-determined';
      readonly application?: 'all-components';
      readonly semanticId: string;
      readonly property: 'damage-dice';
    }
  | {
      readonly kind: 'healing';
      readonly semanticId: string;
      readonly property: 'healing-dice' | 'healing-points';
    }
  | {
      readonly kind: 'affected-hit-points';
      readonly semanticId: string;
      readonly property: 'affected-hit-point-pool-dice';
    }
  | {
      readonly kind: 'effect';
      readonly semanticId: string;
      readonly cardinalityMode?: 'maximum-total';
      readonly includesCaster?: true;
      readonly creatureType?: 'beast' | 'humanoid';
      readonly willingTargets?: true;
      readonly maximumSeparationFeet?: number;
      readonly allTargetsWithinFeetOfCaster?: number;
      readonly projectileOrigin?: 'first-target';
      readonly projectileDestination?: 'different-target';
      readonly property:
        | 'duration-hours'
        | 'current-and-maximum-hit-points'
        | 'target-count'
        | 'projectile-count'
        | 'creature-count'
        | 'object-count'
        | 'volume-gallons'
        | 'cube-size-feet'
        | 'spell-level-threshold'
        | 'duration'
        | 'radius-feet'
        | 'bonus'
        | 'memory-age'
        | 'temporary-hit-points';
    };

export type UpcastThresholdValue =
  | {
      readonly kind: 'duration';
      readonly amount: number;
      readonly unit: 'minute' | 'hour' | 'day' | 'year';
      readonly additionalDays?: number;
      readonly concentration: boolean;
      readonly upTo?: true;
    }
  | {
      readonly kind: 'duration';
      readonly ending: 'until-dispelled' | 'until-ended-by-allowed-spell';
      readonly concentration: false;
    }
  | { readonly kind: 'bonus'; readonly amount: number }
  | {
      readonly kind: 'memory-age';
      readonly amount: number;
      readonly unit: 'day' | 'year';
    }
  | { readonly kind: 'memory-age'; readonly unrestricted: true };

export interface UpcastChoice {
  readonly groupId: string;
  readonly optionId: string;
}

/** Shared threshold identity used by both contract validation and runtime. */
export function spellUpcastThresholdAxisKey(
  subject: { readonly semanticId: string },
  choice?: UpcastChoice,
): string {
  return JSON.stringify([
    subject.semanticId,
    choice?.groupId ?? null,
    choice?.optionId ?? null,
  ]);
}

interface UpcastOperationBase {
  readonly subject: UpcastSubject;
  readonly choice?: UpcastChoice;
}

export type UpcastOperation =
  | (UpcastOperationBase & {
      readonly kind: 'dice-per-slot';
      readonly dice: string;
      readonly startSlotLevel: number;
      readonly everySlotLevels: number;
    })
  | (UpcastOperationBase & {
      readonly kind: 'flat-per-slot';
      readonly amount: number;
      readonly startSlotLevel: number;
      readonly everySlotLevels: number;
    })
  | (UpcastOperationBase & {
      readonly kind: 'count-per-slot';
      readonly count: number;
      readonly startSlotLevel: number;
      readonly everySlotLevels: number;
    })
  | (UpcastOperationBase & {
      readonly kind: 'threshold';
      readonly atSlotLevel: number;
      readonly value: UpcastThresholdValue;
    })
  | (UpcastOperationBase & {
      readonly kind: 'selected-slot-value';
      readonly minSlotLevel: number;
      readonly value: 'selected-slot-level';
    });

/** Stable semantic identity independent of operation array ordering. */
export function spellUpcastOperationId(operation: UpcastOperation): string {
  const choice = operation.choice
    ? `:choice:${operation.choice.groupId}:${operation.choice.optionId}`
    : '';
  if (operation.kind === 'threshold') {
    return `${operation.subject.semanticId}:threshold:slot-${operation.atSlotLevel}${choice}`;
  }
  if (operation.kind === 'selected-slot-value') {
    return `${operation.subject.semanticId}:selected-slot-value:min-${operation.minSlotLevel}${choice}`;
  }
  return `${operation.subject.semanticId}:${operation.kind}${choice}`;
}

export interface SpellUpcastQualifier {
  readonly text: string;
  readonly minSlotLevel: number;
}

/**
 * Explicit reviewed repair of a malformed source extraction. The extracted
 * phrase remains authoritative provenance; `reviewedSourcePhrase` is the text
 * the compiler actually used to derive the typed operation.
 */
export interface SpellUpcastSourceCorrection {
  readonly id: string;
  readonly extractedSourcePhrase: string;
  readonly extractedSourceSha256: string;
  readonly reviewedSourcePhrase: string;
  readonly note: string;
}

export interface ParsedSpellUpcastSpec {
  readonly sourceKind: 'higher-slot';
  readonly clauseId: string;
  readonly sourcePhrase: string;
  readonly sourceCorrection?: SpellUpcastSourceCorrection;
  readonly sourcePage: number;
  readonly operations: readonly UpcastOperation[];
  readonly qualifier?: SpellUpcastQualifier;
  readonly disposition:
    | 'complete-typed-upcast'
    | 'existing-s1-typed-scaling'
    | 'typed-core-with-model-qualifier';
}

export class SpellUpcastContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpellUpcastContractError';
  }
}

type Obj = Record<string, unknown>;

function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SpellUpcastContractError(`${path} must be an object`);
  }
  return value as Obj;
}

function onlyKeys(value: Obj, allowed: readonly string[], path: string): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new SpellUpcastContractError(
        `${path} has unsupported key ${JSON.stringify(key)}`,
      );
    }
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SpellUpcastContractError(`${path} must be a non-empty string`);
  }
  return value;
}

function integer(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new SpellUpcastContractError(
      `${path} must be a safe integer from ${minimum} through ${maximum}`,
    );
  }
  return value as number;
}

const DAMAGE_TYPE_SET = new Set<string>(SRD_DAMAGE_TYPES);

const SUBJECT_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  damage: ['damage-dice'],
  healing: ['healing-dice', 'healing-points'],
  'affected-hit-points': ['affected-hit-point-pool-dice'],
  effect: [
    'duration-hours',
    'current-and-maximum-hit-points',
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
  ],
};

const OPERATION_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  'dice-per-slot': [
    'damage-dice',
    'healing-dice',
    'affected-hit-point-pool-dice',
  ],
  'flat-per-slot': [
    'healing-points',
    'duration-hours',
    'current-and-maximum-hit-points',
    'volume-gallons',
    'cube-size-feet',
    'spell-level-threshold',
    'radius-feet',
    'temporary-hit-points',
  ],
  'count-per-slot': [
    'target-count',
    'projectile-count',
    'creature-count',
    'object-count',
  ],
  threshold: ['duration', 'bonus', 'memory-age'],
  'selected-slot-value': ['spell-level-threshold'],
};

export function isUpcastOperationSubjectCompatible(
  operationKind: string,
  subjectProperty: string,
): boolean {
  return (
    OPERATION_PROPERTIES[operationKind]?.includes(subjectProperty) === true
  );
}

function parseSubject(value: unknown, path: string): UpcastSubject {
  const subject = object(value, path);
  const kind = string(subject.kind, `${path}.kind`);
  const semanticId = string(subject.semanticId, `${path}.semanticId`);
  const property = string(subject.property, `${path}.property`);
  if (!SUBJECT_PROPERTIES[kind]?.includes(property)) {
    throw new SpellUpcastContractError(
      `${path}.property is not valid for subject kind ${kind}`,
    );
  }
  if (kind === 'damage') {
    onlyKeys(
      subject,
      [
        'kind',
        'semanticId',
        'property',
        'damageType',
        'damageTypes',
        'selection',
        'application',
      ],
      path,
    );
    const one = subject.damageType;
    const many = subject.damageTypes;
    if (one !== undefined && !DAMAGE_TYPE_SET.has(String(one))) {
      throw new SpellUpcastContractError(
        `${path}.damageType must be a canonical damage type`,
      );
    }
    if (many !== undefined) {
      if (
        !Array.isArray(many) ||
        many.length < 2 ||
        many.some((entry) => !DAMAGE_TYPE_SET.has(String(entry))) ||
        new Set(many).size !== many.length
      ) {
        throw new SpellUpcastContractError(
          `${path}.damageTypes must contain unique canonical damage types`,
        );
      }
      const modeCount =
        Number(
          subject.selection === 'choose-one' ||
            subject.selection === 'base-spell-determined',
        ) + Number(subject.application === 'all-components');
      if (modeCount !== 1) {
        throw new SpellUpcastContractError(
          `${path}.damageTypes requires exactly one application mode`,
        );
      }
    } else if (
      subject.selection !== undefined ||
      subject.application !== undefined
    ) {
      throw new SpellUpcastContractError(
        `${path} cannot declare a damage application mode without damageTypes`,
      );
    }
    if (one !== undefined && many !== undefined) {
      throw new SpellUpcastContractError(
        `${path} cannot declare damageType and damageTypes together`,
      );
    }
  } else if (kind === 'effect') {
    onlyKeys(
      subject,
      [
        'kind',
        'semanticId',
        'property',
        'cardinalityMode',
        'includesCaster',
        'creatureType',
        'willingTargets',
        'maximumSeparationFeet',
        'allTargetsWithinFeetOfCaster',
        'projectileOrigin',
        'projectileDestination',
      ],
      path,
    );
    const targetMetadata = [
      subject.cardinalityMode,
      subject.includesCaster,
      subject.creatureType,
      subject.willingTargets,
      subject.maximumSeparationFeet,
      subject.allTargetsWithinFeetOfCaster,
    ];
    if (
      targetMetadata.some((entry) => entry !== undefined) &&
      property !== 'creature-count' &&
      property !== 'target-count'
    ) {
      throw new SpellUpcastContractError(
        `${path} targeting metadata requires a creature or target count`,
      );
    }
    const hasProjectileMetadata =
      subject.projectileOrigin !== undefined ||
      subject.projectileDestination !== undefined;
    if (hasProjectileMetadata && property !== 'projectile-count') {
      throw new SpellUpcastContractError(
        `${path} projectile metadata requires a projectile count`,
      );
    }
    if (
      subject.projectileOrigin !== undefined &&
      subject.projectileOrigin !== 'first-target'
    ) {
      throw new SpellUpcastContractError(
        `${path}.projectileOrigin is not closed`,
      );
    }
    if (
      subject.projectileDestination !== undefined &&
      subject.projectileDestination !== 'different-target'
    ) {
      throw new SpellUpcastContractError(
        `${path}.projectileDestination is not closed`,
      );
    }
    if (
      subject.cardinalityMode !== undefined &&
      subject.cardinalityMode !== 'maximum-total'
    ) {
      throw new SpellUpcastContractError(
        `${path}.cardinalityMode must be maximum-total`,
      );
    }
    if (
      subject.includesCaster !== undefined &&
      subject.includesCaster !== true
    ) {
      throw new SpellUpcastContractError(`${path}.includesCaster must be true`);
    }
    if (
      subject.includesCaster === true &&
      subject.cardinalityMode !== 'maximum-total'
    ) {
      throw new SpellUpcastContractError(
        `${path}.includesCaster requires maximum-total cardinality`,
      );
    }
    if (
      subject.creatureType !== undefined &&
      subject.creatureType !== 'beast' &&
      subject.creatureType !== 'humanoid'
    ) {
      throw new SpellUpcastContractError(
        `${path}.creatureType is not a closed creature eligibility`,
      );
    }
    if (
      subject.willingTargets !== undefined &&
      subject.willingTargets !== true
    ) {
      throw new SpellUpcastContractError(`${path}.willingTargets must be true`);
    }
    for (const key of [
      'maximumSeparationFeet',
      'allTargetsWithinFeetOfCaster',
    ] as const) {
      if (subject[key] !== undefined)
        integer(subject[key], `${path}.${key}`, 1, 1_000);
    }
  } else {
    onlyKeys(subject, ['kind', 'semanticId', 'property'], path);
  }
  return { ...subject, kind, semanticId, property } as UpcastSubject;
}

function parseChoice(value: unknown, path: string): UpcastChoice {
  const choice = object(value, path);
  onlyKeys(choice, ['groupId', 'optionId'], path);
  return {
    groupId: string(choice.groupId, `${path}.groupId`),
    optionId: string(choice.optionId, `${path}.optionId`),
  };
}

function parseThresholdValue(
  value: unknown,
  property: string,
  path: string,
): UpcastThresholdValue {
  const result = object(value, path);
  const kind = string(result.kind, `${path}.kind`);
  if (kind !== property) {
    throw new SpellUpcastContractError(
      `${path}.kind must match threshold subject property ${property}`,
    );
  }
  if (kind === 'duration') {
    if (result.ending !== undefined) {
      onlyKeys(result, ['kind', 'ending', 'concentration'], path);
      if (
        result.ending !== 'until-dispelled' &&
        result.ending !== 'until-ended-by-allowed-spell'
      ) {
        throw new SpellUpcastContractError(`${path}.ending is not closed`);
      }
      if (result.concentration !== false) {
        throw new SpellUpcastContractError(
          `${path}.concentration must be false for an indefinite duration`,
        );
      }
    } else {
      onlyKeys(
        result,
        ['kind', 'amount', 'unit', 'additionalDays', 'concentration', 'upTo'],
        path,
      );
      integer(result.amount, `${path}.amount`, 1, Number.MAX_SAFE_INTEGER);
      if (!['minute', 'hour', 'day', 'year'].includes(String(result.unit))) {
        throw new SpellUpcastContractError(`${path}.unit is not closed`);
      }
      if (result.additionalDays !== undefined) {
        integer(
          result.additionalDays,
          `${path}.additionalDays`,
          1,
          Number.MAX_SAFE_INTEGER,
        );
        if (result.unit !== 'year') {
          throw new SpellUpcastContractError(
            `${path}.additionalDays requires a year duration`,
          );
        }
      }
      if (typeof result.concentration !== 'boolean') {
        throw new SpellUpcastContractError(
          `${path}.concentration must be boolean`,
        );
      }
      if (result.upTo !== undefined && result.upTo !== true) {
        throw new SpellUpcastContractError(`${path}.upTo must be true`);
      }
    }
  } else if (kind === 'bonus') {
    onlyKeys(result, ['kind', 'amount'], path);
    integer(result.amount, `${path}.amount`, 1, Number.MAX_SAFE_INTEGER);
  } else if (kind === 'memory-age') {
    if (result.unrestricted !== undefined) {
      onlyKeys(result, ['kind', 'unrestricted'], path);
      if (result.unrestricted !== true) {
        throw new SpellUpcastContractError(`${path}.unrestricted must be true`);
      }
    } else {
      onlyKeys(result, ['kind', 'amount', 'unit'], path);
      integer(result.amount, `${path}.amount`, 1, Number.MAX_SAFE_INTEGER);
      if (result.unit !== 'day' && result.unit !== 'year') {
        throw new SpellUpcastContractError(`${path}.unit is not closed`);
      }
    }
  } else {
    throw new SpellUpcastContractError(`${path}.kind is not a threshold value`);
  }
  return result as unknown as UpcastThresholdValue;
}

export interface ParseSpellUpcastInput {
  readonly recordKey: string;
  readonly data: unknown;
  readonly provenanceLocator?: string;
}

function parseSourceCorrection(
  value: unknown,
  path: string,
  sourcePhrase: string,
): SpellUpcastSourceCorrection | undefined {
  if (value === undefined) return undefined;
  const correction = object(value, path);
  onlyKeys(
    correction,
    [
      'id',
      'extractedSourcePhrase',
      'extractedSourceSha256',
      'reviewedSourcePhrase',
      'note',
    ],
    path,
  );
  const extractedSourcePhrase = string(
    correction.extractedSourcePhrase,
    `${path}.extractedSourcePhrase`,
  );
  if (extractedSourcePhrase !== sourcePhrase) {
    throw new SpellUpcastContractError(
      `${path}.extractedSourcePhrase must equal the retained source phrase`,
    );
  }
  const extractedSourceSha256 = string(
    correction.extractedSourceSha256,
    `${path}.extractedSourceSha256`,
  );
  if (!/^[a-f0-9]{64}$/.test(extractedSourceSha256)) {
    throw new SpellUpcastContractError(
      `${path}.extractedSourceSha256 must be a lowercase SHA-256 digest`,
    );
  }
  const actualHash = createHash('sha256')
    .update(extractedSourcePhrase)
    .digest('hex');
  if (extractedSourceSha256 !== actualHash) {
    throw new SpellUpcastContractError(
      `${path}.extractedSourceSha256 does not match extractedSourcePhrase`,
    );
  }
  const reviewedSourcePhrase = string(
    correction.reviewedSourcePhrase,
    `${path}.reviewedSourcePhrase`,
  );
  if (reviewedSourcePhrase === extractedSourcePhrase) {
    throw new SpellUpcastContractError(
      `${path}.reviewedSourcePhrase must differ from extractedSourcePhrase`,
    );
  }
  return {
    id: string(correction.id, `${path}.id`),
    extractedSourcePhrase,
    extractedSourceSha256,
    reviewedSourcePhrase,
    note: string(correction.note, `${path}.note`),
  };
}

export function parseSpellUpcastSpec(
  input: ParseSpellUpcastInput,
): ParsedSpellUpcastSpec | undefined {
  const data = object(input.data, `${input.recordKey}.data`);
  const upcastValue = data.upcast;
  if (upcastValue === undefined) {
    if (data.scalingSourceKind === 'higher-slot') {
      throw new SpellUpcastContractError(
        `${input.recordKey} higher-slot scaling requires data.upcast`,
      );
    }
    return undefined;
  }
  const path = `${input.recordKey}.data.upcast`;
  const upcast = object(upcastValue, path);
  onlyKeys(
    upcast,
    [
      'sourceKind',
      'clauseId',
      'sourcePhrase',
      'sourceCorrection',
      'sourcePage',
      'operations',
      'qualifier',
      'disposition',
    ],
    path,
  );
  const baseLevel = integer(data.level, `${input.recordKey}.data.level`, 1, 9);
  if (data.scalingSourceKind !== 'higher-slot') {
    throw new SpellUpcastContractError(
      `${path} requires higher-slot sourceKind`,
    );
  }
  const higherLevels = string(
    data.higherLevels,
    `${input.recordKey}.data.higherLevels`,
  );
  const scalingSourceText = string(
    data.scalingSourceText,
    `${input.recordKey}.data.scalingSourceText`,
  );
  const sourcePhrase = string(upcast.sourcePhrase, `${path}.sourcePhrase`);
  if (higherLevels !== scalingSourceText || higherLevels !== sourcePhrase) {
    throw new SpellUpcastContractError(
      `${path} source phrase must equal higherLevels and scalingSourceText`,
    );
  }
  const sourceCorrection = parseSourceCorrection(
    upcast.sourceCorrection,
    `${path}.sourceCorrection`,
    sourcePhrase,
  );
  if (upcast.sourceKind !== 'higher-slot') {
    throw new SpellUpcastContractError(
      `${path}.sourceKind must be higher-slot`,
    );
  }
  const expectedClauseId = `${input.recordKey.slice('spell:'.length)}:higher-slot`;
  const clauseId = string(upcast.clauseId, `${path}.clauseId`);
  if (clauseId !== expectedClauseId) {
    throw new SpellUpcastContractError(
      `${path}.clauseId must be ${expectedClauseId}`,
    );
  }
  const sourcePage = integer(upcast.sourcePage, `${path}.sourcePage`, 1, 999);
  const provenancePage = Number(
    /\bp(?:p)?\.\s*(\d+)\b/i.exec(input.provenanceLocator ?? '')?.[1],
  );
  if (!Number.isInteger(provenancePage)) {
    throw new SpellUpcastContractError(
      `${path} requires a source-page locator on its owning spell`,
    );
  }
  if (sourcePage !== provenancePage) {
    throw new SpellUpcastContractError(
      `${path}.sourcePage must equal record provenance page`,
    );
  }
  if (!Array.isArray(upcast.operations)) {
    throw new SpellUpcastContractError(`${path}.operations must be an array`);
  }
  const semanticKinds = new Map<string, string>();
  const operationKeys = new Set<string>();
  const choiceGroups = new Map<string, Set<string>>();
  const lastThresholdByAxis = new Map<string, number>();
  const operations = upcast.operations.map((raw, index): UpcastOperation => {
    const operationPath = `${path}.operations[${index}]`;
    const operation = object(raw, operationPath);
    onlyKeys(
      operation,
      [
        'kind',
        'subject',
        'choice',
        'dice',
        'amount',
        'count',
        'startSlotLevel',
        'everySlotLevels',
        'atSlotLevel',
        'minSlotLevel',
        'value',
      ],
      operationPath,
    );
    const kind = string(operation.kind, `${operationPath}.kind`);
    if (!Object.hasOwn(OPERATION_PROPERTIES, kind)) {
      throw new SpellUpcastContractError(`${operationPath}.kind is not closed`);
    }
    const subject = parseSubject(operation.subject, `${operationPath}.subject`);
    if (!isUpcastOperationSubjectCompatible(kind, subject.property)) {
      throw new SpellUpcastContractError(
        `${operationPath} ${kind} cannot modify ${subject.property}`,
      );
    }
    const existingKind = semanticKinds.get(subject.semanticId);
    if (existingKind !== undefined && existingKind !== kind) {
      throw new SpellUpcastContractError(
        `${operationPath} contradicts semantic target ${subject.semanticId}`,
      );
    }
    semanticKinds.set(subject.semanticId, kind);
    const choice =
      operation.choice === undefined
        ? undefined
        : parseChoice(operation.choice, `${operationPath}.choice`);
    if (choice !== undefined) {
      const options = choiceGroups.get(choice.groupId) ?? new Set<string>();
      options.add(choice.optionId);
      choiceGroups.set(choice.groupId, options);
    }
    let parsed: UpcastOperation;
    if (kind === 'threshold') {
      const atSlotLevel = integer(
        operation.atSlotLevel,
        `${operationPath}.atSlotLevel`,
        baseLevel + 1,
        9,
      );
      parsed = {
        kind,
        subject,
        ...(choice === undefined ? {} : { choice }),
        atSlotLevel,
        value: parseThresholdValue(
          operation.value,
          subject.property,
          `${operationPath}.value`,
        ),
      };
      const thresholdAxis = spellUpcastThresholdAxisKey(subject, choice);
      const previousThreshold = lastThresholdByAxis.get(thresholdAxis);
      if (previousThreshold !== undefined && atSlotLevel <= previousThreshold) {
        throw new SpellUpcastContractError(
          `${operationPath}.atSlotLevel must be strictly ordered for ${subject.semanticId}`,
        );
      }
      lastThresholdByAxis.set(thresholdAxis, atSlotLevel);
    } else if (kind === 'selected-slot-value') {
      parsed = {
        kind,
        subject,
        ...(choice === undefined ? {} : { choice }),
        minSlotLevel: integer(
          operation.minSlotLevel,
          `${operationPath}.minSlotLevel`,
          baseLevel + 1,
          9,
        ),
        value:
          operation.value === 'selected-slot-level'
            ? operation.value
            : (() => {
                throw new SpellUpcastContractError(
                  `${operationPath}.value must be selected-slot-level`,
                );
              })(),
      };
    } else {
      const startSlotLevel = integer(
        operation.startSlotLevel,
        `${operationPath}.startSlotLevel`,
        baseLevel,
        8,
      );
      const everySlotLevels = integer(
        operation.everySlotLevels,
        `${operationPath}.everySlotLevels`,
        1,
        9,
      );
      if (startSlotLevel + everySlotLevels > 9) {
        throw new SpellUpcastContractError(
          `${operationPath} interval cannot apply to a legal spell slot`,
        );
      }
      if (kind === 'dice-per-slot') {
        const dice = string(operation.dice, `${operationPath}.dice`);
        const diceMatch = /^([1-9]\d*)d([1-9]\d*)$/.exec(dice);
        if (
          diceMatch === null ||
          !Number.isSafeInteger(Number(diceMatch[1])) ||
          !Number.isSafeInteger(Number(diceMatch[2]))
        ) {
          throw new SpellUpcastContractError(
            `${operationPath}.dice must be canonical NdN notation`,
          );
        }
        parsed = {
          kind,
          subject,
          ...(choice === undefined ? {} : { choice }),
          dice,
          startSlotLevel,
          everySlotLevels,
        };
      } else if (kind === 'flat-per-slot') {
        parsed = {
          kind,
          subject,
          ...(choice === undefined ? {} : { choice }),
          amount: integer(
            operation.amount,
            `${operationPath}.amount`,
            1,
            Number.MAX_SAFE_INTEGER,
          ),
          startSlotLevel,
          everySlotLevels,
        };
      } else {
        parsed = {
          kind: 'count-per-slot',
          subject,
          ...(choice === undefined ? {} : { choice }),
          count: integer(
            operation.count,
            `${operationPath}.count`,
            1,
            Number.MAX_SAFE_INTEGER,
          ),
          startSlotLevel,
          everySlotLevels,
        };
      }
    }
    const identity = spellUpcastOperationId(parsed);
    if (operationKeys.has(identity)) {
      throw new SpellUpcastContractError(
        `${operationPath} duplicates semantic operation ${identity}`,
      );
    }
    operationKeys.add(identity);
    return parsed;
  });
  for (const [groupId, options] of choiceGroups) {
    if (options.size < 2) {
      throw new SpellUpcastContractError(
        `${path} choice group ${groupId} must contain at least two options`,
      );
    }
  }
  const qualifier =
    upcast.qualifier === undefined
      ? undefined
      : (() => {
          const value = object(upcast.qualifier, `${path}.qualifier`);
          onlyKeys(value, ['text', 'minSlotLevel'], `${path}.qualifier`);
          return {
            text: string(value.text, `${path}.qualifier.text`),
            minSlotLevel: integer(
              value.minSlotLevel,
              `${path}.qualifier.minSlotLevel`,
              baseLevel + 1,
              9,
            ),
          };
        })();
  const disposition = string(upcast.disposition, `${path}.disposition`);
  if (disposition === 'complete-typed-upcast') {
    if (operations.length === 0 || qualifier !== undefined) {
      throw new SpellUpcastContractError(
        `${path} complete disposition requires operations and no qualifier`,
      );
    }
  } else if (disposition === 'existing-s1-typed-scaling') {
    if (operations.length !== 0 || qualifier !== undefined) {
      throw new SpellUpcastContractError(
        `${path} S1 disposition cannot duplicate operations or qualifiers`,
      );
    }
  } else if (disposition === 'typed-core-with-model-qualifier') {
    if (qualifier === undefined) {
      throw new SpellUpcastContractError(
        `${path} qualified disposition requires a qualifier`,
      );
    }
  } else {
    throw new SpellUpcastContractError(`${path}.disposition is not closed`);
  }
  return {
    sourceKind: 'higher-slot',
    clauseId,
    sourcePhrase,
    ...(sourceCorrection === undefined ? {} : { sourceCorrection }),
    sourcePage,
    operations,
    ...(qualifier === undefined ? {} : { qualifier }),
    disposition,
  } as ParsedSpellUpcastSpec;
}
