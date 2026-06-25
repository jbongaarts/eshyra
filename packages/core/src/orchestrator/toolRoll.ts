import { DiceError, rollDice } from './dice.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const ROLL_VISIBILITIES = ['player_visible', 'dm_only'] as const;
export type RollVisibility = (typeof ROLL_VISIBILITIES)[number];

export const ROLL_CATEGORIES = [
  'attack',
  'damage',
  'initiative',
  'saving_throw',
  'death_save',
  'ability_check',
  'other',
] as const;
export type RollCategory = (typeof ROLL_CATEGORIES)[number];

function isRollVisibility(value: unknown): value is RollVisibility {
  return (
    typeof value === 'string' &&
    ROLL_VISIBILITIES.includes(value as RollVisibility)
  );
}

function isRollCategory(value: unknown): value is RollCategory {
  return (
    typeof value === 'string' && ROLL_CATEGORIES.includes(value as RollCategory)
  );
}

export const rollTool: Tool = {
  name: 'roll',
  // Pure deterministic dice from the seeded RNG; writes no canon (eshyra-dwkm).
  mutates: false,
  description:
    'Roll dice with code-owned RNG. args: { dice: "NdM+K", reason: string, visibility?: "player_visible"|"dm_only", category?: "attack"|"damage"|"initiative"|"saving_throw"|"death_save"|"ability_check"|"other" }.',
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
      visibility: {
        type: 'string',
        description:
          'Model-declared visibility decision. Use player_visible for rolls that directly affect the player and should be shown; use dm_only for secret/hidden rolls.',
        enum: ROLL_VISIBILITIES,
      },
      category: {
        type: 'string',
        description:
          'Model-declared roll category used by the engine-rendered player-visible roll ledger.',
        enum: ROLL_CATEGORIES,
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
        ...(isRollVisibility(a.visibility) ? { visibility: a.visibility } : {}),
        ...(isRollCategory(a.category) ? { category: a.category } : {}),
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
