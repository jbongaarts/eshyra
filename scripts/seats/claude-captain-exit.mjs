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
//     session that started before this hook existed all stay silent.
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
  clearOccupantSession,
  handoffExitReminder,
  markOccupantReminded,
  readHandoff,
  readHookInput,
  readOccupantSession,
  SEATS,
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
  clearOccupantSession(SEATS.claudeCaptain, cwd, process.env, input.session_id);
  process.exit(0);
}

if (input.hook_event_name !== 'Stop') process.exit(0);
// Already inside a stop-hook continuation: nudging again would loop.
if (input.stop_hook_active) process.exit(0);

const session = readOccupantSession(
  SEATS.claudeCaptain,
  cwd,
  process.env,
  input.session_id,
);
const reminder = handoffExitReminder({
  seatId: SEATS.claudeCaptain,
  handoff: readHandoff(SEATS.claudeCaptain, cwd, process.env),
  cwd,
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
