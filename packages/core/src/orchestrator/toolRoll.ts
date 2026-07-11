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
    'Roll dice with code-owned RNG. Grammar: "NdM[khX|klX|dhX|dlX][+K|-K]" — ' +
    'keep-highest/lowest or drop-highest/lowest X dice, e.g. "4d6dl1" ' +
    '(ability scores), "2d20kh1" (advantage), "2d20kl1" (disadvantage). ' +
    'Advantage and disadvantage never stack and cancel each other pairwise; ' +
    'for ability checks, saving throws, and attack rolls prefer ' +
    'resolve_check, which applies that cancellation and the modifier math ' +
    'for you. The result reports every rolled die plus the kept/dropped ' +
    'split and the natural (pre-modifier) total. args: { dice, reason: ' +
    'string, visibility?: "player_visible"|"dm_only", category?: "attack"|' +
    '"damage"|"initiative"|"saving_throw"|"death_save"|"ability_check"|' +
    '"other" }.',
  inputSchema: {
    type: 'object',
    properties: {
      dice: {
        type: 'string',
        description:
          'Dice notation, e.g. "1d20+5", "4d6dl1", or "2d20kh1".',
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
        kept: roll.kept,
        keptIndices: roll.keptIndices,
        dropped: roll.dropped,
        droppedIndices: roll.droppedIndices,
        ...(roll.keep === undefined ? {} : { keep: roll.keep }),
        natural: roll.natural,
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
