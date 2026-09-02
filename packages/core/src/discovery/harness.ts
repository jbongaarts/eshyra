import { resolveStrictCampaignRulesStack } from '../state/campaignRecordLookup.js';
import { candidateBand } from './bands.js';
import { joinCampaignRules } from './campaignRuleSeam.js';
import { resolveDiscoveryCandidates } from './candidates.js';
import { deduplicateCandidates } from './dedup.js';
import { expandTypedRelationships } from './expansion.js';
import { buildContextPacket } from './packet.js';
import { retainCandidates } from './retention.js';
import { extractDiscoverySignals } from './signals.js';
import type { DiscoveryRunInput, DiscoveryTrace } from './types.js';

/** Execute the seven offline stages. The database is used only to resolve the
 * active rules stack; the returned trace is the sole evidence surface. */
export function runDiscoveryStages(input: DiscoveryRunInput): DiscoveryTrace {
  const stack = resolveStrictCampaignRulesStack(
    input.db,
    input.rulesPackResolver,
  );
  const signals = extractDiscoverySignals(input.scenario, stack);
  const candidates = resolveDiscoveryCandidates(signals, stack, input.scenario);
  const expansion = expandTypedRelationships(candidates.outputsProduced, stack);
  const ruleJoin = joinCampaignRules(
    expansion.outputsProduced,
    input.campaignRuleSeam,
    {
      campaignPosition:
        input.campaignPosition ??
        (typeof input.scenario.stateFields.campaignPosition === 'string'
          ? input.scenario.stateFields.campaignPosition
          : undefined),
      stack,
    },
  );
  // Design section 12.1: the join is the only stage that can change a
  // candidate's band, so expansion repeats exactly once more, seeded only by
  // the candidates it promoted to must-consider. Without this, a governing
  // record reached only by `campaign-rule` could never receive the one-hop
  // Related neighbourhood section 6.3 grants must-consider material.
  const bandBeforeJoin = new Map(
    expansion.outputsProduced.map((candidate) => [
      candidate.candidateKey,
      candidateBand(candidate),
    ]),
  );
  const promoted = new Set(
    ruleJoin.outputsProduced
      .filter(
        (candidate) =>
          candidateBand(candidate) === 'must-consider' &&
          bandBeforeJoin.get(candidate.candidateKey) !== 'must-consider',
      )
      .map((candidate) => candidate.candidateKey),
  );
  const ruleExpansion = expandTypedRelationships(
    ruleJoin.outputsProduced,
    stack,
    {
      seedKeys: promoted,
      stageName: 'campaign-rule-expansion',
      conditional: true,
    },
  );
  // Design section 12.1: the second expansion can reach records carrying
  // ambiguities that the first join never saw, so the seam is queried once
  // more for the newly appeared keys and newly discovered ambiguity ids.
  // Without this a discovered ambiguity could reach the packet having never
  // been offered to jhpt, which is the silent-uncertainty failure 8.2 R7
  // exists to prevent.
  const bandBeforeLateJoin = new Map(
    ruleExpansion.outputsProduced.map((candidate) => [
      candidate.candidateKey,
      candidateBand(candidate),
    ]),
  );
  const lateRuleJoin = joinCampaignRules(
    ruleExpansion.outputsProduced,
    input.campaignRuleSeam,
    {
      stack,
      stageName: 'late-ruling-join',
      conditional: true,
      // Rulings only. Active rules came once from the complete
      // active-at-position query in the first join; see design section 12.1,
      // "the join boundary".
      rulingsOnly: true,
      seenAmbiguityIds: new Set(ruleJoin.requestedAmbiguityIds),
      resolvedAmbiguityIds: new Set(ruleJoin.resolvedAmbiguityIds),
    },
  );
  // The residual design section 12.1 names rather than hides: a record the late join
  // promoted to must-consider is entitled to a Related neighbourhood under
  // section 6.3, but expansion is bounded at two passes. Those records are
  // recorded, reported per probe, and are bounded evidence about the pilot.
  const unexpandedPromotions = lateRuleJoin.outputsProduced
    .filter(
      (candidate) =>
        candidateBand(candidate) === 'must-consider' &&
        bandBeforeLateJoin.get(candidate.candidateKey) !== 'must-consider',
    )
    .map((candidate) => candidate.candidateKey);
  const dedup = deduplicateCandidates(lateRuleJoin.outputsProduced);
  const retention = retainCandidates(dedup.outputsProduced, input.budget);
  // A must-consider overflow must be REPORTED, not thrown (design section 6.3):
  // the overflow record naming every dropped candidate and its routes is the
  // evidence, and throwing would destroy the trace that carries it. The probe
  // runner fails the probe on `m6.overflowed`.
  const packet = buildContextPacket(
    retention,
    input.scenario.declaredCapabilities ?? [],
    input.budget?.maxPacketBytes,
  );
  return {
    signals,
    candidates,
    expansion,
    ruleJoin,
    ruleExpansion,
    lateRuleJoin,
    unexpandedPromotions,
    dedup,
    retention,
    packet,
    stageOrder: [
      'signals',
      'candidates',
      'expansion',
      'rule-join',
      'campaign-rule-expansion',
      'late-ruling-join',
      'dedup',
      'retention',
      'packet',
    ],
    stack,
  };
}
