import { resolveStrictCampaignRulesStack } from '../state/campaignRecordLookup.js';
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
  const dedup = deduplicateCandidates(ruleJoin.outputsProduced);
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
    dedup,
    retention,
    packet,
    stageOrder: [
      'signals',
      'candidates',
      'expansion',
      'rule-join',
      'dedup',
      'retention',
      'packet',
    ],
    stack,
  };
}
