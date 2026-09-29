#!/usr/bin/env node
// Stop / SessionEnd hook: the Claude Captain seat's exit channel.
//
// The seat's obligations are otherwise entry-shaped — charter injection, the
// handoff read, and PreCompact all fire at or before a session's context is
// rebuilt — while the obligation to leave a handoff falls due when a session
// ENDS. This closes that gap, under the same authorization as the entry side.
//
// Three properties do the work:
//   - No exit event carries `model`, so this cannot re-run the seat's model
//     gate. It does not re-run it: SessionStart already did, and recorded the
//     session id it admitted. No ledger record means no output, so an
//     unauthorized model, a `claude -p` run with no model identity, and any
//     session that started before this hook existed all stay silent. The
//     one exception is a /clear successor (eshyra-8uuv): its transcript
//     begins with SessionStart:clear and names the model on every assistant
//     message, which is identity evidence rather than a guess.
//   - Claude subagents raise SubagentStop, not Stop, and `agent_id` is present
//     on a subagent payload either way. Both are refused.
//   - Stop's stdout is only read as JSON, and only
//     `hookSpecificOutput.additionalContext` reaches the model. Plain text on
//     exit 0 is discarded for this event, so the payload is built explicitly.
//
// SessionEnd cannot deliver anything to a model that is already ending — its
// output goes nowhere — so this handles that event for cleanup only.
import { readFileSync } from 'node:fs';
import {
  CAPTAIN_MODEL_PATTERN,
  clearOccupantSession,
  handoffExitReminder,
  markOccupantReminded,
  readHandoff,
  readHookInput,
  readOccupantSession,
  recordClearHandover,
  recordLateOccupantSession,
  SEATS,
  transcriptClearContinuation,
} from './seatContext.mjs';

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

let raw;
try {
  raw = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

const input = readHookInput(raw);
if (input === null) process.exit(0);
if (input.agent_id) process.exit(0);
if (
  process.env.ESHYRA_SEAT_ROLE === 'dispatched-worker' ||
  (typeof process.env.ESHYRA_DISPATCH_CHILD === 'string' &&
    process.env.ESHYRA_DISPATCH_CHILD.trim() !== '')
) {
  process.exit(0);
}

const cwd = input.cwd ?? process.cwd();

if (input.hook_event_name === 'SessionEnd') {
  // /clear continues the same occupant under a new session id; leave the
  // successor a single-use handover of the identity admitted here.
  if (input.reason === 'clear')
    recordClearHandover(
      SEATS.claudeCaptain,
      cwd,
      process.env,
      input.session_id,
    );
  clearOccupantSession(SEATS.claudeCaptain, cwd, process.env, input.session_id);
  process.exit(0);
}

if (input.hook_event_name !== 'Stop') process.exit(0);
// Already inside a stop-hook continuation: nudging again would loop.
if (input.stop_hook_active) process.exit(0);

// A /clear successor whose SessionStart ran before its predecessor's
// SessionEnd had no handover to inherit. Its transcript still proves the
// occupant: it began with SessionStart:clear and names a captain model.
function lateClearAdmission() {
  const continuation = transcriptClearContinuation(input.transcript_path);
  if (continuation === null || !CAPTAIN_MODEL_PATTERN.test(continuation.model))
    return null;
  return recordLateOccupantSession(SEATS.claudeCaptain, cwd, process.env, {
    sessionId: input.session_id,
    ...continuation,
  });
}

const session =
  readOccupantSession(
    SEATS.claudeCaptain,
    cwd,
    process.env,
    input.session_id,
  ) ?? lateClearAdmission();
const reminder = handoffExitReminder({
  seatId: SEATS.claudeCaptain,
  handoff: readHandoff(SEATS.claudeCaptain, cwd, process.env),
  cwd,
  transcriptPath: input.transcript_path,
  session,
});
if (reminder === null) process.exit(0);

// Mark before emitting: a reminder lost to a write failure is better than one
// delivered at every turn end for the rest of the session.
if (
  !markOccupantReminded(SEATS.claudeCaptain, cwd, process.env, input.session_id)
)
  process.exit(0);

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: reminder,
    },
  })}\n`,
);
