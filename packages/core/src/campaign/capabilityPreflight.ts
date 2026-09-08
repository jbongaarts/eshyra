import type { Db } from '../persistence/db.js';
import { optRulesAmbiguities } from '../rules/rulesAmbiguities.js';
import type { RulesRecord } from '../rules/types.js';
import {
  type CampaignRulesPackResolver,
  resolveStrictCampaignRulesStack,
} from '../state/campaignRecordLookup.js';
import {
  assertMagicItemOperationReady,
  ItemExecutionReadinessError,
  type ItemOperationReadinessInput,
  MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
} from '../state/itemExecutionReadiness.js';
import {
  assembleCampaignRulesContext,
  type CampaignAmbiguityContext,
  CampaignRulesPackAuthoringError,
} from './campaignContext.js';
import { getCurrentCampaignPosition } from './campaignPosition.js';
import { formatCampaignPosition } from './campaignRules.js';

export interface CampaignCapabilityPreflight {
  status: 'available' | 'blocked';
  reason?: string;
  capabilityId: string;
  revision: string;
  position: string;
  /** Campaign-owned read projection; never caller-selected interpretations. */
  ambiguities: readonly (CampaignAmbiguityContext & {
    status: 'unresolved' | 'resolved' | 'conflicting';
  })[];
}

/** A2: join campaign decisions to the bounded readiness gate without granting readiness. */
export function preflightCampaignItemOperation(
  db: Db,
  input: {
    campaignId: string;
    record: RulesRecord;
    variantId?: string;
    operation: ItemOperationReadinessInput;
    resolveRulesPack?: CampaignRulesPackResolver;
  },
): CampaignCapabilityPreflight {
  const position = formatCampaignPosition(
    getCurrentCampaignPosition(db, input.campaignId) ?? {
      sessionId: 'bootstrap',
      turnId: 'bootstrap',
      ordinal: 0,
    },
  );
  const data = input.record.data as { mechanics?: Record<string, unknown> };
  const ids =
    data?.mechanics === undefined
      ? new Set<string>()
      : optRulesAmbiguities(
          data.mechanics,
          `${input.record.key}.data.mechanics`,
        );
  const relevant =
    ids.size === 0
      ? []
      : assembleCampaignRulesContext(
          db,
          input.campaignId,
          position,
          resolveStrictCampaignRulesStack(db, input.resolveRulesPack),
          undefined,
          ids,
        ).ambiguities;
  for (const id of ids) {
    if (!relevant.some((entry) => entry.ambiguity.id === id))
      throw new CampaignRulesPackAuthoringError(
        `Relevant ambiguity '${id}' is absent from the bound rules stack`,
      );
  }
  const evidence = {
    capabilityId: MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.operationId,
    revision: MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.revision,
    position,
    ambiguities: relevant.map((entry) => ({
      ...entry,
      status:
        entry.conflictingRulings.length > 0
          ? ('conflicting' as const)
          : entry.ruling === undefined
            ? ('unresolved' as const)
            : ('resolved' as const),
    })),
  };
  try {
    assertMagicItemOperationReady(
      input.record,
      input.variantId,
      input.operation,
    );
    return { ...evidence, status: 'available' };
  } catch (error) {
    if (!(error instanceof ItemExecutionReadinessError)) throw error;
    return { ...evidence, status: 'blocked', reason: error.message };
  }
}
