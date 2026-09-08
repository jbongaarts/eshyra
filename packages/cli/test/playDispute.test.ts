import {
  createDefaultToolRegistry,
  getPendingDisputedTurn,
  listCampaignRules,
  runTurn,
} from '@eshyra/core';
import { getTurnTrace } from '@eshyra/core/internal';
import { describe, expect, it } from 'vitest';
import { freshDbWithSession } from '../../core/test/support/db.js';
import { gracefulClose } from '../src/playClose.js';
import { runDisputeCommand } from '../src/playDispute.js';
import { launch } from '../src/playSession.js';
import type { PlayDeps } from '../src/playTypes.js';

const base = {
  campaignId: 'campaign-1',
  sessionId: 'session-1',
  turnId: 't1',
  playerInput: 'I cast my spell.',
  seed: 8,
  at: '2026-05-20T10:00:00.000Z',
};
async function setup(answers: string[], fail = false) {
  const db = freshDbWithSession();
  const output: string[] = [];
  let calls = 0;
  const deps = {
    io: {
      write: (line: string) => output.push(line),
      prompt: async () => answers.shift(),
    },
    model: {
      complete: async () => {
        calls++;
        if (fail && calls === 2) throw new Error('offline');
        return {
          text:
            calls === 1
              ? 'Material components are missing.'
              : 'The spell succeeds under your house rule.',
        };
      },
    },
    registry: createDefaultToolRegistry(),
  } as unknown as PlayDeps;
  expect((await runTurn({ ...deps, db }, base)).ok).toBe(true);
  return { db, deps, output };
}

describe('explicit CLI objections', () => {
  it('obtains approval before replaying the same player input', async () => {
    const { db, deps, output } = await setup([
      'house-rule',
      'rule:components',
      '',
      'yes',
    ]);
    await runDisputeCommand(
      deps,
      db,
      base.campaignId,
      "We don't use spell components.",
    );
    expect(output).toContain('The spell succeeds under your house rule.');
    expect(getTurnTrace(db, base)?.playerInput).toBe(base.playerInput);
    expect(db.prepare('SELECT prose FROM campaign_rule').get()).toEqual({
      prose: "We don't use spell components.",
    });
    db.close();
  });
  it('declining confirmation changes nothing', async () => {
    const { db, deps, output } = await setup([
      'house-rule',
      'rule:components',
      '',
      'no',
    ]);
    await runDisputeCommand(
      deps,
      db,
      base.campaignId,
      "We don't use spell components.",
    );
    expect(output).toContain('Dispute cancelled.');
    expect(db.prepare('SELECT * FROM campaign_rule').all()).toEqual([]);
    expect(getTurnTrace(db, base)?.finalNarration).toBe(
      'Material components are missing.',
    );
    db.close();
  });
  it('keeps recovery intact through quit and launch before retrying', async () => {
    const { db, deps, output } = await setup(
      ['house-rule', 'rule:components', '', 'yes'],
      true,
    );
    await runDisputeCommand(
      deps,
      db,
      base.campaignId,
      "We don't use spell components.",
    );
    expect(getPendingDisputedTurn(db, base.campaignId)).toEqual({
      sessionId: base.sessionId,
      turnId: base.turnId,
    });
    await gracefulClose(deps, db, 'unused', base.campaignId, base.sessionId);
    expect(output).toContain(
      'Replay recovery state saved. The session remains open; resume with /dispute retry.',
    );
    expect(
      await launch(deps, db, 'unused', {
        campaignId: base.campaignId,
      } as Parameters<typeof launch>[3]),
    ).toBe(base.sessionId);
    await runDisputeCommand(deps, db, base.campaignId, 'retry');
    expect(getPendingDisputedTurn(db, base.campaignId)).toBeUndefined();
    expect(getTurnTrace(db, base)?.finalNarration).toBe(
      'The spell succeeds under your house rule.',
    );
    db.close();
  });
  it('offers published ambiguity choices requested during the replay', async () => {
    const { db, deps, output } = await setup([
      'house-rule',
      'rule:components',
      '',
      'yes',
      '2',
    ]);
    const ambiguityId =
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp';
    let round = 0;
    deps.model = {
      complete: async () => {
        round += 1;
        return round === 1
          ? {
              text: '',
              toolCalls: [
                {
                  id: 'choice',
                  name: 'request_ambiguity_ruling',
                  args: { ambiguityId },
                },
              ],
              stopReason: 'tool_use',
            }
          : {
              text: 'Both interpretations remain possible. You will be asked to choose.',
            };
      },
    };
    await runDisputeCommand(deps, db, base.campaignId, 'No components.');
    expect(
      listCampaignRules(db, { campaignId: base.campaignId }),
    ).toContainEqual(
      expect.objectContaining({
        provenance: {
          kind: 'ambiguity',
          ambiguityId,
          selectedInterpretationId: 'active-link-sufficient',
        },
        effectivePosition: expect.objectContaining({ ordinal: 2 }),
      }),
    );
    expect(output.some((line) => line.startsWith('Ruling recorded'))).toBe(
      true,
    );
    db.close();
  });
});
