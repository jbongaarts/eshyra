import { describe, expect, it } from 'vitest';
import {
  createDefaultToolRegistry,
  createSeededRng,
  recordAmbiguityRuling,
} from '../src/index.js';
import { buildSystemPrompt, resolveCampaignPosition } from '../src/internal.js';
import { buildAuditSystemPrompt } from '../src/orchestrator/turnAuditor.js';
import { freshDbWithSession } from './support/db.js';

function toolContext(db: ReturnType<typeof freshDbWithSession>) {
  const position = resolveCampaignPosition(db, {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
  });
  return {
    db,
    rng: createSeededRng(1),
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    at: '2026-09-05T00:00:00.000Z',
    position,
  };
}

describe('request_ambiguity_ruling tool', () => {
  it('returns unresolved interpretations, then the active ruling on the next turn', () => {
    const db = freshDbWithSession();
    const registry = createDefaultToolRegistry();
    const ctx = toolContext(db);
    const before = registry.invoke(
      'request_ambiguity_ruling',
      { ambiguityId: 'ambiguity:create-undead-ghast-wight-composition' },
      ctx,
    );
    expect(before).toMatchObject({
      ok: true,
      data: {
        status: 'unresolved',
        interpretations: [
          { id: 'homogeneous-alternative' },
          { id: 'mixed-within-total' },
        ],
      },
    });
    recordAmbiguityRuling(db, {
      campaignId: 'campaign-1',
      ambiguityId: 'ambiguity:create-undead-ghast-wight-composition',
      interpretationId: 'mixed-within-total',
      currentPosition: ctx.position,
    });
    const nextPosition = resolveCampaignPosition(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      turnId: 'turn-2',
    });
    const after = registry.invoke(
      'request_ambiguity_ruling',
      { ambiguityId: 'ambiguity:create-undead-ghast-wight-composition' },
      { ...ctx, turnId: 'turn-2', position: nextPosition },
    );
    expect(after).toMatchObject({
      ok: true,
      data: {
        status: 'resolved',
        ruling: {
          selectedInterpretationId: 'mixed-within-total',
        },
      },
    });
    db.close();
  });

  it('reports known ids for an unknown ambiguity and is registered read-only', () => {
    const db = freshDbWithSession();
    const registry = createDefaultToolRegistry();
    expect(registry.list()).toContain('request_ambiguity_ruling');
    expect(registry.get('request_ambiguity_ruling')?.mutates).toBe(false);
    const result = registry.invoke(
      'request_ambiguity_ruling',
      { ambiguityId: 'ambiguity:not-known' },
      toolContext(db),
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'unknown_ambiguity',
      data: {
        knownAmbiguityIds: expect.arrayContaining([
          'ambiguity:create-undead-ghast-wight-composition',
          'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
        ]),
      },
    });
    db.close();
  });

  it('teaches ambiguity handling to the DM and auditor', () => {
    expect(buildSystemPrompt(createDefaultToolRegistry())).toContain(
      'request_ambiguity_ruling',
    );
    expect(buildAuditSystemPrompt()).toContain(
      'UNRESOLVED without an active ruling',
    );
  });
});
