import type { RulesAmbiguity } from '../rules/types.js';
import { requireNonEmpty } from '../validation.js';

/**
 * Campaign-owned rule semantics deliberately remain prose. Immutable packs
 * provide canonical semantics and unresolved ambiguity metadata; this module
 * records the player-approved campaign decision and its deterministic scope,
 * timing, identity, and lifecycle. It does not compile prose into mechanics,
 * infer house rules from conflicts, or persist fictional one-off judgments.
 *
 * Positions are `cp1~<12-digit ordinal>~<encoded session>~<encoded turn>`.
 * The ordinal is assigned by the campaign history writer (this module does
 * not persist it), while the session and turn anchors make the value useful
 * in diagnostics and replay. The ordinal is authoritative for chronology;
 * session and turn IDs are diagnostic anchors and deterministic tie-breakers.
 * The ordinal leads so canonical positions remain compact and stable; consumers
 * that need to compare equal-ordinal rule anchors use the decoded position
 * comparator.
 */

export class CampaignRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignRuleError';
  }
}

/** Reserved ordering anchor for a prospective rule whose turn is not stored. */
export const FUTURE_CAMPAIGN_POSITION_ANCHOR = '__future__';

export interface CampaignPosition {
  readonly sessionId: string;
  readonly turnId: string;
  readonly ordinal: number;
}

export type CampaignTemporalMode =
  | { readonly mode: 'prospective' }
  | {
      readonly mode: 'disputed-turn';
      readonly disputedPosition: CampaignPosition;
    };

export type CampaignRuleStatus = 'active' | 'revoked' | 'superseded';
export type CampaignRuleKind = 'ruling' | 'house-rule';
export type CampaignRuleOrigin =
  | 'player-authored'
  | 'player-approved'
  | 'oracle-supplied';

export type CampaignRuleProvenance =
  | {
      readonly kind: 'ambiguity';
      readonly ambiguityId: string;
      readonly selectedInterpretationId: string;
    }
  | { readonly kind: 'recurring-question'; readonly questionId: string }
  | { readonly kind: 'house-rule'; readonly rationale?: string };

export interface CampaignRule {
  readonly ruleIdentity: string;
  readonly campaignId: string;
  readonly ruleKind: CampaignRuleKind;
  readonly status: CampaignRuleStatus;
  readonly origin: CampaignRuleOrigin;
  readonly provenance: CampaignRuleProvenance;
  readonly effectivePosition: CampaignPosition;
  readonly temporalMode: CampaignTemporalMode;
  readonly supersededBy: string | null;
  readonly scope: string;
  readonly governingRecordKeys: readonly string[];
  readonly prose: string;
}

/** Projection vocabulary shared by campaign-owned producers and discovery. */
export interface CampaignRuleProjection {
  readonly ruleIdentity: string;
  readonly ruleKind: CampaignRuleKind;
  readonly status: string;
  readonly origin: string;
  readonly provenance: string;
  readonly effectivePosition: string;
  readonly supersededBy: string | null;
  readonly scope: string;
  readonly governingRecordKeys: readonly string[];
  readonly ambiguityId?: string;
  readonly oracleSupplied?: boolean;
  readonly prose?: string;
}

export interface CampaignRulingProjection extends CampaignRuleProjection {
  readonly ruleKind: 'ruling';
  readonly ambiguityId: string;
  readonly selectedInterpretationId: string;
}

export interface CampaignRuleReadSeam {
  activeRulesAtPosition(query: {
    readonly campaignPosition?: string;
    readonly candidateRecordKeys: readonly string[];
  }): readonly CampaignRuleProjection[];
  activeRulingsForAmbiguities(
    ambiguityIds: readonly string[],
    options?: { readonly includeAllActive?: boolean },
  ): readonly CampaignRulingProjection[];
}

export const NULL_CAMPAIGN_RULE_SEAM: CampaignRuleReadSeam = {
  activeRulesAtPosition: () => [],
  activeRulingsForAmbiguities: () => [],
};

export interface CampaignRuleValidationOptions {
  readonly ambiguity?: RulesAmbiguity;
  readonly ambiguityLookup?: (
    ambiguityId: string,
  ) => RulesAmbiguity | undefined;
}

function fail(message: string): never {
  throw new CampaignRuleError(message);
}

function checkPosition(position: CampaignPosition, field: string): void {
  if (!Number.isSafeInteger(position.ordinal) || position.ordinal < 0) {
    fail(`${field}.ordinal must be a non-negative safe integer`);
  }
  requireNonEmpty(
    CampaignRuleError,
    [
      [`${field}.sessionId`, position.sessionId],
      [`${field}.turnId`, position.turnId],
    ],
    (name) => `${name} is required`,
  );
  if (position.sessionId.includes('~') || position.turnId.includes('~')) {
    fail(`${field}.sessionId and turnId may not contain '~'`);
  }
}

function samePosition(a: CampaignPosition, b: CampaignPosition): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.turnId === b.turnId &&
    a.ordinal === b.ordinal
  );
}

function checkTemporalMode(
  mode: CampaignTemporalMode,
  effectivePosition: CampaignPosition,
  currentPosition?: CampaignPosition,
): void {
  if (currentPosition !== undefined) {
    checkPosition(currentPosition, 'currentPosition');
    if (
      mode.mode === 'prospective' &&
      compareCampaignPositions(effectivePosition, currentPosition) < 0
    ) {
      fail(
        'prospective campaign rule cannot take effect before the current position',
      );
    }
  }
  if (mode.mode === 'prospective') return;
  checkPosition(mode.disputedPosition, 'temporalMode.disputedPosition');
  if (!samePosition(mode.disputedPosition, effectivePosition)) {
    fail('disputed-turn effective position must equal disputedPosition');
  }
  if (currentPosition === undefined) return;
  const sameTurn =
    mode.disputedPosition.sessionId === currentPosition.sessionId &&
    mode.disputedPosition.turnId === currentPosition.turnId &&
    mode.disputedPosition.ordinal === currentPosition.ordinal;
  const immediatelyBefore =
    mode.disputedPosition.ordinal + 1 === currentPosition.ordinal;
  if (!sameTurn && !immediatelyBefore) {
    fail(
      'disputed-turn mode may target only the current or immediately preceding turn',
    );
  }
}

function ambiguityFor(
  id: string,
  options: CampaignRuleValidationOptions,
): RulesAmbiguity | undefined {
  return options.ambiguity?.id === id
    ? options.ambiguity
    : options.ambiguityLookup?.(id);
}

export function validateCampaignRule(
  rule: CampaignRule,
  options: CampaignRuleValidationOptions = {},
  currentPosition?: CampaignPosition,
): void {
  requireNonEmpty(
    CampaignRuleError,
    [
      ['ruleIdentity', rule.ruleIdentity],
      ['campaignId', rule.campaignId],
      ['scope', rule.scope],
      ['prose', rule.prose],
    ],
    (field) => `${field} is required`,
  );
  checkPosition(rule.effectivePosition, 'effectivePosition');
  checkTemporalMode(rule.temporalMode, rule.effectivePosition, currentPosition);
  if (rule.status === 'superseded' && rule.supersededBy === null) {
    fail('superseded rule must name supersededBy');
  }
  if (rule.status !== 'superseded' && rule.supersededBy !== null) {
    fail('only a superseded rule may name supersededBy');
  }
  if (rule.supersededBy === rule.ruleIdentity)
    fail('a rule cannot supersede itself');
  if (rule.ruleKind === 'ruling') {
    const provenance = rule.provenance;
    if (provenance.kind === 'house-rule')
      fail('ruling cannot use house-rule provenance');
    if (provenance.kind === 'ambiguity') {
      const ambiguity = ambiguityFor(provenance.ambiguityId, options);
      if (ambiguity === undefined)
        fail(`unknown ambiguity ${provenance.ambiguityId}`);
      if (
        !ambiguity.interpretations.some(
          ({ id }) => id === provenance.selectedInterpretationId,
        )
      ) {
        fail(
          `interpretation ${provenance.selectedInterpretationId} is not enumerated by ${ambiguity.id}`,
        );
      }
    } else {
      requireNonEmpty(
        CampaignRuleError,
        [['questionId', provenance.questionId]],
        (field) => `${field} is required`,
      );
    }
  } else if (rule.provenance.kind !== 'house-rule') {
    fail('house-rule must use house-rule provenance');
  }
}

export function validateCampaignRules(
  rules: readonly CampaignRule[],
  options: CampaignRuleValidationOptions = {},
): void {
  const byId = new Map<string, CampaignRule>();
  for (const rule of rules) {
    validateCampaignRule(rule, options);
    if (byId.has(rule.ruleIdentity))
      fail(`duplicate rule identity ${rule.ruleIdentity}`);
    byId.set(rule.ruleIdentity, rule);
  }
  for (const rule of rules) {
    if (rule.supersededBy === null) continue;
    const successor = byId.get(rule.supersededBy);
    if (successor === undefined)
      fail(`supersededBy ${rule.supersededBy} does not exist`);
    if (successor.campaignId !== rule.campaignId)
      fail('supersession cannot cross campaigns');
    if (successor.status === 'revoked')
      fail('a revoked rule cannot supersede another rule');
  }
  for (const rule of rules) {
    const seen = new Set<string>();
    let current: CampaignRule | undefined = rule;
    while (current !== undefined && current.supersededBy !== null) {
      if (seen.has(current.ruleIdentity)) fail('supersession cycle detected');
      seen.add(current.ruleIdentity);
      current = byId.get(current.supersededBy);
    }
  }
}

export function formatCampaignPosition(position: CampaignPosition): string {
  checkPosition(position, 'position');
  return `cp1~${String(position.ordinal).padStart(12, '0')}~${encodeURIComponent(position.sessionId)}~${encodeURIComponent(position.turnId)}`;
}

export function parseCampaignPosition(value: string): CampaignPosition {
  const parts = value.split('~');
  if (
    parts.length !== 4 ||
    parts[0] !== 'cp1' ||
    !/^\d{12}$/.test(parts[1] ?? '')
  ) {
    fail(`invalid campaign position ${JSON.stringify(value)}`);
  }
  let sessionId: string;
  let turnId: string;
  try {
    sessionId = decodeURIComponent(parts[2] as string);
    turnId = decodeURIComponent(parts[3] as string);
  } catch {
    fail(`invalid campaign position ${JSON.stringify(value)}`);
  }
  const position = { sessionId, turnId, ordinal: Number(parts[1]) };
  checkPosition(position, 'position');
  if (formatCampaignPosition(position) !== value)
    fail('campaign position is not canonical');
  return position;
}

export function compareCampaignPositions(
  a: CampaignPosition | string,
  b: CampaignPosition | string,
): number {
  // The ordinal is the primary chronology key. Session and turn anchors are
  // decoded before comparing so equal-ordinal rows (which can exist in the
  // rule table even though turn positions themselves are unique) use the same
  // ordering as every other in-memory consumer.
  const left = typeof a === 'string' ? parseCampaignPosition(a) : a;
  const right = typeof b === 'string' ? parseCampaignPosition(b) : b;
  const leftIsFutureAnchor =
    left.sessionId === FUTURE_CAMPAIGN_POSITION_ANCHOR &&
    left.turnId === FUTURE_CAMPAIGN_POSITION_ANCHOR;
  const rightIsFutureAnchor =
    right.sessionId === FUTURE_CAMPAIGN_POSITION_ANCHOR &&
    right.turnId === FUTURE_CAMPAIGN_POSITION_ANCHOR;
  const ordinal = left.ordinal - right.ordinal;
  if (ordinal !== 0) return ordinal;
  if (leftIsFutureAnchor !== rightIsFutureAnchor)
    return leftIsFutureAnchor ? -1 : 1;
  return (
    compareCodePoints(left.sessionId, right.sessionId) ||
    compareCodePoints(left.turnId, right.turnId)
  );
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type CampaignPrecedence =
  | 'canonical'
  | 'unresolved-ambiguity'
  | 'ruling'
  | 'house-rule';

export function precedenceOf(value: CampaignPrecedence | CampaignRule): number {
  const name: CampaignPrecedence =
    typeof value === 'string' ? value : value.ruleKind;
  return {
    canonical: 0,
    'unresolved-ambiguity': 1,
    ruling: 2,
    'house-rule': 3,
  }[name];
}

export function orderCampaignRules(
  rules: readonly CampaignRule[],
): readonly CampaignRule[] {
  return [...rules].sort((a, b) => {
    const position = compareCampaignPositions(
      a.effectivePosition,
      b.effectivePosition,
    );
    return (
      position ||
      precedenceOf(a) - precedenceOf(b) ||
      compareCodePoints(a.ruleIdentity, b.ruleIdentity)
    );
  });
}

export function projectCampaignRule(
  rule: CampaignRule,
): CampaignRuleProjection | CampaignRulingProjection {
  const provenance =
    rule.provenance.kind === 'ambiguity'
      ? `ambiguity:${rule.provenance.ambiguityId}#${rule.provenance.selectedInterpretationId}`
      : rule.provenance.kind === 'recurring-question'
        ? `question:${rule.provenance.questionId}`
        : 'house-rule';
  const base: CampaignRuleProjection = {
    ruleIdentity: rule.ruleIdentity,
    ruleKind: rule.ruleKind,
    status: rule.status,
    origin: rule.origin,
    provenance,
    effectivePosition: formatCampaignPosition(rule.effectivePosition),
    supersededBy: rule.supersededBy,
    scope: rule.scope,
    governingRecordKeys: rule.governingRecordKeys,
    ...(rule.provenance.kind === 'ambiguity'
      ? { ambiguityId: rule.provenance.ambiguityId }
      : {}),
    ...(rule.origin === 'oracle-supplied' ? { oracleSupplied: true } : {}),
    prose: rule.prose,
  };
  return rule.ruleKind === 'ruling' && rule.provenance.kind === 'ambiguity'
    ? {
        ...base,
        ruleKind: 'ruling',
        ambiguityId: rule.provenance.ambiguityId,
        selectedInterpretationId: rule.provenance.selectedInterpretationId,
      }
    : base;
}
