import {
  CALC_FORMULA_NAMES,
  CALC_FORMULAS,
  CalcError,
  evaluateCalc,
} from './calc.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

const FORMULA_LINES = CALC_FORMULA_NAMES.map(
  (name) => `${name}: ${CALC_FORMULAS[name].description}`,
).join(' | ');

export const calcTool: Tool = {
  name: 'calc',
  // Pure deterministic formula evaluation; no RNG, writes no canon.
  mutates: false,
  description:
    'Evaluate a registered deterministic rules formula (no dice). Use this ' +
    'instead of computing derived numbers in prose — choosing the inputs is ' +
    'your ruling, the arithmetic is engine-owned. Unknown formulas are ' +
    `rejected. Formulas — ${FORMULA_LINES}. ` +
    'args: { formula, args: object, reason }.',
  inputSchema: {
    type: 'object',
    properties: {
      formula: {
        type: 'string',
        enum: CALC_FORMULA_NAMES,
        description: 'Registered formula name.',
      },
      args: {
        type: 'object',
        description:
          "The formula's named arguments (validated per formula; unknown keys rejected).",
        additionalProperties: true,
      },
      reason: {
        type: 'string',
        description:
          'Short justification, e.g. "Kira passive Perception". Recorded in the turn trace.',
        minLength: 1,
      },
    },
    required: ['formula', 'args', 'reason'],
    additionalProperties: false,
  },
  run(args) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.formula !== 'string' ||
      typeof a.reason !== 'string' ||
      a.reason.length === 0
    ) {
      return err(
        'invalid_args',
        'calc requires { formula: string, args: object, reason: string }',
      );
    }
    try {
      const result = evaluateCalc(a.formula, a.args);
      return ok({ reason: a.reason, ...result });
    } catch (e) {
      if (e instanceof CalcError) {
        return err('invalid_formula', e.message);
      }
      throw e;
    }
  },
};
