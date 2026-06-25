import { describe, expect, it } from 'vitest';
import {
  appendPlayerVisibleRollLedger,
  playerVisibleRollEntries,
  renderPlayerVisibleRollLedger,
} from '../src/orchestrator/playerVisibleRollLedger.js';
import type {
  RollCategory,
  RollVisibility,
} from '../src/orchestrator/toolRoll.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';

function roll(input: {
  reason: string;
  total: number;
  modifier?: number;
  visibility?: RollVisibility;
  category?: RollCategory;
  ok?: boolean;
}): ExecutedToolCall {
  const modifier = input.modifier ?? 3;
  return {
    tool: 'roll',
    args: {
      dice: '1d20+3',
      reason: input.reason,
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(input.category ? { category: input.category } : {}),
    },
    result:
      input.ok === false
        ? {
            ok: false,
            code: 'invalid_dice',
            message: 'bad dice',
          }
        : {
            ok: true,
            data: {
              dice: '1d20+3',
              reason: input.reason,
              ...(input.visibility ? { visibility: input.visibility } : {}),
              ...(input.category ? { category: input.category } : {}),
              rolls: [input.total - modifier],
              modifier,
              total: input.total,
            },
          },
    mutates: false,
    source: 'native',
  };
}

const visible = (
  reason: string,
  category: RollCategory,
  total: number,
  modifier = 3,
): ExecutedToolCall =>
  roll({
    reason,
    category,
    total,
    modifier,
    visibility: 'player_visible',
  });

describe('player-visible roll ledger', () => {
  it('renders player-visible attack and damage rolls from metadata', () => {
    const ledger = renderPlayerVisibleRollLedger(
      playerVisibleRollEntries([
        visible('Bob longsword attack', 'attack', 12),
        visible('Bob longsword damage', 'damage', 8, 0),
      ]),
    );

    expect(ledger).toContain('Rolls:');
    expect(ledger).toContain('Attack (Bob longsword attack)');
    expect(ledger).toContain('Damage (Bob longsword damage)');
  });

  it('renders a player-visible enemy attack against Bob from metadata', () => {
    const ledger = renderPlayerVisibleRollLedger(
      playerVisibleRollEntries([
        visible('goblin scimitar attack against Bob', 'attack', 17),
      ]),
    );

    expect(ledger).toContain('Attack (goblin scimitar attack against Bob)');
  });

  it('renders a player-visible death save from metadata', () => {
    const ledger = renderPlayerVisibleRollLedger(
      playerVisibleRollEntries([
        visible('Bob death save', 'death_save', 14, 0),
      ]),
    );

    expect(ledger).toContain('Death save (Bob death save)');
  });

  it('does not render dm_only hidden ambush or stealth rolls', () => {
    const entries = playerVisibleRollEntries([
      roll({
        reason: 'hidden ambush stealth check',
        category: 'ability_check',
        visibility: 'dm_only',
        total: 18,
      }),
      roll({
        reason: 'secret goblin perception check',
        category: 'ability_check',
        visibility: 'dm_only',
        total: 11,
      }),
      visible('initiative', 'initiative', 15),
    ]);

    expect(entries.map((entry) => entry.reason)).toEqual(['initiative']);
  });

  it('renders player-visible Perception or Stealth checks when metadata says visible', () => {
    const ledger = renderPlayerVisibleRollLedger(
      playerVisibleRollEntries([
        visible('Bob Perception check', 'ability_check', 15),
        visible('Bob Stealth check', 'ability_check', 19),
      ]),
    );

    expect(ledger).toContain('Ability check (Bob Perception check)');
    expect(ledger).toContain('Ability check (Bob Stealth check)');
  });

  it('hides goblin stealth or perception rolls when metadata says dm_only', () => {
    const entries = playerVisibleRollEntries([
      roll({
        reason: 'goblin stealth check',
        category: 'ability_check',
        visibility: 'dm_only',
        total: 18,
      }),
      roll({
        reason: 'goblin perception check',
        category: 'ability_check',
        visibility: 'dm_only',
        total: 13,
      }),
    ]);

    expect(entries).toEqual([]);
  });

  it('does not render rolls with omitted visibility or failed results', () => {
    const entries = playerVisibleRollEntries([
      roll({
        reason: 'legacy attack reason',
        category: 'attack',
        total: 12,
      }),
      roll({
        reason: 'failed visible roll',
        category: 'attack',
        visibility: 'player_visible',
        total: 12,
        ok: false,
      }),
    ]);

    expect(entries).toEqual([]);
  });

  it('replaces a trailing model-authored Rolls section with the code-owned ledger', () => {
    const narration = appendPlayerVisibleRollLedger(
      [
        'Your blade bites deep.',
        '',
        'Rolls:',
        '- Attack: 1d20+5 = 99 (wrong)',
      ].join('\n'),
      [visible('Bob longsword attack', 'attack', 12)],
    );

    expect(narration).toContain('Your blade bites deep.');
    expect(narration).toContain(
      'Rolls:\n- Attack (Bob longsword attack): 1d20+3 = 12 (9 + 3)',
    );
    expect(narration).not.toContain('99 (wrong)');
  });

  it('removes a trailing model-authored Rolls section when no roll is engine-visible', () => {
    const narration = appendPlayerVisibleRollLedger(
      ['The brush stirs.', '', 'Rolls:', '- Hidden check: 18'].join('\n'),
      [
        roll({
          reason: 'hidden ambush stealth check',
          category: 'ability_check',
          visibility: 'dm_only',
          total: 18,
        }),
      ],
    );

    expect(narration).toBe('The brush stirs.');
  });
});
