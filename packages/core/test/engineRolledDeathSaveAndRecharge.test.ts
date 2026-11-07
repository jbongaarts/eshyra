// Engine-rolled death saves and recharge rolls with a recorded DM override
// (eshyra-o9bd.19.5.16; decision eshyra-o9bd.19.5.14). Driven through the real
// tool registry so the override contract, provenance, ledger rendering and
// seeded replay are exercised end to end.

import { describe, expect, it } from 'vitest';
import type { ExecutedToolCall, ToolContext } from '../src/internal.js';
import {
  createCampaignRule,
  createDefaultToolRegistry,
  createSeededRng,
  DETERMINISTIC_CAPABILITY_INVENTORY,
  mutateStateBatch,
} from '../src/internal.js';
import { appendPlayerVisibleRollLedger } from '../src/orchestrator/playerVisibleRollLedger.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const AT = '2026-11-07T10:00:00.000Z';
const OVERRIDE = { basis: 'dm-adjudicated', reason: 'table ruling' } as const;

function setup(seed = 11) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(seed),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'turn-1',
    at: AT,
  };
  const dying = (successes = 0, failures = 0) =>
    mutateStateBatch(
      db,
      [
        { field: 'hp_max', value: 20 },
        { field: 'hp_current', value: 0 },
        { field: 'life_state', value: 'dying' },
        { field: 'death_save_successes', value: successes },
        { field: 'death_save_failures', value: failures },
      ].map((m) => ({
        target: 'character' as const,
        op: 'set' as const,
        ...m,
        provenance: 'test',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: AT,
      })),
    );
  const call = (args: Record<string, unknown>) =>
    registry.invoke('record_death_save', args, ctx);
  return { db, ctx, dying, call };
}

/** The d20 the seeded stream yields first (1d20) for a seed. */
const firstD20 = (seed: number) => createSeededRng(seed).nextInt(20) + 1;

describe('record_death_save engine roll', () => {
  it('rolls the seeded d20 when roll is omitted and records engine evidence', () => {
    const { dying, call } = setup(11);
    dying();
    const natural = firstD20(11);
    const result = call({});
    expect(result).toMatchObject({
      ok: true,
      data: {
        roll: natural,
        total: natural,
        category: 'death_save',
        visibility: 'player_visible',
        rollEvidence: {
          source: 'engine',
          dice: '1d20',
          rolls: [natural],
          kept: [natural],
          dropped: [],
          natural,
        },
      },
    });
  });

  it('replays identically from the same seed', () => {
    const run = () => {
      const { dying, call } = setup(99);
      dying();
      return call({ saveBonus: 2 });
    };
    expect(run()).toEqual(run());
  });

  it('judges advantage / disadvantage on the kept die and cancels them pairwise', () => {
    const adv = setup(5);
    adv.dying();
    const advResult = adv.call({ advantage: true });
    const rng = createSeededRng(5);
    const pair = [rng.nextInt(20) + 1, rng.nextInt(20) + 1];
    expect(advResult).toMatchObject({
      ok: true,
      data: {
        roll: Math.max(...pair),
        rollEvidence: {
          dice: '2d20kh1',
          rolls: pair,
          kept: [Math.max(...pair)],
          dropped: [Math.min(...pair)],
        },
      },
    });
    const dis = setup(5);
    dis.dying();
    expect(dis.call({ disadvantage: true })).toMatchObject({
      ok: true,
      data: { roll: Math.min(...pair), rollEvidence: { dice: '2d20kl1' } },
    });
    const both = setup(5);
    both.dying();
    expect(both.call({ advantage: true, disadvantage: true })).toMatchObject({
      ok: true,
      data: { rollEvidence: { dice: '1d20', rolls: [pair[0]] } },
    });
  });

  it('judges natural 1 and natural 20 on the kept die regardless of saveBonus', () => {
    let sawLow = false;
    let sawHigh = false;
    for (let seed = 1; seed < 400 && !(sawLow && sawHigh); seed += 1) {
      const natural = firstD20(seed);
      if (natural !== 1 && natural !== 20) continue;
      const { dying, call } = setup(seed);
      dying();
      const result = call({ saveBonus: natural === 1 ? 20 : -20 });
      expect(result).toMatchObject({
        ok: true,
        data: {
          roll: natural,
          outcome: natural === 1 ? 'critical-failure' : 'revived',
        },
      });
      if (natural === 1) sawLow = true;
      else sawHigh = true;
    }
    expect(sawLow && sawHigh).toBe(true);
  });
});

describe('record_death_save DM override', () => {
  it('accepts a supplied roll with an override and records it as DM-supplied', () => {
    const { dying, call } = setup();
    dying();
    expect(call({ roll: 14, rollOverride: OVERRIDE })).toMatchObject({
      ok: true,
      data: {
        roll: 14,
        outcome: 'success',
        rollEvidence: {
          source: 'dm-supplied',
          natural: 14,
          basis: 'dm-adjudicated',
          reason: 'table ruling',
        },
      },
    });
  });

  it('refuses a supplied roll without an override, an override without a roll, and advantage with a supplied roll', () => {
    const { dying, call } = setup();
    dying();
    expect(call({ roll: 14 })).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    expect(call({ rollOverride: OVERRIDE })).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    expect(
      call({ roll: 14, rollOverride: OVERRIDE, advantage: true }),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(
      call({ roll: 14, rollOverride: { basis: 'because', reason: 'x' } }),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
  });

  it('validates a house-rule ruleId against active house-rule campaign rules', () => {
    const { db, dying, call } = setup();
    dying();
    const refused = call({
      roll: 14,
      rollOverride: { basis: 'house-rule', reason: 'x', ruleId: 'hr-1' },
    });
    expect(refused).toMatchObject({ ok: false, code: 'invalid_args' });
    createCampaignRule(
      db,
      {
        ruleIdentity: 'hr-1',
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        ruleKind: 'house-rule',
        status: 'active',
        origin: 'player-approved',
        provenance: { kind: 'house-rule', rationale: 'table decision' },
        effectivePosition: {
          sessionId: DEFAULT_TEST_SESSION_ID,
          turnId: 'turn-0',
          ordinal: 1,
        },
        temporalMode: { mode: 'prospective' },
        supersededBy: null,
        revokedPosition: null,
        scope: 'combat',
        governingRecordKeys: ['record:one'],
        prose: 'Table death-save rule',
      },
      {
        currentPosition: {
          sessionId: DEFAULT_TEST_SESSION_ID,
          turnId: 'turn-0',
          ordinal: 0,
        },
      },
    );
    expect(
      call({
        roll: 14,
        rollOverride: { basis: 'house-rule', reason: 'x', ruleId: 'hr-1' },
      }),
    ).toMatchObject({
      ok: true,
      data: { rollEvidence: { source: 'dm-supplied', ruleId: 'hr-1' } },
    });
  });
});

describe('roll ledger and capability inventory', () => {
  const executed = (data: unknown): ExecutedToolCall => ({
    tool: 'record_death_save',
    args: {},
    result: { ok: true, data },
    mutates: true,
    source: 'native',
  });

  it('renders engine-rolled and DM-supplied death saves, honoring visibility', () => {
    const engine = setup(11);
    engine.dying();
    const engineCall = executed(
      (
        engine.call({ saveBonus: 1, bonusSources: ['Bless'] }) as {
          data: unknown;
        }
      ).data,
    );
    const rendered = appendPlayerVisibleRollLedger('Narration.', [engineCall]);
    expect(rendered).toMatch(
      /Death save \(Death saving throw\): 1d20 nat \d+ \+ 1 \(Bless\) = \d+ → /,
    );

    const supplied = setup();
    supplied.dying();
    const suppliedCall = executed(
      (
        supplied.call({ roll: 14, rollOverride: OVERRIDE }) as {
          data: unknown;
        }
      ).data,
    );
    expect(appendPlayerVisibleRollLedger('N.', [suppliedCall])).toContain(
      'DM-supplied (dm-adjudicated) nat 14',
    );

    const hidden = setup();
    hidden.dying();
    const hiddenCall = executed(
      (hidden.call({ visibility: 'dm_only' }) as { data: unknown }).data,
    );
    expect(appendPlayerVisibleRollLedger('N.', [hiddenCall])).toBe('N.');
  });

  it('states the engine-rolled contract in the inventory entries', () => {
    const entry = (tool: string) =>
      DETERMINISTIC_CAPABILITY_INVENTORY.find((e) => e.operationId === tool);
    const death = JSON.stringify(entry('record_death_save'));
    expect(death).toMatch(/seeded RNG/);
    expect(death).toMatch(/rollOverride/);
    const restore = JSON.stringify(entry('restore_usage'));
    expect(restore).toMatch(/seeded RNG/);
    expect(restore).toMatch(/rollOverride/);
    expect(restore).toMatch(
      /amount is DM-supplied|DM-supplied uses|DM-supplied/,
    );
  });
});
