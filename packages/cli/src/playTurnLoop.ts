import type { Db } from '@eshyra/core';
import { getDemoTurnBudget } from '@eshyra/core';
import { createAdditionalCharacter } from './playCharacter.js';
import { gracefulClose } from './playClose.js';
import { showParty, switchActiveCharacter } from './playParty.js';
import type { PlayDeps } from './playTypes.js';

/** Inputs that end the turn loop and trigger a graceful close. */
const QUIT_COMMANDS = new Set(['/quit', '/exit']);

/**
 * Handle a party-management slash command. Returns true if `input` was a
 * recognized command (and was handled), so the caller skips the turn.
 * Unrecognized slash inputs return false and fall through to a normal turn.
 */
async function handlePartyCommand(
  deps: PlayDeps,
  db: Db,
  input: string,
): Promise<boolean> {
  const spaceIndex = input.indexOf(' ');
  const command = (
    spaceIndex === -1 ? input : input.slice(0, spaceIndex)
  ).toLowerCase();
  const arg = spaceIndex === -1 ? '' : input.slice(spaceIndex + 1).trim();

  switch (command) {
    case '/party':
      showParty(deps.io, db);
      return true;
    case '/switch':
      switchActiveCharacter(deps.io, db, arg);
      return true;
    case '/addpc':
      await createAdditionalCharacter(deps, db);
      return true;
    default:
      return false;
  }
}

/**
 * Read player input and play turns until the player quits or input ends, then
 * run the graceful close pipeline. A failed turn is reported and play
 * continues — the orchestrator rolls a failed turn back, so pre-turn state is
 * intact.
 */
export async function turnLoop(
  deps: PlayDeps,
  db: Db,
  dbPath: string,
  campaignId: string,
  sessionId: string,
  turnCap?: number,
): Promise<void> {
  for (;;) {
    if (turnCap !== undefined) {
      const budget = getDemoTurnBudget(db, { campaignId, sessionId, turnCap });
      if (budget.capReached) {
        deps.io.write(
          `Demo turn cap reached (${budget.turnsUsed}/${budget.turnCap}). Start a full campaign to keep playing.`,
        );
        break;
      }
    }
    const input = await deps.io.prompt('> ');
    if (input === undefined || QUIT_COMMANDS.has(input.toLowerCase())) {
      break;
    }
    if (input.length === 0) {
      continue;
    }
    if (input.startsWith('/') && (await handlePartyCommand(deps, db, input))) {
      continue;
    }

    const result = await deps.runTurn(
      {
        db,
        model: deps.model,
        registry: deps.registry,
        ...(deps.auditor ? { auditor: deps.auditor } : {}),
        ...(deps.debug ? { debug: deps.debug } : {}),
        ...(deps.diagnostics ? { diagnostics: deps.diagnostics } : {}),
      },
      {
        campaignId,
        sessionId,
        turnId: deps.nextId('turn'),
        playerInput: input,
        seed: deps.seed(),
        at: deps.now(),
        recentSessionLimit: deps.memoryConfig.recapWindowSize,
      },
    );
    if (result.ok) {
      // Turn-granular output: `ModelClient.complete` returns a whole completion
      // and `runTurn` resolves once the turn is finished, so narration is
      // written in one shot rather than streamed token-by-token (see ADR 0002).
      deps.io.write(result.narration);
    } else if (result.isRateLimit) {
      const retryHint =
        result.retryAfterSeconds !== undefined
          ? ` Try again in ${result.retryAfterSeconds}s.`
          : ' Try again later.';
      deps.io.write(
        `Model provider rate limit reached.${retryHint} Your last input was not applied.`,
      );
    } else {
      deps.io.write(
        `(the turn could not be completed: ${result.error ?? 'unknown error'} — your last input was not applied)`,
      );
    }
  }

  await gracefulClose(deps, db, dbPath, campaignId, sessionId);
}
