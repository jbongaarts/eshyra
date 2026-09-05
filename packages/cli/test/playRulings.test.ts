import {
  type ExecutedToolCall,
  getCampaignRule,
  initSchema,
  openDatabase,
} from '@eshyra/core';
import { resolveCampaignPosition } from '@eshyra/core/internal';
import { describe, expect, it } from 'vitest';
import { offerAmbiguityRulings } from '../src/playRulings.js';
import type { PlayDeps } from '../src/playTypes.js';

const AMBIGUITY_ID = 'ambiguity:create-undead-ghast-wight-composition';
const INTERPRETATIONS = [
  { id: 'homogeneous-alternative', summary: 'Use one creature type.' },
  { id: 'mixed-within-total', summary: 'Mix creature types.' },
] as const;

function setup(): {
  db: ReturnType<typeof openDatabase>;
  lines: string[];
  prompts: string[];
  deps: PlayDeps;
} {
  const db = openDatabase(':memory:');
  initSchema(db);
  resolveCampaignPosition(db, {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
  });
  const lines: string[] = [];
  const prompts: string[] = [];
  const deps = {
    io: {
      write: (line: string) => lines.push(line),
      prompt: async (question: string) => {
        prompts.push(question);
        return '2';
      },
    },
  } as unknown as PlayDeps;
  return { db, lines, prompts, deps };
}

function call(status: string, ambiguityId = AMBIGUITY_ID): ExecutedToolCall {
  const resultData = {
    ambiguityId,
    question: 'Can the total include both a ghast and a wight?',
    interpretations: INTERPRETATIONS,
    status,
    ruling:
      status === 'resolved'
        ? {
            ruleIdentity: `ruling:${ambiguityId.slice('ambiguity:'.length)}:`,
            selectedInterpretationId: 'mixed-within-total',
            prose: 'Use mixed types.',
          }
        : null,
  };
  return {
    tool: 'request_ambiguity_ruling',
    args: { ambiguityId },
    result: { ok: true, data: resultData },
    mutates: false,
    source: 'native',
  };
}

describe('play ambiguity rulings', () => {
  it('records the selected interpretation and prints the prospective confirmation', async () => {
    const { db, lines, prompts, deps } = setup();
    await offerAmbiguityRulings(deps, db, 'campaign-1', [call('unresolved')]);
    expect(
      getCampaignRule(db, {
        campaignId: 'campaign-1',
        ruleIdentity: `ruling:${AMBIGUITY_ID.slice('ambiguity:'.length)}:2`,
      }),
    ).toMatchObject({
      origin: 'player-approved',
      provenance: {
        selectedInterpretationId: 'mixed-within-total',
      },
      effectivePosition: { ordinal: 2 },
    });
    expect(prompts).toEqual([
      'Choose an interpretation number, or press Enter to leave it unresolved: ',
    ]);
    expect(lines.at(-1)).toContain('Ruling recorded');
    db.close();
  });

  it.each(['', 'not-a-number'])(
    'does not create a ruling for input %j',
    async (answer) => {
      const { db, lines, deps } = setup();
      deps.io.prompt = async () => answer;
      await offerAmbiguityRulings(deps, db, 'campaign-1', [call('unresolved')]);
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM campaign_rule').get(),
      ).toEqual({ count: 0 });
      expect(lines.at(-1)).toBe('Left unresolved.');
      db.close();
    },
  );

  it('does not prompt a resolved ambiguity and deduplicates repeated requests', async () => {
    const resolved = setup();
    await offerAmbiguityRulings(resolved.deps, resolved.db, 'campaign-1', [
      call('resolved'),
    ]);
    expect(resolved.prompts).toHaveLength(0);
    resolved.db.close();

    const duplicate = setup();
    await offerAmbiguityRulings(duplicate.deps, duplicate.db, 'campaign-1', [
      call('unresolved'),
      call('unresolved'),
    ]);
    expect(duplicate.prompts).toHaveLength(1);
    duplicate.db.close();
  });
});
