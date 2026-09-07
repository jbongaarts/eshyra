import type { Db } from '../persistence/db.js';
import { optRulesAmbiguities } from '../rules/rulesAmbiguities.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import {
  isRulesPackContentError,
  markRulesPackContentError,
  type RulesAmbiguity,
} from '../rules/types.js';
import { listActiveCampaignRulesAtPosition } from './campaignRuleStore.js';
import {
  CampaignRuleError,
  type CampaignRuleProjection,
  type CampaignRulingProjection,
  projectCampaignRule,
} from './campaignRules.js';

export interface CampaignAmbiguityContext {
  readonly ambiguity: RulesAmbiguity;
  readonly ruling: CampaignRulingProjection | undefined;
  /** Present when restored history contains contradictory active rulings. */
  readonly conflictingRulings: readonly CampaignRulingProjection[];
}

/**
 * Several simultaneously active rulings claim one ambiguity id whose immutable
 * ambiguity could not be bound (absent from the resolved stack, or the
 * ambiguity source was unavailable). The conflict is known from durable
 * provenance alone, so none of the rulings is authoritative.
 */
export interface CampaignUnboundConflict {
  readonly ambiguityId: string;
  readonly rulings: readonly CampaignRulingProjection[];
}

export interface CampaignRulesContext {
  readonly position: string;
  /** Error detail when the bound immutable ambiguity source was unavailable. */
  readonly ambiguitySourceUnavailable?: string;
  readonly rules: readonly CampaignRuleProjection[];
  /** Active rulings whose ambiguity is absent from the bound pack. */
  readonly unboundRulings: readonly CampaignRulingProjection[];
  /** Contradictory active rulings whose ambiguity could not be bound. */
  readonly unboundConflicts: readonly CampaignUnboundConflict[];
  /** Active restored rows that cannot be represented by a valid context branch. */
  readonly unrepresentableRules: readonly CampaignRuleProjection[];
  readonly ambiguities: readonly CampaignAmbiguityContext[];
}

/** Pack-authoring defects are recoverable on the per-turn context path. */
export class CampaignRulesPackAuthoringError extends CampaignRuleError {
  constructor(message: string) {
    super(message);
    markRulesPackContentError(this);
  }
}

function ambiguitiesFromStack(stack: ResolvedRulesStack): RulesAmbiguity[] {
  const found = new Map<
    string,
    { ambiguity: RulesAmbiguity; recordKey: string }
  >();
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
    let ambiguityIds: ReadonlySet<string>;
    try {
      ambiguityIds = optRulesAmbiguities(
        mechanics as Record<string, unknown>,
        `${entry.record.key}.data.mechanics`,
      );
    } catch (error) {
      // Only the ambiguity interpreter is allowed to reclassify an otherwise
      // unmarked parser failure as recoverable pack content.
      if (isRulesPackContentError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new CampaignRulesPackAuthoringError(message);
    }
    const values = (mechanics as { ambiguities?: unknown }).ambiguities;
    if (!Array.isArray(values) || ambiguityIds.size === 0) continue;
    for (const value of values) {
      const ambiguity = value as RulesAmbiguity;
      const previous = found.get(ambiguity.id);
      if (previous !== undefined)
        throw new CampaignRulesPackAuthoringError(
          `ambiguity '${ambiguity.id}' is declared by records '${previous.recordKey}' and '${entry.record.key}'`,
        );
      found.set(ambiguity.id, { ambiguity, recordKey: entry.record.key });
    }
  }
  return [...found.values()]
    .map(({ ambiguity }) => ambiguity)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Shared DM/auditor projection of campaign prose and immutable ambiguity metadata. */
export function assembleCampaignRulesContext(
  db: Db,
  campaignId: string,
  position: string,
  stack: ResolvedRulesStack | undefined,
  ambiguitySourceUnavailable?: string,
): CampaignRulesContext {
  const ambiguities = stack === undefined ? [] : ambiguitiesFromStack(stack);
  const ambiguityIds = new Set(ambiguities.map((item) => item.id));
  const activeRules = listActiveCampaignRulesAtPosition(
    db,
    campaignId,
    position,
  );
  const allRulings = activeRules
    .filter(
      (
        rule,
      ): rule is typeof rule & {
        ruleKind: 'ruling';
        provenance: Extract<typeof rule.provenance, { kind: 'ambiguity' }>;
      } => rule.ruleKind === 'ruling' && rule.provenance.kind === 'ambiguity',
    )
    .map((rule) => {
      const projection = projectCampaignRule(rule);
      return {
        ...projection,
        ruleKind: 'ruling' as const,
        ambiguityId: rule.provenance.ambiguityId,
        selectedInterpretationId: rule.provenance.selectedInterpretationId,
      };
    });
  // Conflict multiplicity is a durable-provenance fact: it is computed over
  // every active ambiguity ruling, whether or not its ambiguity can be bound.
  const allRulingsByAmbiguity = new Map<string, CampaignRulingProjection[]>();
  for (const ruling of allRulings) {
    const existing = allRulingsByAmbiguity.get(ruling.ambiguityId) ?? [];
    existing.push(ruling);
    allRulingsByAmbiguity.set(ruling.ambiguityId, existing);
  }
  const rulingsByAmbiguity = new Map<string, CampaignRulingProjection[]>();
  const unboundConflicts: CampaignUnboundConflict[] = [];
  for (const [ambiguityId, group] of allRulingsByAmbiguity) {
    if (ambiguityIds.has(ambiguityId)) {
      rulingsByAmbiguity.set(ambiguityId, group);
    } else if (group.length > 1) {
      unboundConflicts.push({ ambiguityId, rulings: group });
    }
  }
  unboundConflicts.sort((a, b) =>
    a.ambiguityId < b.ambiguityId ? -1 : a.ambiguityId > b.ambiguityId ? 1 : 0,
  );
  const unboundConflictIdentities = new Set(
    unboundConflicts.flatMap(({ rulings }) =>
      rulings.map(({ ruleIdentity }) => ruleIdentity),
    ),
  );
  return {
    position,
    ...(ambiguitySourceUnavailable === undefined
      ? {}
      : { ambiguitySourceUnavailable }),
    rules: activeRules
      .filter(
        (rule) =>
          !unboundConflictIdentities.has(rule.ruleIdentity) &&
          (stack === undefined || rule.provenance.kind !== 'ambiguity'),
      )
      .map(projectCampaignRule),
    unboundRulings:
      stack === undefined
        ? []
        : allRulings.filter(
            (ruling) =>
              !ambiguityIds.has(ruling.ambiguityId) &&
              !unboundConflictIdentities.has(ruling.ruleIdentity),
          ),
    unboundConflicts,
    unrepresentableRules: activeRules
      .filter(
        (rule) =>
          stack !== undefined &&
          rule.provenance.kind === 'ambiguity' &&
          rule.ruleKind !== 'ruling',
      )
      .map(projectCampaignRule),
    ambiguities: ambiguities.map((ambiguity) => ({
      ambiguity,
      ruling:
        (rulingsByAmbiguity.get(ambiguity.id)?.length ?? 0) === 1
          ? rulingsByAmbiguity.get(ambiguity.id)?.[0]
          : undefined,
      conflictingRulings:
        (rulingsByAmbiguity.get(ambiguity.id)?.length ?? 0) > 1
          ? (rulingsByAmbiguity.get(ambiguity.id) as CampaignRulingProjection[])
          : [],
    })),
  };
}

/**
 * The only executable repair for contradictory active rulings. Ordinary
 * supersession is deliberately not offered: a same-ambiguity successor still
 * overlaps the other conflicting ruling and is rejected by the store.
 */
const CONFLICT_REPAIR_GUIDANCE =
  'Do not assert a canonical answer, do not apply either ruling, do not request a player choice for it, and do not promise one: the player must first revoke one of the conflicting rulings with /rules revoke before this ambiguity can be relied on.';

/** Render the campaign-rule prompt section shared by the DM and auditor. */
export function renderCampaignRulesSection(
  ctx: CampaignRulesContext,
): string | undefined {
  if (
    ctx.ambiguitySourceUnavailable === undefined &&
    ctx.rules.length === 0 &&
    ctx.unboundRulings.length === 0 &&
    ctx.unboundConflicts.length === 0 &&
    ctx.unrepresentableRules.length === 0 &&
    ctx.ambiguities.length === 0
  ) {
    return undefined;
  }
  const unavailable =
    ctx.ambiguitySourceUnavailable === undefined
      ? []
      : [
          `- AMBIGUITY SOURCE UNAVAILABLE: ${ctx.ambiguitySourceUnavailable}; immutable ambiguity metadata is omitted until the bound pack is available`,
        ];
  const rules = ctx.rules.map(
    (rule) =>
      `- [${rule.ruleKind}] ${rule.ruleIdentity} (${rule.provenance}; effective ${rule.effectivePosition}; records: ${rule.governingRecordKeys.join(', ') || '(none)'}): ${rule.prose ?? ''}`,
  );
  const unboundRulings = ctx.unboundRulings.map(
    (ruling) =>
      `- [ruling] ${ruling.ruleIdentity} (${ruling.provenance}; ambiguity absent from current pack; effective ${ruling.effectivePosition}; records: ${ruling.governingRecordKeys.join(', ') || '(none)'}): ${ruling.prose ?? ''}`,
  );
  const unboundConflicts = ctx.unboundConflicts.flatMap(
    ({ ambiguityId, rulings }) => [
      `- CONFLICT: active rulings ${rulings.map((item) => item.ruleIdentity).join(', ')} for ${ambiguityId} (ambiguity ${ctx.ambiguitySourceUnavailable === undefined ? 'absent from current pack' : 'source unavailable'}) contradict one another; none is authoritative. ${CONFLICT_REPAIR_GUIDANCE}`,
      ...rulings.map(
        (ruling) =>
          `  - ${ruling.ruleIdentity} (${ruling.provenance}; effective ${ruling.effectivePosition}; records: ${ruling.governingRecordKeys.join(', ') || '(none)'}): ${ruling.prose ?? ''}`,
      ),
    ],
  );
  const unrepresentableRules = ctx.unrepresentableRules.map(
    (rule) =>
      `- UNREPRESENTABLE ACTIVE CAMPAIGN RULE ${rule.ruleIdentity} (${rule.provenance}; effective ${rule.effectivePosition}; records: ${rule.governingRecordKeys.join(', ') || '(none)'}): preserved restored content requires repair before it can be interpreted`,
  );
  const ambiguityLines = ctx.ambiguities.flatMap(
    ({ ambiguity, ruling, conflictingRulings }) => [
      `- ${ambiguity.id}: ${ambiguity.question}`,
      ...ambiguity.interpretations.map(
        (item) => `  - ${item.id}: ${item.summary}`,
      ),
      conflictingRulings.length > 1
        ? `  CONFLICT: active rulings ${conflictingRulings.map((item) => item.ruleIdentity).join(', ')} contradict one another; none is authoritative. ${CONFLICT_REPAIR_GUIDANCE}`
        : ruling === undefined
          ? '  UNRESOLVED: do not assert a canonical answer or silently choose an interpretation.'
          : `  Active ruling ${ruling.ruleIdentity} (${ruling.selectedInterpretationId}): ${ruling.prose ?? ''}`,
    ],
  );
  return `## Campaign Rules\n${[
    ...unavailable,
    ...rules,
    ...unboundRulings,
    ...unboundConflicts,
    ...unrepresentableRules,
    ...ambiguityLines,
  ].join('\n')}`;
}
