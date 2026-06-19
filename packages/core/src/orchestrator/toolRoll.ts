import { DiceError, rollDice } from './dice.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const rollTool: Tool = {
  name: 'roll',
  // Pure deterministic dice from the seeded RNG; writes no canon (eshyra-dwkm).
  mutates: false,
  description:
    'Roll dice with code-owned RNG. args: { dice: "NdM+K", reason: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      dice: {
        type: 'string',
        description: 'Dice notation, e.g. "1d20+5" or "4d6".',
        minLength: 1,
      },
      reason: {
        type: 'string',
        description:
          'Short justification for the roll; recorded in the turn trace.',
        minLength: 1,
      },
    },
    required: ['dice', 'reason'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.dice !== 'string' ||
      typeof a.reason !== 'string' ||
      a.reason.length === 0
    ) {
      return err(
        'invalid_args',
        'roll requires { dice: string, reason: string }',
      );
    }
    try {
      const roll = rollDice(a.dice, ctx.rng);
      return ok({
        dice: a.dice,
        reason: a.reason,
        rolls: roll.rolls,
        modifier: roll.modifier,
        total: roll.total,
      });
    } catch (e) {
      if (e instanceof DiceError) {
        return err('invalid_dice', e.message);
      }
      throw e;
    }
  },
};
