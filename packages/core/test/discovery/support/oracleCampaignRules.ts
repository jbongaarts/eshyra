import type {
  CampaignRuleProjection,
  CampaignRuleReadSeam,
  CampaignRulingProjection,
} from '../../../src/internal.js';
import type {
  DiagnosticFixture,
  FixtureExecution,
} from '../../diagnostics/fixtureContract.js';

/** Test-only jhpt stand-in. It is intentionally keyed by fixture execution,
 * and contains no campaign-rule persistence or resolution behavior. */
export function oracleCampaignRuleSeam(
  fixture: DiagnosticFixture,
  execution: FixtureExecution,
): CampaignRuleReadSeam {
  const cases = execution.expectedCampaignRuleOrRulingState;
  if (!('cases' in cases))
    return {
      activeRulesAtPosition: () => [],
      activeRulingsForAmbiguities: () => [],
    };
  const projections: CampaignRuleProjection[] = cases.cases
    .filter(
      (item) =>
        item.ruleKind === 'house-rule' ||
        (item.ruleKind === 'ruling' &&
          item.ambiguityId === undefined &&
          item.selectedInterpretationId === undefined),
    )
    .map((item) => ({
      ruleIdentity: item.ruleIdentity ?? item.caseId,
      ruleKind: item.ruleKind === 'ruling' ? 'ruling' : 'house-rule',
      status: 'active',
      origin: 'oracle-supplied',
      provenance: item.provenance ?? 'oracle-supplied',
      effectivePosition: item.scope ?? 'current',
      supersededBy: null,
      revokedPosition: null,
      scope: item.scope ?? 'current',
      governingRecordKeys: fixture.mustIncludeTargets
        .filter((target) => target.targetKind === 'rules-record')
        .map((target) => target.recordKey),
      oracleSupplied: true,
      prose: item.statement,
    }));
  const rulings: CampaignRulingProjection[] = cases.cases
    .filter(
      (item) =>
        item.ruleKind === 'ruling' &&
        item.ambiguityId !== undefined &&
        item.selectedInterpretationId !== undefined,
    )
    .map((item) => ({
      ruleIdentity: item.ruleIdentity ?? item.caseId,
      ruleKind: 'ruling',
      status: 'active',
      origin: 'oracle-supplied',
      provenance: item.provenance ?? 'oracle-supplied',
      effectivePosition: item.scope ?? 'current',
      supersededBy: null,
      revokedPosition: null,
      scope: item.scope ?? 'current',
      governingRecordKeys: fixture.mustIncludeTargets
        .filter((target) => target.targetKind === 'rules-record')
        .map((target) => target.recordKey),
      ambiguityId: item.ambiguityId as string,
      selectedInterpretationId: item.selectedInterpretationId as string,
      oracleSupplied: true,
      prose: item.statement,
    }));
  return {
    activeRulesAtPosition: () => projections,
    activeRulingsForAmbiguities: (ids, options) =>
      options?.includeAllActive === true
        ? rulings
        : rulings.filter((item) => ids.includes(item.ambiguityId)),
  };
}
