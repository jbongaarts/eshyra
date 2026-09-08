import type {
  CampaignRuleReadSeam,
  CampaignRulesPackResolver,
  Db,
} from '../../../src/internal.js';
import {
  createCampaignRule,
  createCampaignRuleReadSeam,
  formatCampaignPosition,
  recordAmbiguityRuling,
  resolveCampaignPosition,
} from '../../../src/internal.js';
import type {
  DiagnosticFixture,
  FixtureExecution,
} from '../../diagnostics/fixtureContract.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
} from '../../support/db.js';

/**
 * W11 (`eshyra-o9bd.19.13`): the probe runs consume the REAL `eshyra-jhpt`
 * campaign-rule runtime, not a discovery-local stand-in.
 *
 * The W8 stub satisfied the same seam shape but answered from fixture prose,
 * so it could never demonstrate that a jhpt projection survives placement, or
 * that supersession and revocation change what discovery receives. Everything
 * here writes through jhpt's own writers (`recordAmbiguityRuling`,
 * `createCampaignRule`) and reads back through `createCampaignRuleReadSeam`,
 * which is the same active-at-position query the auditor uses.
 *
 * What this module supplies is CAMPAIGN STATE, exactly as a campaign that had
 * recorded these decisions would hold it. It is still oracle-supplied for
 * probe-reporting purposes -- the fixture, not discovery, decides that the
 * rule exists -- so probe runs continue to label it. It supplies no rule
 * schema, no resolution, no store: `governingRecordKeys`, identity, status,
 * provenance and effective position all come back from jhpt.
 */
export interface JhptCampaignRuleInstallation {
  /** Canonical position the discovery run must be executed at. */
  readonly campaignPosition: string;
  readonly seam: CampaignRuleReadSeam;
  /** Durable identities jhpt assigned, never invented by the fixture. */
  readonly ruleIdentities: readonly string[];
}

const AUTHORING_TURN_ID = 'w11-authoring-turn';
const DISCOVERY_TURN_ID = 'w11-discovery-turn';

/**
 * Persist the fixture's declared campaign-rule cases through jhpt and return a
 * seam bound to the position the run adjudicates at.
 *
 * Rules are authored at the current turn and take effect prospectively at the
 * next one, because that is the only lifecycle jhpt accepts for a live write;
 * the discovery turn is then allocated so the rule is active at the position
 * the seam is bound to. A fixture declaring no rule state still gets a real
 * seam over a real (empty) campaign, which is the absence case R7 requires
 * rather than a hole in the evidence.
 */
export function installJhptCampaignRules(
  db: Db,
  fixture: DiagnosticFixture,
  execution: FixtureExecution,
  resolveRulesPack?: CampaignRulesPackResolver,
): JhptCampaignRuleInstallation {
  const campaignId = DEFAULT_TEST_CAMPAIGN_ID;
  const authoringPosition = resolveCampaignPosition(db, {
    campaignId,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: AUTHORING_TURN_ID,
  });
  const effectivePosition = {
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: DISCOVERY_TURN_ID,
    ordinal: authoringPosition.ordinal + 1,
  };
  const declared = execution.expectedCampaignRuleOrRulingState;
  const ruleIdentities: string[] = [];
  if ('cases' in declared) {
    for (const item of declared.cases) {
      if (
        item.ambiguityId !== undefined &&
        item.selectedInterpretationId !== undefined
      ) {
        const { rule } = recordAmbiguityRuling(db, {
          campaignId,
          ambiguityId: item.ambiguityId,
          interpretationId: item.selectedInterpretationId,
          prose: item.statement,
          currentPosition: authoringPosition,
          effectiveOrdinal: effectivePosition.ordinal,
          sessionId: DEFAULT_TEST_SESSION_ID,
          ...(resolveRulesPack === undefined ? {} : { resolveRulesPack }),
        });
        ruleIdentities.push(rule.ruleIdentity);
        continue;
      }
      if (item.ruleKind !== 'house-rule')
        throw new Error(
          `fixture ${fixture.probeId} case '${item.caseId}' declares ruleKind '${String(item.ruleKind)}' without ambiguity provenance, which eshyra-jhpt does not accept; W11 may not invent a substitute shape`,
        );
      // A house rule's governing association is authored, not derived: jhpt
      // stores what the campaign author named and discovery reads it back.
      const governingRecordKeys = fixture.mustIncludeTargets
        .filter((target) => target.targetKind === 'rules-record')
        .map((target) => target.recordKey);
      if (governingRecordKeys.length === 0)
        throw new Error(
          `fixture ${fixture.probeId} case '${item.caseId}' declares a house rule with no rules-record target to govern`,
        );
      const rule = createCampaignRule(
        db,
        {
          ruleIdentity: `house-rule:${fixture.probeId}:${item.caseId}`,
          campaignId,
          ruleKind: 'house-rule',
          status: 'active',
          origin: 'player-authored',
          provenance: { kind: 'house-rule', rationale: item.provenance },
          effectivePosition,
          temporalMode: { mode: 'prospective' },
          supersededBy: null,
          revokedPosition: null,
          scope: item.scope ?? 'campaign',
          governingRecordKeys,
          prose: item.statement,
        },
        {
          currentPosition: authoringPosition,
          sessionId: DEFAULT_TEST_SESSION_ID,
        },
      );
      ruleIdentities.push(rule.ruleIdentity);
    }
  }
  const discoveryPosition = resolveCampaignPosition(db, {
    campaignId,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: DISCOVERY_TURN_ID,
  });
  return {
    campaignPosition: formatCampaignPosition(discoveryPosition),
    seam: createCampaignRuleReadSeam(
      db,
      campaignId,
      formatCampaignPosition(discoveryPosition),
    ),
    ruleIdentities,
  };
}
