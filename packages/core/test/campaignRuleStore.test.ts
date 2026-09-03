import { describe, expect, it } from 'vitest';
import type { CampaignPosition, CampaignRule } from '../src/internal.js';
import {
  createCampaignRule,
  createCampaignRuleReadSeam,
  formatCampaignPosition,
  getCampaignRule,
  listActiveCampaignRulesAtPosition,
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

  it('provides the shared seam contract: house rules only, all candidates, ambiguity rulings separately', () => {
    const db = bareDb();
    createCampaignRule(db, rule('house', 1));
    createCampaignRule(db, rule('ruling', 1, 'ruling'));
    const seam = createCampaignRuleReadSeam(db, 'c1');
    expect(
      seam
        .activeRulesAtPosition({
          campaignPosition: formatCampaignPosition(p(2)),
          candidateRecordKeys: [],
        })
        .map((r) => r.ruleIdentity),
    ).toEqual(['house']);
    expect(seam.activeRulingsForAmbiguities(['not-q'])).toEqual([]);
    db.close();
  });
});
