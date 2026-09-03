import { describe, expect, it } from 'vitest';
import type { CampaignPosition, CampaignRule } from '../src/internal.js';
import {
  CampaignRuleError,
  createCampaignRule,
  createCampaignRuleReadSeam,
  formatCampaignPosition,
  getCampaignRule,
  listActiveCampaignRulesAtPosition,
  listActiveRulingsForAmbiguitiesAtPosition,
  listCampaignRules,
  revokeCampaignRule,
  supersedeCampaignRule,
} from '../src/internal.js';
import { bareDb } from './support/db.js';

const p = (ordinal: number): CampaignPosition => ({
  sessionId: `s${ordinal}`,
  turnId: `t${ordinal}`,
  ordinal,
});

function rule(
  identity: string,
  ordinal: number,
  kind: CampaignRule['ruleKind'] = 'house-rule',
): CampaignRule {
  return {
    ruleIdentity: identity,
    campaignId: 'c1',
    ruleKind: kind,
    status: 'active',
    origin: 'player-approved',
    provenance:
      kind === 'house-rule'
        ? { kind: 'house-rule', rationale: 'table decision' }
        : { kind: 'recurring-question', questionId: 'q1' },
    effectivePosition: p(ordinal),
    temporalMode: { mode: 'prospective' },
    supersededBy: null,
    scope: 'combat',
    governingRecordKeys: ['record:one'],
    prose: `Rule ${identity}`,
  };
}

const ambiguity = {
  id: 'amb-1',
  question: 'Which interpretation applies?',
  source: [{ locator: 'p.1', clauseId: 'clause-1' }],
  affects: ['record:one'],
  interpretations: [{ id: 'int-1', summary: 'The first interpretation' }],
  canonicalResolution: null,
  runtimeDisposition: { status: 'engine-pending', owner: 'campaign-ruling' },
} as const;

function ambiguityRuling(identity: string, ordinal: number): CampaignRule {
  return {
    ...rule(identity, ordinal, 'ruling'),
    provenance: {
      kind: 'ambiguity',
      ambiguityId: ambiguity.id,
      selectedInterpretationId: 'int-1',
    },
  };
}

describe('campaign rule persistence', () => {
  it('round trips lossless rule fields and orders by canonical position', () => {
    const db = bareDb();
    createCampaignRule(db, rule('later', 10));
    createCampaignRule(db, rule('earlier', 2));
    expect(
      listCampaignRules(db, { campaignId: 'c1' }).map((r) => r.ruleIdentity),
    ).toEqual(['earlier', 'later']);
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'earlier' }),
    ).toEqual(rule('earlier', 2));
    expect(formatCampaignPosition(p(2))).toMatch(/^cp1~000000000002~/);
    db.close();
  });

  it('applies supersession and revocation prospectively', () => {
    const db = bareDb();
    createCampaignRule(db, rule('old', 1));
    supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'old',
      successor: rule('new', 5),
    });
    createCampaignRule(db, rule('revocable', 2));
    revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'revocable',
      revokedPosition: p(7),
    });
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(4)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['old', 'revocable']);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(6)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['revocable', 'new']);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(8)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['new']);
    db.close();
  });

  it('uses the latest recorded position when no cutoff is supplied', () => {
    const db = bareDb();
    createCampaignRule(db, rule('now', 1));
    createCampaignRule(db, rule('future', 999));
    expect(
      listActiveCampaignRulesAtPosition(db, 'c1').map((r) => r.ruleIdentity),
    ).toEqual(['now', 'future']);
    expect(
      listActiveCampaignRulesAtPosition(db, 'c1').map((r) => r.ruleIdentity),
    ).toEqual(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(999)),
      ).map((r) => r.ruleIdentity),
    );
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(1)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['now']);
    db.close();
  });

  it('provides the shared seam contract: house rules only, all candidates, ambiguity rulings separately', () => {
    const db = bareDb();
    createCampaignRule(db, rule('house', 1));
    createCampaignRule(db, ambiguityRuling('ruling', 1), {
      validation: { ambiguity },
    });
    const seam = createCampaignRuleReadSeam(
      db,
      'c1',
      formatCampaignPosition(p(2)),
    );
    expect(
      seam
        .activeRulesAtPosition({
          campaignPosition: formatCampaignPosition(p(2)),
          candidateRecordKeys: [],
        })
        .map((r) => r.ruleIdentity),
    ).toEqual(['house']);
    expect(
      seam.activeRulingsForAmbiguities(['amb-1']).map((r) => r.ruleIdentity),
    ).toEqual(['ruling']);
    expect(seam.activeRulingsForAmbiguities(['not-q'])).toEqual([]);
    expect(
      listActiveRulingsForAmbiguitiesAtPosition(
        db,
        'c1',
        ['amb-1'],
        formatCampaignPosition(p(2)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['ruling']);
    expect(
      seam
        .activeRulesAtPosition({
          campaignPosition: formatCampaignPosition(p(2)),
          candidateRecordKeys: [],
        })
        .map((r) => r.ruleIdentity),
    ).not.toContain('ruling');
    db.close();
  });

  it('isolates campaigns and rejects non-prospective lifecycle changes', () => {
    const db = bareDb();
    createCampaignRule(db, rule('same', 5));
    expect(
      getCampaignRule(db, { campaignId: 'c2', ruleIdentity: 'same' }),
    ).toBeUndefined();
    expect(() =>
      revokeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'same',
        revokedPosition: p(4),
      }),
    ).toThrow(CampaignRuleError);
    expect(() =>
      supersedeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'same',
        successor: rule('earlier-successor', 4),
      }),
    ).toThrow(CampaignRuleError);
    expect(() =>
      supersedeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'same',
        successor: { ...rule('other-campaign', 5), campaignId: 'c2' },
      }),
    ).toThrow(CampaignRuleError);
    db.close();
  });
});
