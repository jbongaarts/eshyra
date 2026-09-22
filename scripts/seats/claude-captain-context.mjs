#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  classifyClaudeOccupant,
  classifyClaudeSession,
  readCharter,
  readHandoff,
  readHookInput,
  recordOccupantSession,
  renderSeatContext,
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
if (!classifyClaudeOccupant(input).eligible) process.exit(0);
if (
  process.env.ESHYRA_SEAT_ROLE === 'dispatched-worker' ||
  (typeof process.env.ESHYRA_DISPATCH_CHILD === 'string' &&
    process.env.ESHYRA_DISPATCH_CHILD.trim() !== '')
) {
  process.exit(0);
}

const charter = readCharter(SEATS.claudeCaptain, process.env);
if (charter === null) process.exit(0);

const cwd = input.cwd ?? process.cwd();

// This is the only event that carries model identity, so it is the only place
// the seat's authorization can be decided. Record the admitted session so an
// exit hook can recognise it later. A resumed session is admitted here too:
// it occupies the seat, it simply needs no charter re-injected.
recordOccupantSession(SEATS.claudeCaptain, cwd, process.env, {
  sessionId: input.session_id,
  model: input.model,
});

if (!classifyClaudeSession(input).eligible) process.exit(0);

const handoff = readHandoff(SEATS.claudeCaptain, cwd, process.env);
process.stdout.write(
  renderSeatContext({
    seatId: SEATS.claudeCaptain,
    seatTitle: 'Claude Captain',
    harness: 'Claude Code',
    charter,
    handoff,
    occupant: { model: input.model, session: input.session_id },
  }),
);
