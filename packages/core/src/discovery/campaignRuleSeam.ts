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

/**
 * Join active campaign rules and rulings to the candidates they govern.
 *
 * `campaign-rule` is a discovery ROUTE, not decoration. Design section 6.2
 * lists it as a way a candidate can be proposed, and section 6.3 makes an
 * applicable active rule must-consider. An earlier revision attached a rule
 * only when its governing record was already a candidate by some other route,
 * which meant P10 passed solely because Fireball is independently found by
 * exact name and the jhpt route could never surface governing material on its
 * own. A governing record that resolves in the active stack therefore ENTERS
 * as a candidate here.
 *
 * A rule is `unplaced` only when none of its governing keys resolve at all;
 * that is recorded as a loss and the rule does not silently vanish. An
 * unplaced ruling does not resolve its ambiguity — the uncertainty is
 * preserved (design section 8.2 R7).
 */
export function joinCampaignRules(
  candidates: readonly DiscoveryCandidate[],
  seam: CampaignRuleReadSeam = NULL_CAMPAIGN_RULE_SEAM,
  options: {
    readonly campaignPosition?: string;
    readonly stack?: {
      readonly recordsByKey: ReadonlyMap<
        string,
        NonNullable<DiscoveryCandidate['entry']>
      >;
    };
  } = {},
): RuleJoinTrace {
  const keys = candidates.map((candidate) => candidate.candidateKey);
  const rawAmbiguities = ambiguities(candidates);
  const ambiguityIds = rawAmbiguities
    .filter((item) => typeof item.id === 'string')
    .map((item) => item.id as string);
  const rules = seam.activeRulesAtPosition({
    campaignPosition: options.campaignPosition,
    candidateRecordKeys: keys,
  });
  const rulings = seam.activeRulingsForAmbiguities(ambiguityIds);
  const result = new Map(
    candidates.map((candidate) => [candidate.candidateKey, candidate]),
  );
  const placedRules: RuleJoinTrace['placedRules'][number][] = [];
  const losses: RuleJoinTrace['losses'][number][] = [];
  const returned: string[] = [];
  const placedIdentities = new Set<string>();
  const unplaced: string[] = [];
  const surfaced: string[] = [];
  for (const projection of [...rules, ...rulings]) {
    returned.push(projection.ruleIdentity);
    const governed: string[] = [];
    for (const key of projection.governingRecordKeys) {
      if (result.has(key)) {
        governed.push(key);
        continue;
      }
      // The jhpt route surfaces governing material the rest of discovery did
      // not reach. Only a key the active stack can resolve may enter.
      const entry = options.stack?.recordsByKey.get(key);
      if (entry === undefined) continue;
      result.set(key, {
        candidateKey: key,
        targetKind: 'rules-record',
        entry,
        routes: [],
        traversals: [],
        campaignRules: [],
        campaignRulings: [],
      });
      surfaced.push(key);
      governed.push(key);
    }
    if (governed.length === 0) {
      unplaced.push(projection.ruleIdentity);
      losses.push({
        reason: 'unplaced-rule',
        detail: {
          ruleIdentity: projection.ruleIdentity,
          governingRecordKeys: projection.governingRecordKeys,
        },
      });
      continue;
    }
    placedIdentities.add(projection.ruleIdentity);
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
  // Only a ruling that was actually placed resolves its ambiguity. Treating
  // every returned ruling as resolving would report a resolution the packet
  // never carried.
  const resolved = new Set(
    rulings
      .filter((ruling) => placedIdentities.has(ruling.ruleIdentity))
      .map((ruling) => ruling.ambiguityId),
  );
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
    returnedRuleIdentities: returned,
    placedRuleIdentities: [...placedIdentities],
    unplacedRuleIdentities: unplaced,
    surfacedCandidateKeys: surfaced,
    placedRules,
    unresolvedAmbiguities,
  };
}

export { NULL_CAMPAIGN_RULE_SEAM };
