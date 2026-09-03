import type { Db } from '../persistence/db.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import type { RulesAmbiguity } from '../rules/types.js';
import {
  listActiveCampaignRulesAtPosition,
  listActiveRulingsForAmbiguitiesAtPosition,
} from './campaignRuleStore.js';
import {
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
  readonly ambiguities: readonly CampaignAmbiguityContext[];
}

function ambiguitiesFromStack(stack: ResolvedRulesStack): RulesAmbiguity[] {
  const found = new Map<string, RulesAmbiguity>();
  for (const entry of stack.recordsByKey.values()) {
    const data = entry.record.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data))
      continue;
    const values = (data as { mechanics?: { ambiguities?: unknown } }).mechanics
      ?.ambiguities;
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const ambiguity = value as RulesAmbiguity;
        if (typeof ambiguity.id === 'string')
          found.set(ambiguity.id, ambiguity);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Shared DM/auditor projection of campaign prose and immutable ambiguity metadata. */
export function assembleCampaignRulesContext(
  db: Db,
  campaignId: string,
  position: string,
  stack: ResolvedRulesStack,
): CampaignRulesContext {
  const ambiguities = ambiguitiesFromStack(stack);
  const rulings = listActiveRulingsForAmbiguitiesAtPosition(
    db,
    campaignId,
    ambiguities.map((item) => item.id),
    position,
  );
  const rulingByAmbiguity = new Map<string, CampaignRulingProjection>();
  for (const ruling of rulings)
    rulingByAmbiguity.set(ruling.ambiguityId, ruling);
  return {
    position,
    rules: listActiveCampaignRulesAtPosition(db, campaignId, position).map(
      projectCampaignRule,
    ),
    ambiguities: ambiguities.map((ambiguity) => ({
      ambiguity,
      ruling: rulingByAmbiguity.get(ambiguity.id),
    })),
  };
}
