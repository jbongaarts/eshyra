/**
 * Fail-closed character-build boundary for the schema-v1 engine (ADR 0018).
 *
 * Schema v1 represents exactly one base class in `class`, an optional subclass,
 * and one level.  This module deliberately examines untyped transport values as
 * well as typed sheets: JSON persistence cannot be allowed to discard known
 * multiclass-shaped fields before the engine sees them.
 */

import {
  getBundledDnd5eCharacterResolver,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';

/** Stable machine-readable code for a build outside the v1 engine domain. */
export const MULTICLASS_UNSUPPORTED = 'MULTICLASS_UNSUPPORTED' as const;

/**
 * A typed, user-facing failure for an operation that would otherwise flatten
 * or execute a multiclass-shaped build.
 */
export class UnsupportedCharacterBuildError extends Error {
  readonly code = MULTICLASS_UNSUPPORTED;
  readonly operation: string;

  constructor(operation: string) {
    super(
      `${operation} was refused: Eshyra currently supports one class only.`,
    );
    this.name = 'UnsupportedCharacterBuildError';
    this.operation = operation;
  }
}

/** Inputs that identify the boundary where a build is being consumed. */
export interface CharacterBuildValidationOptions {
  /** Stable name of the operation refused when validation fails. */
  readonly operation: string;
  /**
   * The acting pack resolver, when a caller already has one.  It lets the
   * validator verify that a selected subclass belongs to the sole base class.
   */
  readonly resolver?: Pick<RulesPackCharacterResolver, 'listSubclasses'>;
}

const MULTICLASS_SHAPED_FIELDS = [
  'classes',
  'classLevels',
  'class_levels',
  'classLevel',
  'class_level',
  'levelsByClass',
  'levels_by_class',
  'perClassLevels',
  'per_class_levels',
  'additionalClass',
  'additionalClassKey',
  'additionalClassLevel',
  'additional_class',
  'additional_class_level',
  'secondClass',
  'secondClassKey',
  'secondClassLevel',
  'second_class',
  'second_class_level',
  'advancementClass',
  'advancementClassKey',
  'advancement_class',
  'targetClass',
  'targetClassKey',
  'target_class',
  'multiclass',
  'multiclassing',
] as const;

/**
 * Assert that `value` is in the current single-class executable domain.
 *
 * This is intentionally not a general JSON schema validator. Unknown fields
 * remain subject to each boundary's existing schema policy. The named fields
 * above are different: they are known attempts to express multiclass state and
 * must never be silently ignored as forward-compatible metadata.
 */
export function assertSupportedCharacterBuild(
  value: unknown,
  options: CharacterBuildValidationOptions,
): void {
  const record = asRecord(value);
  if (record === undefined) {
    return;
  }

  assertCharacterBuildRecord(record, options);
  // Guided creation's explicitly supported transport container. Inspect it
  // before the draft engine spreads its recognized fields into canonical state;
  // do not recursively walk arbitrary metadata containers.
  const selections = asRecord(record.selections);
  if (selections !== undefined) {
    assertCharacterBuildRecord(selections, options);
  }
}

function assertCharacterBuildRecord(
  record: Record<string, unknown>,
  options: CharacterBuildValidationOptions,
): void {
  if (
    MULTICLASS_SHAPED_FIELDS.some((field) => Object.hasOwn(record, field)) ||
    Array.isArray(record.class)
  ) {
    throw new UnsupportedCharacterBuildError(options.operation);
  }

  assertPositiveIntegerLevel(record.level, options.operation);
  assertClaimedLevelsAgree(record, options.operation);
  assertSubclassBelongsToClass(record, options);
}

function assertPositiveIntegerLevel(level: unknown, operation: string): void {
  if (
    level !== undefined &&
    (!Number.isInteger(level) || typeof level !== 'number' || level <= 0)
  ) {
    throw new UnsupportedCharacterBuildError(operation);
  }
}

function assertClaimedLevelsAgree(
  record: Record<string, unknown>,
  operation: string,
): void {
  const level = record.level;
  for (const field of ['totalLevel', 'soleClassLevel'] as const) {
    if (!Object.hasOwn(record, field)) {
      continue;
    }
    const claimed = record[field];
    if (
      !Number.isInteger(claimed) ||
      typeof claimed !== 'number' ||
      claimed <= 0 ||
      claimed !== level
    ) {
      throw new UnsupportedCharacterBuildError(operation);
    }
  }
}

function assertSubclassBelongsToClass(
  record: Record<string, unknown>,
  options: CharacterBuildValidationOptions,
): void {
  const subclass = asRecord(record.subclass);
  if (subclass === undefined) {
    return;
  }

  const classKey = refKey(record.class);
  const declaredParent = subclass.parentClass ?? record.subclassParentClass;
  if (declaredParent !== undefined && declaredParent !== classKey) {
    throw new UnsupportedCharacterBuildError(options.operation);
  }

  // Canonical schema-v1 sheets store only a subclass ref. Resolve that ref
  // against the active D&D pack so parentage is still checked at every engine
  // boundary instead of trusting callers to have done so earlier.
  if (record.system !== 'dnd5e-srd' || classKey === undefined) {
    return;
  }
  const resolver = options.resolver ?? getBundledDnd5eCharacterResolver();
  const subclassKey = refKey(subclass);
  if (subclassKey === undefined) {
    return;
  }
  const resolved = resolver
    .listSubclasses()
    .find((entry) => entry.key === subclassKey);
  if (resolved !== undefined && resolved.parentClass !== classKey) {
    throw new UnsupportedCharacterBuildError(options.operation);
  }
}

function refKey(value: unknown): string | undefined {
  const record = asRecord(value);
  return typeof record?.key === 'string' ? record.key : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
