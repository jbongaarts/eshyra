import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import { getCurrentCampaignPosition } from './campaignPosition.js';
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

function writeRule(
  db: Db,
  rule: CampaignRule,
  options: CreateCampaignRuleOptions,
): void {
  validateCampaignRule(rule, options.validation, options.currentPosition);
  if (rule.status !== 'active') {
    throw new CampaignRuleError(
      `live campaign rule creation requires active status; use the lifecycle mutation for '${rule.ruleIdentity}'`,
    );
  }
  assertNoOverlappingAmbiguityRuling(db, rule, undefined);
  if (
    getCampaignRule(db, {
      campaignId: rule.campaignId,
      ruleIdentity: rule.ruleIdentity,
    }) !== undefined
  ) {
    throw new CampaignRuleError(
      `campaign rule '${rule.ruleIdentity}' already exists`,
    );
  }
  const p = rule.provenance;
  db.prepare(`INSERT INTO campaign_rule (
    campaign_id, rule_identity, rule_kind, status, origin, provenance_kind,
    ambiguity_id, selected_interpretation_id, question_id, rationale,
    effective_position, temporal_mode, disputed_position, superseded_by,
    revoked_position, scope, governing_record_keys_json, prose, provenance,
    session_id, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    rule.campaignId,
    rule.ruleIdentity,
    rule.ruleKind,
    rule.status,
    rule.origin,
    p.kind,
    p.kind === 'ambiguity' ? p.ambiguityId : null,
    p.kind === 'ambiguity' ? p.selectedInterpretationId : null,
    p.kind === 'recurring-question' ? p.questionId : null,
    p.kind === 'house-rule' ? (p.rationale ?? null) : null,
    formatCampaignPosition(rule.effectivePosition),
    rule.temporalMode.mode,
    rule.temporalMode.mode === 'disputed-turn'
      ? formatCampaignPosition(rule.temporalMode.disputedPosition)
      : null,
    rule.supersededBy,
    null,
    rule.scope,
    keysColumn.encode(rule.governingRecordKeys),
    rule.prose,
    p.kind === 'ambiguity'
      ? `ambiguity:${p.ambiguityId}#${p.selectedInterpretationId}`
      : p.kind === 'recurring-question'
        ? `question:${p.questionId}`
        : 'house-rule',
    options.sessionId ?? 'campaign-rule',
    options.updatedAt ?? new Date().toISOString(),
  );
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
    writeRule(txn, rule, options);
    return rule;
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
  formatCampaignPosition(input.currentPosition);
  assertCurrentPosition(db, input.campaignId, input.currentPosition);
  const existing = getCampaignRule(db, input);
  if (existing === undefined)
    throw new CampaignRuleError(
      `campaign rule '${input.ruleIdentity}' does not exist in campaign '${input.campaignId}'`,
    );
  if (existing.status !== 'active')
    throw new CampaignRuleError(
      `campaign rule '${input.ruleIdentity}' is not active`,
    );
  if (
    compareCampaignPositions(
      input.revokedPosition,
      existing.effectivePosition,
    ) < 0
  )
    throw new CampaignRuleError(
      `campaign rule '${input.ruleIdentity}' cannot be revoked before its effective position`,
    );
  if (
    compareCampaignPositions(input.revokedPosition, input.currentPosition) < 0
  )
    throw new CampaignRuleError(
      `campaign rule '${input.ruleIdentity}' cannot be revoked before the current position`,
    );
  const revokedPosition = formatCampaignPosition(input.revokedPosition);
  db.prepare(
    `UPDATE campaign_rule SET status='revoked', revoked_position=?, session_id=?, updated_at=? WHERE campaign_id=? AND rule_identity=?`,
  ).run(
    revokedPosition,
    input.sessionId ?? 'campaign-rule',
    input.updatedAt ?? new Date().toISOString(),
    input.campaignId,
    input.ruleIdentity,
  );
  return getCampaignRule(db, input) as CampaignRule;
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
  formatCampaignPosition(input.currentPosition);
  assertCurrentPosition(db, input.campaignId, input.currentPosition);
  if (input.successor.campaignId !== input.campaignId)
    throw new CampaignRuleError('supersession cannot cross campaigns');
  const prior = getCampaignRule(db, input);
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
  if (input.successor.ruleIdentity === input.ruleIdentity)
    throw new CampaignRuleError('a rule cannot supersede itself');
  if (
    compareCampaignPositions(
      input.successor.effectivePosition,
      prior.effectivePosition,
    ) < 0
  )
    throw new CampaignRuleError(
      `successor '${input.successor.ruleIdentity}' cannot take effect before '${input.ruleIdentity}'`,
    );
  if (
    compareCampaignPositions(
      input.successor.effectivePosition,
      input.currentPosition,
    ) < 0
  )
    throw new CampaignRuleError(
      `successor '${input.successor.ruleIdentity}' cannot take effect before the current position`,
    );
  if (
    getCampaignRule(db, {
      campaignId: input.campaignId,
      ruleIdentity: input.successor.ruleIdentity,
    }) !== undefined
  )
    throw new CampaignRuleError(
      `campaign rule '${input.successor.ruleIdentity}' already exists`,
    );
  validateCampaignRule(prior, input.validation);
  validateCampaignRule(
    input.successor,
    input.validation,
    input.currentPosition,
  );
  validateCampaignRules(
    [
      {
        ...prior,
        status: 'superseded',
        supersededBy: input.successor.ruleIdentity,
      },
      input.successor,
    ],
    input.validation,
  );
  return withTransaction(db, (txn) => {
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
    writeRule(txn, input.successor, {
      currentPosition: input.currentPosition,
      sessionId: input.sessionId,
      updatedAt: input.updatedAt,
      validation: input.validation,
    });
    return input.successor;
  });
}

function activeRows(
  db: Db,
  campaignId: string,
  cutoff: string,
): CampaignRule[] {
  // SQL compares canonical position strings as BINARY; formatCampaignPosition
  // puts the unique campaign ordinal first, matching decoded comparisons.
  const predicate = `effective_position <= ? AND (revoked_position IS NULL OR revoked_position > ?) AND (status != 'superseded' OR EXISTS (SELECT 1 FROM campaign_rule successor WHERE successor.campaign_id=campaign_rule.campaign_id AND successor.rule_identity=campaign_rule.superseded_by AND successor.effective_position > ?))`;
  const args = [campaignId, cutoff, cutoff, cutoff];
  const rows = db
    .prepare(
      // Canonical campaign positions are self-sorting; SQL can order them directly.
      `${SELECT} WHERE campaign_id = ? AND ${predicate} ORDER BY effective_position, CASE rule_kind WHEN 'ruling' THEN 0 ELSE 1 END, rule_identity`,
    )
    .all(...args) as RuleRow[];
  return rows.map(rowToRule);
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
