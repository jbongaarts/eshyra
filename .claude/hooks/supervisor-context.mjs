#!/usr/bin/env node
// SessionStart hook: inject the Codex-subagent supervisor workflow, but only
// into a main-agent Claude Code session running a supervisor-class model
// (Fable or Opus).
//
// Scoping this relies on:
//   - Codex never executes Claude Code hooks, so Codex-driven sessions can't
//     reach this script at all.
//   - SessionStart fires only for the main session (subagents get the separate
//     SubagentStart event, which is not registered) — the agent_id check below
//     is belt-and-braces.
//   - The hook input's optional "model" field gates on the supervisor-class
//     list. If the field is absent (older CLI), the doc is injected with a
//     self-gate preamble rather than silently dropped.
//   - source === "resume" is skipped: the transcript already carries the
//     injection from the original startup, and re-emitting on every resume
//     would accumulate duplicate copies. startup/clear/compact still emit.
//
// Node (not jq/bash) so the only prerequisite is the Node 24 runtime the
// repo already requires.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // malformed/empty stdin: fail closed, inject nothing
}

// Models capable of supervising Codex dispatches. Matches display names and
// model ids alike (e.g. "Fable 5", "claude-opus-4-8").
const SUPERVISOR_MODEL = /fable|opus/i;

const model = typeof input.model === 'string' ? input.model : '';
if (input.agent_id) process.exit(0);
if (input.source === 'resume') process.exit(0);
if (model && !SUPERVISOR_MODEL.test(model)) process.exit(0);

const doc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'codex-subagent-workflow.md'),
  'utf8',
);
if (!model) {
  process.stdout.write(
    '(The following supervisor workflow applies only if you are a Fable- or Opus-class model; otherwise ignore this entire section.)\n\n',
  );
}
process.stdout.write(doc);
