#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  classifyClaudeOccupant,
  classifyClaudeSession,
  consumeClearHandover,
  readCharter,
  readHandoff,
  readHookInput,
  readOccupantSession,
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

const parsed = readHookInput(raw);
if (parsed === null || parsed.agent_id) process.exit(0);
if (
  process.env.ESHYRA_SEAT_ROLE === 'dispatched-worker' ||
  (typeof process.env.ESHYRA_DISPATCH_CHILD === 'string' &&
    process.env.ESHYRA_DISPATCH_CHILD.trim() !== '')
) {
  process.exit(0);
}

const cwd = parsed.cwd ?? process.cwd();

// A clear or compact SessionStart may arrive without `model` (eshyra-8uuv).
// Inherit it only from an identity this seat already admitted: the compacting
// session's own ledger record, or the single-use handover its /clear
// predecessor left. Any other missing model still fails the gate below.
function inheritedModel() {
  if (typeof parsed.model === 'string' && parsed.model.trim() !== '')
    return parsed.model;
  if (parsed.source === 'compact')
    return (
      readOccupantSession(
        SEATS.claudeCaptain,
        cwd,
        process.env,
        parsed.session_id,
      )?.model ?? undefined
    );
  if (parsed.source === 'clear')
    return (
      consumeClearHandover(SEATS.claudeCaptain, cwd, process.env) ?? undefined
    );
  return parsed.model;
}

const input = { ...parsed, model: inheritedModel() };
if (!classifyClaudeOccupant(input).eligible) process.exit(0);

const charter = readCharter(SEATS.claudeCaptain, process.env);
if (charter === null) process.exit(0);

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
