/**
 * Candle of Invocation lit/unlit lifecycle (eshyra-7f0h).
 *
 * Printed: "The candle’s magic is activated when the candle is lit, which
 * requires an action", "You can snuff it out early for use at a later time",
 * burn-time is deducted while it burns, and "when you light the candle for the
 * first time, you can cast the gate spell with it. Doing so destroys the
 * candle."
 *
 * Typed here, and executed by use_item:
 *  - `light` pays the printed action and moves the candle to `lit`;
 *  - `snuff` returns it to `snuffed` (the printed text names no action for
 *    snuffing, so none is typed);
 *  - `burn` (burn-time deduction, no action) is refused unless the candle is
 *    `lit` (`requiresState`);
 *  - `cast-gate` is the first-light alternative: the lighting action, valid
 *    only from `unlit` (the candle has never been lit, hence never burned),
 *    and it destroys the candle.
 * The gate spell's effects, the light zone and the free casting stay
 * DM-adjudicated (their own clauses).
 */
import type { MagicItemFamilyProjection } from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

const PHRASES = [
  'The candle’s magic is activated when the candle is lit, which requires an action',
  'You can snuff it out early for use at a later time',
  'when you light the candle for the first time, you can cast the gate spell with it',
] as const;

export function projectMagicItemCandleLifecycle(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  if (item.name !== 'Candle of Invocation') return undefined;
  for (const phrase of PHRASES)
    if (!item.description.includes(phrase))
      throw new Error(
        `magic-item candle lifecycle: expected source phrase ${JSON.stringify(phrase)} not found`,
      );
  return {
    family: 'm5-candle-lifecycle',
    mechanics: {
      operations: [
        { id: 'light', activation: { cost: 'action' } },
        { id: 'snuff' },
        { id: 'burn', requiresState: 'lit' },
        { id: 'cast-gate', activation: { cost: 'action' } },
      ],
      stateMachine: {
        initial: 'unlit',
        states: [
          { id: 'unlit', note: 'never lit' },
          { id: 'lit' },
          { id: 'snuffed', note: 'lit before and snuffed out for later use' },
          { id: 'destroyed' },
        ],
        transitions: [
          { from: 'unlit', to: 'lit', via: 'light' },
          { from: 'snuffed', to: 'lit', via: 'light' },
          { from: 'lit', to: 'snuffed', via: 'snuff' },
          { from: 'unlit', to: 'destroyed', via: 'cast-gate' },
        ],
      },
    },
    clauses: [
      {
        id: 'c1-candle-lit-state',
        // Tagged C1 (the activation/economy class the candle already carries)
        // so the reviewed M5 census of 50 items is not changed.
        tag: 'C1',
        representation: { block: 'stateMachine' },
        engineHooks: [
          { engine: 'F2', hook: 'olc5.11 pack-tested paid item operation' },
          {
            engine: 'F5',
            hook: 'olc5.11 pack-tested item state and timer transition',
          },
        ],
      },
    ],
  };
}
