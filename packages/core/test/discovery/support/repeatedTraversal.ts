import type {
  CampaignRuleReadSeam,
  Db,
  TypedTraversal,
} from '../../../src/internal.js';
import {
  createCampaignRule,
  createCampaignRuleReadSeam,
  formatCampaignPosition,
  resolveCampaignPosition,
} from '../../../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
} from '../../support/db.js';

/**
 * Campaign state that makes one real typed relationship fire in BOTH expansion
 * passes, over live SRD material.
 *
 * The chain the design's bounded two-pass architecture actually produces:
 *
 * 1. live state names `condition:incapacitated`, a `direct-state-ref` and so
 *    must-consider;
 * 2. the first expansion traverses the inbound
 *    `action:dodge -> condition:incapacitated` exclusion edge, which creates
 *    `action:dodge` as a Related candidate carrying that traversal;
 * 3. an active house rule governing `action:dodge` gives it a `campaign-rule`
 *    route at the join, promoting it to must-consider;
 * 4. `campaign-rule-expansion` is seeded by that promotion and traverses the
 *    SAME edge again, because Dodge is now an expansion origin.
 *
 * Cumulative candidate state does not move in step 4 — `withLink()` will not
 * add a traversal a candidate already carries — so the second execution is
 * visible ONLY as the stage's own traversal event. That is the state a
 * derivation defining "the stage traversed this" as "newly appeared on the
 * candidate stream" cannot represent, and it is why the event is persisted.
 */
export const REPEATED_TRAVERSAL: TypedTraversal = {
  sourceRecordKey: 'action:dodge',
  linkField: 'data.mechanics.conditions',
  relation: 'exclusion',
  targetRecordKey: 'condition:incapacitated',
};

export const REPEATED_TRAVERSAL_STATE_FIELDS: Readonly<
  Record<string, unknown>
> = { conditions: ['condition:incapacitated'] };

export const REPEATED_TRAVERSAL_INPUT = 'I brace myself against the pain.';

export interface RepeatedTraversalCampaign {
  readonly campaignPosition: string;
  readonly seam: CampaignRuleReadSeam;
  readonly ruleIdentity: string;
}

/**
 * Write the governing house rule through jhpt's own writer and return a read
 * seam bound to the position the run adjudicates at. Discovery is handed a
 * seam and never reaches into the campaign-rule store (design section 8.4).
 */
export function installRepeatedTraversalCampaign(
  db: Db,
): RepeatedTraversalCampaign {
  const authoring = resolveCampaignPosition(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'repeated-traversal-authoring',
  });
  const rule = createCampaignRule(
    db,
    {
      ruleIdentity: 'house-rule:dodge-while-incapacitated',
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      ruleKind: 'house-rule',
      status: 'active',
      origin: 'player-authored',
      provenance: {
        kind: 'house-rule',
        rationale: 'Table decision recorded at session start.',
      },
      effectivePosition: {
        sessionId: DEFAULT_TEST_SESSION_ID,
        turnId: 'repeated-traversal-discovery',
        ordinal: authoring.ordinal + 1,
      },
      temporalMode: { mode: 'prospective' },
      supersededBy: null,
      revokedPosition: null,
      scope: 'campaign',
      governingRecordKeys: [REPEATED_TRAVERSAL.sourceRecordKey],
      prose: 'At this table, Dodge still costs your action while pressed.',
    },
    { currentPosition: authoring, sessionId: DEFAULT_TEST_SESSION_ID },
  );
  const position = resolveCampaignPosition(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'repeated-traversal-discovery',
  });
  const campaignPosition = formatCampaignPosition(position);
  return {
    campaignPosition,
    seam: createCampaignRuleReadSeam(
      db,
      DEFAULT_TEST_CAMPAIGN_ID,
      campaignPosition,
    ),
    ruleIdentity: rule.ruleIdentity,
  };
}
