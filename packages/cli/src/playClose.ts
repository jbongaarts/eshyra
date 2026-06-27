import type {
  ArcSummaryRecord,
  CampaignBibleInput,
  CampaignBibleRecord,
  CloseSessionGracefullyInput,
  Db,
  ExtractCampaignBibleInput,
  SessionRecapRecord,
} from '@eshyra/core';
import {
  closeOpenArcAndOpenNext,
  closeSessionGracefully,
  composeArcSummary,
  composeSessionRecap,
  createSqliteCharacterSheetStore,
  extractCampaignBible,
  getCampaignBible,
  getClosedSessionsInOpenArc,
  getSessionRecap,
  listClosedArcSummaries,
  openArcIfMissing,
  releaseCharacterFromCampaign,
} from '@eshyra/core';
import type { PlayDeps } from './playTypes.js';

/**
 * Release every registry-linked character this campaign holds (ADR 0012,
 * eshyra-lupf.14.3): commit a sync-back revision from the campaign sheet and
 * drop custody, so the character is idle and free to be checked out again on
 * resume or in another campaign. Characters created directly in-campaign (no
 * `globalCharacterId`) are skipped. Best-effort: a release failure is reported
 * but never blocks a clean exit.
 */
function releaseCampaignCharacters(deps: PlayDeps, db: Db): void {
  for (const characterId of createSqliteCharacterSheetStore(db).list()) {
    try {
      const released = releaseCharacterFromCampaign(
        deps.characterRegistry,
        db,
        {
          characterId,
        },
      );
      if (released?.committed) {
        deps.io.write(
          `Synced ${characterId} back to the registry as ${released.globalCharacterId}@${released.revision}.`,
        );
      }
    } catch (error) {
      deps.io.write(
        `Could not sync ${characterId} back to the registry: ` +
          `${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
}

/**
 * Extract a campaign bible with one retry on failure. Retry policy lives in
 * the CLI rather than core because it is an application-level decision; the
 * core extractCampaignBible function attempts a single call and throws on
 * any failure. If the second attempt also throws, the error propagates to
 * the caller, which translates it into a skipped rollup.
 */
async function extractBibleWithRetry(
  model: PlayDeps['model'],
  input: ExtractCampaignBibleInput,
): Promise<CampaignBibleInput> {
  try {
    return await extractCampaignBible(model, input);
  } catch {
    return await extractCampaignBible(model, input);
  }
}

/**
 * Project a {@link CampaignBibleRecord} (rich entries with source provenance)
 * down to a {@link CampaignBibleInput} (plain string lists) for feeding back
 * into the extractor as the "previously known bible". Returns `undefined`
 * when every list is empty so the extractor sees no priorBible block.
 */
function projectBibleForExtractor(
  record: CampaignBibleRecord | undefined,
): CampaignBibleInput | undefined {
  if (record === undefined) return undefined;
  const projected: CampaignBibleInput = {
    worldFacts: record.worldFacts.map((e) => e.text),
    majorNpcs: record.majorNpcs.map((e) => e.text),
    factions: record.factions.map((e) => e.text),
    openThreads: record.openThreads.map((e) => e.text),
  };
  const total =
    projected.worldFacts.length +
    projected.majorNpcs.length +
    projected.factions.length +
    projected.openThreads.length;
  return total === 0 ? undefined : projected;
}

/**
 * Check whether the campaign's open arc has accumulated enough closed sessions
 * to roll over. When it has, compose an arc summary + campaign bible via the
 * model and atomically close the arc and open the next one. The arc-stamp on
 * the just-closed session already happened atomically inside
 * {@link gracefulClose}, so this function starts at the threshold check.
 *
 * If the threshold has not yet been reached the function returns silently.
 * Either model call failing leads to an atomic skip: a warning is written and
 * the arc stays open; the next session will re-attempt once enough sessions
 * have closed.
 */
async function rollupCampaignArcIfReady(
  deps: PlayDeps,
  db: Db,
  campaignId: string,
  openArcId: string,
  now: string,
): Promise<void> {
  const closedSessions = getClosedSessionsInOpenArc(db, { campaignId });
  if (closedSessions.length < deps.memoryConfig.arcRolloverThreshold) {
    return;
  }

  const recaps = closedSessions
    .map((s) => getSessionRecap(db, { campaignId, sessionId: s.sessionId }))
    .filter((r): r is SessionRecapRecord => r !== undefined);

  // Feed the prior bible and any closed-arc summaries back into the extractor
  // so previously surfaced entities persist by default (loreweaver-06b.1).
  // Both are absent on the first-ever rollover and the extractor falls back
  // to the legacy recap-only layout.
  const priorBible = projectBibleForExtractor(
    getCampaignBible(db, { campaignId }),
  );
  const closedArcSummariesAll: ArcSummaryRecord[] = listClosedArcSummaries(db, {
    campaignId,
  });
  const closedArcSummaries =
    closedArcSummariesAll.length > 0 ? closedArcSummariesAll : undefined;

  let bible: CampaignBibleInput;
  try {
    bible = await extractBibleWithRetry(deps.model, {
      campaignId,
      recaps,
      priorBible,
      closedArcSummaries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.io.write(`Arc rollup skipped (bible extraction failed): ${message}.`);
    return;
  }

  let summary: string;
  try {
    summary = await composeArcSummary(deps.model, {
      campaignId,
      arcId: openArcId,
      recaps,
      bible,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.io.write(`Arc rollup skipped (arc summary failed): ${message}.`);
    return;
  }

  const result = closeOpenArcAndOpenNext(db, {
    campaignId,
    arcId: openArcId,
    summary,
    sourceSessionIds: recaps.map((r) => r.sessionId),
    campaignBible: bible,
    now,
  });
  deps.io.write(`Arc ${result.closedArcId} closed; opened ${result.newArcId}.`);
}

/**
 * Build the graceful-close input. The recap and accepted-mutation list are
 * composed deterministically from played content (scene summaries, the open
 * scene's transcript, and turn traces) by core's {@link composeSessionRecap},
 * so the persisted recap is tied to what actually happened in the session
 * rather than a factual stub.
 */
function closeInput(
  deps: PlayDeps,
  db: Db,
  campaignId: string,
  sessionId: string,
): CloseSessionGracefullyInput {
  const closedAt = deps.now();
  const { recap, stateDelta } = composeSessionRecap(db, {
    campaignId,
    sessionId,
  });
  return {
    campaignId,
    sessionId,
    closedAt,
    recap,
    stateDelta,
  };
}

/**
 * Run the graceful close pipeline and report the outcome. When a checkpoint
 * runner is available the close also snapshots campaign canon to Dolt; when it
 * is not (e.g. Dolt is not installed) the session still closes and recaps —
 * checkpointing is optional and never blocks a clean exit. A checkpoint that
 * fails after the session is already marked closed is reported, not fatal.
 */
export async function gracefulClose(
  deps: PlayDeps,
  db: Db,
  dbPath: string,
  campaignId: string,
  sessionId: string,
): Promise<void> {
  // Open (or reuse) the campaign's arc BEFORE closing the session so the
  // arc_id stamp and session close land in the same DB transaction.
  const now = deps.now();
  const openArc = openArcIfMissing(db, { campaignId, now });

  const input = closeInput(deps, db, campaignId, sessionId);
  const arcStamp = { arcId: openArc.arcId };
  const checkpoint = deps.makeCheckpointRunner(dbPath);
  if (checkpoint === undefined) {
    const closed = closeSessionGracefully(db, { ...input, arcStamp });
    deps.io.write(
      `Session ${closed.session.sessionId} closed and recapped (no checkpoint — Dolt is not available).`,
    );
  } else {
    try {
      const closed = closeSessionGracefully(db, {
        ...input,
        checkpoint,
        arcStamp,
      });
      deps.io.write(
        `Session ${closed.session.sessionId} closed and recapped` +
          `${closed.checkpointId ? ` (checkpoint ${closed.checkpointId})` : ''}.`,
      );
    } catch (error) {
      // closeSessionGracefully marks the session closed and writes the recap
      // BEFORE running the checkpoint, so a checkpoint failure still leaves a
      // fully closed, recapped session — only the Dolt snapshot is missing.
      deps.io.write(
        `Session ${sessionId} closed and recapped, but the checkpoint ` +
          `failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
  // The session is now closed, recapped, and arc-stamped on every path above.
  // Roll the campaign's arc up so the arc tier of the memory pyramid reflects
  // the closed session. The arc-stamp already happened atomically in close, so
  // rollupCampaignArcIfReady begins at the "check threshold" step.
  await rollupCampaignArcIfReady(deps, db, campaignId, openArc.arcId, now);

  // Quitting the campaign returns custody to the registry: sync each held
  // character back and release the cross-DB write lock (ADR 0012). Resuming the
  // campaign re-checks them out from the registry head.
  releaseCampaignCharacters(deps, db);
}
