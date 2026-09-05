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

export interface CampaignRulesContext {
  readonly position: string;
  /** Error detail when the bound immutable ambiguity source was unavailable. */
  readonly ambiguitySourceUnavailable?: string;
  readonly rules: readonly CampaignRuleProjection[];
  /** Active rulings whose ambiguity is absent from the bound pack. */
  readonly unboundRulings: readonly CampaignRulingProjection[];
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
  const rulings = activeRules
    .filter(
      (
        rule,
      ): rule is typeof rule & {
        ruleKind: 'ruling';
        provenance: Extract<typeof rule.provenance, { kind: 'ambiguity' }>;
      } => rule.ruleKind === 'ruling' && rule.provenance.kind === 'ambiguity',
    )
    .filter((rule) => ambiguityIds.has(rule.provenance.ambiguityId))
    .map((rule) => {
      const projection = projectCampaignRule(rule);
      return {
        ...projection,
        ruleKind: 'ruling' as const,
        ambiguityId: rule.provenance.ambiguityId,
        selectedInterpretationId: rule.provenance.selectedInterpretationId,
      };
    });
  const rulingsByAmbiguity = new Map<string, CampaignRulingProjection[]>();
  for (const ruling of rulings) {
    const existing = rulingsByAmbiguity.get(ruling.ambiguityId) ?? [];
    existing.push(ruling);
    rulingsByAmbiguity.set(ruling.ambiguityId, existing);
  }
  return {
    position,
    ...(ambiguitySourceUnavailable === undefined
      ? {}
      : { ambiguitySourceUnavailable }),
    rules: activeRules
      .filter(
        (rule) => stack === undefined || rule.provenance.kind !== 'ambiguity',
      )
      .map(projectCampaignRule),
    unboundRulings: activeRules
      .filter(
        (
          rule,
        ): rule is typeof rule & {
          provenance: Extract<typeof rule.provenance, { kind: 'ambiguity' }>;
        } =>
          stack !== undefined &&
          rule.provenance.kind === 'ambiguity' &&
          !ambiguityIds.has(rule.provenance.ambiguityId),
      )
      .map((rule) => projectCampaignRule(rule))
      .filter(
        (rule): rule is CampaignRulingProjection =>
          rule.ruleKind === 'ruling' &&
          'selectedInterpretationId' in rule &&
          typeof rule.selectedInterpretationId === 'string',
      ),
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

/** Render the campaign-rule prompt section shared by the DM and auditor. */
export function renderCampaignRulesSection(
  ctx: CampaignRulesContext,
): string | undefined {
  if (
    ctx.ambiguitySourceUnavailable === undefined &&
    ctx.rules.length === 0 &&
    ctx.unboundRulings.length === 0 &&
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
        ? `  CONFLICT: active rulings ${conflictingRulings.map((item) => item.ruleIdentity).join(', ')} contradict one another; none is authoritative.`
        : ruling === undefined
          ? '  UNRESOLVED: do not assert a canonical answer or silently choose an interpretation.'
          : `  Active ruling ${ruling.ruleIdentity} (${ruling.selectedInterpretationId}): ${ruling.prose ?? ''}`,
    ],
  );
  return `## Campaign Rules\n${[
    ...unavailable,
    ...rules,
    ...unboundRulings,
    ...unrepresentableRules,
    ...ambiguityLines,
  ].join('\n')}`;
}
