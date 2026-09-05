import { describe, expect, it } from 'vitest';
import {
  formatCampaignPosition,
  lookupCampaignAmbiguity,
  recordAmbiguityRuling,
} from '../src/index.js';
import {
  assembleCampaignRulesContext,
  assembleContext,
  getBundledDnd5eSrdPack,
  listCampaignRules,
  renderCampaignRulesSection,
  resolveStrictCampaignRulesStack,
} from '../src/internal.js';
import { renderContextMessage } from '../src/orchestrator/contextAssembler.js';
import { buildAuditUserMessage } from '../src/orchestrator/turnAuditor.js';
import { freshDbWithSession } from './support/db.js';

const CURRENT = {
  sessionId: 'session-1',
  turnId: 'turn-1',
  ordinal: 0,
} as const;

function contextAt(db: ReturnType<typeof freshDbWithSession>, ordinal: number) {
  const position = { ...CURRENT, ordinal };
  return assembleCampaignRulesContext(
    db,
    'campaign-1',
    formatCampaignPosition(position),
    resolveStrictCampaignRulesStack(db),
  );
}

function interpretationIds(
  db: ReturnType<typeof freshDbWithSession>,
  ambiguityId: string,
): string[] {
  const item = contextAt(db, 0).ambiguities.find(
    ({ ambiguity }) => ambiguity.id === ambiguityId,
  );
  if (item === undefined) throw new Error(`missing ${ambiguityId}`);
  return item.ambiguity.interpretations.map(({ id }) => id);
}

describe('campaign ambiguity resolution', () => {
  it.each([
    [
      'ambiguity:create-undead-ghast-wight-composition',
      'homogeneous-alternative',
    ],
    ['ambiguity:create-undead-ghast-wight-composition', 'mixed-within-total'],
    [
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
      'presence-required',
    ],
    [
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
      'active-link-sufficient',
    ],
  ])(
    'records %s as %s with durable provenance',
    (ambiguityId, interpretationId) => {
      const db = freshDbWithSession();
      const recorded = recordAmbiguityRuling(db, {
        campaignId: 'campaign-1',
        ambiguityId,
        interpretationId,
        currentPosition: CURRENT,
      });

      expect(recorded.created).toBe(true);
      expect(recorded.rule).toMatchObject({
        ruleIdentity: `ruling:${ambiguityId.slice('ambiguity:'.length)}:`,
        ruleKind: 'ruling',
        status: 'active',
        origin: 'player-approved',
        provenance: {
          kind: 'ambiguity',
          ambiguityId,
          selectedInterpretationId: interpretationId,
        },
        effectivePosition: { ordinal: 1 },
        temporalMode: { mode: 'prospective' },
        scope: 'rules-ambiguity',
      });
      expect(listCampaignRules(db, { campaignId: 'campaign-1' })).toHaveLength(
        1,
      );
      db.close();
    },
  );

  it('lists known ambiguity and interpretation ids, and is idempotent', () => {
    const db = freshDbWithSession();
    const ambiguityId = 'ambiguity:create-undead-ghast-wight-composition';
    const known = interpretationIds(db, ambiguityId);
    expect(() =>
      lookupCampaignAmbiguity(db, {
        campaignId: 'campaign-1',
        ambiguityId: 'ambiguity:not-known',
        position: CURRENT,
      }),
    ).toThrow(new RegExp(`known ambiguity ids: .*${ambiguityId}`));
    expect(() =>
      recordAmbiguityRuling(db, {
        campaignId: 'campaign-1',
        ambiguityId,
        interpretationId: 'not-known',
        currentPosition: CURRENT,
      }),
    ).toThrow(new RegExp(`known interpretation ids: .*${known[0]}`));

    const first = recordAmbiguityRuling(db, {
      campaignId: 'campaign-1',
      ambiguityId,
      interpretationId: known[0] as string,
      currentPosition: CURRENT,
    });
    const second = recordAmbiguityRuling(db, {
      campaignId: 'campaign-1',
      ambiguityId,
      interpretationId: known[1] as string,
      currentPosition: CURRENT,
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, rule: first.rule });
    expect(listCampaignRules(db, { campaignId: 'campaign-1' })).toHaveLength(1);
    db.close();
  });

  it('is unresolved at the current position and resolved prospectively', () => {
    const db = freshDbWithSession();
    const input = {
      campaignId: 'campaign-1',
      ambiguityId: 'ambiguity:create-undead-ghast-wight-composition',
      position: CURRENT,
    } as const;
    expect(lookupCampaignAmbiguity(db, input).status).toBe('unresolved');
    recordAmbiguityRuling(db, {
      ...input,
      interpretationId: 'homogeneous-alternative',
      currentPosition: CURRENT,
    });
    expect(lookupCampaignAmbiguity(db, input).status).toBe('unresolved');
    expect(
      lookupCampaignAmbiguity(db, {
        ...input,
        position: { ...CURRENT, ordinal: 1 },
      }).status,
    ).toBe('resolved');
    expect(
      lookupCampaignAmbiguity(db, {
        ...input,
        position: { ...CURRENT, ordinal: 1 },
      }).ruling?.selectedInterpretationId,
    ).toBe('homogeneous-alternative');
    db.close();
  });

  it('keeps pack ambiguity data unchanged and renders the same DM/auditor section', () => {
    const db = freshDbWithSession();
    const ambiguityId = 'ambiguity:create-undead-ghast-wight-composition';
    const before = contextAt(db, 0).ambiguities.find(
      ({ ambiguity }) => ambiguity.id === ambiguityId,
    )?.ambiguity;
    if (before === undefined) throw new Error('missing ambiguity');
    const packBefore = structuredClone(getBundledDnd5eSrdPack());
    recordAmbiguityRuling(db, {
      campaignId: 'campaign-1',
      ambiguityId,
      interpretationId: 'mixed-within-total',
      currentPosition: CURRENT,
    });
    const context = contextAt(db, 1);
    const after = context.ambiguities.find(
      ({ ambiguity }) => ambiguity.id === ambiguityId,
    )?.ambiguity;
    expect(after).toEqual(before);
    expect(getBundledDnd5eSrdPack()).toEqual(packBefore);

    const section = renderCampaignRulesSection(context);
    expect(section).toBeDefined();
    const dmMessage = renderContextMessage(
      assembleContext({
        db,
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        playerInput: 'Can I mix a ghast and a wight?',
        campaignPosition: formatCampaignPosition({ ...CURRENT, ordinal: 1 }),
      }),
    );
    const auditMessage = buildAuditUserMessage({
      providedToolNames: [],
      executedToolCalls: [],
      playerInput: 'Can I mix a ghast and a wight?',
      candidateResponse: 'The active ruling applies.',
      campaignRules: context,
    });
    expect(dmMessage).toContain(section as string);
    expect(auditMessage).toContain(section as string);
    expect(section).toContain('Active ruling');
    db.close();
  });
});
