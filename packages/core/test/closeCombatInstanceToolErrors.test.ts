/** eshyra-o9bd.19.5.15.1: close_combat_instance contract (description + error mapping). */
import { describe, expect, it, vi } from 'vitest';
import { ActiveEffectError } from '../src/state/activeEffects.js';

vi.mock('../src/state/encounterCombatants.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../src/state/encounterCombatants.js')
    >();
  return {
    ...actual,
    closeCombatInstance: () => {
      throw new ActiveEffectError(
        "campaign actor 'a' is already owned by effect 'e' and cannot be claimed by another effect",
      );
    },
  };
});

const { closeCombatInstanceTool } = await import(
  '../src/orchestrator/toolCloseCombatInstance.js'
);

describe('close_combat_instance tool contract', () => {
  it('maps an effect-layer failure to effect_error, not a generic crash', () => {
    const result = closeCombatInstanceTool.run({ status: 'completed' }, {
      db: {},
      campaignId: 'c',
      turnId: 't',
      sessionId: 's',
      at: 'now',
    } as never);
    expect(result).toMatchObject({ ok: false, code: 'effect_error' });
  });

  it('describes the ordered F3 boundary without unconditional removal claims', () => {
    const d = closeCombatInstanceTool.description;
    expect(d).toMatch(
      /timer anchored to this instance expires[^;]*character-owned/,
    );
    expect(d).toMatch(/durable campaign actor[^;]*rebound/);
    expect(d).toMatch(
      /only references to instance-only combatants are cleaned/,
    );
    expect(d).not.toMatch(/Character-owned effects survive\./);
  });
});

describe('refresh_effect description', () => {
  it('states the duration check is limited to timed spell records', async () => {
    const { refreshEffectTool } = await import(
      '../src/orchestrator/toolRefreshEffect.js'
    );
    expect(refreshEffectTool.description).not.toMatch(
      /keeps its record duration/,
    );
    expect(refreshEffectTool.description).toMatch(/timed duration/);
  });
});
