import { describe, expect, it } from 'vitest';
import {
  createDefaultToolRegistry,
  createSeededRng,
  initSchema,
  openDatabase,
  startSession,
  worldQuery,
} from '../src/internal.js';
import { buildAuditUserMessage } from '../src/orchestrator/turnAuditor.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';

function toolCtx(turnId: string) {
  const db = openDatabase(':memory:');
  initSchema(db);
  startSession(db, {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    startedAt: '2026-05-20T09:00:00.000Z',
  });
  return {
    db,
    rng: createSeededRng(42),
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId,
    at: '2026-05-20T10:00:00.000Z',
  };
}

describe('improvised hook continuity', () => {
  it('records Old Renn hooks, retrieves them later, and respects rumor truth', () => {
    const ctx = toolCtx('turn-1');
    const registry = createDefaultToolRegistry();
    const recorded = [
      registry.invoke(
        'record_world_fact',
        {
          id: 'old-renn-missing-cart',
          kind: 'quest_hook',
          subjectText: 'Old Renn',
          fact: 'Villagers report Old Renn and his charcoal cart are missing.',
          truthStatus: 'reported',
          source: 'dm_improvised',
          scope: 'campaign',
          visibility: 'player_visible',
          tags: ['hearthmere', 'old-renn', 'missing-cart'],
        },
        ctx,
      ),
      registry.invoke(
        'record_world_fact',
        {
          id: 'old-renn-mule',
          kind: 'clue',
          subjectText: 'Old Renn mule',
          fact: "Old Renn's mule returned alone.",
          truthStatus: 'observed',
          source: 'dm_improvised',
          scope: 'campaign',
          visibility: 'player_visible',
          tags: ['hearthmere', 'old-renn', 'mule'],
        },
        ctx,
      ),
      registry.invoke(
        'record_world_fact',
        {
          id: 'north-palisade-axe-cuts',
          kind: 'clue',
          subjectText: 'north palisade',
          fact: 'Fresh axe-cuts mark the north palisade.',
          truthStatus: 'observed',
          source: 'dm_improvised',
          scope: 'campaign',
          visibility: 'player_visible',
          tags: ['hearthmere', 'north-gate', 'evidence'],
        },
        ctx,
      ),
      registry.invoke(
        'record_world_fact',
        {
          id: 'goblin-rumor',
          kind: 'rumor',
          subjectText: 'Old Renn',
          fact: 'Some villagers believe goblins took Old Renn.',
          truthStatus: 'believed',
          source: 'dm_improvised',
          scope: 'campaign',
          visibility: 'player_visible',
          tags: ['hearthmere', 'old-renn', 'rumor'],
        },
        ctx,
      ),
    ];

    expect(recorded.every((result) => result.ok)).toBe(true);

    const later = worldQuery(ctx.db, {
      type: 'search',
      query: 'Old Renn missing cart mule goblins',
    });

    expect(later.ok).toBe(true);
    if (later.ok && later.type === 'search') {
      expect(later.results.map((result) => result.id)).toEqual(
        expect.arrayContaining([
          'old-renn-missing-cart',
          'old-renn-mule',
          'goblin-rumor',
        ]),
      );
      expect(
        later.results.find((result) => result.id === 'goblin-rumor'),
      ).toMatchObject({
        tier: 'rumor_belief',
        truthStatus: 'believed',
      });
    }

    const decorative = worldQuery(ctx.db, {
      type: 'search',
      query: 'damp wool chipped cup',
    });
    expect(decorative).toMatchObject({ ok: true, type: 'search', results: [] });

    const failedWorldQuery: ExecutedToolCall = {
      tool: 'world_query',
      args: { type: 'location', id: 'missing-hearthmere' },
      result: {
        ok: false,
        code: 'not_found',
        message: 'no such location',
      },
      mutates: false,
      source: 'native',
    };
    const auditMessage = buildAuditUserMessage({
      playerInput: 'What do villagers know?',
      candidateResponse:
        'Villagers believe goblins took Old Renn; the mule returned alone.',
      providedToolNames: ['record_world_fact', 'world_query'],
      executedToolCalls: [
        failedWorldQuery,
        ...recorded.map((result): ExecutedToolCall => {
          return {
            tool: 'record_world_fact',
            args: {},
            result,
            mutates: true,
            source: 'native',
          };
        }),
      ],
    });

    expect(auditMessage).toContain('failed_tool_call_not_evidence');
    expect(auditMessage).toContain('campaign_overlay_lore');
    expect(auditMessage).toContain('rumor_belief');
    expect(auditMessage).toContain('goblin-rumor');
  });
});
