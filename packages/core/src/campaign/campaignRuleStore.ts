import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import {
  getCampaignPositionAtOrdinal,
  getCurrentCampaignPosition,
} from './campaignPosition.js';
import type {
  CampaignPosition,
  CampaignRule,
  CampaignRuleProvenance,
  CampaignRuleReadSeam,
  CampaignRulingProjection,
} from './campaignRules.js';
import {
  CampaignRuleError,
  compareCampaignPositions,
  FUTURE_CAMPAIGN_POSITION_ANCHOR,
  formatCampaignPosition,
  orderCampaignRules,
  parseCampaignPosition,
  projectCampaignRule,
  validateCampaignRule,
  validateCampaignRules,
} from './campaignRules.js';

export interface CampaignRuleKey {
  readonly campaignId: string;
  readonly ruleIdentity: string;
}

export interface CreateCampaignRuleOptions {
  /** The canonical campaign position at which this live mutation is made. */
  readonly currentPosition: CampaignPosition;
  readonly sessionId?: string;
  readonly updatedAt?: string;
  readonly validation?: Parameters<typeof validateCampaignRule>[1];
}

export interface RevokeCampaignRuleInput extends CampaignRuleKey {
  /** The canonical campaign position at which this live mutation is made. */
  readonly currentPosition: CampaignPosition;
  readonly revokedPosition: CampaignPosition;
  readonly sessionId?: string;
  readonly updatedAt?: string;
}

export interface SupersedeCampaignRuleInput {
  readonly campaignId: string;
  readonly ruleIdentity: string;
  readonly successor: CampaignRule;
  /** The canonical campaign position at which this live mutation is made. */
  readonly currentPosition: CampaignPosition;
  readonly sessionId?: string;
  readonly updatedAt?: string;
  readonly validation?: Parameters<typeof validateCampaignRule>[1];
}

interface RuleRow {
  campaign_id: string;
  rule_identity: string;
  rule_kind: string;
  status: string;
  origin: string;
  provenance_kind: string;
  ambiguity_id: string | null;
  selected_interpretation_id: string | null;
  question_id: string | null;
  rationale: string | null;
  effective_position: string;
  temporal_mode: string;
  disputed_position: string | null;
  superseded_by: string | null;
  revoked_position: string | null;
  scope: string;
  governing_record_keys_json: string;
  prose: string;
  provenance: string;
  session_id: string;
  updated_at: string;
}

const keysColumn = jsonColumn<readonly string[]>(
  'campaign_rule.governing_record_keys_json',
);

interface RuleSeamQuery {
  readonly campaignPosition?: string;
  readonly candidateRecordKeys: readonly string[];
}

type AmbiguityRuling = CampaignRule & {
  readonly ruleKind: 'ruling';
  readonly provenance: Extract<CampaignRuleProvenance, { kind: 'ambiguity' }>;
};

function isAmbiguityRuling(rule: CampaignRule): rule is AmbiguityRuling {
  return rule.ruleKind === 'ruling' && rule.provenance.kind === 'ambiguity';
}

/** Validate only the persisted prior row's lifecycle transition. */
function validatePriorForSupersession(
  prior: CampaignRule,
  campaignId: string,
  ruleIdentity: string,
  successorIdentity: string,
): void {
  if (prior.ruleIdentity !== ruleIdentity)
    throw new CampaignRuleError('supersession prior identity does not match');
  if (prior.campaignId !== campaignId)
    throw new CampaignRuleError('supersession prior campaign does not match');
  if (prior.status !== 'active')
    throw new CampaignRuleError('supersession prior must be active');
  if (prior.supersededBy !== null)
    throw new CampaignRuleError(
      `active campaign rule '${prior.ruleIdentity}' cannot name supersededBy`,
    );
  if (successorIdentity.length === 0)
    throw new CampaignRuleError('supersession successor identity is required');
  if (successorIdentity === prior.ruleIdentity)
    throw new CampaignRuleError('a rule cannot supersede itself');
}

function intervalsOverlap(
  leftStart: CampaignPosition,
  leftEnd: CampaignPosition | undefined,
  rightStart: CampaignPosition,
  rightEnd: CampaignPosition | undefined,
): boolean {
  return (
    (leftEnd === undefined ||
      compareCampaignPositions(leftStart, leftEnd) < 0) &&
    (rightEnd === undefined ||
      compareCampaignPositions(rightStart, rightEnd) < 0) &&
    (leftEnd === undefined ||
      compareCampaignPositions(rightStart, leftEnd) < 0) &&
    (rightEnd === undefined ||
      compareCampaignPositions(leftStart, rightEnd) < 0)
  );
}

function existingIntervalEnd(
  db: Db,
  row: RuleRow,
  pendingRule: CampaignRule,
): CampaignPosition | undefined {
  if (row.status === 'revoked') {
    if (row.revoked_position === null)
      throw new CampaignRuleError(
        `revoked campaign rule '${row.rule_identity}' is missing revoked_position`,
      );
    return position(row.revoked_position);
  }
  if (row.status === 'superseded') {
    if (row.superseded_by === null)
      throw new CampaignRuleError(
        `superseded campaign rule '${row.rule_identity}' is missing superseded_by`,
      );
    if (
      row.campaign_id === pendingRule.campaignId &&
      row.superseded_by === pendingRule.ruleIdentity
    )
      return pendingRule.effectivePosition;
    const successor = getCampaignRule(db, {
      campaignId: row.campaign_id,
      ruleIdentity: row.superseded_by,
    });
    if (successor === undefined)
      throw new CampaignRuleError(
        `supersededBy ${row.superseded_by} does not exist in campaign '${row.campaign_id}'`,
      );
    return successor.effectivePosition;
  }
  return undefined;
}

function assertNoOverlappingAmbiguityRuling(
  db: Db,
  rule: CampaignRule,
  intervalEnd: CampaignPosition | undefined,
): void {
  if (!isAmbiguityRuling(rule)) return;
  const rows = db
    .prepare(
      `${SELECT} WHERE campaign_id = ? AND provenance_kind = 'ambiguity' AND ambiguity_id = ?`,
    )
    .all(rule.campaignId, rule.provenance.ambiguityId) as RuleRow[];
  for (const row of rows) {
    const existing = rowToRule(row);
    if (
      intervalsOverlap(
        rule.effectivePosition,
        intervalEnd,
        existing.effectivePosition,
        existingIntervalEnd(db, row, rule),
      )
    ) {
      throw new CampaignRuleError(
        `active ambiguity ruling '${rule.ruleIdentity}' overlaps '${existing.ruleIdentity}' for ambiguity '${rule.provenance.ambiguityId}'`,
      );
    }
  }
}

function position(value: string): CampaignPosition {
  return parseCampaignPosition(value);
}

function rowToRule(row: RuleRow): CampaignRule {
  const provenance =
    row.provenance_kind === 'ambiguity'
      ? {
          kind: 'ambiguity' as const,
          ambiguityId: row.ambiguity_id as string,
          selectedInterpretationId: row.selected_interpretation_id as string,
        }
      : row.provenance_kind === 'recurring-question'
        ? {
            kind: 'recurring-question' as const,
            questionId: row.question_id as string,
          }
        : {
            kind: 'house-rule' as const,
            ...(row.rationale === null ? {} : { rationale: row.rationale }),
          };
  return {
    ruleIdentity: row.rule_identity,
    campaignId: row.campaign_id,
    ruleKind: row.rule_kind as CampaignRule['ruleKind'],
    status: row.status as CampaignRule['status'],
    origin: row.origin as CampaignRule['origin'],
    provenance,
    effectivePosition: position(row.effective_position),
    temporalMode:
      row.temporal_mode === 'prospective'
        ? { mode: 'prospective' }
        : {
            mode: 'disputed-turn',
            disputedPosition: position(row.disputed_position as string),
          },
    supersededBy: row.superseded_by,
    scope: row.scope,
    governingRecordKeys: keysColumn.decode(row.governing_record_keys_json),
    prose: row.prose,
  };
}

const SELECT = `SELECT campaign_id, rule_identity, rule_kind, status, origin,
  provenance_kind, ambiguity_id, selected_interpretation_id, question_id,
  rationale, effective_position, temporal_mode, disputed_position,
  superseded_by, revoked_position, scope, governing_record_keys_json, prose,
  provenance, session_id, updated_at FROM campaign_rule`;

function canonicalizeFuturePosition(
  db: Db,
  campaignId: string,
  candidate: CampaignPosition,
  currentPosition: CampaignPosition,
): CampaignPosition {
  const persistedCurrent = getCurrentCampaignPosition(db, campaignId);
  const currentOrdinal = persistedCurrent?.ordinal ?? currentPosition.ordinal;
  if (candidate.ordinal > currentOrdinal) {
    return {
      ...candidate,
      sessionId: FUTURE_CAMPAIGN_POSITION_ANCHOR,
      turnId: FUTURE_CAMPAIGN_POSITION_ANCHOR,
    };
  }
  return candidate;
}

function canonicalizeFutureEffectivePosition(
  db: Db,
  rule: CampaignRule,
  currentPosition: CampaignPosition,
): CampaignRule {
  if (rule.temporalMode.mode !== 'prospective') return rule;
  return {
    ...rule,
    effectivePosition: canonicalizeFuturePosition(
      db,
      rule.campaignId,
      rule.effectivePosition,
      currentPosition,
    ),
  };
}

function writeRule(
  db: Db,
  rule: CampaignRule,
  options: CreateCampaignRuleOptions,
): CampaignRule {
  const storedRule = canonicalizeFutureEffectivePosition(
    db,
    rule,
    options.currentPosition,
  );
  validateCampaignRule(storedRule, options.validation, options.currentPosition);
  if (storedRule.status !== 'active') {
    throw new CampaignRuleError(
      `live campaign rule creation requires active status; use the lifecycle mutation for '${storedRule.ruleIdentity}'`,
    );
  }
  if (
    getCampaignRule(db, {
      campaignId: storedRule.campaignId,
      ruleIdentity: storedRule.ruleIdentity,
    }) !== undefined
  ) {
    throw new CampaignRuleError(
      `campaign rule '${storedRule.ruleIdentity}' already exists`,
    );
  }
  if (storedRule.temporalMode.mode === 'disputed-turn') {
    assertPersistedPosition(
      db,
      storedRule.campaignId,
      storedRule.temporalMode.disputedPosition,
      'temporalMode.disputedPosition',
    );
  }
  assertPersistedPositionAtOrBeforeCurrent(
    db,
    storedRule.campaignId,
    storedRule.effectivePosition,
    'effectivePosition',
  );
  assertNoOverlappingAmbiguityRuling(db, storedRule, undefined);
  const p = storedRule.provenance;
  db.prepare(`INSERT INTO campaign_rule (
    campaign_id, rule_identity, rule_kind, status, origin, provenance_kind,
    ambiguity_id, selected_interpretation_id, question_id, rationale,
    effective_position, temporal_mode, disputed_position, superseded_by,
    revoked_position, scope, governing_record_keys_json, prose, provenance,
    session_id, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    storedRule.campaignId,
    storedRule.ruleIdentity,
    storedRule.ruleKind,
    storedRule.status,
    storedRule.origin,
    p.kind,
    p.kind === 'ambiguity' ? p.ambiguityId : null,
    p.kind === 'ambiguity' ? p.selectedInterpretationId : null,
    p.kind === 'recurring-question' ? p.questionId : null,
    p.kind === 'house-rule' ? (p.rationale ?? null) : null,
    formatCampaignPosition(storedRule.effectivePosition),
    storedRule.temporalMode.mode,
    storedRule.temporalMode.mode === 'disputed-turn'
      ? formatCampaignPosition(storedRule.temporalMode.disputedPosition)
      : null,
    storedRule.supersededBy,
    null,
    storedRule.scope,
    keysColumn.encode(storedRule.governingRecordKeys),
    storedRule.prose,
    p.kind === 'ambiguity'
      ? `ambiguity:${p.ambiguityId}#${p.selectedInterpretationId}`
      : p.kind === 'recurring-question'
        ? `question:${p.questionId}`
        : 'house-rule',
    options.sessionId ?? 'campaign-rule',
    options.updatedAt ?? new Date().toISOString(),
  );
  return storedRule;
}

export function createCampaignRule(
  db: Db,
  rule: CampaignRule,
  options: CreateCampaignRuleOptions,
): CampaignRule {
  if (options === undefined || options.currentPosition === undefined) {
    throw new CampaignRuleError(
      'currentPosition is required for live campaign rule creation',
    );
  }
  return withTransaction(db, (txn) => {
    assertCurrentPosition(txn, rule.campaignId, options.currentPosition);
    return writeRule(txn, rule, options);
  });
}

function assertCurrentPosition(
  db: Db,
  campaignId: string,
  currentPosition: CampaignPosition,
): void {
  const persisted = getCurrentCampaignPosition(db, campaignId);
  if (persisted === undefined) {
    if (currentPosition.ordinal !== 0) {
      throw new CampaignRuleError(
        `campaign '${campaignId}' has no persisted turn position; currentPosition must use ordinal 0`,
      );
    }
    return;
  }
  if (compareCampaignPositions(currentPosition, persisted) !== 0) {
    throw new CampaignRuleError(
      'currentPosition does not match the persisted current campaign position',
    );
  }
}

function assertPersistedPosition(
  db: Db,
  campaignId: string,
  candidate: CampaignPosition,
  field: string,
): void {
  const persisted = getCampaignPositionAtOrdinal(
    db,
    campaignId,
    candidate.ordinal,
  );
  if (
    persisted === undefined ||
    compareCampaignPositions(candidate, persisted) !== 0
  ) {
    throw new CampaignRuleError(
      `${field} does not match the persisted campaign turn position`,
    );
  }
}

/**
 * Future prospective rules may use an ordinal whose turn has not been
 * persisted yet. At or before the current turn, every anchor must be the
 * canonical chronology row rather than a caller-fabricated tie-breaker.
 */
function assertPersistedPositionAtOrBeforeCurrent(
  db: Db,
  campaignId: string,
  candidate: CampaignPosition,
  field: string,
): void {
  const current = getCurrentCampaignPosition(db, campaignId);
  if (current !== undefined && candidate.ordinal <= current.ordinal)
    assertPersistedPosition(db, campaignId, candidate, field);
}

export function getCampaignRule(
  db: Db,
  key: CampaignRuleKey,
): CampaignRule | undefined {
  const row = db
    .prepare(`${SELECT} WHERE campaign_id = ? AND rule_identity = ?`)
    .get(key.campaignId, key.ruleIdentity) as RuleRow | undefined;
  return row === undefined ? undefined : rowToRule(row);
}

export function listCampaignRules(
  db: Db,
  selector: { readonly campaignId: string },
): CampaignRule[] {
  const rows = db
    .prepare(`${SELECT} WHERE campaign_id = ?`)
    .all(selector.campaignId) as RuleRow[];
  return [...orderCampaignRules(rows.map(rowToRule))];
}

export function revokeCampaignRule(
  db: Db,
  input: RevokeCampaignRuleInput,
): CampaignRule {
  if (input.currentPosition === undefined) {
    throw new CampaignRuleError(
      'currentPosition is required for live campaign rule revocation',
    );
  }
  return withTransaction(db, (txn) => {
    formatCampaignPosition(input.currentPosition);
    assertCurrentPosition(txn, input.campaignId, input.currentPosition);
    const existing = getCampaignRule(txn, input);
    if (existing === undefined)
      throw new CampaignRuleError(
        `campaign rule '${input.ruleIdentity}' does not exist in campaign '${input.campaignId}'`,
      );
    if (existing.status !== 'active')
      throw new CampaignRuleError(
        `campaign rule '${input.ruleIdentity}' is not active`,
      );
    formatCampaignPosition(input.revokedPosition);
    if (input.revokedPosition.ordinal <= input.currentPosition.ordinal)
      throw new CampaignRuleError(
        `campaign rule '${input.ruleIdentity}' cannot be revoked at or before the current position`,
      );
    // A future cancellation stores the supplied ordinal at the canonical
    // __future__ anchor. This makes a rule scheduled later never active while
    // keeping the current active set unchanged.
    const revokedPosition = formatCampaignPosition(
      canonicalizeFuturePosition(
        txn,
        input.campaignId,
        input.revokedPosition,
        input.currentPosition,
      ),
    );
    txn
      .prepare(
        `UPDATE campaign_rule SET status='revoked', revoked_position=?, session_id=?, updated_at=? WHERE campaign_id=? AND rule_identity=?`,
      )
      .run(
        revokedPosition,
        input.sessionId ?? 'campaign-rule',
        input.updatedAt ?? new Date().toISOString(),
        input.campaignId,
        input.ruleIdentity,
      );
    return getCampaignRule(txn, input) as CampaignRule;
  });
}

export function supersedeCampaignRule(
  db: Db,
  input: SupersedeCampaignRuleInput,
): CampaignRule {
  if (input.currentPosition === undefined) {
    throw new CampaignRuleError(
      'currentPosition is required for live campaign rule supersession',
    );
  }
  return withTransaction(db, (txn) => {
    formatCampaignPosition(input.currentPosition);
    assertCurrentPosition(txn, input.campaignId, input.currentPosition);
    if (input.successor.campaignId !== input.campaignId)
      throw new CampaignRuleError('supersession cannot cross campaigns');
    const prior = getCampaignRule(txn, input);
    if (prior === undefined)
      throw new CampaignRuleError(
        `campaign rule '${input.ruleIdentity}' does not exist in campaign '${input.campaignId}'`,
      );
    if (prior.status !== 'active') {
      throw new CampaignRuleError(
        prior.status === 'superseded'
          ? `campaign rule '${input.ruleIdentity}' is already superseded`
          : `campaign rule '${input.ruleIdentity}' is revoked`,
      );
    }
    const successor = canonicalizeFutureEffectivePosition(
      txn,
      input.successor,
      input.currentPosition,
    );
    validatePriorForSupersession(
      prior,
      input.campaignId,
      input.ruleIdentity,
      successor.ruleIdentity,
    );
    if (
      compareCampaignPositions(
        successor.effectivePosition,
        prior.effectivePosition,
      ) < 0
    )
      throw new CampaignRuleError(
        `successor '${input.successor.ruleIdentity}' cannot take effect before '${input.ruleIdentity}'`,
      );
    if (
      successor.temporalMode.mode === 'prospective' &&
      successor.effectivePosition.ordinal <= input.currentPosition.ordinal
    )
      throw new CampaignRuleError(
        `successor '${input.successor.ruleIdentity}' cannot take effect at or before the current position`,
      );
    assertPersistedPositionAtOrBeforeCurrent(
      txn,
      input.campaignId,
      successor.effectivePosition,
      'successor.effectivePosition',
    );
    if (
      getCampaignRule(txn, {
        campaignId: input.campaignId,
        ruleIdentity: successor.ruleIdentity,
      }) !== undefined
    )
      throw new CampaignRuleError(
        `campaign rule '${successor.ruleIdentity}' already exists`,
      );
    validateCampaignRule(successor, input.validation, input.currentPosition);
    validateCampaignRules([successor], input.validation);
    txn
      .prepare(
        `UPDATE campaign_rule SET status='superseded', superseded_by=?, session_id=?, updated_at=? WHERE campaign_id=? AND rule_identity=?`,
      )
      .run(
        input.successor.ruleIdentity,
        input.sessionId ?? 'campaign-rule',
        input.updatedAt ?? new Date().toISOString(),
        input.campaignId,
        input.ruleIdentity,
      );
    const storedSuccessor = writeRule(txn, successor, {
      currentPosition: input.currentPosition,
      sessionId: input.sessionId,
      updatedAt: input.updatedAt,
      validation: input.validation,
    });
    return storedSuccessor;
  });
}

function activeRows(
  db: Db,
  campaignId: string,
  cutoff: string,
): CampaignRule[] {
  // Do all position predicates through the decoded comparator. Equal-ordinal
  // campaign_rule rows are valid even though campaign_turn_position ordinals
  // are unique, so SQL BINARY comparison of encoded anchors is insufficient.
  const cutoffPosition = position(cutoff);
  const rows = db
    .prepare(`${SELECT} WHERE campaign_id = ?`)
    .all(campaignId) as RuleRow[];
  const rowsByIdentity = new Map(rows.map((row) => [row.rule_identity, row]));
  const rules = rows.map(rowToRule);
  const rulesByIdentity = new Map(
    rules.map((rule) => [rule.ruleIdentity, rule]),
  );
  return [
    ...orderCampaignRules(
      rules
        .filter(
          (rule) =>
            compareCampaignPositions(rule.effectivePosition, cutoffPosition) <=
            0,
        )
        .filter((rule) => {
          if (rule.status === 'revoked') {
            const row = rowsByIdentity.get(rule.ruleIdentity);
            return (
              row?.revoked_position !== null &&
              row?.revoked_position !== undefined &&
              compareCampaignPositions(
                position(row.revoked_position),
                cutoffPosition,
              ) > 0
            );
          }
          if (rule.status !== 'superseded') return true;
          const row = rowsByIdentity.get(rule.ruleIdentity);
          if (row?.superseded_by === null || row?.superseded_by === undefined)
            return false;
          const successor = rulesByIdentity.get(row.superseded_by);
          return (
            successor !== undefined &&
            compareCampaignPositions(
              successor.effectivePosition,
              cutoffPosition,
            ) > 0
          );
        }),
    ),
  ];
}

export function listActiveCampaignRulesAtPosition(
  db: Db,
  campaignId: string,
  campaignPosition: string,
): CampaignRule[] {
  const canonicalPosition = formatCampaignPosition(
    parseCampaignPosition(campaignPosition),
  );
  return activeRows(db, campaignId, canonicalPosition);
}

export function listActiveRulingsForAmbiguitiesAtPosition(
  db: Db,
  campaignId: string,
  ambiguityIds: readonly string[],
  campaignPosition: string,
  options: { readonly includeAllActive?: boolean } = {},
): CampaignRulingProjection[] {
  const canonicalPosition = formatCampaignPosition(
    parseCampaignPosition(campaignPosition),
  );
  return activeRows(db, campaignId, canonicalPosition)
    .filter(isAmbiguityRuling)
    .filter(
      (r) =>
        options.includeAllActive === true ||
        ambiguityIds.includes(r.provenance.ambiguityId),
    )
    .map((r) => {
      const projection = projectCampaignRule(r);
      return {
        ...projection,
        ruleKind: 'ruling' as const,
        ambiguityId: r.provenance.ambiguityId,
        selectedInterpretationId: r.provenance.selectedInterpretationId,
      };
    });
}

/**
 * The discovery seam binds a required campaign position so every query is
 * replay-accurate.
 */
export function createCampaignRuleReadSeam(
  db: Db,
  campaignId: string,
  campaignPosition: string,
): CampaignRuleReadSeam {
  const canonicalPosition = formatCampaignPosition(
    parseCampaignPosition(campaignPosition),
  );
  return {
    activeRulesAtPosition: (query: RuleSeamQuery) => {
      const queryPosition =
        query.campaignPosition === undefined
          ? canonicalPosition
          : formatCampaignPosition(
              parseCampaignPosition(query.campaignPosition),
            );
      if (queryPosition !== canonicalPosition)
        throw new CampaignRuleError(
          `campaign rule seam is bound to ${canonicalPosition}, not ${queryPosition}`,
        );
      return activeRows(db, campaignId, queryPosition)
        .filter((r) => !isAmbiguityRuling(r))
        .map(projectCampaignRule);
    },
    activeRulingsForAmbiguities: (
      ambiguityIds: readonly string[],
      options?: { readonly includeAllActive?: boolean },
    ) =>
      listActiveRulingsForAmbiguitiesAtPosition(
        db,
        campaignId,
        ambiguityIds,
        canonicalPosition,
        options,
      ),
  };
}
