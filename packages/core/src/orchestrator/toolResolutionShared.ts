import type { JsonSchema } from '../model/toolSchema.js';
import type {
  DeclaredModifier,
  ProficiencyApplied,
} from './resolution.js';
import {
  PROFICIENCY_MULTIPLIERS,
  ResolutionError,
  validateModifiers,
  validateProficiency,
  validateVs,
} from './resolution.js';
import type { RollVisibility } from './toolRoll.js';
import { ROLL_VISIBILITIES } from './toolRoll.js';

/**
 * Shared schema fragments + arg parsing for the F9 resolution tools
 * (`resolve_check`, `resolve_contest`, `resolve_damage`). Keeps the declared
 * modifier / proficiency / advantage vocabulary identical across tools so the
 * model learns one shape (eshyra-2n1t.11).
 */

export const MODIFIERS_SCHEMA: JsonSchema = {
  type: 'array',
  description:
    'Declared modifiers, each with identity and provenance. The engine owns the arithmetic; declare every bonus/penalty separately (ability modifier, cover, spells, ...) — never pre-summed.',
  maxItems: 20,
  items: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: 'What this modifier is, e.g. "DEX modifier", "half cover".',
        minLength: 1,
        maxLength: 80,
      },
      value: {
        type: 'integer',
        description: 'Signed integer value.',
        minimum: -100,
        maximum: 100,
      },
      source: {
        type: 'string',
        description:
          'Where it comes from, e.g. "character:kira", "spell:bless", "cover:half".',
        minLength: 1,
        maxLength: 80,
      },
    },
    required: ['label', 'value'],
    additionalProperties: false,
  },
};

export const PROFICIENCY_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'Proficiency bonus contribution. Applied at most once; the multiplier handles expertise (double), half proficiency (half, rounded down), or none.',
  properties: {
    bonus: {
      type: 'integer',
      description: "The creature's proficiency bonus.",
      minimum: 0,
      maximum: 20,
    },
    multiplier: {
      type: 'string',
      enum: PROFICIENCY_MULTIPLIERS,
      description:
        'none (not proficient — contributes 0 even if doubled), half (rounded down), normal, or double (expertise).',
    },
  },
  required: ['bonus', 'multiplier'],
  additionalProperties: false,
};

export const ADVANTAGE_SCHEMA: JsonSchema = {
  type: 'boolean',
  description:
    'Declare advantage. Advantage never stacks; declaring both advantage and disadvantage cancels to a straight roll (the engine applies the cancellation).',
};

export const DISADVANTAGE_SCHEMA: JsonSchema = {
  type: 'boolean',
  description:
    'Declare disadvantage. Never stacks; cancels pairwise against advantage.',
};

export const VISIBILITY_SCHEMA: JsonSchema = {
  type: 'string',
  description:
    'Model-declared visibility decision. Use player_visible for resolutions that directly affect the player and should be shown; use dm_only for secret/hidden ones.',
  enum: ROLL_VISIBILITIES,
};

export interface ParsedCheckSide {
  readonly advantage: boolean;
  readonly disadvantage: boolean;
  readonly modifiers: DeclaredModifier[];
  readonly proficiency?: ProficiencyApplied;
}

/**
 * Parse the shared (advantage, disadvantage, modifiers, proficiency) fields
 * from a record. Throws ResolutionError with a `where`-prefixed message.
 */
export function parseCheckSide(
  record: Record<string, unknown>,
  where: string,
): ParsedCheckSide {
  if (
    record.advantage !== undefined &&
    typeof record.advantage !== 'boolean'
  ) {
    throw new ResolutionError(`${where}: advantage must be a boolean`);
  }
  if (
    record.disadvantage !== undefined &&
    typeof record.disadvantage !== 'boolean'
  ) {
    throw new ResolutionError(`${where}: disadvantage must be a boolean`);
  }
  const proficiency = validateProficiency(record.proficiency, where);
  return {
    advantage: record.advantage === true,
    disadvantage: record.disadvantage === true,
    modifiers: validateModifiers(record.modifiers, where),
    ...(proficiency === undefined ? {} : { proficiency }),
  };
}

export function parseVs(
  record: Record<string, unknown>,
  where: string,
): number | undefined {
  return validateVs(record.vs, where);
}

export function parseVisibility(value: unknown): RollVisibility | undefined {
  return typeof value === 'string' &&
    ROLL_VISIBILITIES.includes(value as RollVisibility)
    ? (value as RollVisibility)
    : undefined;
}
