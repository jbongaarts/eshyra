import type { CampaignInfo, Db, SessionLaunchState } from '@eshyra/core';
import {
  createCampaign,
  getCampaign,
  getSessionLaunchState,
  startSession,
} from '@eshyra/core';
import { gracefulClose } from './playClose.js';
import {
  bindAdventureModule,
  chooseAdventureModule,
} from './playModuleSelector.js';
import type { PlayDeps } from './playTypes.js';

/** Replay the volatile tail of the open scene so a resumed player has context. */
function renderSceneTail(
  io: PlayDeps['io'],
  state: Extract<SessionLaunchState, { kind: 'resume' }>,
): void {
  if (state.openScene === undefined || state.sceneTail.length === 0) {
    return;
  }
  io.write(`— Recent scene: ${state.openScene.title} —`);
  for (const entry of state.sceneTail) {
    io.write(`${entry.role}: ${entry.content}`);
  }
  io.write('—');
}

/**
 * Replay the DM's last recorded line as a resume recap so a player returning to
 * an existing campaign sees where the story left off before their first input
 * (eshyra-w8f2). Fires once per launch, only when the campaign has prior DM
 * output. When it has none — a brand-new campaign — there is nothing to replay,
 * so this returns silently and {@link launch} instead offers the adventure-module
 * selector before starting the new session (eshyra-47ob).
 */
function renderResumeRecap(
  io: PlayDeps['io'],
  state: Extract<SessionLaunchState, { kind: 'start_new' }>,
): void {
  if (state.lastDmOutput === undefined) {
    return;
  }
  io.write('— Resuming campaign. The DM last said: —');
  io.write(state.lastDmOutput.content);
  io.write('—');
}

function startNewSession(deps: PlayDeps, db: Db, campaignId: string): string {
  const sessionId = deps.nextId('session');
  startSession(db, { campaignId, sessionId, startedAt: deps.now() });
  deps.io.write(`Started session ${sessionId}. Type /quit to save and exit.`);
  return sessionId;
}

/** Select the existing campaign, or create one from the module template. */
export function resolveCampaign(deps: PlayDeps, db: Db): CampaignInfo {
  const existing = getCampaign(db);
  if (existing !== undefined) {
    deps.io.write(`Campaign: ${existing.title} (${existing.campaignId}).`);
    return existing;
  }
  const created = createCampaign(db, {
    campaignId: deps.nextId('campaign'),
    pack: deps.pack,
  });
  deps.io.write(
    `Created campaign '${created.campaignId}' from module: ${created.title}.`,
  );
  return created;
}

/**
 * Resolve which session to play. A crash leaves a session open; launch offers
 * the player Resume (reattach to the open session) or Close-and-recap (run the
 * close pipeline, then start fresh).
 */
export async function launch(
  deps: PlayDeps,
  db: Db,
  dbPath: string,
  campaign: CampaignInfo,
): Promise<string> {
  const state = getSessionLaunchState(db, { campaignId: campaign.campaignId });
  if (state.kind === 'start_new') {
    // Returning to a campaign whose last session closed cleanly: replay the
    // DM's last words before the new session starts so the player has context
    // for their first input. A brand-new campaign has no prior output and this
    // is a no-op.
    renderResumeRecap(deps.io, state);
    // A fresh campaign (no prior DM output) offers the adventure-module
    // selector before the session starts (eshyra-47ob). Selection only prompts;
    // binding happens after startNewSession because an adventure run records
    // the session it began in. An existing campaign skips selection entirely.
    const chosenModule =
      state.lastDmOutput === undefined
        ? await chooseAdventureModule(deps, db, campaign.campaignId)
        : undefined;
    const sessionId = startNewSession(deps, db, campaign.campaignId);
    if (chosenModule !== undefined) {
      bindAdventureModule(
        deps,
        db,
        campaign.campaignId,
        sessionId,
        chosenModule,
      );
    }
    return sessionId;
  }

  deps.io.write(
    `An unfinished session is open: ${state.session.sessionId} ` +
      `(started ${state.session.startedAt}).`,
  );
  renderSceneTail(deps.io, state);

  const answer = await deps.io.prompt(
    'Resume this session, or close it and recap? [resume/close] ',
  );
  const normalized = (answer ?? 'resume').toLowerCase();
  if (normalized === 'close' || normalized === 'c') {
    await gracefulClose(
      deps,
      db,
      dbPath,
      campaign.campaignId,
      state.session.sessionId,
    );
    return startNewSession(deps, db, campaign.campaignId);
  }

  deps.io.write(`Resuming session ${state.session.sessionId}.`);
  return state.session.sessionId;
}
