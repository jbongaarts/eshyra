import {
  getBundledDnd5eSrdFieldProvenanceManifest,
  getBundledDnd5eSrdPack,
  getBundledDnd5eSrdRecordRelationshipManifest,
} from '../rules/bundledSrdPack.js';
import { resolveStrictCampaignRulesStack } from '../state/campaignRecordLookup.js';
import { candidateBand } from './bands.js';
import { joinCampaignRules } from './campaignRuleSeam.js';
import { resolveDiscoveryCandidates } from './candidates.js';
import { deduplicateCandidates } from './dedup.js';
import { expandTypedRelationships } from './expansion.js';
import { buildContextPacket } from './packet.js';
import { retainCandidates } from './retention.js';
import { extractDiscoverySignals } from './signals.js';
import type {
  DiscoveryRunInput,
  DiscoveryTrace,
  FieldProvenanceSource,
} from './types.js';

/** Execute the seven offline stages. The database is used only to resolve the
 * active rules stack; the returned trace is the sole evidence surface. */
export function runDiscoveryStages(input: DiscoveryRunInput): DiscoveryTrace {
  const stack =
    input.stack ??
    resolveStrictCampaignRulesStack(input.db, input.rulesPackResolver);
  const signals = extractDiscoverySignals(input.scenario, stack);
  const candidates = resolveDiscoveryCandidates(signals, stack, input.scenario);
  const expansion = expandTypedRelationships(
    candidates.outputsProduced,
    stack,
    {
      relationshipManifest: getBundledDnd5eSrdRecordRelationshipManifest(),
    },
  );
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
      relationshipManifest: getBundledDnd5eSrdRecordRelationshipManifest(),
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
      seenRuleIdentities: new Set(ruleJoin.returnedRuleIdentities),
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
    // Every stack the offline harness resolves today is D&D 5e SRD-compatible
    // (`resolveStrictCampaignRulesStack`'s base pack, plus any add-on that
    // declares `compatibleBaseSystems` against it), and field-provenance
    // classification is declared per `RulesRecordKind`, not per pack identity
    // (`fieldProvenance.ts`), so the one bundled manifest applies to every
    // candidate this harness can produce.
    bundledDnd5eSrdFieldProvenanceSource(),
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

/**
 * A {@link FieldProvenanceSource} that answers for the canonical bundled D&D
 * 5e SRD pack and for nothing else (PR #543 re-review finding 1).
 *
 * The association is by OBJECT IDENTITY against the cached bundled pack. That
 * is the point, not an optimization: `field-provenance.json` is emitted by the
 * SRD importer and attests the values THAT artifact contains, so the question
 * "may this manifest speak for this record?" is really "did this record come
 * out of that artifact?". Identity answers it exactly.
 *
 * Comparing `packId`, `version`, `systemId` or `compatibleBaseSystems`
 * instead would answer a weaker question — "does this pack resemble the one I
 * know?" — which a custom resolver, a fixture, or a fork can satisfy while
 * returning entirely different content under identical metadata. Provenance
 * obtainable by resembling the real producer is not provenance.
 * `getBundledDnd5eSrdPack()` caches one instance per process, so any pack that
 * is not that instance is not the artifact the manifest describes.
 *
 * Lives on the CONSUMER side on purpose. `eshyra-o9bd.19.1.3.1` owns the
 * manifest and its representation; deciding which pack a manifest may speak
 * for when building model-facing context is W10's, and putting it here keeps
 * `rules/` from importing `discovery/`.
 */
export function bundledDnd5eSrdFieldProvenanceSource(): FieldProvenanceSource {
  return (pack) =>
    pack === getBundledDnd5eSrdPack()
      ? getBundledDnd5eSrdFieldProvenanceManifest()
      : undefined;
}
