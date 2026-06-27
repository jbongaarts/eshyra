/**
 * Catch-up continuity bridge narration (ADR 0012, eshyra-lupf.14.4.3).
 *
 * After a campaign catches a character up to the registry head
 * ({@link catchUpCharacterToHead}), the party last saw that character at the
 * stale revision and they resume changed — higher level, new gear, fresh scars.
 * A *continuity bridge* is a short in-fiction explanation for that gap. It is
 * **optional flavor**: the mechanical catch-up succeeds with or without it, and
 * the player may supply their own line, ask the DM model for one, or skip it
 * entirely. This module is the DM-generated path: a pure read-side model call
 * that returns the bridge text verbatim.
 */

import type { ModelClient, ModelMessage } from '../model/client.js';
import type { CharacterSheet } from './finalizeCharacter.js';

/**
 * System prompt the continuity-bridge call runs under. Shaped for the player-
 * facing audience: a brief, evocative in-fiction reconnection, not a mechanical
 * changelog and not a meta explanation of timelines.
 */
const CONTINUITY_BRIDGE_SYSTEM_PROMPT = [
  'You are the DM for a fantasy tabletop campaign.',
  'A returning character has been away adventuring elsewhere and rejoins the',
  'party changed — different level, equipment, and condition than the party last',
  'saw. Write a SHORT in-fiction bridge (1-3 sentences, second person or close',
  'third person) that reconnects the character to the current scene and gently',
  'acknowledges what has changed about them. Do not list game statistics, do not',
  'mention revisions, timelines, or campaigns by name, and do not address the',
  'player about meta concerns. Just the in-world reconnection.',
].join(' ');

/** Inputs for {@link composeContinuityBridge}. */
export interface ContinuityBridgeInput {
  /** The character whose state changed. */
  readonly characterName: string;
  /** One-line summary of the campaign's prior (stale) copy, if known. */
  readonly priorSummary?: string;
  /** One-line summary of the newly adopted head revision. */
  readonly newSummary: string;
  /**
   * Current scene context to ground the reconnection (e.g. the open scene title
   * and a short tail of recent narration). Omitted when resuming with no open
   * scene.
   */
  readonly sceneContext?: string;
  /** Campaign id for usage attribution. */
  readonly campaignId?: string;
  /** Session id for usage attribution, when a session is active. */
  readonly sessionId?: string;
}

/**
 * Build a one-line mechanical summary of a sheet to give the bridge model just
 * enough context about how the character changed, without dumping the full
 * sheet. Deterministic and side-effect free.
 */
export function summarizeSheetForBridge(sheet: CharacterSheet): string {
  return `level ${sheet.level} ${sheet.ancestry.name} ${sheet.class.name}, ${sheet.maxHitPoints} max HP`;
}

function renderBridgeContext(input: ContinuityBridgeInput): string {
  const lines = [`Character: ${input.characterName}`];
  if (input.priorSummary !== undefined) {
    lines.push(`When the party last saw them: ${input.priorSummary}`);
  }
  lines.push(`How they return now: ${input.newSummary}`);
  if (
    input.sceneContext !== undefined &&
    input.sceneContext.trim().length > 0
  ) {
    lines.push('', 'Current scene:', input.sceneContext.trim());
  }
  return lines.join('\n');
}

/**
 * Ask the DM model for a short continuity bridge explaining a caught-up
 * character's changed state. Pure read-side: no DB access, no writes. The
 * returned text is the model's completion verbatim; provider errors propagate
 * per the {@link ModelClient} contract for the caller (the CLI) to handle — a
 * failed bridge never blocks the already-completed mechanical catch-up.
 */
export async function composeContinuityBridge(
  model: ModelClient,
  input: ContinuityBridgeInput,
): Promise<string> {
  const messages: ModelMessage[] = [
    { role: 'user', content: renderBridgeContext(input) },
  ];
  const result = await model.complete({
    system: CONTINUITY_BRIDGE_SYSTEM_PROMPT,
    messages,
    trace: {
      ...(input.campaignId !== undefined
        ? { campaignId: input.campaignId }
        : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      extra: { purpose: 'continuity_bridge' },
    },
  });
  return result.text.trim();
}
