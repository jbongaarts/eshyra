/**
 * Catch-up continuity bridge CLI offer (ADR 0012, eshyra-lupf.14.4.3).
 *
 * After a character is caught up to the registry head, the party last saw them
 * at the stale revision and they resume changed. This offers an OPTIONAL short
 * in-fiction explanation for that gap, selectable between a player-provided line
 * and a DM-generated one (or skipping entirely). It never blocks: the mechanical
 * catch-up has already happened by the time this runs, and any failure here is
 * reported but does not abort resume.
 */

import {
  type CharacterSheet,
  composeContinuityBridge,
  type Db,
  getSessionLaunchState,
  summarizeSheetForBridge,
} from '@eshyra/core';
import type { PlayDeps } from './playTypes.js';

/** What a single caught-up character needs to bridge its continuity gap. */
export interface ContinuityBridgeContext {
  /** Display name of the caught-up character. */
  readonly characterName: string;
  /** The campaign's prior (stale) sheet, captured before catch-up overwrote it. */
  readonly priorSheet: CharacterSheet | undefined;
  /** The newly adopted head sheet. */
  readonly newSheet: CharacterSheet;
}

/**
 * Assemble a short scene-context string from the campaign's open scene, if any,
 * to ground a DM-generated bridge. Returns undefined when resuming with no open
 * scene (a clean scene-boundary resume needs no grounding).
 */
function sceneContext(db: Db, campaignId: string): string | undefined {
  const launch = getSessionLaunchState(db, { campaignId });
  if (launch.kind !== 'resume' || launch.openScene === undefined) {
    return undefined;
  }
  return `Scene: ${launch.openScene.title}`;
}

/**
 * Offer a continuity bridge for one caught-up character. Prompts for the
 * narration source; `me` collects a player line, `dm` asks the model, anything
 * else (including EOF) skips. Best-effort: a model failure is reported and
 * treated as a skip.
 */
export async function offerContinuityBridge(
  deps: Pick<PlayDeps, 'io' | 'model'>,
  db: Db,
  campaignId: string,
  context: ContinuityBridgeContext,
): Promise<void> {
  const choice = await deps.io.prompt(
    `Bridge ${context.characterName}'s changed state in-fiction? [skip/me/dm]: `,
  );
  const normalized = choice?.trim().toLowerCase() ?? '';

  if (normalized === 'me') {
    const line = await deps.io.prompt('Your in-fiction explanation: ');
    const text = line?.trim();
    if (text === undefined || text.length === 0) {
      deps.io.write('No bridge added.');
      return;
    }
    deps.io.write(`Continuity bridge: ${text}`);
    return;
  }

  if (normalized === 'dm') {
    try {
      const bridge = await composeContinuityBridge(deps.model, {
        characterName: context.characterName,
        ...(context.priorSheet !== undefined
          ? { priorSummary: summarizeSheetForBridge(context.priorSheet) }
          : {}),
        newSummary: summarizeSheetForBridge(context.newSheet),
        ...(sceneContext(db, campaignId) !== undefined
          ? { sceneContext: sceneContext(db, campaignId) as string }
          : {}),
        campaignId,
      });
      deps.io.write(`Continuity bridge: ${bridge}`);
    } catch (error) {
      deps.io.write(
        'Could not generate a continuity bridge: ' +
          `${error instanceof Error ? error.message : String(error)}. Skipping.`,
      );
    }
    return;
  }

  deps.io.write('No continuity bridge added.');
}
