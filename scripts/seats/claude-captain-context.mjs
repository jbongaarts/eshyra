#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  classifyClaudeSession,
  readCharter,
  readHandoff,
  readHookInput,
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
const classification = classifyClaudeSession(input);
if (!classification.eligible) process.exit(0);
if (
  process.env.ESHYRA_SEAT_ROLE === 'dispatched-worker' ||
  (typeof process.env.ESHYRA_DISPATCH_CHILD === 'string' &&
    process.env.ESHYRA_DISPATCH_CHILD.trim() !== '')
) {
  process.exit(0);
}

const charter = readCharter(SEATS.claudeCaptain, process.env);
if (charter === null) process.exit(0);

const handoff = readHandoff(
  SEATS.claudeCaptain,
  input.cwd ?? process.cwd(),
  process.env,
);
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
