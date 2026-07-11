import type { D20Kind } from './resolution.js';
import { D20_KINDS, ResolutionError, resolveD20 } from './resolution.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  ADVANTAGE_SCHEMA,
  DISADVANTAGE_SCHEMA,
  MODIFIERS_SCHEMA,
  PROFICIENCY_SCHEMA,
  parseCheckSide,
  parseVisibility,
  parseVs,
  VISIBILITY_SCHEMA,
} from './toolResolutionShared.js';
import type { RollCategory } from './toolRoll.js';

/** Ledger/trace category per d20 kind. */
export const CHECK_KIND_CATEGORIES: Readonly<Record<D20Kind, RollCategory>> = {
  ability_check: 'ability_check',
  saving_throw: 'saving_throw',
  attack: 'attack',
};

export const resolveCheckTool: Tool = {
  name: 'resolve_check',
  // Pure deterministic d20 resolution from the seeded RNG; writes no canon.
  mutates: false,
  description:
    'Resolve an ability check, saving throw, or attack roll with code-owned ' +
    'math: the engine rolls the d20 (2d20kh1/kl1 under advantage/' +
    'disadvantage — declaring both cancels; never roll two d20s yourself), ' +
    'sums your declared modifiers, applies proficiency at most once ' +
    '(multiplier handles expertise/half/none), and resolves vs the DC/AC ' +
    'including natural 1/20 auto-miss/hit on attacks. Choosing WHICH ' +
    'modifiers apply and setting the DC stay your rulings; the arithmetic is ' +
    'engine-owned. args: { kind, reason, actor?, advantage?, disadvantage?, ' +
    'modifiers?, proficiency?, vs?, visibility? }.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: D20_KINDS,
        description: 'What kind of d20 test this is.',
      },
      reason: {
        type: 'string',
        description:
          'Short justification, e.g. "Kira Stealth vs guard". Recorded in the turn trace and roll ledger.',
        minLength: 1,
      },
      actor: {
        type: 'string',
        description: 'Who is rolling, e.g. "Kira" or "goblin 2".',
        minLength: 1,
        maxLength: 80,
      },
      advantage: ADVANTAGE_SCHEMA,
      disadvantage: DISADVANTAGE_SCHEMA,
      modifiers: MODIFIERS_SCHEMA,
      proficiency: PROFICIENCY_SCHEMA,
      vs: {
        type: 'integer',
        description:
          'The DC (checks/saves) or AC (attacks) to resolve against. Omit when the outcome will be adjudicated later.',
        minimum: 1,
        maximum: 99,
      },
      visibility: VISIBILITY_SCHEMA,
    },
    required: ['kind', 'reason'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.kind !== 'string' ||
      !D20_KINDS.includes(a.kind as D20Kind) ||
      typeof a.reason !== 'string' ||
      a.reason.length === 0
    ) {
      return err(
        'invalid_args',
        `resolve_check requires { kind: ${D20_KINDS.join('|')}, reason: string }`,
      );
    }
    if (
      a.actor !== undefined &&
      (typeof a.actor !== 'string' || a.actor.length === 0)
    ) {
      return err(
        'invalid_args',
        'resolve_check actor must be a non-empty string',
      );
    }
    const kind = a.kind as D20Kind;
    try {
      const side = parseCheckSide(a, 'resolve_check');
      const vs = parseVs(a, 'resolve_check');
      const resolution = resolveD20(
        {
          kind,
          advantage: side.advantage,
          disadvantage: side.disadvantage,
          modifiers: side.modifiers,
          ...(side.proficiency === undefined
            ? {}
            : { proficiency: side.proficiency }),
          ...(vs === undefined ? {} : { vs }),
        },
        ctx.rng,
      );
      const visibility = parseVisibility(a.visibility);
      return ok({
        reason: a.reason,
        ...(typeof a.actor === 'string' ? { actor: a.actor } : {}),
        ...(visibility === undefined ? {} : { visibility }),
        category: CHECK_KIND_CATEGORIES[kind],
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
