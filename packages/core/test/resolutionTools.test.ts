import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  initSchema,
  openDatabase,
  startSession,
} from '../src/internal.js';
import {
  appendPlayerVisibleRollLedger,
  playerVisibleRollEntries,
} from '../src/orchestrator/playerVisibleRollLedger.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';
import { deriveTraceFields } from '../src/orchestrator/turnTraceProjection.js';

/**
 * F1+F9 tool surface (eshyra-2n1t.3 / eshyra-2n1t.11): resolve_check /
 * resolve_contest / resolve_damage / calc through the registry, plus the
 * audit spine — player-visible ledger rendering, turn-trace preservation of
 * original dice / selection / natural / modifiers / outcome, and
 * deterministic replay under a fixed seed.
 */

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  const db = openDatabase(':memory:');
  initSchema(db);
  startSession(db, {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    startedAt: '2026-07-11T09:00:00.000Z',
  });
  return {
    db,
    rng: createSeededRng(42),
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    at: '2026-07-11T10:00:00.000Z',
    ...overrides,
  };
}

const registry = createDefaultToolRegistry();

function invoke(tool: string, args: unknown, seed = 42) {
  return registry.invoke(tool, args, ctx({ rng: createSeededRng(seed) }));
}

function dataOf(result: ReturnType<typeof invoke>): Record<string, unknown> {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error('unreachable');
  }
  return result.data as Record<string, unknown>;
}

describe('resolve_check tool', () => {
  const attackArgs = {
    kind: 'attack',
    reason: 'Kira shortsword vs goblin',
    actor: 'Kira',
    advantage: true,
    modifiers: [{ label: 'DEX modifier', value: 3, source: 'character:kira' }],
    proficiency: { bonus: 2, multiplier: 'normal' },
    vs: 15,
    visibility: 'player_visible',
  };

  it('resolves an attack with composed modifiers vs AC', () => {
    const data = dataOf(invoke('resolve_check', attackArgs));
    expect(data.kind).toBe('attack');
    expect(data.category).toBe('attack');
    expect(data.dice).toBe('2d20kh1');
    expect(data.advantageState).toBe('advantage');
    expect(data.modifierTotal).toBe(5);
    expect(data.total).toBe((data.natural as number) + 5);
    expect(['hit', 'miss']).toContain(data.outcome);
  });

  it('replays byte-identically under the same seed', () => {
    expect(invoke('resolve_check', attackArgs, 7)).toEqual(
      invoke('resolve_check', attackArgs, 7),
    );
  });

  it('cancels declared advantage + disadvantage to a straight roll', () => {
    const data = dataOf(
      invoke('resolve_check', {
        kind: 'saving_throw',
        reason: 'Con save vs poison',
        advantage: true,
        disadvantage: true,
        vs: 12,
      }),
    );
    expect(data.dice).toBe('1d20');
    expect(data.advantageState).toBe('none');
    expect(data.declaredAdvantage).toBe(true);
    expect(data.declaredDisadvantage).toBe(true);
  });

  it('rejects pre-summed garbage fail-closed (schema layer)', () => {
    const bad = invoke('resolve_check', {
      kind: 'attack',
      reason: 'x',
      modifiers: [{ label: 'everything', value: 500 }],
    });
    expect(bad).toMatchObject({ ok: false, code: 'invalid_args' });
  });

  it('rejects schema-invalid kinds before running', () => {
    const bad = invoke('resolve_check', { kind: 'initiative', reason: 'x' });
    expect(bad.ok).toBe(false);
  });

  it('rejects a second proficiency source by construction', () => {
    // proficiency is a single typed field; a list is schema-invalid.
    const bad = invoke('resolve_check', {
      kind: 'ability_check',
      reason: 'x',
      proficiency: [{ bonus: 2, multiplier: 'normal' }],
    });
    expect(bad.ok).toBe(false);
  });
});

describe('resolve_contest tool', () => {
  const grappleArgs = {
    reason: 'grapple: Brog vs bandit',
    a: {
      label: 'Brog',
      modifiers: [{ label: 'Athletics', value: 5 }],
    },
    b: {
      label: 'bandit',
      modifiers: [{ label: 'Acrobatics', value: 2 }],
      disadvantage: true,
    },
    visibility: 'player_visible',
  };

  it('resolves both sides with independent inputs', () => {
    const data = dataOf(invoke('resolve_contest', grappleArgs));
    const a = data.a as Record<string, unknown>;
    const b = data.b as Record<string, unknown>;
    expect(a.label).toBe('Brog');
    expect(b.dice).toBe('2d20kl1');
    expect(['a', 'b', 'tie']).toContain(data.outcome);
  });

  it('replays byte-identically under the same seed', () => {
    expect(invoke('resolve_contest', grappleArgs, 99)).toEqual(
      invoke('resolve_contest', grappleArgs, 99),
    );
  });

  it('rejects a side without a label', () => {
    const bad = invoke('resolve_contest', {
      reason: 'x',
      a: { label: 'a' },
      b: {},
    });
    expect(bad.ok).toBe(false);
  });
});

describe('resolve_damage tool', () => {
  const critArgs = {
    reason: 'crit shortsword + sneak attack vs goblin boss',
    packets: [
      {
        dice: '1d6',
        type: 'piercing',
        label: 'shortsword',
        modifiers: [{ label: 'DEX modifier', value: 3 }],
      },
      { dice: '2d6', type: 'piercing', label: 'sneak attack' },
    ],
    critical: true,
    targets: [{ label: 'goblin boss', resistances: ['piercing'] }],
    visibility: 'player_visible',
  };

  it('doubles dice on crit and halves for the resistant target', () => {
    const data = dataOf(invoke('resolve_damage', critArgs));
    const packets = data.packets as Record<string, unknown>[];
    expect(packets[0].dice).toBe('2d6');
    expect(packets[1].dice).toBe('4d6');
    const targets = data.targets as Record<string, unknown>[];
    const raw = data.total as number;
    const packetSubtotals = packets.map((p) => p.subtotal as number);
    expect(targets[0].total).toBe(
      packetSubtotals.reduce((sum, v) => sum + Math.floor(v / 2), 0),
    );
    expect(raw).toBe(packetSubtotals.reduce((sum, v) => sum + v, 0));
  });

  it('replays byte-identically under the same seed', () => {
    expect(invoke('resolve_damage', critArgs, 3)).toEqual(
      invoke('resolve_damage', critArgs, 3),
    );
  });

  it('rejects unknown damage types and keep/drop dice', () => {
    expect(
      invoke('resolve_damage', {
        reason: 'x',
        packets: [{ dice: '1d6', type: 'sonic' }],
      }).ok,
    ).toBe(false);
    expect(
      invoke('resolve_damage', {
        reason: 'x',
        packets: [{ dice: '2d6kh1', type: 'fire' }],
      }),
    ).toMatchObject({ ok: false, code: 'invalid_resolution' });
  });
});

describe('calc tool', () => {
  it('evaluates a registered formula with reason echoed', () => {
    const data = dataOf(
      invoke('calc', {
        formula: 'passive_score',
        args: { modifier: 4 },
        reason: 'Kira passive Perception',
      }),
    );
    expect(data.reason).toBe('Kira passive Perception');
    expect((data.outputs as Record<string, unknown>).score).toBe(14);
  });

  it('rejects unknown formulas at the schema layer (enum)', () => {
    const bad = invoke('calc', {
      formula: 'made_up',
      args: {},
      reason: 'x',
    });
    expect(bad.ok).toBe(false);
  });

  it('rejects bad formula args with a structured error', () => {
    const bad = invoke('calc', {
      formula: 'carry_capacity',
      args: { strength: 999 },
      reason: 'x',
    });
    expect(bad).toMatchObject({ ok: false, code: 'invalid_formula' });
  });
});

describe('roll tool F1 surface', () => {
  it('reports kept/dropped/natural for ability-score generation', () => {
    const data = dataOf(
      invoke('roll', { dice: '4d6dl1', reason: 'ability score' }),
    );
    expect((data.rolls as number[]).length).toBe(4);
    expect((data.kept as number[]).length).toBe(3);
    expect((data.dropped as number[]).length).toBe(1);
    expect(data.keep).toEqual({ mode: 'dl', count: 1 });
    expect(data.natural).toBe(
      (data.kept as number[]).reduce((sum, r) => sum + r, 0),
    );
    expect(data.total).toBe((data.natural as number) + (data.modifier as number));
  });

  it('rejects identity keeps through the tool seam', () => {
    const bad = invoke('roll', { dice: '2d20kh2', reason: 'advantage' });
    expect(bad).toMatchObject({ ok: false, code: 'invalid_dice' });
  });
});

describe('audit spine: ledger, trace, and replay', () => {
  function executedCall(tool: string, args: unknown, seed: number) {
    return {
      tool,
      args,
      result: invoke(tool, args, seed),
    } as ExecutedToolCall;
  }

  const checkArgs = {
    kind: 'attack',
    reason: 'Kira shortsword vs goblin',
    actor: 'Kira',
    advantage: true,
    modifiers: [{ label: 'DEX modifier', value: 3, source: 'character:kira' }],
    proficiency: { bonus: 2, multiplier: 'normal' },
    vs: 13,
    visibility: 'player_visible',
  };

  it('renders player-visible resolution entries in the roll ledger', () => {
    const calls = [
      executedCall('roll', {
        dice: '4d6dl1',
        reason: 'ability score',
        visibility: 'player_visible',
        category: 'other',
      }, 1),
      executedCall('resolve_check', checkArgs, 2),
      executedCall(
        'resolve_contest',
        {
          reason: 'grapple',
          a: { label: 'Brog', modifiers: [{ label: 'Athletics', value: 5 }] },
          b: { label: 'bandit' },
          visibility: 'player_visible',
        },
        3,
      ),
      executedCall(
        'resolve_damage',
        {
          reason: 'shortsword damage',
          packets: [
            {
              dice: '1d6',
              type: 'piercing',
              modifiers: [{ label: 'DEX modifier', value: 3 }],
            },
          ],
          targets: [{ label: 'goblin' }],
          visibility: 'player_visible',
        },
        4,
      ),
    ];
    const entries = playerVisibleRollEntries(calls);
    expect(entries).toHaveLength(4);
    const narration = appendPlayerVisibleRollLedger('You strike true.', calls);
    expect(narration).toContain('Rolls:');
    expect(narration).toContain('dropped');
    expect(narration).toContain('2d20kh1');
    expect(narration).toContain('nat ');
    expect(narration).toContain('(DEX modifier)');
    expect(narration).toContain('vs AC 13');
    expect(narration).toMatch(/wins|tie/);
    expect(narration).toContain('goblin takes');
  });

  it('keeps dm_only resolutions out of the ledger', () => {
    const calls = [
      executedCall(
        'resolve_check',
        { ...checkArgs, visibility: 'dm_only' },
        2,
      ),
      executedCall(
        'resolve_check',
        { kind: 'ability_check', reason: 'no visibility declared' },
        2,
      ),
    ];
    expect(playerVisibleRollEntries(calls)).toHaveLength(0);
  });

  it('preserves original dice, selection, natural, modifiers, and outcome in the turn trace', () => {
    const seedForCheck = 2;
    const calls = [
      executedCall('roll', { dice: '4d6dl1', reason: 'ability score' }, 1),
      executedCall('resolve_check', checkArgs, seedForCheck),
      executedCall(
        'calc',
        {
          formula: 'grapple_escape_dc',
          args: { athleticsModifier: 4 },
          reason: 'ogre grapple',
        },
        5,
      ),
    ];
    const fields = deriveTraceFields(calls, []);
    const resolution = fields.rulesResolution as Record<string, unknown>;

    const rolls = resolution.rolls as Record<string, unknown>[];
    expect(rolls).toHaveLength(1);
    expect(rolls[0].kept).toBeDefined();
    expect(rolls[0].dropped).toBeDefined();
    expect(rolls[0].natural).toBeDefined();

    const checks = resolution.checks as Record<string, unknown>[];
    expect(checks).toHaveLength(1);
    const traced = checks[0];
    // Re-resolve with the same seed: the trace must carry the identical
    // evidence a replay would produce — no reconstruction from narration.
    const replayed = dataOf(invoke('resolve_check', checkArgs, seedForCheck));
    expect(traced).toEqual(replayed);
    expect(traced.rolls).toEqual(replayed.rolls);
    expect(traced.natural).toBe(replayed.natural);
    expect(traced.modifiers).toEqual(checkArgs.modifiers);
    expect(traced.outcome).toBe(replayed.outcome);

    const calcs = resolution.calcs as Record<string, unknown>[];
    expect(calcs).toHaveLength(1);
    expect(calcs[0].formula).toBe('grapple_escape_dc');
    expect((calcs[0].outputs as Record<string, unknown>).dc).toBe(14);
  });

  it('flags failed resolutions as rejected candidates, not accepted state', () => {
    const calls = [
      executedCall(
        'resolve_damage',
        { reason: 'x', packets: [{ dice: '2d6kh1', type: 'fire' }] },
        1,
      ),
    ];
    const fields = deriveTraceFields(calls, []);
    expect(fields.rejectedCandidates).toHaveLength(1);
    expect(fields.acceptedStateDelta).toHaveLength(0);
    expect(fields.qualityFlags).toContain('tool_error');
  });
});

describe('multi-party vertical slice: group check over resolve_check + calc', () => {
  it('resolves per-member checks and aggregates with group_check_outcome', () => {
    const members = ['Kira', 'Brog', 'Mirena', 'Tobble'];
    const results = members.map((name, i) =>
      dataOf(
        invoke(
          'resolve_check',
          {
            kind: 'ability_check',
            reason: `${name} Survival (group check)`,
            actor: name,
            modifiers: [{ label: 'WIS modifier', value: i - 1 }],
            vs: 12,
          },
          100 + i,
        ),
      ),
    );
    const successes = results.filter((r) => r.outcome === 'success').length;
    const aggregate = dataOf(
      invoke('calc', {
        formula: 'group_check_outcome',
        args: { successes, groupSize: members.length },
        reason: 'party sneaks through the swamp',
      }),
    );
    const outputs = aggregate.outputs as Record<string, unknown>;
    expect(outputs.needed).toBe(2);
    expect(outputs.success).toBe(successes >= 2);
  });
});
