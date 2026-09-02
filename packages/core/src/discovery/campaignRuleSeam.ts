import type {
  CampaignRuleProjection,
  CampaignRuleReadSeam,
  CampaignRulingProjection,
  DiscoveryCandidate,
  RuleJoinTrace,
} from './types.js';
import { NULL_CAMPAIGN_RULE_SEAM } from './types.js';

function withRule(
  candidate: DiscoveryCandidate,
  projection: CampaignRuleProjection,
): DiscoveryCandidate {
  const route = {
    routeClass:
      projection.ruleKind === 'ruling'
        ? ('campaign-ruling' as const)
        : ('campaign-rule' as const),
    trigger: projection.ruleIdentity,
    evidence: projection as unknown as Record<string, unknown>,
    signalId: `campaign-rule:${projection.ruleIdentity}`,
  };
  return {
    ...candidate,
    routes: candidate.routes.some((item) => item.trigger === route.trigger)
      ? candidate.routes
      : [...candidate.routes, route],
    campaignRules:
      projection.ruleKind === 'ruling'
        ? candidate.campaignRules
        : [...candidate.campaignRules, projection],
    campaignRulings:
      projection.ruleKind === 'ruling'
        ? [...candidate.campaignRulings, projection as CampaignRulingProjection]
        : candidate.campaignRulings,
  };
}

function ambiguities(candidates: readonly DiscoveryCandidate[]) {
  return candidates.flatMap((candidate): Record<string, unknown>[] => {
    const raw = candidate.entry?.record.data;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      return [];
    const mechanics = (raw as Record<string, unknown>).mechanics;
    if (
      typeof mechanics !== 'object' ||
      mechanics === null ||
      Array.isArray(mechanics)
    )
      return [];
    const values = (mechanics as Record<string, unknown>).ambiguities;
    if (!Array.isArray(values)) return [];
    return values.filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    );
  });
}

export function joinCampaignRules(
  candidates: readonly DiscoveryCandidate[],
  seam: CampaignRuleReadSeam = NULL_CAMPAIGN_RULE_SEAM,
  campaignPosition?: string,
): RuleJoinTrace {
  const keys = candidates.map((candidate) => candidate.candidateKey);
  const rawAmbiguities = ambiguities(candidates);
  const ambiguityIds = rawAmbiguities
    .filter((item) => typeof item.id === 'string')
    .map((item) => item.id as string);
  const rules = seam.activeRulesAtPosition({
    campaignPosition,
    candidateRecordKeys: keys,
  });
  const rulings = seam.activeRulingsForAmbiguities(ambiguityIds);
  const result = new Map(
    candidates.map((candidate) => [candidate.candidateKey, candidate]),
  );
  const placedRules: RuleJoinTrace['placedRules'][number][] = [];
  const losses: RuleJoinTrace['losses'][number][] = [];
  for (const projection of [...rules, ...rulings]) {
    const governed = projection.governingRecordKeys.filter((key) =>
      result.has(key),
    );
    if (governed.length === 0) {
      losses.push({
        reason: 'unplaced-rule',
        detail: {
          ruleIdentity: projection.ruleIdentity,
          governingRecordKeys: projection.governingRecordKeys,
        },
      });
      continue;
    }
    for (const key of governed) {
      result.set(
        key,
        withRule(result.get(key) as DiscoveryCandidate, projection),
      );
      placedRules.push({
        ruleIdentity: projection.ruleIdentity,
        governingRecordKey: key,
      });
    }
  }
  const resolved = new Set(rulings.map((ruling) => ruling.ambiguityId));
  const unresolvedAmbiguities = rawAmbiguities
    .filter((item) => typeof item.id === 'string' && !resolved.has(item.id))
    .map(
      (item) => item as unknown as import('../rules/types.js').RulesAmbiguity,
    );
  return {
    stage: 'rule-join',
    inputsConsumed: [{ candidateRecordKeys: keys, ambiguityIds }],
    outputsProduced: [...result.values()],
    losses,
    failedToRun: result.size === 0 && losses.length === 0,
    requestedRuleRecordKeys: keys,
    requestedAmbiguityIds: ambiguityIds,
    placedRules,
    unresolvedAmbiguities,
  };
}

export { NULL_CAMPAIGN_RULE_SEAM };
