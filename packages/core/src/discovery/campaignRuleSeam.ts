import { accountCandidates } from './accounting.js';
import type {
  CampaignRuleProjection,
  CampaignRuleReadSeam,
  CampaignRulingProjection,
  DiscoveryCandidate,
  RuleJoinTrace,
} from './types.js';
import { NULL_CAMPAIGN_RULE_SEAM } from './types.js';

function isAmbiguityRuling(
  projection: CampaignRuleProjection,
): projection is CampaignRulingProjection {
  return (
    projection.ruleKind === 'ruling' &&
    projection.ambiguityId !== undefined &&
    'selectedInterpretationId' in projection &&
    typeof projection.selectedInterpretationId === 'string'
  );
}

function withRule(
  candidate: DiscoveryCandidate,
  projection: CampaignRuleProjection,
): DiscoveryCandidate {
  const ambiguityRuling = isAmbiguityRuling(projection);
  const route = {
    routeClass: ambiguityRuling
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
    campaignRules: ambiguityRuling
      ? candidate.campaignRules
      : [...candidate.campaignRules, projection],
    campaignRulings: ambiguityRuling
      ? [...candidate.campaignRulings, projection]
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
    readonly stageName?: string;
    readonly conditional?: boolean;
    /**
     * Rulings only, for ambiguity ids discovered after the first join.
     *
     * `eshyra-jhpt.3` requires the active-at-position query to return all and
     * only the rules active at the current position, and W11 requires
     * discovery to consume that query rather than redefine it. Active rules
     * are therefore retrieved exactly once. Re-querying them against a later
     * candidate set would either duplicate what a contract-faithful jhpt
     * already returned, or make active-rule applicability depend on discovery
     * progress -- a change to jhpt-owned semantics W8 may not make.
     *
     * A late-stage ruling also may not introduce a new candidate: that is
     * what closes the pipeline, since nothing can then appear carrying an
     * ambiguity after the final ruling query.
     */
    readonly rulingsOnly?: boolean;
    readonly seenAmbiguityIds?: ReadonlySet<string>;
    /** Ambiguities an earlier join already resolved. Without these the late
     * join reports them unresolved, because its own `resolved` set contains
     * only the rulings IT placed. */
    readonly resolvedAmbiguityIds?: ReadonlySet<string>;
    /** Rule identities already processed by an earlier bounded join pass. */
    readonly seenRuleIdentities?: ReadonlySet<string>;
  } = {},
): RuleJoinTrace {
  const keys = candidates.map((candidate) => candidate.candidateKey);
  const rawAmbiguities = ambiguities(candidates);
  const ambiguityIds = [
    ...new Set(
      rawAmbiguities
        .filter((item) => typeof item.id === 'string')
        .map((item) => item.id as string)
        .filter((id) => options.seenAmbiguityIds?.has(id) !== true),
    ),
  ];
  // Only a CONDITIONAL join may decline to ask. The first join must always
  // query the seam: R1 is about active rules applicable to the situation, not
  // about whether discovery already found candidates, so a rule can surface
  // governing material even when nothing else did.
  // A rulings-only stage has work exactly when there is a newly discovered
  // ambiguity id to ask about; the candidate set is irrelevant to it because
  // active rules were already retrieved once, in full, by the first join.
  const asked =
    options.rulingsOnly === true
      ? ambiguityIds.length > 0
      : options.conditional !== true ||
        keys.length > 0 ||
        ambiguityIds.length > 0;
  // Request evidence is derived from the calls that ACTUALLY executed, never
  // from what this stage could have asked. A rulings-only stage does not call
  // the active-rule query, so it must not report requested rule-record keys:
  // that would claim a second position query the jhpt boundary forbids and
  // this stage never made.
  // Request evidence is derived from the calls that ACTUALLY executed, never
  // from what this stage could have asked. A rulings-only stage does not call
  // the active-rule query, so it must not report requested rule-record keys:
  // that would claim a second position query the jhpt boundary forbids and
  // this stage never made. Execution is tracked separately from the arguments
  // because a position query over an empty candidate set still ran.
  const ruleQueryExecuted = asked && options.rulingsOnly !== true;
  const rulingQueryExecuted = asked;
  const requestedRuleRecordKeys: readonly string[] = ruleQueryExecuted
    ? keys
    : [];
  const requestedAmbiguityIds: readonly string[] = rulingQueryExecuted
    ? ambiguityIds
    : [];
  const rulingQueryScope: RuleJoinTrace['rulingQueryScope'] =
    !rulingQueryExecuted
      ? 'none'
      : options.rulingsOnly === true
        ? 'requested-ambiguities'
        : 'all-active';
  const rules = ruleQueryExecuted
    ? seam.activeRulesAtPosition({
        campaignPosition: options.campaignPosition,
        candidateRecordKeys: keys,
      })
    : [];
  const rulings = rulingQueryExecuted
    ? seam.activeRulingsForAmbiguities(ambiguityIds, {
        includeAllActive: options.rulingsOnly !== true,
      })
    : [];
  const result = new Map(
    candidates.map((candidate) => [candidate.candidateKey, candidate]),
  );
  const placedRules: RuleJoinTrace['placedRules'][number][] = [];
  const losses: RuleJoinTrace['losses'][number][] = [];
  const returned: string[] = [];
  const placedIdentities = new Set<string>();
  const unplaced: string[] = [];
  const surfaced: string[] = [];
  const projections = [...rules, ...rulings].filter(
    (projection, index, all) =>
      options.seenRuleIdentities?.has(projection.ruleIdentity) !== true &&
      all.findIndex((item) => item.ruleIdentity === projection.ruleIdentity) ===
        index,
  );
  for (const projection of projections) {
    returned.push(projection.ruleIdentity);
    const governed: string[] = [];
    for (const key of projection.governingRecordKeys) {
      if (result.has(key)) {
        governed.push(key);
        continue;
      }
      // The jhpt route surfaces governing material the rest of discovery did
      // not reach. Only a key the active stack can resolve may enter, and the
      // late stage may not surface at all (design section 12.1, Closure).
      const entry =
        options.rulingsOnly === true
          ? undefined
          : options.stack?.recordsByKey.get(key);
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
  const resolved = new Set([
    ...(options.resolvedAmbiguityIds ?? []),
    ...rulings
      .filter((ruling) => placedIdentities.has(ruling.ruleIdentity))
      .map((ruling) => ruling.ambiguityId),
  ]);
  const unresolvedAmbiguities = rawAmbiguities
    .filter((item) => typeof item.id === 'string' && !resolved.has(item.id))
    .map(
      (item) => item as unknown as import('../rules/types.js').RulesAmbiguity,
    );
  const outputs = [...result.values()];
  const accounting = accountCandidates(candidates, outputs);
  // A query that executed and returned nothing still RAN: under section 8.2 R7
  // that absence is itself evidence. Only a stage with nothing to ask about
  // is skipped.
  const didWork = asked;
  return {
    stage: options.stageName ?? 'rule-join',
    produced: accounting.produced,
    modified: accounting.modified,
    carriedForward: accounting.carriedForward,
    outcome: didWork
      ? 'ran'
      : options.conditional === true
        ? 'skipped'
        : 'failed-to-run',
    failedToRun: !didWork && options.conditional !== true,
    inputsConsumed: [
      {
        ruleQueryExecuted,
        requestedRuleRecordKeys,
        rulingQueryExecuted,
        requestedAmbiguityIds,
        rulingQueryScope,
      },
    ],
    outputsProduced: [...result.values()],
    losses,
    requestedRuleRecordKeys,
    requestedAmbiguityIds,
    rulingQueryScope,
    ruleQueryExecuted,
    rulingQueryExecuted,
    returnedRuleIdentities: returned,
    placedRuleIdentities: [...placedIdentities],
    unplacedRuleIdentities: unplaced,
    surfacedCandidateKeys: surfaced,
    placedRules,
    resolvedAmbiguityIds: [...resolved],
    unresolvedAmbiguities,
  };
}

export { NULL_CAMPAIGN_RULE_SEAM };
