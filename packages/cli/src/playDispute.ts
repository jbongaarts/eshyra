import {
  type Db,
  disputeTurn,
  getCurrentCampaignPosition,
  type RunTurnResult,
  resumeDisputedTurn,
} from '@eshyra/core';
import { offerAmbiguityRulings } from './playRulings.js';
import type { PlayDeps } from './playTypes.js';

export async function runDisputeCommand(
  deps: PlayDeps,
  db: Db,
  campaignId: string,
  arg: string,
): Promise<void> {
  const coreDeps = {
    db,
    model: deps.model,
    registry: deps.registry,
    auditor: deps.auditor,
    debug: deps.debug,
    diagnostics: deps.diagnostics,
    resolveAdventureModule: deps.resolveAdventureModule,
    characterChronicle: deps.characterChronicle,
  };
  const present = async (result: RunTurnResult): Promise<void> => {
    if (result.ok) {
      deps.io.write(result.narration);
      await offerAmbiguityRulings(deps, db, campaignId, result.toolCalls);
    } else {
      deps.io.write(
        `Replay remains pending: ${result.error}. Pre-turn state and your approved rule are retained. Use /dispute retry.`,
      );
    }
  };
  try {
    if (arg === 'retry') {
      const result = await resumeDisputedTurn(coreDeps, campaignId);
      await present(result);
      return;
    }
    const position = getCurrentCampaignPosition(db, campaignId);
    if (!position) {
      deps.io.write('There is no adjudication to dispute.');
      return;
    }
    const kind = await deps.io.prompt('Rule kind (house-rule or ruling): ');
    if (kind !== 'house-rule' && kind !== 'ruling') {
      deps.io.write('Dispute cancelled.');
      return;
    }
    const prose =
      arg ||
      (await deps.io.prompt('Rule to apply when replaying the last action: '));
    if (!prose) {
      deps.io.write('Dispute cancelled.');
      return;
    }
    let ambiguityId: string | undefined;
    let interpretationId: string | undefined;
    let questionId: string | undefined;
    if (kind === 'ruling') {
      ambiguityId = await deps.io.prompt(
        'Source ambiguity ID (leave blank for a recurring question): ',
      );
      if (ambiguityId)
        interpretationId = await deps.io.prompt('Known interpretation ID: ');
      else {
        ambiguityId = undefined;
        questionId = await deps.io.prompt('Recurring question ID: ');
      }
    }
    let governingRecordKeys: string[] = [];
    if (ambiguityId === undefined) {
      const records = await deps.io.prompt(
        'Governing source record keys (comma separated): ',
      );
      if (!records?.trim()) {
        deps.io.write('Dispute cancelled: governing source keys are required.');
        return;
      }
      governingRecordKeys = records
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    }
    const supersedes = await deps.io.prompt(
      'Existing rule identity to supersede (leave blank for a new rule): ',
    );
    const approved = await deps.io.prompt(
      `Replay the last action under this ${kind}: "${prose}"? Type yes to approve: `,
    );
    if (approved?.toLowerCase() !== 'yes') {
      deps.io.write('Dispute cancelled.');
      return;
    }
    const result = await disputeTurn(coreDeps, {
      campaignId,
      sessionId: position.sessionId,
      turnId: position.turnId,
      approvedRule: {
        kind,
        prose,
        governingRecordKeys,
        ambiguityId,
        interpretationId,
        questionId,
        supersedes: supersedes || undefined,
      },
    });
    await present(result);
  } catch (error) {
    deps.io.write(
      `Cannot replay: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
