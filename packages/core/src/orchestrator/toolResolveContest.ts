import type { JsonSchema } from '../model/toolSchema.js';
import type { ContestSideInput } from './resolution.js';
import { ResolutionError, resolveContest } from './resolution.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  ADVANTAGE_SCHEMA,
  DISADVANTAGE_SCHEMA,
  MODIFIERS_SCHEMA,
  PROFICIENCY_SCHEMA,
  parseCheckSide,
  parseVisibility,
  VISIBILITY_SCHEMA,
} from './toolResolutionShared.js';

const SIDE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    label: {
      type: 'string',
      description: 'Who this side is, e.g. "Kira" or "the ogre".',
      minLength: 1,
      maxLength: 80,
    },
    advantage: ADVANTAGE_SCHEMA,
    disadvantage: DISADVANTAGE_SCHEMA,
    modifiers: MODIFIERS_SCHEMA,
    proficiency: PROFICIENCY_SCHEMA,
  },
  required: ['label'],
  additionalProperties: false,
};

function parseSide(
  raw: unknown,
  where: string,
): ContestSideInput {
  const record = asRecord(raw);
  if (
    record === undefined ||
    typeof record.label !== 'string' ||
    record.label.length === 0
  ) {
    throw new ResolutionError(`${where}: requires { label: string }`);
  }
  const side = parseCheckSide(record, where);
  return {
    label: record.label,
    advantage: side.advantage,
    disadvantage: side.disadvantage,
    modifiers: side.modifiers,
    ...(side.proficiency === undefined
      ? {}
      : { proficiency: side.proficiency }),
  };
}

export const resolveContestTool: Tool = {
  name: 'resolve_contest',
  // Pure deterministic opposed check from the seeded RNG; writes no canon.
  mutates: false,
  description:
    'Resolve a contest (opposed ability checks, e.g. grapple, shove, hidden ' +
    'vs perception): both sides roll d20 with their own declared modifiers, ' +
    'proficiency, and advantage/disadvantage; higher total wins; a tie means ' +
    'the situation stays as it was. Side a rolls first, then side b. args: ' +
    '{ reason, a: side, b: side, visibility? } where side = { label, ' +
    'advantage?, disadvantage?, modifiers?, proficiency? }.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description:
          'Short justification, e.g. "grapple: Brog vs bandit". Recorded in the turn trace and roll ledger.',
        minLength: 1,
      },
      a: SIDE_SCHEMA,
      b: SIDE_SCHEMA,
      visibility: VISIBILITY_SCHEMA,
    },
    required: ['reason', 'a', 'b'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const argsRecord = asRecord(args);
    if (
      argsRecord === undefined ||
      typeof argsRecord.reason !== 'string' ||
      argsRecord.reason.length === 0
    ) {
      return err(
        'invalid_args',
        'resolve_contest requires { reason: string, a: side, b: side }',
      );
    }
    try {
      const a = parseSide(argsRecord.a, 'resolve_contest a');
      const b = parseSide(argsRecord.b, 'resolve_contest b');
      const resolution = resolveContest(a, b, ctx.rng);
      const visibility = parseVisibility(argsRecord.visibility);
      return ok({
        reason: argsRecord.reason,
        ...(visibility === undefined ? {} : { visibility }),
        category: 'ability_check',
        ...resolution,
      });
    } catch (e) {
      if (e instanceof ResolutionError) {
        return err('invalid_resolution', e.message);
      }
      throw e;
    }
  },
};
