import { describe, expect, it } from 'vitest';
import type { FixtureExecution } from '../diagnostics/fixtureContract.js';
import { P10_MATERIAL_COMPONENTS_HOUSE_RULE } from '../diagnostics/index.js';
import { oracleCampaignRuleSeam } from './support/oracleCampaignRules.js';

describe('oracle campaign-rule seam', () => {
  it('honors the includeAllActive contract for ruling queries', () => {
    const base = P10_MATERIAL_COMPONENTS_HOUSE_RULE.executions[0];
    if (base === undefined) throw new Error('P10 execution missing');
    const execution: FixtureExecution = {
      ...base,
      expectedCampaignRuleOrRulingState: {
        kind: 'campaign-rule-cases',
        cases: [
          {
            caseId: 'ruling',
            ruleIdentity: 'oracle-ruling',
            ruleKind: 'ruling',
            ambiguityId: 'ambiguity:not-requested',
            selectedInterpretationId: 'interpretation:one',
            statement: 'oracle ruling',
          },
        ],
      },
    };
    const seam = oracleCampaignRuleSeam(
      P10_MATERIAL_COMPONENTS_HOUSE_RULE,
      execution,
    );

    expect(
      seam.activeRulingsForAmbiguities(['ambiguity:other'], {
        includeAllActive: true,
      }),
    ).toEqual([expect.objectContaining({ ruleIdentity: 'oracle-ruling' })]);
    expect(seam.activeRulingsForAmbiguities(['ambiguity:other'])).toEqual([]);
  });
});
