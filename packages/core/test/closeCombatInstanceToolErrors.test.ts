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

  it('does not claim durable-actor summon links are released', () => {
    expect(closeCombatInstanceTool.description).toMatch(/durable[^.]*rebound/);
  });
});
