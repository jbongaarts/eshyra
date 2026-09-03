import type { CampaignRuleReadSeam } from '../discovery/types.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import type {
  CampaignPosition,
  CampaignRule,
  CampaignRuleProvenance,
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
  readonly sessionId?: string;
  readonly updatedAt?: string;
  /** Required when creating a rule already marked revoked. */
  readonly revokedPosition?: CampaignPosition;
  readonly validation?: Parameters<typeof validateCampaignRule>[1];
}

export interface RevokeCampaignRuleInput extends CampaignRuleKey {
  readonly revokedPosition: CampaignPosition;
  readonly sessionId?: string;
  readonly updatedAt?: string;
}

export interface SupersedeCampaignRuleInput {
  readonly campaignId: string;
  readonly ruleIdentity: string;
  readonly successor: CampaignRule;
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
  validateCampaignRule(rule, options.validation);
  if (rule.status === 'revoked' && options.revokedPosition === undefined) {
    throw new CampaignRuleError(
      'a revoked campaign rule requires revokedPosition',
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
    rule.status === 'revoked'
      ? formatCampaignPosition(options.revokedPosition as CampaignPosition)
      : null,
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
  options: CreateCampaignRuleOptions = {},
): CampaignRule {
  return withTransaction(db, (txn) => {
    writeRule(txn, rule, options);
    return rule;
  });
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
  if (input.successor.campaignId !== input.campaignId)
    throw new CampaignRuleError('supersession cannot cross campaigns');
  const prior = getCampaignRule(db, input);
  if (prior === undefined)
    throw new CampaignRuleError(
      `campaign rule '${input.ruleIdentity}' does not exist in campaign '${input.campaignId}'`,
    );
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
    getCampaignRule(db, {
      campaignId: input.campaignId,
      ruleIdentity: input.successor.ruleIdentity,
    }) !== undefined
  )
    throw new CampaignRuleError(
      `campaign rule '${input.successor.ruleIdentity}' already exists`,
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
  cutoff?: string,
): CampaignRule[] {
  const resolvedCutoff =
    cutoff ??
    (
      db
        .prepare(
          'SELECT MAX(effective_position) AS latest FROM campaign_rule WHERE campaign_id = ?',
        )
        .get(campaignId) as { latest: string | null }
    ).latest ??
    'cp1~000000000000~campaign-rule~latest';
  const predicate = `effective_position <= ? AND (revoked_position IS NULL OR revoked_position > ?) AND (status != 'superseded' OR EXISTS (SELECT 1 FROM campaign_rule successor WHERE successor.campaign_id=campaign_rule.campaign_id AND successor.rule_identity=campaign_rule.superseded_by AND successor.effective_position > ?))`;
  const args = [campaignId, resolvedCutoff, resolvedCutoff, resolvedCutoff];
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
  campaignPosition?: string,
): CampaignRule[] {
  return activeRows(db, campaignId, campaignPosition);
}

export function listActiveRulingsForAmbiguitiesAtPosition(
  db: Db,
  campaignId: string,
  ambiguityIds: readonly string[],
  campaignPosition?: string,
): CampaignRulingProjection[] {
  return activeRows(db, campaignId, campaignPosition)
    .filter(isAmbiguityRuling)
    .filter((r) => ambiguityIds.includes(r.provenance.ambiguityId))
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
 * The discovery seam is position-blind for rulings by contract. Callers that
 * need replay accuracy bind the requested campaign position here; otherwise
 * queries use the latest recorded rule position and still apply temporal
 * filtering.
 */
export function createCampaignRuleReadSeam(
  db: Db,
  campaignId: string,
  campaignPosition?: string,
): CampaignRuleReadSeam {
  return {
    activeRulesAtPosition: (query: RuleSeamQuery) =>
      activeRows(db, campaignId, query.campaignPosition ?? campaignPosition)
        .filter((r) => r.ruleKind === 'house-rule')
        .map(projectCampaignRule),
    activeRulingsForAmbiguities: (ambiguityIds: readonly string[]) =>
      listActiveRulingsForAmbiguitiesAtPosition(
        db,
        campaignId,
        ambiguityIds,
        campaignPosition,
      ),
  };
}
