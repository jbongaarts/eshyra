import type { Db } from '../persistence/db.js';
import { optRulesAmbiguities } from '../rules/rulesAmbiguities.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import type { RulesAmbiguity } from '../rules/types.js';
import {
  listActiveCampaignRulesAtPosition,
  listActiveRulingsForAmbiguitiesAtPosition,
} from './campaignRuleStore.js';
import {
  CampaignRuleError,
  type CampaignRuleProjection,
  type CampaignRulingProjection,
  projectCampaignRule,
} from './campaignRules.js';

export interface CampaignAmbiguityContext {
  readonly ambiguity: RulesAmbiguity;
  readonly ruling: CampaignRulingProjection | undefined;
}

export interface CampaignRulesContext {
  readonly position: string;
  readonly rules: readonly CampaignRuleProjection[];
  /** Active rulings whose ambiguity is absent from the bound pack. */
  readonly unboundRulings: readonly CampaignRulingProjection[];
  readonly ambiguities: readonly CampaignAmbiguityContext[];
}

function ambiguitiesFromStack(stack: ResolvedRulesStack): RulesAmbiguity[] {
  const found = new Map<string, RulesAmbiguity>();
  for (const entry of stack.recordsByKey.values()) {
    const data = entry.record.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data))
      continue;
    const mechanics = (data as { mechanics?: unknown }).mechanics;
    if (
      typeof mechanics !== 'object' ||
      mechanics === null ||
      Array.isArray(mechanics)
    )
      continue;
    const ambiguityIds = optRulesAmbiguities(
      mechanics as Record<string, unknown>,
      `${entry.record.key}.data.mechanics`,
    );
    const values = (mechanics as { ambiguities?: unknown }).ambiguities;
    if (!Array.isArray(values) || ambiguityIds.size === 0) continue;
    for (const value of values) {
      const ambiguity = value as RulesAmbiguity;
      found.set(ambiguity.id, ambiguity);
    }
  }
  return [...found.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** Shared DM/auditor projection of campaign prose and immutable ambiguity metadata. */
export function assembleCampaignRulesContext(
  db: Db,
  campaignId: string,
  position: string,
  stack: ResolvedRulesStack,
): CampaignRulesContext {
  const ambiguities = ambiguitiesFromStack(stack);
  const ambiguityIds = new Set(ambiguities.map((item) => item.id));
  const activeRules = listActiveCampaignRulesAtPosition(
    db,
    campaignId,
    position,
  );
  const rulings = listActiveRulingsForAmbiguitiesAtPosition(
    db,
    campaignId,
    [...ambiguityIds],
    position,
  );
  const rulingByAmbiguity = new Map<string, CampaignRulingProjection>();
  for (const ruling of rulings) {
    if (rulingByAmbiguity.has(ruling.ambiguityId))
      throw new CampaignRuleError(
        `multiple active campaign rulings for ambiguity '${ruling.ambiguityId}'`,
      );
    rulingByAmbiguity.set(ruling.ambiguityId, ruling);
  }
  return {
    position,
    rules: activeRules
      .filter((rule) => rule.provenance.kind !== 'ambiguity')
      .map(projectCampaignRule),
    unboundRulings: activeRules
      .filter(
        (
          rule,
        ): rule is typeof rule & {
          provenance: Extract<typeof rule.provenance, { kind: 'ambiguity' }>;
        } =>
          rule.provenance.kind === 'ambiguity' &&
          !ambiguityIds.has(rule.provenance.ambiguityId),
      )
      .map((rule) => projectCampaignRule(rule))
      .filter(
        (rule): rule is CampaignRulingProjection =>
          rule.ruleKind === 'ruling' &&
          'selectedInterpretationId' in rule &&
          typeof rule.selectedInterpretationId === 'string',
      ),
    ambiguities: ambiguities.map((ambiguity) => ({
      ambiguity,
      ruling: rulingByAmbiguity.get(ambiguity.id),
    })),
  };
}
