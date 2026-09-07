#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyCodexSession,
  hookAdmission,
  readCharter,
  readHandoff,
  readHookInput,
  renderSeatContext,
  resolveSeatRoots,
  SEATS,
  seatHookIdentity,
} from './seatContext.mjs';

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

// Record that Codex actually dispatched this hook, bound to the declaration and
// the Codex build that produced the run, so a later edit or upgrade cannot be
// certified by an old observation. Only the installed shim asks for this; the
// repository copy is never asked and so never writes.
// Only a run Codex admitted under normal persisted trust is evidence of trust.
const stampPath =
  hookAdmission() === 'persisted-trust' ? process.env.ESHYRA_SEAT_STAMP : null;
if (stampPath) {
  try {
    writeFileSync(
      stampPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        identity: seatHookIdentity(process.env.ESHYRA_SEAT_PROFILE ?? ''),
      })}\n`,
    );
  } catch {
    // An unwritable stamp must never stop the seat from loading.
  }
}

let raw;
try {
  raw = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

const input = readHookInput(raw);
const classification = classifyCodexSession(input, process.env);
if (!classification.eligible) process.exit(0);

const cwd = input.cwd ?? process.cwd();
if (!process.env.ESHYRA_SEAT_TEST_ROOT) {
  const roots = resolveSeatRoots(cwd, process.env);
  const checkoutRoot = roots === null ? null : roots.checkoutRoot;
  if (
    checkoutRoot === null ||
    !existsSync(join(checkoutRoot, 'AGENTS.md')) ||
    !existsSync(join(checkoutRoot, '.beads', 'metadata.json'))
  ) {
    process.exit(0);
  }
}

const charter = readCharter(SEATS.codexCaptain, process.env);
if (charter === null) process.exit(0);

const handoff = readHandoff(SEATS.codexCaptain, cwd, process.env);
process.stdout.write(
  renderSeatContext({
    seatId: SEATS.codexCaptain,
    seatTitle: 'Codex Captain',
    harness: 'Codex CLI',
    charter,
    handoff,
    occupant: { model: input.model, session: input.session_id },
  }),
);
