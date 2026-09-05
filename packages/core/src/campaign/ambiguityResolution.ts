import type { Db } from '../persistence/db.js';
import type { RulesAmbiguity } from '../rules/types.js';
import type { CampaignRulesPackResolver } from '../state/campaignRecordLookup.js';
import { resolveStrictCampaignRulesStack } from '../state/campaignRecordLookup.js';
import {
  assembleCampaignRulesContext,
  type CampaignAmbiguityContext,
} from './campaignContext.js';
import {
  createCampaignRule,
  listActiveCampaignRulesAtPosition,
} from './campaignRuleStore.js';
import {
  type CampaignPosition,
  type CampaignRule,
  CampaignRuleError,
  type CampaignRulingProjection,
  formatCampaignPosition,
} from './campaignRules.js';

export interface LookupCampaignAmbiguityInput {
  readonly campaignId: string;
  readonly ambiguityId: string;
  readonly position: CampaignPosition;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
}

export interface CampaignAmbiguityResolution {
  readonly ambiguity: RulesAmbiguity;
  readonly status: 'unresolved' | 'resolved' | 'conflicting';
  readonly ruling?: CampaignRulingProjection;
  readonly conflictingRulings: readonly CampaignRulingProjection[];
}

export interface RecordAmbiguityRulingInput {
  readonly campaignId: string;
  readonly ambiguityId: string;
  readonly interpretationId: string;
  readonly prose?: string;
  readonly currentPosition: CampaignPosition;
  readonly effectiveOrdinal?: number;
  readonly sessionId?: string;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
}

export interface RecordAmbiguityRulingResult {
  readonly created: boolean;
  readonly rule: CampaignRule;
}

function knownAmbiguityIds(
  ambiguities: readonly CampaignAmbiguityContext[],
): string {
  return ambiguities
    .map(({ ambiguity }) => ambiguity.id)
    .sort()
    .join(', ');
}

function findAmbiguity(
  db: Db,
  input: LookupCampaignAmbiguityInput,
): CampaignAmbiguityResolution {
  const position = formatCampaignPosition(input.position);
  const context = assembleCampaignRulesContext(
    db,
    input.campaignId,
    position,
    resolveStrictCampaignRulesStack(db, input.resolveRulesPack),
  );
  const found = context.ambiguities.find(
    ({ ambiguity }) => ambiguity.id === input.ambiguityId,
  );
  if (found === undefined) {
    throw new CampaignRuleError(
      `unknown ambiguity ${input.ambiguityId}; known ambiguity ids: ${knownAmbiguityIds(context.ambiguities) || '(none)'}`,
    );
  }
  return resolutionFromContext(found);
}

function resolutionFromContext(
  found: CampaignAmbiguityContext,
): CampaignAmbiguityResolution {
  return {
    ambiguity: found.ambiguity,
    status:
      found.conflictingRulings.length > 0
        ? 'conflicting'
        : found.ruling === undefined
          ? 'unresolved'
          : 'resolved',
    ...(found.ruling === undefined ? {} : { ruling: found.ruling }),
    conflictingRulings: found.conflictingRulings,
  };
}

/** Look up one immutable pack ambiguity together with its active ruling state. */
export function lookupCampaignAmbiguity(
  db: Db,
  input: LookupCampaignAmbiguityInput,
): CampaignAmbiguityResolution {
  return findAmbiguity(db, input);
}

function knownInterpretationIds(ambiguity: RulesAmbiguity): string {
  return ambiguity.interpretations
    .map(({ id }) => id)
    .sort()
    .join(', ');
}

function activeRulingAtNextPosition(
  db: Db,
  input: RecordAmbiguityRulingInput,
): CampaignRulingProjection | undefined {
  const nextPosition = {
    ...input.currentPosition,
    ordinal: input.currentPosition.ordinal + 1,
  };
  return findAmbiguity(db, {
    campaignId: input.campaignId,
    ambiguityId: input.ambiguityId,
    position: nextPosition,
    resolveRulesPack: input.resolveRulesPack,
  }).ruling;
}

/** Persist a player-approved interpretation as a prospective campaign ruling. */
export function recordAmbiguityRuling(
  db: Db,
  input: RecordAmbiguityRulingInput,
): RecordAmbiguityRulingResult {
  const existing = activeRulingAtNextPosition(db, input);
  if (existing !== undefined) {
    const rule = listActiveCampaignRulesAtPosition(
      db,
      input.campaignId,
      formatCampaignPosition({
        ...input.currentPosition,
        ordinal: input.currentPosition.ordinal + 1,
      }),
    ).find((candidate) => candidate.ruleIdentity === existing.ruleIdentity);
    if (rule === undefined)
      throw new CampaignRuleError(
        `active ambiguity ruling '${existing.ruleIdentity}' could not be read`,
      );
    return { created: false, rule };
  }

  const position = formatCampaignPosition(input.currentPosition);
  const context = assembleCampaignRulesContext(
    db,
    input.campaignId,
    position,
    resolveStrictCampaignRulesStack(db, input.resolveRulesPack),
  );
  const found = context.ambiguities.find(
    ({ ambiguity }) => ambiguity.id === input.ambiguityId,
  );
  if (found === undefined) {
    throw new CampaignRuleError(
      `unknown ambiguity ${input.ambiguityId}; known ambiguity ids: ${knownAmbiguityIds(context.ambiguities) || '(none)'}`,
    );
  }
  const interpretation = found.ambiguity.interpretations.find(
    ({ id }) => id === input.interpretationId,
  );
  if (interpretation === undefined) {
    throw new CampaignRuleError(
      `interpretation ${input.interpretationId} is not enumerated by ${input.ambiguityId}; known interpretation ids: ${knownInterpretationIds(found.ambiguity)}`,
    );
  }

  const effectivePosition = {
    ...input.currentPosition,
    ordinal: input.effectiveOrdinal ?? input.currentPosition.ordinal + 1,
  };
  const rule: CampaignRule = {
    ruleIdentity: `ruling:${input.ambiguityId.replace(/^ambiguity:/, '')}:${effectivePosition.ordinal}`,
    campaignId: input.campaignId,
    ruleKind: 'ruling',
    status: 'active',
    origin: 'player-approved',
    provenance: {
      kind: 'ambiguity',
      ambiguityId: input.ambiguityId,
      selectedInterpretationId: input.interpretationId,
    },
    effectivePosition,
    temporalMode: { mode: 'prospective' },
    supersededBy: null,
    revokedPosition: null,
    scope: 'rules-ambiguity',
    governingRecordKeys:
      found.ambiguity.affects.length > 0
        ? found.ambiguity.affects
        : [`ambiguity:${input.ambiguityId}`],
    prose:
      input.prose ??
      `${found.ambiguity.question} Ruling: ${interpretation.summary}`,
  };
  const persisted = createCampaignRule(db, rule, {
    currentPosition: input.currentPosition,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    validation: { ambiguity: found.ambiguity },
  });
  return { created: true, rule: persisted };
}
