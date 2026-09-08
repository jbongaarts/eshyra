import { randomUUID } from 'node:crypto';
import {
  type RunTurnDeps,
  type RunTurnInput,
  type RunTurnResult,
  runTurn,
} from '../orchestrator/orchestrator.js';
import { withTransaction } from '../persistence/db.js';
import { resolveStrictCampaignRulesStack } from '../state/campaignRecordLookup.js';
import {
  assembleCampaignRulesContext,
  campaignAmbiguitySourceKeys,
} from './campaignContext.js';
import {
  getCurrentCampaignPosition,
  resolveCampaignPosition,
} from './campaignPosition.js';
import {
  createCampaignRule,
  supersedeCampaignRule,
} from './campaignRuleStore.js';
import {
  type CampaignRule,
  CampaignRuleError,
  formatCampaignPosition,
} from './campaignRules.js';
import {
  assertReplayState,
  readTurnReplay,
  replayStateHash,
  restoreReplaySnapshot,
} from './turnReplayStore.js';

export interface DisputeTurnInput {
  campaignId: string;
  /** Exact latest adjudication the player is objecting to. */
  turnId: string;
  sessionId: string;
  approvedRule: {
    prose: string;
    /** Source ambiguity associations are derived from the bound stack; this field applies to other rules. */
    governingRecordKeys: readonly string[];
    kind: 'house-rule' | 'ruling';
    ambiguityId?: string;
    interpretationId?: string;
    questionId?: string;
    supersedes?: string;
  };
}

/** Explicit player approval only: never exposed as a model tool. */
export async function disputeTurn(
  deps: RunTurnDeps,
  input: DisputeTurnInput,
): Promise<RunTurnResult> {
  const { db } = deps;
  withTransaction(db, () => {
    const saved = readTurnReplay(db, input.campaignId);
    const current = getCurrentCampaignPosition(db, input.campaignId);
    if (
      saved?.status !== 'available' ||
      saved.turn_id !== input.turnId ||
      saved.session_id !== input.sessionId ||
      current?.turnId !== input.turnId ||
      current.sessionId !== input.sessionId
    )
      throw new CampaignRuleError(
        'Only the latest unreplayed adjudication may be disputed.',
      );
    assertReplayState(db, saved);
    if (!input.approvedRule.prose.trim())
      throw new CampaignRuleError('Player-approved rule prose is required.');
    const originalTrace = db
      .prepare(
        'SELECT * FROM turn_trace WHERE campaign_id=? AND session_id=? AND turn_id=?',
      )
      .get(input.campaignId, input.sessionId, input.turnId);
    if (!originalTrace)
      throw new CampaignRuleError('The disputed turn has no accepted trace.');
    const selection = input.approvedRule;
    if (
      selection.kind === 'house-rule' &&
      (selection.ambiguityId !== undefined ||
        selection.interpretationId !== undefined ||
        selection.questionId !== undefined)
    )
      throw new CampaignRuleError(
        'A house rule cannot carry ruling provenance.',
      );
    if (
      selection.ambiguityId === undefined &&
      selection.interpretationId !== undefined
    )
      throw new CampaignRuleError(
        'An interpretation requires a source ambiguity.',
      );
    if (
      selection.ambiguityId !== undefined &&
      selection.questionId !== undefined
    )
      throw new CampaignRuleError(
        'Choose source ambiguity or recurring-question provenance, not both.',
      );
    const stack =
      selection.ambiguityId === undefined
        ? undefined
        : resolveStrictCampaignRulesStack(db, deps.resolveRulesPack);
    const ambiguity =
      stack === undefined
        ? undefined
        : assembleCampaignRulesContext(
            db,
            input.campaignId,
            formatCampaignPosition(current),
            stack,
          ).ambiguities.find(
            ({ ambiguity }) => ambiguity.id === selection.ambiguityId,
          )?.ambiguity;
    if (selection.ambiguityId !== undefined && ambiguity === undefined)
      throw new CampaignRuleError(`unknown ambiguity ${selection.ambiguityId}`);
    const rule: CampaignRule = {
      campaignId: input.campaignId,
      ruleIdentity: `dispute:${randomUUID()}`,
      ruleKind: selection.kind,
      origin: 'player-authored',
      status: 'active',
      provenance:
        selection.kind === 'house-rule'
          ? { kind: 'house-rule' }
          : ambiguity !== undefined
            ? {
                kind: 'ambiguity',
                ambiguityId: ambiguity.id,
                selectedInterpretationId: selection.interpretationId ?? '',
              }
            : {
                kind: 'recurring-question',
                questionId: selection.questionId ?? '',
              },
      prose: selection.prose,
      effectivePosition: current,
      temporalMode: { mode: 'disputed-turn', disputedPosition: current },
      supersededBy: null,
      revokedPosition: null,
      scope: 'campaign',
      governingRecordKeys:
        stack !== undefined && ambiguity !== undefined
          ? campaignAmbiguitySourceKeys(stack, ambiguity.id)
          : selection.governingRecordKeys,
    };
    restoreReplaySnapshot(db, JSON.parse(saved.before_json));
    const position = resolveCampaignPosition(db, input);
    if (position.ordinal !== current.ordinal)
      throw new CampaignRuleError(
        'Replay chronology does not match the disputed turn.',
      );
    if (selection.supersedes === undefined)
      createCampaignRule(db, rule, {
        currentPosition: current,
        validation: { ambiguity },
        sessionId: input.sessionId,
      });
    else
      supersedeCampaignRule(db, {
        campaignId: input.campaignId,
        ruleIdentity: selection.supersedes,
        successor: rule,
        currentPosition: current,
        validation: { ambiguity },
        sessionId: input.sessionId,
      });
    db.prepare('INSERT INTO turn_replay_diagnostic VALUES (?, ?, ?, ?, ?)').run(
      input.campaignId,
      input.sessionId,
      input.turnId,
      JSON.stringify(originalTrace),
      rule.ruleIdentity,
    );
    db.prepare(
      "UPDATE turn_replay SET status='pending', state_hash=? WHERE campaign_id=?",
    ).run(replayStateHash(db), input.campaignId);
  });
  return resumeDisputedTurn(deps, input.campaignId);
}

/** Retry only the same approved replay after a provider/audit failure. */
export async function resumeDisputedTurn(
  deps: RunTurnDeps,
  campaignId: string,
): Promise<RunTurnResult> {
  const saved = readTurnReplay(deps.db, campaignId);
  if (saved?.status !== 'pending')
    throw new CampaignRuleError('No disputed replay is pending.');
  assertReplayState(deps.db, saved);
  return runTurn(deps, JSON.parse(saved.input_json) as RunTurnInput);
}

/** Minimal durable recovery state for front ends; no snapshot payload exposure. */
export function getPendingDisputedTurn(
  db: RunTurnDeps['db'],
  campaignId: string,
): { sessionId: string; turnId: string } | undefined {
  const saved = readTurnReplay(db, campaignId);
  return saved?.status === 'pending'
    ? { sessionId: saved.session_id, turnId: saved.turn_id }
    : undefined;
}
