import {
  type Db,
  type ExecutedToolCall,
  getCurrentCampaignPosition,
  recordAmbiguityRuling,
} from '@eshyra/core';
import type { PlayDeps } from './playTypes.js';

interface AmbiguityPromptData {
  readonly ambiguityId: string;
  readonly question: string;
  readonly interpretations: readonly { id: string; summary: string }[];
  readonly status: string;
}

interface AmbiguityConflictData {
  readonly ambiguityId: string;
  readonly status: 'conflicting';
  readonly conflictingRulings: readonly string[];
}

function isConflictData(value: unknown): value is AmbiguityConflictData {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.ambiguityId === 'string' &&
    data.status === 'conflicting' &&
    Array.isArray(data.conflictingRulings) &&
    data.conflictingRulings.every((item) => typeof item === 'string')
  );
}

function isPromptData(value: unknown): value is AmbiguityPromptData {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.ambiguityId === 'string' &&
    typeof data.question === 'string' &&
    data.status === 'unresolved' &&
    Array.isArray(data.interpretations) &&
    data.interpretations.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).summary === 'string',
    )
  );
}

function ambiguityIdFromCall(call: ExecutedToolCall): string | undefined {
  if (
    typeof call.args !== 'object' ||
    call.args === null ||
    Array.isArray(call.args)
  )
    return undefined;
  const value = (call.args as Record<string, unknown>).ambiguityId;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Offer player choices for unresolved ambiguity requests emitted by a turn.
 *
 * A request whose ambiguity is `conflicting` (two active rulings overlap, so
 * neither is authoritative) is not a choice: recording a third ruling cannot
 * repair it, so the player is told to revoke or supersede one of the
 * conflicting rulings with `/rules` instead of being prompted.
 */
export async function offerAmbiguityRulings(
  deps: PlayDeps,
  db: Db,
  campaignId: string,
  toolCalls: readonly ExecutedToolCall[],
): Promise<void> {
  const offered = new Set<string>();
  for (const call of toolCalls) {
    if (call.tool !== 'request_ambiguity_ruling' || !call.result.ok) continue;
    if (isConflictData(call.result.data)) {
      const ambiguityId =
        ambiguityIdFromCall(call) ?? call.result.data.ambiguityId;
      if (offered.has(ambiguityId)) continue;
      offered.add(ambiguityId);
      deps.io.write(
        `Rulings ${call.result.data.conflictingRulings.join(', ')} for ${ambiguityId} conflict; none is authoritative and no choice can be recorded until one is repaired. Use '/rules revoke <ruleIdentity>' or '/rules supersede <ruleIdentity> ...' to repair it.`,
      );
      continue;
    }
    if (!isPromptData(call.result.data)) continue;
    const ambiguityId =
      ambiguityIdFromCall(call) ?? call.result.data.ambiguityId;
    if (offered.has(ambiguityId)) continue;
    offered.add(ambiguityId);

    deps.io.write(call.result.data.question);
    for (const [
      index,
      interpretation,
    ] of call.result.data.interpretations.entries()) {
      deps.io.write(
        `${index + 1}. ${interpretation.id}: ${interpretation.summary}`,
      );
    }
    const answer = await deps.io.prompt(
      'Choose an interpretation number, or press Enter to leave it unresolved: ',
    );
    const choice = answer?.trim() ?? '';
    const choiceIndex = /^\d+$/.test(choice) ? Number(choice) - 1 : -1;
    const interpretation = call.result.data.interpretations[choiceIndex];
    if (interpretation === undefined) {
      deps.io.write('Left unresolved.');
      continue;
    }

    const currentPosition = getCurrentCampaignPosition(db, campaignId);
    if (currentPosition === undefined) {
      deps.io.write(
        `campaign '${campaignId}' has no persisted current turn position`,
      );
      continue;
    }
    try {
      const recorded = recordAmbiguityRuling(db, {
        campaignId,
        ambiguityId,
        interpretationId: interpretation.id,
        currentPosition,
      });
      deps.io.write(
        recorded.created
          ? `Ruling recorded ('${recorded.rule.ruleIdentity}'); takes effect from turn ${recorded.rule.effectivePosition.ordinal}.`
          : `Ruling already recorded ('${recorded.rule.ruleIdentity}'); takes effect from turn ${recorded.rule.effectivePosition.ordinal}.`,
      );
    } catch (error) {
      deps.io.write(error instanceof Error ? error.message : String(error));
    }
  }
}
